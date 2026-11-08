"use client";
/**
 * Budget pieces of the portal (WP18):
 *   UsageBar        actual + committed against the budget
 *   PositionTable   budget, actual, committed, available, % per account
 *   BudgetForm      a new budget, or a draft's lines (Accounts)
 *   RevisionDialog  ask for new yearly amounts (Accounts / Dept Head) -> Admin
 *   SettingsPanel   the warning percent; departments without a budget
 *   BudgetCheckNote a requisition's or an order's budget position at the time
 */
import { useState } from "react";
import { AccountSelect, Taka, useAccounts } from "@/components/portal/finance";
import { useOrg } from "@/components/portal/org";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import {
  BUDGET_STATUS_COLOR,
  type Budget,
  type BudgetCheck,
  type BudgetLine,
  type Position,
} from "@/lib/budget-types";
import { formatTaka, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  ActionMessage,
  FormButtons,
  Modal,
  Panel,
  Table,
  useAction,
} from "./kit";
import { usePortal } from "./portal-context";

const budgetable = (a: { type?: string; role: string | null }) =>
  (a.type === "expense" || a.type === "asset") &&
  !["cash", "bank", "receivables", "employee_advances"].includes(a.role ?? "");

/** "2026-27" for today (July to June). */
export function currentFiscalYear(): string {
  const now = new Date();
  const y = now.getFullYear();
  const start = now.getMonth() + 1 >= 7 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

export function fiscalYears(): string[] {
  const start = Number(currentFiscalYear().slice(0, 4));
  return [1, 0, -1, -2].map(
    (i) => `${start + i}-${String(start + i + 1).slice(2)}`,
  );
}

export function UsageBar({ p }: { p: Position }) {
  const budget = Number(p.budget);
  const actual =
    budget > 0
      ? Math.min(100, (Number(p.actual) / budget) * 100)
      : Number(p.actual) > 0
        ? 100
        : 0;
  const committed =
    budget > 0
      ? Math.min(100 - actual, (Number(p.committed) / budget) * 100)
      : 0;
  const color =
    p.status === "over"
      ? "bg-red-600"
      : p.status === "warning"
        ? "bg-amber-500"
        : "bg-emerald-600";
  return (
    <span
      className="flex h-2 w-28 overflow-hidden rounded-full bg-slate-200"
      aria-hidden
    >
      <span className={color} style={{ width: `${actual}%` }} />
      <span
        className={`${color} opacity-40`}
        style={{ width: `${committed}%` }}
      />
    </span>
  );
}

export function PositionTable({
  rows,
  total,
}: {
  rows: BudgetLine[];
  total?: Position;
}) {
  const { t, lang } = useI18n();
  const all = total
    ? [
        ...rows,
        {
          ...total,
          accountId: "total",
          accountCode: null,
          accountName: t("bg.total"),
        },
      ]
    : rows;
  return (
    <Table
      rows={all}
      rowKey={(r) => r.accountId}
      columns={[
        {
          key: "account",
          label: t("bg.account"),
          render: (r) =>
            r.accountId === "total" ? (
              <strong>{r.accountName}</strong>
            ) : (
              <span className="text-sm">
                {r.accountCode} · {r.accountName}
              </span>
            ),
        },
        {
          key: "budget",
          label: t("bg.budget"),
          align: "right",
          render: (r) => <Taka value={r.budget} />,
        },
        {
          key: "actual",
          label: t("bg.actual"),
          align: "right",
          render: (r) => <Taka value={r.actual} />,
        },
        {
          key: "committed",
          label: t("bg.committed"),
          align: "right",
          render: (r) => <Taka value={r.committed} />,
        },
        {
          key: "available",
          label: t("bg.available"),
          align: "right",
          render: (r) => (
            <span
              className={
                Number(r.available) < 0 ? "font-semibold text-red-700" : ""
              }
            >
              <Taka value={r.available} />
            </span>
          ),
        },
        { key: "bar", label: "", render: (r) => <UsageBar p={r} /> },
        {
          key: "pct",
          label: t("bg.percent"),
          align: "right",
          render: (r) =>
            r.percent === null ? "—" : `${num(Number(r.percent), lang)}%`,
        },
        {
          key: "status",
          label: "",
          render: (r) => (
            <Badge color={BUDGET_STATUS_COLOR[r.status]}>
              {t(`bg.status.${r.status}`)}
            </Badge>
          ),
        },
      ]}
    />
  );
}

type LineInput = { accountId: string; amount: string };

function LinesEditor({
  companyId,
  lines,
  onChange,
}: {
  companyId: string;
  lines: LineInput[];
  onChange: (lines: LineInput[]) => void;
}) {
  const { t, lang } = useI18n();
  const { postable } = useAccounts(companyId);
  const set = (i: number, patch: Partial<LineInput>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  return (
    <>
      {lines.map((l, i) => (
        <div
          key={i}
          className="grid items-end gap-x-3 sm:grid-cols-[1fr_12rem_auto]"
        >
          <Field label={`${t("bg.account")} ${i + 1}`}>
            <AccountSelect
              accounts={postable}
              filter={budgetable}
              value={l.accountId}
              onChange={(accountId) => set(i, { accountId })}
              required
              id={`bl-account-${i}`}
            />
          </Field>
          <Field label={t("bg.amount")}>
            <Input
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={l.amount}
              onChange={(e) => set(i, { amount: e.target.value })}
              id={`bl-amount-${i}`}
            />
          </Field>
          <div className="mb-3">
            {lines.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-8 px-2 py-1 text-sm"
                onClick={() => onChange(lines.filter((_, j) => j !== i))}
              >
                ×
              </Button>
            )}
          </div>
        </div>
      ))}
      <div className="mb-3 flex items-center justify-between">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange([...lines, { accountId: "", amount: "" }])}
        >
          + {t("bg.addLine")}
        </Button>
        <strong>{formatTaka(String(total), lang)}</strong>
      </div>
    </>
  );
}

