"use client";
/**
 * Finding a screen without hunting through the menu: Ctrl + K (or the search
 * box in the header) searches every screen the user's roles open, by name and
 * by what the screen is for — so "salary", "বেতন" or "VAT" all land somewhere.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/portal/icons";
import { useI18n } from "@/lib/i18n";
import { GROUPS, type Screen } from "@/lib/portal-guide";

interface Match {
  screen: Screen;
  group: string;
  label: string;
  purpose: string;
}

export function ScreenSearch({
  allowed,
}: {
  allowed: (screen: Screen) => boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const all = useMemo<Match[]>(
    () =>
      GROUPS.flatMap((g) =>
        g.screens.filter(allowed).map((screen) => ({
          screen,
          group: g.key ? t(g.key) : "",
          label: t(screen.key),
          purpose: t(`g.${screen.id}.purpose`),
        })),
      ),
    [allowed, t],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    const words = q.split(/\s+/);
    return all.filter((m) => {
      const haystack =
        `${m.label} ${m.purpose} ${m.group} ${m.screen.href}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }, [all, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setCursor(0);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  // Ctrl/Cmd + K from anywhere in the portal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((was) => !was);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-slate-300 px-2.5 py-1 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-700"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-4.5-4.5" />
        </svg>
        <span>{t("g.openSearch")}</span>
        <span className="hidden rounded border border-slate-200 bg-slate-50 px-1 text-[11px] font-medium text-slate-500 sm:inline">
          {t("g.shortcut")}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-20"
          role="dialog"
          aria-modal="true"
          aria-label={t("g.openSearch")}
          onClick={close}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              type="search"
              value={query}
              aria-label={t("g.openSearch")}
              placeholder={t("g.searchHint")}
              className="w-full border-b border-slate-200 px-4 py-3 text-base outline-none placeholder:text-slate-400"
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") close();
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, results.length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                }
                if (e.key === "Enter" && results[cursor])
                  go(results[cursor].screen.href);
              }}
            />
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {results.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-slate-500">
                  {t("g.noResults")}
                </li>
              )}
              {results.map((m, i) => (
                <li key={m.screen.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(m.screen.href)}
                    className={`flex w-full items-start gap-3 px-4 py-2 text-left ${i === cursor ? "bg-emerald-50" : ""}`}
                  >
                    <span className="mt-0.5 text-emerald-700">
                      <Icon name={m.screen.icon} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">
                        {m.label}
                        {m.group && (
                          <span className="ml-2 text-xs font-normal text-slate-400">
                            {m.group}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {m.purpose}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
