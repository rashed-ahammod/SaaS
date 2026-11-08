"use client";
/**
 * Pieces shared by the employee app and the portal for expense claims and cash
 * advances: state badges and the receipt viewer (the file is fetched through the
 * BFF, so it needs the app's header; a plain link would be refused).
 */
import { useEffect, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { api } from "@/lib/api";
import type { AdvanceState, ClaimState } from "@/lib/expense-types";
import { useI18n } from "@/lib/i18n";

const CLAIM_COLOR = {
  draft: "gray",
  in_approval: "amber",
  approved: "blue",
  paid: "green",
  settled: "green",
  rejected: "red",
  cancelled: "gray",
} as const;
const ADVANCE_COLOR = {
  in_approval: "amber",
  approved: "blue",
  paid: "amber",
  settled: "green",
  rejected: "red",
  cancelled: "gray",
} as const;

export function ClaimBadge({ state }: { state: ClaimState }) {
  const { t } = useI18n();
  return <Badge color={CLAIM_COLOR[state]}>{t(`x.state.${state}`)}</Badge>;
}

export function AdvanceBadge({ state }: { state: AdvanceState }) {
  const { t } = useI18n();
  return <Badge color={ADVANCE_COLOR[state]}>{t(`x.adv.${state}`)}</Badge>;
}

/** A receipt: a thumbnail for photos (tap to enlarge), a button that opens a PDF. */
export function ReceiptView({
  claimId,
  receiptId,
  contentType,
}: {
  claimId: string;
  receiptId: string;
  contentType?: string;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const isPdf = contentType === "application/pdf";

  useEffect(() => {
    if (isPdf) return;
    let alive = true;
    let objectUrl: string | null = null;
    api
      .file(`/expense-claims/${claimId}/receipts/${receiptId}/file`)
      .then((res) => res.blob())
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (alive) setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [claimId, receiptId, isPdf]);

  if (isPdf) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="!min-h-8 !px-2 !py-1 text-sm"
        onClick={async () => {
          const res = await api.file(
            `/expense-claims/${claimId}/receipts/${receiptId}/file`,
          );
          const pdf = URL.createObjectURL(await res.blob());
          window.open(pdf, "_blank", "noopener");
          setTimeout(() => URL.revokeObjectURL(pdf), 60_000);
        }}
      >
        📄 {t("x.viewReceipt")}
      </Button>
    );
  }
  if (!url)
    return (
      <span
        className="inline-block h-12 w-12 animate-pulse rounded bg-slate-100"
        aria-label={t("x.receipt")}
      />
    );
  return (
    <>
      <button
        type="button"
        onClick={() => setBig(true)}
        aria-label={t("x.viewReceipt")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a private blob URL, not an optimisable asset */}
        <img
          src={url}
          alt={t("x.receipt")}
          className="h-12 w-12 rounded object-cover ring-1 ring-slate-200"
        />
      </button>
      {big && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("x.receipt")}
          onClick={() => setBig(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- as above */}
          <img
            src={url}
            alt={t("x.receipt")}
            className="max-h-full max-w-full rounded bg-white"
          />
        </div>
      )}
    </>
  );
}
