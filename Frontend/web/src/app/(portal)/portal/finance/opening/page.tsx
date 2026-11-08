"use client";
/** Opening balances from the old system, the account map, and comparing the old system's trial balance with ours (WP22, Gate 2). */
import { useState } from "react";
import {
  AccountMapPanel,
  ComparisonsPanel,
  Gate2Panel,
  OpeningPanel,
} from "@/components/portal/close";
import { PageHeader } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { useI18n } from "@/lib/i18n";

export default function OpeningPage() {
  const { t } = useI18n();
  const { company } = usePortal();
  const [changed, setChanged] = useState(0);
  if (!company) return null;
  const bump = () => setChanged((n) => n + 1);
  return (
    <div>
      <PageHeader title={t("cl.ob.title")} subtitle={company.legalName} />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <OpeningPanel companyId={company.id} onChanged={bump} />
          <ComparisonsPanel companyId={company.id} onChanged={bump} />
          <AccountMapPanel companyId={company.id} reloadKey={changed} />
        </div>
        <Gate2Panel companyId={company.id} reloadKey={changed} />
      </div>
    </div>
  );
}
