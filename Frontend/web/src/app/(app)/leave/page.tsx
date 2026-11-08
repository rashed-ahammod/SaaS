"use client";
/** Leave: balances, my requests (status), cancel a request. */
import { useState } from "react";
import { LeaveStateBadge } from "@/components/status";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardTitle,
  Empty,
  ErrorBox,
  Field,
  Loading,
  PageTitle,
  TextArea,
} from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import { dhakaToday, formatDate, formatDays } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Balance, LeaveRequest } from "@/lib/types";

export default function LeavePage() {
  const { t, lang } = useI18n();
  const balances = useApi<{ balances: Balance[] }>("/me/leave-balances");
  const requests = useApi<LeaveRequest[]>("/me/leave-requests");
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <PageTitle
        action={<ButtonLink href="/leave/apply">{t("leave.apply")}</ButtonLink>}
      >
        {t("leave.title")}
      </PageTitle>
      {message && <Alert kind="success">{message}</Alert>}

      <Card>
        <CardTitle>{t("leave.balances")}</CardTitle>
        {balances.loading ? (
          <Loading />
        ) : balances.error ? (
          <ErrorBox error={balances.error} onRetry={balances.reload} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {balances
              .data!.balances.filter((b) => b.usesBalance)
              .map((b) => (
                <li
                  key={b.leaveTypeId}
                  className="flex items-center justify-between py-2"
                >
                  <span>
                    {lang === "bn" ? (b.nameBn ?? b.nameEn) : b.nameEn}
                  </span>
                  <span className="text-right">
                    <span className="block text-lg font-bold tabular-nums">
                      {formatDays(b.available, lang)}
                    </span>
                    {b.pending > 0 && (
                      <span className="block text-xs text-amber-700">
                        {t("leave.pending", { n: formatDays(b.pending, lang) })}
                      </span>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>{t("leave.myRequests")}</CardTitle>
        {requests.loading ? (
          <Loading />
        ) : requests.error ? (
          <ErrorBox error={requests.error} onRetry={requests.reload} />
        ) : !requests.data?.length ? (
          <Empty />
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.data.map((r) => (
              <RequestItem
                key={r.id}
                request={r}
                onCancelled={() => {
                  setMessage(t("leave.cancelled"));
                  requests.reload();
                  balances.reload();
                }}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RequestItem({
  request: r,
  onCancelled,
}: {
  request: LeaveRequest;
  onCancelled: () => void;
}) {
  const { t, lang } = useI18n();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // waiting, returned, or approved and not started yet, can be cancelled by the employee
  const cancellable =
    r.state === "pending" ||
    r.state === "returned" ||
    (r.state === "approved" && r.from > dhakaToday());

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/leave/requests/${r.id}/cancel`, { reason });
      onCancelled();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const dates =
    r.from === r.to
      ? formatDate(r.from, lang)
      : `${formatDate(r.from, lang, { short: true })} – ${formatDate(r.to, lang)}`;
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">
            {lang === "bn"
              ? (r.leaveType.nameBn ?? r.leaveType.nameEn)
              : r.leaveType.nameEn}{" "}
            · {t("common.days", { n: formatDays(r.days, lang) })}
          </p>
          <p className="text-sm text-slate-600">{dates}</p>
        </div>
        <LeaveStateBadge state={r.state} />
      </div>
      {r.decisionComment &&
        (r.state === "returned" || r.state === "rejected") && (
          <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {t("leave.approverSaid", { c: r.decisionComment })}
          </p>
        )}
      <div className="flex flex-wrap gap-3">
        {r.state === "returned" && (
          <ButtonLink
            href={`/leave/apply?resubmit=${r.id}`}
            variant="secondary"
            className="mt-2 text-sm"
          >
            {t("leave.editResend")}
          </ButtonLink>
        )}
        {cancellable && !asking && (
          <Button
            variant="ghost"
            className="mt-1 px-0 text-sm text-red-700"
            onClick={() => setAsking(true)}
          >
            {t("leave.cancel")}
          </Button>
        )}
      </div>
      {asking && (
        <div className="mt-2">
          {error && <Alert kind="error">{error}</Alert>}
          <Field label={t("leave.cancelReason")}>
            <TextArea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              variant="danger"
              busy={busy}
              disabled={!reason.trim()}
              onClick={cancel}
            >
              {t("leave.cancel")}
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
