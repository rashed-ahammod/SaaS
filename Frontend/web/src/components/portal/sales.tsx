"use client";
/**
 * Sales pieces of the portal (Phase 3 WP25-WP27):
 *   LinesEditor        quotation lines: product, quantity, unit price (empty: the price list), discount
 *   QuotationDialog    a new quotation, or the next revision of one
 *   CreditNoteDialog   Mushak 6.7: quantities back per invoice line
 *   ReceiptDialog      money from a customer, allocated to their open invoices
 *   CustomerAccountPanel   what a customer owes, has on account, and the statement
 *   PdfButtons         the Bangla and English PDF
 */
import { useState } from "react";
import { Badge, Button, ErrorBox, Field, Input, Select } from "@/components/ui";
import { api, saveDownload, useApi } from "@/lib/api";
import type { Customer, OpportunityRow } from "@/lib/crm-types";
import { dhakaToday, formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  RECEIPT_METHODS,
  type CustomerAccount,
  type Product,
  type QuotationDetail,
  type SalesInvoiceDetail,
  type Statement,
} from "@/lib/sales-types";
import {
  ActionMessage,
  FormButtons,
  Modal,
  Panel,
  Table,
  useAction,
} from "./kit";

type Line = {
  productId: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
};
const emptyLine = (): Line => ({
  productId: "",
  quantity: "",
  unitPrice: "",
  discountPercent: "",
});
const lineBody = (l: Line) => ({
  productId: l.productId,
  quantity: l.quantity,
  ...(l.unitPrice ? { unitPrice: l.unitPrice } : {}),
  ...(l.discountPercent ? { discountPercent: l.discountPercent } : {}),
});

