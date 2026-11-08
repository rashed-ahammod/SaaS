"use client";
/**
 * One payroll run: totals, then by state: calculate / recalculate, clear flags
 * (with an optional AI explanation), submit for approval, payments and bank
 * files once approved, salary journal, reproducibility check, and the link to
 * the Gate 1 comparison.
 */
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { RUN_STATE_COLOR } from "@/components/portal/labels";
import {
  ActionMessage,
  Detail,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Stat,
  Table,
  Tabs,
  useAction,
} from "@/components/portal/kit";
import { RunPayments } from "@/components/portal/run-payments";
import { usePortal } from "@/components/portal/portal-context";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  ErrorBox,
  Field,
  Input,
  Loading,
} from "@/components/ui";
import { api, saveDownload, useApi, type ApiError } from "@/lib/api";
import { formatMonth, formatTaka, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { RunDetail, RunFlag } from "@/lib/portal-types";
import type { AiStatus } from "@/lib/types";

type Tab = "flags" | "employees" | "payments";

export default function RunPage({
  params,
}: PageProps<"/portal/payroll/runs/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const run = useApi<RunDetail>(`/payroll-runs/${id}`);
  const action = useAction();
  const [tab, setTab] = useState<Tab>("flags");
  const [cancelling, setCancelling] = useState(false);

  if (run.loading && !run.data) return <Loading />;
  if (run.error) return <ErrorBox error={run.error} onRetry={run.reload} />;
  const r = run.data!;
  const prepare = can("payroll.prepare");
  const editable = r.state === "draft" || r.state === "calculated";
  const paid = r.state === "approved" || r.state === "disbursed";

  const reproduce = () =>
    action.run(async () => {
      const res = await api.get<{ identical: boolean; differences: unknown[] }>(
        `/payroll-runs/${id}/reproduce`,
      );
      if (!res.identical)
        throw new Error(
          t("p.run.reproduceDiff", { n: num(res.differences.length, lang) }),
        );
    }, t("p.run.reproduceOk"));

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {formatMonth(r.period, lang)} · {t(`p.run.type.${r.runType}`)}
            {r.bonusName && ` · ${r.bonusName}`}
            <Badge color={RUN_STATE_COLOR[r.state]}>
              {t(`p.run.state.${r.state}`)}
            </Badge>
          </span>
        }
        actions={
          <>
            {prepare && editable && (
              <Button
                busy={action.busy}
                onClick={() =>
                  action
                    .run(
                      () => api.post(`/payroll-runs/${id}/calculate`),
                      t("p.run.calculated"),
                    )
                    .then(run.reload)
                }
              >
                {r.state === "draft"
                  ? t("p.run.calculate")
                  : t("p.run.recalculate")}
              </Button>
            )}
            {prepare && r.state === "calculated" && (
              <Button
                variant="secondary"
                disabled={r.openFlags > 0}
                busy={action.busy}
                onClick={() =>
                  action
                    .run(
                      () => api.post(`/payroll-runs/${id}/submit`),
                      t("p.run.submitted"),
                    )
                    .then(run.reload)
                }
              >
                {t("p.run.submit")}
              </Button>
            )}
            {r.approvalRequestId &&
              (r.state === "in_approval" || r.state === "verified") && (
                <ButtonLink
                  href={`/portal/approvals/${r.approvalRequestId}`}
                  variant="secondary"
                >
                  {t("p.run.openApproval")}
                </ButtonLink>
              )}
            {r.state !== "draft" && r.state !== "cancelled" && (
              <Button variant="ghost" busy={action.busy} onClick={reproduce}>
                {t("p.run.reproduce")}
              </Button>
            )}
            {paid && (
              <Button
                variant="ghost"
                onClick={() =>
                  action.run(async () =>
                    saveDownload(
                      await api.file(`/payroll-runs/${id}/journal.csv`),
                      `salary-journal-${r.period}.csv`,
                    ),
                  )
                }
              >
                {t("p.run.journal")}
              </Button>
            )}
            {r.runType === "regular" &&
              r.state !== "draft" &&
              r.state !== "cancelled" &&
              prepare && (
                <ButtonLink href={`/portal/gate-1?runId=${id}`} variant="ghost">
                  {t("p.pay.uploadRegister")}
                </ButtonLink>
              )}
            {prepare && editable && (
              <Button variant="danger" onClick={() => setCancelling(true)}>
                {t("p.run.cancel")}
              </Button>
            )}
          </>
        }
      />
      <ActionMessage action={action} />
      {r.state === "calculated" && r.openFlags > 0 && (
        <Alert kind="warning">{t("p.run.flagsFirst")}</Alert>
      )}
      {r.cancelledReason && <Alert kind="info">{r.cancelledReason}</Alert>}
      <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t("p.run.headcount")} value={num(r.headcount, lang)} />
        <Stat
          label={t("p.run.gross")}
          value={formatTaka(r.totals.gross, lang)}
        />
        <Stat
          label={t("p.run.deductions")}
          value={formatTaka(r.totals.deductions, lang)}
        />
        <Stat label={t("p.run.net")} value={formatTaka(r.totals.net, lang)} />
        <Stat label={t("p.run.tax")} value={formatTaka(r.totals.tax, lang)} />
        <Stat
          label={t("p.run.flag")}
          value={num(r.openFlags, lang)}
          tone={r.openFlags ? "warn" : "good"}
        />
      </div>
      <Tabs
        tabs={[
          {
            key: "flags" as Tab,
            label: `${t("p.run.tab.flags")} (${num(r.flags.length, lang)})`,
          },
          { key: "employees" as Tab, label: t("p.run.tab.employees") },
          ...(paid
            ? [{ key: "payments" as Tab, label: t("p.run.tab.payments") }]
            : []),
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "flags" && <Flags run={r} onChanged={run.reload} />}
      {tab === "employees" && <Employees run={r} />}
      {tab === "payments" && paid && <RunPayments runId={id} />}
      {cancelling && (
        <CancelRun
          runId={id}
          onClose={() => setCancelling(false)}
          onDone={run.reload}
        />
      )}
    </div>
  );
}

