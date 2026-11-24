"use client";
/**
 * The frame around every signed-in screen: offline banner, page content, and the
 * bottom navigation (thumb-reachable on a phone).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { Inbox, InboxItem } from "@/lib/types";
import { num } from "@/lib/format";
import { Icon, type IconName } from "@/components/ui";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n();
  const { isApprover } = useSession();
  const online = useOnline();
  const pathname = usePathname();
  const [waiting, setWaiting] = useState(0);
  const [unread, setUnread] = useState(0);

  // unread messages (bell), refreshed when the page changes
  useEffect(() => {
    api
      .get<Inbox>("/me/notifications?unread=true")
      .then((inbox) => setUnread(inbox.unread))
      .catch(() => undefined);
  }, [pathname]);

  // pending approvals badge, refreshed when the page changes
  useEffect(() => {
    if (!isApprover) return;
    api
      .get<InboxItem[]>("/approvals/inbox")
      .then((list) => setWaiting(list.length))
      .catch(() => undefined);
  }, [isApprover, pathname]);

  const items: Array<{ href: string; key: IconName; label: string }> = [
    { href: "/home", key: "home", label: t("nav.home") },
    { href: "/attendance", key: "attendance", label: t("nav.attendance") },
    { href: "/leave", key: "leave", label: t("nav.leave") },
    { href: "/payslips", key: "payslips", label: t("nav.payslips") },
    ...(isApprover
      ? [
          {
            href: "/approvals",
            key: "approvals" as const,
            label: t("nav.approvals"),
          },
        ]
      : []),
    { href: "/profile", key: "profile", label: t("nav.profile") },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      {!online && (
        <div className="sticky top-0 z-20 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
          {t("app.offline")}
        </div>
      )}
      <Link
        href="/notifications"
        aria-label={t("notif.open", { n: num(unread, lang) })}
        className="fixed top-3 right-[max(1rem,calc(50%-15rem))] z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-slate-700 shadow-sm ring-1 ring-slate-200 backdrop-blur active:bg-slate-100"
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-red-600 px-1.5 text-center text-[10px] leading-5 font-bold text-white ring-2 ring-white">
            {num(unread, lang)}
          </span>
        )}
      </Link>
      <main className="flex-1 px-4 pt-4 pb-28">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <ul className="mx-auto flex max-w-lg">
          {items.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-16 flex-col items-center justify-center gap-1 pt-1.5 pb-1 text-[11px] ${active ? "font-medium text-emerald-800" : "text-slate-500"}`}
                >
                  <span
                    className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-colors ${active ? "bg-emerald-50 text-emerald-700" : ""}`}
                  >
                    <Icon name={item.key} />
                    {item.key === "approvals" && waiting > 0 && (
                      <span className="absolute -top-1 right-1 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] leading-[18px] font-bold text-white ring-2 ring-white">
                        {num(waiting, lang)}
                      </span>
                    )}
                  </span>
                  <span className="max-w-full truncate px-0.5">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
