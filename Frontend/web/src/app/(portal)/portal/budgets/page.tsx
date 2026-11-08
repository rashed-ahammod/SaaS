"use client";
/**
 * Budgets (WP18): budget vs actual for a fiscal year (a Dept Head sees their
 * department), the budgets themselves, and the settings.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  BudgetForm,
  fiscalYears,
  currentFiscalYear,
  PositionTable,
  SettingsPanel,
  UsageBar,
} from "@/components/portal/budgets";
import { Taka } from "@/components/portal/finance";
import { PageHeader, Panel, Table, Tabs } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, Button, ErrorBox, Loading, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import {
  BUDGET_STATE_COLOR,
  BUDGET_STATUS_COLOR,
  type BudgetReport,
  type BudgetSummary,
} from "@/lib/budget-types";
import { num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Tab = "report" | "budgets" | "settings";

export default function BudgetsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const [tab, setTab] = useState<Tab>("report");
  const [year, setYear] = useState(currentFiscalYear());
  const [creating, setCreating] = useState(false);
  if (!company) return null;
  return (
    <div>
      <PageHeader
        title={t("bg.title")}
        subtitle={company.legalName}
        actions={
          <>
            <Select
              aria-label={t("bg.year")}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              id="budget-year-filter"
            >
              {fiscalYears().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            {can("budgets.manage") && (
              <Button onClick={() => setCreating(true)}>{t("bg.new")}</Button>
            )}
          </>
        }
      />
      <Tabs<Tab>
        tabs={[
          { key: "report", label: t("bg.tab.report") },
          { key: "budgets", label: t("bg.tab.budgets") },
          { key: "settings", label: t("bg.tab.settings") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "report" && <Report companyId={company.id} year={year} />}
      {tab === "budgets" && <Budgets companyId={company.id} year={year} />}
      {tab === "settings" && <SettingsPanel companyId={company.id} />}
      {creating && (
        <BudgetForm
          companyId={company.id}
          onClose={() => setCreating(false)}
          onDone={(id) => router.push(`/portal/budgets/${id}`)}
        />
      )}
    </div>
  );
}

function Report({ companyId, year }: { companyId: string; year: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const report = useApi<BudgetReport>(
    `/companies/${companyId}/budget-vs-actual?fiscalYear=${year}`,
  );
  const settings = useApi<{ warningPercent: string }>(
    `/companies/${companyId}/budget-settings`,
  );
  if (report.error)
    return <ErrorBox error={report.error} onRetry={report.reload} />;
  if (!report.data) return <Loading />;
  const r = report.data;
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">
        {t("bg.explain", { pct: settings.data?.warningPercent ?? "80" })}
      </p>
      {!r.departments.length && (
        <Panel>
          <p className="text-sm text-slate-500">{t("bg.nothing")}</p>
        </Panel>
      )}
      {r.departments.map((d) => (
        <Panel
          key={d.departmentId}
          title={`${d.departmentCode} · ${d.departmentName}`}
          actions={
            <>
              {!d.budgetId && <Badge color="gray">{t("bg.noBudget")}</Badge>}
              <Badge color={BUDGET_STATUS_COLOR[d.total.status]}>
                {t(`bg.status.${d.total.status}`)}
              </Badge>
              {d.budgetId && (
                <Button
                  variant="ghost"
                  className="min-h-8 px-2 py-1 text-sm"
                  onClick={() => router.push(`/portal/budgets/${d.budgetId}`)}
                >
                  →
                </Button>
              )}
            </>
          }
        >
          <PositionTable rows={d.lines} total={d.total} />
        </Panel>
      ))}
    </>
  );
}

function Budgets({ companyId, year }: { companyId: string; year: string }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const list = useApi<BudgetSummary[]>(
    `/companies/${companyId}/budgets?fiscalYear=${year}`,
  );
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  return (
    <Panel>
      <Table
        rows={list.data}
        rowKey={(b) => b.id}
        empty={t("bg.none")}
        onRowClick={(b) => router.push(`/portal/budgets/${b.id}`)}
        columns={[
          {
            key: "department",
            label: t("bg.department"),
            render: (b) => `${b.departmentCode} · ${b.departmentName}`,
          },
          {
            key: "state",
            label: t("p.status"),
            render: (b) => (
              <Badge color={BUDGET_STATE_COLOR[b.state]}>
                {t(`bg.state.${b.state}`)}
              </Badge>
            ),
          },
          {
            key: "total",
            label: t("bg.budget"),
            align: "right",
            render: (b) => <Taka value={b.total} />,
          },
          {
            key: "used",
            label: t("bg.used"),
            align: "right",
            render: (b) => (b.position ? <Taka value={b.position.used} /> : ""),
          },
          {
            key: "bar",
            label: "",
            render: (b) => (b.position ? <UsageBar p={b.position} /> : null),
          },
          {
            key: "pct",
            label: t("bg.percent"),
            align: "right",
            render: (b) =>
              b.position?.percent
                ? `${num(Number(b.position.percent), lang)}%`
                : "",
          },
        ]}
      />
    </Panel>
  );
}
