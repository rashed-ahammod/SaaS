"use client";
/**
 * The frame of the HR / Admin portal: the menu of screens the user's roles
 * allow (with icons, group hints and collapsing), the screen search (Ctrl + K),
 * the company selector, language, sign out, and the step-up code dialog for
 * high-risk actions.
 *
 * On a phone the menu is a drawer behind the ☰ button; on a desktop it is the
 * sidebar. The screens themselves come from lib/portal-guide.ts, which also
 * feeds the search box and the per-screen guide, so the three cannot drift.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Alert, Button, Input } from "@/components/ui";
import { setStepUpHandler } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { GROUPS, type Screen } from "@/lib/portal-guide";
import { useSession } from "@/lib/session";
import { Breadcrumbs, ScreenGuide } from "./guide";
import { Icon } from "./icons";
import { Modal } from "./kit";
import { BACK_OFFICE, usePortal } from "./portal-context";
import { ScreenSearch } from "./screen-search";

const COLLAPSED_KEY = "erp-portal-menu-collapsed";

function readCollapsed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function PortalShell({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const { me, signOut } = useSession();
  const { can, companies, company, setCompanyId } = usePortal();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved choice is only known in the browser
    setCollapsed(readCollapsed());
  }, []);

  // a screen with no permissions of its own (dashboard, approvals) is open to anyone in the portal
  const allowed = (screen: Screen) =>
    screen.needs.length ? can(...screen.needs) : can(...BACK_OFFICE);

  if (!can(...BACK_OFFICE)) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <Alert kind="info">{t("p.noAccess")}</Alert>
        <Link href="/" className="font-semibold text-emerald-800 underline">
          {t("p.employeeApp")}
        </Link>
      </div>
    );
  }

  const toggleGroup = (key: string) => {
    const next = collapsed.includes(key)
      ? collapsed.filter((k) => k !== key)
      : [...collapsed, key];
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      // not remembered; fine
    }
  };

  const active = (href: string) =>
    href === "/portal" || href === "/portal/finance"
      ? pathname === href
      : pathname.startsWith(href);

  const menu = (
    <nav aria-label={t("p.portal")} className="flex-1 space-y-3">
      {GROUPS.map((group) => {
        const screens = group.screens.filter(allowed);
        if (!screens.length) return null;
        const folded = collapsed.includes(group.key);
        return (
          <div key={group.key || "top"}>
            {group.key && (
              <button
                type="button"
                onClick={() => toggleGroup(group.key)}
                aria-expanded={!folded}
                className="mb-1 flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left hover:bg-slate-50"
                title={group.hint ? t(group.hint) : undefined}
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {t(group.key)}
                </span>
                <span
                  className={`text-slate-400 transition-transform ${folded ? "" : "rotate-90"}`}
                  aria-hidden="true"
                >
                  ›
                </span>
              </button>
            )}
            {!folded &&
              screens.map((screen) => (
                <Link
                  key={screen.href}
                  href={screen.href}
                  onClick={() => setDrawer(false)}
                  title={t(`g.${screen.id}.purpose`)}
                  className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${
                    active(screen.href)
                      ? "bg-emerald-50 font-semibold text-emerald-900"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span
                    className={
                      active(screen.href)
                        ? "text-emerald-700"
                        : "text-slate-400"
                    }
                  >
                    <Icon name={screen.icon} />
                  </span>
                  <span className="min-w-0 truncate">{t(screen.key)}</span>
                </Link>
              ))}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-slate-50">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white px-3 py-4 md:flex">
        <p className="mb-4 px-2 text-sm font-bold text-emerald-800">
          {t("p.portal")}
        </p>
        {menu}
        <Link
          href="/"
          className="mt-4 px-2 text-sm text-slate-500 hover:text-slate-800"
        >
          ← {t("p.employeeApp")}
        </Link>
      </aside>

      {/* phone: the same menu as a drawer */}
      {drawer && (
        <div
          className="fixed inset-0 z-40 flex md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t("g.menu")}
        >
          <div className="flex w-72 max-w-[85%] flex-col overflow-y-auto bg-white px-3 py-4">
            <div className="mb-4 flex items-center justify-between px-2">
              <p className="text-sm font-bold text-emerald-800">
                {t("p.portal")}
              </p>
              <button
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
                aria-label={t("p.close")}
                onClick={() => setDrawer(false)}
              >
                ✕
              </button>
            </div>
            {menu}
            <Link href="/" className="mt-4 px-2 text-sm text-slate-500">
              ← {t("p.employeeApp")}
            </Link>
          </div>
          <button
            className="flex-1 bg-slate-900/40"
            aria-label={t("p.close")}
            onClick={() => setDrawer(false)}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-5">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm text-slate-600 md:hidden"
            aria-label={t("g.menu")}
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            ☰
          </button>
          <ScreenSearch allowed={allowed} />
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {companies.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <span className="hidden text-slate-500 sm:inline">
                  {t("p.company")}
                </span>
                <select
                  className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  value={company?.id ?? ""}
                  onChange={(e) => setCompanyId(e.target.value)}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.shortName ?? c.legalName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
              onClick={() => setLang(lang === "bn" ? "en" : "bn")}
            >
              {lang === "bn" ? "English" : "বাংলা"}
            </button>
            <span className="hidden text-sm text-slate-500 lg:inline">
              {me.email}
            </span>
            <button
              className="rounded-lg px-2 py-1 text-sm text-red-700 hover:bg-red-50"
              onClick={signOut}
            >
              {t("p.signOut")}
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-5 sm:py-6">
          {company || !companies.length ? (
            <>
              <Breadcrumbs />
              <ScreenGuide />
              {children}
            </>
          ) : null}
        </main>
      </div>
      <StepUpDialog />
    </div>
  );
}

/** Asks for the 2FA code when the API wants step-up, then the request is sent again with it. */
function StepUpDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const resolver = useRef<((code: string | null) => void) | null>(null);

  useEffect(() => {
    setStepUpHandler(
      () =>
        new Promise<string | null>((resolve) => {
          resolver.current = resolve;
          setCode("");
          setOpen(true);
        }),
    );
    return () => setStepUpHandler(null);
  }, []);

  const finish = (value: string | null) => {
    setOpen(false);
    resolver.current?.(value);
    resolver.current = null;
  };

  return (
    <Modal title={t("p.stepUp.title")} open={open} onClose={() => finish(null)}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (/^\d{6}$/.test(code)) finish(code);
        }}
      >
        <p className="mb-3 text-sm text-slate-600">{t("p.stepUp.text")}</p>
        <Input
          aria-label={t("p.stepUp.code")}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => finish(null)}>
            {t("p.cancel")}
          </Button>
          <Button type="submit" disabled={code.length !== 6}>
            {t("p.stepUp.confirm")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
