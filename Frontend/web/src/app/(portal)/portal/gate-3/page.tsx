"use client";
/**
 * The Gate 3 report (Phase 3 WP31; spec §12): has this pilot actually run its sales pipeline
 * and one appraisal cycle in the system, or only had it installed? Each check says what has
 * to be true, whether it is, and the numbers behind the answer.
 *
 * The page decides nothing: Gate 1 and Gate 2 are human decisions too, taken with a report
 * like this one in hand.
 */
import { useState } from "react";
import { Detail, PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  Alert,
  Badge,
  ErrorBox,
  Field,
  Input,
  Loading,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import type { Gate3Report } from "@/lib/commission-types";
import { useI18n } from "@/lib/i18n";

export default function Gate3Page() {
  const { t } = useI18n();
  const { company } = usePortal();
  const [days, setDays] = useState("90");
  const report = useApi<Gate3Report>(
    company ? `/companies/${company.id}/gate-3?days=${days || 90}` : null,
  );
  if (!company) return null;
  if (report.loading && !report.data) return <Loading />;
  if (report.error)
    return <ErrorBox error={report.error} onRetry={report.reload} />;
  const r = report.data!;
  return (
    <div>
      <PageHeader
        title={t("cm.gate3")}
        subtitle={`${company.legalName} · ${r.from} – ${r.to}`}
        actions={
          <Field label={t("cm.days")}>
            <Input
              id="gate3-days"
              type="number"
              min={7}
              max={730}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
        }
      />
      <Alert kind="info">{t("cm.gate3Hint")}</Alert>
      <Alert kind={r.allMet ? "success" : "warning"}>
        {r.allMet
          ? t("cm.allMet")
          : t("cm.someMissing", { n: r.met, total: r.total })}
      </Alert>
      <Panel>
        <Table
          rows={r.checks}
          rowKey={(c) => c.key}
          empty={t("st.none")}
          columns={[
            {
              key: "met",
              label: t("cm.met"),
              render: (c) =>
                c.met ? (
                  <Badge color="green">{t("cm.met")}</Badge>
                ) : (
                  <Badge color="amber">{t("cm.notMet")}</Badge>
                ),
            },
            {
              key: "what",
              label: t("cm.check"),
              render: (c) => c.what,
            },
            {
              key: "detail",
              label: t("cm.detail"),
              render: (c) => (
                <span className="text-xs text-slate-500">
                  {Object.entries(c.detail)
                    .map(
                      ([k, v]) =>
                        `${k}: ${
                          Array.isArray(v)
                            ? v.length
                            : v && typeof v === "object"
                              ? JSON.stringify(v)
                              : String(v)
                        }`,
                    )
                    .join(" · ")}
                </span>
              ),
            },
          ]}
        />
      </Panel>
      <Panel title={t("cm.detail")}>
        <dl className="grid gap-3 sm:grid-cols-2">
          {r.checks.map((c) => (
            <Detail key={c.key} label={c.key}>
              <pre className="overflow-x-auto text-xs text-slate-600">
                {JSON.stringify(c.detail, null, 2)}
              </pre>
            </Detail>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
