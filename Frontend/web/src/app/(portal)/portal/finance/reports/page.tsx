"use client";
/** Trial balance, profit and loss (per department), balance sheet, general ledger of an account, aged payables; cash flow, department cost, aged receivables (WP22). */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { PageHeader, Panel, Table, Tabs } from "@/components/portal/kit";
import {
  CashFlowView,
  DepartmentCostView,
  ReceivablesAgingView,
} from "@/components/portal/close";
import { AccountSelect, Taka, useAccounts } from "@/components/portal/finance";
import { useOrg } from "@/components/portal/org";
import { usePortal } from "@/components/portal/portal-context";
import {
  Badge,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import type {
  Aging,
  BalanceSheet,
  GeneralLedger,
  ProfitAndLoss,
  ReportLine,
  TrialBalance,
} from "@/lib/finance-types";
import { dhakaToday, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Tab = "tb" | "pl" | "bs" | "gl" | "aging" | "cf" | "dept" | "ar";

export default function ReportsPage() {
  const { t } = useI18n();
  const { company, can } = usePortal();
  const [tab, setTab] = useState<Tab>("tb");
  const [to, setTo] = useState(dhakaToday());
  const [from, setFrom] = useState("");
  if (!company) return null;
  const c = `/companies/${company.id}`;
  const range = `to=${to}${from ? `&from=${from}` : ""}`;
  return (
    <div>
      <PageHeader title={t("f.r.title")} subtitle={company.legalName} />
      <Tabs<Tab>
        tabs={[
          { key: "tb", label: t("f.r.tb") },
          { key: "pl", label: t("f.r.pl") },
          { key: "bs", label: t("f.r.bs") },
          { key: "gl", label: t("f.r.gl") },
          ...(can("payables.view")
            ? [{ key: "aging" as const, label: t("f.r.aging") }]
            : []),
          { key: "cf", label: t("cl.r.cf") },
          { key: "dept", label: t("cl.r.dept") },
          ...(can("receivables.view")
            ? [{ key: "ar" as const, label: t("cl.r.ar") }]
            : []),
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="mb-4 flex flex-wrap gap-3">
        {(tab === "tb" ||
          tab === "pl" ||
          tab === "gl" ||
          tab === "cf" ||
          tab === "dept") && (
          <Field label={t("p.from")}>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              id="report-from"
            />
          </Field>
        )}
        <Field
          label={
            tab === "bs" || tab === "aging" || tab === "ar"
              ? t("f.r.asOf")
              : t("p.to")
          }
        >
          <Input
            type="date"
            required
            value={to}
            onChange={(e) => setTo(e.target.value)}
            id="report-to"
          />
        </Field>
      </div>
      {tab === "tb" && (
        <TrialBalanceView path={`${c}/trial-balance?${range}`} />
      )}
      {tab === "pl" && (
        <ProfitLossView
          companyId={company.id}
          base={`${c}/profit-and-loss?${range}`}
        />
      )}
      {tab === "bs" && (
        <BalanceSheetView path={`${c}/balance-sheet?asOf=${to}`} />
      )}
      {tab === "gl" && <LedgerView companyId={company.id} range={range} />}
      {tab === "aging" && <AgingView path={`${c}/payables/aging?asOf=${to}`} />}
      {tab === "cf" && (
        <CashFlowView
          path={`${c}/reports/cash-flow?from=${from || `${to.slice(0, 7)}-01`}&to=${to}`}
        />
      )}
      {tab === "dept" && (
        <DepartmentCostView
          path={`${c}/reports/department-cost?from=${from || `${to.slice(0, 7)}-01`}&to=${to}`}
        />
      )}
      {tab === "ar" && (
        <ReceivablesAgingView path={`${c}/receivables/aging?asOf=${to}`} />
      )}
    </div>
  );
}

function Balanced({ ok }: { ok: boolean }) {
  const { t } = useI18n();
  return (
    <Badge color={ok ? "green" : "red"}>
      {ok ? t("f.r.balancedYes") : t("f.r.balancedNo")}
    </Badge>
  );
}

function Loaded<T>({
  q,
  children,
}: {
  q: { data?: T; error?: Error; loading: boolean; reload: () => void };
  children: (data: T) => ReactNode;
}) {
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  return <>{q.data ? children(q.data) : null}</>;
}

function TrialBalanceView({ path }: { path: string }) {
  const { t } = useI18n();
  const tb = useApi<TrialBalance>(path);
  return (
    <Loaded q={tb}>
      {(d) => (
        <Panel
          title={
            <>
              {t("f.r.tb")} <Balanced ok={d.balanced} />
            </>
          }
        >
          <Table
            rows={[
              ...d.rows,
              {
                accountId: "total",
                code: "",
                name: t("p.total"),
                type: "asset",
                opening: "",
                debit: d.totals.debit,
                credit: d.totals.credit,
                closingDebit: d.totals.closingDebit,
                closingCredit: d.totals.closingCredit,
              },
            ]}
            rowKey={(r) => r.accountId}
            columns={[
              {
                key: "code",
                label: t("p.code"),
                render: (r) => (
                  <span className="font-mono text-xs">{r.code}</span>
                ),
              },
              {
                key: "name",
                label: t("p.name"),
                render: (r) =>
                  r.accountId === "total" ? <strong>{r.name}</strong> : r.name,
              },
              {
                key: "opening",
                label: t("f.r.opening"),
                align: "right",
                render: (r) =>
                  r.opening === "" ? "" : <Taka value={r.opening} />,
              },
              {
                key: "debit",
                label: t("f.v.debit"),
                align: "right",
                render: (r) => <Taka value={r.debit} />,
              },
              {
                key: "credit",
                label: t("f.v.credit"),
                align: "right",
                render: (r) => <Taka value={r.credit} />,
              },
              {
                key: "cdr",
                label: t("f.r.closingDr"),
                align: "right",
                render: (r) => <Taka value={r.closingDebit} />,
              },
              {
                key: "ccr",
                label: t("f.r.closingCr"),
                align: "right",
                render: (r) => <Taka value={r.closingCredit} />,
              },
            ]}
          />
        </Panel>
      )}
    </Loaded>
  );
}

function Section({
  title,
  lines,
  total,
}: {
  title: string;
  lines: ReportLine[];
  total: string;
}) {
  const { t } = useI18n();
  return (
    <div className="mb-4">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <Table
        rows={[
          ...lines,
          {
            accountId: "total",
            code: "",
            name: t("p.total"),
            group: null,
            amount: total,
          },
        ]}
        rowKey={(l) => `${l.accountId}-${l.name}`}
        columns={[
          {
            key: "code",
            label: t("p.code"),
            render: (l) => <span className="font-mono text-xs">{l.code}</span>,
          },
          {
            key: "name",
            label: t("p.name"),
            render: (l) =>
              l.accountId === "total" ? <strong>{l.name}</strong> : l.name,
          },
          { key: "group", label: t("f.a.group"), render: (l) => l.group ?? "" },
          {
            key: "amount",
            label: t("p.amount"),
            align: "right",
            render: (l) => <Taka value={l.amount} />,
          },
        ]}
      />
    </div>
  );
}

function ProfitLossView({
  companyId,
  base,
}: {
  companyId: string;
  base: string;
}) {
  const { t } = useI18n();
  const { departments } = useOrg(companyId);
  const [dept, setDept] = useState("");
  const pl = useApi<ProfitAndLoss>(
    `${base}${dept ? `&departmentId=${dept}` : ""}`,
  );
  return (
    <Panel
      title={t("f.r.pl")}
      actions={
        <Select
          aria-label={t("p.department")}
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          id="pl-department"
        >
          <option value="">{t("p.all")}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} · {d.name}
            </option>
          ))}
        </Select>
      }
    >
      <Loaded q={pl}>
        {(d) => (
          <>
            <Section
              title={t("f.r.income")}
              lines={d.income.lines}
              total={d.income.total}
            />
            <Section
              title={t("f.r.expenses")}
              lines={d.expenses.lines}
              total={d.expenses.total}
            />
            <p className="text-right text-lg font-bold">
              {t("f.r.netProfit")}: <Taka value={d.netProfit} />
            </p>
          </>
        )}
      </Loaded>
    </Panel>
  );
}

