"use client";
/**
 * Attendance for HR (a Dept Head sees the department, read-only): who was in on a day, the month
 * (summary, lock for payroll, changes after the lock), phones to approve, shifts with temporary
 * hours (Ramadan), holidays (moved or removed at short notice: affected days are recalculated).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ActionMessage,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Table,
  Tabs,
  useAction,
} from "@/components/portal/kit";
import { useOrg } from "@/components/portal/org";
import { usePortal } from "@/components/portal/portal-context";
import { DayBadge } from "@/components/status";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, saveDownload, useApi } from "@/lib/api";
import {
  dhakaToday,
  formatDate,
  formatMonth,
  formatTime,
  num,
} from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { DayStatus } from "@/lib/types";

type Tab = "day" | "month" | "review" | "phones" | "shifts" | "holidays";
const STATUSES: DayStatus[] = [
  "present",
  "late",
  "half_day",
  "absent",
  "on_leave",
  "missing_punch",
  "holiday",
  "weekend",
];

export default function AttendancePage() {
  const { t } = useI18n();
  const { can } = usePortal();
  const [tab, setTab] = useState<Tab>("day");
  const manage = can("attendance.manage");
  return (
    <div>
      <PageHeader title={t("p.att.title")} />
      <Tabs
        tabs={[
          { key: "day" as Tab, label: t("p.att.tab.day") },
          { key: "month" as Tab, label: t("p.att.tab.month") },
          { key: "review" as Tab, label: t("ar.r.tab") },
          ...(manage
            ? [
                { key: "phones" as Tab, label: t("p.att.tab.phones") },
                { key: "shifts" as Tab, label: t("p.att.tab.shifts") },
                { key: "holidays" as Tab, label: t("p.att.tab.holidays") },
              ]
            : []),
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "day" && <Day />}
      {tab === "month" && <Month />}
      {tab === "review" && <PunchReview />}
      {tab === "phones" && <Phones />}
      {tab === "shifts" && <Shifts />}
      {tab === "holidays" && <Holidays />}
    </div>
  );
}

/**
 * Who was in on one day. The list is where HR notices a missing punch, so a row
 * opens that person's attendance, where the correction can actually be requested.
 */
function Day() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company } = usePortal();
  const { departments } = useOrg(company?.id);
  const [date, setDate] = useState(dhakaToday());
  const [status, setStatus] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const day = useApi<{
    days: Array<{
      employeeId: string;
      employeeCode: string;
      fullNameEn: string;
      status: DayStatus;
      firstIn: string | null;
      lastOut: string | null;
      lateMinutes: number;
      workedMinutes: number;
    }>;
    totals: Record<string, number>;
  }>(
    company
      ? `/attendance/days?companyId=${company.id}&date=${date}${status ? `&status=${status}` : ""}${departmentId ? `&departmentId=${departmentId}` : ""}`
      : null,
  );
  return (
    <Panel
      actions={
        <>
          <Input
            type="date"
            aria-label={t("p.date")}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Select
            aria-label={t("p.att.day.department")}
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            id="day-department"
          >
            <option value="">{t("p.all")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("p.status")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t("p.all")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`p.att.status.${s}`)}
              </option>
            ))}
          </Select>
        </>
      }
    >
      {day.data && (
        <div className="mb-4 flex flex-wrap gap-2">
          {STATUSES.filter((s) => day.data!.totals[s]).map((s) => (
            <span key={s} className="text-sm">
              <DayBadge status={s} /> {num(day.data!.totals[s], lang)}
            </span>
          ))}
        </div>
      )}
      {day.error ? (
        <ErrorBox error={day.error} />
      ) : (
        <Table
          rows={day.data?.days}
          rowKey={(d) => d.employeeCode}
          onRowClick={(d) =>
            router.push(`/portal/employees/${d.employeeId}?tab=attendance`)
          }
          rowTitle={t("p.att.day.open")}
          columns={[
            {
              key: "employeeCode",
              label: t("p.code"),
              className: "font-mono whitespace-nowrap",
            },
            { key: "fullNameEn", label: t("p.name") },
            {
              key: "status",
              label: t("p.status"),
              render: (d) => <DayBadge status={d.status} />,
            },
            {
              key: "in",
              label: t("p.att.in"),
              render: (d) => formatTime(d.firstIn, lang),
            },
            {
              key: "out",
              label: t("p.att.out"),
              render: (d) => formatTime(d.lastOut, lang),
            },
            {
              key: "late",
              label: t("p.att.late"),
              align: "right",
              render: (d) => (d.lateMinutes ? num(d.lateMinutes, lang) : ""),
            },
          ]}
        />
      )}
    </Panel>
  );
}

