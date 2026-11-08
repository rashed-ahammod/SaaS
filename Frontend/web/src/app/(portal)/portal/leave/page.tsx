"use client";
/**
 * Leave in the portal.
 *   Team calendar   who is off when, per department (Dept Head: their department; HR, Admin: any);
 *                   days where many of the team are off are marked (spec §6.3 "for approvers")
 *   Types & policy  leave types (Bangladesh defaults, company types such as study leave) and the
 *                   company's leave policy; HR changes them, others read
 *   Year end        days paid out at year end (encashments) and running year end by hand
 */
import { useState, type FormEvent } from "react";
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
import {
  Alert,
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dhakaToday, formatMonth, monthRange, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

interface LeaveType {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  paid: boolean;
  accrualMethod: "annual_grant" | "monthly" | "per_worked_days" | "none";
  entitlementDays: number | null;
  entitlementRuleKey: string | null;
  maxDaysPerRequest: number | null;
  countsNonWorkingDays: boolean;
  allowHalfDay: boolean;
  documentRequiredOverDays: number | null;
  yearEndAction: "lapse" | "carry";
  carryCapDays: number | null;
  encashable: boolean;
  isActive: boolean;
  version: number;
}

interface Policy {
  leaveYearStart: string;
  sandwichRule: boolean;
  teamAbsenceWarnPct: number;
  maxBackdatedDays: number;
}

type Tab = "calendar" | "types" | "yearEnd";

export default function LeavePage() {
  const { t } = useI18n();
  const { company } = usePortal();
  const [tab, setTab] = useState<Tab>("calendar");
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("p.leave.title")} />
      <Tabs<Tab>
        tabs={[
          { key: "calendar", label: t("lv.tab.calendar") },
          { key: "types", label: t("lv.tab.types") },
          { key: "yearEnd", label: t("lv.tab.yearEnd") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "calendar" && <TeamCalendar companyId={company.id} />}
      {tab === "types" && <TypesAndPolicy companyId={company.id} />}
      {tab === "yearEnd" && <YearEnd companyId={company.id} />}
    </div>
  );
}

// ---------------------------------------------------------------- team calendar

interface Calendar {
  headcount: number;
  leaves: Array<{
    requestId: string;
    employeeId: string;
    employeeCode: string;
    fullNameEn: string;
    leaveType: string;
    from: string;
    to: string;
    halfDay: string | null;
    state: "pending" | "approved";
  }>;
}

function TeamCalendar({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { departments } = useOrg(companyId);
  const policy = useApi<Policy>(`/companies/${companyId}/leave-policy`);
  // '' = everyone this person may see: HR asking "who is off next week" should not
  // have to click through every department in turn.
  const [departmentId, setDepartmentId] = useState("");
  const [month, setMonth] = useState(dhakaToday().slice(0, 7));
  const { from, to } = monthRange(month);
  const narrow = departmentId
    ? `departmentId=${departmentId}`
    : `companyId=${companyId}`;
  const cal = useApi<Calendar>(
    `/leave/team-calendar?${narrow}&from=${from}&to=${to}`,
  );
  const days = Array.from(
    { length: Number(to.slice(8, 10)) },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );

  // one row per person; a day is off when a request covers it
  const people = new Map<
    string,
    { code: string; name: string; leaves: Calendar["leaves"] }
  >();
  for (const l of cal.data?.leaves ?? []) {
    const p = people.get(l.employeeId) ?? {
      code: l.employeeCode,
      name: l.fullNameEn,
      leaves: [],
    };
    p.leaves.push(l);
    people.set(l.employeeId, p);
  }
  const offOn = (d: string) =>
    (cal.data?.leaves ?? [])
      .filter((l) => l.from <= d && l.to >= d)
      .map((l) => l.employeeId);
  const busy = (d: string) => {
    const head = cal.data?.headcount ?? 0;
    return (
      head > 0 &&
      policy.data &&
      (new Set(offOn(d)).size / head) * 100 > policy.data.teamAbsenceWarnPct
    );
  };

  return (
    <Panel
      actions={
        <>
          <Select
            aria-label={t("lv.cal.department")}
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            id="cal-department"
          >
            <option value="">{t("lv.cal.allDepartments")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.name}
              </option>
            ))}
          </Select>
          <Input
            type="month"
            aria-label={t("lv.cal.month")}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            id="cal-month"
          />
        </>
      }
    >
      {cal.error ? (
        <ErrorBox error={cal.error} onRetry={cal.reload} />
      ) : !cal.data ? (
        <Loading />
      ) : (
        <>
          <p className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span>
              {formatMonth(month, lang)} ·{" "}
              {t("lv.cal.headcount", { n: num(cal.data.headcount, lang) })}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm bg-emerald-600" />
              {t("lv.cal.legendApproved")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm bg-amber-400" />
              {t("lv.cal.legendPending")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm bg-red-100 ring-1 ring-red-400" />
              {t("lv.cal.busy")}
            </span>
          </p>
          {!people.size ? (
            <p className="py-6 text-center text-sm text-slate-500">
              {t("lv.cal.none")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="border-collapse text-xs">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-white px-2 py-1 text-left font-semibold">
                      {t("p.employee")}
                    </th>
                    {days.map((d) => (
                      <th
                        key={d}
                        className={`w-6 px-0.5 py-1 text-center font-normal tabular-nums ${busy(d) ? "bg-red-100 text-red-800" : "text-slate-500"}`}
                      >
                        {num(Number(d.slice(8)), lang)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...people.entries()].map(([id, p]) => (
                    <tr key={id} className="border-t border-slate-100">
                      <td className="sticky left-0 whitespace-nowrap bg-white px-2 py-1">
                        {p.code} · {p.name}
                      </td>
                      {days.map((d) => {
                        const l = p.leaves.find(
                          (x) => x.from <= d && x.to >= d,
                        );
                        return (
                          <td key={d} className="px-0.5 py-1 text-center">
                            {l && (
                              <span
                                title={`${l.leaveType} ${l.from}–${l.to}`}
                                className={`inline-block h-4 w-5 rounded-sm text-[9px] leading-4 text-white ${l.state === "approved" ? "bg-emerald-600" : "bg-amber-400"}`}
                              >
                                {l.leaveType}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- types & policy

function TypesAndPolicy({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const manage = can("leave.manage");
  const c = `/companies/${companyId}`;
  const types = useApi<LeaveType[]>(`${c}/leave-types`);
  const policy = useApi<Policy>(`${c}/leave-policy`);
  const action = useAction();
  const [edit, setEdit] = useState<Partial<Policy>>({});
  const [accrued, setAccrued] = useState<number | null>(null);
  const [editing, setEditing] = useState<LeaveType | "new" | null>(null);

  if (types.error) return <ErrorBox error={types.error} />;
  if (!types.data || !policy.data) return <Loading />;
  const p = { ...policy.data, ...edit };

  return (
    <>
      <ActionMessage action={action} />
      {accrued !== null && (
        <Alert kind="success">
          {t("p.leave.accrualsDone", { n: num(accrued, lang) })}
        </Alert>
      )}
      <Panel
        title={t("p.leave.types")}
        actions={
          manage && (
            <>
              {!types.data.length && (
                <Button
                  busy={action.busy}
                  onClick={() =>
                    action
                      .run(
                        () => api.post(`${c}/leave-types/defaults`),
                        t("p.done"),
                      )
                      .then(types.reload)
                  }
                >
                  {t("p.leave.defaults")}
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditing("new")}>
                {t("lv.type.new")}
              </Button>
              <Button
                variant="ghost"
                busy={action.busy}
                onClick={async () => {
                  const r = await action.run(() =>
                    api.post<{ entries: number }>("/leave/accruals/run", {
                      companyId,
                    }),
                  );
                  if (r && typeof r === "object") setAccrued(r.entries);
                }}
              >
                {t("p.leave.runAccruals")}
              </Button>
            </>
          )
        }
      >
        <Table
          rows={types.data}
          rowKey={(x) => x.id}
          onRowClick={manage ? (x) => setEditing(x) : undefined}
          columns={[
            { key: "code", label: t("p.code"), className: "font-mono" },
            {
              key: "name",
              label: t("p.name"),
              render: (x) =>
                lang === "bn" ? (x.nameBn ?? x.nameEn) : x.nameEn,
            },
            {
              key: "paid",
              label: t("p.leave.paid"),
              render: (x) => (x.paid ? t("p.yes") : t("p.no")),
            },
            {
              key: "accrual",
              label: t("p.leave.accrual"),
              className: "text-xs",
              render: (x) => t(`lv.type.accrual.${x.accrualMethod}`),
            },
            {
              key: "days",
              label: t("p.leave.entitlement"),
              align: "right",
              render: (x) =>
                x.entitlementDays !== null
                  ? num(x.entitlementDays, lang)
                  : (x.entitlementRuleKey ?? "—"),
            },
            {
              key: "doc",
              label: t("lv.type.documentOver"),
              align: "right",
              render: (x) =>
                x.documentRequiredOverDays !== null
                  ? num(x.documentRequiredOverDays, lang)
                  : "—",
            },
            {
              key: "yearEnd",
              label: t("lv.type.yearEnd"),
              className: "text-xs",
              render: (x) =>
                `${t(`lv.type.yearEnd.${x.yearEndAction}`)}${x.carryCapDays !== null ? ` (${num(x.carryCapDays, lang)})` : ""}${x.encashable ? " · ৳" : ""}`,
            },
            {
              key: "active",
              label: "",
              render: (x) =>
                !x.isActive ? <Badge>{t("ar.p.inactive")}</Badge> : null,
            },
          ]}
        />
      </Panel>
      <Panel title={t("p.leave.policy")}>
        <form
          className="grid items-end gap-x-4 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await action.run(
                () => api.put(`${c}/leave-policy`, edit),
                t("p.saved"),
              )
            ) {
              setEdit({});
              policy.reload();
            }
          }}
        >
          <fieldset disabled={!manage} className="contents">
            <Field label={t("p.leave.yearStart")}>
              <Input
                pattern="(0[1-9]|1[0-2])-01"
                value={p.leaveYearStart}
                onChange={(e) =>
                  setEdit({ ...edit, leaveYearStart: e.target.value })
                }
              />
            </Field>
            <Field label={t("p.leave.sandwich")}>
              <Select
                value={p.sandwichRule ? "yes" : "no"}
                onChange={(e) =>
                  setEdit({ ...edit, sandwichRule: e.target.value === "yes" })
                }
              >
                <option value="no">{t("p.no")}</option>
                <option value="yes">{t("p.yes")}</option>
              </Select>
            </Field>
            <Field label={t("p.leave.teamWarn")}>
              <Input
                type="number"
                min={1}
                max={100}
                value={p.teamAbsenceWarnPct}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    teamAbsenceWarnPct: Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label={t("p.leave.backdated")}>
              <Input
                type="number"
                min={0}
                max={90}
                value={p.maxBackdatedDays}
                onChange={(e) =>
                  setEdit({ ...edit, maxBackdatedDays: Number(e.target.value) })
                }
              />
            </Field>
            {manage && (
              <div className="mb-3">
                <Button
                  type="submit"
                  disabled={!Object.keys(edit).length}
                  busy={action.busy}
                  className="w-full"
                >
                  {t("p.save")}
                </Button>
              </div>
            )}
          </fieldset>
        </form>
      </Panel>
      {editing && (
        <TypeEditor
          companyId={companyId}
          type={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), types.reload())}
        />
      )}
    </>
  );
}

/** A new company leave type (e.g. study leave) or changes to an existing one. */
function TypeEditor({
  companyId,
  type,
  onClose,
  onSaved,
}: {
  companyId: string;
  type: LeaveType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    code: type?.code ?? "",
    nameEn: type?.nameEn ?? "",
    nameBn: type?.nameBn ?? "",
    paid: type?.paid ?? true,
    accrualMethod: type?.accrualMethod ?? "annual_grant",
    entitlementDays:
      type?.entitlementDays !== null && type?.entitlementDays !== undefined
        ? String(type.entitlementDays)
        : "",
    maxDaysPerRequest:
      type?.maxDaysPerRequest !== null && type?.maxDaysPerRequest !== undefined
        ? String(type.maxDaysPerRequest)
        : "",
    countsNonWorkingDays: type?.countsNonWorkingDays ?? false,
    allowHalfDay: type?.allowHalfDay ?? false,
    documentRequiredOverDays:
      type?.documentRequiredOverDays !== null &&
      type?.documentRequiredOverDays !== undefined
        ? String(type.documentRequiredOverDays)
        : "",
    yearEndAction: type?.yearEndAction ?? "lapse",
    carryCapDays:
      type?.carryCapDays !== null && type?.carryCapDays !== undefined
        ? String(type.carryCapDays)
        : "",
    encashable: type?.encashable ?? false,
    isActive: type?.isActive ?? true,
  });
  const n = (v: string) => (v === "" ? undefined : Number(v));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = type
      ? await save.run(() =>
          api.patch(`/leave-types/${type.id}`, {
            version: type.version,
            nameEn: f.nameEn,
            ...(f.nameBn ? { nameBn: f.nameBn } : {}),
            allowHalfDay: f.allowHalfDay,
            documentRequiredOverDays:
              f.documentRequiredOverDays === ""
                ? null
                : Number(f.documentRequiredOverDays),
            carryCapDays: f.carryCapDays === "" ? null : Number(f.carryCapDays),
            encashable: f.encashable,
            isActive: f.isActive,
          }),
        )
      : await save.run(() =>
          api.post(`/companies/${companyId}/leave-types`, {
            code: f.code,
            nameEn: f.nameEn,
            ...(f.nameBn ? { nameBn: f.nameBn } : {}),
            paid: f.paid,
            accrualMethod: f.accrualMethod,
            ...(n(f.entitlementDays) !== undefined
              ? { entitlementDays: n(f.entitlementDays) }
              : {}),
            ...(n(f.maxDaysPerRequest) !== undefined
              ? { maxDaysPerRequest: n(f.maxDaysPerRequest) }
              : {}),
            countsNonWorkingDays: f.countsNonWorkingDays,
            allowHalfDay: f.allowHalfDay,
            ...(n(f.documentRequiredOverDays) !== undefined
              ? { documentRequiredOverDays: n(f.documentRequiredOverDays) }
              : {}),
            yearEndAction: f.yearEndAction,
            ...(n(f.carryCapDays) !== undefined
              ? { carryCapDays: n(f.carryCapDays) }
              : {}),
            encashable: f.encashable,
          }),
        );
    if (ok) onSaved();
  }

  const check = (
    k:
      | "paid"
      | "countsNonWorkingDays"
      | "allowHalfDay"
      | "encashable"
      | "isActive",
    label: string,
    disabled = false,
  ) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        disabled={disabled}
        checked={f[k]}
        onChange={(e) => setF({ ...f, [k]: e.target.checked })}
        id={`lt-${k}`}
      />
      {label}
    </label>
  );

  return (
    <Modal
      title={type ? `${t("lv.type.edit")}: ${type.code}` : t("lv.type.new")}
      open
      onClose={onClose}
      wide
    >
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("p.code")}>
            <Input
              required
              disabled={!!type}
              pattern="[A-Z0-9]{1,10}"
              placeholder="STUDY"
              value={f.code}
              onChange={(e) =>
                setF({ ...f, code: e.target.value.toUpperCase() })
              }
              id="lt-code"
            />
          </Field>
          <Field label={t("p.name")}>
            <Input
              required
              value={f.nameEn}
              onChange={(e) => setF({ ...f, nameEn: e.target.value })}
              id="lt-name"
            />
          </Field>
          <Field label={t("p.org.nameBn")}>
            <Input
              value={f.nameBn}
              onChange={(e) => setF({ ...f, nameBn: e.target.value })}
              id="lt-name-bn"
            />
          </Field>
          <Field label={t("p.leave.accrual")}>
            <Select
              disabled={!!type}
              value={f.accrualMethod}
              onChange={(e) =>
                setF({
                  ...f,
                  accrualMethod: e.target.value as LeaveType["accrualMethod"],
                })
              }
              id="lt-accrual"
            >
              {(
                ["annual_grant", "monthly", "per_worked_days", "none"] as const
              ).map((m) => (
                <option key={m} value={m}>
                  {t(`lv.type.accrual.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("p.leave.entitlement")}>
            <Input
              type="number"
              min={0}
              step="0.5"
              disabled={!!type}
              value={f.entitlementDays}
              onChange={(e) => setF({ ...f, entitlementDays: e.target.value })}
              id="lt-days"
            />
          </Field>
          <Field label={t("lv.type.maxPerRequest")}>
            <Input
              type="number"
              min={0}
              step="0.5"
              disabled={!!type}
              value={f.maxDaysPerRequest}
              onChange={(e) =>
                setF({ ...f, maxDaysPerRequest: e.target.value })
              }
              id="lt-max"
            />
          </Field>
          <Field label={t("lv.type.documentOver")}>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={f.documentRequiredOverDays}
              onChange={(e) =>
                setF({ ...f, documentRequiredOverDays: e.target.value })
              }
              id="lt-doc"
            />
          </Field>
          <Field label={t("lv.type.yearEnd")}>
            <Select
              disabled={!!type}
              value={f.yearEndAction}
              onChange={(e) =>
                setF({
                  ...f,
                  yearEndAction: e.target.value as "lapse" | "carry",
                })
              }
              id="lt-yearend"
            >
              <option value="lapse">{t("lv.type.yearEnd.lapse")}</option>
              <option value="carry">{t("lv.type.yearEnd.carry")}</option>
            </Select>
          </Field>
          <Field label={t("lv.type.carryCap")}>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={f.carryCapDays}
              onChange={(e) => setF({ ...f, carryCapDays: e.target.value })}
              id="lt-cap"
            />
          </Field>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {check("paid", t("p.leave.paid"), !!type)}
          {check("countsNonWorkingDays", t("lv.type.countsNonWorking"), !!type)}
          {check("allowHalfDay", t("lv.type.halfDay"))}
          {check("encashable", t("lv.type.encashable"))}
          {type && check("isActive", t("lv.type.active"))}
        </div>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={type ? t("p.save") : t("p.create")}
        />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- year end

interface Encashment {
  id: string;
  employee_code: string;
  full_name_en: string;
  leave_type: string;
  leave_year: string;
  days: string;
  status: string;
  payroll_period: string | null;
}

function YearEnd({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const rows = useApi<Encashment[]>(
    `/leave/encashments?companyId=${companyId}`,
  );
  const run = useAction();
  const [year, setYear] = useState(
    String(Number(dhakaToday().slice(0, 4)) - 1),
  );
  return (
    <>
      {can("leave.manage") && (
        <Panel title={t("lv.ye.run")}>
          <p className="mb-3 text-sm text-slate-600">{t("lv.ye.runHint")}</p>
          <ActionMessage action={run} />
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await run.run(
                  () =>
                    api.post("/leave/year-end", { companyId, leaveYear: year }),
                  t("lv.ye.done"),
                )
              )
                rows.reload();
            }}
          >
            <Field label={t("lv.ye.leaveYear")}>
              <Input
                required
                pattern="[0-9]{4}(-[0-9]{2})?"
                className="w-32"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                id="ye-year"
              />
            </Field>
            <div className="mb-3">
              <Button type="submit" busy={run.busy}>
                {t("lv.ye.run")}
              </Button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title={t("lv.ye.encashments")}>
        {rows.error ? (
          <ErrorBox error={rows.error} />
        ) : (
          <Table
            rows={rows.data}
            rowKey={(r) => r.id}
            empty={t("lv.ye.none")}
            columns={[
              {
                key: "employee",
                label: t("p.employee"),
                render: (r) => `${r.employee_code} · ${r.full_name_en}`,
              },
              {
                key: "type",
                label: t("p.code"),
                className: "font-mono",
                render: (r) => r.leave_type,
              },
              {
                key: "year",
                label: t("lv.ye.leaveYear"),
                render: (r) => r.leave_year,
              },
              {
                key: "days",
                label: t("lv.ye.days"),
                align: "right",
                render: (r) => num(Number(r.days), lang),
              },
              {
                key: "status",
                label: t("lv.ye.status"),
                render: (r) => (
                  <Badge color={r.payroll_period ? "green" : "amber"}>
                    {r.status}
                  </Badge>
                ),
              },
              {
                key: "payroll",
                label: t("lv.ye.payroll"),
                render: (r) =>
                  r.payroll_period ? formatMonth(r.payroll_period, lang) : "—",
              },
            ]}
          />
        )}
      </Panel>
    </>
  );
}
