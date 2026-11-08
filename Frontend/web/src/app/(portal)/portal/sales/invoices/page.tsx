"use client";
/** Customer invoices (Phase 3 WP26): Mushak 6.3, what is still owed on each. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, ErrorBox } from "@/components/ui";
import { useApi } from "@/lib/api";
import { dhakaToday, formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { SalesInvoice } from "@/lib/sales-types";

export default function InvoicesPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company } = usePortal();
  const [open, setOpen] = useState(true);
  const list = useApi<SalesInvoice[]>(
    company
      ? `/companies/${company.id}/sales-invoices${open ? "?open=true" : ""}`
      : null,
  );
  if (!company) return null;
  const today = dhakaToday();
  return (
    <div>
      <PageHeader title={t("sa.invoices")} subtitle={company.legalName} />
      <Panel
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={open}
              onChange={(e) => setOpen(e.target.checked)}
              id="invoice-open"
            />{" "}
            {t("sa.openOnly")}
          </label>
        }
      >
        {list.error ? (
          <ErrorBox error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            rows={list.data}
            rowKey={(i) => i.id}
            empty={t("st.none")}
            onRowClick={(i) => router.push(`/portal/sales/invoices/${i.id}`)}
            columns={[
              {
                key: "no",
                label: t("sa.number"),
                className: "font-mono whitespace-nowrap text-xs",
                render: (i) => i.invoiceNo,
              },
              {
                key: "customer",
                label: t("sa.customer"),
                render: (i) => i.customerName,
              },
              {
                key: "date",
                label: t("sa.invoiceDate"),
                render: (i) => formatDate(i.invoiceDate, lang, { short: true }),
              },
              {
                key: "due",
                label: t("sa.dueDate"),
                render: (i) => (
                  <span>
                    {formatDate(i.dueDate, lang, { short: true })}
                    {Number(i.outstanding) > 0 && i.dueDate < today && (
                      <Badge color="red"> !</Badge>
                    )}
                  </span>
                ),
              },
              {
                key: "total",
                label: t("sa.total"),
                align: "right",
                render: (i) => formatTaka(i.total, lang),
              },
              {
                key: "out",
                label: t("sa.outstanding"),
                align: "right",
                className: "font-semibold",
                render: (i) => formatTaka(i.outstanding, lang),
              },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
