"use client";
/** Receivables (WP22, WP26-WP27): what customers owe (old-system items and customer invoices), money received, and its aging per customer or account manager. */
import Link from "next/link";
import { useState } from "react";
import { ReceivablesAgingView } from "@/components/portal/close";
import { AccountSelect, Taka, useAccounts } from "@/components/portal/finance";
import {
  ActionMessage,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Button, ErrorBox, Field, Input, Select } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { ReceivableItem } from "@/lib/close-types";
import { dhakaToday, formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function ReceivablesPage() {
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  const [showPaid, setShowPaid] = useState(false);
  const [receiving, setReceiving] = useState<ReceivableItem | null>(null);
  const items = useApi<ReceivableItem[]>(
    company
      ? `/companies/${company.id}/receivables${showPaid ? "" : "?open=true"}`
      : null,
  );
  const [agingKey, setAgingKey] = useState(0);
  const [by, setBy] = useState<"customer" | "manager">("customer");
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("cl.rv.title")} subtitle={company.legalName} />
      <Panel
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showPaid}
              onChange={(e) => setShowPaid(e.target.checked)}
              id="show-paid"
            />{" "}
            {t("cl.rv.showPaid")}
          </label>
        }
      >
        <p className="mb-3 text-sm text-slate-600">{t("cl.rv.hint")}</p>
        {items.error ? (
          <ErrorBox error={items.error} onRetry={items.reload} />
        ) : (
          <Table
            rows={items.data}
            rowKey={(i) => i.id}
            empty={t("st.none")}
            columns={[
              {
                key: "customer",
                label: t("cl.ar.customer"),
                render: (i) => i.customerName,
              },
              {
                key: "invoice",
                label: t("cl.rv.invoice"),
                className: "font-mono",
                render: (i) =>
                  i.salesInvoiceId ? (
                    <Link
                      className="underline"
                      href={`/portal/sales/invoices/${i.salesInvoiceId}`}
                    >
                      {i.reference}
                    </Link>
                  ) : (
                    i.reference
                  ),
              },
              {
                key: "date",
                label: t("cl.rv.date"),
                render: (i) => formatDate(i.invoiceDate, lang, { short: true }),
              },
              {
                key: "due",
                label: t("cl.rv.due"),
                render: (i) => formatDate(i.dueDate, lang, { short: true }),
              },
              {
                key: "amount",
                label: t("cl.rv.amount"),
                align: "right",
                render: (i) => <Taka value={i.amount} />,
              },
              {
                key: "out",
                label: t("cl.rv.outstanding"),
                align: "right",
                render: (i) => (
                  <span>
                    <Taka value={i.outstanding} />
                    {Number(i.pendingReceipts) > 0 && (
                      <span className="block text-xs text-amber-700">
                        {t("cl.rv.pending", {
                          amount: formatTaka(i.pendingReceipts, lang),
                        })}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: "act",
                label: "",
                align: "right",
                render: (i) =>
                  can("receivables.manage") &&
                  !i.salesInvoiceId &&
                  Number(i.outstanding) > Number(i.pendingReceipts) ? (
                    <Button
                      variant="secondary"
                      className="min-h-8 px-2 py-1 text-xs"
                      onClick={() => setReceiving(i)}
                    >
                      {t("cl.rv.receive")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Panel>
      <div className="mb-2 mt-6 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">{t("cl.r.ar")}</h2>
        <Select
          aria-label={t("sa.byCustomer")}
          value={by}
          onChange={(e) => setBy(e.target.value as "customer" | "manager")}
          id="aging-by"
        >
          <option value="customer">{t("sa.byCustomer")}</option>
          <option value="manager">{t("sa.byManager")}</option>
        </Select>
      </div>
      <ReceivablesAgingView
        key={`${agingKey}-${by}`}
        path={`/companies/${company.id}/receivables/aging?asOf=${dhakaToday()}&by=${by}`}
      />
      {receiving && (
        <ReceiveDialog
          companyId={company.id}
          item={receiving}
          onClose={() => setReceiving(null)}
          onDone={() => (
            setReceiving(null),
            items.reload(),
            setAgingKey((k) => k + 1)
          )}
        />
      )}
    </div>
  );
}

function ReceiveDialog({
  companyId,
  item,
  onClose,
  onDone,
}: {
  companyId: string;
  item: ReceivableItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const accounts = useAccounts(companyId);
  const open = (
    Number(item.outstanding) - Number(item.pendingReceipts)
  ).toFixed(2);
  const [f, setF] = useState({
    receiptDate: dhakaToday(),
    amount: open,
    receivedIntoAccountId: "",
    reference: "",
  });
  return (
    <Modal
      title={`${t("cl.rv.receive")}: ${item.customerName} · ${item.reference} · ${formatTaka(open, lang)}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/receivable-items/${item.id}/receipts`, {
                ...f,
                ...(f.reference ? {} : { reference: undefined }),
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("cl.rv.receiptDate")}>
          <Input
            type="date"
            required
            value={f.receiptDate}
            onChange={(e) => setF({ ...f, receiptDate: e.target.value })}
            id="rv-date"
          />
        </Field>
        <Field label={t("cl.rv.amount")}>
          <Input
            required
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
            id="rv-amount"
          />
        </Field>
        <Field label={t("cl.rv.into")}>
          <AccountSelect
            id="rv-into"
            required
            accounts={accounts.postable}
            value={f.receivedIntoAccountId}
            onChange={(receivedIntoAccountId) =>
              setF({ ...f, receivedIntoAccountId })
            }
            filter={(a) => a.role === "bank" || a.role === "cash"}
          />
        </Field>
        <Field label={t("cl.rv.reference")}>
          <Input
            maxLength={100}
            value={f.reference}
            onChange={(e) => setF({ ...f, reference: e.target.value })}
            id="rv-ref"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cl.rv.receive")}
        />
      </form>
    </Modal>
  );
}
