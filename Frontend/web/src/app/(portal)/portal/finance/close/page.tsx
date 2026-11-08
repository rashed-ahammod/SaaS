"use client";
/** Month-end close (WP22): the checklist of a month and its close; the Gate 2 report. */
import { useState } from "react";
import { lastMonth } from "@/components/portal/vat";
import { ChecklistPanel, Gate2Panel } from "@/components/portal/close";
import { PageHeader } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Field, Input } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export default function MonthClosePage() {
  const { t } = useI18n();
  const { company } = usePortal();
  const [period, setPeriod] = useState(lastMonth());
  const [changed, setChanged] = useState(0);
  if (!company) return null;
  return (
    <div>
      <PageHeader
        title={t("cl.mc.title")}
        subtitle={company.legalName}
        actions={
          <Field label={t("cl.mc.period")}>
            <Input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              id="close-period"
            />
          </Field>
        }
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ChecklistPanel
            key={period}
            companyId={company.id}
            period={period}
            onChanged={() => setChanged((n) => n + 1)}
          />
        </div>
        <Gate2Panel companyId={company.id} reloadKey={changed} />
      </div>
    </div>
  );
}
