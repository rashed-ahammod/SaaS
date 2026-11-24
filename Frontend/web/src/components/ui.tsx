"use client";
/**
 * Small building blocks used by every screen. Big touch targets (44 px+) and
 * high contrast, for mid-range Android phones in daylight.
 *
 * Design tokens (Figma "Amar Office — Design System"): emerald brand on slate
 * neutrals, radius 8 / 12 / 16, the 4 px spacing grid, Noto Sans Bengali.
 *
 * Overriding a base class from the outside: these components concatenate class
 * strings, and when two utilities set the same property it is Tailwind's own
 * source order that wins, not the order in the attribute. So `className="p-0"`
 * against the `p-4` below quietly does nothing. Write such an override with the
 * `!` suffix (`p-0!`, `ring-emerald-300!`), or add a variant/size here when the
 * shape comes up more than once.
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

/** 24 px line icons (1.8 stroke), the same set as the Figma library. */
export const ICONS = {
  home: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  attendance: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  leave: "M4 6h16M4 6v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6M8 3v6m8-6v6M8 14h3",
  payslips: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  approvals: "M9 12l2 2 4-4M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0",
  "chevron-left": "M15 18l-6-6 6-6",
  "chevron-right": "M9 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  download: "M12 4v11m0 0l-4-4m4 4l4-4M5 20h14",
  sparkle: "M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z",
  "map-pin":
    "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  cart: "M3 4h2l2.5 11h11L21 7H6.2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  box: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h4",
  check: "M5 12l5 5L20 7",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01",
  warning: "M12 4l9 16H3zM12 10v4M12 17h.01",
  x: "M6 6l12 12M18 6L6 18",
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  className = "h-6 w-6",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

export function PageTitle({
  children,
  action,
  back,
}: {
  children: ReactNode;
  action?: ReactNode;
  /** a pushed screen: where the back arrow goes */
  back?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="mb-4 flex min-h-11 items-center justify-between gap-2 pr-12">
      <div className="flex min-w-0 items-center gap-1">
        {back && (
          <Link
            href={back}
            aria-label={t("common.back")}
            className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 active:bg-slate-200"
          >
            <Icon name="chevron-left" />
          </Link>
        )}
        <h1
          className={`${back ? "text-lg font-semibold" : "text-2xl font-bold"} truncate text-slate-900`}
        >
          {children}
        </h1>
      </div>
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
      className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80 ${className}`}
    >
      {children}
    </section>
  );
}

export function CardTitle({
  children,
  action,
}: {
  children: ReactNode;
  /** e.g. a "See all" link on the right */
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: keyof typeof BUTTON_SIZES;
  busy?: boolean;
};

const BUTTON_STYLES = {
  primary:
    "bg-emerald-700 text-white shadow-sm hover:bg-emerald-800 active:bg-emerald-900 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none",
  secondary:
    "bg-white text-emerald-800 ring-1 ring-emerald-700 hover:bg-emerald-50 active:bg-emerald-100 disabled:text-slate-400 disabled:ring-slate-300 disabled:bg-white",
  danger:
    "bg-white text-red-700 ring-1 ring-red-600 hover:bg-red-50 active:bg-red-100 disabled:text-slate-400 disabled:ring-slate-300",
  ghost:
    "bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200 disabled:text-slate-400",
};
const BUTTON_SIZES = {
  sm: "min-h-9 rounded-lg px-3 py-1.5 text-sm",
  md: "min-h-11 rounded-xl px-4 py-2.5 text-base",
  lg: "min-h-14 rounded-2xl px-5 py-3 text-lg",
  /** a square 44 px target holding one 24 px icon and nothing else */
  icon: "h-11 w-11 rounded-xl p-0 text-base",
};
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/30 disabled:cursor-not-allowed";

export function Button({
  variant = "primary",
  size = "md",
  busy,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`${BUTTON_BASE} ${BUTTON_SIZES[size]} ${BUTTON_STYLES[variant]} ${className}`}
    >
      {busy ? <Spinner small /> : children}
    </button>
  );
}

/** A link that looks like a button (navigation, not an action). */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: keyof typeof BUTTON_STYLES;
  size?: keyof typeof BUTTON_SIZES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`${BUTTON_BASE} ${BUTTON_SIZES[size]} ${BUTTON_STYLES[variant]} ${className}`}
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
    <label className="mb-4 block">
      <span className="mb-1.5 block text-sm font-medium text-slate-800">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>
      )}
    </label>
  );
}

const inputClass =
  "block w-full min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-emerald-600 focus:outline-none focus:ring-4 focus:ring-emerald-600/15 disabled:bg-slate-50 disabled:text-slate-400 aria-[invalid=true]:border-red-600";

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
  green: ["bg-emerald-100 text-emerald-800", "bg-emerald-600"],
  amber: ["bg-amber-100 text-amber-800", "bg-amber-500"],
  red: ["bg-red-100 text-red-800", "bg-red-600"],
  blue: ["bg-sky-100 text-sky-800", "bg-sky-600"],
  gray: ["bg-slate-100 text-slate-700", "bg-slate-400"],
};

/** A status pill. The dot means the status is not carried by colour alone. */
export function Badge({
  color = "gray",
  children,
}: {
  color?: keyof typeof BADGE;
  children: ReactNode;
}) {
  const [pill, dot] = BADGE[color];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${pill}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

const ALERT = {
  info: ["bg-sky-50 text-sky-900 ring-sky-200", "bg-sky-700", "info"],
  success: [
    "bg-emerald-50 text-emerald-900 ring-emerald-200",
    "bg-emerald-700",
    "check",
  ],
  error: ["bg-red-50 text-red-900 ring-red-200", "bg-red-700", "x"],
  warning: [
    "bg-amber-50 text-amber-900 ring-amber-300",
    "bg-amber-700",
    "warning",
  ],
} as const;

export function Alert({
  kind = "info",
  children,
}: {
  kind?: "info" | "success" | "error" | "warning";
  children: ReactNode;
}) {
  const [box, iconBg, icon] = ALERT[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`mb-3 flex gap-2.5 rounded-xl px-3 py-2.5 text-sm ring-1 ${box}`}
    >
      <span
        aria-hidden
        className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${iconBg}`}
      >
        <Icon name={icon} className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
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
    <p className="py-8 text-center text-sm text-slate-500">
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
      <span className="text-right text-slate-900 tabular-nums">{value}</span>
    </div>
  );
}

/** A round tinted square holding an icon (list rows, quick actions). */
export function IconTile({
  name,
  tone = "brand",
}: {
  name: IconName;
  tone?: "brand" | "amber" | "sky" | "slate";
}) {
  const tones = {
    brand: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    sky: "bg-sky-50 text-sky-700",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      aria-hidden
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}
    >
      <Icon name={name} className="h-5 w-5" />
    </span>
  );
}

/**
 * One tappable row in a list card: optional icon, title, subtitle, and
 * whatever sits on the right (an amount, a badge), then a chevron.
 * Put several inside <Card className="p-0!"><ul className="divide-y ...">.
 */
export function ListLink({
  href,
  icon,
  title,
  subtitle,
  trailing,
}: {
  href: string;
  icon?: IconName;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-slate-50"
    >
      {icon && <IconTile name={icon} />}
      <span className="min-w-0 flex-1">
        <span className="block font-medium break-words text-slate-900">
          {title}
        </span>
        {subtitle && (
          <span className="block truncate text-sm text-slate-500">
            {subtitle}
          </span>
        )}
      </span>
      {trailing}
      <Icon name="chevron-right" className="h-5 w-5 shrink-0 text-slate-400" />
    </Link>
  );
}
