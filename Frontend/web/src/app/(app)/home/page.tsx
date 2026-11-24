"use client";
/**
 * The employee home (/home): today's attendance with the punch button, quick
 * actions, leave balances, the latest payslip, (for managers) how many requests
 * wait for approval, and the AI assistant when the company has it switched on
 * (hidden otherwise, WP11).
 */
import Link from "next/link";
import { DayBadge } from "@/components/status";
import {
  Alert,
  Card,
  CardTitle,
  Icon,
  IconTile,
  type IconName,
  Loading,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import {
  dhakaToday,
  formatDate,
  formatDays,
  formatMonth,
  formatTaka,
  formatTime,
  num,
} from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type {
  AiStatus,
  AttendanceDays,
  Balance,
  InboxItem,
  PayslipSummary,
} from "@/lib/types";

export default function HomePage() {
  const { t, lang } = useI18n();
  const { me, profile, isApprover } = useSession();
  const today = dhakaToday();
  const hasEmployee = profile !== null;

  const attendance = useApi<AttendanceDays>(
    hasEmployee ? `/me/attendance?from=${today}&to=${today}` : null,
  );
  const balances = useApi<{ balances: Balance[] }>(
    hasEmployee ? "/me/leave-balances" : null,
  );
  const payslips = useApi<PayslipSummary[]>(
    hasEmployee ? "/me/payslips" : null,
  );
  const inbox = useApi<InboxItem[]>(isApprover ? "/approvals/inbox" : null);
  const ai = useApi<AiStatus>("/ai/status");

  if (!profile) return <Alert kind="warning">{t("home.noEmployee")}</Alert>;
  const name =
    lang === "bn"
      ? (profile.fullNameBn ?? profile.fullNameEn)
      : profile.fullNameEn;
  const day = attendance.data?.days[0];
  const latest = payslips.data?.[0];
  const waiting = inbox.data?.length ?? 0;

  const can = (p: string) => me?.permissions.includes(p) ?? false;
  const actions: Array<{
    href: string;
    icon: IconName;
    label: string;
    hint?: string;
  }> = [
    { href: "/leave/apply", icon: "leave", label: t("leave.apply") },
    ...(can("expenses.claim_own")
      ? [
          {
            href: "/claims",
            icon: "receipt" as const,
            label: t("x.homeCard"),
            hint: t("x.homeHint"),
          },
        ]
      : []),
    ...(can("procurement.request_own")
      ? [
          {
            href: "/requisitions",
            icon: "cart" as const,
            label: t("pr.home"),
            hint: t("pr.homeHint"),
          },
        ]
      : []),
    ...(can("stock.request_own")
      ? [
          {
            href: "/store-requests",
            icon: "box" as const,
            label: t("st.me.home"),
            hint: t("st.me.homeHint"),
          },
        ]
      : []),
    ...(ai.data?.assistant.available
      ? [
          {
            href: "/assistant",
            icon: "sparkle" as const,
            label: t("ai.title"),
            hint: t("ai.cardHint"),
          },
        ]
      : []),
  ];
  const leaveBalances =
    balances.data?.balances.filter((b) => b.usesBalance) ?? [];

  return (
    <div className="space-y-5">
      <div className="pr-12">
        <p className="text-sm text-slate-500">
          {formatDate(today, lang, { weekday: true })}
        </p>
        <h1 className="text-2xl font-bold text-slate-900">
          {t("home.hello", { name: name.split(" ")[0] })}
        </h1>
      </div>

      {waiting > 0 && (
        <Link
          href="/approvals"
          className="flex items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-300 active:bg-amber-100"
        >
          <IconTile name="approvals" tone="amber" />
          <span className="flex-1 font-semibold text-amber-900">
            {t("home.approvalsWaiting", { n: num(waiting, lang) })}
          </span>
          <Icon name="chevron-right" className="h-5 w-5 text-amber-700" />
        </Link>
      )}

      {/* today: the one thing most people open the app for */}
      <section className="rounded-3xl bg-emerald-700 p-5 text-white shadow-md">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-wider text-emerald-100 uppercase">
            {t("home.today")}
          </h2>
          {!attendance.loading && <DayBadge status={day?.status ?? null} />}
        </div>
        {attendance.loading ? (
          <div className="mb-5 text-emerald-50">
            <Loading />
          </div>
        ) : (
          <div className="mb-5 grid grid-cols-2 gap-3">
            {[
              [t("att.in"), day?.firstIn],
              [t("att.out"), day?.lastOut],
            ].map(([label, time]) => (
              <div key={label} className="rounded-2xl bg-white/10 px-4 py-3">
                <p className="text-xs text-emerald-100">{label}</p>
                <p className="text-2xl font-bold tabular-nums">
                  {formatTime(time ?? null, lang)}
                </p>
              </div>
            ))}
          </div>
        )}
        <Link
          href="/attendance"
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white text-base font-semibold text-emerald-800 active:bg-emerald-50"
        >
          <Icon name="attendance" className="h-5 w-5" />
          {t("home.punchNow")}
        </Link>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-xs font-semibold tracking-wider text-slate-500 uppercase">
          {t("home.quick")}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="flex flex-col gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80 active:bg-slate-50"
            >
              <IconTile name={a.icon} />
              <span className="leading-snug font-semibold text-slate-900">
                {a.label}
              </span>
              {a.hint && (
                <span className="line-clamp-2 text-xs text-slate-500">
                  {a.hint}
                </span>
              )}
            </Link>
          ))}
        </div>
      </section>

      <Card>
        <CardTitle
          action={
            <Link
              href="/leave"
              className="text-sm font-semibold text-emerald-700"
            >
              {t("home.seeAll")}
            </Link>
          }
        >
          {t("home.balances")}
        </CardTitle>
        {balances.loading ? (
          <Loading />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {leaveBalances.map((b) => (
              <div
                key={b.leaveTypeId}
                className="rounded-xl bg-slate-50 px-3 py-2.5"
              >
                <p className="text-2xl font-bold text-slate-900 tabular-nums">
                  {formatDays(b.available, lang)}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {lang === "bn" ? (b.nameBn ?? b.nameEn) : b.nameEn}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {latest && (
        <Link
          href={`/payslips/${latest.runId}`}
          className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80 active:bg-slate-50"
        >
          <IconTile name="payslips" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold tracking-wider text-slate-500 uppercase">
              {t("home.lastPayslip")}
            </span>
            <span className="block text-slate-700">
              {formatMonth(latest.period, lang)}
            </span>
          </span>
          <span className="text-lg font-bold text-emerald-700 tabular-nums">
            {formatTaka(latest.net, lang)}
          </span>
          <Icon
            name="chevron-right"
            className="h-5 w-5 shrink-0 text-slate-400"
          />
        </Link>
      )}
    </div>
  );
}
