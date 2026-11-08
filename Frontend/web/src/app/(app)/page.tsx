"use client";
/**
 * Home: today's attendance with the punch button, leave balances, the latest
 * payslip, (for managers) how many requests wait for approval, and the AI
 * assistant when the company has it switched on (hidden otherwise, WP11).
 */
import Link from "next/link";
import { DayBadge } from "@/components/status";
import {
  Alert,
  ButtonLink,
  Card,
  CardTitle,
  Loading,
  Row,
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

  return (
    <div className="space-y-4">
      <div>
        <p className="text-slate-500">
          {formatDate(today, lang, { weekday: true })}
        </p>
        <h1 className="text-2xl font-bold">
          {t("home.hello", { name: name.split(" ")[0] })}
        </h1>
      </div>

      {(inbox.data?.length ?? 0) > 0 && (
        <Link
          href="/approvals"
          className="block rounded-2xl bg-amber-100 px-4 py-3 font-semibold text-amber-900 ring-1 ring-amber-300"
        >
          {t("home.approvalsWaiting", { n: num(inbox.data!.length, lang) })} →
        </Link>
      )}

      <Card>
        <CardTitle>{t("home.today")}</CardTitle>
        {attendance.loading ? (
          <Loading />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <DayBadge status={day?.status ?? null} />
              <span className="text-sm text-slate-600 tabular-nums">
                {t("att.in")} {formatTime(day?.firstIn, lang)} · {t("att.out")}{" "}
                {formatTime(day?.lastOut, lang)}
              </span>
            </div>
            <ButtonLink href="/attendance" className="w-full">
              {t("home.punchNow")}
            </ButtonLink>
          </>
        )}
      </Card>

      <Card>
        <CardTitle>{t("home.balances")}</CardTitle>
        {balances.loading ? (
          <Loading />
        ) : (
          balances.data?.balances
            .filter((b) => b.usesBalance)
            .map((b) => (
              <Row
                key={b.leaveTypeId}
                label={lang === "bn" ? (b.nameBn ?? b.nameEn) : b.nameEn}
                value={t("leave.available", {
                  n: formatDays(b.available, lang),
                })}
              />
            ))
        )}
        <ButtonLink
          href="/leave/apply"
          variant="secondary"
          className="mt-2 w-full"
        >
          {t("leave.apply")}
        </ButtonLink>
      </Card>

      {me?.permissions.includes("expenses.claim_own") && (
        <Link
          href="/claims"
          className="block rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200"
        >
          <span className="block font-semibold text-slate-900">
            {t("x.homeCard")} →
          </span>
          <span className="block text-sm text-slate-600">
            {t("x.homeHint")}
          </span>
        </Link>
      )}

      {me?.permissions.includes("procurement.request_own") && (
        <Link
          href="/requisitions"
          className="block rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200"
        >
          <span className="block font-semibold text-slate-900">
            {t("pr.home")} →
          </span>
          <span className="block text-sm text-slate-600">
            {t("pr.homeHint")}
          </span>
        </Link>
      )}

      {me?.permissions.includes("stock.request_own") && (
        <Link
          href="/store-requests"
          className="block rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200"
        >
          <span className="block font-semibold text-slate-900">
            {t("st.me.home")} →
          </span>
          <span className="block text-sm text-slate-600">
            {t("st.me.homeHint")}
          </span>
        </Link>
      )}

      {ai.data?.assistant.available && (
        <Link
          href="/assistant"
          className="block rounded-2xl bg-emerald-50 px-4 py-3 ring-1 ring-emerald-200"
        >
          <span className="block font-semibold text-emerald-900">
            {t("ai.title")} →
          </span>
          <span className="block text-sm text-emerald-800">
            {t("ai.cardHint")}
          </span>
        </Link>
      )}

      {latest && (
        <Link href={`/payslips/${latest.runId}`} className="block">
          <Card>
            <CardTitle>{t("home.lastPayslip")}</CardTitle>
            <Row
              label={formatMonth(latest.period, lang)}
              value={formatTaka(latest.net, lang)}
              strong
            />
          </Card>
        </Link>
      )}
    </div>
  );
}
