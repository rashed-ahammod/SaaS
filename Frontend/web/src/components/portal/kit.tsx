"use client";
/**
 * Building blocks of the HR / Admin portal (desktop screens): page header,
 * table, modal, tabs, stat card, and useAction (busy state + error + success
 * message around one API call).
 */
import { useCallback, useState, type ReactNode } from "react";
import { Alert, Button } from "@/components/ui";
import type { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`mb-5 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}
    >
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && (
            <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          )}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export interface Column<T> {
  key: string;
  label: ReactNode;
  render?: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}

/** A plain data table; numbers right-aligned with tabular digits. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  rowTitle,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  rowTitle?: string;
}) {
  const { t } = useI18n();
  // a div, not a p: `empty` is often an <EmptyState/> with paragraphs of its own, and a <p> inside a <p> breaks hydration
  if (!rows?.length)
    return (
      <div className="py-6 text-center text-sm text-slate-500">
        {empty ?? t("p.none")}
      </div>
    );
  const align = (a?: string) =>
    a === "right"
      ? "text-right tabular-nums"
      : a === "center"
        ? "text-center"
        : "text-left";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-2 py-2 font-semibold ${align(c.align)} ${c.className ?? ""}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* a clickable row carries rowTitle, so it can say where it goes: a hover colour alone does not */}
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={`border-b border-slate-100 last:border-0 ${onRowClick ? "cursor-pointer hover:bg-emerald-50" : ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              title={onRowClick ? rowTitle : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-2 py-2 align-top ${align(c.align)} ${c.className ?? ""}`}
                >
                  {c.render
                    ? c.render(row)
                    : String((row as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({
  title,
  open,
  onClose,
  children,
  wide,
}: {
  title: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
    >
      <div
        className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-xl bg-white p-5 shadow-xl`}
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label={t("p.close")}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: K; label: ReactNode }>;
  active: K;
  onChange: (k: K) => void;
}) {
  return (
    <div
      className="mb-4 flex flex-wrap gap-1 border-b border-slate-200"
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          aria-selected={tab.key === active}
          onClick={() => onChange(tab.key)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab.key === active ? "border-emerald-700 text-emerald-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "warn" | "good";
}) {
  const color =
    tone === "warn"
      ? "text-amber-700"
      : tone === "good"
        ? "text-emerald-700"
        : "text-slate-900";
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** A label above a value, for detail screens. */
export function Detail({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-slate-900">{children ?? "—"}</dd>
    </div>
  );
}

/**
 * One API call with busy state, its error (shown by <ActionMessage/>) and an
 * optional success message.
 *   const save = useAction();
 *   <Button busy={save.busy} onClick={() => save.run(() => api.post(...), t('p.saved'))}>
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(
      work: () => Promise<T>,
      successText?: string,
    ): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      setSuccess(null);
      try {
        const result = await work();
        if (successText) setSuccess(successText);
        // a call with no answer body still counts as done (undefined means it failed)
        return (result === undefined ? true : result) as T;
      } catch (e) {
        const err = e as ApiError;
        const details = err.details as
          | {
              problems?: string[];
              employees?: string[];
              closeFirst?: string[];
              unfinishedVouchers?: string[];
              missingPostingAccounts?: string[];
              available?: string;
              billNo?: string;
              // rule pack (RULE_NOT_VERIFIED / RULE_NOT_FOUND): which value, when, which pack
              key?: string;
              date?: string;
              pack?: string;
            }
          | undefined;
        const extra =
          details?.problems?.join(" · ") ??
          details?.employees?.join(", ") ??
          details?.closeFirst?.join(", ") ??
          details?.unfinishedVouchers?.join(", ") ??
          details?.missingPostingAccounts?.join(", ") ??
          (details?.available !== undefined
            ? `${details.billNo ?? ""} ৳ ${details.available}`.trim()
            : undefined) ??
          (details?.key
            ? `${details.key}${
                details.pack || details.date
                  ? ` (${[details.pack, details.date]
                      .filter(Boolean)
                      .join(", ")})`
                  : ""
              }`
            : undefined);
        setError([err.message, extra].filter(Boolean).join(": "));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  return {
    busy,
    error,
    success,
    run,
    clear: () => (setError(null), setSuccess(null)),
  };
}

export function ActionMessage({
  action,
}: {
  action: { error: string | null; success: string | null };
}) {
  if (action.error) return <Alert kind="error">{action.error}</Alert>;
  if (action.success) return <Alert kind="success">{action.success}</Alert>;
  return null;
}

/** Small form footer: cancel + submit. */
export function FormButtons({
  busy,
  onCancel,
  submitLabel,
}: {
  busy?: boolean;
  onCancel: () => void;
  submitLabel?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-4 flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={onCancel}>
        {t("p.cancel")}
      </Button>
      <Button type="submit" busy={busy}>
        {submitLabel ?? t("p.save")}
      </Button>
    </div>
  );
}
