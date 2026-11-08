"use client";
/**
 * VAT pieces of the portal (WP21):
 *   ReturnPanel      a month's Mushak 9.1 figures, the tie to the ledger, filing, the VAT challan
 *   SalesPanel       the sales register and a new VAT invoice (Mushak 6.3)
 *   PurchasesPanel   the purchase register (approved vendor bills)
 *   ItemsPanel       VAT items and their rates per fiscal year
 */
import Link from "next/link";
import { useState } from "react";
import { AccountSelect, Taka, useAccounts } from "@/components/portal/finance";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dhakaToday, formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  RATE_CLASSES,
  type PurchaseLine,
  type VatItem,
  type VatRateClass,
  type VatReturn,
  type VatReturnPreview,
  type VatSale,
} from "@/lib/vat-types";
import {
  ActionMessage,
  FormButtons,
  Modal,
  Panel,
  Table,
  useAction,
} from "./kit";
import { usePortal } from "./portal-context";

const MONEY = "\\d+(\\.\\d{1,2})?";
const SALE_COLOR = {
  in_approval: "amber",
  posted: "green",
  cancelled: "gray",
  reversed: "gray",
} as const;

/** The national fiscal year (July-June) of a date. */
export const fiscalYearOf = (date: string) => {
  const [y, m] = date.split("-").map(Number);
  const s = m >= 7 ? y : y - 1;
  return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
};

