"use client";
/**
 * One employee's attendance in the portal: the month day by day (HR can request a
 * correction or overtime for a day on the employee's behalf), their corrections and
 * overtime requests, and which shift they work (assigned from a date).
 */
import { useState, type FormEvent } from "react";
import {
  AttendanceRequestList,
  DayRequests,
} from "@/components/attendance-requests";
import { DayBadge } from "@/components/status";
import {
  Alert,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import {
  addMonths,
  dhakaToday,
  formatDate,
  formatMonth,
  formatTime,
  monthRange,
  num,
} from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { AttendanceDays } from "@/lib/types";
import { ActionMessage, Panel, Table, useAction } from "./kit";
import { usePortal } from "./portal-context";

export function EmployeeAttendance({
  id,
  companyId,
}: {
  id: string;
  companyId: string;
}) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const today = dhakaToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [open, setOpen] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const { from, to: end } = monthRange(month);
  const days = useApi<AttendanceDays>(
    `/employees/${id}/attendance?from=${from}&to=${end > today ? today : end}`,
  );
  const manage = can("attendance.manage");

  return (
    <>
      <Panel
        title={t("ar.p.month")}
        actions={
          <span className="flex items-center gap-2">
            <Button
              variant="ghost"
              aria-label="previous month"
              onClick={() => setMonth(addMonths(month, -1))}
            >
              ‹
            </Button>
            <span className="font-medium">{formatMonth(month, lang)}</span>
            <Button
              variant="ghost"
              aria-label="next month"
              disabled={month >= today.slice(0, 7)}
              onClick={() => setMonth(addMonths(month, 1))}
            >
              ›
            </Button>
          </span>
        }
      >
        {message && <Alert kind="success">{message}</Alert>}
        {days.loading && !days.data ? (
          <Loading />
        ) : days.error ? (
          <ErrorBox error={days.error} onRetry={days.reload} />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {[...(days.data?.days ?? [])].reverse().map((d) => (
              <li key={d.date} className="py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="w-32">
                    {formatDate(d.date, lang, { weekday: true, short: true })}
                  </span>
                  <span className="flex-1 text-slate-600 tabular-nums">
                    {d.holidayName ??
                      `${t("att.in")} ${formatTime(d.firstIn, lang)} · ${t("att.out")} ${formatTime(d.lastOut, lang)}${d.lateMinutes ? ` · ${t("att.late", { m: num(d.lateMinutes, lang) })}` : ""}${d.otMinutes ? ` · ${t("ar.otWorked", { m: num(d.otMinutes, lang) })}` : ""}`}
                  </span>
                  <DayBadge status={d.status} />
                  {manage && (
                    <button
                      className="text-sm font-medium text-emerald-800 hover:underline"
                      onClick={() => setOpen(open === d.date ? null : d.date)}
                    >
                      {t("ar.fix")}
                    </button>
                  )}
                </div>
                {open === d.date && manage && (
                  <DayRequests
                    employeeId={id}
                    day={d}
                    onDone={(text) => {
                      setMessage(text);
                      setOpen(null);
                      setRefresh((n) => n + 1);
                      days.reload();
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title={t("ar.requests")}>
        <AttendanceRequestList employeeId={id} refresh={refresh} />
      </Panel>
      <ShiftAssignments id={id} companyId={companyId} />
    </>
  );
}

interface Assignment {
  id: string;
  shift_id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  effective_from: string;
  effective_to: string | null;
}

function ShiftAssignments({
  id,
  companyId,
}: {
  id: string;
  companyId: string;
}) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const rows = useApi<Assignment[]>(`/employees/${id}/shift-assignments`);
  const shifts = useApi<
    Array<{
      id: string;
      code: string;
      name: string;
      startTime: string;
      endTime: string;
      isActive: boolean;
    }>
  >(`/companies/${companyId}/shifts`);
  const save = useAction();
  const [f, setF] = useState({
    shiftId: "",
    effectiveFrom: dhakaToday(),
    effectiveTo: "",
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      shiftId: f.shiftId,
      effectiveFrom: f.effectiveFrom,
      ...(f.effectiveTo ? { effectiveTo: f.effectiveTo } : {}),
    };
    if (
      await save.run(
        () => api.post(`/employees/${id}/shift-assignments`, body),
        t("ar.p.assigned"),
      )
    )
      rows.reload();
  }

  return (
    <Panel title={t("ar.p.shift")}>
      <Table
        rows={rows.data}
        rowKey={(a) => a.id}
        empty={t("ar.p.default")}
        columns={[
          {
            key: "shift",
            label: t("ar.p.shift"),
            render: (a) =>
              `${a.code} · ${a.name} (${a.start_time.slice(0, 5)}–${a.end_time.slice(0, 5)})`,
          },
          {
            key: "from",
            label: t("ar.p.from"),
            render: (a) => formatDate(a.effective_from, lang, { short: true }),
          },
          {
            key: "to",
            label: t("ar.p.to"),
            render: (a) =>
              a.effective_to
                ? formatDate(a.effective_to, lang, { short: true })
                : "—",
          },
        ]}
      />
      {can("attendance.manage") && (
        <>
          <ActionMessage action={save} />
          <form
            className="mt-4 grid items-end gap-x-3 sm:grid-cols-4"
            onSubmit={submit}
          >
            <Field label={t("ar.p.shift")}>
              <Select
                required
                value={f.shiftId}
                onChange={(e) => setF({ ...f, shiftId: e.target.value })}
                id="assign-shift"
              >
                <option value="">—</option>
                {shifts.data
                  ?.filter((s) => s.isActive)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name} ({s.startTime}–{s.endTime})
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t("ar.p.from")}>
              <Input
                type="date"
                required
                value={f.effectiveFrom}
                onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })}
                id="assign-from"
              />
            </Field>
            <Field label={t("ar.p.to")}>
              <Input
                type="date"
                value={f.effectiveTo}
                onChange={(e) => setF({ ...f, effectiveTo: e.target.value })}
                id="assign-to"
              />
            </Field>
            <div className="mb-3">
              <Button type="submit" busy={save.busy} className="w-full">
                {t("ar.p.assign")}
              </Button>
            </div>
          </form>
        </>
      )}
    </Panel>
  );
}
