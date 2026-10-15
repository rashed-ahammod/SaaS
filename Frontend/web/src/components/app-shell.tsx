'use client';
/**
 * The frame around every signed-in screen: offline banner, page content, and the
 * bottom navigation (thumb-reachable on a phone).
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import type { Inbox, InboxItem } from '@/lib/types';
import { num } from '@/lib/format';

const ICONS: Record<string, string> = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  attendance: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  leave: 'M4 6h16M4 6v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6M8 3v6m8-6v6M8 14h3',
  payslips: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  approvals: 'M9 12l2 2 4-4M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
};

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
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
    api.get<Inbox>('/me/notifications?unread=true').then((inbox) => setUnread(inbox.unread)).catch(() => undefined);
  }, [pathname]);

  // pending approvals badge, refreshed when the page changes
  useEffect(() => {
    if (!isApprover) return;
    api.get<InboxItem[]>('/approvals/inbox').then((list) => setWaiting(list.length)).catch(() => undefined);
  }, [isApprover, pathname]);

  const items = [
    { href: '/', key: 'home', label: t('nav.home') },
    { href: '/attendance', key: 'attendance', label: t('nav.attendance') },
    { href: '/leave', key: 'leave', label: t('nav.leave') },
    { href: '/payslips', key: 'payslips', label: t('nav.payslips') },
    ...(isApprover ? [{ href: '/approvals', key: 'approvals', label: t('nav.approvals') }] : []),
    { href: '/profile', key: 'profile', label: t('nav.profile') },
  ];

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col">
      {!online && <div className="sticky top-0 z-20 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">{t('app.offline')}</div>}
      <Link
        href="/notifications"
        aria-label={t('notif.open', { n: num(unread, lang) })}
        className="fixed top-3 right-[max(1rem,calc(50%-15rem))] z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" />
        </svg>
        {unread > 0 && <span className="absolute -top-1 -right-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{num(unread, lang)}</span>}
      </Link>
      <main className="flex-1 px-4 pt-5 pb-28">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-lg">
          {items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${active ? 'font-bold text-emerald-700' : 'text-slate-500'}`}
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={ICONS[item.key]} />
                  </svg>
                  {item.label}
                  {item.key === 'approvals' && waiting > 0 && (
                    <span className="absolute top-1 right-1/4 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{num(waiting, lang)}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