interface Summary {
  locked: boolean;
  employees: Array<{
    employeeId: string;
    employeeCode: string;
    fullNameEn: string;
    present: number;
    late: number;
    absent: number;
    on_leave: number;
    half_day: number;
    missing_punch: number;
    otMinutes: number;
    latePenaltyDays: number;
  }>;
}

function Month() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const [period, setPeriod] = useState(dhakaToday().slice(0, 7));
  const summary = useApi<Summary>(
    company
      ? `/attendance/summary?companyId=${company.id}&period=${period}`
      : null,
  );
  const locks = useApi<Array<{ period: string; locked_at: string }>>(
    company ? `/attendance/locks?companyId=${company.id}` : null,
  );
  const action = useAction();
  const download = useAction();
  const lastDay = new Date(
    Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0),
  )
    .toISOString()
    .slice(0, 10);
  return (
    <>
      <Panel
        actions={
          <>
            <Input
              type="month"
              aria-label={t("p.period")}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
            <Button
              variant="ghost"
              busy={download.busy}
              onClick={() =>
                download.run(async () =>
                  saveDownload(
                    await api.file(
                      `/attendance/summary.csv?companyId=${company!.id}&period=${period}`,
                    ),
                    `attendance-${period}.csv`,
                  ),
                )
              }
            >
              {t("p.att.export")}
            </Button>
            {can("attendance.manage") &&
              summary.data &&
              !summary.data.locked && (
                <>
                  <Button
                    variant="ghost"
                    busy={action.busy}
                    onClick={() =>
                      action
                        .run(
                          () =>
                            api.post("/attendance/recompute", {
                              companyId: company!.id,
                              from: `${period}-01`,
                              to: lastDay,
                            }),
                          t("p.att.recomputed"),
                        )
                        .then(summary.reload)
                    }
                  >
                    {t("p.att.recompute")}
                  </Button>
                  <Button
                    busy={action.busy}
                    onClick={() =>
                      action
                        .run(
                          () =>
                            api.post("/attendance/locks", {
                              companyId: company!.id,
                              period,
                            }),
                          t("p.att.lockDone"),
                        )
                        .then(() => (summary.reload(), locks.reload()))
                    }
                  >
                    {t("p.att.lock")}
                  </Button>
                </>
              )}
          </>
        }
        title={
          <span className="flex items-center gap-2">
            {formatMonth(period, lang)}
            {summary.data && (
              <Badge color={summary.data.locked ? "green" : "amber"}>
                {summary.data.locked ? t("p.att.locked") : t("p.att.notLocked")}
              </Badge>
            )}
          </span>
        }
      >
        <ActionMessage action={action} />
        {summary.error ? (
          <ErrorBox error={summary.error} />
        ) : !summary.data ? (
          <Loading />
        ) : (
          <Table
            rows={summary.data.employees}
            rowKey={(e) => e.employeeId}
            onRowClick={(e) =>
              router.push(`/portal/employees/${e.employeeId}?tab=attendance`)
            }
            rowTitle={t("p.att.day.open")}
            columns={[
              {
                key: "employeeCode",
                label: t("p.code"),
                className: "font-mono whitespace-nowrap",
              },
              { key: "fullNameEn", label: t("p.name") },
              ...(
                [
                  "present",
                  "late",
                  "half_day",
                  "absent",
                  "on_leave",
                  "missing_punch",
                ] as const
              ).map((s) => ({
                key: s,
                label: t(`p.att.status.${s}`),
                align: "right" as const,
                render: (e: Summary["employees"][number]) =>
                  num(e[s] ?? 0, lang),
              })),
              {
                key: "ot",
                label: t("p.att.ot"),
                align: "right",
                render: (e) => num(e.otMinutes, lang),
              },
              {
                key: "penalty",
                label: t("p.att.penalty"),
                align: "right",
                render: (e) =>
                  e.latePenaltyDays ? num(e.latePenaltyDays, lang) : "",
              },
            ]}
          />
        )}
      </Panel>
      <Panel title={t("p.att.locked")}>
        <div className="flex flex-wrap gap-2">
          {locks.data?.map((l) => (
            <Badge key={l.period} color="green">
              {formatMonth(l.period, lang)}
            </Badge>
          ))}
        </div>
      </Panel>
      <Adjustments />
    </>
  );
}

