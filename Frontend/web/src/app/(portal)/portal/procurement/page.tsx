"use client";
/**
 * Purchases (WP17): approved requisitions waiting to be bought, all requisitions
 * (a Dept Head sees their department), purchase orders, and the settings.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Taka } from "@/components/portal/finance";
import { PageHeader, Panel, Table, Tabs } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { SettingsPanel } from "@/components/portal/procurement";
import { Badge, ErrorBox } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  ORDER_STATE_COLOR,
  REQ_STATE_COLOR,
  type OrderSummary,
  type RequisitionSummary,
} from "@/lib/procurement-types";

type Tab = "toBuy" | "requisitions" | "orders" | "settings";

export default function ProcurementPage() {
  const { t } = useI18n();
  const { company, can } = usePortal();
  const manage = can("procurement.manage");
  const [tab, setTab] = useState<Tab>(manage ? "toBuy" : "requisitions");
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("pr.p.title")} subtitle={company.legalName} />
      <Tabs<Tab>
        tabs={[
          ...(manage
            ? [{ key: "toBuy" as Tab, label: t("pr.p.tab.toBuy") }]
            : []),
          { key: "requisitions", label: t("pr.p.tab.requisitions") },
          { key: "orders", label: t("pr.p.tab.orders") },
          { key: "settings", label: t("pr.p.tab.settings") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "toBuy" && (
        <Requisitions companyId={company.id} state="approved" />
      )}
      {tab === "requisitions" && <Requisitions companyId={company.id} />}
      {tab === "orders" && <Orders companyId={company.id} />}
      {tab === "settings" && <SettingsPanel companyId={company.id} />}
    </div>
  );
}

function Requisitions({
  companyId,
  state,
}: {
  companyId: string;
  state?: string;
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const list = useApi<RequisitionSummary[]>(
    `/companies/${companyId}/purchase-requisitions${state ? `?state=${state}` : ""}`,
  );
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  return (
    <Panel>
      <Table
        rows={list.data}
        rowKey={(r) => r.id}
        empty={t("pr.p.none")}
        onRowClick={(r) =>
          router.push(`/portal/procurement/requisitions/${r.id}`)
        }
        columns={[
          {
            key: "number",
            label: t("pr.p.number"),
            render: (r) => (
              <span className="font-mono text-xs">{r.number}</span>
            ),
          },
          { key: "title", label: t("pr.what"), render: (r) => r.title },
          {
            key: "requester",
            label: t("pr.p.requester"),
            render: (r) => `${r.requesterCode} · ${r.requesterName}`,
          },
          {
            key: "department",
            label: t("pr.p.department"),
            render: (r) => r.departmentName ?? "",
          },
          {
            key: "date",
            label: t("p.date"),
            render: (r) =>
              formatDate(r.createdAt.slice(0, 10), lang, { short: true }),
          },
          {
            key: "state",
            label: t("p.status"),
            render: (r) => (
              <Badge color={REQ_STATE_COLOR[r.state]}>
                {t(`pr.state.${r.state}`)}
              </Badge>
            ),
          },
          {
            key: "total",
            label: t("pr.estimate"),
            align: "right",
            render: (r) => <Taka value={r.estimatedTotal} />,
          },
        ]}
      />
    </Panel>
  );
}

function Orders({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const list = useApi<OrderSummary[]>(
    `/companies/${companyId}/purchase-orders`,
  );
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  return (
    <Panel>
      <Table
        rows={list.data}
        rowKey={(o) => o.id}
        empty={t("pr.p.none")}
        onRowClick={(o) => router.push(`/portal/procurement/orders/${o.id}`)}
        columns={[
          {
            key: "number",
            label: t("pr.p.number"),
            render: (o) => (
              <span className="font-mono text-xs">{o.number}</span>
            ),
          },
          {
            key: "vendor",
            label: t("pr.p.vendor"),
            render: (o) => `${o.vendorCode} · ${o.vendorName}`,
          },
          { key: "title", label: t("pr.what"), render: (o) => o.title },
          {
            key: "date",
            label: t("pr.p.orderDate"),
            render: (o) => formatDate(o.orderDate, lang, { short: true }),
          },
          {
            key: "state",
            label: t("p.status"),
            render: (o) => (
              <Badge color={ORDER_STATE_COLOR[o.state]}>
                {t(`pr.os.${o.state}`)}
              </Badge>
            ),
          },
          {
            key: "total",
            label: t("pr.p.total"),
            align: "right",
            render: (o) => <Taka value={o.total} />,
          },
        ]}
      />
    </Panel>
  );
}