function Flags({ run, onChanged }: { run: RunDetail; onChanged: () => void }) {
  const { t } = useI18n();
  const { can } = usePortal();
  const ai = useApi<AiStatus>("/ai/status");
  const [clearing, setClearing] = useState<RunFlag | null>(null);
  const [explaining, setExplaining] = useState<RunFlag | null>(null);
  const canClear = can("payroll.prepare") && run.state === "calculated";
  return (
    <Panel>
      <Table
        rows={run.flags}
        rowKey={(f) => f.id}
        empty={t("p.run.noFlags")}
        columns={[
          {
            key: "employeeCode",
            label: t("p.employee"),
            className: "font-mono whitespace-nowrap",
          },
          {
            key: "code",
            label: t("p.run.flag"),
            render: (f) => <span className="font-mono text-xs">{f.code}</span>,
          },
          {
            key: "message",
            label: "",
            render: (f) => f.message ?? t("p.hidden"),
          },
          {
            key: "status",
            label: t("p.status"),
            render: (f) =>
              f.cleared ? (
                <Badge color="green">{t("p.run.cleared")}</Badge>
              ) : (
                <Badge color="amber">!</Badge>
              ),
          },
          {
            key: "reason",
            label: t("p.reason"),
            render: (f) => f.clearReason ?? "",
          },
          {
            key: "act",
            label: "",
            align: "right",
            render: (f) => (
              <span className="flex justify-end gap-1">
                {ai.data?.payrollFlagExplanations.available && (
                  <Button
                    variant="ghost"
                    className="min-h-8 px-2 py-1 text-sm"
                    onClick={() => setExplaining(f)}
                  >
                    {t("p.run.explain")}
                  </Button>
                )}
                {canClear && !f.cleared && (
                  <Button
                    variant="secondary"
                    className="min-h-8 px-2 py-1 text-sm"
                    onClick={() => setClearing(f)}
                  >
                    {t("p.run.clear")}
                  </Button>
                )}
              </span>
            ),
          },
        ]}
      />
      {clearing && (
        <ClearFlag
          flag={clearing}
          onClose={() => setClearing(null)}
          onDone={onChanged}
        />
      )}
      {explaining && (
        <ExplainFlag flag={explaining} onClose={() => setExplaining(null)} />
      )}
    </Panel>
  );
}

function ClearFlag({
  flag,
  onClose,
  onDone,
}: {
  flag: RunFlag;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={`${t("p.run.clear")}: ${flag.employeeCode} · ${flag.code}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/payroll-flags/${flag.id}/clear`, { reason }),
            )
          ) {
            onClose();
            onDone();
          }
        }}
      >
        <ActionMessage action={save} />
        {flag.message && (
          <p className="mb-3 text-sm text-slate-600">{flag.message}</p>
        )}
        <Field label={t("p.run.clearReason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("p.run.clear")}
        />
      </form>
    </Modal>
  );
}

function ExplainFlag({
  flag,
  onClose,
}: {
  flag: RunFlag;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<{
    text?: string;
    error?: string;
    busy: boolean;
  }>({ busy: true });
  useEffect(() => {
    let alive = true;
    api
      .post<{ explanation: string }>(`/payroll-flags/${flag.id}/explanation`)
      .then((r) => alive && setState({ text: r.explanation, busy: false }))
      .catch(
        (e: ApiError) => alive && setState({ error: e.message, busy: false }),
      );
    return () => {
      alive = false;
    };
  }, [flag.id]);
  return (
    <Modal
      title={`${t("p.run.explainTitle")}: ${flag.code}`}
      open
      onClose={onClose}
    >
      {state.busy && <Loading />}
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.text && (
        <>
          <p className="whitespace-pre-line text-slate-800">{state.text}</p>
          <p className="mt-3 text-xs text-slate-500">
            {t("p.run.explainNote")}
          </p>
        </>
      )}
    </Modal>
  );
}

