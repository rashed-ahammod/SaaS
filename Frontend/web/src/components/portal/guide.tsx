"use client";
/**
 * Every portal screen explains itself. The shell renders <ScreenGuide/> above
 * the page, so no screen has to remember to do it:
 *
 *   What this screen is for   one sentence, always visible
 *   How it works              the steps the work takes, opened on demand
 *   Where to next             the screens this work continues on
 *
 * Whether the steps are open is remembered per person (localStorage), not per
 * screen, so someone who knows the system folds them away once.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/portal/icons";
import { useI18n } from "@/lib/i18n";
import { groupOf, screenById, screenOf, stepKeys } from "@/lib/portal-guide";

const OPEN_KEY = "erp-portal-guide-open";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "no";
  } catch {
    return true; // storage blocked: show the guide
  }
}

/** Group › screen, so it is clear where a screen sits. */
export function Breadcrumbs() {
  const { t } = useI18n();
  const pathname = usePathname();
  const screen = screenOf(pathname);
  if (!screen) return null;
  const group = groupOf(screen);
  return (
    <nav
      aria-label={t("g.allScreens")}
      className="mb-2 flex items-center gap-1.5 text-xs text-slate-500"
    >
      <Link href="/portal" className="hover:text-slate-800 hover:underline">
        {t("p.nav.dashboard")}
      </Link>
      {group?.key && (
        <>
          <span aria-hidden="true">›</span>
          <span>{t(group.key)}</span>
        </>
      )}
      {screen.href !== "/portal" && (
        <>
          <span aria-hidden="true">›</span>
          <span className="font-medium text-slate-700">{t(screen.key)}</span>
        </>
      )}
    </nav>
  );
}

export function ScreenGuide() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved choice is only known in the browser
    setOpen(readOpen());
    setReady(true);
  }, []);

  const screen = screenOf(pathname);
  if (!screen) return null;
  const steps = stepKeys(screen);
  const next = (screen.next ?? [])
    .map(screenById)
    .filter((s) => s !== undefined);

  const toggle = () => {
    const value = !open;
    setOpen(value);
    try {
      localStorage.setItem(OPEN_KEY, value ? "yes" : "no");
    } catch {
      // not remembered; fine
    }
  };

  return (
    <section
      className="mb-5 rounded-xl bg-emerald-50/70 p-4 ring-1 ring-emerald-100"
      aria-label={t("g.what")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <span className="mt-0.5 shrink-0 text-emerald-700">
            <Icon name={screen.icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
              {t("g.what")}
            </p>
            <p className="mt-0.5 text-sm text-slate-700">
              {t(`g.${screen.id}.purpose`)}
            </p>
          </div>
        </div>
        {(steps.length > 0 || next.length > 0) && ready && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="shrink-0 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
          >
            {open ? t("g.hide") : t("g.how")}
          </button>
        )}
      </div>

      {open && (steps.length > 0 || next.length > 0) && (
        <div className="mt-3 border-t border-emerald-100 pt-3">
          {steps.length > 0 && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                {t("g.how")}
              </p>
              <ol className="mt-1.5 space-y-1.5">
                {steps.map((key, i) => (
                  <li key={key} className="flex gap-2 text-sm text-slate-700">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-[11px] font-bold text-white tabular-nums">
                      {i + 1}
                    </span>
                    <span>{t(key)}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {next.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                {t("g.next")}
              </span>
              {next.map((s) => (
                <Link
                  key={s.id}
                  href={s.href}
                  className="rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-50"
                >
                  {t(s.key)} →
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * An empty list that says what to do next, instead of only "Nothing here yet."
 *
 *   <EmptyState text={t('p.emp.noneYet')} action={<ButtonLink …/>} />
 */
export function EmptyState({
  text,
  hint,
  action,
}: {
  text: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm font-medium text-slate-700">{text}</p>
      {hint && (
        <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{hint}</p>
      )}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}
