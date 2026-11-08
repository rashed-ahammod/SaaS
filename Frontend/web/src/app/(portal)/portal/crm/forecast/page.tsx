"use client";
/** Weighted forecast and sales targets (Phase 3 WP24): by month, salesperson and stage; targets against what was won. */
import { useState } from "react";
import { TargetsPanel } from "@/components/portal/opportunities";
import { PageHeader, Panel, Stat, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { ErrorBox, Field, Input, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import type { Forecast } from "@/lib/crm-types";
import { dhakaToday, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default function ForecastPage() {
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  const thisMonth = dhakaToday().slice(0, 7);
  const [from, setFrom] = useState(thisMonth);
  const [to, setTo] = useState(addMonths(thisMonth, 2));
  const [month, setMonth] = useState(thisMonth);
  const forecast = useApi<Forecast>(
    company && from && to && from <= to
      ? `/companies/${company.id}/sales-forecast?from=${from}&to=${to}`
      : null,
  );
  if (!company) return null;
  const f = forecast.data;
  return (
    <div>
      <PageHeader title={t("cr.nav.forecast")} subtitle={company.legalName} />
      <Panel
        title={t("cr.forecast")}
        actions={
          <div className="flex gap-2">
            <Field label={t("cr.from")}>
              <Input
                type="month"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                id="forecast-from"
              />
            </Field>
            <Field label={t("cr.to")}>
              <Input
                type="month"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                id="forecast-to"
              />
            </Field>
          </div>
        }
      >
        <p className="mb-3 text-sm text-slate-600">{t("cr.forecastHint")}</p>
        {forecast.error ? (
          <ErrorBox error={forecast.error} onRetry={forecast.reload} />
        ) : !f ? (
          <Loading />
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <Stat
                label={t("cr.weighted")}
                value={formatTaka(f.total.weighted, lang)}
                hint={`${f.total.count} · ${formatTaka(f.total.value, lang)}`}
              />
              <Stat
                label={t("cr.won")}
                value={formatTaka(f.won, lang)}
                tone="good"
              />
              <Stat
                label={t("cr.late")}
                value={formatTaka(f.late.weighted, lang)}
                hint={String(f.late.count)}
                tone={f.late.count ? "warn" : "default"}
              />
            </div>
            {f.late.count > 0 && (
              <p
                className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
                role="status"
              >
                {t("cr.lateHint", {
                  count: f.late.count,
                  value: formatTaka(f.late.value, lang),
                  weighted: formatTaka(f.late.weighted, lang),
                })}
              </p>
            )}
            <Table
              rows={[
                ...f.months,
                { month: t("cr.total"), ...f.total, won: f.won },
              ]}
              rowKey={(r) => r.month}
              columns={[
                { key: "month", label: t("cr.month"), render: (r) => r.month },
                {
                  key: "count",
                  label: t("cr.count"),
                  align: "right",
                  render: (r) => r.count,
                },
                {
                  key: "value",
                  label: t("cr.value"),
                  align: "right",
                  render: (r) => formatTaka(r.value, lang),
                },
                {
                  key: "weighted",
                  label: t("cr.weighted"),
                  align: "right",
                  className: "font-semibold",
                  render: (r) => formatTaka(r.weighted, lang),
                },
                {
                  key: "won",
                  label: t("cr.won"),
                  align: "right",
                  render: (r) => formatTaka(r.won, lang),
                },
              ]}
            />
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold">
                  {t("cr.byOwner")}
                </h3>
                <Table
                  rows={f.byOwner}
                  rowKey={(r) => r.ownerId}
                  empty={t("st.none")}
                  columns={[
                    {
                      key: "name",
                      label: t("cr.owner"),
                      render: (r) => r.name,
                    },
                    {
                      key: "count",
                      label: t("cr.count"),
                      align: "right",
                      render: (r) => r.count,
                    },
                    {
                      key: "weighted",
                      label: t("cr.weighted"),
                      align: "right",
                      render: (r) => formatTaka(r.weighted, lang),
                    },
                  ]}
                />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">
                  {t("cr.byStage")}
                </h3>
                <Table
                  rows={f.byStage}
                  rowKey={(r) => r.stageId}
                  empty={t("st.none")}
                  columns={[
                    {
                      key: "name",
                      label: t("cr.stage"),
                      render: (r) => (lang === "bn" && r.nameBn) || r.name,
                    },
                    {
                      key: "count",
                      label: t("cr.count"),
                      align: "right",
                      render: (r) => r.count,
                    },
                    {
                      key: "weighted",
                      label: t("cr.weighted"),
                      align: "right",
                      render: (r) => formatTaka(r.weighted, lang),
                    },
                  ]}
                />
              </div>
            </div>
          </>
        )}
      </Panel>
      <div className="mb-3 flex items-end gap-3">
        <Field label={t("cr.month")}>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            id="targets-month"
          />
        </Field>
      </div>
      {month && (
        <TargetsPanel
          companyId={company.id}
          month={month}
          canSetDepartment={can("crm.manage")}
        />
      )}
    </div>
  );
}
