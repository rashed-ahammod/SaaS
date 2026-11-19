"use client";
/**
 * The Gate 2 report (Phase 2 WP22; spec §12): are this pilot's books actually running in the
 * ERP — opening balances posted, a month after cut-over closed, its checklist complete, the
 * old system's trial balance matching, and the integrity checks passing?
 *
 * The report itself is `Gate2Panel`, which also sits beside the month-end checklist and the
 * opening balances, where the work that moves the gate is done. This page exists so the gate
 * can be found by name — like Gate 1 and Gate 3, which are screens of their own — instead of
 * only as a panel on a screen you had to know about.
 *
 * The page decides nothing: passing Gate 2 is a human decision, taken with this report in hand.
 */
import { Gate2Panel } from "@/components/portal/close";
import { PageHeader } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { useI18n } from "@/lib/i18n";

export default function Gate2Page() {
  const { t } = useI18n();
  const { company } = usePortal();
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("cl.nav.gate2")} subtitle={company.legalName} />
      <div className="max-w-2xl">
        <Gate2Panel companyId={company.id} />
      </div>
    </div>
  );
}
