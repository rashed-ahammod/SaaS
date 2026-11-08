"use client";
/**
 * Attendance requests for one day (spec §6.2, §5): a correction of a forgotten or
 * missed punch, and an overtime claim (paid only after the Dept Head approves).
 * Used by the employee app (own days) and by HR in the portal (anyone in scope).
 */
import { useEffect, useState, type FormEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Empty,
  Field,
  Input,
  Loading,
} from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import { formatDate, formatTime, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { AttendanceDay } from "@/lib/types";

interface Correction {
  id: string;
  work_date: string;
  requested_in: string | null;
  requested_out: string | null;
  reason: string;
  status: string;
  created_at: string;
}
interface Overtime {
  id: string;
  work_date: string;
  minutes: number;
  reason: string | null;
  status: string;
  created_at: string;
}

const STATUS_COLOR: Record<string, "amber" | "green" | "red" | "gray"> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
  cancelled: "gray",
};

/** The correction form, and the overtime claim when unapproved overtime was worked. */
export function DayRequests({
  employeeId,
  day,
  onDone,
}: {
  employeeId: string;
  day: AttendanceDay;
  onDone: (message: string) => void;
}) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<"correction" | "overtime" | null>(null);
  const [f, setF] = useState({
    inTime: "",
    outTime: "",
    reason: "",
    minutes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openOt = (day.otMinutes ?? 0) - (day.otApprovedMinutes ?? 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "correction" && !f.inTime && !f.outTime)
      return setError(t("ar.oneTime"));
    setBusy(true);
    try {
      if (mode === "correction") {
        await api.post(`/employees/${employeeId}/attendance-corrections`, {
          date: day.date,
          ...(f.inTime ? { inTime: f.inTime } : {}),
          ...(f.outTime ? { outTime: f.outTime } : {}),
          reason: f.reason.trim(),
        });
        onDone(t("ar.correctionSent"));
      } else {
        await api.post(`/employees/${employeeId}/overtime-requests`, {
          date: day.date,
          ...(f.minutes ? { minutes: Number(f.minutes) } : {}),
          ...(f.reason.trim() ? { reason: f.reason.trim() } : {}),
        });
        onDone(t("ar.overtimeSent"));
      }
      setMode(null);
      setF({ inTime: "", outTime: "", reason: "", minutes: "" });
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (!mode) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          className="!min-h-9 !px-3 !py-1 text-sm"
          onClick={() => setMode("correction")}
        >
          {t("ar.correction")}
        </Button>
        {openOt > 0 && (
          <Button
            type="button"
            variant="secondary"
            className="!min-h-9 !px-3 !py-1 text-sm"
            onClick={() => setMode("overtime")}
          >
            {t("ar.overtime")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-2 space-y-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200"
    >
      {error && <Alert kind="error">{error}</Alert>}
      {day.locked && <Alert kind="info">{t("ar.locked")}</Alert>}
      {mode === "correction" ? (
        <>
          <p className="text-sm text-slate-600">{t("ar.correctionHint")}</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("ar.inTime")}>
              <Input
                type="time"
                value={f.inTime}
                onChange={(e) => setF({ ...f, inTime: e.target.value })}
                id={`corr-in-${day.date}`}
              />
            </Field>
            <Field label={t("ar.outTime")}>
              <Input
                type="time"
                value={f.outTime}
                onChange={(e) => setF({ ...f, outTime: e.target.value })}
                id={`corr-out-${day.date}`}
              />
            </Field>
          </div>
          <Field label={t("ar.reason")} hint={t("ar.reasonHint")}>
            <Input
              required
              maxLength={500}
              value={f.reason}
              onChange={(e) => setF({ ...f, reason: e.target.value })}
              id={`corr-reason-${day.date}`}
            />
          </Field>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            {t("ar.overtimeHint", {
              m: num(day.otMinutes ?? 0, lang),
              a: num(day.otApprovedMinutes ?? 0, lang),
            })}
          </p>
          <Field label={t("ar.minutes")} hint={t("ar.minutesHint")}>
            <Input
              type="number"
              min={1}
              max={openOt}
              value={f.minutes}
              onChange={(e) => setF({ ...f, minutes: e.target.value })}
              id={`ot-minutes-${day.date}`}
            />
          </Field>
          <Field label={t("ar.reason")}>
            <Input
              maxLength={500}
              value={f.reason}
              onChange={(e) => setF({ ...f, reason: e.target.value })}
              id={`ot-reason-${day.date}`}
            />
          </Field>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="ghost" onClick={() => setMode(null)}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" busy={busy}>
          {t("ar.send")}
        </Button>
      </div>
    </form>
  );
}

/** An employee's corrections and overtime requests with their status. */
export function AttendanceRequestList({
  employeeId,
  refresh = 0,
}: {
  employeeId: string;
  refresh?: number;
}) {
  const { t, lang } = useI18n();
  const corrections = useApi<Correction[]>(
    `/employees/${employeeId}/attendance-corrections`,
  );
  const overtime = useApi<Overtime[]>(
    `/employees/${employeeId}/overtime-requests`,
  );
  const reloadCorrections = corrections.reload;
  const reloadOvertime = overtime.reload;
  // a new request was sent: show it
  useEffect(() => {
    if (!refresh) return;
    reloadCorrections();
    reloadOvertime();
  }, [refresh, reloadCorrections, reloadOvertime]);
  if (corrections.loading || overtime.loading) return <Loading />;
  const rows = [
    ...(corrections.data ?? []).map((c) => ({
      id: c.id,
      kind: "correction" as const,
      date: c.work_date,
      status: c.status,
      created: c.created_at,
      reason: c.reason,
      detail: [
        c.requested_in && `${t("att.in")} ${formatTime(c.requested_in, lang)}`,
        c.requested_out &&
          `${t("att.out")} ${formatTime(c.requested_out, lang)}`,
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    ...(overtime.data ?? []).map((o) => ({
      id: o.id,
      kind: "overtime" as const,
      date: o.work_date,
      status: o.status,
      created: o.created_at,
      reason: o.reason ?? "",
      detail: t("ar.otWorked", { m: num(o.minutes, lang) }),
    })),
  ].sort((a, b) => b.created.localeCompare(a.created));
  if (!rows.length) return <Empty />;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li
          key={`${r.kind}-${r.id}`}
          className="flex items-start justify-between gap-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="font-medium">
              {t(`ar.kind.${r.kind}`)} ·{" "}
              {formatDate(r.date, lang, { short: true })}
            </p>
            <p className="text-xs text-slate-500">
              {r.detail}
              {r.reason ? ` · ${r.reason}` : ""}
            </p>
          </div>
          <Badge color={STATUS_COLOR[r.status] ?? "gray"}>
            {t(`ar.status.${r.status}`)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