function BalanceSheetView({ path }: { path: string }) {
  const { t } = useI18n();
  const bs = useApi<BalanceSheet>(path);
  return (
    <Loaded q={bs}>
      {(d) => (
        <Panel
          title={
            <>
              {t("f.r.bs")} <Balanced ok={d.balanced} />
            </>
          }
        >
          <Section
            title={t("f.r.assets")}
            lines={d.assets.lines}
            total={d.assets.total}
          />
          <Section
            title={t("f.r.liabilities")}
            lines={d.liabilities.lines}
            total={d.liabilities.total}
          />
          <Section
            title={t("f.r.equity")}
            lines={d.equity.lines}
            total={d.equity.total}
          />
        </Panel>
      )}
    </Loaded>
  );
}

function LedgerView({
  companyId,
  range,
}: {
  companyId: string;
  range: string;
}) {
  const { t, lang } = useI18n();
  const { postable } = useAccounts(companyId);
  const [accountId, setAccountId] = useState("");
  const gl = useApi<GeneralLedger>(
    accountId ? `/accounts/${accountId}/ledger?${range}` : null,
  );
  return (
    <Panel
      title={t("f.r.gl")}
      actions={
        <AccountSelect
          accounts={postable}
          value={accountId}
          onChange={setAccountId}
          id="gl-account"
        />
      }
    >
      {!accountId ? (
        <p className="py-6 text-center text-sm text-slate-500">
          {t("f.r.pickAccount")}
        </p>
      ) : (
        <Loaded q={gl}>
          {(d) => (
            <>
              <p className="mb-2 text-sm">
                {t("f.r.opening")}: <Taka value={d.opening} />
              </p>
              <Table
                rows={d.lines}
                rowKey={(l) =>
                  `${l.voucherId}-${l.balance}-${l.debit}-${l.credit}`
                }
                columns={[
                  {
                    key: "date",
                    label: t("p.date"),
                    render: (l) => formatDate(l.date, lang, { short: true }),
                  },
                  {
                    key: "number",
                    label: t("f.v.number"),
                    render: (l) => (
                      <Link
                        className="font-mono text-xs text-emerald-800 hover:underline"
                        href={`/portal/finance/vouchers/${l.voucherId}`}
                      >
                        {l.number}
                      </Link>
                    ),
                  },
                  {
                    key: "narration",
                    label: t("f.v.narration"),
                    render: (l) => (
                      <span className="line-clamp-2">{l.narration}</span>
                    ),
                  },
                  {
                    key: "debit",
                    label: t("f.v.debit"),
                    align: "right",
                    render: (l) =>
                      Number(l.debit) ? <Taka value={l.debit} /> : "",
                  },
                  {
                    key: "credit",
                    label: t("f.v.credit"),
                    align: "right",
                    render: (l) =>
                      Number(l.credit) ? <Taka value={l.credit} /> : "",
                  },
                  {
                    key: "balance",
                    label: t("f.r.balance"),
                    align: "right",
                    render: (l) => <Taka value={l.balance} />,
                  },
                ]}
              />
              <p className="mt-2 text-right text-sm font-semibold">
                {t("f.r.balance")}: <Taka value={d.closing} />
              </p>
            </>
          )}
        </Loaded>
      )}
    </Panel>
  );
}