interface Adjustment {
  id: string;
  employee_code: string;
  full_name_en: string;
  work_date: string;
  previous: { status?: DayStatus };
  corrected: { status?: DayStatus };
  reason: string;
  payroll_period: string | null;
}

/** Locked days that changed afterwards (late correction, holiday moved): they go to the next payroll. */
function Adjustments() {
  const { t, lang } = useI18n();
  const { company } = usePortal();
  const rows = useApi<Adjustment[]>(
    company ? `/attendance/adjustments?companyId=${company.id}` : null,
  );
  if (!rows.data?.length) return null;
  return (
    <Panel title={t("ar.p.adjustments")}>
      <Table
        rows={rows.data}
        rowKey={(a) => a.id}
        columns={[
          {
            key: "employee",
            label: t("p.employee"),
            render: (a) => `${a.employee_code} · ${a.full_name_en}`,
          },
          {
            key: "date",
            label: t("p.date"),
            render: (a) => formatDate(a.work_date, lang, { short: true }),
          },
          {
            key: "was",
            label: t("ar.p.adjPrevious"),
            render: (a) =>
              a.previous.status ? <DayBadge status={a.previous.status} /> : "",
          },
          {
            key: "now",
            label: t("ar.p.adjNow"),
            render: (a) =>
              a.corrected.status ? (
                <DayBadge status={a.corrected.status} />
              ) : (
                ""
              ),
          },
          { key: "reason", label: t("p.reason"), render: (a) => a.reason },
          {
            key: "payroll",
            label: t("ar.p.adjPayroll"),
            render: (a) =>
              a.payroll_period ? (
                formatMonth(a.payroll_period, lang)
              ) : (
                <Badge color="amber">{t("ar.p.adjPending")}</Badge>
              ),
          },
        ]}
      />
    </Panel>
  );
}

interface DeviceRow {
  id: string;
  employeeCode: string;
  employeeName: string;
  name: string;
  status: "pending" | "active" | "revoked";
  registeredAt: string;
  approvedAt: string | null;
}
type PhoneStatus = "pending" | "active" | "revoked";

/**
 * The phone register, not only the queue. A phone that punches attendance is a key
 * to the payroll, so HR has to be able to see which ones are live and stop one —
 * on the last working day, or when a phone is lost. Only pending phones were ever
 * listed before, so an approved phone could never be taken back.
 */
function Phones() {
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<PhoneStatus>("pending");
  const devices = useApi<DeviceRow[]>(`/attendance/devices?status=${status}`);
  const action = useAction();
  const [revoking, setRevoking] = useState<DeviceRow | null>(null);
  const [reason, setReason] = useState("");
  const empty =
    status === "pending"
      ? t("p.att.noPhones")
      : status === "active"
        ? t("p.att.phones.noneActive")
        : t("p.att.phones.noneRevoked");

  return (
    <Panel
      title={t("p.att.phones.title")}
      actions={
        <Select
          aria-label={t("p.att.phones.status")}
          value={status}
          onChange={(e) => setStatus(e.target.value as PhoneStatus)}
          id="phone-status"
        >
          {(["pending", "active", "revoked"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`p.att.phones.${s}`)}
            </option>
          ))}
        </Select>
      }
    >
      <p className="mb-3 text-sm text-slate-600">{t("p.att.phones.intro")}</p>
      <ActionMessage action={action} />
      <Table
        rows={devices.data}
        rowKey={(d) => d.id}
        empty={empty}
        columns={[
          {
            key: "employeeCode",
            label: t("p.code"),
            className: "font-mono whitespace-nowrap",
          },
          { key: "employeeName", label: t("p.name") },
          { key: "name", label: t("p.att.phone") },
          {
            key: "registeredAt",
            label: t("p.att.registered"),
            render: (d) =>
              formatDate(d.registeredAt.slice(0, 10), lang, { short: true }),
          },
          {
            key: "approvedAt",
            label: t("p.att.phones.approved"),
            render: (d) =>
              d.approvedAt
                ? formatDate(d.approvedAt.slice(0, 10), lang, { short: true })
                : "—",
          },
          {
            key: "act",
            label: "",
            align: "right",
            render: (d) => (
              <span className="flex justify-end gap-1">
                {d.status === "pending" && (
                  <Button
                    className="min-h-8 px-3 py-1 text-sm"
                    onClick={() =>
                      action
                        .run(
                          () => api.post(`/attendance/devices/${d.id}/approve`),
                          t("p.done"),
                        )
                        .then(devices.reload)
                    }
                  >
                    {t("p.att.approve")}
                  </Button>
                )}
                {d.status !== "revoked" && (
                  <Button
                    variant="ghost"
                    className="min-h-8 px-3 py-1 text-sm"
                    onClick={() => setRevoking(d)}
                  >
                    {t("p.att.revoke")}
                  </Button>
                )}
              </span>
            ),
          },
        ]}
      />
      <Modal
        title={t("p.att.revoke")}
        open={revoking !== null}
        onClose={() => setRevoking(null)}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await action.run(
                () =>
                  api.post(`/attendance/devices/${revoking!.id}/revoke`, {
                    reason,
                  }),
                t("p.done"),
              )
            ) {
              setRevoking(null);
              setReason("");
              devices.reload();
            }
          }}
        >
          <p className="mb-3 text-sm text-slate-600">
            {revoking &&
              `${revoking.employeeCode} · ${revoking.employeeName} — ${revoking.name}`}
          </p>
          <Field label={t("p.reason")} hint={t("p.att.phones.revokeHint")}>
            <Input
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              id="phone-revoke-reason"
            />
          </Field>
          <FormButtons
            busy={action.busy}
            onCancel={() => setRevoking(null)}
            submitLabel={t("p.att.revoke")}
          />
        </form>
      </Modal>
    </Panel>
  );
}