export const lastMonth = () => {
  const [y, m] = dhakaToday().split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

// ------------------------------------------------------------ the return

export function ReturnPanel({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const [period, setPeriod] = useState(lastMonth());
  const preview = useApi<VatReturnPreview>(
    `/companies/${companyId}/vat-returns/preview?period=${period}`,
  );
  const returns = useApi<VatReturn[]>(`/companies/${companyId}/vat-returns`);
  const filed = useApi<VatReturn>(
    preview.data?.filedReturnId
      ? `/vat-returns/${preview.data.filedReturnId}`
      : null,
  );
  const [dialog, setDialog] = useState<"file" | "challan" | null>(null);
  const reload = () => (
    setDialog(null),
    preview.reload(),
    returns.reload(),
    filed.reload()
  );
  const p = preview.data;
  const f = p?.figures;
  const row = (label: string, value: string | undefined, strong = false) => (
    <div
      className={`flex justify-between gap-4 border-b border-slate-100 py-1.5 ${strong ? "font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">
        <Taka value={value} />
      </span>
    </div>
  );
  return (
    <>
      <Panel
        title={t("vt.preview")}
        actions={
          <>
            <Field label={t("vt.period")}>
              <Input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                id="vat-period"
              />
            </Field>
            {can("vat.manage") &&
              p &&
              !p.filedReturnId &&
              period < dhakaToday().slice(0, 7) && (
                <Button
                  className="mb-3"
                  disabled={!p.tied}
                  onClick={() => setDialog("file")}
                >
                  {t("vt.file")}
                </Button>
              )}
          </>
        }
      >
        <p className="mb-3 text-xs text-slate-500">{t("vt.placeholder")}</p>
        {preview.error ? (
          <ErrorBox error={preview.error} onRetry={preview.reload} />
        ) : !f ? (
          <Loading />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="text-sm">
              <h3 className="mb-2 font-semibold">{t("vt.sales")}</h3>
              <ClassTable
                totals={f.sales.byClass}
                notes={f.notes.sales}
                showSd
              />
              <h3 className="mb-2 mt-4 font-semibold">{t("vt.purchases")}</h3>
              <ClassTable
                totals={f.purchases.byClass}
                notes={f.notes.purchases}
              />
              {Number(f.purchases.notClaimable.vat) > 0 && (
                <p className="mt-1 text-xs text-slate-600">
                  {t("vt.notClaimable")}:{" "}
                  {formatTaka(f.purchases.notClaimable.vat, lang)}
                </p>
              )}
            </div>
            <div className="text-sm">
              {row(t("vt.outputTax"), f.outputTax)}
              {row(t("vt.inputTax"), f.inputTax)}
              {row(t("vt.vdsByCustomers"), f.decreasing.vdsByCustomers)}
              {row(t("vt.carryIn"), f.carryForwardIn)}
              {row(t("vt.netTax"), f.netTax, true)}
              {row(t("vt.netPayable"), f.netPayable, true)}
              {row(t("vt.carryOut"), f.carryForwardOut)}
              <p className="mt-3 text-xs text-slate-600">
                {t("vt.vdsDeducted")}: {formatTaka(f.vds.deducted, lang)}
                {Number(f.vds.stillToDeposit) > 0 && (
                  <span className="text-amber-700">
                    {" "}
                    ·{" "}
                    {t("vt.vdsStill", {
                      amount: formatTaka(f.vds.stillToDeposit, lang),
                    })}
                  </span>
                )}
              </p>
            </div>
          </div>
        )}
      </Panel>
      {p && (
        <Panel title={t("vt.ties")}>
          <p
            className={`mb-3 rounded-lg px-3 py-2 text-sm font-medium ${p.tied ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}
            role="status"
          >
            {p.tied ? t("vt.tied") : t("vt.notTied")}
          </p>
          <Table
            rows={p.ties}
            rowKey={(x) => x.key}
            columns={[
              {
                key: "what",
                label: "",
                render: (x) =>
                  `${x.accountCode ?? ""} · ${t(`vt.tie.${x.key}`)}`,
              },
              {
                key: "docs",
                label: t("vt.fromDocuments"),
                align: "right",
                render: (x) => <Taka value={x.fromDocuments} />,
              },
              {
                key: "ledger",
                label: t("vt.inLedger"),
                align: "right",
                render: (x) => <Taka value={x.inLedger} />,
              },
              {
                key: "diff",
                label: t("vt.difference"),
                align: "right",
                render: (x) => (
                  <span
                    className={
                      Number(x.difference) !== 0
                        ? "font-semibold text-red-700"
                        : ""
                    }
                  >
                    <Taka value={x.difference} />
                  </span>
                ),
              },
            ]}
          />
          {p.ties.flatMap((x) => x.unexplained).length > 0 && (
            <ul className="mt-3 text-sm">
              {p.ties
                .flatMap((x) =>
                  x.unexplained.map((u) => ({ ...u, key: x.key })),
                )
                .map((u) => (
                  <li key={`${u.key}-${u.voucherId}`}>
                    <Link
                      className="font-mono text-xs underline"
                      href={`/portal/finance/vouchers/${u.voucherId}`}
                    >
                      {u.voucherNumber}
                    </Link>{" "}
                    · {formatDate(u.voucherDate, lang, { short: true })} ·{" "}
                    {u.narration} · <Taka value={u.amount} />
                  </li>
                ))}
            </ul>
          )}
        </Panel>
      )}
      {filed.data && (
        <Panel
          title={t("vt.filed", {
            date: formatDate(filed.data.submittedOn, lang),
          })}
          actions={
            can("vat.manage") &&
            Number(filed.data.netPayable) > 0 &&
            !filed.data.challan && (
              <Button onClick={() => setDialog("challan")}>
                {t("vt.makeChallan")}
              </Button>
            )
          }
        >
          <div className="text-sm">
            {filed.data.submissionRef && (
              <p>
                {t("vt.submissionRef")}:{" "}
                <span className="font-mono">{filed.data.submissionRef}</span>
              </p>
            )}
            {filed.data.settlementVoucher && (
              <p>
                {t("vt.settlement")}:{" "}
                <Link
                  className="font-mono underline"
                  href={`/portal/finance/vouchers/${filed.data.settlementVoucher.id}`}
                >
                  {filed.data.settlementVoucher.number}
                </Link>
              </p>
            )}
            {filed.data.challan && (
              <p>
                {t("vt.challan")}:{" "}
                <span className="font-mono">
                  {filed.data.challan.challanNo}
                </span>{" "}
                · {formatTaka(filed.data.challan.amount, lang)} ·{" "}
                <Badge
                  color={
                    filed.data.challan.state === "deposited" ? "green" : "amber"
                  }
                >
                  {filed.data.challan.state}
                </Badge>
              </p>
            )}
            {filed.data.changedSinceFiling && (
              <p className="mt-2 text-amber-800">{t("vt.changed")}</p>
            )}
          </div>
        </Panel>
      )}
      <Panel title={t("vt.returns")}>
        <Table
          rows={returns.data}
          rowKey={(r) => r.id}
          empty={t("st.none")}
          onRowClick={(r) => setPeriod(r.period)}
          columns={[
            {
              key: "period",
              label: t("vt.period"),
              className: "font-mono",
              render: (r) => r.period,
            },
            {
              key: "out",
              label: t("vt.outputTax"),
              align: "right",
              render: (r) => <Taka value={r.outputVat} />,
            },
            {
              key: "in",
              label: t("vt.inputTax"),
              align: "right",
              render: (r) => <Taka value={r.inputVat} />,
            },
            {
              key: "pay",
              label: t("vt.netPayable"),
              align: "right",
              render: (r) => <Taka value={r.netPayable} />,
            },
            {
              key: "carry",
              label: t("vt.carryOut"),
              align: "right",
              render: (r) => <Taka value={r.carryForward} />,
            },
            {
              key: "challan",
              label: t("vt.challan"),
              render: (r) =>
                r.challanNo ? `${r.challanNo} · ${r.challanState}` : "",
            },
          ]}
        />
      </Panel>
      {dialog === "file" && (
        <FileDialog
          companyId={companyId}
          period={period}
          onClose={() => setDialog(null)}
          onDone={reload}
        />
      )}
      {dialog === "challan" && filed.data && (
        <ChallanDialog
          companyId={companyId}
          vatReturn={filed.data}
          onClose={() => setDialog(null)}
          onDone={reload}
        />
      )}
    </>
  );
}

function ClassTable({
  totals,
  notes,
  showSd,
}: {
  totals: Record<VatRateClass, { value: string; sd: string; vat: string }>;
  notes: Record<string, number>;
  showSd?: boolean;
}) {
  const { t } = useI18n();
  return (
    <table className="w-full">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-slate-500">
          <th className="py-1 text-left">{t("vt.note")}</th>
          <th className="py-1 text-left">{t("vt.rateClass")}</th>
          <th className="py-1 text-right">{t("vt.value")}</th>
          {showSd && <th className="py-1 text-right">{t("vt.sd")}</th>}
          <th className="py-1 text-right">{t("vt.vat")}</th>
        </tr>
      </thead>
      <tbody>
        {RATE_CLASSES.map((c) => (
          <tr key={c} className="border-t border-slate-100">
            <td className="py-1 text-xs text-slate-500">{notes[c]}</td>
            <td className="py-1">{t(`vt.class.${c}`)}</td>
            <td className="py-1 text-right">
              <Taka value={totals[c].value} />
            </td>
            {showSd && (
              <td className="py-1 text-right">
                <Taka value={totals[c].sd} />
              </td>
            )}
            <td className="py-1 text-right">
              <Taka value={totals[c].vat} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FileDialog({
  companyId,
  period,
  onClose,
  onDone,
}: {
  companyId: string;
  period: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({ submittedOn: dhakaToday(), submissionRef: "" });
  return (
    <Modal title={`${t("vt.file")}: ${period}`} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/companies/${companyId}/vat-returns`, {
                period,
                submittedOn: f.submittedOn,
                ...(f.submissionRef ? { submissionRef: f.submissionRef } : {}),
              }),
            )
          )
            onDone();
        }}
      >
        <p className="mb-3 text-sm text-slate-600">{t("vt.fileHint")}</p>
        <ActionMessage action={save} />
        <Field label={t("vt.submittedOn")}>
          <Input
            type="date"
            required
            value={f.submittedOn}
            onChange={(e) => setF({ ...f, submittedOn: e.target.value })}
            id="vat-submitted"
          />
        </Field>
        <Field label={t("vt.submissionRef")}>
          <Input
            maxLength={60}
            value={f.submissionRef}
            onChange={(e) => setF({ ...f, submissionRef: e.target.value })}
            id="vat-ref"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("vt.file")}
        />
      </form>
    </Modal>
  );
}

function ChallanDialog({
  companyId,
  vatReturn,
  onClose,
  onDone,
}: {
  companyId: string;
  vatReturn: VatReturn;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const accounts = useAccounts(companyId);
  const [f, setF] = useState({
    challanNo: "",
    challanDate: dhakaToday(),
    paidFromAccountId: "",
  });
  return (
    <Modal
      title={`${t("vt.makeChallan")}: ${formatTaka(vatReturn.netPayable, lang)}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/vat-returns/${vatReturn.id}/challan`, f),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("vt.challanNo")}>
          <Input
            required
            maxLength={60}
            value={f.challanNo}
            onChange={(e) => setF({ ...f, challanNo: e.target.value })}
            id="vat-challan-no"
          />
        </Field>
        <Field label={t("vt.challanDate")}>
          <Input
            type="date"
            required
            value={f.challanDate}
            onChange={(e) => setF({ ...f, challanDate: e.target.value })}
            id="vat-challan-date"
          />
        </Field>
        <Field label={t("vt.paidFrom")}>
          <AccountSelect
            id="vat-challan-from"
            required
            accounts={accounts.postable}
            value={f.paidFromAccountId}
            onChange={(paidFromAccountId) => setF({ ...f, paidFromAccountId })}
            filter={(a) => a.role === "bank" || a.role === "cash"}
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("vt.makeChallan")}
        />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------ sales

export function SalesPanel({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const [period, setPeriod] = useState(dhakaToday().slice(0, 7));
  const sales = useApi<VatSale[]>(
    `/companies/${companyId}/vat-sales?period=${period}`,
  );
  const [creating, setCreating] = useState(false);
  return (
    <Panel
      actions={
        <>
          <Field label={t("vt.period")}>
            <Input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              id="sales-period"
            />
          </Field>
          {can("vat.manage") && (
            <Button className="mb-3" onClick={() => setCreating(true)}>
              {t("vt.newSale")}
            </Button>
          )}
        </>
      }
    >
      {sales.error ? (
        <ErrorBox error={sales.error} onRetry={sales.reload} />
      ) : (
        <Table
          rows={sales.data}
          rowKey={(s) => s.id}
          empty={t("st.none")}
          columns={[
            {
              key: "no",
              label: t("vt.invoiceNo"),
              className: "font-mono whitespace-nowrap",
              render: (s) => s.invoiceNo,
            },
            {
              key: "date",
              label: t("vt.invoiceDate"),
              render: (s) => formatDate(s.invoiceDate, lang, { short: true }),
            },
            {
              key: "customer",
              label: t("vt.customer"),
              render: (s) => (
                <span>
                  {s.customerName}
                  {s.customerBin && (
                    <span className="block font-mono text-xs text-slate-500">
                      {s.customerBin}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: "value",
              label: t("vt.value"),
              align: "right",
              render: (s) => <Taka value={s.value} />,
            },
            {
              key: "vat",
              label: t("vt.vat"),
              align: "right",
              render: (s) => <Taka value={s.vatAmount} />,
            },
            {
              key: "vds",
              label: t("vt.vdsByCustomer"),
              align: "right",
              render: (s) =>
                Number(s.vdsByCustomer) ? <Taka value={s.vdsByCustomer} /> : "",
            },
            {
              key: "state",
              label: "",
              render: (s) => (
                <Badge color={SALE_COLOR[s.state]}>
                  {t(`vt.state.${s.state}`)}
                </Badge>
              ),
            },
          ]}
        />
      )}
      {creating && (
        <SaleDialog
          companyId={companyId}
          onClose={() => setCreating(false)}
          onDone={() => (setCreating(false), sales.reload())}
        />
      )}
    </Panel>
  );
}

function SaleDialog({
  companyId,
  onClose,
  onDone,
}: {
  companyId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const accounts = useAccounts(companyId);
  const [f, setF] = useState({
    invoiceDate: dhakaToday(),
    customerName: "",
    customerBin: "",
    customerAddress: "",
    receivedIntoAccountId: "",
    vdsByCustomer: "",
    vdsCertificateNo: "",
  });
  const [lines, setLines] = useState([
    { itemId: "", description: "", quantity: "", value: "" },
  ]);
  const items = useApi<VatItem[]>(
    `/companies/${companyId}/vat-items?fiscalYear=${fiscalYearOf(f.invoiceDate)}`,
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const editLine = (i: number, patch: Partial<(typeof lines)[number]>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const rateOf = (id: string) => items.data?.find((x) => x.id === id)?.rates[0];
  // an estimate for the screen; the server works it out to the paisa
  const vat = lines.reduce((s, l) => {
    const r = rateOf(l.itemId);
    const v = Number(l.value || 0);
    const sd = r ? (v * Number(r.sdPercent)) / 100 : 0;
    return s + (r ? ((v + sd) * Number(r.vatPercent)) / 100 + sd : 0);
  }, 0);
  const value = lines.reduce((s, l) => s + Number(l.value || 0), 0);
  return (
    <Modal title={t("vt.newSale")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            ...Object.fromEntries(
              Object.entries(f).filter(([, v]) => v !== ""),
            ),
            lines: lines
              .filter((l) => l.itemId)
              .map((l) =>
                Object.fromEntries(
                  Object.entries(l).filter(([, v]) => v !== ""),
                ),
              ),
          };
          if (
            await save.run(() =>
              api.post(`/companies/${companyId}/vat-sales`, body),
            )
          )
            onDone();
        }}
      >
        <p className="mb-3 text-sm text-slate-600">{t("vt.saleHint")}</p>
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("vt.invoiceDate")}>
            <Input
              type="date"
              required
              value={f.invoiceDate}
              onChange={set("invoiceDate")}
              id="sale-date"
            />
          </Field>
          <Field label={t("vt.customer")}>
            <Input
              required
              maxLength={200}
              value={f.customerName}
              onChange={set("customerName")}
              id="sale-customer"
            />
          </Field>
          <Field label={t("vt.customerBin")}>
            <Input
              pattern="[0-9]{9}(-?[0-9]{4})?"
              value={f.customerBin}
              onChange={set("customerBin")}
              id="sale-bin"
            />
          </Field>
          <Field label={t("vt.customerAddress")}>
            <Input
              maxLength={300}
              value={f.customerAddress}
              onChange={set("customerAddress")}
              id="sale-address"
            />
          </Field>
          <Field label={t("vt.receivedInto")}>
            <AccountSelect
              id="sale-received"
              required
              accounts={accounts.postable}
              value={f.receivedIntoAccountId}
              onChange={(receivedIntoAccountId) =>
                setF({ ...f, receivedIntoAccountId })
              }
              filter={(a) => a.role === "bank" || a.role === "cash"}
            />
          </Field>
        </div>
        <div className="mb-3 space-y-2">
          {lines.map((l, i) => (
            <div
              key={i}
              className="grid gap-2 sm:grid-cols-[2fr_3fr_1fr_1.5fr_auto]"
            >
              <Select
                aria-label={t("vt.item")}
                required={i === 0}
                value={l.itemId}
                onChange={(e) => editLine(i, { itemId: e.target.value })}
                id={`sale-item-${i}`}
              >
                <option value="">—</option>
                {items.data
                  ?.filter((x) => x.isActive && x.rates.length)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.code} · {Number(x.rates[0].vatPercent)}%
                    </option>
                  ))}
              </Select>
              <Input
                aria-label={t("vt.description")}
                required={!!l.itemId}
                maxLength={300}
                placeholder={t("vt.description")}
                value={l.description}
                onChange={(e) => editLine(i, { description: e.target.value })}
                id={`sale-desc-${i}`}
              />
              <Input
                aria-label={t("vt.quantity")}
                inputMode="decimal"
                placeholder={t("vt.quantity")}
                value={l.quantity}
                onChange={(e) => editLine(i, { quantity: e.target.value })}
                id={`sale-qty-${i}`}
              />
              <Input
                aria-label={t("vt.value")}
                required={!!l.itemId}
                inputMode="decimal"
                pattern={MONEY}
                placeholder={t("vt.value")}
                className="text-right"
                value={l.value}
                onChange={(e) => editLine(i, { value: e.target.value })}
                id={`sale-value-${i}`}
              />
              {lines.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="×"
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                >
                  ×
                </Button>
              ) : (
                <span />
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              setLines([
                ...lines,
                { itemId: "", description: "", quantity: "", value: "" },
              ])
            }
          >
            + {t("vt.addLine")}
          </Button>
        </div>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("vt.vdsByCustomer")}>
            <Input
              inputMode="decimal"
              pattern={MONEY}
              value={f.vdsByCustomer}
              onChange={set("vdsByCustomer")}
              id="sale-vds"
            />
          </Field>
          <Field label={t("vt.vdsCertificate")}>
            <Input
              required={Number(f.vdsByCustomer || 0) > 0}
              maxLength={50}
              value={f.vdsCertificateNo}
              onChange={set("vdsCertificateNo")}
              id="sale-vds-cert"
            />
          </Field>
        </div>
        <p className="mb-3 text-sm tabular-nums">
          {t("vt.value")} {formatTaka(value, lang)} · {t("vt.vat")} ≈{" "}
          {formatTaka(vat, lang)} · {t("vt.received")} ≈{" "}
          {formatTaka(value + vat - Number(f.vdsByCustomer || 0), lang)}
        </p>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("vt.newSale")}
        />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------ purchases

export function PurchasesPanel({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const [period, setPeriod] = useState(dhakaToday().slice(0, 7));
  const lines = useApi<PurchaseLine[]>(
    `/companies/${companyId}/vat-purchases?period=${period}`,
  );
  return (
    <Panel
      actions={
        <Field label={t("vt.period")}>
          <Input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            id="purchases-period"
          />
        </Field>
      }
    >
      {lines.error ? (
        <ErrorBox error={lines.error} onRetry={lines.reload} />
      ) : (
        <Table
          rows={lines.data}
          rowKey={(l) => `${l.billId}-${l.lineNo}`}
          empty={t("st.none")}
          columns={[
            {
              key: "bill",
              label: t("vt.bill"),
              render: (l) => (
                <Link
                  className="font-mono text-xs underline"
                  href={`/portal/bills/${l.billId}`}
                >
                  {l.billNo}
                </Link>
              ),
            },
            {
              key: "date",
              label: t("vt.invoiceDate"),
              render: (l) => formatDate(l.billDate, lang, { short: true }),
            },
            {
              key: "vendor",
              label: t("vt.vendor"),
              render: (l) => (
                <span>
                  {l.vendorName}
                  {l.vendorBin && (
                    <span className="block font-mono text-xs text-slate-500">
                      {l.vendorBin}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: "what",
              label: t("vt.description"),
              render: (l) => (
                <span className="text-sm">
                  {l.itemCode && (
                    <span className="font-mono text-xs">{l.itemCode} · </span>
                  )}
                  {l.description}
                </span>
              ),
            },
            {
              key: "class",
              label: t("vt.rateClass"),
              render: (l) =>
                `${t(`vt.class.${l.rateClass}`)} ${Number(l.vatPercent)}%`,
            },
            {
              key: "value",
              label: t("vt.value"),
              align: "right",
              render: (l) => <Taka value={l.value} />,
            },
            {
              key: "vat",
              label: t("vt.vat"),
              align: "right",
              render: (l) => (
                <span
                  className={l.claimable ? "" : "text-slate-400 line-through"}
                  title={l.claimable ? "" : t("vt.notClaimable")}
                >
                  <Taka value={l.vatAmount} />
                </span>
              ),
            },
          ]}
        />
      )}
    </Panel>
  );
}

// ------------------------------------------------------------ items and rates

export function ItemsPanel({ companyId }: { companyId: string }) {
  const { t } = useI18n();
  const { can } = usePortal();
  const [fy, setFy] = useState(fiscalYearOf(dhakaToday()));
  const items = useApi<VatItem[]>(
    `/companies/${companyId}/vat-items?fiscalYear=${fy}`,
  );
  const action = useAction();
  const [rateFor, setRateFor] = useState<VatItem | null>(null);
  const [creating, setCreating] = useState(false);
  const manage = can("vat.manage");
  const next = `${Number(fy.slice(0, 4)) + 1}-${String((Number(fy.slice(0, 4)) + 2) % 100).padStart(2, "0")}`;
  return (
    <Panel
      actions={
        <>
          <Field label={t("vt.fiscalYear")}>
            <Select
              value={fy}
              onChange={(e) => setFy(e.target.value)}
              id="vat-fy"
            >
              {[-1, 0, 1].map((d) => {
                const s = Number(fiscalYearOf(dhakaToday()).slice(0, 4)) + d;
                const code = `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
                return (
                  <option key={code} value={code}>
                    {code}
                  </option>
                );
              })}
            </Select>
          </Field>
          {manage && (
            <>
              {!items.data?.length && (
                <Button
                  className="mb-3"
                  busy={action.busy}
                  onClick={() =>
                    action
                      .run(
                        () =>
                          api.post(
                            `/companies/${companyId}/vat-items/defaults`,
                            { fiscalYear: fy },
                          ),
                        t("p.done"),
                      )
                      .then(() => items.reload())
                  }
                >
                  {t("vt.defaults")}
                </Button>
              )}
              <Button
                variant="secondary"
                className="mb-3"
                onClick={() => setCreating(true)}
              >
                {t("vt.newItem")}
              </Button>
              <Button
                variant="ghost"
                className="mb-3"
                busy={action.busy}
                onClick={() =>
                  action
                    .run(async () => {
                      const r = await api.post<{ copied: number }>(
                        `/companies/${companyId}/vat-rates/copy`,
                        { from: fy, to: next },
                      );
                      return r;
                    })
                    .then(
                      (r) =>
                        r &&
                        typeof r === "object" &&
                        action.run(
                          async () => undefined,
                          t("vt.copied", { n: r.copied }),
                        ),
                    )
                }
              >
                {t("vt.copyRates", { to: next })}
              </Button>
            </>
          )}
        </>
      }
    >
      <ActionMessage action={action} />
      <p className="mb-3 text-xs text-slate-500">{t("vt.placeholder")}</p>
      {items.error ? (
        <ErrorBox error={items.error} onRetry={items.reload} />
      ) : (
        <Table
          rows={items.data}
          rowKey={(i) => i.id}
          empty={t("st.none")}
          columns={[
            {
              key: "code",
              label: t("vt.code"),
              className: "font-mono",
              render: (i) => i.code,
            },
            {
              key: "name",
              label: t("vt.name"),
              render: (i) => (
                <span>
                  {i.nameEn}
                  {i.nameBn && (
                    <span className="block text-xs text-slate-500">
                      {i.nameBn}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: "kind",
              label: t("vt.kind"),
              render: (i) => t(`vt.kind.${i.kind}`),
            },
            {
              key: "nbr",
              label: t("vt.nbrCode"),
              className: "font-mono text-xs",
              render: (i) => i.nbrCode ?? "",
            },
            {
              key: "rate",
              label: t("vt.rateClass"),
              render: (i) =>
                i.rates[0] ? (
                  `${t(`vt.class.${i.rates[0].rateClass}`)} · ${Number(i.rates[0].vatPercent)}%${Number(i.rates[0].sdPercent) ? ` + SD ${Number(i.rates[0].sdPercent)}%` : ""}`
                ) : (
                  <span className="text-amber-700">{t("vt.noRate")}</span>
                ),
            },
            {
              key: "act",
              label: "",
              align: "right",
              render: (i) =>
                manage ? (
                  <Button
                    variant="ghost"
                    className="min-h-8 px-2 py-1 text-xs"
                    onClick={() => setRateFor(i)}
                  >
                    {t("vt.setRate")}
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      {rateFor && (
        <RateDialog
          item={rateFor}
          fiscalYear={fy}
          onClose={() => setRateFor(null)}
          onDone={() => (setRateFor(null), items.reload())}
        />
      )}
      {creating && (
        <ItemDialog
          companyId={companyId}
          fiscalYear={fy}
          onClose={() => setCreating(false)}
          onDone={() => (setCreating(false), items.reload())}
        />
      )}
    </Panel>
  );
}

function RateFields({
  f,
  setF,
}: {
  f: { rateClass: VatRateClass; vatPercent: string; sdPercent: string };
  setF: (f: {
    rateClass: VatRateClass;
    vatPercent: string;
    sdPercent: string;
  }) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-x-3 sm:grid-cols-3">
      <Field label={t("vt.rateClass")}>
        <Select
          value={f.rateClass}
          onChange={(e) => {
            const rateClass = e.target.value as VatRateClass;
            setF({
              ...f,
              rateClass,
              ...(rateClass === "zero" || rateClass === "exempt"
                ? { vatPercent: "0" }
                : {}),
            });
          }}
          id="rate-class"
        >
          {RATE_CLASSES.map((c) => (
            <option key={c} value={c}>
              {t(`vt.class.${c}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("vt.vatPercent")}>
        <Input
          required
          inputMode="decimal"
          value={f.vatPercent}
          onChange={(e) => setF({ ...f, vatPercent: e.target.value })}
          id="rate-vat"
        />
      </Field>
      <Field label={t("vt.sdPercent")}>
        <Input
          inputMode="decimal"
          value={f.sdPercent}
          onChange={(e) => setF({ ...f, sdPercent: e.target.value })}
          id="rate-sd"
        />
      </Field>
    </div>
  );
}

function RateDialog({
  item,
  fiscalYear,
  onClose,
  onDone,
}: {
  item: VatItem;
  fiscalYear: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const current = item.rates[0];
  const [f, setF] = useState({
    rateClass: current?.rateClass ?? ("standard" as VatRateClass),
    vatPercent: current ? String(Number(current.vatPercent)) : "15",
    sdPercent: current ? String(Number(current.sdPercent)) : "0",
  });
  return (
    <Modal
      title={`${t("vt.setRate")}: ${item.code} · ${fiscalYear}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.put(`/vat-items/${item.id}/rate`, { fiscalYear, ...f }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <RateFields f={f} setF={setF} />
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("vt.setRate")}
        />
      </form>
    </Modal>
  );
}

function ItemDialog({
  companyId,
  fiscalYear,
  onClose,
  onDone,
}: {
  companyId: string;
  fiscalYear: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    code: "",
    nameEn: "",
    nameBn: "",
    kind: "goods",
    nbrCode: "",
    unit: "",
  });
  const [rate, setRate] = useState({
    rateClass: "standard" as VatRateClass,
    vatPercent: "15",
    sdPercent: "0",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={t("vt.newItem")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            ...Object.fromEntries(
              Object.entries(f).filter(([, v]) => v !== ""),
            ),
            rate: { fiscalYear, ...rate },
          };
          if (
            await save.run(() =>
              api.post(`/companies/${companyId}/vat-items`, body),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("vt.code")}>
            <Input
              required
              maxLength={20}
              value={f.code}
              onChange={set("code")}
              id="item-code"
            />
          </Field>
          <Field label={t("vt.kind")}>
            <Select value={f.kind} onChange={set("kind")} id="item-kind">
              <option value="goods">{t("vt.kind.goods")}</option>
              <option value="service">{t("vt.kind.service")}</option>
            </Select>
          </Field>
          <Field label={t("vt.name")}>
            <Input
              required
              maxLength={200}
              value={f.nameEn}
              onChange={set("nameEn")}
              id="item-name"
            />
          </Field>
          <Field label={t("vt.nameBn")}>
            <Input
              maxLength={200}
              value={f.nameBn}
              onChange={set("nameBn")}
              id="item-name-bn"
            />
          </Field>
          <Field label={t("vt.nbrCode")}>
            <Input
              maxLength={30}
              value={f.nbrCode}
              onChange={set("nbrCode")}
              id="item-nbr"
            />
          </Field>
          <Field label={t("vt.unit")}>
            <Input
              maxLength={20}
              value={f.unit}
              onChange={set("unit")}
              id="item-unit"
            />
          </Field>
        </div>
        <RateFields f={rate} setF={setRate} />
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("vt.newItem")}
        />
      </form>
    </Modal>
  );
}
