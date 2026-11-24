"use client";
/** Approvals inbox (managers): requests waiting for me, or for people who delegated to me. */
import Link from "next/link";
import {
  Badge,
  Card,
  Empty,
  ErrorBox,
  Icon,
  Loading,
  PageTitle,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDate, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { InboxItem } from "@/lib/types";

export default function ApprovalsPage() {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } =
    useApi<InboxItem[]>("/approvals/inbox");

  return (
    <div>
      <PageTitle>{t("appr.title")}</PageTitle>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.length ? (
        <Empty>{t("appr.empty")}</Empty>
      ) : (
        <ul className="space-y-3">
          {data.map((item) => (
            <li key={`${item.requestId}-${item.onBehalfOf ?? ""}`}>
              <Link href={`/approvals/${item.requestId}`} className="block">
                <Card className="flex items-center gap-3 active:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Badge color="blue">
                        {t(`appr.type.${item.requestType}`)}
                      </Badge>
                      <Badge>
                        {t("appr.step", { n: num(item.step, lang) })}
                      </Badge>
                      {item.onBehalfOf && (
                        <Badge color="amber">{t("appr.onBehalf")}</Badge>
                      )}
                    </div>
                    <p className="font-semibold text-slate-900">
                      {item.summary}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {t("appr.submitted", {
                        date: formatDate(item.submittedAt.slice(0, 10), lang, {
                          short: true,
                        }),
                      })}{" "}
                      ·{" "}
                      {t("appr.escalates", {
                        date: formatDate(item.escalationAt.slice(0, 10), lang, {
                          short: true,
                        }),
                      })}
                    </p>
                  </div>
                  <Icon
                    name="chevron-right"
                    className="h-5 w-5 shrink-0 text-slate-400"
                  />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