interface ShiftRow {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  halfDayMinutes: number;
  isDefault: boolean;
  isActive: boolean;
  version: number;
}

function Shifts() {
  const { t } = useI18n();
  const { company } = usePortal();
  const shifts = useApi<ShiftRow[]>(
    company ? `/companies/${company.id}/shifts` : null,
  );
  const save = useAction();
  const [f, setF] = useState({
    code: "",
    name: "",
    startTime: "09:00",
    endTime: "18:00",
    graceMinutes: "15",
    halfDayMinutes: "240",
  });
  const [editing, setEditing] = useState<ShiftRow | null>(null);
  return (
    <>
      <Panel>
        <Table
          rows={shifts.data}
          rowKey={(s) => s.id}
          onRowClick={(s) => setEditing(s)}
          columns={[
            { key: "code", label: t("p.code"), className: "font-mono" },
            { key: "name", label: t("p.name") },
            {
              key: "start",
              label: t("p.att.shift.start"),
              render: (s) => `${s.startTime}–${s.endTime}`,
            },
            {
              key: "grace",
              label: t("p.att.shift.grace"),
              align: "right",
              render: (s) => s.graceMinutes,
            },
            {
              key: "half",
              label: t("p.att.shift.halfDay"),
              align: "right",
              render: (s) => s.halfDayMinutes,
            },
            {
              key: "default",
              label: "",
              render: (s) =>
                s.isDefault ? (
                  <Badge color="green">{t("p.att.shift.default")}</Badge>
                ) : !s.isActive ? (
                  <Badge>{t("ar.p.inactive")}</Badge>
                ) : null,
            },
          ]}
        />
        <ActionMessage action={save} />
        <form
          className="mt-4 grid items-end gap-x-3 sm:grid-cols-3 lg:grid-cols-7"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = {
              ...f,
              graceMinutes: Number(f.graceMinutes),
              halfDayMinutes: Number(f.halfDayMinutes),
              isDefault: !shifts.data?.length,
            };
            if (
              await save.run(
                () => api.post(`/companies/${company!.id}/shifts`, body),
                t("p.saved"),
              )
            )
              shifts.reload();
          }}
        >
          <Field label={t("p.code")}>
            <Input
              required
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
            />
          </Field>
          <Field label={t("p.name")}>
            <Input
              required
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </Field>
          <Field label={t("p.att.shift.start")}>
            <Input
              type="time"
              required
              value={f.startTime}
              onChange={(e) => setF({ ...f, startTime: e.target.value })}
            />
          </Field>
          <Field label={t("p.att.shift.end")}>
            <Input
              type="time"
              required
              value={f.endTime}
              onChange={(e) => setF({ ...f, endTime: e.target.value })}
            />
          </Field>
          <Field label={t("p.att.shift.grace")}>
            <Input
              type="number"
              min={0}
              value={f.graceMinutes}
              onChange={(e) => setF({ ...f, graceMinutes: e.target.value })}
            />
          </Field>
          <Field label={t("p.att.shift.halfDay")}>
            <Input
              type="number"
              min={0}
              value={f.halfDayMinutes}
              onChange={(e) => setF({ ...f, halfDayMinutes: e.target.value })}
            />
          </Field>
          <div className="mb-3">
            <Button type="submit" busy={save.busy} className="w-full">
              {t("p.att.shift.add")}
            </Button>
          </div>
        </form>
      </Panel>
      <Overrides />
      {editing && (
        <EditShift
          shift={editing}
          onClose={() => setEditing(null)}
          onDone={() => (setEditing(null), shifts.reload())}
        />
      )}
    </>
  );
}

