"use client";
/** My provident fund: my part, the company's match, interest, withdrawals and the settlement, with the balance after each. */
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  PageTitle,
  Row,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDate, formatMonth, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

interface PfLedger {
  member: boolean;
  opening: { asOf: string; employeePart: string; employerPart: string } | null;
  entries: Array<{
    runId: string | null;
    period: string;
    bonusName: string | null;
    kind?: string;
    date?: string | null;
    note?: string | null;
    employeePart: string;
    employerPart: string;
    balance: string;
  }>;
  totals: { employeePart: string; employerPart: string; balance: string };
}

export default function PfPage() {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useApi<PfLedger>("/me/pf-ledger");

  return (
    <div className="space-y-4">
      <PageTitle>{t("py.pf.title")}</PageTitle>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.member ? (
        <Empty>{t("py.pf.notMember")}</Empty>
      ) : (
        <>
          <Card>
            <Row
              label={t("py.pf.yours")}
              value={formatTaka(data.totals.employeePart, lang)}
            />
            <Row
              label={t("py.pf.employer")}
              value={formatTaka(data.totals.employerPart, lang)}
            />
            <Row
              label={t("py.pf.balance")}
              value={formatTaka(data.totals.balance, lang)}
              strong
            />
          </Card>
          <Card className="p-0">
            <ul className="divide-y divide-slate-100">
              {[...data.entries].reverse().map((e, i) => (
                <li
                  key={e.runId ?? `${e.kind}-${i}`}
                  className="flex items-center justify-between gap-2 px-4 py-3"
                >
                  <span>
                    <span className="block font-medium">
                      {e.date
                        ? formatDate(e.date, lang)
                        : formatMonth(e.period, lang)}
                      {e.bonusName ? ` · ${e.bonusName}` : ""}
                      {e.kind && e.kind !== "contribution" && (
                        <span className="text-slate-600">
                          {" "}
                          · {t(`pf2.kind.${e.kind}`)}
                        </span>
                      )}
                    </span>
                    <span className="block text-sm text-slate-500">
                      {Number(e.employeePart) >= 0 ? "+" : ""}
                      {formatTaka(e.employeePart, lang)} ·{" "}
                      {Number(e.employerPart) >= 0 ? "+" : ""}
                      {formatTaka(e.employerPart, lang)}
                    </span>
                  </span>
                  <span className="font-bold tabular-nums">
                    {formatTaka(e.balance, lang)}
                  </span>
                </li>
              ))}
              {data.opening && (
                <li className="flex items-center justify-between gap-2 px-4 py-3">
                  <span>
                    <span className="block font-medium">
                      {t("py.pf.opening")}
                    </span>
                    <span className="block text-sm text-slate-500">
                      {formatDate(data.opening.asOf, lang)}
                    </span>
                  </span>
                  <span className="font-bold tabular-nums">
                    {formatTaka(
                      String(
                        Number(data.opening.employeePart) +
                          Number(data.opening.employerPart),
                      ),
                      lang,
                    )}
                  </span>
                </li>
              )}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
