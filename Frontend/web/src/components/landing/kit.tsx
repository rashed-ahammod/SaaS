/**
 * The landing page's own small component set (/).
 *
 * The page is laid out like a ledger: one 12-column measure, hairline rules
 * instead of boxes, register labels in the mono face, figures in tabular
 * numerals, and square corners. Everything on the page is built from the
 * pieces below so the rhythm cannot drift from section to section.
 *
 * Colours come from the landing tokens in globals.css (ink, paper, muted,
 * faint, line, accent, flag, warn).
 */
import type { ReactNode } from "react";
import { Reveal } from "./motion";

/** The one measure every section lines up to. */
export function Measure({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[76rem] px-5 sm:px-8 ${className}`}>
      {children}
    </div>
  );
}

/** A section of the page: hairline above, generous air inside. */
export function Band({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-16 border-t border-line py-20 sm:py-28 ${className}`}
    >
      <Measure>{children}</Measure>
    </section>
  );
}

/** Register label: mono, letter-spaced, small. */
export function Label({
  children,
  tone = "faint",
  className = "",
}: {
  children: ReactNode;
  tone?: "faint" | "muted" | "accent" | "flag" | "warn" | "paper";
  className?: string;
}) {
  const colour = {
    faint: "text-faint",
    muted: "text-muted",
    accent: "text-accent",
    flag: "text-flag",
    warn: "text-warn",
    paper: "text-paper",
  }[tone];
  return (
    <span
      className={`font-ledger text-[10px] tracking-[0.2em] uppercase ${colour} ${className}`}
    >
      {children}
    </span>
  );
}

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

/** 07 → ০৭, for the bilingual section marks and indexes. */
export function bangla(n: number | string) {
  return String(n).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

/**
 * The head of every section: a numbered mark with a rule running to the right
 * edge, then the title on the left seven columns and the lead on the right
 * five. Left-aligned on purpose — nothing on this page is centred.
 */
export function Head({
  index,
  mark,
  title,
  lead,
  bn,
}: {
  index: number;
  mark: string;
  title: ReactNode;
  lead: ReactNode;
  bn?: string;
}) {
  const n = String(index).padStart(2, "0");
  return (
    <Reveal>
      <div className="flex items-center gap-4">
        <Label tone="accent" className="shrink-0">
          {n}
          <span className="text-faint"> / {bangla(n)}</span>
        </Label>
        <Label className="shrink-0">{mark}</Label>
        <span className="rule-draw h-px flex-1 bg-line" />
        {bn ? <span className="shrink-0 text-xs text-faint">{bn}</span> : null}
      </div>
      <div className="mt-8 grid gap-x-8 gap-y-5 lg:grid-cols-12">
        <h2 className="text-[clamp(1.85rem,3.4vw,2.75rem)] leading-[1.1] font-bold tracking-[-0.03em] text-balance text-paper lg:col-span-7">
          {title}
        </h2>
        <p className="text-base leading-relaxed text-muted lg:col-span-5 lg:pt-1.5">
          {lead}
        </p>
      </div>
    </Reveal>
  );
}

/** A figure with its caption, as it would sit on a statement. */
export function Figure({
  value,
  caption,
}: {
  value: ReactNode;
  caption: string;
}) {
  return (
    <div className="px-5 py-5 sm:px-6">
      <p className="font-ledger text-3xl tracking-tight tabular-nums text-paper sm:text-4xl">
        {value}
      </p>
      <p className="mt-2 text-xs leading-snug text-faint">{caption}</p>
    </div>
  );
}

/**
 * A ruled list: rows separated by hairlines, each row a grid so the columns
 * line up straight down the page.
 */
export function Rows({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`border-t border-line ${className}`}>{children}</div>
  );
}

export function Row({
  children,
  className = "",
  interactive = true,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`border-b border-line ${interactive ? "row-hover" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/** A cell in the bordered matrix used for modules and plans. */
export function Cell({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`border-r border-b border-line p-6 sm:p-7 ${className}`}>
      {children}
    </div>
  );
}

/** A status chip: square, hairline, mono — a stamp on a form, not a pill. */
export function Chip({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "warn" | "flag";
}) {
  const colour = {
    muted: "border-line text-muted",
    accent: "border-accent/40 text-accent",
    warn: "border-warn/40 text-warn",
    flag: "border-flag/40 text-flag",
  }[tone];
  return (
    <span
      className={`inline-block border px-2 py-1 font-ledger text-[10px] tracking-[0.14em] whitespace-nowrap uppercase ${colour}`}
    >
      {children}
    </span>
  );
}

/** The one filled button on the page. */
export function Primary({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-3 bg-accent px-6 py-3.5 font-ledger text-[11px] tracking-[0.18em] text-ink uppercase transition hover:bg-accent-bright"
    >
      {children}
      <span className="transition-transform group-hover:translate-x-1">→</span>
    </a>
  );
}

/** Everything else is a ruled text link. */
export function Quiet({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-3 border-b border-line px-1 py-3.5 font-ledger text-[11px] tracking-[0.18em] text-paper uppercase transition hover:border-accent hover:text-accent"
    >
      {children}
      <span className="transition-transform group-hover:translate-x-1">→</span>
    </a>
  );
}

/** A note: a short block held by an accent rule on its left. */
export function Note({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-l border-line pl-5 transition-colors hover:border-accent">
      <h3 className="text-sm font-semibold text-paper">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}
