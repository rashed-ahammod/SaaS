"use client";
/**
 * Pieces shared by the finance screens: the company's accounts (picker), the
 * line editors of vouchers and vendor bills, and money arithmetic for totals
 * shown while typing (the server works everything out again).
 */
import { Button, Input, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import type { Account } from "@/lib/finance-types";
import { formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Department } from "@/lib/portal-types";

export function useAccounts(companyId: string | undefined) {
  const accounts = useApi<Account[]>(
    companyId ? `/companies/${companyId}/accounts` : null,
  );
  return {
    ...accounts,
    postable: (accounts.data ?? []).filter((a) => a.postable && a.isActive),
  };
}

export function AccountSelect({
  accounts,
  value,
  onChange,
  required,
  filter,
  id,
}: {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  filter?: (a: Account) => boolean;
  id?: string;
}) {
  const { lang } = useI18n();
  return (
    <Select
      id={id}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">—</option>
      {accounts.filter(filter ?? (() => true)).map((a) => (
        <option key={a.id} value={a.id}>
          {a.code} · {lang === "bn" && a.nameBn ? a.nameBn : a.nameEn}
        </option>
      ))}
    </Select>
  );
}

/** Paisa arithmetic for totals on the screen. */
export function sumAmounts(values: Array<string | undefined>): number {
  return values.reduce((n, v) => n + Math.round(Number(v || 0) * 100), 0) / 100;
}

export function Taka({ value }: { value: string | number | null | undefined }) {
  const { lang } = useI18n();
  if (value === null || value === undefined || value === "")
    return <span className="text-slate-400">—</span>;
  return <span className="tabular-nums">{formatTaka(value, lang)}</span>;
}

// ------------------------------------------------------------ voucher lines

export interface VoucherLineInput {
  accountId: string;
  departmentId: string;
  debit: string;
  credit: string;
}

export const emptyVoucherLine = (): VoucherLineInput => ({
  accountId: "",
  departmentId: "",
  debit: "",
  credit: "",
});

export function VoucherLinesEditor({
  lines,
  onChange,
  accounts,
  departments,
}: {
  lines: VoucherLineInput[];
  onChange: (lines: VoucherLineInput[]) => void;
  accounts: Account[];
  departments: Department[];
}) {
  const { t, lang } = useI18n();
  const set = (i: number, patch: Partial<VoucherLineInput>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const debit = sumAmounts(lines.map((l) => l.debit));
  const credit = sumAmounts(lines.map((l) => l.credit));
  const diff = Math.round((debit - credit) * 100) / 100;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-500">
              <th className="px-1 py-1 text-left">{t("f.v.account")}</th>
              <th className="px-1 py-1 text-left">{t("p.department")}</th>
              <th className="px-1 py-1 text-right">{t("f.v.debit")}</th>
              <th className="px-1 py-1 text-right">{t("f.v.credit")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="min-w-56 px-1 py-1">
                  <AccountSelect
                    accounts={accounts}
                    value={l.accountId}
                    onChange={(accountId) => set(i, { accountId })}
                    required
                    id={`vline-account-${i}`}
                  />
                </td>
                <td className="min-w-40 px-1 py-1">
                  <Select
                    value={l.departmentId}
                    onChange={(e) => set(i, { departmentId: e.target.value })}
                    id={`vline-dept-${i}`}
                  >
                    <option value="">—</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} · {d.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="w-36 px-1 py-1">
                  <Input
                    inputMode="decimal"
                    className="text-right"
                    value={l.debit}
                    onChange={(e) =>
                      set(i, {
                        debit: e.target.value,
                        credit: e.target.value ? "" : l.credit,
                      })
                    }
                    id={`vline-debit-${i}`}
                    aria-label={t("f.v.debit")}
                  />
                </td>
                <td className="w-36 px-1 py-1">
                  <Input
                    inputMode="decimal"
                    className="text-right"
                    value={l.credit}
                    onChange={(e) =>
                      set(i, {
                        credit: e.target.value,
                        debit: e.target.value ? "" : l.debit,
                      })
                    }
                    id={`vline-credit-${i}`}
                    aria-label={t("f.v.credit")}
                  />
                </td>
                <td className="px-1 py-1">
                  {lines.length > 2 && (
                    <button
                      type="button"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100"
                      aria-label={t("p.close")}
                      onClick={() => onChange(lines.filter((_, j) => j !== i))}
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="px-1 py-2" colSpan={2}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onChange([...lines, emptyVoucherLine()])}
                >
                  + {t("f.v.addLine")}
                </Button>
              </td>
              <td className="px-1 py-2 text-right tabular-nums">
                {formatTaka(debit, lang)}
              </td>
              <td className="px-1 py-2 text-right tabular-nums">
                {formatTaka(credit, lang)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p
        className={`mt-1 text-right text-sm ${diff === 0 && debit > 0 ? "text-emerald-700" : "text-amber-700"}`}
      >
        {diff === 0 && debit > 0
          ? t("f.v.balanced")
          : `${t("f.v.difference")}: ${formatTaka(Math.abs(diff), lang)}`}
      </p>
    </div>
  );
}

// --------------------------------------------------------------- bill lines

export interface BillLineInput {
  accountId: string;
  departmentId: string;
  description: string;
  amount: string;
  vatPercent: string;
  /** a VAT item (WP21): its rate for the bill's fiscal year */
  vatItemId?: string;
}

/** A VAT item with its rate for one fiscal year, for the bill lines' VAT choice. */
export interface VatItemChoice {
  id: string;
  code: string;
  nameEn: string;
  vatPercent: string;
}

export const emptyBillLine = (): BillLineInput => ({
  accountId: "",
  departmentId: "",
  description: "",
  amount: "",
  vatPercent: "15",
});

export function BillLinesEditor({
  lines,
  onChange,
  accounts,
  departments,
  vatItems = [],
}: {
  lines: BillLineInput[];
  onChange: (lines: BillLineInput[]) => void;
  accounts: Account[];
  departments: Department[];
  vatItems?: VatItemChoice[];
}) {
  const { t, lang } = useI18n();
  const set = (i: number, patch: Partial<BillLineInput>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const expenseAccounts = (a: Account) =>
    !["cash", "bank", "payables"].includes(a.role ?? "");
  const base = sumAmounts(lines.map((l) => l.amount));
  const vat = sumAmounts(
    lines.map((l) =>
      String(
        Math.round(Number(l.amount || 0) * Number(l.vatPercent || 0)) / 100,
      ),
    ),
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-500">
            <th className="px-1 py-1 text-left">{t("f.v.account")}</th>
            <th className="px-1 py-1 text-left">{t("p.department")}</th>
            <th className="px-1 py-1 text-left">{t("f.b.description")}</th>
            <th className="px-1 py-1 text-right">{t("f.b.base")}</th>
            <th className="px-1 py-1 text-right">{t("f.b.vatPercent")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="min-w-52 px-1 py-1">
                <AccountSelect
                  accounts={accounts}
                  filter={expenseAccounts}
                  value={l.accountId}
                  onChange={(accountId) => set(i, { accountId })}
                  required
                  id={`bline-account-${i}`}
                />
              </td>
              <td className="min-w-36 px-1 py-1">
                <Select
                  value={l.departmentId}
                  onChange={(e) => set(i, { departmentId: e.target.value })}
                  id={`bline-dept-${i}`}
                >
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} · {d.name}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="min-w-48 px-1 py-1">
                <Input
                  required
                  maxLength={300}
                  value={l.description}
                  onChange={(e) => set(i, { description: e.target.value })}
                  id={`bline-desc-${i}`}
                  aria-label={t("f.b.description")}
                />
              </td>
              <td className="w-36 px-1 py-1">
                <Input
                  required
                  inputMode="decimal"
                  className="text-right"
                  value={l.amount}
                  onChange={(e) => set(i, { amount: e.target.value })}
                  id={`bline-amount-${i}`}
                  aria-label={t("f.b.base")}
                />
              </td>
              <td className="w-40 px-1 py-1">
                <Select
                  value={l.vatItemId ? `item:${l.vatItemId}` : l.vatPercent}
                  onChange={(e) => {
                    const v = e.target.value;
                    const chosen = v.startsWith("item:")
                      ? vatItems.find((x) => x.id === v.slice(5))
                      : undefined;
                    set(
                      i,
                      chosen
                        ? {
                            vatItemId: chosen.id,
                            vatPercent: String(Number(chosen.vatPercent)),
                          }
                        : { vatItemId: undefined, vatPercent: v },
                    );
                  }}
                  id={`bline-vat-${i}`}
                  aria-label={t("f.b.vatPercent")}
                >
                  {["15", "10", "7.5", "5", "0"].map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                  {vatItems.length > 0 && (
                    <optgroup label={t("vt.items")}>
                      {vatItems.map((x) => (
                        <option key={x.id} value={`item:${x.id}`}>
                          {x.code} · {Number(x.vatPercent)}%
                        </option>
                      ))}
                    </optgroup>
                  )}
                </Select>
              </td>
              <td className="px-1 py-1">
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100"
                    aria-label={t("p.close")}
                    onClick={() => onChange(lines.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="px-1 py-2" colSpan={3}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onChange([...lines, emptyBillLine()])}
              >
                + {t("f.v.addLine")}
              </Button>
            </td>
            <td
              className="px-1 py-2 text-right text-sm tabular-nums"
              colSpan={2}
            >
              {t("f.b.base")}: {formatTaka(base, lang)} · {t("f.b.vat")}:{" "}
              {formatTaka(vat, lang)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