function EditShift({
  shift,
  onClose,
  onDone,
}: {
  shift: ShiftRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    name: shift.name,
    startTime: shift.startTime,
    endTime: shift.endTime,
    graceMinutes: String(shift.graceMinutes),
    halfDayMinutes: String(shift.halfDayMinutes),
    isDefault: shift.isDefault,
    isActive: shift.isActive,
  });
  return (
    <Modal
      title={`${t("ar.p.editShift")}: ${shift.code}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            version: shift.version,
            name: f.name,
            startTime: f.startTime,
            endTime: f.endTime,
            graceMinutes: Number(f.graceMinutes),
            halfDayMinutes: Number(f.halfDayMinutes),
            isDefault: f.isDefault,
            isActive: f.isActive,
          };
          if (
            await save.run(
              () => api.patch(`/shifts/${shift.id}`, body),
              t("p.saved"),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("p.name")}>
          <Input
            required
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            id="shift-name"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("p.att.shift.start")}>
            <Input
              type="time"
              required
              value={f.startTime}
              onChange={(e) => setF({ ...f, startTime: e.target.value })}
              id="shift-start"
            />
          </Field>
          <Field label={t("p.att.shift.end")}>
            <Input
              type="time"
              required
              value={f.endTime}
              onChange={(e) => setF({ ...f, endTime: e.target.value })}
              id="shift-end"
            />
          </Field>
          <Field label={t("p.att.shift.grace")}>
            <Input
              type="number"
              min={0}
              value={f.graceMinutes}
              onChange={(e) => setF({ ...f, graceMinutes: e.target.value })}
              id="shift-grace"
            />
          </Field>
          <Field label={t("p.att.shift.halfDay")}>
            <Input
              type="number"
              min={0}
              value={f.halfDayMinutes}
              onChange={(e) => setF({ ...f, halfDayMinutes: e.target.value })}
              id="shift-half"
            />
          </Field>
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.isDefault}
            onChange={(e) => setF({ ...f, isDefault: e.target.checked })}
            id="shift-default"
          />
          {t("p.att.shift.default")}
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.isActive}
            onChange={(e) => setF({ ...f, isActive: e.target.checked })}
            id="shift-active"
          />
          {t("f.vd.active")}
        </label>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

interface OverrideRow {
  id: string;
  name: string;
  branch_id: string | null;
  from_date: string;
  to_date: string;
  start_time: string;
  end_time: string;
  grace_minutes: number | null;
  half_day_minutes: number | null;
}

/** Temporary working hours for a date range, e.g. Ramadan 09:00-15:00 (spec §6.2). */
function Overrides() {
  const { t, lang } = useI18n();
  const { company } = usePortal();
  const { branches } = useOrg(company?.id);
  const rows = useApi<OverrideRow[]>(
    company ? `/companies/${company.id}/shift-overrides` : null,
  );
  const save = useAction();
  const [f, setF] = useState({
    name: "",
    branchId: "",
    fromDate: "",
    toDate: "",
    startTime: "09:00",
    endTime: "15:00",
    graceMinutes: "",
  });
  const branchName = (id: string | null) =>
    id
      ? (branches.find((b) => b.id === id)?.name ?? "")
      : t("ar.p.allBranches");
  return (
    <Panel title={t("ar.p.overrides")}>
      <Table
        rows={rows.data}
        rowKey={(o) => o.id}
        columns={[
          { key: "name", label: t("p.name"), render: (o) => o.name },
          {
            key: "branch",
            label: t("p.branch"),
            render: (o) => branchName(o.branch_id),
          },
          {
            key: "dates",
            label: t("p.period"),
            render: (o) =>
              `${formatDate(o.from_date, lang, { short: true })} – ${formatDate(o.to_date, lang, { short: true })}`,
          },
          {
            key: "hours",
            label: t("p.att.shift.start"),
            render: (o) =>
              `${o.start_time.slice(0, 5)}–${o.end_time.slice(0, 5)}`,
          },
        ]}
      />
      <ActionMessage action={save} />
      <form
        className="mt-4 grid items-end gap-x-3 sm:grid-cols-3 lg:grid-cols-8"
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            name: f.name,
            fromDate: f.fromDate,
            toDate: f.toDate,
            startTime: f.startTime,
            endTime: f.endTime,
            ...(f.branchId ? { branchId: f.branchId } : {}),
            ...(f.graceMinutes ? { graceMinutes: Number(f.graceMinutes) } : {}),
          };
          if (
            await save.run(
              () => api.post(`/companies/${company!.id}/shift-overrides`, body),
              t("p.saved"),
            )
          )
            rows.reload();
        }}
      >
        <Field label={t("p.name")}>
          <Input
            required
            placeholder="Ramadan 2027"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            id="ovr-name"
          />
        </Field>
        <Field label={t("p.branch")}>
          <Select
            value={f.branchId}
            onChange={(e) => setF({ ...f, branchId: e.target.value })}
            id="ovr-branch"
          >
            <option value="">{t("ar.p.allBranches")}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("p.from")}>
          <Input
            type="date"
            required
            value={f.fromDate}
            onChange={(e) => setF({ ...f, fromDate: e.target.value })}
            id="ovr-from"
          />
        </Field>
        <Field label={t("p.to")}>
          <Input
            type="date"
            required
            value={f.toDate}
            onChange={(e) => setF({ ...f, toDate: e.target.value })}
            id="ovr-to"
          />
        </Field>
        <Field label={t("p.att.shift.start")}>
          <Input
            type="time"
            required
            value={f.startTime}
            onChange={(e) => setF({ ...f, startTime: e.target.value })}
            id="ovr-start"
          />
        </Field>
        <Field label={t("p.att.shift.end")}>
          <Input
            type="time"
            required
            value={f.endTime}
            onChange={(e) => setF({ ...f, endTime: e.target.value })}
            id="ovr-end"
          />
        </Field>
        <Field label={t("p.att.shift.grace")}>
          <Input
            type="number"
            min={0}
            value={f.graceMinutes}
            onChange={(e) => setF({ ...f, graceMinutes: e.target.value })}
            id="ovr-grace"
          />
        </Field>
        <div className="mb-3">
          <Button type="submit" busy={save.busy} className="w-full">
            {t("ar.p.newOverride")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

interface HolidayRow {
  id: string;
  date: string;
  nameEn: string;
  nameBn: string | null;
  type: string;
  isActive: boolean;
  version: number;
}

/** Move a holiday (Eid by moon sighting) or remove it: the server recalculates the affected days. */
function EditHoliday({
  holiday,
  onClose,
  onDone,
}: {
  holiday: HolidayRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    date: holiday.date,
    nameEn: holiday.nameEn,
    nameBn: holiday.nameBn ?? "",
    type: holiday.type,
  });
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Modal title={t("ar.p.editHoliday")} open onClose={onClose}>
      <ActionMessage action={save} />
      {!removing ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const body = {
              version: holiday.version,
              date: f.date,
              nameEn: f.nameEn,
              ...(f.nameBn ? { nameBn: f.nameBn } : {}),
              type: f.type,
            };
            if (
              await save.run(
                () => api.patch(`/holidays/${holiday.id}`, body),
                t("ar.p.holidayMoved"),
              )
            )
              onDone();
          }}
        >
          <Field label={t("p.date")}>
            <Input
              type="date"
              required
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
              id="hol-date"
            />
          </Field>
          <Field label={t("p.att.cal.nameEn")}>
            <Input
              required
              value={f.nameEn}
              onChange={(e) => setF({ ...f, nameEn: e.target.value })}
              id="hol-name"
            />
          </Field>
          <Field label={t("p.org.nameBn")}>
            <Input
              value={f.nameBn}
              onChange={(e) => setF({ ...f, nameBn: e.target.value })}
              id="hol-name-bn"
            />
          </Field>
          <Field label={t("p.att.cal.type")}>
            <Select
              value={f.type}
              onChange={(e) => setF({ ...f, type: e.target.value })}
              id="hol-type"
            >
              {["public", "festival", "company"].map((k) => (
                <option key={k} value={k}>
                  {t(`p.att.cal.type.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="mt-4 flex justify-between gap-2">
            <Button
              type="button"
              variant="danger"
              onClick={() => setRemoving(true)}
            >
              {t("ar.p.removeHoliday")}
            </Button>
            <span className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("p.cancel")}
              </Button>
              <Button type="submit" busy={save.busy}>
                {t("p.save")}
              </Button>
            </span>
          </div>
        </form>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await save.run(
                () => api.post(`/holidays/${holiday.id}/remove`, { reason }),
                t("ar.p.holidayMoved"),
              )
            )
              onDone();
          }}
        >
          <Field label={t("ar.p.removeReason")}>
            <Input
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              id="hol-remove-reason"
            />
          </Field>
          <FormButtons
            busy={save.busy}
            onCancel={() => setRemoving(false)}
            submitLabel={t("ar.p.removeHoliday")}
          />
        </form>
      )}
    </Modal>
  );
}

