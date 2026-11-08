"use client";
/** Sales orders (Phase 3 WP26): from accepted quotations; over the credit limit they wait for Accounts. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, ErrorBox, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { ORDER_STATE_COLOR, type SalesOrder } from "@/lib/sales-types";

export default function OrdersPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company } = usePortal();
  const [state, setState] = useState("");
  const list = useApi<SalesOrder[]>(
    company
      ? `/companies/${company.id}/sales-orders${state ? `?state=${state}` : ""}`
      : null,
  );
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("sa.orders")} subtitle={company.legalName} />
      <Panel
        actions={
          <Select
            aria-label={t("cr.state")}
            value={state}
            onChange={(e) => setState(e.target.value)}
            id="order-state"
          >
            <option value="">{t("p.all")}</option>
            {[
              "in_approval",
              "confirmed",
              "delivered",
              "invoiced",
              "cancelled",
            ].map((s) => (
              <option key={s} value={s}>
                {t(`sa.ostate.${s}`)}
              </option>
            ))}
          </Select>
        }
      >
        {list.error ? (
          <ErrorBox error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            rows={list.data}
            rowKey={(o) => o.id}
            empty={t("st.none")}
            onRowClick={(o) => router.push(`/portal/sales/orders/${o.id}`)}
            columns={[
              {
                key: "number",
                label: t("sa.number"),
                className: "font-mono whitespace-nowrap text-xs",
                render: (o) => o.number,
              },
              {
                key: "customer",
                label: t("sa.customer"),
                render: (o) => o.customer ?? "",
              },
              {
                key: "date",
                label: t("sa.orderDate"),
                render: (o) => formatDate(o.orderDate, lang, { short: true }),
              },
              {
                key: "total",
                label: t("sa.total"),
                align: "right",
                render: (o) => formatTaka(o.total, lang),
              },
              {
                key: "invoice",
                label: t("sa.invoice"),
                className: "font-mono text-xs",
                render: (o) => o.invoice?.invoiceNo ?? "",
              },
              {
                key: "state",
                label: t("cr.state"),
                render: (o) => (
                  <Badge color={ORDER_STATE_COLOR[o.state]}>
                    {t(`sa.ostate.${o.state}`)}
                  </Badge>
                ),
              },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
