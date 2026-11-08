"use client";
/**
 * One employee's leave in the portal: their requests (with the approver's comment),
 * applying on their behalf (HR, e.g. while they are in hospital, with the certificate),
 * and the leave ledger with HR adjustments (opening balance, corrections).
 */
import { useState, type FormEvent } from "react";
import { LeaveStateBadge } from "@/components/status";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
  TextArea,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dhakaToday, formatDate, formatDays, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { LeaveRequest, LeaveType } from "@/lib/types";
import {
  ActionMessage,
  FormButtons,
  Modal,
  Panel,
  Table,
  useAction,
} from "./kit";
import { usePortal } from "./portal-context";

interface LedgerRow {
  id: string;
  leave_type_id: string;
  code: string;
  entry_date: string;
  kind: string;
  days: number;
  leave_year: string;
  note: string | null;
  balanceAfter: number;
}

export function EmployeeLeave({
  id,
  companyId,
}: {
  id: string;
  companyId: string;
}) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const manage = can("leave.manage");
  const requests = useApi<LeaveRequest[]>(`/employees/${id}/leave-requests`);
  const types = useApi<LeaveType[]>(`/companies/${companyId}/leave-types`);
  const [typeFilter, setTypeFilter] = useState("");
  const ledger = useApi<LedgerRow[]>(
    `/employees/${id}/leave-ledger${typeFilter ? `?leaveTypeId=${typeFilter}` : ""}`,
  );
  const [applying, setApplying] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      {notice && (
        <p className="mb-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      <Panel
        title={t("lv.emp.requests")}
        actions={
          manage && (
            <Button variant="secondary" onClick={() => setApplying(true)}>
              {t("lv.emp.applyFor")}
            </Button>
          )
        }
      >
        {requests.error ? (
          <ErrorBox error={requests.error} />
        ) : !requests.data ? (
          <Loading />
        ) : (
          <Table
            rows={requests.data}
            rowKey={(r) => r.id}
            columns={[
              {
                key: "type",
                label: t("p.code"),
                className: "font-mono",
                render: (r) => r.leaveType.code,
              },
              {
                key: "dates",
                label: t("p.date"),
                render: (r) =>
                  r.from === r.to
                    ? formatDate(r.from, lang, { short: true })
                    : `${formatDate(r.from, lang, { short: true })} – ${formatDate(r.to, lang, { short: true })}`,
              },
              {
                key: "days",
                label: t("lv.ye.days"),
                align: "right",
                render: (r) => formatDays(r.days, lang),
              },
              {
                key: "reason",
                label: t("p.reason"),
                render: (r) => (
                  <span className="line-clamp-2">{r.reason ?? ""}</span>
                ),
              },
              {
                key: "state",
                label: t("p.status"),
                render: (r) => <LeaveStateBadge state={r.state} />,
              },
              {
                key: "comment",
                label: "",
                render: (r) =>
                  r.decisionComment ? (
                    <span className="text-xs text-slate-600">
                      “{r.decisionComment}”
                    </span>
                  ) : null,
              },
              {
                key: "act",
                label: "",
                align: "right",
                // only HR may cancel leave that has already started (the API enforces it):
                // the person came back early, or was called back, and the days must go back
                render: (r) =>
                  manage &&
                  (r.state === "pending" || r.state === "approved") ? (
                    <Button
                      variant="ghost"
                      className="min-h-8 px-2 py-1 text-sm"
                      onClick={() => setCancelling(r)}
                    >
                      {t("p.cancel")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Panel>
      <Panel
        title={t("lv.emp.ledger")}
        actions={
          <>
            <Select
              aria-label={t("p.emp.leave.type")}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              id="ledger-type"
            >
              <option value="">{t("p.all")}</option>
              {types.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.code}
                </option>
              ))}
            </Select>
            {manage && (
              <Button variant="secondary" onClick={() => setAdjusting(true)}>
                {t("lv.emp.adjust")}
              </Button>
            )}
          </>
        }
      >
        {ledger.error ? (
          <ErrorBox error={ledger.error} />
        ) : (
          <Table
            rows={ledger.data ? [...ledger.data].reverse() : undefined}
            rowKey={(r) => r.id}
            columns={[
              {
                key: "date",
                label: t("lv.emp.entryDate"),
                render: (r) => formatDate(r.entry_date, lang, { short: true }),
              },
              {
                key: "type",
                label: t("p.code"),
                className: "font-mono",
                render: (r) => r.code,
              },
              {
                key: "kind",
                label: "",
                render: (r) => (
                  <Badge color={r.days < 0 ? "amber" : "green"}>
                    {t(`lv.emp.entry.${r.kind}`)}
                  </Badge>
                ),
              },
              {
                key: "days",
                label: t("lv.ye.days"),
                align: "right",
                render: (r) => `${r.days > 0 ? "+" : ""}${num(r.days, lang)}`,
              },
              {
                key: "balance",
                label: t("lv.emp.balanceAfter"),
                align: "right",
                render: (r) => formatDays(r.balanceAfter, lang),
              },
              {
                key: "note",
                label: t("lv.emp.note"),
                render: (r) => (
                  <span className="text-xs text-slate-600">{r.note ?? ""}</span>
                ),
              },
            ]}
          />
        )}
      </Panel>
      {applying && (
        <ApplyFor
          employeeId={id}
          types={(types.data ?? []).filter((x) => x.isActive)}
          onClose={() => setApplying(false)}
          onDone={() => (
            setApplying(false),
            setNotice(t("lv.emp.applied")),
            requests.reload()
          )}
        />
      )}
      {cancelling && (
        <CancelLeave
          request={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => (
            setCancelling(null),
            setNotice(t("lv.emp.cancelled")),
            requests.reload(),
            ledger.reload()
          )}
        />
      )}
      {adjusting && (
        <Adjust
          employeeId={id}
          types={(types.data ?? []).filter((x) => x.isActive)}
          onClose={() => setAdjusting(false)}
          onDone={() => (
            setAdjusting(false),
            setNotice(t("lv.emp.saved")),
            ledger.reload()
          )}
        />
      )}
    </>
  );
}

/**
 * Cancelling leave. Only HR may cancel leave that has already started — the person
 * came back early, or was called back — and the days taken are written back onto
 * the balance as a reversal, so the ledger still shows what happened.
 */
function CancelLeave({
  request,
  onClose,
  onDone,
}: {
  request: LeaveRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal title={t("lv.emp.cancel")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/leave/requests/${request.id}/cancel`, { reason }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <p className="mb-3 text-sm text-slate-700">
          {request.leaveType.code} ·{" "}
          {formatDate(request.from, lang, { short: true })} –{" "}
          {formatDate(request.to, lang, { short: true })} ·{" "}
          {formatDays(request.days, lang)}
        </p>
        <p className="mb-3 text-sm text-slate-600">{t("lv.emp.cancelHint")}</p>
        <Field label={t("lv.emp.cancelReason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="cancel-reason"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("lv.emp.cancel")}
        />
      </form>
    </Modal>
  );
}

function ApplyFor({
  employeeId,
  types,
  onClose,
  onDone,
}: {
  employeeId: string;
  types: LeaveType[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    leaveTypeId: "",
    fromDate: dhakaToday(),
    toDate: dhakaToday(),
    reason: "",
  });
  const [documentId, setDocumentId] = useState<string | null>(null);
  const type = types.find((x) => x.id === f.leaveTypeId);

  async function upload(file: File) {
    const form = new FormData();
    form.append("file", file);
    const doc = await save.run(
      () =>
        api.upload<{ id: string }>(
          `/employees/${employeeId}/leave-documents`,
          form,
        ),
      t("leave.documentAdded"),
    );
    if (doc && typeof doc === "object") setDocumentId(doc.id);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      ...f,
      ...(f.reason ? {} : { reason: undefined }),
      ...(documentId ? { documentId } : {}),
    };
    if (
      await save.run(() =>
        api.post(`/employees/${employeeId}/leave-requests`, body),
      )
    )
      onDone();
  }

  return (
    <Modal title={t("lv.emp.applyFor")} open onClose={onClose}>
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <Field label={t("leave.type")}>
          <Select
            required
            value={f.leaveTypeId}
            onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}
            id="for-type"
          >
            <option value="">—</option>
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} · {lang === "bn" && x.nameBn ? x.nameBn : x.nameEn}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("leave.from")}>
            <Input
              type="date"
              required
              value={f.fromDate}
              onChange={(e) =>
                setF({
                  ...f,
                  fromDate: e.target.value,
                  toDate: e.target.value > f.toDate ? e.target.value : f.toDate,
                })
              }
              id="for-from"
            />
          </Field>
          <Field label={t("leave.to")}>
            <Input
              type="date"
              required
              min={f.fromDate}
              value={f.toDate}
              onChange={(e) => setF({ ...f, toDate: e.target.value })}
              id="for-to"
            />
          </Field>
        </div>
        <Field label={t("leave.reason")}>
          <TextArea
            maxLength={500}
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
            id="for-reason"
          />
        </Field>
        {type?.documentRequiredOverDays !== null &&
          type?.documentRequiredOverDays !== undefined && (
            <Field
              label={t("leave.document")}
              hint={t("leave.documentHint", {
                n: num(type.documentRequiredOverDays, lang),
              })}
            >
              <input
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                id="for-document"
                aria-label={t("leave.document")}
                onChange={(e) =>
                  e.target.files?.[0] && upload(e.target.files[0])
                }
              />
              {documentId && (
                <span className="ml-2 text-sm text-emerald-700">✓</span>
              )}
            </Field>
          )}
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("common.submit")}
        />
      </form>
    </Modal>
  );
}

function Adjust({
  employeeId,
  types,
  onClose,
  onDone,
}: {
  employeeId: string;
  types: LeaveType[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    leaveTypeId: "",
    kind: "adjustment",
    days: "",
    entryDate: dhakaToday(),
    note: "",
  });
  return (
    <Modal title={t("lv.emp.adjust")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/employees/${employeeId}/leave-ledger`, {
                ...f,
                days: Number(f.days),
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("leave.type")}>
          <Select
            required
            value={f.leaveTypeId}
            onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}
            id="adj-type"
          >
            <option value="">—</option>
            {types.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} · {x.nameEn}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("p.run.type")}>
            <Select
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value })}
              id="adj-kind"
            >
              <option value="adjustment">{t("lv.emp.kind.adjustment")}</option>
              <option value="opening">{t("lv.emp.kind.opening")}</option>
            </Select>
          </Field>
          <Field label={t("lv.ye.days")} hint={t("lv.emp.daysHint")}>
            <Input
              required
              inputMode="decimal"
              pattern="-?[0-9]+(\.[05])?"
              value={f.days}
              onChange={(e) => setF({ ...f, days: e.target.value })}
              id="adj-days"
            />
          </Field>
          <Field label={t("lv.emp.entryDate")}>
            <Input
              type="date"
              required
              value={f.entryDate}
              onChange={(e) => setF({ ...f, entryDate: e.target.value })}
              id="adj-date"
            />
          </Field>
        </div>
        <Field label={t("lv.emp.note")}>
          <Input
            required
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="adj-note"
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}