function Employees({ run }: { run: RunDetail }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  if (typeof run.employees === "string")
    return <Alert kind="info">{t("p.hidden")}</Alert>;
  return (
    <Panel>
      <Table
        rows={run.employees}
        rowKey={(e) => e.employeeId}
        onRowClick={(e) => setOpen(e.employeeId)}
        columns={[
          {
            key: "employeeCode",
            label: t("p.code"),
            className: "font-mono whitespace-nowrap",
          },
          { key: "fullNameEn", label: t("p.name") },
          {
            key: "gross",
            label: t("p.run.gross"),
            align: "right",
            render: (e) => formatTaka(e.gross, lang),
          },
          {
            key: "deductions",
            label: t("p.run.deductions"),
            align: "right",
            render: (e) => formatTaka(e.deductions, lang),
          },
          {
            key: "tax",
            label: t("p.run.tax"),
            align: "right",
            render: (e) => formatTaka(e.tax, lang),
          },
          {
            key: "net",
            label: t("p.run.net"),
            align: "right",
            render: (e) => <strong>{formatTaka(e.net, lang)}</strong>,
          },
        ]}
      />
      {open && (
        <EmployeeLines
          runId={run.id}
          employeeId={open}
          onClose={() => setOpen(null)}
        />
      )}
    </Panel>
  );
}

interface Slip {
  employee: { code: string; fullNameEn: string };
  earnings: Array<{
    head: string;
    amount: string;
    forPeriod?: string;
    explanation?: Record<string, unknown>;
  }>;
  deductions: Array<{
    head: string;
    amount: string;
    forPeriod?: string;
    explanation?: Record<string, unknown>;
  }>;
  employerContributions: Array<{
    head: string;
    amount: string;
    explanation?: Record<string, unknown>;
  }>;
  gross: string;
  totalDeductions: string;
  net: string;
  tax: { thisMonth: string };
}

function EmployeeLines({
  runId,
  employeeId,
  onClose,
}: {
  runId: string;
  employeeId: string;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const slip = useApi<Slip>(`/payroll-runs/${runId}/employees/${employeeId}`);
  const download = useAction();
  const section = (title: string, lines: Slip["earnings"]) =>
    lines.length > 0 && (
      <div className="mb-4">
        <p className="mb-1 text-sm font-semibold text-slate-600">{title}</p>
        <Table
          rows={lines}
          rowKey={(l) => `${l.head}-${l.forPeriod ?? ""}`}
          columns={[
            {
              key: "head",
              label: "",
              render: (l) => (
                <span className="font-mono text-xs">
                  {l.head}
                  {l.forPeriod ? ` (${l.forPeriod})` : ""}
                </span>
              ),
            },
            {
              key: "why",
              label: t("p.run.why"),
              render: (l) => (
                <span className="text-xs text-slate-500">
                  {l.explanation
                    ? Object.entries(l.explanation)
                        .map(
                          ([k, v]) =>
                            `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
                        )
                        .join(" · ")
                    : ""}
                </span>
              ),
            },
            {
              key: "amount",
              label: t("p.amount"),
              align: "right",
              render: (l) => formatTaka(l.amount, lang),
            },
          ]}
        />
      </div>
    );
  return (
    <Modal
      title={
        slip.data
          ? `${slip.data.employee.code} · ${slip.data.employee.fullNameEn}`
          : t("p.run.lines")
      }
      open
      onClose={onClose}
      wide
    >
      {!slip.data ? (
        slip.error ? (
          <ErrorBox error={slip.error} />
        ) : (
          <Loading />
        )
      ) : (
        <>
          {section(t("p.run.earnings"), slip.data.earnings)}
          {section(t("p.run.deductions"), slip.data.deductions)}
          {section(
            t("p.run.employerContributions"),
            slip.data.employerContributions,
          )}
          <dl className="mb-4 grid grid-cols-3 gap-3">
            <Detail label={t("p.run.gross")}>
              {formatTaka(slip.data.gross, lang)}
            </Detail>
            <Detail label={t("p.run.deductions")}>
              {formatTaka(slip.data.totalDeductions, lang)}
            </Detail>
            <Detail label={t("p.run.net")}>
              <strong>{formatTaka(slip.data.net, lang)}</strong>
            </Detail>
          </dl>
          <ActionMessage action={download} />
          <Button
            variant="secondary"
            onClick={() =>
              download.run(async () =>
                saveDownload(
                  await api.file(
                    `/payroll-runs/${runId}/employees/${employeeId}/payslip.pdf?lang=${lang}`,
                  ),
                  "payslip.pdf",
                ),
              )
            }
          >
            {t("p.run.payslip")}
          </Button>
          <Link
            href={`/portal/employees/${employeeId}`}
            className="ml-3 text-sm text-emerald-800 underline"
          >
            {t("p.employee")}
          </Link>
        </>
      )}
    </Modal>
  );
}

function CancelRun({
  runId,
  onClose,
  onDone,
}: {
  runId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal title={t("p.run.cancel")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/payroll-runs/${runId}/cancel`, { reason }),
            )
          ) {
            onClose();
            onDone();
          }
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("p.reason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("p.run.cancel")}
        />
      </form>
    </Modal>
  );
}
