"use client";
/**
 * Procurement pieces of the portal (WP17):
 *   QuotationDialog   Accounts records a vendor's prices for every requisition line
 *   ChooseDialog      the comparative statement: the chosen quotation (+ reason when not the lowest)
 *   OrderDialog       raise the purchase order from a quotation, with the account of each line
 *   ReceiveDialog     goods / services received against the order
 *   BillFromOrder     a vendor bill for what was received and not yet billed
 *   MatchPanel        the three-way match of a bill; the Admin may accept a variance
 *   SettingsPanel     thresholds and the match tolerance
 */
import { useState } from "react";
import { AccountSelect, Taka, useAccounts } from "@/components/portal/finance";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { Vendor } from "@/lib/finance-types";
import { dhakaToday } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  MATCH_COLOR,
  type MatchDetails,
  type MatchStatus,
  type Order,
  type ProcurementSettings,
  type Quotation,
  type Requisition,
} from "@/lib/procurement-types";
import {
  ActionMessage,
  FormButtons,
  Modal,
  Panel,
  Table,
  useAction,
} from "./kit";
import { usePortal } from "./portal-context";

const expense = (a: { role: string | null }) =>
  !["cash", "bank", "payables", "employee_advances"].includes(a.role ?? "");

export function QuotationDialog({
  r,
  onClose,
  onDone,
}: {
  r: Requisition;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const vendors = useApi<Vendor[]>(
    `/companies/${r.companyId}/vendors?active=true`,
  );
  const [f, setF] = useState({
    vendorId: "",
    reference: "",
    quotationDate: dhakaToday(),
    validUntil: "",
    deliveryDays: "",
    note: "",
  });
  const [prices, setPrices] = useState<
    Record<string, { unitPrice: string; vatPercent: string }>
  >(
    Object.fromEntries(
      r.lines.map((l) => [l.id, { unitPrice: "", vatPercent: "15" }]),
    ),
  );
  const total = r.lines.reduce((s, l) => {
    const p = prices[l.id];
    const base = Number(l.quantity) * Number(p.unitPrice || 0);
    return s + base + (base * Number(p.vatPercent || 0)) / 100;
  }, 0);
  const used = new Set(
    r.quotations.filter((q) => q.state === "active").map((q) => q.vendorId),
  );
  return (
    <Modal title={t("pr.p.addQuotation")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            vendorId: f.vendorId,
            reference: f.reference,
            quotationDate: f.quotationDate,
            ...(f.validUntil ? { validUntil: f.validUntil } : {}),
            ...(f.deliveryDays ? { deliveryDays: Number(f.deliveryDays) } : {}),
            ...(f.note ? { note: f.note } : {}),
            lines: r.lines.map((l) => ({
              requisitionLineId: l.id,
              unitPrice: prices[l.id].unitPrice,
              vatPercent: prices[l.id].vatPercent,
            })),
          };
          if (
            await save.run(() =>
              api.post(`/purchase-requisitions/${r.id}/quotations`, body),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label={t("pr.p.vendor")}>
            <Select
              required
              value={f.vendorId}
              onChange={(e) => setF({ ...f, vendorId: e.target.value })}
              id="q-vendor"
            >
              <option value="">—</option>
              {vendors.data
                ?.filter((v) => !used.has(v.id))
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.code} · {v.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t("pr.p.quotationRef")}>
            <Input
              required
              maxLength={60}
              value={f.reference}
              onChange={(e) => setF({ ...f, reference: e.target.value })}
              id="q-ref"
            />
          </Field>
          <Field label={t("pr.p.quotationDate")}>
            <Input
              type="date"
              required
              value={f.quotationDate}
              onChange={(e) => setF({ ...f, quotationDate: e.target.value })}
              id="q-date"
            />
          </Field>
          <Field label={t("pr.p.validUntil")}>
            <Input
              type="date"
              value={f.validUntil}
              onChange={(e) => setF({ ...f, validUntil: e.target.value })}
              id="q-valid"
            />
          </Field>
          <Field label={t("pr.p.deliveryDays")}>
            <Input
              type="number"
              min={0}
              max={365}
              value={f.deliveryDays}
              onChange={(e) => setF({ ...f, deliveryDays: e.target.value })}
              id="q-days"
            />
          </Field>
          <Field label={t("lv.emp.note")}>
            <Input
              maxLength={500}
              value={f.note}
              onChange={(e) => setF({ ...f, note: e.target.value })}
              id="q-note"
            />
          </Field>
        </div>
        <table className="mb-3 w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1">{t("pr.item")}</th>
              <th className="py-1 text-right">{t("pr.qty")}</th>
              <th className="py-1">{t("pr.p.unitPrice")}</th>
              <th className="py-1">{t("pr.p.vat")}</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l, i) => (
              <tr key={l.id}>
                <td className="py-1 pr-2">{l.description}</td>
                <td className="py-1 pr-2 text-right">
                  {l.quantity} {l.unit}
                </td>
                <td className="py-1 pr-2">
                  <Input
                    required
                    inputMode="decimal"
                    pattern="\d+(\.\d{1,2})?"
                    aria-label={`${t("pr.p.unitPrice")} ${i + 1}`}
                    value={prices[l.id].unitPrice}
                    onChange={(e) =>
                      setPrices({
                        ...prices,
                        [l.id]: { ...prices[l.id], unitPrice: e.target.value },
                      })
                    }
                    id={`q-price-${i}`}
                  />
                </td>
                <td className="w-20 py-1">
                  <Input
                    inputMode="decimal"
                    aria-label={`${t("pr.p.vat")} ${i + 1}`}
                    value={prices[l.id].vatPercent}
                    onChange={(e) =>
                      setPrices({
                        ...prices,
                        [l.id]: { ...prices[l.id], vatPercent: e.target.value },
                      })
                    }
                    id={`q-vat-${i}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mb-3 text-right font-semibold">
          {t("pr.p.total")}: <Taka value={total.toFixed(2)} />
        </p>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("pr.p.addQuotation")}
        />
      </form>
    </Modal>
  );
}

export function ChooseDialog({
  r,
  q,
  onClose,
  onDone,
}: {
  r: Requisition;
  q: Quotation;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={`${t("pr.p.chooseTitle")}: ${q.vendorName}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/purchase-requisitions/${r.id}/comparative-statement`, {
                quotationId: q.id,
                ...(reason ? { reason } : {}),
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <p className="mb-3 text-sm">
          {q.reference} · <Taka value={q.total} />{" "}
          {q.lowest && <Badge color="green">{t("pr.p.lowest")}</Badge>}
        </p>
        <Field label={t("pr.p.reason")}>
          <Input
            required={!q.lowest}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="cs-reason"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("pr.p.choose")}
        />
      </form>
    </Modal>
  );
}

export function OrderDialog({
  r,
  q,
  onClose,
  onDone,
}: {
  r: Requisition;
  q: Quotation;
  onClose: () => void;
  onDone: (orderId: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const { postable } = useAccounts(r.companyId);
  const [f, setF] = useState({
    orderDate: dhakaToday(),
    deliveryDate: "",
    deliverTo: "",
    terms: "",
  });
  const [accounts, setAccounts] = useState<Record<string, string>>(
    Object.fromEntries(r.lines.map((l) => [l.id, ""])),
  );
  return (
    <Modal
      title={`${t("pr.p.makeOrder")}: ${q.vendorName}`}
      open
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            quotationId: q.id,
            orderDate: f.orderDate,
            ...(f.deliveryDate ? { deliveryDate: f.deliveryDate } : {}),
            ...(f.deliverTo ? { deliverTo: f.deliverTo } : {}),
            ...(f.terms ? { terms: f.terms } : {}),
            lines: r.lines.map((l) => ({
              requisitionLineId: l.id,
              accountId: accounts[l.id],
            })),
          };
          const order = await save.run(() =>
            api.post<{ id: string }>(
              `/purchase-requisitions/${r.id}/purchase-orders`,
              body,
            ),
          );
          if (order && typeof order === "object") onDone(order.id);
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("pr.p.orderDate")}>
            <Input
              type="date"
              required
              value={f.orderDate}
              onChange={(e) => setF({ ...f, orderDate: e.target.value })}
              id="po-date"
            />
          </Field>
          <Field label={t("pr.p.deliveryDate")}>
            <Input
              type="date"
              value={f.deliveryDate}
              onChange={(e) => setF({ ...f, deliveryDate: e.target.value })}
              id="po-delivery"
            />
          </Field>
          <Field label={t("pr.p.deliverTo")}>
            <Input
              maxLength={300}
              value={f.deliverTo}
              onChange={(e) => setF({ ...f, deliverTo: e.target.value })}
              id="po-deliver-to"
            />
          </Field>
          <Field label={t("pr.p.terms")}>
            <Input
              maxLength={1000}
              value={f.terms}
              onChange={(e) => setF({ ...f, terms: e.target.value })}
              id="po-terms"
            />
          </Field>
        </div>
        {r.lines.map((l, i) => (
          <Field
            key={l.id}
            label={`${l.quantity} ${l.unit} · ${l.description} → ${t("pr.p.account")}`}
          >
            <AccountSelect
              accounts={postable}
              filter={expense}
              value={accounts[l.id]}
              onChange={(id) => setAccounts({ ...accounts, [l.id]: id })}
              required
              id={`po-account-${i}`}
            />
          </Field>
        ))}
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("pr.p.makeOrder")}
        />
      </form>
    </Modal>
  );
}

export function ReceiveDialog({
  o,
  onClose,
  onDone,
}: {
  o: Order;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const open = o.lines.filter((l) => Number(l.toReceive) > 0);
  const [f, setF] = useState({ receivedDate: dhakaToday(), note: "" });
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(open.map((l) => [l.id, l.toReceive])),
  );
  return (
    <Modal title={`${t("pr.p.receive")}: ${o.number}`} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const lines = open
            .filter((l) => Number(qty[l.id]) > 0)
            .map((l) => ({ poLineId: l.id, quantity: qty[l.id] }));
          if (
            await save.run(() =>
              api.post(`/purchase-orders/${o.id}/receipts`, {
                receivedDate: f.receivedDate,
                ...(f.note ? { note: f.note } : {}),
                lines,
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("pr.p.receivedDate")}>
          <Input
            type="date"
            required
            value={f.receivedDate}
            onChange={(e) => setF({ ...f, receivedDate: e.target.value })}
            id="grn-date"
          />
        </Field>
        {open.map((l, i) => (
          <Field
            key={l.id}
            label={`${l.description} (${t("pr.p.toReceive")}: ${l.toReceive} ${l.unit})`}
          >
            <Input
              inputMode="decimal"
              pattern="\d+(\.\d{1,3})?"
              value={qty[l.id]}
              onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
              id={`grn-qty-${i}`}
            />
          </Field>
        ))}
        <Field label={t("lv.emp.note")}>
          <Input
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="grn-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("pr.p.receive")}
        />
      </form>
    </Modal>
  );
}

/** A bill for what was received and not yet billed: lines from the order, prices editable. */
export function BillFromOrder({
  o,
  onClose,
  onDone,
}: {
  o: Order;
  onClose: () => void;
  onDone: (billId: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const open = o.lines.filter((l) => Number(l.received) - Number(l.billed) > 0);
  const [f, setF] = useState({
    billNo: "",
    billDate: dhakaToday(),
    narration: `${o.number}: ${o.requisition.title}`,
  });
  const [lines, setLines] = useState(
    open.map((l) => ({
      poLineId: l.id,
      quantity: String(Number(l.received) - Number(l.billed)),
      unitPrice: l.unitPrice,
      include: true,
    })),
  );
  const set = (i: number, patch: Partial<(typeof lines)[number]>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Modal
      title={`${t("pr.p.enterBill")}: ${o.vendor.name}`}
      open
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            vendorId: o.vendorId,
            billNo: f.billNo,
            billDate: f.billDate,
            narration: f.narration,
            purchaseOrderId: o.id,
            lines: lines
              .filter((l) => l.include)
              .map((l) => {
                const po = o.lines.find((x) => x.id === l.poLineId)!;
                return {
                  accountId: po.accountId,
                  description: po.description,
                  amount: (Number(l.quantity) * Number(l.unitPrice)).toFixed(2),
                  vatPercent: po.vatPercent,
                  poLineId: l.poLineId,
                  quantity: l.quantity,
                };
              }),
          };
          const bill = await save.run(() =>
            api.post<{ id: string }>(
              `/companies/${o.companyId}/vendor-bills`,
              body,
            ),
          );
          if (bill && typeof bill === "object") onDone(bill.id);
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label={t("f.b.billNo")}>
            <Input
              required
              maxLength={60}
              value={f.billNo}
              onChange={(e) => setF({ ...f, billNo: e.target.value })}
              id="pobill-no"
            />
          </Field>
          <Field label={t("f.b.billDate")}>
            <Input
              type="date"
              required
              value={f.billDate}
              onChange={(e) => setF({ ...f, billDate: e.target.value })}
              id="pobill-date"
            />
          </Field>
          <Field label={t("f.v.narration")}>
            <Input
              required
              maxLength={500}
              value={f.narration}
              onChange={(e) => setF({ ...f, narration: e.target.value })}
              id="pobill-narration"
            />
          </Field>
        </div>
        <table className="mb-3 w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th />
              <th className="py-1">{t("pr.item")}</th>
              <th className="py-1">{t("pr.qty")}</th>
              <th className="py-1">{t("pr.p.unitPrice")}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const po = o.lines.find((x) => x.id === l.poLineId)!;
              return (
                <tr key={l.poLineId}>
                  <td className="py-1 pr-2">
                    <input
                      type="checkbox"
                      checked={l.include}
                      onChange={(e) => set(i, { include: e.target.checked })}
                      aria-label={po.description}
                    />
                  </td>
                  <td className="py-1 pr-2">{po.description}</td>
                  <td className="w-28 py-1 pr-2">
                    <Input
                      inputMode="decimal"
                      aria-label={`${t("pr.qty")} ${i + 1}`}
                      value={l.quantity}
                      onChange={(e) => set(i, { quantity: e.target.value })}
                      id={`pobill-qty-${i}`}
                    />
                  </td>
                  <td className="w-32 py-1">
                    <Input
                      inputMode="decimal"
                      aria-label={`${t("pr.p.unitPrice")} ${i + 1}`}
                      value={l.unitPrice}
                      onChange={(e) => set(i, { unitPrice: e.target.value })}
                      id={`pobill-price-${i}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("p.create")}
        />
      </form>
    </Modal>
  );
}

/** On a bill against a PO: the match, line by line; the Admin may accept a variance. */
export function MatchPanel({
  bill,
  onChanged,
}: {
  bill: {
    id: string;
    purchaseOrderId: string | null;
    matchStatus: MatchStatus;
    matchDetails: MatchDetails | null;
    matchOverrideReason: string | null;
  };
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { can } = usePortal();
  const [overriding, setOverriding] = useState(false);
  if (!bill.purchaseOrderId) return null;
  const d = bill.matchDetails;
  return (
    <Panel
      title={t("pr.m.title")}
      actions={
        <>
          <Badge color={MATCH_COLOR[bill.matchStatus]}>
            {t(`pr.m.${bill.matchStatus}`)}
          </Badge>
          {bill.matchStatus === "mismatch" &&
            can("procurement.override_match") && (
              <Button variant="secondary" onClick={() => setOverriding(true)}>
                {t("pr.m.override")}
              </Button>
            )}
        </>
      }
    >
      {bill.matchOverrideReason && (
        <p className="mb-2 text-sm text-amber-800">
          “{bill.matchOverrideReason}”
        </p>
      )}
      {d && (
        <Table
          rows={d.lines}
          rowKey={(l) => l.poLineId}
          columns={[
            { key: "item", label: t("pr.item"), render: (l) => l.description },
            {
              key: "ordered",
              label: t("pr.p.ordered"),
              align: "right",
              render: (l) => l.orderedQty,
            },
            {
              key: "received",
              label: t("pr.p.received"),
              align: "right",
              render: (l) => l.receivedQty,
            },
            {
              key: "billed",
              label: t("pr.p.billed"),
              align: "right",
              render: (l) => l.billedTotalQty,
            },
            {
              key: "price",
              label: t("pr.p.unitPrice"),
              align: "right",
              render: (l) => (
                <span>
                  {l.billUnitPrice} / {l.poUnitPrice}
                </span>
              ),
            },
            {
              key: "problems",
              label: "",
              render: (l) => (
                <span className="text-xs text-red-700">
                  {l.problems.map((p) => t(`pr.m.problem.${p}`)).join(", ")}
                </span>
              ),
            },
          ]}
        />
      )}
      {overriding && (
        <OverrideDialog
          billId={bill.id}
          onClose={() => setOverriding(false)}
          onDone={() => (setOverriding(false), onChanged())}
        />
      )}
    </Panel>
  );
}

function OverrideDialog({
  billId,
  onClose,
  onDone,
}: {
  billId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal title={t("pr.m.override")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/vendor-bills/${billId}/match-override`, { reason }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("pr.m.overrideReason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="override-reason"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("pr.m.override")}
        />
      </form>
    </Modal>
  );
}

export function SettingsPanel({ companyId }: { companyId: string }) {
  const { t } = useI18n();
  const { can } = usePortal();
  const settings = useApi<ProcurementSettings>(
    `/companies/${companyId}/procurement-settings`,
  );
  const save = useAction();
  const [f, setF] = useState<ProcurementSettings | null>(null);
  if (!settings.data) return null;
  const v = f ?? settings.data;
  const manage = can("procurement.manage");
  return (
    <Panel>
      <ActionMessage action={save} />
      <form
        className="grid items-end gap-x-3 sm:grid-cols-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(
              () =>
                api.put(`/companies/${companyId}/procurement-settings`, {
                  ...v,
                  minQuotations: Number(v.minQuotations),
                }),
              t("p.saved"),
            )
          ) {
            setF(null);
            settings.reload();
          }
        }}
      >
        <Field label={t("pr.s.quotationThreshold")}>
          <Input
            disabled={!manage}
            inputMode="decimal"
            value={v.quotationThreshold}
            onChange={(e) => setF({ ...v, quotationThreshold: e.target.value })}
            id="ps-quotation"
          />
        </Field>
        <Field label={t("pr.s.minQuotations")}>
          <Input
            disabled={!manage}
            type="number"
            min={1}
            max={10}
            value={v.minQuotations}
            onChange={(e) =>
              setF({ ...v, minQuotations: Number(e.target.value) })
            }
            id="ps-min"
          />
        </Field>
        <Field label={t("pr.s.adminThreshold")}>
          <Input
            disabled={!manage}
            inputMode="decimal"
            value={v.adminThreshold}
            onChange={(e) => setF({ ...v, adminThreshold: e.target.value })}
            id="ps-admin"
          />
        </Field>
        <Field label={t("pr.s.tolerance")}>
          <Input
            disabled={!manage}
            inputMode="decimal"
            value={v.matchTolerancePercent}
            onChange={(e) =>
              setF({ ...v, matchTolerancePercent: e.target.value })
            }
            id="ps-tolerance"
          />
        </Field>
        {manage && (
          <div className="mb-3">
            <Button type="submit" busy={save.busy} className="w-full">
              {t("p.save")}
            </Button>
          </div>
        )}
      </form>
      <p className="text-xs text-amber-700">{t("pr.s.hint")}</p>
    </Panel>
  );
}
