"use client";
/**
 * One appraisal cycle (Phase 3 WP30): its phase, the appraisals in it, and — in the
 * calibration phase — the spread of ratings per department that HR moderates against.
 */
import Link from "next/link";
import { use } from "react";
import {
  ActionMessage,
  Detail,
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
  Loading,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  APPRAISAL_STATE_COLOR,
  CYCLE_STATE_COLOR,
  type CalibrationView,
  type CycleDetail,
} from "@/lib/performance-types";

export default function CyclePage({
  params,
}: PageProps<"/portal/performance/cycles/[id]">) {
  const { id } = use(params);
  const { t } = useI18n();
  const { can } = usePortal();
  const act = useAction();
  const cycle = useApi<CycleDetail>(`/appraisal-cycles/${id}`);
  const calibration = useApi<CalibrationView>(
    can("performance.manage") ? `/appraisal-cycles/${id}/calibration` : null,
  );
  if (cycle.loading && !cycle.data) return <Loading />;
  if (cycle.error) return <ErrorBox error={cycle.error} onRetry={cycle.reload} />;
  const c = cycle.data!;
  const run = (path: string) =>
    act
      .run(() => api.post(`/appraisal-cycles/${c.id}/${path}`), t("pf.saved"))
      .then(() => {
        cycle.reload();
        calibration.reload();
      });

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name}
            <Badge color={CYCLE_STATE_COLOR[c.state]}>
              {t(`pf.state.${c.state}`)}
            </Badge>
          </span>
        }
        subtitle={`${c.periodFrom} – ${c.periodTo} · ${t(`pf.kind.${c.kind}`)}`}
        actions={
          can("performance.manage") && (
            <>
              {(c.state === "draft" || c.state === "goals") && (
                <Button busy={act.busy} onClick={() => run("open")}>
                  {t("pf.openCycle")}
                </Button>
              )}
              {c.state !== "closed" && (
                <Button
                  variant="secondary"
                  busy={act.busy}
                  onClick={() => run("advance")}
                >
                  {t("pf.advance")}
                </Button>
              )}
            </>
          )
        }
      />
      <ActionMessage action={act} />
      {c.state !== "closed" && (
        <Alert kind="info">{t("pf.advanceHint")}</Alert>
      )}

      {calibration.data && (
        <Panel title={t("pf.calibrationView")}>
          <Table
            rows={calibration.data.departments}
            rowKey={(d) => d.departmentId ?? "none"}
            empty={t("st.none")}
            columns={[
              {
                key: "department",
                label: t("pf.department"),
                render: (d) => d.departmentName ?? "—",
              },
              {
                key: "spread",
                label: t("pf.spread"),
                render: (d) => (
                  <span className="flex gap-1">
                    {(["1", "2", "3", "4", "5"] as const).map((n) => (
                      <Badge
                        key={n}
                        color={
                          d.counts[n] === 0
                            ? "gray"
                            : n === "5" || n === "4"
                              ? "green"
                              : n === "3"
                                ? "blue"
                                : "amber"
                        }
                      >
                        {n}: {d.counts[n]}
                      </Badge>
                    ))}
                  </span>
                ),
              },
              {
                key: "rated",
                label: t("pf.rated"),
                align: "right",
                render: (d) => d.rated,
              },
              {
                key: "calibrated",
                label: t("pf.calibrated"),
                align: "right",
                render: (d) => d.calibrated,
              },
            ]}
          />
        </Panel>
      )}

      <Panel title={t("pf.appraisals")}>
        <dl className="mb-3 grid gap-3 sm:grid-cols-3">
          <Detail label={t("pf.incrementFrom")}>
            {c.incrementFrom ?? "—"}
          </Detail>
          <Detail label={t("pf.note")}>{c.note ?? "—"}</Detail>
          <Detail label={t("pf.appraisals")}>{c.appraisals.length}</Detail>
        </dl>
        <Table
          rows={c.appraisals}
          rowKey={(a) => a.id}
          empty={t("st.none")}
          columns={[
            {
              key: "employee",
              label: t("pf.employee"),
              render: (a) => (
                <Link
                  className="underline"
                  href={`/portal/performance/appraisals/${a.id}`}
                >
                  {a.employeeName}
                  <span className="block font-mono text-xs text-slate-500">
                    {a.employeeCode}
                  </span>
                </Link>
              ),
            },
            {
              key: "department",
              label: t("pf.department"),
              render: (a) => a.departmentName ?? "—",
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
              key: "manager",
              label: t("pf.managerRating"),
              align: "right",
              render: (a) => a.managerRating ?? "—",
            },
            {
              key: "calibrated",
              label: t("pf.calibratedRating"),
              align: "right",
              render: (a) =>
                a.calibratedRating ? (
                  <Badge color="green">{a.calibratedRating}</Badge>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
