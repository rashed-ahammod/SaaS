"use client";
/** Customer receipts (Phase 3 WP27): money in, allocated to invoices; the voucher goes to the checker. */
import { useState } from "react";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { ReceiptDialog } from "@/components/portal/sales";
import { Badge, Button, ErrorBox } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { CustomerReceipt } from "@/lib/sales-types";

const COLOR = {
  in_approval: "amber",
  posted: "green",
  cancelled: "gray",
  reversed: "red",
} as const;

export default function ReceiptsPage() {
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  const list = useApi<CustomerReceipt[]>(
    company ? `/companies/${company.id}/customer-receipts` : null,
  );
  const [creating, setCreating] = useState(false);
  if (!company) return null;
  return (
    <div>
      <PageHeader
        title={t("sa.receipts")}
        subtitle={company.legalName}
        actions={
          can("receivables.manage") && (
            <Button onClick={() => setCreating(true)}>
              {t("sa.newReceipt")}
            </Button>
          )
        }
      />
      <Panel>
        {list.error ? (
          <ErrorBox error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            rows={list.data}
            rowKey={(r) => r.id}
            empty={t("st.none")}
            columns={[
              {
                key: "no",
                label: t("sa.number"),
                className: "font-mono whitespace-nowrap text-xs",
                render: (r) => (
                  <span>
                    {r.number}
                    {r.voucherNumber && (
                      <span className="block text-slate-500">
                        {r.voucherNumber}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: "customer",
                label: t("sa.customer"),
                render: (r) => r.customer ?? "",
              },
              {
                key: "date",
                label: t("sa.receiptDate"),
                render: (r) => formatDate(r.receiptDate, lang, { short: true }),
              },
              {
                key: "method",
                label: t("sa.method"),
                render: (r) =>
                  `${t(`sa.method.${r.method}`)}${r.chequeNo ? ` ${r.chequeNo}` : ""}`,
              },
              {
                key: "amount",
                label: t("sa.amount"),
                align: "right",
                render: (r) => formatTaka(r.amount, lang),
              },
              {
                key: "vds",
                label: t("sa.vds"),
                align: "right",
                render: (r) =>
                  Number(r.vdsAmount) ? formatTaka(r.vdsAmount, lang) : "",
              },
              {
                key: "onAccount",
                label: t("sa.onAccount"),
                align: "right",
                render: (r) =>
                  Number(r.onAccount) ? formatTaka(r.onAccount, lang) : "",
              },
              {
                key: "state",
                label: t("cr.state"),
                render: (r) => (
                  <Badge color={COLOR[r.state as keyof typeof COLOR]}>
                    {t(`sa.rstate.${r.state}`)}
                  </Badge>
                ),
              },
            ]}
          />
        )}
      </Panel>
      {creating && (
        <ReceiptDialog
          companyId={company.id}
          onClose={() => setCreating(false)}
          onDone={() => (setCreating(false), list.reload())}
        />
      )}
    </div>
  );
}
