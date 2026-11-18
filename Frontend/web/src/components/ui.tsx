"use client";
/**
 * Small building blocks used by every screen. Big touch targets (44 px+) and
 * high contrast, for mid-range Android phones in daylight.
 */
import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useI18n } from "@/lib/i18n";
import type { ApiError } from "@/lib/api";

export function PageTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2 pr-12">
      <h1 className="text-xl font-bold text-slate-900">{children}</h1>
      {action}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}
    >
      {children}
    </section>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </h2>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
};

const BUTTON_STYLES = {
  primary:
    "bg-emerald-700 text-white active:bg-emerald-800 disabled:bg-slate-300",
  secondary:
    "bg-white text-emerald-800 ring-1 ring-emerald-700 active:bg-emerald-50 disabled:text-slate-400 disabled:ring-slate-300",
  danger: "bg-white text-red-700 ring-1 ring-red-600 active:bg-red-50",
  ghost: "bg-transparent text-slate-700 active:bg-slate-100",
};
const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 text-base font-semibold transition";

export function Button({
  variant = "primary",
  busy,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const styles = BUTTON_STYLES[variant];
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`${BUTTON_BASE} ${styles} ${className}`}
    >
      {busy ? <Spinner small /> : children}
    </button>
  );
}

/** A link that looks like a button (navigation, not an action). */
export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: keyof typeof BUTTON_STYLES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${BUTTON_BASE} ${BUTTON_STYLES[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      )}
    </label>
  );
}

const inputClass =
  "block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30";

/**
 * A text input. A field that does not say what it holds is one the browser will fill with
 * whatever it last remembered for a nameless box: that is how the workspace typed at sign-in
 * ("demo") reappeared in the search box of every list, and every list then looked empty. So
 * autofill is off unless the caller asks for it by name (the sign-in fields do).
 */
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const unnamed = props.autoComplete === undefined;
  return (
    <input
      autoComplete={props.autoComplete ?? "off"}
      {...(unnamed
        ? { "data-1p-ignore": "true", "data-lpignore": "true" }
        : {})}
      {...props}
      className={`${inputClass} ${props.className ?? ""}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${inputClass} ${props.className ?? ""}`} />
  );
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      {...props}
      className={`${inputClass} ${props.className ?? ""}`}
    />
  );
}

const BADGE = {
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-sky-100 text-sky-800",
  gray: "bg-slate-100 text-slate-700",
};

export function Badge({
  color = "gray",
  children,
}: {
  color?: keyof typeof BADGE;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${BADGE[color]}`}
    >
      {children}
    </span>
  );
}

export function Alert({
  kind = "info",
  children,
}: {
  kind?: "info" | "success" | "error" | "warning";
  children: ReactNode;
}) {
  const styles = {
    info: "bg-sky-50 text-sky-900 ring-sky-200",
    success: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    error: "bg-red-50 text-red-900 ring-red-200",
    warning: "bg-amber-50 text-amber-900 ring-amber-200",
  }[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`mb-3 rounded-xl px-3 py-2 text-sm ring-1 ${styles}`}
    >
      {children}
    </div>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${small ? "h-4 w-4" : "h-6 w-6"}`}
    />
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 py-8 text-slate-500" role="status">
      <Spinner /> {t("common.loading")}
    </div>
  );
}

/** An API error with its message from the server (already in the user's language). */
export function ErrorBox({
  error,
  onRetry,
}: {
  error: ApiError | Error;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <Alert kind="error">
      <p>{error.message || t("common.error")}</p>
      {onRetry && (
        <button className="mt-1 font-semibold underline" onClick={onRetry}>
          {t("common.retry")}
        </button>
      )}
    </Alert>
  );
}

export function Empty({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <p className="py-6 text-center text-slate-500">
      {children ?? t("common.none")}
    </p>
  );
}

/** A label / value row. */
export function Row({
  label,
  value,
  strong,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? "font-bold" : ""}`}
    >
      <span className="text-slate-600">{label}</span>
      <span className="text-right tabular-nums text-slate-900">{value}</span>
    </div>
  );
}
