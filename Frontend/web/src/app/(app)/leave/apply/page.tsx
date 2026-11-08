"use client";
/**
 * Apply for leave: type, dates (or a half day), reason. "Check days" asks the
 * server how many days count (weekends, holidays, sandwich rule), the balance,
 * and how many colleagues would be off; then the request goes for approval.
 *
 * A leave type with a document rule (e.g. sick leave over 2 days) asks for a
 * doctor's certificate: a photo or PDF attached here. With ?resubmit=<id> the
 * page edits a request the approver returned and sends it again.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Loading,
  PageTitle,
  Select,
  TextArea,
} from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import { dhakaToday, formatDate, formatDays, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type {
  Balance,
  LeavePreview,
  LeaveRequest,
  LeaveType,
} from "@/lib/types";

export default function ApplyLeavePage() {
  return (
    <Suspense fallback={<Loading />}>
      <ApplyLeave />
    </Suspense>
  );
}

function ApplyLeave() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const resubmitId = useSearchParams().get("resubmit");
  const { profile } = useSession();
  const balances = useApi<{ balances: Balance[] }>("/me/leave-balances");
  const types = useApi<LeaveType[]>(
    profile ? `/companies/${profile.companyId}/leave-types` : null,
  );
  const returned = useApi<LeaveRequest>(
    resubmitId ? `/leave/requests/${resubmitId}` : null,
  );

  const today = dhakaToday();
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [halfDay, setHalfDay] = useState<"" | "first_half" | "second_half">("");
  const [reason, setReason] = useState("");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "apply" | "upload" | null>(null);

  // a returned request: start from what was asked
  useEffect(() => {
    const r = returned.data;
    if (!r) return;
    /* eslint-disable react-hooks/set-state-in-effect -- copy the returned request into the form once */
    setLeaveTypeId(r.leaveTypeId ?? "");
    setFromDate(r.from);
    setToDate(r.to);
    setHalfDay(r.halfDay ?? "");
    setReason(r.reason ?? "");
    setDocumentId(r.documentId ?? null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [returned.data]);

  const typeInfo = useMemo(
    () => types.data?.find((x) => x.id === leaveTypeId),
    [types.data, leaveTypeId],
  );
  const options = balances.data?.balances ?? [];
  const needsDocument =
    typeInfo?.documentRequiredOverDays !== null &&
    typeInfo?.documentRequiredOverDays !== undefined;

  const body = () => ({
    leaveTypeId,
    fromDate,
    toDate: halfDay ? fromDate : toDate,
    ...(halfDay ? { halfDay } : {}),
    ...(reason.trim() ? { reason: reason.trim() } : {}),
    ...(documentId ? { documentId } : {}),
  });

  async function check() {
    if (!profile) return;
    setBusy("check");
    setError(null);
    try {
      setPreview(
        await api.post<LeavePreview>(
          `/employees/${profile.id}/leave-requests/preview`,
          body(),
        ),
      );
    } catch (e) {
      setPreview(null);
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    if (!profile) return;
    setBusy("upload");
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const doc = await api.upload<{ id: string }>(
        `/employees/${profile.id}/leave-documents`,
        form,
      );
      setDocumentId(doc.id);
      setNote(t("leave.documentAdded"));
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  async function apply(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setBusy("apply");
    setError(null);
    try {
      if (resubmitId)
        await api.post(`/leave/requests/${resubmitId}/resubmit`, body());
      else await api.post(`/employees/${profile.id}/leave-requests`, body());
      router.push("/leave");
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  // any change makes the preview out of date
  const change =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPreview(null);
    };

  if (balances.loading || (resubmitId && returned.loading)) return <Loading />;
  if (balances.error)
    return <ErrorBox error={balances.error} onRetry={balances.reload} />;

  return (
    <div>
      <PageTitle>
        {resubmitId ? t("leave.resendTitle") : t("leave.apply")}
      </PageTitle>
      {returned.data?.decisionComment && (
        <Alert kind="info">
          {t("leave.approverSaid", { c: returned.data.decisionComment })}
        </Alert>
      )}
      <Card>
        <form onSubmit={apply}>
          {error && <Alert kind="error">{error}</Alert>}
          {note && !error && <Alert kind="success">{note}</Alert>}
          <Field label={t("leave.type")}>
            <Select
              value={leaveTypeId}
              onChange={(e) => change(setLeaveTypeId)(e.target.value)}
              required
              id="leave-type"
            >
              <option value="">—</option>
              {options.map((b) => (
                <option key={b.leaveTypeId} value={b.leaveTypeId}>
                  {(lang === "bn" ? (b.nameBn ?? b.nameEn) : b.nameEn) +
                    (b.usesBalance
                      ? ` (${formatDays(b.available, lang)})`
                      : "")}
                </option>
              ))}
            </Select>
          </Field>

          {typeInfo?.allowHalfDay && (
            <Field label={t("leave.halfDay")}>
              <Select
                value={halfDay}
                onChange={(e) =>
                  change(setHalfDay)(e.target.value as typeof halfDay)
                }
              >
                <option value="">{t("leave.fullDay")}</option>
                <option value="first_half">{t("leave.firstHalf")}</option>
                <option value="second_half">{t("leave.secondHalf")}</option>
              </Select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("leave.from")}>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  change(setFromDate)(e.target.value);
                  if (e.target.value > toDate) setToDate(e.target.value);
                }}
                required
                id="leave-from"
              />
            </Field>
            {!halfDay && (
              <Field label={t("leave.to")}>
                <Input
                  type="date"
                  value={toDate}
                  min={fromDate}
                  onChange={(e) => change(setToDate)(e.target.value)}
                  required
                  id="leave-to"
                />
              </Field>
            )}
          </div>

          <Field label={t("leave.reason")}>
            <TextArea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              id="leave-reason"
            />
          </Field>

          {needsDocument && (
            <Field
              label={t("leave.document")}
              hint={t("leave.documentHint", {
                n: num(typeInfo!.documentRequiredOverDays!, lang),
              })}
            >
              <div className="flex items-center gap-3">
                <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-white px-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-700">
                  {busy === "upload"
                    ? t("leave.uploading")
                    : `📎 ${t("leave.documentAdd")}`}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    className="sr-only"
                    id="leave-document"
                    aria-label={t("leave.document")}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {documentId && (
                  <span className="text-sm text-emerald-700">
                    ✓ {t("leave.documentAdded")}
                  </span>
                )}
              </div>
            </Field>
          )}

          {preview && (
            <Alert kind={preview.teamWarnings.length ? "warning" : "info"}>
              <p className="font-semibold">
                {t("leave.preview", { n: formatDays(preview.days, lang) })}
              </p>
              {preview.available !== null && (
                <p>
                  {t("leave.previewAvailable", {
                    n: formatDays(preview.available, lang),
                  })}
                </p>
              )}
              {preview.teamWarnings.map((w) => (
                <p key={w.date}>
                  {t("leave.teamWarning", {
                    date: formatDate(w.date, lang, { short: true }),
                    count: num(w.onLeave, lang),
                    total: num(w.headcount, lang),
                  })}
                </p>
              ))}
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="secondary"
              busy={busy === "check"}
              disabled={!leaveTypeId}
              onClick={check}
            >
              {t("leave.check")}
            </Button>
            <Button
              type="submit"
              busy={busy === "apply"}
              disabled={!leaveTypeId || busy === "upload"}
            >
              {resubmitId ? t("leave.resend") : t("common.submit")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
