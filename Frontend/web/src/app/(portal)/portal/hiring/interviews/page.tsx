"use client";
/**
 * My interviews (Phase 3 WP29): the panels I am on, and whether I have given my scorecard.
 * Any employee can be on a panel, so this screen belongs to everyone, not only HR.
 */
import { useRouter } from "next/navigation";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { useWhen } from "@/components/portal/hiring";
import { Badge, ErrorBox } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MyInterviewRow } from "@/lib/hiring-types";

export default function MyInterviewsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const when = useWhen();
  const { company } = usePortal();
  const interviews = useApi<{ interviews: MyInterviewRow[] }>(
    company ? `/companies/${company.id}/my-interviews` : null,
  );
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("hr.myInterviews")} subtitle={company.legalName} />
      <Panel>
        {interviews.error ? (
          <ErrorBox error={interviews.error} onRetry={interviews.reload} />
        ) : (
          <Table
            rows={interviews.data?.interviews}
            rowKey={(i) => i.id}
            empty={t("hr.noInterviews")}
            onRowClick={(i) => router.push(`/portal/hiring/interviews/${i.id}`)}
            columns={[
              {
                key: "when",
                label: t("hr.scheduledAt"),
                render: (i) => when(i.scheduledAt),
              },
              {
                key: "post",
                label: t("hr.title"),
                render: (i) => (
                  <span>
                    {i.openingTitle}
                    <span className="block font-mono text-xs text-slate-500">
                      {i.openingNumber}
                    </span>
                  </span>
                ),
              },
              {
                key: "round",
                label: t("hr.round"),
                align: "right",
                render: (i) => i.roundNo,
              },
              {
                key: "kind",
                label: t("hr.kind"),
                render: (i) => t(`hr.kind.${i.kind}`),
              },
              {
                key: "place",
                label: t("hr.place"),
                render: (i) => i.place ?? "",
              },
              {
                key: "card",
                label: t("hr.scorecard"),
                render: (i) =>
                  i.myScorecardGiven ? (
                    <Badge color="green">{t("hr.scorecardGiven")}</Badge>
                  ) : (
                    <Badge color="amber">{t("hr.scorecardMissing")}</Badge>
                  ),
              },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
