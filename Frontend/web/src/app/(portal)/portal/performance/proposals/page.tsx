"use client";
/**
 * Increments and promotions (Phase 3 WP30): what the appraisal round led to, where each
 * proposal stands, and applying an approved one — after which payroll pays any arrears by
 * itself.
 */
import Link from "next/link";
import { useState } from "react";
import {
  ActionMessage,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Alert, Badge, Button, ErrorBox, Select } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  PROPOSAL_STATE_COLOR,
  type ProposalRow,
} from "@/lib/performance-types";

const STATES = [
  "in_approval",
  "approved",
  "applied",
  "rejected",
  "withdrawn",
] as const;

export default function ProposalsPage() {
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  const apply = useAction();
  const [state, setState] = useState("");
  const proposals = useApi<{ proposals: ProposalRow[] }>(
    company
      ? `/companies/${company.id}/increment-proposals${state ? `?state=${state}` : ""}`
      : null,
  );
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("pf.proposals")} subtitle={company.legalName} />
      <ActionMessage action={apply} />
      <Alert kind="info">{t("pf.applyHint")}</Alert>
      <Panel
        actions={
          <Select
            aria-label={t("pf.state")}
            value={state}
            onChange={(e) => setState(e.target.value)}
            id="proposal-state"
          >
            <option value="">{t("p.all")}</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {t(`pf.proposalState.${s}`)}
              </option>
            ))}
          </Select>
        }
      >
        {proposals.error ? (
          <ErrorBox error={proposals.error} onRetry={proposals.reload} />
        ) : (
          <Table
            rows={proposals.data?.proposals}
            rowKey={(p) => p.id}
            empty={t("st.none")}
            columns={[
              {
                key: "employee",
                label: t("pf.employee"),
                render: (p) => (
                  <Link
                    className="underline"
                    href={`/portal/performance/appraisals/${p.appraisalId}`}
                  >
                    {p.employeeName}
                    <span className="block font-mono text-xs text-slate-500">
                      {p.employeeCode}
                    </span>
                  </Link>
                ),
              },
              {
                key: "kind",
                label: t("pf.proposalKind"),
                render: (p) => t(`pf.proposalKind.${p.kind}`),
              },
              {
                key: "gross",
                label: t("pf.newGross"),
                align: "right",
                render: (p) =>
                  p.newGross ? formatTaka(p.newGross, lang) : t("pf.salaryHidden"),
              },
              {
                key: "from",
                label: t("pf.effectiveFrom"),
                render: (p) => p.effectiveFrom,
              },
              {
                key: "state",
                label: t("pf.state"),
                render: (p) => (
                  <Badge color={PROPOSAL_STATE_COLOR[p.state]}>
                    {t(`pf.proposalState.${p.state}`)}
                  </Badge>
                ),
              },
              {
                key: "act",
                label: "",
                render: (p) =>
                  p.state === "approved" && can("performance.propose") ? (
                    <Button
                      busy={apply.busy}
                      onClick={() =>
                        apply
                          .run(
                            () =>
                              api.post(
                                `/increment-proposals/${p.id}/apply`,
                              ),
                            t("pf.saved"),
                          )
                          .then(() => proposals.reload())
                      }
                    >
                      {t("pf.apply")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
