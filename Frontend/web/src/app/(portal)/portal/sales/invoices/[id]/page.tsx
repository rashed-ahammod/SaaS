"use client";
/** One customer invoice (Mushak 6.3): lines, the posting, credit notes (6.7) and the receipts against it. */
import Link from "next/link";
import { use, useState } from "react";
import { Detail, PageHeader, Panel, Table } from "@/components/portal/kit";
import { CreditNoteDialog, PdfButtons } from "@/components/portal/sales";
import { Badge, Button, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { SalesInvoiceDetail } from "@/lib/sales-types";

export default function InvoicePage({
  params,
}: PageProps<"/portal/sales/invoices/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const invoice = useApi<SalesInvoiceDetail>(`/sales-invoices/${id}`);
  const [crediting, setCrediting] = useState(false);
  if (invoice.loading && !invoice.data) return <Loading />;
  if (invoice.error)
    return <ErrorBox error={invoice.error} onRetry={invoice.reload} />;
  const i = invoice.data!;
  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">{i.invoiceNo}</span>{" "}
            {i.customerName}
          </span>
        }
        subtitle={i.customerBin ? `BIN ${i.customerBin}` : undefined}
        actions={
          <>
            {i.canCredit && Number(i.outstanding) > 0 && (
              <Button variant="secondary" onClick={() => setCrediting(true)}>
                {t("sa.creditNote")}
              </Button>
            )}
            <PdfButtons
              path={`/sales-invoices/${i.id}/pdf`}
              name={i.invoiceNo.replace(/\//g, "-")}
            />
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel>
          <dl className="grid gap-3">
            <Detail label={t("sa.invoiceDate")}>
              {formatDate(i.invoiceDate, lang)}
            </Detail>
            <Detail label={t("sa.dueDate")}>
              {formatDate(i.dueDate, lang)}
            </Detail>
            <Detail label={t("sa.order")}>
              <Link
                className="font-mono text-xs underline"
                href={`/portal/sales/orders/${i.orderId}`}
              >
                {i.orderNumber}
              </Link>
            </Detail>
            {i.voucher && (
              <Detail label={t("sa.voucher")}>
                <Link
                  className="font-mono text-xs underline"
                  href={`/portal/finance/vouchers/${i.voucher.id}`}
                >
                  {i.voucher.number}
                </Link>
              </Detail>
            )}
            <Detail label={t("sa.total")}>{formatTaka(i.total, lang)}</Detail>
            <Detail label={t("sa.received")}>
              {formatTaka(i.received, lang)}
            </Detail>
            {Number(i.credited) > 0 && (
              <Detail label={t("sa.credited")}>
                {formatTaka(i.credited, lang)}
              </Detail>
            )}
            <Detail label={t("sa.outstanding")}>
              <strong>{formatTaka(i.outstanding, lang)}</strong>
            </Detail>
          </dl>
        </Panel>
        <div className="lg:col-span-2">
          <Panel title={t("sa.lines")}>
            <Table
              rows={i.lines}
              rowKey={(l) => l.id}
              columns={[
                {
                  key: "desc",
                  label: t("sa.product"),
                  render: (l) => l.description,
                },
                {
                  key: "qty",
                  label: t("sa.quantity"),
                  align: "right",
                  render: (l) => (
                    <span>
                      {Number(l.quantity)} {l.unit}
                      {Number(l.creditedQuantity) > 0 && (
                        <Badge color="amber">
                          {" "}
                          −{Number(l.creditedQuantity)}
                        </Badge>
                      )}
                    </span>
                  ),
                },
                {
                  key: "price",
                  label: t("sa.unitPrice"),
                  align: "right",
                  render: (l) => formatTaka(l.unitPrice, lang),
                },
                {
                  key: "value",
                  label: t("sa.value"),
                  align: "right",
                  render: (l) => formatTaka(l.value, lang),
                },
                {
                  key: "vat",
                  label: t("sa.vat"),
                  align: "right",
                  render: (l) => formatTaka(l.vatAmount, lang),
                },
              ]}
            />
          </Panel>
          {!!i.creditNotes.length && (
            <Panel title={t("sa.creditNotes")}>
              <Table
                rows={i.creditNotes}
                rowKey={(n) => n.id}
                columns={[
                  {
                    key: "no",
                    label: t("sa.number"),
                    className: "font-mono text-xs",
                    render: (n) => n.number,
                  },
                  {
                    key: "date",
                    label: t("sa.receiptDate"),
                    render: (n) =>
                      formatDate(n.noteDate, lang, { short: true }),
                  },
                  {
                    key: "reason",
                    label: t("sa.reason"),
                    render: (n) => n.reason,
                  },
                  {
                    key: "total",
                    label: t("sa.total"),
                    align: "right",
                    render: (n) => formatTaka(n.total, lang),
                  },
                ]}
              />
            </Panel>
          )}
          {!!i.receipts.length && (
            <Panel title={t("sa.receipts")}>
              <Table
                rows={i.receipts}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: "no",
                    label: t("sa.number"),
                    className: "font-mono text-xs",
                    render: (r) => r.number,
                  },
                  {
                    key: "date",
                    label: t("sa.receiptDate"),
                    render: (r) =>
                      formatDate(r.receiptDate, lang, { short: true }),
                  },
                  {
                    key: "state",
                    label: t("cr.state"),
                    render: (r) => t(`sa.rstate.${r.state}`),
                  },
                  {
                    key: "amount",
                    label: t("sa.allocated"),
                    align: "right",
                    render: (r) => formatTaka(r.amount, lang),
                  },
                ]}
              />
            </Panel>
          )}
        </div>
      </div>
      {crediting && (
        <CreditNoteDialog
          invoice={i}
          onClose={() => setCrediting(false)}
          onDone={() => (setCrediting(false), invoice.reload())}
        />
      )}
    </div>
  );
}
