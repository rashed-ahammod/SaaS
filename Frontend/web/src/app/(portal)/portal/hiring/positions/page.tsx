"use client";
/**
 * New-position requests (Phase 3 WP29): what each department has asked for, whether the
 * manpower plan has room for it, and where the request stands. A Dept Head sees their own
 * department; HR and the Admin see the company.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  PositionRequestDialog,
  PositionStateBadge,
  useWhen,
} from "@/components/portal/hiring";
import { Badge, Button, ErrorBox, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { PositionRequestRow } from "@/lib/hiring-types";

const STATES = [
  "in_approval",
  "approved",
  "opened",
  "rejected",
  "cancelled",
] as const;

export default function PositionsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const when = useWhen();
  const { company, can } = usePortal();
  const [state, setState] = useState("");
  const [asking, setAsking] = useState(false);
  const requests = useApi<{ requests: PositionRequestRow[] }>(
    company
      ? `/companies/${company.id}/position-requests${state ? `?state=${state}` : ""}`
      : null,
  );
  if (!company) return null;
  return (
    <div>
      <PageHeader
        title={t("hr.positions")}
        subtitle={company.legalName}
        actions={
          can(
            "recruitment.request_own",
            "recruitment.manage",
            "recruitment.plan",
          ) && (
            <Button onClick={() => setAsking(true)}>
              {t("hr.newPosition")}
            </Button>
          )
        }
      />
      <Panel
        actions={
          <Select
            aria-label={t("hr.state")}
            value={state}
            onChange={(e) => setState(e.target.value)}
            id="position-state"
          >
            <option value="">{t("p.all")}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {t(`hr.state.${s}`)}
              </option>
            ))}
          </Select>
        }
      >
        {requests.error ? (
          <ErrorBox error={requests.error} onRetry={requests.reload} />
        ) : (
          <Table
            rows={requests.data?.requests}
            rowKey={(r) => r.id}
            empty={t("st.none")}
            onRowClick={(r) => router.push(`/portal/hiring/positions/${r.id}`)}
            columns={[
              {
                key: "number",
                label: t("hr.number"),
                className: "font-mono",
                render: (r) => r.number,
              },
              {
                key: "post",
                label: t("hr.designation"),
                render: (r) => (
                  <span>
                    {r.designationName}
                    <span className="block text-xs text-slate-500">
                      {r.departmentName}
                    </span>
                  </span>
                ),
              },
              {
                key: "headcount",
                label: t("hr.headcount"),
                align: "right",
                render: (r) => r.headcount,
              },
              {
                key: "plan",
                label: t("hr.planCheck"),
                render: (r) =>
                  r.withinPlan ? (
                    <Badge color="green">{t("hr.withinPlan")}</Badge>
                  ) : (
                    <Badge color="amber">{t("hr.outsidePlan")}</Badge>
                  ),
              },
              {
                key: "state",
                label: t("hr.state"),
                render: (r) => <PositionStateBadge state={r.state} />,
              },
              {
                key: "created",
                label: t("hr.appliedOn"),
                render: (r) => when(r.createdAt),
              },
            ]}
          />
        )}
      </Panel>
      {asking && (
        <PositionRequestDialog
          companyId={company.id}
          onClose={() => setAsking(false)}
          onDone={(id) => router.push(`/portal/hiring/positions/${id}`)}
        />
      )}
    </div>
  );
}
