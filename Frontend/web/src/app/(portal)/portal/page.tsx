"use client";
/**
 * The portal home screen, in the order a person asks the questions:
 *   1. Is this company set up? (what is still missing, and where to finish it)
 *   2. What is waiting for me today?
 *   3. What do I usually come here to do?
 *   4. The few numbers worth seeing at a glance.
 *
 * Questions 1 and 2 come from one call (/companies/:id/portal/overview), which
 * only answers with what this user's own permissions cover.
 */
import Link from "next/link";
import { PageHeader, Panel, Stat } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Alert, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatMonth, formatTaka, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type {
  Gate1,
  Page,
  EmployeeSummary,
  PortalOverview,
  RunDetail,
  RunSummary,
} from "@/lib/portal-types";
import { useSession } from "@/lib/session";

export default function DashboardPage() {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const { company, companies, can } = usePortal();
  const c = company?.id;
  const payroll = can("payroll.prepare", "payroll.verify", "payroll.approve");

  const overview = useApi<PortalOverview>(
    c ? `/companies/${c}/portal/overview` : null,
  );
  const employees = useApi<Page<EmployeeSummary>>(
    c && can("employee.view") ? `/employees?companyId=${c}&pageSize=1` : null,
  );
  const runs = useApi<RunSummary[]>(
    c && payroll ? `/companies/${c}/payroll-runs` : null,
  );
  const latest = runs.data?.find((r) => r.state !== "cancelled");
  const run = useApi<RunDetail>(latest ? `/payroll-runs/${latest.id}` : null);
  const gate = useApi<Gate1>(c && payroll ? `/companies/${c}/gate-1` : null);

  const setup = overview.data?.setup;
  const attention = overview.data?.attention ?? [];

  return (
    <div>
      <PageHeader
        title={t("p.nav.dashboard")}
        subtitle={t("p.dash.hello", { email: me.email })}
      />
      {!companies.length && <Alert kind="warning">{t("p.noCompany")}</Alert>}

      {/* 2. what is waiting for me */}
      <Panel title={t("p.home.attention")}>
        {overview.loading ? (
          <Loading />
        ) : overview.error ? (
          <ErrorBox error={overview.error} onRetry={overview.reload} />
        ) : attention.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">
            {t("p.home.attentionNone")}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {attention.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 py-2 hover:underline"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${item.tone === "warn" ? "bg-amber-500" : "bg-slate-300"}`}
                    aria-hidden="true"
                  />
                  <span className="text-sm text-slate-800">
                    {t(`p.home.task.${item.key}`, { n: num(item.count, lang) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* 1. is the company set up (the panel keeps its place while the answer is on its way) */}
      {(overview.loading || (setup && setup.total > 0)) && (
        <Panel title={t("p.home.setup")}>
          {!setup ? (
            <Loading />
          ) : (
            <>
              <p className="mb-3 text-sm text-slate-500">
                {setup.complete
                  ? t("p.home.setupComplete")
                  : t("p.home.setupHint", {
                      done: num(setup.done, lang),
                      total: num(setup.total, lang),
                    })}
              </p>
              <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-600"
                  style={{
                    width: `${Math.round((setup.done / setup.total) * 100)}%`,
                  }}
                />
              </div>
              <ul className="grid gap-1 sm:grid-cols-2">
                {setup.steps.map((step) => (
                  <li key={step.key}>
                    <Link
                      href={step.href}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                          step.done
                            ? "bg-emerald-600 text-white"
                            : "border border-slate-300 text-slate-400"
                        }`}
                        aria-hidden="true"
                      >
                        {step.done ? "✓" : ""}
                      </span>
                      <span
                        className={
                          step.done
                            ? "text-slate-500"
                            : "font-medium text-slate-800"
                        }
                      >
                        {t(`p.home.setup.${step.key}`)}
                      </span>
                      {!step.done &&
                        step.key === "salaries" &&
                        step.count > 0 && (
                          <span className="text-xs text-amber-700">
                            {t("p.home.setup.missing", {
                              n: num(step.count, lang),
                            })}
                          </span>
                        )}
                      {step.done && step.count > 0 && (
                        <span className="text-xs text-slate-400 tabular-nums">
                          {num(step.count, lang)}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      )}

      {/* 3. what I usually come here to do */}
      <QuickTasks />

      {/* 4. numbers at a glance */}
      {(employees.data || latest || gate.data) && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {employees.data && (
            <Link href="/portal/employees">
              <Stat
                label={t("p.dash.employees")}
                value={num(employees.data.total, lang)}
              />
            </Link>
          )}
          {latest && (
            <Link href={`/portal/payroll/runs/${latest.id}`}>
              <Stat
                label={t("p.dash.latestRun")}
                value={formatMonth(latest.period, lang)}
                hint={`${t(`p.run.state.${latest.state}`)} · ${formatTaka(latest.totals.net, lang)}${run.data?.openFlags ? ` · ${t("p.dash.openFlags", { n: num(run.data.openFlags, lang) })}` : ""}`}
                tone={run.data?.openFlags ? "warn" : "default"}
              />
            </Link>
          )}
          {gate.data && (
            <Link href="/portal/gate-1">
              <Stat
                label={t("p.dash.gate1")}
                value={
                  gate.data.gate1Passed
                    ? t("p.dash.passed")
                    : t("p.dash.gate1Months", {
                        n: num(gate.data.acceptedMonths.length, lang),
                        required: num(gate.data.requiredMonths, lang),
                      })
                }
                tone={gate.data.gate1Passed ? "good" : "default"}
              />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/** The two or three things this user's role does most often. */
function QuickTasks() {
  const { t } = useI18n();
  const { can } = usePortal();
  const tasks: Array<{ key: string; href: string }> = [
    can("employee.manage") && {
      key: "employee",
      href: "/portal/employees/new",
    },
    can(
      "payroll.prepare",
      "payroll.verify",
      "payroll.approve",
      "payroll.disburse",
    ) && { key: "run", href: "/portal/payroll" },
    can("attendance.manage") && {
      key: "attendance",
      href: "/portal/attendance",
    },
    can("leave.manage") && { key: "leave", href: "/portal/leave" },
    can("users.manage") && { key: "user", href: "/portal/users" },
    can("ledger.view") && { key: "voucher", href: "/portal/finance/vouchers" },
    can("expenses.view") && { key: "claim", href: "/portal/expenses" },
  ].filter((x): x is { key: string; href: string } => x !== false);

  if (!tasks.length) return null;
  return (
    <Panel title={t("p.home.quick")}>
      <div className="flex flex-wrap gap-2">
        {tasks.map((task) => (
          <Link
            key={task.key}
            href={task.href}
            className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-emerald-50 hover:text-emerald-900"
          >
            {t(`p.home.quick.${task.key}`)}
          </Link>
        ))}
      </div>
    </Panel>
  );
}
