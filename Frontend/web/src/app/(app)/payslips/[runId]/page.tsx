"use client";
/** One payslip, and its PDF in Bangla or English (optionally password-protected). */
import { use, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Icon,
  CardTitle,
  ErrorBox,
  Loading,
  PageTitle,
  Row,
} from "@/components/ui";
import { api, ApiError, saveDownload, useApi } from "@/lib/api";
import { formatMonth, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Payslip, PayslipLine } from "@/lib/types";

/** Names of the heads the payroll engine produces (company heads show their code). */
const HEAD_NAMES: Record<string, { en: string; bn: string }> = {
  BASIC: { en: "Basic salary", bn: "মূল বেতন" },
  HOUSE_RENT: { en: "House rent allowance", bn: "বাড়ি ভাড়া ভাতা" },
  MEDICAL: { en: "Medical allowance", bn: "চিকিৎসা ভাতা" },
  CONVEYANCE: { en: "Conveyance allowance", bn: "যাতায়াত ভাতা" },
  OTHER_ALLOWANCE: { en: "Other allowance", bn: "অন্যান্য ভাতা" },
  COMMISSION: { en: "Sales commission", bn: "বিক্রয় কমিশন" },
  OTHER_DEDUCTION: { en: "Other deduction", bn: "অন্যান্য কর্তন" },
  UNPAID_DAYS: { en: "Unpaid days", bn: "বিনা বেতনের দিন" },
  MATERNITY_PAY: { en: "Maternity benefit", bn: "মাতৃত্বকালীন সুবিধা" },
  ATTENDANCE_ADJUSTMENT: { en: "Attendance adjustment", bn: "হাজিরা সমন্বয়" },
  OVERTIME: { en: "Overtime", bn: "ওভারটাইম" },
  ARREAR: { en: "Arrear", bn: "বকেয়া" },
  LEAVE_ENCASHMENT: { en: "Leave encashment", bn: "ছুটি নগদায়ন" },
  FESTIVAL_BONUS: { en: "Festival bonus", bn: "উৎসব ভাতা" },
  GRATUITY: { en: "Gratuity", bn: "গ্র্যাচুইটি" },
  PF_EMPLOYEE: { en: "Provident fund", bn: "ভবিষ্য তহবিল" },
  LOAN_RECOVERY: { en: "Salary advance recovery", bn: "অগ্রিম বেতন কর্তন" },
  NOTICE_SHORTFALL: {
    en: "Notice period shortfall",
    bn: "নোটিশ মেয়াদের ঘাটতি",
  },
  TAX: { en: "Income tax", bn: "আয়কর" },
  PF_EMPLOYER: {
    en: "Provident fund (employer)",
    bn: "ভবিষ্য তহবিল (নিয়োগকর্তা)",
  },
  GRATUITY_PROVISION: { en: "Gratuity provision", bn: "গ্র্যাচুইটি সঞ্চিতি" },
};

export default function PayslipPage({
  params,
}: PageProps<"/payslips/[runId]">) {
  const { runId } = use(params);
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useApi<Payslip>(
    `/me/payslips/${runId}`,
  );
  const [protect, setProtect] = useState(false);
  const [busy, setBusy] = useState<"bn" | "en" | null>(null);
  const [notice, setNotice] = useState<{
    kind: "info" | "error";
    text: string;
  } | null>(null);

  const label = (l: PayslipLine) =>
    (HEAD_NAMES[l.head]?.[lang] ?? l.head) +
    (l.forPeriod ? ` (${formatMonth(l.forPeriod, lang)})` : "");

  async function download(pdfLang: "bn" | "en") {
    setBusy(pdfLang);
    setNotice(null);
    try {
      const res = await api.file(
        `/me/payslips/${runId}/pdf?lang=${pdfLang}&protect=${protect}`,
      );
      const hint = res.headers.get("x-payslip-password");
      await saveDownload(res, `payslip-${runId}.pdf`);
      if (hint)
        setNotice({
          kind: "info",
          text: t("pay.passwordHint", { hint: t(`pay.hint.${hint}`) }),
        });
    } catch (e) {
      setNotice({ kind: "error", text: (e as ApiError).message });
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Loading />;
  if (error || !data)
    return <ErrorBox error={error ?? new Error("")} onRetry={reload} />;

  const title =
    data.runType === "bonus" && data.bonusName
      ? data.bonusName
      : t(`pay.type.${data.runType}`);
  return (
    <div className="space-y-4">
      <PageTitle back="/payslips">{formatMonth(data.period, lang)}</PageTitle>

      <section className="rounded-3xl bg-emerald-700 p-5 text-white shadow-md">
        <p className="text-sm text-emerald-100">{title}</p>
        <p className="mt-3 text-xs font-semibold tracking-wider text-emerald-100 uppercase">
          {t("pay.net")}
        </p>
        <p className="text-4xl font-bold tabular-nums">
          {formatTaka(data.net, lang)}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-white/10 px-3 py-2">
            <p className="text-emerald-100">{t("pay.gross")}</p>
            <p className="font-semibold tabular-nums">
              {formatTaka(data.gross, lang)}
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 px-3 py-2">
            <p className="text-emerald-100">{t("pay.deductions")}</p>
            <p className="font-semibold tabular-nums">
              {formatTaka(data.totalDeductions, lang)}
            </p>
          </div>
        </div>
      </section>

      <Card>
        <CardTitle>{t("pay.earnings")}</CardTitle>
        {data.earnings.map((l, i) => (
          <Row key={i} label={label(l)} value={formatTaka(l.amount, lang)} />
        ))}
        <div className="mt-1 border-t border-slate-200 pt-1">
          <Row
            label={t("pay.gross")}
            value={formatTaka(data.gross, lang)}
            strong
          />
        </div>
      </Card>

      {data.deductions.length > 0 && (
        <Card>
          <CardTitle>{t("pay.deductions")}</CardTitle>
          {data.deductions.map((l, i) => (
            <Row key={i} label={label(l)} value={formatTaka(l.amount, lang)} />
          ))}
          <div className="mt-1 border-t border-slate-200 pt-1">
            <Row
              label={t("pay.deductions")}
              value={formatTaka(data.totalDeductions, lang)}
              strong
            />
          </div>
        </Card>
      )}

      {data.employerContributions.length > 0 && (
        <Card>
          <CardTitle>{t("pay.employer")}</CardTitle>
          {data.employerContributions.map((l, i) => (
            <Row key={i} label={label(l)} value={formatTaka(l.amount, lang)} />
          ))}
        </Card>
      )}

      <Card>
        <CardTitle>{t("pay.download")}</CardTitle>
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        <label className="mb-3 flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5 accent-emerald-700"
            checked={protect}
            onChange={(e) => setProtect(e.target.checked)}
          />
          <span>{t("pay.protect")}</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            busy={busy === "bn"}
            onClick={() => download("bn")}
          >
            <Icon name="download" className="h-5 w-5" />
            {t("pay.downloadBn")}
          </Button>
          <Button
            variant="secondary"
            busy={busy === "en"}
            onClick={() => download("en")}
          >
            <Icon name="download" className="h-5 w-5" />
            {t("pay.downloadEn")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
