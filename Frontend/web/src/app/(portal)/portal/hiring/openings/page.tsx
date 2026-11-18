"use client";
/** Job openings (Phase 3 WP29): what is being recruited for, and how many have applied. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { OpeningStateBadge } from "@/components/portal/hiring";
import { ErrorBox, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { OpeningRow } from "@/lib/hiring-types";

const STATES = ["open", "on_hold", "filled", "closed"] as const;

export default function OpeningsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { company } = usePortal();
  const [state, setState] = useState("open");
  const openings = useApi<{ openings: OpeningRow[] }>(
    company
      ? `/companies/${company.id}/job-openings${state ? `?state=${state}` : ""}`
      : null,
  );
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("hr.openings")} subtitle={company.legalName} />
      <Panel
        actions={
          <Select
            aria-label={t("hr.state")}
            value={state}
            onChange={(e) => setState(e.target.value)}
            id="opening-state"
          >
            <option value="">{t("p.all")}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {t(`hr.opening.state.${s}`)}
              </option>
            ))}
          </Select>
        }
      >
        {openings.error ? (
          <ErrorBox error={openings.error} onRetry={openings.reload} />
        ) : (
          <Table
            rows={openings.data?.openings}
            rowKey={(o) => o.id}
            empty={t("st.none")}
            onRowClick={(o) => router.push(`/portal/hiring/openings/${o.id}`)}
            columns={[
              {
                key: "number",
                label: t("hr.number"),
                className: "font-mono",
                render: (o) => o.number,
              },
              {
                key: "title",
                label: t("hr.title"),
                render: (o) => (
                  <span>
                    {o.title}
                    <span className="block text-xs text-slate-500">
                      {o.departmentName} · {t(`hr.type.${o.employmentType}`)}
                    </span>
                  </span>
                ),
              },
              {
                key: "posts",
                label: t("hr.posts"),
                align: "right",
                render: (o) => o.openings,
              },
              {
                key: "applications",
                label: t("hr.applications"),
                align: "right",
                render: (o) => o.applications,
              },
              {
                key: "closing",
                label: t("hr.closingOn"),
                render: (o) => o.closingOn ?? "—",
              },
              {
                key: "state",
                label: t("hr.state"),
                render: (o) => <OpeningStateBadge state={o.state} />,
              },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
