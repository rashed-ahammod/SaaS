"use client";
/**
 * One asset: its tag label (QR), cost and book value, who has it (give / take back),
 * maintenance, the depreciation posted and the whole schedule, and disposal.
 */
import { use, useState } from "react";
import {
  AssetLabel,
  AssignDialog,
  DisposeDialog,
  MaintenanceDialog,
  ReturnDialog,
} from "@/components/portal/assets";
import { Taka } from "@/components/portal/finance";
import { Detail, PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, Button, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { ASSET_STATE_COLOR, type Asset } from "@/lib/asset-types";
import { formatDate, formatMonth, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function AssetPage({
  params,
}: PageProps<"/portal/assets/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const { can, company } = usePortal();
  const a = useApi<Asset>(`/assets/${id}`);
  const [dialog, setDialog] = useState<
    "assign" | "return" | "maintenance" | "dispose" | null
  >(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const schedule = useApi<{
    rows: Array<{
      period: string;
      charge: string;
      accumulated: string;
      bookValue: string;
    }>;
  }>(showSchedule ? `/assets/${id}/schedule` : null);
  if (a.loading && !a.data) return <Loading />;
  if (a.error) return <ErrorBox error={a.error} onRetry={a.reload} />;
  const d = a.data!;
  const manage = can("assets.manage");
  const done = () => (setDialog(null), a.reload());

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{d.tag}</span> {d.name}
            <Badge color={ASSET_STATE_COLOR[d.state]}>
              {t(`as.state.${d.state}`)}
            </Badge>
          </span>
        }
        subtitle={`${d.class.code} · ${d.class.name}`}
        actions={
          manage &&
          d.state !== "disposed" && (
            <>
              {d.state === "in_store" && (
                <Button onClick={() => setDialog("assign")}>
                  {t("as.assign")}
                </Button>
              )}
              {d.state === "assigned" && (
                <Button variant="secondary" onClick={() => setDialog("return")}>
                  {t("as.return")}
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => setDialog("maintenance")}
              >
                {t("as.addMaintenance")}
              </Button>
              <Button variant="ghost" onClick={() => window.print()}>
                {t("as.label")}
              </Button>
              {d.state === "in_store" && (
                <Button
                  variant="ghost"
                  className="text-red-700"
                  onClick={() => setDialog("dispose")}
                >
                  {t("as.dispose")}
                </Button>
              )}
            </>
          )
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail label={t("as.cost")}>{formatTaka(d.cost, lang)}</Detail>
            <Detail label={t("as.accumulated")}>
              {formatTaka(d.accumulated, lang)}
            </Detail>
            <Detail label={t("as.bookValue")}>
              {formatTaka(d.bookValue, lang)}
            </Detail>
            <Detail label={t("as.inService")}>
              {formatDate(d.inServiceDate, lang)}
            </Detail>
            <Detail label={t("as.residual")}>
              {formatTaka(d.residualValue, lang)}
            </Detail>
            <Detail label={t("as.serial")}>{d.serialNo ?? "—"}</Detail>
            <Detail label={t("as.department")}>
              {d.departmentName ?? "—"}
            </Detail>
            <Detail label={t("as.location")}>{d.location ?? "—"}</Detail>
            <Detail label={t("as.schedule")}>
              {t(`as.classMethod.${d.class.method}`)}
            </Detail>
          </dl>
          {d.state === "disposed" && (
            <p className="mt-3 text-sm text-red-700">
              {t(`as.method.${d.disposalMethod}`)} ·{" "}
              {formatDate(d.disposedOn!, lang)} ·{" "}
              {formatTaka(d.disposalProceeds ?? "0", lang)} ·{" "}
              {d.disposalVoucherNumber} · {d.disposalNote}
            </p>
          )}
        </Panel>
        <Panel>
          <AssetLabel asset={d} company={company?.legalName ?? ""} />
        </Panel>
      </div>

      <Panel title={t("as.assignments")}>
        <Table
          rows={d.assignments}
          rowKey={(g) => g.id}
          empty={t("st.none")}
          columns={[
            {
              key: "who",
              label: t("as.employee"),
              render: (g) => `${g.employeeCode} · ${g.employeeName}`,
            },
            {
              key: "from",
              label: t("as.assignedOn"),
              render: (g) => formatDate(g.assignedOn, lang, { short: true }),
            },
            {
              key: "ack",
              label: t("as.acknowledged"),
              render: (g) =>
                g.acknowledgedAt ? (
                  formatDate(g.acknowledgedAt.slice(0, 10), lang, {
                    short: true,
                  })
                ) : (
                  <span className="text-xs text-amber-700">
                    {t("as.notAcknowledged")}
                  </span>
                ),
            },
            {
              key: "to",
              label: t("as.returnedOn"),
              render: (g) =>
                g.returnedOn
                  ? `${formatDate(g.returnedOn, lang, { short: true })} · ${t(`as.condition.${g.returnCondition}`)}`
                  : "—",
            },
            {
              key: "note",
              label: t("as.note"),
              render: (g) => (
                <span className="text-xs">{g.returnNote ?? g.note ?? ""}</span>
              ),
            },
          ]}
        />
      </Panel>

      <Panel title={t("as.maintenance")}>
        <Table
          rows={d.maintenance}
          rowKey={(m) => m.id}
          empty={t("st.none")}
          columns={[
            {
              key: "date",
              label: t("as.doneOn"),
              render: (m) => formatDate(m.doneOn, lang, { short: true }),
            },
            {
              key: "kind",
              label: t("as.kind"),
              render: (m) => t(`as.kind.${m.kind}`),
            },
            {
              key: "what",
              label: t("as.description"),
              render: (m) => m.description,
            },
            {
              key: "cost",
              label: t("as.cost"),
              align: "right",
              render: (m) => <Taka value={m.cost} />,
            },
            {
              key: "next",
              label: t("as.nextDue"),
              render: (m) =>
                m.nextDue ? formatDate(m.nextDue, lang, { short: true }) : "",
            },
          ]}
        />
      </Panel>

      <Panel
        title={t("as.schedule")}
        actions={
          !showSchedule && (
            <Button variant="ghost" onClick={() => setShowSchedule(true)}>
              {t("as.showSchedule")}
            </Button>
          )
        }
      >
        <Table
          rows={
            showSchedule
              ? (schedule.data?.rows ?? []).map((r) => ({
                  ...r,
                  posted:
                    d.depreciation.some((p) => p.period === r.period) ||
                    r.period <= (d.depreciation.at(-1)?.period ?? ""),
                }))
              : d.depreciation.map((p) => ({
                  period: p.period,
                  charge: p.amount,
                  accumulated: p.accumulatedAfter,
                  bookValue: p.bookValueAfter,
                  posted: true,
                }))
          }
          rowKey={(r) => r.period}
          empty={t("st.none")}
          columns={[
            {
              key: "period",
              label: t("as.period"),
              render: (r) => formatMonth(r.period, lang),
            },
            {
              key: "charge",
              label: t("as.charge"),
              align: "right",
              render: (r) => <Taka value={r.charge} />,
            },
            {
              key: "acc",
              label: t("as.accumulated"),
              align: "right",
              render: (r) => <Taka value={r.accumulated} />,
            },
            {
              key: "book",
              label: t("as.bookValue"),
              align: "right",
              render: (r) => <Taka value={r.bookValue} />,
            },
            {
              key: "posted",
              label: "",
              render: (r) =>
                r.posted ? <Badge color="green">{t("as.posted")}</Badge> : null,
            },
          ]}
        />
      </Panel>

      {dialog === "assign" && (
        <AssignDialog asset={d} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === "return" && (
        <ReturnDialog asset={d} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === "maintenance" && (
        <MaintenanceDialog
          asset={d}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === "dispose" && (
        <DisposeDialog
          asset={d}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </div>
  );
}
