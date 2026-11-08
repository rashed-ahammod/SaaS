"use client";
/**
 * Consent for attendance data (WP12, spec §11): the notice in the user's
 * language, the current answer, and agree / withdraw. The server keeps the full
 * history; the latest answer counts.
 */
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { api, type ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Consent } from "@/lib/types";

/** One consent: label, status, the notice (folded), and the button to agree or withdraw. */
export function ConsentItem({
  consent,
  onChanged,
  openNotice = false,
}: {
  consent: Consent;
  onChanged: () => void;
  openNotice?: boolean;
}) {
  const { t, lang } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const granted = consent.status === "granted";

  async function answer(value: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.post("/me/consents", {
        purpose: consent.purpose,
        granted: value,
      });
      onChanged();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={t(`consent.${consent.purpose}`)}
      className="border-b border-slate-100 py-3 last:border-0"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-slate-900">
          {t(`consent.${consent.purpose}`)}
        </span>
        <Badge
          color={
            granted
              ? "green"
              : consent.status === "withdrawn"
                ? "amber"
                : "gray"
          }
        >
          {t(`consent.${consent.status}`)}
        </Badge>
      </div>
      {consent.since && (
        <p className="text-xs text-slate-500">
          {formatDate(consent.since.slice(0, 10), lang)}
        </p>
      )}
      <details className="mt-1" open={openNotice}>
        <summary className="cursor-pointer text-sm text-emerald-800">
          {t("consent.readNotice")}
        </summary>
        <p className="mt-1 text-sm text-slate-700">{consent.notice[lang]}</p>
      </details>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      <Button
        variant={granted ? "ghost" : "secondary"}
        className="mt-2 w-full"
        busy={busy}
        onClick={() => answer(!granted)}
      >
        {granted ? t("consent.withdraw") : t("consent.agree")}
      </Button>
    </section>
  );
}
