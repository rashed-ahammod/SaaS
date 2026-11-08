"use client";
/**
 * Employee lifecycle in the portal (employee audit fixes):
 *   - ProbationActions   the review of one probation: Dept Head recommends, HR decides
 *   - SeparationView     a leaver: notice vs the notice period, the four clearances,
 *                        withdraw, the experience certificate once separated
 *   - NoticeDialog       HR records a resignation, termination, retirement or contract end
 *   - LifecycleStatus    both of the above on the employee's profile tab
 *   - EmployeeDocuments  upload, view, remove documents (NID, TIN certificate ...)
 *   - JobChanges         the recorded job changes, and cancelling a wrong one
 */
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, saveDownload, useApi } from "@/lib/api";
import { dhakaToday, formatDate, formatTaka, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { EmployeeDetail } from "./employee-tabs";
import {
  ActionMessage,
  FormButtons,
  Modal,
  Panel,
  Table,
  useAction,
} from "./kit";
import { usePortal } from "./portal-context";

export type Outcome = "confirm" | "extend" | "end";
export type ClearanceItem =
  "it" | "admin_assets" | "accounts_advances" | "dept_handover";

export interface ProbationReview {
  recommendation: Outcome | null;
  recommendMonths: number | null;
  recommendNote: string | null;
  recommendedBy: string | null;
  decision: Outcome | null;
}

export interface ProbationDue {
  employeeId: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameBn: string | null;
  probationEndDate: string;
  daysLeft: number;
  review: ProbationReview | null;
}

export interface Separation {
  id: string;
  employeeId: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameBn: string | null;
  kind:
    | "resignation"
    | "termination"
    | "retirement"
    | "contract_end"
    | "probation_end";
  noticeDate: string;
  lastWorkingDay: string;
  requiredNoticeDays: number;
  givenNoticeDays: number;
  shortfallDays: number;
  reason: string;
  state: "in_notice" | "separated" | "withdrawn";
  withdrawnReason: string | null;
  clearances: Array<{
    item: ClearanceItem;
    cleared: boolean;
    clearedAt: string | null;
    clearedBy: string | null;
    note: string | null;
    canClear: boolean;
  }>;
  owed: {
    salaryAdvances: string;
    cashAdvances: string;
    assets: Array<{
      id: string;
      tag: string;
      name: string;
      assignedOn: string;
    }>;
  };
}

const SEP_COLOR = {
  in_notice: "amber",
  separated: "gray",
  withdrawn: "blue",
} as const;

// ------------------------------------------------------------------ probation

export function ProbationSummary({ due }: { due: ProbationDue }) {
  const { t, lang } = useI18n();
  const r = due.review;
  return (
    <span className="text-sm">
      {due.daysLeft >= 0 ? (
        t("lc.prob.daysLeft", { n: num(due.daysLeft, lang) })
      ) : (
        <span className="text-red-700">
          {t("lc.prob.overdue", { n: num(-due.daysLeft, lang) })}
        </span>
      )}
      {" · "}
      {r?.recommendation ? (
        <>
          {t("lc.prob.recommended", {
            outcome:
              t(`lc.prob.outcome.${r.recommendation}`) +
              (r.recommendMonths ? ` (${num(r.recommendMonths, lang)})` : ""),
          })}{" "}
          {r.recommendedBy && (
            <span className="text-slate-500">
              {t("lc.prob.by", { name: r.recommendedBy })}
            </span>
          )}
          {r.recommendNote && (
            <span className="block text-xs text-slate-600">
              “{r.recommendNote}”
            </span>
          )}
        </>
      ) : (
        <span className="text-slate-500">{t("lc.prob.notYet")}</span>
      )}
    </span>
  );
}

/** The Recommend (Dept Head / HR) and Decide (HR) buttons for one employee on probation. */
export function ProbationActions({
  employeeId,
  name,
  review,
  onDone,
}: {
  employeeId: string;
  name: string;
  review: ProbationReview | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { can } = usePortal();
  const { me } = useSession();
  const [mode, setMode] = useState<"recommend" | "decide" | null>(null);
  const self = me?.employeeId === employeeId;
  if (self) return null;
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {can("employee.lifecycle.review", "employee.manage") && (
        <Button
          variant="ghost"
          className="min-h-8 px-2 py-1 text-sm"
          onClick={() => setMode("recommend")}
        >
          {t("lc.prob.recommend")}
        </Button>
      )}
      {can("employee.manage") && (
        <Button
          variant="secondary"
          className="min-h-8 px-2 py-1 text-sm"
          onClick={() => setMode("decide")}
        >
          {t("lc.prob.decide")}
        </Button>
      )}
      {mode && (
        <ProbationForm
          employeeId={employeeId}
          name={name}
          mode={mode}
          initial={
            mode === "decide" && review?.recommendation
              ? {
                  outcome: review.recommendation,
                  months: review.recommendMonths,
                }
              : undefined
          }
          onClose={() => setMode(null)}
          onDone={() => {
            setMode(null);
            onDone();
          }}
        />
      )}
    </span>
  );
}

function ProbationForm({
  employeeId,
  name,
  mode,
  initial,
  onClose,
  onDone,
}: {
  employeeId: string;
  name: string;
  mode: "recommend" | "decide";
  initial?: { outcome: Outcome; months: number | null };
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    outcome: initial?.outcome ?? ("confirm" as Outcome),
    months: String(initial?.months ?? 3),
    note: "",
    lastWorkingDay: dhakaToday(),
  });
  const title = `${mode === "recommend" ? t("lc.prob.recommend") : t("lc.prob.decide")}: ${name}`;
  return (
    <Modal title={title} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            outcome: f.outcome,
            note: f.note,
            ...(f.outcome === "extend" ? { months: Number(f.months) } : {}),
            ...(mode === "decide" && f.outcome === "end"
              ? { lastWorkingDay: f.lastWorkingDay }
              : {}),
          };
          const path =
            mode === "recommend"
              ? "probation-recommendation"
              : "probation-decision";
          if (
            await save.run(
              () => api.post(`/employees/${employeeId}/${path}`, body),
              t("lc.prob.saved"),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field
          label={
            mode === "recommend" ? t("lc.prob.outcome") : t("lc.prob.decision")
          }
        >
          <Select
            value={f.outcome}
            onChange={(e) => setF({ ...f, outcome: e.target.value as Outcome })}
            id="prob-outcome"
          >
            {(["confirm", "extend", "end"] as const).map((o) => (
              <option key={o} value={o}>
                {t(`lc.prob.outcome.${o}`)}
              </option>
            ))}
          </Select>
        </Field>
        {f.outcome === "extend" && (
          <Field label={t("lc.prob.months")}>
            <Input
              type="number"
              min={1}
              max={12}
              required
              value={f.months}
              onChange={(e) => setF({ ...f, months: e.target.value })}
              id="prob-months"
            />
          </Field>
        )}
        {mode === "decide" && f.outcome === "end" && (
          <Field label={t("lc.prob.lastDay")}>
            <Input
              type="date"
              required
              value={f.lastWorkingDay}
              onChange={(e) => setF({ ...f, lastWorkingDay: e.target.value })}
              id="prob-last-day"
            />
          </Field>
        )}
        <Field label={t("lc.prob.note")}>
          <Input
            required
            maxLength={1000}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="prob-note"
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ separation

export function NoticeDialog({
  open,
  onClose,
  employeeId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    kind: "resignation",
    noticeDate: dhakaToday(),
    lastWorkingDay: "",
    reason: "",
  });
  return (
    <Modal title={t("lc.notice.title")} open={open} onClose={onClose}>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (
            await save.run(() => api.post(`/employees/${employeeId}/notice`, f))
          ) {
            onClose();
            onDone();
          }
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("lc.notice.kind")}>
          <Select
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
            id="notice-kind"
          >
            {(
              [
                "resignation",
                "termination",
                "retirement",
                "contract_end",
              ] as const
            ).map((k) => (
              <option key={k} value={k}>
                {t(`lc.kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("lc.notice.date")}>
            <Input
              type="date"
              required
              value={f.noticeDate}
              onChange={(e) => setF({ ...f, noticeDate: e.target.value })}
              id="notice-date"
            />
          </Field>
          <Field label={t("lc.notice.lastDay")}>
            <Input
              type="date"
              required
              min={f.noticeDate}
              value={f.lastWorkingDay}
              onChange={(e) => setF({ ...f, lastWorkingDay: e.target.value })}
              id="notice-last-day"
            />
          </Field>
        </div>
        <Field label={t("lc.notice.reason")}>
          <Input
            required
            maxLength={500}
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
            id="notice-reason"
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

/** One leaver: the notice, the four clearances, withdraw and the certificate. */
export function SeparationView({
  s,
  onChanged,
}: {
  s: Separation;
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const action = useAction();
  const [clearing, setClearing] = useState<ClearanceItem | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const done = s.clearances.filter((c) => c.cleared).length;
  const owes =
    Number(s.owed.salaryAdvances) > 0 || Number(s.owed.cashAdvances) > 0;
  return (
    <div>
      <ActionMessage action={action} />
      <p className="mb-1 flex flex-wrap items-center gap-2">
        <Badge color={SEP_COLOR[s.state]}>
          {s.state === "in_notice"
            ? t(`lc.kind.${s.kind}`)
            : s.state === "separated"
              ? t("lc.sep.separated")
              : t("lc.sep.withdrawn")}
        </Badge>
        <span className="text-sm">
          {t("lc.notice.lastDay")}:{" "}
          <strong>{formatDate(s.lastWorkingDay, lang)}</strong>
        </span>
        {s.requiredNoticeDays > 0 && (
          <span className="text-sm text-slate-600">
            {t("lc.sep.notice", {
              given: num(s.givenNoticeDays, lang),
              required: num(s.requiredNoticeDays, lang),
            })}
            {s.shortfallDays > 0 && (
              <strong className="ml-1 text-amber-700">
                · {t("lc.sep.shortfall", { n: num(s.shortfallDays, lang) })}
              </strong>
            )}
          </span>
        )}
      </p>
      <p className="mb-3 text-sm text-slate-600">{s.reason}</p>
      {s.shortfallDays > 0 && s.state === "in_notice" && (
        <p className="mb-3 text-sm text-amber-800">
          {s.kind === "resignation"
            ? t("lc.sep.shortfallResign", { n: num(s.shortfallDays, lang) })
            : t("lc.sep.shortfallTerminate", { n: num(s.shortfallDays, lang) })}
        </p>
      )}
      {s.state === "withdrawn" && s.withdrawnReason && (
        <p className="mb-3 text-sm text-slate-600">“{s.withdrawnReason}”</p>
      )}

      {s.state !== "withdrawn" && (
        <>
          <p className="mb-1 text-sm font-semibold">
            {t("lc.sep.clearance")} · {t("lc.sep.done", { n: num(done, lang) })}
          </p>
          <ul className="mb-3 divide-y divide-slate-100 rounded border border-slate-200">
            {s.clearances.map((c) => (
              <li
                key={c.item}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span>
                  <span className="block text-sm font-medium">
                    {t(`lc.item.${c.item}`)}
                  </span>
                  {c.cleared && (
                    <span className="block text-xs text-slate-600">
                      {c.clearedBy}
                      {c.clearedAt
                        ? ` · ${formatDate(c.clearedAt.slice(0, 10), lang, { short: true })}`
                        : ""}
                      {c.note ? ` · “${c.note}”` : ""}
                    </span>
                  )}
                  {c.item === "admin_assets" &&
                    !c.cleared &&
                    s.owed.assets.length > 0 && (
                      <span className="block text-xs text-amber-700">
                        {t("as.assetsHeld", {
                          tags: s.owed.assets
                            .map((a) => `${a.tag} ${a.name}`)
                            .join(", "),
                        })}
                      </span>
                    )}
                  {c.item === "accounts_advances" && !c.cleared && owes && (
                    <span className="block text-xs text-amber-700">
                      {t("lc.sep.owed", {
                        loan: formatTaka(s.owed.salaryAdvances, lang),
                        cash: formatTaka(s.owed.cashAdvances, lang),
                      })}
                    </span>
                  )}
                </span>
                {c.cleared ? (
                  <Badge color="green">{t("lc.sep.cleared")}</Badge>
                ) : c.canClear ? (
                  <Button
                    variant="secondary"
                    className="min-h-8 px-2 py-1 text-sm"
                    onClick={() => setClearing(c.item)}
                  >
                    {t("lc.sep.clear")}
                  </Button>
                ) : (
                  <Badge color="amber">{t("lc.sep.waiting")}</Badge>
                )}
              </li>
            ))}
          </ul>
          {s.state === "in_notice" && done === 4 && (
            <Alert kind="success">{t("lc.sep.ready")}</Alert>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {s.state === "in_notice" && can("employee.manage") && (
          <Button variant="ghost" onClick={() => setWithdrawing(true)}>
            {t("lc.sep.withdraw")}
          </Button>
        )}
        {s.state === "separated" && can("employee.manage") && (
          <Button
            variant="secondary"
            busy={action.busy}
            onClick={() =>
              action.run(async () =>
                saveDownload(
                  await api.file(
                    `/employees/${s.employeeId}/experience-certificate.pdf?lang=${lang}`,
                  ),
                  `experience-certificate-${s.employeeCode}.pdf`,
                ),
              )
            }
          >
            {t("lc.sep.certificate")}
          </Button>
        )}
      </div>
      {clearing && (
        <ClearDialog
          s={s}
          item={clearing}
          onClose={() => setClearing(null)}
          onDone={() => (setClearing(null), onChanged())}
        />
      )}
      {withdrawing && (
        <WithdrawDialog
          s={s}
          onClose={() => setWithdrawing(false)}
          onDone={() => (setWithdrawing(false), onChanged())}
        />
      )}
    </div>
  );
}

function ClearDialog({
  s,
  item,
  onClose,
  onDone,
}: {
  s: Separation;
  item: ClearanceItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [note, setNote] = useState("");
  return (
    <Modal
      title={`${t("lc.sep.clear")}: ${t(`lc.item.${item}`)} · ${s.employeeCode}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(
                `/separations/${s.id}/clearances/${item}`,
                note ? { note } : {},
              ),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("lc.sep.clearNote")}>
          <Input
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            id="clear-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("lc.sep.clear")}
        />
      </form>
    </Modal>
  );
}

function WithdrawDialog({
  s,
  onClose,
  onDone,
}: {
  s: Separation;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={`${t("lc.sep.withdraw")}: ${s.employeeCode}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/separations/${s.id}/withdraw`, { reason }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <p className="mb-3 text-sm text-slate-600">
          {t("lc.sep.withdrawHint")}
        </p>
        <Field label={t("p.reason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="withdraw-reason"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("lc.sep.withdraw")}
        />
      </form>
    </Modal>
  );
}

/** On the profile tab: the probation (with its review) or the separation. */
export function LifecycleStatus({
  e,
  reload,
}: {
  e: EmployeeDetail & { confirmedAt?: string | null };
  reload: () => void;
}) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const reviewer = can("employee.manage", "employee.lifecycle.review");
  const due = useApi<ProbationDue[]>(
    e.status === "probation" && reviewer
      ? `/companies/${e.companyId}/probation-reviews?withinDays=180`
      : null,
  );
  const separation = useApi<Separation>(
    e.status === "notice" || e.status === "separated"
      ? `/employees/${e.id}/separation`
      : null,
  );

  if (e.status === "probation" && e.probationEndDate) {
    const mine = due.data?.find((d) => d.employeeId === e.id);
    return (
      <Panel
        title={t("lc.prob.title")}
        actions={
          reviewer && (
            <ProbationActions
              employeeId={e.id}
              name={e.fullNameEn}
              review={mine?.review ?? null}
              onDone={() => (reload(), due.reload())}
            />
          )
        }
      >
        <p className="text-sm">
          {t("lc.prob.onProbation", {
            date: formatDate(e.probationEndDate, lang),
          })}
        </p>
        {mine && <ProbationSummary due={mine} />}
      </Panel>
    );
  }
  if (e.status === "notice" || e.status === "separated") {
    if (separation.error) return null; // put on notice before clearance existed, or no access
    if (!separation.data) return <Loading />;
    return (
      <Panel title={t("lc.sep.title")}>
        <SeparationView
          s={separation.data}
          onChanged={() => (separation.reload(), reload())}
        />
      </Panel>
    );
  }
  if (e.status === "active" && e.confirmedAt) {
    return (
      <p className="mb-3 text-sm text-slate-500">
        {t("lc.prob.confirmedOn", {
          date: formatDate(e.confirmedAt.slice(0, 10), lang),
        })}
      </p>
    );
  }
  return null;
}

// ------------------------------------------------------------------ documents

interface EmployeeDocument {
  id: string;
  docType: string;
  title: string | null;
  fileName: string;
  sizeBytes: number;
  expiresOn: string | null;
  status: "active" | "removed";
  removedReason: string | null;
  uploadedAt: string;
}

const DOC_TYPES = [
  "nid",
  "tin_certificate",
  "photo",
  "cv",
  "educational_certificate",
  "experience_letter",
  "contract",
  "other",
] as const;

export function EmployeeDocuments({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const manage = can("employee.manage");
  const [showRemoved, setShowRemoved] = useState(false);
  const docs = useApi<EmployeeDocument[]>(
    `/employees/${id}/documents${showRemoved ? "?includeRemoved=true" : ""}`,
  );
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<EmployeeDocument | null>(null);
  const today = dhakaToday();
  return (
    <Panel
      title={t("lc.doc.title")}
      actions={
        <>
          {manage && (
            <label className="flex items-center gap-1 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={showRemoved}
                onChange={(e) => setShowRemoved(e.target.checked)}
              />{" "}
              {t("lc.doc.showRemoved")}
            </label>
          )}
          {manage && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              {t("lc.doc.add")}
            </Button>
          )}
        </>
      }
    >
      <ActionMessage action={action} />
      {docs.error ? (
        <ErrorBox error={docs.error} />
      ) : (
        <Table
          rows={docs.data}
          rowKey={(d) => d.id}
          empty={t("lc.doc.none")}
          columns={[
            {
              key: "type",
              label: t("lc.doc.type"),
              render: (d) => t(`lc.doc.type.${d.docType}`),
            },
            {
              key: "title",
              label: t("lc.doc.titleField"),
              render: (d) => d.title ?? d.fileName,
            },
            {
              key: "uploaded",
              label: t("p.date"),
              render: (d) =>
                formatDate(d.uploadedAt.slice(0, 10), lang, { short: true }),
            },
            {
              key: "expires",
              label: t("lc.doc.expires"),
              render: (d) =>
                d.expiresOn ? (
                  <span
                    className={
                      d.expiresOn < today ? "font-semibold text-red-700" : ""
                    }
                  >
                    {formatDate(d.expiresOn, lang, { short: true })}
                    {d.expiresOn < today ? ` · ${t("lc.doc.expired")}` : ""}
                  </span>
                ) : (
                  "—"
                ),
            },
            {
              key: "status",
              label: "",
              render: (d) =>
                d.status === "removed" ? (
                  <Badge color="gray">{t("lc.doc.removed")}</Badge>
                ) : null,
            },
            {
              key: "act",
              label: "",
              align: "right",
              render: (d) => (
                <span className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    className="min-h-8 px-2 py-1 text-sm"
                    onClick={() =>
                      action.run(async () =>
                        saveDownload(
                          await api.file(
                            `/employees/${id}/documents/${d.id}/file`,
                          ),
                          d.fileName,
                        ),
                      )
                    }
                  >
                    {t("p.download")}
                  </Button>
                  {manage && d.status === "active" && (
                    <Button
                      variant="ghost"
                      className="min-h-8 px-2 py-1 text-sm text-red-700"
                      onClick={() => setRemoving(d)}
                    >
                      {t("lc.doc.remove")}
                    </Button>
                  )}
                </span>
              ),
            },
          ]}
        />
      )}
      {adding && (
        <AddDocument
          id={id}
          onClose={() => setAdding(false)}
          onDone={() => (setAdding(false), docs.reload())}
        />
      )}
      {removing && (
        <RemoveDocument
          id={id}
          doc={removing}
          onClose={() => setRemoving(null)}
          onDone={() => (setRemoving(null), docs.reload())}
        />
      )}
    </Panel>
  );
}

function AddDocument({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({ docType: "nid", title: "", expiresOn: "" });
  const [file, setFile] = useState<File | null>(null);
  return (
    <Modal title={t("lc.doc.add")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) return;
          const form = new FormData();
          form.append("file", file);
          form.append("docType", f.docType);
          if (f.title) form.append("title", f.title);
          if (f.expiresOn) form.append("expiresOn", f.expiresOn);
          if (
            await save.run(() => api.upload(`/employees/${id}/documents`, form))
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("lc.doc.type")}>
            <Select
              value={f.docType}
              onChange={(e) => setF({ ...f, docType: e.target.value })}
              id="doc-type"
            >
              {DOC_TYPES.map((d) => (
                <option key={d} value={d}>
                  {t(`lc.doc.type.${d}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("lc.doc.expires")}>
            <Input
              type="date"
              value={f.expiresOn}
              onChange={(e) => setF({ ...f, expiresOn: e.target.value })}
              id="doc-expires"
            />
          </Field>
        </div>
        <Field label={t("lc.doc.titleField")}>
          <Input
            maxLength={200}
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            id="doc-title"
          />
        </Field>
        <Field label={t("lc.doc.file")}>
          <input
            type="file"
            required
            accept="image/jpeg,image/png,application/pdf"
            id="doc-file"
            aria-label={t("lc.doc.file")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function RemoveDocument({
  id,
  doc,
  onClose,
  onDone,
}: {
  id: string;
  doc: EmployeeDocument;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={`${t("lc.doc.remove")}: ${doc.title ?? doc.fileName}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/employees/${id}/documents/${doc.id}/remove`, {
                reason,
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("p.reason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="doc-remove-reason"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("lc.doc.remove")}
        />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ job changes

interface JobEvent {
  id: string;
  type: string;
  effectiveFrom: string;
  reason: string | null;
  status: "active" | "cancelled";
  cancelledReason: string | null;
  recordedAt: string;
}

export function JobChanges({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const events = useApi<JobEvent[]>(`/employees/${id}/job-events`);
  const [cancelling, setCancelling] = useState<JobEvent | null>(null);
  return (
    <Panel title={t("lc.job.changes")}>
      {events.error ? (
        <ErrorBox error={events.error} />
      ) : (
        <Table
          rows={events.data ? [...events.data].reverse() : undefined}
          rowKey={(e) => e.id}
          columns={[
            {
              key: "from",
              label: t("p.emp.job.effective"),
              render: (e) => formatDate(e.effectiveFrom, lang, { short: true }),
            },
            {
              key: "type",
              label: t("p.emp.job.type"),
              render: (e) =>
                e.type === "joining"
                  ? t("p.emp.joined")
                  : t(`p.emp.job.type.${e.type}`),
            },
            {
              key: "reason",
              label: t("p.reason"),
              render: (e) => (
                <span className="text-sm">
                  {e.status === "cancelled" ? e.cancelledReason : e.reason}
                </span>
              ),
            },
            {
              key: "status",
              label: "",
              render: (e) =>
                e.status === "cancelled" ? (
                  <Badge color="gray">{t("lc.job.cancelled")}</Badge>
                ) : null,
            },
            {
              key: "act",
              label: "",
              align: "right",
              render: (e) =>
                can("employee.manage") &&
                e.status === "active" &&
                e.type !== "joining" ? (
                  <Button
                    variant="ghost"
                    className="min-h-8 px-2 py-1 text-sm text-red-700"
                    onClick={() => setCancelling(e)}
                  >
                    {t("lc.job.cancel")}
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      {cancelling && (
        <CancelJobEvent
          employeeId={id}
          event={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => (setCancelling(null), events.reload(), onChanged())}
        />
      )}
    </Panel>
  );
}

function CancelJobEvent({
  employeeId,
  event,
  onClose,
  onDone,
}: {
  employeeId: string;
  event: JobEvent;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal title={t("lc.job.cancel")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(
                `/employees/${employeeId}/job-events/${event.id}/cancel`,
                { reason },
              ),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <p className="mb-3 text-sm text-slate-600">{t("lc.job.cancelHint")}</p>
        <Field label={t("p.reason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="job-cancel-reason"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("lc.job.cancel")}
        />
      </form>
    </Modal>
  );
}
