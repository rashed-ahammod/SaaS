"use client";
/**
 * Commission (Phase 3 WP31): the scheme, each month as it was calculated from the source
 * documents, and posting a month into payroll. A salesperson sees their own months instead.
 */
import { useState } from "react";
import {
  ActionMessage,
  Detail,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Select,
  TextArea,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import {
  COMMISSION_BASES,
  RUN_STATE_COLOR,
  type CommissionRule,
  type CommissionRun,
  type CommissionRunRow,
  type MyCommission,
} from "@/lib/commission-types";
import { formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function CommissionPage() {
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  const act = useAction();
  const calc = useAction();
  const [period, setPeriod] = useState("");
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const mayManage = can("commission.manage");
  const maySee = can("commission.view", "commission.manage");

  const scheme = useApi<{ rules: CommissionRule[] }>(
    company && maySee ? `/companies/${company.id}/commission-scheme` : null,
  );
  const runs = useApi<{ runs: CommissionRunRow[] }>(
    company && maySee ? `/companies/${company.id}/commission-runs` : null,
  );
  const run = useApi<CommissionRun>(openRun ? `/commission-runs/${openRun}` : null);
  const mine = useApi<MyCommission>(
    company && !maySee ? `/companies/${company.id}/my-commission` : null,
  );
  if (!company) return null;
  const taka = (v: string) => formatTaka(v, lang);
  const active = scheme.data?.rules.find((r) => r.isActive);

  // a salesperson's own months
  if (!maySee)
    return (
      <div>
        <PageHeader
          title={t("cm.myCommission")}
          subtitle={t("cm.myCommissionHint")}
        />
        <Panel>
          {mine.error ? (
            <ErrorBox error={mine.error} onRetry={mine.reload} />
          ) : (
            <Table
              rows={mine.data?.months}
              rowKey={(m) => m.id}
              empty={t("st.none")}
              columns={[
                { key: "period", label: t("cm.period"), render: (m) => m.period },
                {
                  key: "basis",
                  label: t("cm.basisAmount"),
                  align: "right",
                  render: (m) => taka(m.basisAmount),
                },
                {
                  key: "target",
                  label: t("cm.target"),
                  align: "right",
                  render: (m) => (m.targetAmount ? taka(m.targetAmount) : "—"),
                },
                {
                  key: "attainment",
                  label: t("cm.attainment"),
                  align: "right",
                  render: (m) => (m.attainment ? `${m.attainment}%` : "—"),
                },
                {
                  key: "rate",
                  label: t("cm.rate"),
                  align: "right",
                  render: (m) => `${Number(m.ratePercent)}%`,
                },
                {
                  key: "amount",
                  label: t("cm.amount"),
                  align: "right",
                  render: (m) => taka(m.amount),
                },
                {
                  key: "paid",
                  label: t("cm.paid"),
                  render: (m) =>
                    m.paidThroughPayroll ? (
                      <Badge color="green">{t("cm.paid")}</Badge>
                    ) : (
                      <Badge color="amber">{t("cm.state.calculated")}</Badge>
                    ),
                },
              ]}
            />
          )}
        </Panel>
      </div>
    );

  return (
    <div>
      <PageHeader title={t("cm.scheme")} subtitle={company.legalName} />
      <ActionMessage action={act} />

      <Panel title={t("cm.scheme")}>
        <p className="mb-3 text-xs text-slate-500">
          {t("cm.schemePlaceholder")}
        </p>
        {active ? (
          <dl className="grid gap-3 sm:grid-cols-3">
            <Detail label={t("cm.code")}>
              <span className="font-mono">{active.code}</span>{" "}
              <Badge color="green">{t("cm.active")}</Badge>
            </Detail>
            <Detail label={t("cm.name")}>{active.name}</Detail>
            <Detail label={t("cm.basis")}>
              {t(`cm.basis.${active.basis}`)}
            </Detail>
            <Detail label={t("cm.ratePercent")}>
              {Number(active.ratePercent)}%
            </Detail>
            <Detail label={t("cm.minAttainment")}>
              {Number(active.minAttainment)}%
            </Detail>
            <Detail label={t("cm.bonusAttainment")}>
              {active.bonusAttainment
                ? `${Number(active.bonusAttainment)}% → ${Number(active.bonusRatePercent)}%`
                : "—"}
            </Detail>
            {active.note && (
              <div className="sm:col-span-3">
                <Detail label={t("cm.note")}>{active.note}</Detail>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">{t("cm.noScheme")}</p>
        )}
        {mayManage && (
          <SchemeForm
            companyId={company.id}
            onDone={() => {
              scheme.reload();
            }}
          />
        )}
      </Panel>

      <Panel
        title={t("cm.runs")}
        actions={
          mayManage && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const created = await calc.run<{ id: string }>(() =>
                  api.post<{ id: string }>(
                    `/companies/${company.id}/commission-runs`,
                    { period },
                  ),
                );
                if (created && typeof created === "object") {
                  setOpenRun(created.id);
                  runs.reload();
                }
              }}
            >
              <Field label={t("cm.period")}>
                <Input
                  required
                  id="commission-period"
                  placeholder="2026-10"
                  pattern="\d{4}-(0[1-9]|1[0-2])"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </Field>
              <Button type="submit" className="mb-3" busy={calc.busy}>
                {t("cm.newRun")}
              </Button>
            </form>
          )
        }
      >
        <ActionMessage action={calc} />
        {runs.error ? (
          <ErrorBox error={runs.error} onRetry={runs.reload} />
        ) : (
          <Table
            rows={runs.data?.runs}
            rowKey={(r) => r.id}
            empty={t("st.none")}
            onRowClick={(r) => setOpenRun(r.id)}
            columns={[
              { key: "period", label: t("cm.period"), render: (r) => r.period },
              {
                key: "state",
                label: t("cm.state"),
                render: (r) => (
                  <Badge color={RUN_STATE_COLOR[r.state]}>
                    {t(`cm.state.${r.state}`)}
                  </Badge>
                ),
              },
              {
                key: "total",
                label: t("cm.total"),
                align: "right",
                render: (r) => taka(r.total),
              },
              {
                key: "posted",
                label: t("cm.post"),
                render: (r) => (r.postedAt ? r.postedAt.slice(0, 10) : "—"),
              },
            ]}
          />
        )}
      </Panel>

      {run.data && (
        <Panel title={`${t("cm.lines")} · ${run.data.period}`}>
          <p className="mb-3 text-xs text-slate-500">{t("cm.postHint")}</p>
          <Table
            rows={run.data.lines}
            rowKey={(l) => l.id}
            empty={t("cm.noLines")}
            columns={[
              {
                key: "person",
                label: t("cm.person"),
                render: (l) => (
                  <span>
                    {l.name}
                    {l.employeeCode && (
                      <span className="block font-mono text-xs text-slate-500">
                        {l.employeeCode}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: "basis",
                label: t("cm.basisAmount"),
                align: "right",
                render: (l) => taka(l.basisAmount),
              },
              {
                key: "target",
                label: t("cm.target"),
                align: "right",
                render: (l) => (l.targetAmount ? taka(l.targetAmount) : "—"),
              },
              {
                key: "attainment",
                label: t("cm.attainment"),
                align: "right",
                render: (l) => (l.attainment ? `${l.attainment}%` : "—"),
              },
              {
                key: "rate",
                label: t("cm.rate"),
                align: "right",
                render: (l) => `${Number(l.ratePercent)}%`,
              },
              {
                key: "amount",
                label: t("cm.amount"),
                align: "right",
                render: (l) => taka(l.amount),
              },
              {
                key: "sources",
                label: t("cm.sources"),
                render: (l) => (
                  <span className="text-xs text-slate-500">
                    {l.detail.receipts?.length
                      ? `${t("cm.receipts")}: ${l.detail.receipts.length}`
                      : l.detail.invoices?.length
                        ? `${t("cm.invoices")}: ${l.detail.invoices.length}`
                        : "—"}
                    {l.detail.creditNotes?.length
                      ? ` · ${t("cm.creditNotes")}: ${l.detail.creditNotes.length}`
                      : ""}
                  </span>
                ),
              },
              {
                key: "paid",
                label: t("cm.paid"),
                render: (l) =>
                  l.payrollVariableId ? (
                    <Badge color="green">{t("cm.paid")}</Badge>
                  ) : (
                    "—"
                  ),
              },
            ]}
          />
          {mayManage && run.data.state === "calculated" && (
            <div className="mt-3">
              <Button
                busy={act.busy}
                onClick={() =>
                  act
                    .run(
                      () => api.post(`/commission-runs/${run.data!.id}/post`),
                      t("cm.saved"),
                    )
                    .then(() => (run.reload(), runs.reload()))
                }
              >
                {t("cm.post")}
              </Button>
            </div>
          )}
          {mayManage && run.data.state !== "cancelled" && (
            <form
              className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
              onSubmit={async (e) => {
                e.preventDefault();
                const done = await act.run(
                  () =>
                    api.post(`/commission-runs/${run.data!.id}/cancel`, {
                      reason: cancelReason,
                    }),
                  t("cm.saved"),
                );
                if (done) {
                  setCancelReason("");
                  run.reload();
                  runs.reload();
                }
              }}
            >
              <Field label={t("cm.cancelReason")} hint={t("cm.cancelHint")}>
                <Input
                  required
                  id="commission-cancel-reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </Field>
              <Button type="submit" variant="ghost" className="mb-3">
                {t("cm.cancel")}
              </Button>
            </form>
          )}
        </Panel>
      )}
    </div>
  );
}

function SchemeForm({
  companyId,
  onDone,
}: {
  companyId: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    code: "",
    name: "",
    basis: "collected",
    ratePercent: "",
    minAttainment: "0",
    bonusAttainment: "",
    bonusRatePercent: "",
    note: "",
  });
  return (
    <form
      className="mt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const done = await save.run(
          () =>
            api.put(`/companies/${companyId}/commission-scheme`, {
              code: f.code,
              name: f.name,
              basis: f.basis,
              ratePercent: f.ratePercent,
              minAttainment: f.minAttainment || "0",
              ...(f.bonusAttainment
                ? { bonusAttainment: f.bonusAttainment }
                : {}),
              ...(f.bonusRatePercent
                ? { bonusRatePercent: f.bonusRatePercent }
                : {}),
              ...(f.note ? { note: f.note } : {}),
            }),
          t("cm.saved"),
        );
        if (done) onDone();
      }}
    >
      <ActionMessage action={save} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("cm.code")}>
          <Input
            required
            id="scheme-code"
            placeholder="SALES-2026"
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label={t("cm.name")}>
          <Input
            required
            id="scheme-name"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <Field label={t("cm.basis")} hint={t("cm.basisHint")}>
          <Select
            id="scheme-basis"
            value={f.basis}
            onChange={(e) => setF({ ...f, basis: e.target.value })}
          >
            {COMMISSION_BASES.map((b) => (
              <option key={b} value={b}>
                {t(`cm.basis.${b}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("cm.ratePercent")}>
          <Input
            required
            id="scheme-rate"
            inputMode="decimal"
            value={f.ratePercent}
            onChange={(e) => setF({ ...f, ratePercent: e.target.value })}
          />
        </Field>
        <Field label={t("cm.minAttainment")}>
          <Input
            id="scheme-min"
            inputMode="decimal"
            value={f.minAttainment}
            onChange={(e) => setF({ ...f, minAttainment: e.target.value })}
          />
        </Field>
        <Field label={t("cm.bonusAttainment")}>
          <Input
            id="scheme-bonus-at"
            inputMode="decimal"
            value={f.bonusAttainment}
            onChange={(e) => setF({ ...f, bonusAttainment: e.target.value })}
          />
        </Field>
        <Field label={t("cm.bonusRatePercent")}>
          <Input
            id="scheme-bonus-rate"
            inputMode="decimal"
            value={f.bonusRatePercent}
            onChange={(e) => setF({ ...f, bonusRatePercent: e.target.value })}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t("cm.note")}>
            <TextArea
              rows={2}
              id="scheme-note"
              value={f.note}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <Button type="submit" busy={save.busy}>
        {t("cm.setScheme")}
      </Button>
    </form>
  );
}