export function BudgetForm({
  companyId,
  existing,
  onClose,
  onDone,
}: {
  companyId: string;
  existing?: Budget;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const { departments } = useOrg(companyId);
  const [f, setF] = useState({
    fiscalYear: existing?.fiscalYear ?? currentFiscalYear(),
    departmentId: existing?.departmentId ?? "",
    note: existing?.note ?? "",
  });
  const [lines, setLines] = useState<LineInput[]>(
    existing
      ? existing.lines.map((l) => ({
          accountId: l.accountId,
          amount: l.budget,
        }))
      : [{ accountId: "", amount: "" }],
  );
  return (
    <Modal
      title={existing ? t("bg.edit") : t("bg.new")}
      open
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const saved = existing
            ? await save.run(() =>
                api.patch<{ id: string }>(`/budgets/${existing.id}`, {
                  version: existing.version,
                  note: f.note,
                  lines,
                }),
              )
            : await save.run(() =>
                api.post<{ id: string }>(`/companies/${companyId}/budgets`, {
                  ...f,
                  ...(f.note ? {} : { note: undefined }),
                  lines,
                }),
              );
          if (saved && typeof saved === "object") onDone(saved.id);
        }}
      >
        <ActionMessage action={save} />
        {!existing && (
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Field label={t("bg.year")}>
              <Select
                value={f.fiscalYear}
                onChange={(e) => setF({ ...f, fiscalYear: e.target.value })}
                id="budget-year"
              >
                {fiscalYears().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("bg.department")}>
              <Select
                required
                value={f.departmentId}
                onChange={(e) => setF({ ...f, departmentId: e.target.value })}
                id="budget-department"
              >
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {"— ".repeat(d.depth ?? 0)}
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <Field label={t("bg.note")}>
          <Input
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="budget-note"
          />
        </Field>
        <LinesEditor companyId={companyId} lines={lines} onChange={setLines} />
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

export function RevisionDialog({
  budget,
  onClose,
  onDone,
}: {
  budget: Budget;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<LineInput[]>(
    budget.lines.map((l) => ({ accountId: l.accountId, amount: l.budget })),
  );
  return (
    <Modal title={t("bg.askChange")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/budgets/${budget.id}/revisions`, { reason, lines }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <p className="mb-3 text-sm text-slate-600">{t("bg.changeHint")}</p>
        <Field label={t("bg.changeReason")}>
          <Input
            required
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="revision-reason"
          />
        </Field>
        <LinesEditor
          companyId={budget.companyId}
          lines={lines}
          onChange={setLines}
        />
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("bg.askChange")}
        />
      </form>
    </Modal>
  );
}

export function SettingsPanel({ companyId }: { companyId: string }) {
  const { t } = useI18n();
  const { can } = usePortal();
  const settings = useApi<{
    warningPercent: string;
    noBudgetNeedsAdmin: boolean;
  }>(`/companies/${companyId}/budget-settings`);
  const save = useAction();
  const [f, setF] = useState<{
    warningPercent: string;
    noBudgetNeedsAdmin: boolean;
  } | null>(null);
  if (!settings.data) return null;
  const v = f ?? settings.data;
  const manage = can("budgets.manage");
  return (
    <Panel>
      <ActionMessage action={save} />
      <form
        className="grid items-end gap-x-3 sm:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(
              () => api.put(`/companies/${companyId}/budget-settings`, v),
              t("p.saved"),
            )
          ) {
            setF(null);
            settings.reload();
          }
        }}
      >
        <Field label={t("bg.s.warning")}>
          <Input
            disabled={!manage}
            inputMode="decimal"
            value={v.warningPercent}
            onChange={(e) => setF({ ...v, warningPercent: e.target.value })}
            id="bs-warning"
          />
        </Field>
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!manage}
            checked={v.noBudgetNeedsAdmin}
            onChange={(e) =>
              setF({ ...v, noBudgetNeedsAdmin: e.target.checked })
            }
            id="bs-no-budget"
          />
          {t("bg.s.noBudgetAdmin")}
        </label>
        {manage && (
          <div className="mb-3">
            <Button type="submit" busy={save.busy} className="w-full">
              {t("p.save")}
            </Button>
          </div>
        )}
      </form>
      <p className="text-xs text-slate-500">{t("bg.s.hint")}</p>
    </Panel>
  );
}

/** The budget position recorded with a requisition or an order. */
export function BudgetCheckNote({
  check,
}: {
  check: BudgetCheck | null | undefined;
}) {
  const { t, lang } = useI18n();
  if (!check || check.status === "not_used") return null;
  const worst = check.lines
    .map((l) => l.after)
    .filter((p): p is Position => Boolean(p));
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <Badge color={BUDGET_STATUS_COLOR[check.status]}>
        {t(`bg.status.${check.status}`)}
      </Badge>
      {worst.map((p, i) => (
        <span key={i} className="text-slate-600">
          {t("bg.checkAfter", {
            used: formatTaka(p.used, lang),
            budget: formatTaka(p.budget, lang),
            pct: p.percent === null ? "—" : num(Number(p.percent), lang),
          })}
        </span>
      ))}
    </span>
  );
}
