"use client";
/** VAT (WP21): the monthly return tied to the ledger, the sales and purchase registers, items and rates. */
import { useState } from "react";
import { PageHeader, Tabs } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  ItemsPanel,
  PurchasesPanel,
  ReturnPanel,
  SalesPanel,
} from "@/components/portal/vat";
import { useI18n } from "@/lib/i18n";

type Tab = "return" | "sales" | "purchases" | "items";

export default function VatPage() {
  const { t } = useI18n();
  const { company } = usePortal();
  const [tab, setTab] = useState<Tab>("return");
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("vt.title")} subtitle={company.legalName} />
      <Tabs<Tab>
        tabs={[
          { key: "return", label: t("vt.tab.return") },
          { key: "sales", label: t("vt.tab.sales") },
          { key: "purchases", label: t("vt.tab.purchases") },
          { key: "items", label: t("vt.tab.items") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "return" && <ReturnPanel companyId={company.id} />}
      {tab === "sales" && <SalesPanel companyId={company.id} />}
      {tab === "purchases" && <PurchasesPanel companyId={company.id} />}
      {tab === "items" && <ItemsPanel companyId={company.id} />}
    </div>
  );
}
