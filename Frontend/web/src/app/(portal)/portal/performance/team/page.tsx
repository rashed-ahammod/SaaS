"use client";
/**
 * My team's appraisals (Phase 3 WP30): what a Dept Head opens to write goals and rate. One
 * row per person who reports to them in the chosen cycle.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, ErrorBox, Field, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  APPRAISAL_STATE_COLOR,
  type CycleRow,
  type TeamAppraisalRow,
} from "@/lib/performance-types";

export default function MyTeamPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { company } = usePortal();
  const [cycleId, setCycleId] = useState("");
  const cycles = useApi<{ cycles: CycleRow[] }>(
    company ? `/companies/${company.id}/appraisal-cycles` : null,
  );
  const chosen =
    cycleId ||
    cycles.data?.cycles.find((c) => c.state !== "closed")?.id ||
    cycles.data?.cycles[0]?.id ||
    "";
  const team = useApi<{ appraisals: TeamAppraisalRow[] }>(
    chosen ? `/appraisal-cycles/${chosen}/my-team` : null,
  );
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("pf.nav.team")} subtitle={company.legalName} />
      <Panel
        actions={
          <Field label={t("pf.cycles")}>
            <Select
              id="team-cycle"
              value={chosen}
              onChange={(e) => setCycleId(e.target.value)}
            >
              {(cycles.data?.cycles ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        }
      >
        {team.error ? (
          <ErrorBox error={team.error} onRetry={team.reload} />
        ) : (
          <Table
            rows={team.data?.appraisals}
            rowKey={(a) => a.id}
            empty={t("st.none")}
            onRowClick={(a) =>
              router.push(`/portal/performance/appraisals/${a.id}`)
            }
            columns={[
              {
                key: "employee",
                label: t("pf.employee"),
                render: (a) => (
                  <span>
                    {a.employeeName}
                    <span className="block font-mono text-xs text-slate-500">
                      {a.employeeCode}
                    </span>
                  </span>
                ),
              },
              {
                key: "state",
                label: t("pf.state"),
                render: (a) => (
                  <Badge color={APPRAISAL_STATE_COLOR[a.state]}>
                    {t(`pf.appState.${a.state}`)}
                  </Badge>
                ),
              },
              {
                key: "self",
                label: t("pf.selfReview"),
                render: (a) =>
                  a.selfReviewDone ? (
                    <Badge color="green">{t("pf.applied")}</Badge>
                  ) : (
                    <Badge color="amber">{t("pf.state.self_review")}</Badge>
                  ),
              },
              {
                key: "manager",
                label: t("pf.managerRating"),
                align: "right",
                render: (a) => a.managerRating ?? "—",
              },
              {
                key: "calibrated",
                label: t("pf.calibratedRating"),
                align: "right",
                render: (a) => a.calibratedRating ?? "—",
              },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