function Holidays() {
  const { t, lang } = useI18n();
  const { company } = usePortal();
  const calendars = useApi<Array<{ id: string; name: string }>>(
    company ? `/companies/${company.id}/holiday-calendars` : null,
  );
  const [calendarId, setCalendarId] = useState<string | null>(null);
  const [year, setYear] = useState(dhakaToday().slice(0, 4));
  const current = calendarId ?? calendars.data?.[0]?.id ?? null;
  const holidays = useApi<HolidayRow[]>(
    current ? `/holiday-calendars/${current}/holidays?year=${year}` : null,
  );
  const [editing, setEditing] = useState<HolidayRow | null>(null);
  const save = useAction();
  const [f, setF] = useState({
    date: "",
    nameEn: "",
    nameBn: "",
    type: "public",
  });
  const [newName, setNewName] = useState("");
  return (
    <Panel
      actions={
        <>
          <Select
            aria-label={t("p.att.tab.holidays")}
            value={current ?? ""}
            onChange={(e) => setCalendarId(e.target.value)}
          >
            {calendars.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            className="w-24"
            type="number"
            aria-label={t("p.att.cal.year")}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </>
      }
    >
      <ActionMessage action={save} />
      {!calendars.data?.length && (
        <form
          className="mb-4 flex items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await save.run(
                () =>
                  api.post(`/companies/${company!.id}/holiday-calendars`, {
                    name: newName,
                  }),
                t("p.saved"),
              )
            )
              calendars.reload();
          }}
        >
          <Field label={t("p.att.cal.new")}>
            <Input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Bangladesh 2026"
            />
          </Field>
          <div className="mb-3">
            <Button type="submit">{t("p.create")}</Button>
          </div>
        </form>
      )}
      <Table
        rows={holidays.data?.filter((h) => h.isActive)}
        rowKey={(h) => h.id}
        columns={[
          {
            key: "date",
            label: t("p.date"),
            render: (h) => formatDate(h.date, lang, { weekday: true }),
          },
          {
            key: "name",
            label: t("p.name"),
            render: (h) => (lang === "bn" ? (h.nameBn ?? h.nameEn) : h.nameEn),
          },
          {
            key: "type",
            label: t("p.att.cal.type"),
            render: (h) => t(`p.att.cal.type.${h.type}`),
          },
          {
            key: "act",
            label: "",
            align: "right",
            render: (h) => (
              <Button
                variant="ghost"
                className="min-h-8 px-3 py-1 text-sm"
                onClick={() => setEditing(h)}
              >
                {t("ar.p.editHoliday")}
              </Button>
            ),
          },
        ]}
      />
      {editing && (
        <EditHoliday
          holiday={editing}
          onClose={() => setEditing(null)}
          onDone={() => (setEditing(null), holidays.reload())}
        />
      )}
      {current && (
        <form
          className="mt-4 grid items-end gap-x-3 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = Object.fromEntries(
              Object.entries(f).filter(([, v]) => v !== ""),
            );
            if (
              await save.run(
                () => api.post(`/holiday-calendars/${current}/holidays`, body),
                t("p.saved"),
              )
            ) {
              setF({ date: "", nameEn: "", nameBn: "", type: "public" });
              holidays.reload();
            }
          }}
        >
          <Field label={t("p.date")}>
            <Input
              type="date"
              required
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
            />
          </Field>
          <Field label={t("p.att.cal.nameEn")}>
            <Input
              required
              value={f.nameEn}
              onChange={(e) => setF({ ...f, nameEn: e.target.value })}
            />
          </Field>
          <Field label={t("p.org.nameBn")}>
            <Input
              value={f.nameBn}
              onChange={(e) => setF({ ...f, nameBn: e.target.value })}
            />
          </Field>
          <Field label={t("p.att.cal.type")}>
            <Select
              value={f.type}
              onChange={(e) => setF({ ...f, type: e.target.value })}
            >
              {["public", "festival", "company"].map((k) => (
                <option key={k} value={k}>
                  {t(`p.att.cal.type.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="mb-3">
            <Button type="submit" busy={save.busy} className="w-full">
              {t("p.att.cal.add")}
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

interface ReviewFinding {
  rule:
    "repeated_coordinates" | "impossible_travel" | "many_refused" | "shared_ip";
  employee: { id: string; code: string; name: string };
  at: string;
  detail: Record<string, unknown>;
}
const RULES = [
  "impossible_travel",
  "repeated_coordinates",
  "many_refused",
  "shared_ip",
] as const;

/** Suspicious phone / web punches in a date range (misuse review): reasons to look, not proof. */
function PunchReview() {
  const { t, lang } = useI18n();
  const { company } = usePortal();
  const today = dhakaToday();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const review = useApi<{
    findings: ReviewFinding[];
    phonePunches: number;
    refusedAttempts: number;
  }>(
    company
      ? `/attendance/punch-review?companyId=${company.id}&from=${from}&to=${to}`
      : null,
  );

  const describe = (f: ReviewFinding): string => {
    const d = f.detail;
    if (f.rule === "repeated_coordinates")
      return `${d.latitude}, ${d.longitude} · ${t("ar.r.days", { d: (d.days as string[]).map((x) => formatDate(x, lang, { short: true })).join(", ") })}`;
    if (f.rule === "impossible_travel")
      return t("ar.r.travel", {
        km: num(Math.round(Number(d.distanceM) / 100) / 10, lang),
        m: num(Number(d.minutes), lang),
        v: num(Number(d.kmh), lang),
        from: t(`ar.r.kind.${d.fromKind}`),
        to: t(`ar.r.kind.${d.toKind}`),
      });
    if (f.rule === "many_refused") {
      const list = Object.entries(d)
        .filter(([k]) => k !== "total")
        .map(([k, n]) => `${t(`ar.r.outcome.${k}`)} ${num(Number(n), lang)}`)
        .join(", ");
      return t("ar.r.refused", { n: num(Number(d.total), lang), list });
    }
    return t("ar.r.ip", {
      ip: String(d.ip),
      others: (d.withEmployees as string[]).join(", "),
    });
  };

  return (
    <Panel
      actions={
        <>
          <Input
            type="date"
            aria-label={t("p.from")}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            id="review-from"
          />
          <Input
            type="date"
            aria-label={t("p.to")}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            id="review-to"
          />
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">{t("ar.r.intro")}</p>
      {review.error ? (
        <ErrorBox error={review.error} onRetry={review.reload} />
      ) : !review.data ? (
        <Loading />
      ) : (
        <>
          <p className="mb-4 text-xs text-slate-500">
            {t("ar.r.stats", {
              p: num(review.data.phonePunches, lang),
              r: num(review.data.refusedAttempts, lang),
            })}
          </p>
          {!review.data.findings.length && (
            <p className="py-6 text-center text-sm text-slate-500">
              {t("ar.r.none")}
            </p>
          )}
          {RULES.map((rule) => {
            const rows = review.data!.findings.filter((f) => f.rule === rule);
            if (!rows.length) return null;
            return (
              <section key={rule} className="mb-5">
                <h3 className="font-semibold text-slate-800">
                  {t(`ar.r.rule.${rule}`)}{" "}
                  <Badge color={rule === "shared_ip" ? "gray" : "amber"}>
                    {num(rows.length, lang)}
                  </Badge>
                </h3>
                <p className="mb-2 text-xs text-slate-500">
                  {t(`ar.r.rule.${rule}.why`)}
                </p>
                <Table
                  rows={rows}
                  rowKey={(f) => `${f.rule}-${f.employee.id}-${f.at}`}
                  columns={[
                    {
                      key: "employee",
                      label: t("p.employee"),
                      render: (f) => `${f.employee.code} · ${f.employee.name}`,
                    },
                    {
                      key: "at",
                      label: t("p.date"),
                      render: (f) =>
                        f.at.length > 10
                          ? `${formatDate(f.at.slice(0, 10), lang, { short: true })} ${formatTime(f.at, lang)}`
                          : formatDate(f.at, lang, { short: true }),
                    },
                    { key: "detail", label: "", render: (f) => describe(f) },
                  ]}
                />
              </section>
            );
          })}
        </>
      )}
    </Panel>
  );
}