function AgingView({ path }: { path: string }) {
  const { t } = useI18n();
  const aging = useApi<Aging>(path);
  return (
    <Loaded q={aging}>
      {(d) => (
        <Panel title={t("f.r.aging")}>
          <Table
            rows={[
              ...d.vendors,
              {
                vendorId: "total",
                code: "",
                name: t("p.total"),
                bills: 0,
                ...d.totals,
              },
            ]}
            rowKey={(r) => r.vendorId}
            columns={[
              {
                key: "vendor",
                label: t("f.b.vendor"),
                render: (r) =>
                  r.vendorId === "total" ? (
                    <strong>{r.name}</strong>
                  ) : (
                    <Link
                      className="text-emerald-800 hover:underline"
                      href={`/portal/vendors/${r.vendorId}`}
                    >
                      {r.code} · {r.name}
                    </Link>
                  ),
              },
              {
                key: "notDue",
                label: t("f.r.notDue"),
                align: "right",
                render: (r) => <Taka value={r.notDue} />,
              },
              {
                key: "d30",
                label: t("f.r.d30"),
                align: "right",
                render: (r) => <Taka value={r.days1to30} />,
              },
              {
                key: "d60",
                label: t("f.r.d60"),
                align: "right",
                render: (r) => <Taka value={r.days31to60} />,
              },
              {
                key: "d90",
                label: t("f.r.d90"),
                align: "right",
                render: (r) => <Taka value={r.days61to90} />,
              },
              {
                key: "over",
                label: t("f.r.over90"),
                align: "right",
                render: (r) => <Taka value={r.over90} />,
              },
              {
                key: "total",
                label: t("p.total"),
                align: "right",
                render: (r) => (
                  <strong>
                    <Taka value={r.total} />
                  </strong>
                ),
              },
            ]}
          />
        </Panel>
      )}
    </Loaded>
  );
}