export function LinesEditor({
  companyId,
  lines,
  setLines,
}: {
  companyId: string;
  lines: Line[];
  setLines: (l: Line[]) => void;
}) {
  const { t } = useI18n();
  const products = useApi<Product[]>(`/companies/${companyId}/products`);
  const set = (i: number, k: keyof Line, v: string) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <fieldset className="mb-3">
      <legend className="mb-1 text-sm font-medium text-slate-700">
        {t("sa.lines")}
      </legend>
      <p className="mb-2 text-xs text-slate-500">{t("sa.priceHint")}</p>
      {lines.map((l, i) => (
        <div
          key={i}
          className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_7rem_8rem_6rem_2rem]"
        >
          <Select
            aria-label={`${t("sa.product")} ${i + 1}`}
            required
            value={l.productId}
            onChange={(e) => set(i, "productId", e.target.value)}
            id={`line-product-${i + 1}`}
          >
            <option value="">—</option>
            {products.data
              ?.filter((p) => p.isActive)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
          </Select>
          <Input
            aria-label={`${t("sa.quantity")} ${i + 1}`}
            required
            inputMode="decimal"
            pattern="\d+(\.\d{1,3})?"
            placeholder={t("sa.quantity")}
            value={l.quantity}
            onChange={(e) => set(i, "quantity", e.target.value)}
            id={`line-qty-${i + 1}`}
          />
          <Input
            aria-label={`${t("sa.unitPrice")} ${i + 1}`}
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            placeholder={t("sa.unitPrice")}
            value={l.unitPrice}
            onChange={(e) => set(i, "unitPrice", e.target.value)}
            id={`line-price-${i + 1}`}
          />
          <Input
            aria-label={`${t("sa.discount")} ${i + 1}`}
            inputMode="decimal"
            placeholder="%"
            value={l.discountPercent}
            onChange={(e) => set(i, "discountPercent", e.target.value)}
            id={`line-disc-${i + 1}`}
          />
          <button
            type="button"
            className="text-red-700"
            aria-label="×"
            disabled={lines.length === 1}
            onClick={() => setLines(lines.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        onClick={() => setLines([...lines, emptyLine()])}
      >
        {t("sa.addRow")}
      </Button>
    </fieldset>
  );
}

/** A new quotation (no `revising`), or the next revision of one. */
export function QuotationDialog({
  companyId,
  revising,
  customerId,
  onClose,
  onDone,
}: {
  companyId: string;
  revising?: QuotationDetail;
  customerId?: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    customerId: revising?.customer.id ?? customerId ?? "",
    opportunityId: "",
    validUntil: revising?.validUntil ?? "",
    language: revising?.language ?? "en",
    terms: revising?.terms ?? "",
  });
  const [lines, setLines] = useState<Line[]>(
    revising
      ? revising.lines.map((l) => ({
          productId: l.productId,
          quantity: String(Number(l.quantity)),
          unitPrice: l.unitPrice,
          discountPercent: String(Number(l.discountPercent)),
        }))
      : [emptyLine()],
  );
  const customers = useApi<Customer[]>(
    revising || customerId ? null : `/companies/${companyId}/customers`,
  );
  const opps = useApi<OpportunityRow[]>(
    !revising && f.customerId
      ? `/companies/${companyId}/opportunities?state=open&customerId=${f.customerId}`
      : null,
  );
  return (
    <Modal
      title={
        revising
          ? `${t("sa.revise")}: ${revising.number}`
          : t("sa.newQuotation")
      }
      open
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            validUntil: f.validUntil,
            ...(f.terms ? { terms: f.terms } : {}),
            lines: lines.map(lineBody),
          };
          const q = revising
            ? await save.run(() =>
                api.post<{ id: string }>(`/quotations/${revising.id}/revise`, {
                  ...body,
                  version: revising.version,
                }),
              )
            : await save.run(() =>
                api.post<{ id: string }>(`/companies/${companyId}/quotations`, {
                  ...body,
                  customerId: f.customerId,
                  language: f.language,
                  ...(f.opportunityId
                    ? { opportunityId: f.opportunityId }
                    : {}),
                }),
              );
          if (q && typeof q === "object") onDone(q.id);
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          {!revising && !customerId && (
            <Field label={t("sa.customer")}>
              <Select
                required
                value={f.customerId}
                onChange={(e) =>
                  setF({ ...f, customerId: e.target.value, opportunityId: "" })
                }
                id="quote-customer"
              >
                <option value="">—</option>
                {customers.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!revising && (
            <Field label={t("sa.opportunity")}>
              <Select
                value={f.opportunityId}
                onChange={(e) => setF({ ...f, opportunityId: e.target.value })}
                id="quote-opportunity"
              >
                <option value="">—</option>
                {opps.data?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number} · {o.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t("sa.validUntil")}>
            <Input
              required
              type="date"
              min={dhakaToday()}
              value={f.validUntil}
              onChange={(e) => setF({ ...f, validUntil: e.target.value })}
              id="quote-valid"
            />
          </Field>
          {!revising && (
            <Field label={t("sa.language")}>
              <Select
                value={f.language}
                onChange={(e) =>
                  setF({ ...f, language: e.target.value as "en" | "bn" })
                }
                id="quote-language"
              >
                <option value="en">English</option>
                <option value="bn">বাংলা</option>
              </Select>
            </Field>
          )}
        </div>
        <LinesEditor companyId={companyId} lines={lines} setLines={setLines} />
        <Field label={t("sa.terms")}>
          <Input
            maxLength={2000}
            value={f.terms}
            onChange={(e) => setF({ ...f, terms: e.target.value })}
            id="quote-terms"
            placeholder="Delivery within 7 days of the order; payment by cheque within 30 days"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={revising ? t("sa.revise") : t("sa.newQuotation")}
        />
      </form>
    </Modal>
  );
}

export function CreditNoteDialog({
  invoice,
  onClose,
  onDone,
}: {
  invoice: SalesInvoiceDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [returned, setReturned] = useState(false);
  return (
    <Modal
      title={`${t("sa.creditNote")}: ${invoice.invoiceNo}`}
      open
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const lines = Object.entries(qty)
            .filter(([, q]) => q && Number(q) > 0)
            .map(([invoiceLineId, quantity]) => ({ invoiceLineId, quantity }));
          if (
            await save.run(() =>
              api.post(`/sales-invoices/${invoice.id}/credit-notes`, {
                reason,
                lines,
                ...(returned ? { returnToStock: true } : {}),
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("sa.reason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="cn-reason"
          />
        </Field>
        <Table
          rows={invoice.lines}
          rowKey={(l) => l.id}
          columns={[
            {
              key: "desc",
              label: t("sa.product"),
              render: (l) => l.description,
            },
            {
              key: "q",
              label: t("sa.invoiced"),
              align: "right",
              render: (l) => `${Number(l.quantity)} ${l.unit}`,
            },
            {
              key: "c",
              label: t("sa.credited"),
              align: "right",
              render: (l) => Number(l.creditedQuantity),
            },
            {
              key: "back",
              label: t("sa.creditQty"),
              render: (l) => (
                <Input
                  aria-label={`${t("sa.creditQty")} ${l.lineNo}`}
                  inputMode="decimal"
                  className="w-24"
                  value={qty[l.id] ?? ""}
                  onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                />
              ),
            },
          ]}
        />
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={returned}
            onChange={(e) => setReturned(e.target.checked)}
            id="cn-returned"
          />{" "}
          {t("sa.returnToStock")}
        </label>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("sa.creditNote")}
        />
      </form>
    </Modal>
  );
}

export function ReceiptDialog({
  companyId,
  customerId: given,
  onClose,
  onDone,
}: {
  companyId: string;
  customerId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    customerId: given ?? "",
    receiptDate: dhakaToday(),
    method: "cheque",
    receivedIntoAccountId: "",
    amount: "",
    vdsAmount: "",
    vdsCertificateNo: "",
    chequeNo: "",
    chequeBank: "",
    reference: "",
  });
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const customers = useApi<Customer[]>(
    given ? null : `/companies/${companyId}/customers`,
  );
  const account = useApi<CustomerAccount>(
    f.customerId ? `/customers/${f.customerId}/account` : null,
  );
  const money = useApi<
    Array<{
      id: string;
      code: string;
      nameEn: string;
      role: string | null;
      postable: boolean;
    }>
  >(`/companies/${companyId}/accounts`);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const allocated = Object.values(alloc).reduce(
    (a, v) => a + (Number(v) || 0),
    0,
  );
  const received = (Number(f.amount) || 0) + (Number(f.vdsAmount) || 0);
  return (
    <Modal title={t("sa.newReceipt")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const optional = Object.fromEntries(
            Object.entries({
              vdsAmount: f.vdsAmount,
              vdsCertificateNo: f.vdsCertificateNo,
              chequeNo: f.chequeNo,
              chequeBank: f.chequeBank,
              reference: f.reference,
            }).filter(([, v]) => v !== ""),
          );
          const allocations = Object.entries(alloc)
            .filter(([, v]) => Number(v) > 0)
            .map(([itemId, amount]) => ({ itemId, amount }));
          const body = {
            customerId: f.customerId,
            receiptDate: f.receiptDate,
            method: f.method,
            receivedIntoAccountId: f.receivedIntoAccountId,
            amount: f.amount,
            ...optional,
            allocations,
          };
          if (
            await save.run(() =>
              api.post(`/companies/${companyId}/customer-receipts`, body),
            )
          )
            onDone();
        }}
      >
        <p className="mb-3 text-sm text-slate-600">{t("sa.receiptHint")}</p>
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-3">
          {!given && (
            <Field label={t("sa.customer")}>
              <Select
                required
                value={f.customerId}
                onChange={(e) => (
                  setF({ ...f, customerId: e.target.value }),
                  setAlloc({})
                )}
                id="receipt-customer"
              >
                <option value="">—</option>
                {customers.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t("sa.receiptDate")}>
            <Input
              required
              type="date"
              max={dhakaToday()}
              value={f.receiptDate}
              onChange={set("receiptDate")}
              id="receipt-date"
            />
          </Field>
          <Field label={t("sa.method")}>
            <Select
              value={f.method}
              onChange={set("method")}
              id="receipt-method"
            >
              {RECEIPT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`sa.method.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("sa.into")}>
            <Select
              required
              value={f.receivedIntoAccountId}
              onChange={set("receivedIntoAccountId")}
              id="receipt-into"
            >
              <option value="">—</option>
              {money.data
                ?.filter(
                  (a) => a.postable && (a.role === "bank" || a.role === "cash"),
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.nameEn}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t("sa.amount")}>
            <Input
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={f.amount}
              onChange={set("amount")}
              id="receipt-amount"
            />
          </Field>
          {f.method === "cheque" && (
            <Field label={t("sa.chequeNo")}>
              <Input
                required
                maxLength={40}
                value={f.chequeNo}
                onChange={set("chequeNo")}
                id="receipt-cheque"
              />
            </Field>
          )}
          {f.method === "cheque" && (
            <Field label={t("sa.chequeBank")}>
              <Input
                maxLength={100}
                value={f.chequeBank}
                onChange={set("chequeBank")}
                id="receipt-cheque-bank"
              />
            </Field>
          )}
          <Field label={t("sa.vds")}>
            <Input
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={f.vdsAmount}
              onChange={set("vdsAmount")}
              id="receipt-vds"
            />
          </Field>
          {Number(f.vdsAmount) > 0 && (
            <Field label={t("sa.vdsCert")}>
              <Input
                required
                maxLength={60}
                value={f.vdsCertificateNo}
                onChange={set("vdsCertificateNo")}
                id="receipt-vds-cert"
              />
            </Field>
          )}
          <Field label={t("sa.reference")}>
            <Input
              maxLength={100}
              value={f.reference}
              onChange={set("reference")}
              id="receipt-ref"
            />
          </Field>
        </div>
        {account.error ? (
          <ErrorBox error={account.error} onRetry={account.reload} />
        ) : (
          account.data && (
            <Table
              rows={account.data.openInvoices}
              rowKey={(i) => i.itemId}
              empty={t("st.none")}
              columns={[
                {
                  key: "ref",
                  label: t("sa.invoice"),
                  className: "font-mono text-xs",
                  render: (i) => i.reference,
                },
                {
                  key: "due",
                  label: t("sa.dueDate"),
                  render: (i) => (
                    <span>
                      {formatDate(i.dueDate, lang, { short: true })}
                      {i.daysLate > 0 && (
                        <Badge color="red"> {i.daysLate}</Badge>
                      )}
                    </span>
                  ),
                },
                {
                  key: "out",
                  label: t("sa.outstanding"),
                  align: "right",
                  render: (i) => formatTaka(i.outstanding, lang),
                },
                {
                  key: "alloc",
                  label: t("sa.allocate"),
                  render: (i) => (
                    <span className="flex items-center gap-1">
                      <Input
                        aria-label={`${t("sa.allocate")} ${i.reference}`}
                        inputMode="decimal"
                        className="w-32"
                        value={alloc[i.itemId] ?? ""}
                        onChange={(e) =>
                          setAlloc({ ...alloc, [i.itemId]: e.target.value })
                        }
                      />
                      <button
                        type="button"
                        className="text-xs underline"
                        onClick={() =>
                          setAlloc({
                            ...alloc,
                            [i.itemId]: String(
                              Number(i.outstanding) - Number(i.pending),
                            ),
                          })
                        }
                      >
                        {t("sa.total")}
                      </button>
                    </span>
                  ),
                },
              ]}
            />
          )
        )}
        <p className="mt-2 text-sm">
          {t("sa.allocated")}: {formatTaka(allocated.toFixed(2), lang)} ·{" "}
          {t("sa.onAccount")}:{" "}
          {formatTaka(Math.max(0, received - allocated).toFixed(2), lang)}
        </p>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("sa.newReceipt")}
        />
      </form>
    </Modal>
  );
}

/** What a customer owes and has on account, and the statement for a period. */
export function CustomerAccountPanel({
  customerId,
  canApply,
}: {
  customerId: string;
  canApply?: boolean;
}) {
  const { t, lang } = useI18n();
  const account = useApi<CustomerAccount>(`/customers/${customerId}/account`);
  const apply = useAction();
  const today = dhakaToday();
  const [range, setRange] = useState({
    from: `${today.slice(0, 7)}-01`,
    to: today,
  });
  const statement = useApi<Statement>(
    range.from && range.to
      ? `/customers/${customerId}/statement?from=${range.from}&to=${range.to}`
      : null,
  );
  if (account.error)
    return <ErrorBox error={account.error} onRetry={account.reload} />;
  return (
    <Panel
      title={t("sa.statement")}
      actions={
        <div className="flex gap-2">
          <Field label={t("sa.from")}>
            <Input
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
              id="statement-from"
            />
          </Field>
          <Field label={t("sa.to")}>
            <Input
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
              id="statement-to"
            />
          </Field>
        </div>
      }
    >
      {account.data && (
        <p className="mb-3 text-sm">
          {t("sa.owed")}: <strong>{formatTaka(account.data.owed, lang)}</strong>{" "}
          · {t("sa.onAccount")}: {formatTaka(account.data.onAccount, lang)}
        </p>
      )}
      <ActionMessage action={apply} />
      {canApply &&
        account.data &&
        Number(account.data.onAccount) > 0 &&
        account.data.openInvoices.length > 0 && (
          <ul className="mb-3 space-y-1 text-sm">
            {account.data.openInvoices.map((i) => {
              const amount = Math.min(
                Number(account.data!.onAccount),
                Number(i.outstanding) - Number(i.pending),
              ).toFixed(2);
              return (
                Number(amount) > 0 && (
                  <li
                    key={i.itemId}
                    className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1"
                  >
                    <span className="font-mono text-xs">
                      {i.reference} · {formatTaka(i.outstanding, lang)}
                    </span>
                    <Button
                      variant="secondary"
                      className="min-h-7 px-2 py-0.5 text-xs"
                      busy={apply.busy}
                      onClick={() =>
                        apply
                          .run(
                            () =>
                              api.post(
                                `/customers/${customerId}/apply-advance`,
                                { itemId: i.itemId, amount },
                              ),
                            t("p.done"),
                          )
                          .then(
                            (ok) =>
                              ok && (account.reload(), statement.reload()),
                          )
                      }
                    >
                      {t("sa.applyAdvance")} ({formatTaka(amount, lang)})
                    </Button>
                  </li>
                )
              );
            })}
          </ul>
        )}
      {statement.error ? (
        <ErrorBox error={statement.error} onRetry={statement.reload} />
      ) : (
        statement.data && (
          <>
            <p className="mb-2 text-sm text-slate-600">
              {t("sa.opening")}: {formatTaka(statement.data.opening, lang)}
            </p>
            <Table
              rows={statement.data.lines}
              rowKey={(l) => `${l.kind}-${l.number}`}
              empty={t("st.none")}
              columns={[
                {
                  key: "date",
                  label: t("sa.receiptDate"),
                  render: (l) => formatDate(l.date, lang, { short: true }),
                },
                {
                  key: "kind",
                  label: t("sa.kind"),
                  render: (l) => t(`sa.kind.${l.kind}`),
                },
                {
                  key: "no",
                  label: t("sa.number"),
                  className: "font-mono text-xs",
                  render: (l) => (
                    <span>
                      {l.number}
                      {l.detail && (
                        <span className="block font-sans text-slate-500">
                          {l.detail}
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  key: "dr",
                  label: t("sa.debit"),
                  align: "right",
                  render: (l) =>
                    Number(l.debit) ? formatTaka(l.debit, lang) : "",
                },
                {
                  key: "cr",
                  label: t("sa.credit"),
                  align: "right",
                  render: (l) =>
                    Number(l.credit) ? formatTaka(l.credit, lang) : "",
                },
                {
                  key: "bal",
                  label: t("sa.balance"),
                  align: "right",
                  render: (l) => formatTaka(l.balance, lang),
                },
              ]}
            />
            <p className="mt-2 text-sm font-semibold">
              {t("sa.closing")}: {formatTaka(statement.data.closing, lang)}
            </p>
          </>
        )
      )}
    </Panel>
  );
}

export function PdfButtons({ path, name }: { path: string; name: string }) {
  const { t } = useI18n();
  const download = useAction();
  return (
    <>
      {(["en", "bn"] as const).map((l) => (
        <Button
          key={l}
          variant="ghost"
          busy={download.busy}
          onClick={() =>
            download.run(async () =>
              saveDownload(
                await api.file(`${path}?lang=${l}`),
                `${name}-${l}.pdf`,
              ),
            )
          }
        >
          {t("sa.pdf")} {l === "bn" ? "বাংলা" : "English"}
        </Button>
      ))}
    </>
  );
}
