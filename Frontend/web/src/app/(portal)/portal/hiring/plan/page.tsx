"use client";
/**
 * Manpower plan (Phase 3 WP29): how many posts of each designation each department may have
 * this fiscal year. A new-position request is checked against it — not refused by it — so
 * this screen is what makes "outside the plan" mean something.
 */
import { useState } from "react";
import {
  ActionMessage,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  Alert,
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { ManpowerPlan } from "@/lib/hiring-types";
import type { Department, Designation } from "@/lib/portal-types";

interface Row {
  departmentId: string;
  designationId: string;
  headcount: string;
}

export default function ManpowerPlanPage() {
  const { t } = useI18n();
  const { company, can } = usePortal();
  const save = useAction();
  const approve = useAction();
  const [draft, setDraft] = useState<Row[] | null>(null);
  const plan = useApi<ManpowerPlan>(
    company ? `/companies/${company.id}/manpower-plan` : null,
  );
  const departments = useApi<Department[]>(
    company ? `/companies/${company.id}/departments` : null,
  );
  const designations = useApi<Designation[]>(
    company ? `/companies/${company.id}/designations` : null,
  );
  if (!company) return null;
  if (plan.loading && !plan.data) return <Loading />;
  if (plan.error) return <ErrorBox error={plan.error} onRetry={plan.reload} />;
  const p = plan.data!;
  const mayEdit = can("recruitment.plan") && p.plan?.state !== "approved";
  const rows: Row[] =
    draft ??
    p.lines.map((l) => ({
      departmentId: l.departmentId,
      designationId: l.designationId,
      headcount: String(l.headcount),
    }));

  const setRow = (i: number, patch: Partial<Row>) =>
    setDraft(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  return (
    <div>
      <PageHeader
        title={t("hr.plan")}
        subtitle={`${company.legalName} · ${t("hr.fiscalYear")} ${p.fiscalYear}`}
        actions={
          <>
            {p.plan && (
              <Badge color={p.plan.state === "approved" ? "green" : "amber"}>
                {t(p.plan.state === "approved" ? "hr.planApproved" : "hr.planDraft")}
              </Badge>
            )}
            {can("recruitment.plan") &&
              p.plan &&
              p.plan.state === "draft" && (
                <Button
                  busy={approve.busy}
                  onClick={() =>
                    approve
                      .run(
                        () => api.post(`/manpower-plans/${p.plan!.id}/approve`),
                        t("hr.saved"),
                      )
                      .then(() => plan.reload())
                  }
                >
                  {t("hr.approvePlan")}
                </Button>
              )}
          </>
        }
      />
      <ActionMessage action={approve} />
      {p.plan?.state === "approved" && <Alert kind="info">{t("hr.planFinal")}</Alert>}

      <Panel title={t("hr.plan")}>
        {!p.plan && !mayEdit ? (
          <p className="text-sm text-slate-500">{t("hr.noPlan")}</p>
        ) : (
          <Table
            rows={p.lines}
            rowKey={(l) => l.id}
            empty={t("hr.noPlan")}
            columns={[
              {
                key: "department",
                label: t("hr.department"),
                render: (l) => l.departmentName,
              },
              {
                key: "designation",
                label: t("hr.designation"),
                render: (l) => l.designationName,
              },
              {
                key: "headcount",
                label: t("hr.headcount"),
                align: "right",
                render: (l) => l.headcount,
              },
              {
                key: "filled",
                label: t("hr.filled"),
                align: "right",
                render: (l) => l.filled,
              },
              {
                key: "requested",
                label: t("hr.requested"),
                align: "right",
                render: (l) => l.requested,
              },
              {
                key: "left",
                label: t("hr.left"),
                align: "right",
                render: (l) => (
                  <span className={l.left <= 0 ? "text-red-700" : ""}>
                    {l.left}
                  </span>
                ),
              },
            ]}
          />
        )}
      </Panel>

      {mayEdit && (
        <Panel title={t("hr.savePlan")}>
          <ActionMessage action={save} />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const done = await save.run(
                () =>
                  api.put(`/companies/${company.id}/manpower-plan`, {
                    lines: rows
                      .filter((r) => r.departmentId && r.designationId)
                      .map((r) => ({
                        departmentId: r.departmentId,
                        designationId: r.designationId,
                        headcount: Number(r.headcount || 0),
                      })),
                  }),
                t("hr.saved"),
              );
              if (done) {
                setDraft(null);
                plan.reload();
              }
            }}
          >
            {rows.map((r, i) => (
              <div
                key={i}
                className="grid gap-3 sm:grid-cols-[1fr_1fr_7rem_auto] sm:items-end"
              >
                <Field label={t("hr.department")}>
                  <Select
                    required
                    id={`plan-dept-${i}`}
                    value={r.departmentId}
                    onChange={(e) => setRow(i, { departmentId: e.target.value })}
                  >
                    <option value="">—</option>
                    {(departments.data ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("hr.designation")}>
                  <Select
                    required
                    id={`plan-desig-${i}`}
                    value={r.designationId}
                    onChange={(e) =>
                      setRow(i, { designationId: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {(designations.data ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nameEn}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("hr.headcount")}>
                  <Input
                    required
                    type="number"
                    min={1}
                    id={`plan-count-${i}`}
                    value={r.headcount}
                    onChange={(e) => setRow(i, { headcount: e.target.value })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  className="mb-3"
                  onClick={() => setDraft(rows.filter((_, j) => j !== i))}
                >
                  {t("hr.removeLine")}
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setDraft([
                    ...rows,
                    { departmentId: "", designationId: "", headcount: "1" },
                  ])
                }
              >
                {t("hr.addLine")}
              </Button>
              <Button type="submit" busy={save.busy}>
                {t("hr.savePlan")}
              </Button>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}
