"use client";
/** Books of the selected company: set up once, fiscal years, nightly checks (post a skipped payroll from here), what is waiting. */
import Link from "next/link";
import {
  ActionMessage,
  PageHeader,
  Panel,
  Stat,
  useAction,
} from "@/components/portal/kit";
import { Taka } from "@/components/portal/finance";
import { usePortal } from "@/components/portal/portal-context";
import { Alert, Button, ErrorBox, Loading } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type {
  BillSummary,
  Check,
  LedgerStatus,
  VoucherSummary,
} from "@/lib/finance-types";
import { dhakaToday, formatDate, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function BooksPage() {
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  const c = company ? `/companies/${company.id}` : null;
  const status = useApi<LedgerStatus>(c && `${c}/ledger`);
  const ready = status.data?.setUp;
  const checks = useApi<Check>(ready ? `${c}/ledger/checks` : null);
  const waiting = useApi<VoucherSummary[]>(
    ready ? `${c}/vouchers?state=in_approval` : null,
  );
  const bills = useApi<BillSummary[]>(
    ready && can("payables.view") ? `${c}/vendor-bills?open=true` : null,
  );
  const setUp = useAction();

  if (!company) return null;
  if (status.loading) return <Loading />;
  if (status.error)
    return <ErrorBox error={status.error} onRetry={status.reload} />;

  const year = status.data?.fiscalYears[0];
  const open = (bills.data ?? []).reduce(
    (n, b) => n + Number(b.outstanding),
    0,
  );

  return (
    <div>
      <PageHeader title={t("f.home.title")} subtitle={company.legalName} />
      <ActionMessage action={setUp} />
      {!ready ? (
        <Panel>
          <Alert kind="info">{t("f.home.notSetUp")}</Alert>
          {can("ledger.setup") && (
            <Button
              className="mt-3"
              busy={setUp.busy}
              onClick={() =>
                setUp
                  .run(
                    () => api.post(`${c}/ledger/setup`, { asOf: dhakaToday() }),
                    t("f.home.setUpDone"),
                  )
                  .then((ok) => ok && status.reload())
              }
            >
              {t("f.home.setUp")}
            </Button>
          )}
        </Panel>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={t("f.home.fiscalYear")}
              value={year?.code ?? "—"}
              hint={
                year
                  ? `${formatDate(year.startsOn, lang, { short: true })} – ${formatDate(year.endsOn, lang, { short: true })}`
                  : undefined
              }
            />
            <Stat
              label={t("f.home.accounts")}
              value={num(status.data!.accounts, lang)}
            />
            <Stat
              label={t("f.home.pendingVouchers")}
              value={num(waiting.data?.length ?? 0, lang)}
              tone={waiting.data?.length ? "warn" : "default"}
            />
            {can("payables.view") && (
              <Stat
                label={t("f.home.openBills")}
                value={<Taka value={open} />}
                hint={num(bills.data?.length ?? 0, lang)}
              />
            )}
          </div>
          {status.data!.missingPostingAccounts.length > 0 && (
            <Alert kind="warning">
              {t("f.home.missingPosting", {
                keys: status.data!.missingPostingAccounts.join(", "),
              })}
            </Alert>
          )}
          <Panel title={t("f.home.checks")}>
            {checks.loading ? (
              <Loading />
            ) : checks.data?.ok ? (
              <Alert kind="success">{t("f.home.checksOk")}</Alert>
            ) : (
              <ul className="space-y-1 text-sm">
                {checks.data?.problems.map((p, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-2 rounded bg-amber-50 px-3 py-2 text-amber-900"
                  >
                    <span>
                      <span className="font-semibold">
                        {t(`f.check.${p.check}`)}
                      </span>
                      : {p.detail}
                    </span>
                    {p.sourceId && can("ledger.vouchers.prepare") && (
                      <Button
                        variant="secondary"
                        className="min-h-8 px-2 py-1 text-xs"
                        busy={setUp.busy}
                        onClick={() =>
                          setUp
                            .run(
                              () =>
                                api.post(
                                  p.check === "payroll_not_posted"
                                    ? `/payroll-runs/${p.sourceId}/ledger-posting`
                                    : `/disbursement-files/${p.sourceId}/ledger-posting`,
                                ),
                              t("p.done"),
                            )
                            .then((ok) => ok && checks.reload())
                        }
                      >
                        {t("fa.postNow")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <FiscalYears
            companyId={company.id}
            years={status.data!.fiscalYears}
            onOpened={status.reload}
          />
          {waiting.data && waiting.data.length > 0 && (
            <Panel title={t("f.home.pendingVouchers")}>
              <ul className="divide-y divide-slate-100 text-sm">
                {waiting.data.map((v) => (
                  <li key={v.id} className="flex justify-between gap-2 py-2">
                    <Link
                      className="font-medium text-emerald-800 hover:underline"
                      href={`/portal/finance/vouchers/${v.id}`}
                    >
                      {v.number}
                    </Link>
                    <span className="flex-1 truncate text-slate-600">
                      {v.narration}
                    </span>
                    <Taka value={v.total} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

/** The fiscal years (July-June); Accounts opens the next one before its first voucher. */
function FiscalYears({
  companyId,
  years,
  onOpened,
}: {
  companyId: string;
  years: LedgerStatus["fiscalYears"];
  onOpened: () => void;
}) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const action = useAction();
  const latest = [...years].sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0];
  const next = latest
    ? new Date(Date.parse(`${latest.endsOn}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10)
    : null;
  const nextCode = next
    ? `${next.slice(0, 4)}-${String(Number(next.slice(2, 4)) + 1).padStart(2, "0")}`
    : "";
  return (
    <Panel
      title={t("fa.fiscalYears")}
      actions={
        next &&
        can("ledger.setup") && (
          <Button
            variant="secondary"
            busy={action.busy}
            onClick={() =>
              action
                .run(
                  () =>
                    api.post(`/companies/${companyId}/fiscal-years`, {
                      forDate: next,
                    }),
                  t("p.done"),
                )
                .then((ok) => ok && onOpened())
            }
          >
            {t("fa.openNextYear", { year: nextCode })}
          </Button>
        )
      }
    >
      <ActionMessage action={action} />
      <p className="mb-2 text-xs text-slate-500">{t("fa.openNextHint")}</p>
      <ul className="text-sm">
        {years.map((y) => (
          <li key={y.id}>
            {y.code}: {formatDate(y.startsOn, lang, { short: true })} –{" "}
            {formatDate(y.endsOn, lang, { short: true })}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
