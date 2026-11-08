"use client";
/** The tabs of the employee screen in the HR / Admin portal. */
import { useState, type FormEvent } from "react";
import {
  ActionMessage,
  Detail,
  FormButtons,
  Modal,
  Panel,
  Table,
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
import { api, saveDownload, useApi } from "@/lib/api";
import { formatDate, formatDays, formatMonth, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { EmployeeSummary, Page, Placement } from "@/lib/portal-types";
import { EmployeeAttendance } from "./employee-attendance";
import { EmployeeLeave } from "./employee-leave";
import {
  EmployeeDocuments,
  JobChanges,
  LifecycleStatus,
} from "./employee-lifecycle";
import {
  BankRequest,
  EmployeeLoans,
  EmployeeStatements,
} from "./employee-payroll";

export type TabKey =
  | "profile"
  | "onboarding"
  | "job"
  | "salary"
  | "bank"
  | "leave"
  | "attendance"
  | "payslips"
  | "loans"
  | "statements"
  | "documents";

export interface EmployeeDetail {
  id: string;
  companyId: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameBn: string | null;
  status: "draft" | "probation" | "active" | "notice" | "separated";
  joinDate: string;
  dateOfBirth: string | null;
  gender: string | null;
  nid: string | null;
  tin: string | null;
  personalEmail: string | null;
  phone: string | null;
  presentAddress: string | null;
  permanentAddress: string | null;
  emergencyContact: { name: string | null; phone: string | null } | null;
  festivalGroup: string | null;
  probationEndDate: string | null;
  lastWorkingDay: string | null;
  confirmedAt: string | null;
  version: number;
  currentAssignment: Placement | null;
}

export function EmployeeTabs({
  tab,
  employee,
  reload,
}: {
  tab: TabKey;
  employee: EmployeeDetail;
  reload: () => void;
}) {
  switch (tab) {
    case "profile":
      return (
        <>
          <LifecycleStatus e={employee} reload={reload} />
          <ProfileTab e={employee} reload={reload} />
        </>
      );
    case "documents":
      return <EmployeeDocuments id={employee.id} />;
    case "onboarding":
      return <OnboardingTab id={employee.id} />;
    case "job":
      return <JobTab e={employee} reload={reload} />;
    case "salary":
      return <SalaryTab e={employee} />;
    case "bank":
      return <BankTab id={employee.id} />;
    case "leave":
      return <LeaveTab id={employee.id} companyId={employee.companyId} />;
    case "attendance":
      return <AttendanceTab id={employee.id} companyId={employee.companyId} />;
    case "payslips":
      return <PayslipsTab id={employee.id} />;
    case "loans":
      return <EmployeeLoans id={employee.id} />;
    case "statements":
      return <EmployeeStatements id={employee.id} />;
  }
}

// ------------------------------------------------------------------ profile

function ProfileTab({ e, reload }: { e: EmployeeDetail; reload: () => void }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const [edit, setEdit] = useState(false);
  const a = e.currentAssignment;
  return (
    <Panel
      actions={
        can("employee.manage") && (
          <Button variant="secondary" onClick={() => setEdit(true)}>
            {t("p.emp.edit")}
          </Button>
        )
      }
    >
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label={t("p.emp.nameEn")}>{e.fullNameEn}</Detail>
        <Detail label={t("p.emp.nameBn")}>{e.fullNameBn}</Detail>
        <Detail label={t("p.code")}>{e.employeeCode}</Detail>
        <Detail label={t("p.emp.joined")}>
          {formatDate(e.joinDate, lang)}
        </Detail>
        <Detail label={t("p.emp.gender")}>
          {e.gender && t(`p.emp.gender.${e.gender}`)}
        </Detail>
        <Detail label={t("p.emp.dob")}>
          {e.dateOfBirth && formatDate(e.dateOfBirth, lang)}
        </Detail>
        <Detail label={t("p.emp.nid")}>{e.nid}</Detail>
        <Detail label={t("p.emp.tin")}>{e.tin}</Detail>
        <Detail label={t("p.emp.phone")}>{e.phone}</Detail>
        <Detail label={t("p.emp.email")}>{e.personalEmail}</Detail>
        <Detail label={t("p.emp.presentAddress")}>{e.presentAddress}</Detail>
        <Detail label={t("p.emp.permanentAddress")}>
          {e.permanentAddress}
        </Detail>
        <Detail label={t("p.emp.emergency")}>
          {[e.emergencyContact?.name, e.emergencyContact?.phone]
            .filter(Boolean)
            .join(" · ")}
        </Detail>
        <Detail label={t("p.emp.festivalGroup")}>{e.festivalGroup}</Detail>
        <Detail label={t("p.branch")}>{a?.branch.name}</Detail>
        <Detail label={t("p.department")}>{a?.department.name}</Detail>
        <Detail label={t("p.designation")}>
          {lang === "bn"
            ? (a?.designation.nameBn ?? a?.designation.nameEn)
            : a?.designation.nameEn}
        </Detail>
        <Detail label={t("p.emp.manager")}>
          {a?.lineManager &&
            `${a.lineManager.employeeCode ?? ""} ${a.lineManager.fullNameEn ?? ""}`}
        </Detail>
        {e.lastWorkingDay && (
          <Detail label={t("p.emp.lastDay")}>
            {formatDate(e.lastWorkingDay, lang)}
          </Detail>
        )}
      </dl>
      {edit && (
        <EditProfile e={e} onClose={() => setEdit(false)} onSaved={reload} />
      )}
    </Panel>
  );
}

function EditProfile({
  e,
  onClose,
  onSaved,
}: {
  e: EmployeeDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  // one list of what this form edits, so "what changed" cannot drift from the fields
  const original: Record<string, string> = {
    fullNameEn: e.fullNameEn,
    fullNameBn: e.fullNameBn ?? "",
    phone: e.phone ?? "",
    personalEmail: e.personalEmail ?? "",
    presentAddress: e.presentAddress ?? "",
    permanentAddress: e.permanentAddress ?? "",
    emergencyContactName: e.emergencyContact?.name ?? "",
    emergencyContactPhone: e.emergencyContact?.phone ?? "",
    festivalGroup: e.festivalGroup ?? "",
    nid: "",
    tin: "",
  };
  const [f, setF] = useState<Record<string, string>>(original);
  const set = (k: string) => (ev: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: ev.target.value }));
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    // only what changed; NID / TIN only when a new value is typed
    const changes = Object.fromEntries(
      Object.entries(f).filter(([k, v]) => v !== original[k] && v !== ""),
    );
    if (
      await save.run(() =>
        api.patch(`/employees/${e.id}`, { ...changes, version: e.version }),
      )
    ) {
      onClose();
      onSaved();
    }
  }
  return (
    <Modal title={t("p.emp.edit")} open onClose={onClose} wide>
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label={t("p.emp.nameEn")}>
            <Input required value={f.fullNameEn} onChange={set("fullNameEn")} />
          </Field>
          <Field label={t("p.emp.nameBn")}>
            <Input value={f.fullNameBn} onChange={set("fullNameBn")} />
          </Field>
          <Field label={t("p.emp.phone")}>
            <Input value={f.phone} onChange={set("phone")} />
          </Field>
          <Field label={t("p.emp.email")}>
            <Input
              type="email"
              value={f.personalEmail}
              onChange={set("personalEmail")}
            />
          </Field>
          <Field label={t("p.emp.presentAddress")}>
            <Input value={f.presentAddress} onChange={set("presentAddress")} />
          </Field>
          <Field label={t("p.emp.permanentAddress")}>
            <Input
              value={f.permanentAddress}
              onChange={set("permanentAddress")}
            />
          </Field>
          <Field label={t("p.emp.emergencyName")}>
            <Input
              value={f.emergencyContactName}
              onChange={set("emergencyContactName")}
            />
          </Field>
          <Field label={t("p.emp.emergencyPhone")}>
            <Input
              inputMode="tel"
              value={f.emergencyContactPhone}
              onChange={set("emergencyContactPhone")}
            />
          </Field>
          <Field label={t("p.emp.festivalGroup")}>
            <Input value={f.festivalGroup} onChange={set("festivalGroup")} />
          </Field>
          <Field label={`${t("p.emp.nid")} (${e.nid ?? "—"})`}>
            <Input inputMode="numeric" value={f.nid} onChange={set("nid")} />
          </Field>
          <Field label={`${t("p.emp.tin")} (${e.tin ?? "—"})`}>
            <Input inputMode="numeric" value={f.tin} onChange={set("tin")} />
          </Field>
        </div>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ onboarding

function OnboardingTab({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const list = useApi<{
    complete: boolean;
    items: Array<{
      code: string;
      label: string;
      required: boolean;
      done: boolean;
      doneAt: string | null;
    }>;
  }>(`/employees/${id}/onboarding`);
  const action = useAction();
  if (!list.data)
    return list.error ? <ErrorBox error={list.error} /> : <Loading />;
  return (
    <Panel>
      {list.data.complete && (
        <Alert kind="success">{t("p.emp.onb.allDone")}</Alert>
      )}
      <ActionMessage action={action} />
      <Table
        rows={list.data.items}
        rowKey={(i) => i.code}
        columns={[
          {
            key: "label",
            label: t("p.name"),
            render: (i) => `${i.label}${i.required ? " *" : ""}`,
          },
          {
            key: "done",
            label: t("p.status"),
            render: (i) =>
              i.done ? (
                <Badge color="green">
                  {i.doneAt &&
                    formatDate(i.doneAt.slice(0, 10), lang, { short: true })}
                </Badge>
              ) : (
                <Badge>—</Badge>
              ),
          },
          {
            key: "act",
            label: "",
            align: "right",
            render: (i) => (
              <Button
                variant={i.done ? "ghost" : "secondary"}
                className="min-h-8 px-3 py-1 text-sm"
                onClick={() =>
                  action
                    .run(() =>
                      api.post(
                        `/employees/${id}/onboarding/${i.code}/${i.done ? "reopen" : "complete"}`,
                        {},
                      ),
                    )
                    .then(list.reload)
                }
              >
                {i.done ? t("p.emp.onb.reopen") : t("p.emp.onb.complete")}
              </Button>
            ),
          },
        ]}
      />
    </Panel>
  );
}

// ------------------------------------------------------------------ job history

function JobTab({ e, reload }: { e: EmployeeDetail; reload: () => void }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const timeline = useApi<Placement[]>(`/employees/${e.id}/assignments`);
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Panel
        title={t("p.emp.job.timeline")}
        actions={
          can("employee.manage") && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              {t("p.emp.job.add")}
            </Button>
          )
        }
      >
        <Table
          rows={timeline.data ? [...timeline.data].reverse() : undefined}
          rowKey={(p) => p.effectiveFrom}
          columns={[
            {
              key: "from",
              label: t("p.from"),
              render: (p) => formatDate(p.effectiveFrom, lang, { short: true }),
            },
            {
              key: "to",
              label: t("p.to"),
              render: (p) =>
                p.effectiveTo
                  ? formatDate(p.effectiveTo, lang, { short: true })
                  : "—",
            },
            {
              key: "branch",
              label: t("p.branch"),
              render: (p) => p.branch.name,
            },
            {
              key: "dept",
              label: t("p.department"),
              render: (p) => p.department.name,
            },
            {
              key: "desig",
              label: t("p.designation"),
              render: (p) => p.designation.nameEn,
            },
            { key: "grade", label: t("p.grade"), render: (p) => p.grade.code },
            {
              key: "mgr",
              label: t("p.emp.manager"),
              render: (p) => p.lineManager?.fullNameEn ?? "—",
            },
          ]}
        />
        {adding && (
          <JobChange
            e={e}
            onClose={() => setAdding(false)}
            onSaved={() => {
              timeline.reload();
              reload();
            }}
          />
        )}
      </Panel>
      <JobChanges
        id={e.id}
        onChanged={() => {
          timeline.reload();
          reload();
        }}
      />
    </>
  );
}

function JobChange({
  e,
  onClose,
  onSaved,
}: {
  e: EmployeeDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const org = useOrg(e.companyId);
  const save = useAction();
  const colleagues = useApi<Page<EmployeeSummary>>(
    `/employees?companyId=${e.companyId}&pageSize=200`,
  );
  const people = (colleagues.data?.items ?? []).filter(
    (m) => m.status !== "separated" && m.id !== e.id,
  );
  const [f, setF] = useState<Record<string, string>>({
    type: "transfer",
    effectiveFrom: "",
  });
  const set = (k: string) => (ev: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: ev.target.value }));
  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const body = Object.fromEntries(
      Object.entries(f).filter(([, v]) => v !== ""),
    );
    if (await save.run(() => api.post(`/employees/${e.id}/job-events`, body))) {
      onClose();
      onSaved();
    }
  }
  return (
    <Modal title={t("p.emp.job.add")} open onClose={onClose}>
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <p className="mb-3 text-xs text-slate-500">{t("p.emp.job.hint")}</p>
        <Field label={t("p.emp.job.type")}>
          <Select value={f.type} onChange={set("type")}>
            {(
              [
                "transfer",
                "promotion",
                "redesignation",
                "grade_change",
                "manager_change",
              ] as const
            ).map((k) => (
              <option key={k} value={k}>
                {t(`p.emp.job.type.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("p.emp.job.effective")}>
          <Input
            type="date"
            required
            value={f.effectiveFrom}
            onChange={set("effectiveFrom")}
          />
        </Field>
        <Field label={t("p.branch")}>
          <Select value={f.branchId ?? ""} onChange={set("branchId")}>
            <option value="">—</option>
            {org.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("p.department")}>
          <Select value={f.departmentId ?? ""} onChange={set("departmentId")}>
            <option value="">—</option>
            {org.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {"— ".repeat(d.depth ?? 0)}
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("p.designation")}>
          <Select value={f.designationId ?? ""} onChange={set("designationId")}>
            <option value="">—</option>
            {org.designations.map((d) => (
              <option key={d.id} value={d.id}>
                {lang === "bn" ? (d.nameBn ?? d.nameEn) : d.nameEn}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("p.grade")}>
          <Select value={f.gradeId ?? ""} onChange={set("gradeId")}>
            <option value="">—</option>
            {org.grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} · {g.name}
              </option>
            ))}
          </Select>
        </Field>
        {/* a "manager change" with no manager field was the one thing this form could not do */}
        <Field label={t("p.emp.manager")} hint={t("p.emp.managerHint")}>
          <Select value={f.lineManagerId ?? ""} onChange={set("lineManagerId")}>
            <option value="">—</option>
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {m.employeeCode} · {m.fullNameEn}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("p.emp.functionalManager")}>
          <Select
            value={f.functionalManagerId ?? ""}
            onChange={set("functionalManagerId")}
          >
            <option value="">—</option>
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {m.employeeCode} · {m.fullNameEn}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("p.reason")}>
          <Input
            maxLength={500}
            value={f.reason ?? ""}
            onChange={set("reason")}
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ salary

interface Salaries {
  current: {
    gross: string;
    effectiveFrom: string;
    breakdown: Record<string, string>;
  } | null;
  history: Array<{
    id: string;
    effectiveFrom: string;
    gross: string;
    structure: string;
    reason: string;
    status: string;
  }>;
}

function SalaryTab({ e }: { e: EmployeeDetail }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const salaries = useApi<Salaries>(`/employees/${e.id}/salaries`);
  const structures = useApi<Array<{ id: string; code: string; name: string }>>(
    `/companies/${e.companyId}/salary-structures`,
  );
  const save = useAction();
  const [f, setF] = useState({
    effectiveFrom: "",
    gross: "",
    structureId: "",
    reason: "",
  });
  if (salaries.error) return <ErrorBox error={salaries.error} />;
  if (!salaries.data) return <Loading />;
  const cur = salaries.data.current;
  return (
    <>
      <Panel title={t("p.emp.sal.current")}>
        {cur ? (
          <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Detail label={t("p.emp.sal.gross")}>
              {formatTaka(cur.gross, lang)}
            </Detail>
            {Object.entries(cur.breakdown).map(([head, amount]) => (
              <Detail key={head} label={head}>
                {formatTaka(amount, lang)}
              </Detail>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">{t("p.emp.sal.none")}</p>
        )}
      </Panel>
      {can("payroll.prepare") && (
        <Panel title={t("p.emp.sal.add")}>
          <ActionMessage action={save} />
          <form
            className="grid items-end gap-x-4 sm:grid-cols-2 lg:grid-cols-5"
            onSubmit={async (ev) => {
              ev.preventDefault();
              if (
                await save.run(
                  () => api.post(`/employees/${e.id}/salaries`, f),
                  t("p.saved"),
                )
              )
                salaries.reload();
            }}
          >
            <Field label={t("p.emp.job.effective")}>
              <Input
                type="date"
                required
                value={f.effectiveFrom}
                onChange={(ev) =>
                  setF({ ...f, effectiveFrom: ev.target.value })
                }
              />
            </Field>
            <Field label={t("p.emp.sal.gross")}>
              <Input
                required
                inputMode="decimal"
                pattern="\d+(\.\d{1,2})?"
                value={f.gross}
                onChange={(ev) => setF({ ...f, gross: ev.target.value })}
              />
            </Field>
            <Field label={t("p.emp.sal.structure")}>
              <Select
                required
                value={f.structureId}
                onChange={(ev) => setF({ ...f, structureId: ev.target.value })}
              >
                <option value="">—</option>
                {structures.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("p.reason")}>
              <Input
                required
                maxLength={300}
                value={f.reason}
                onChange={(ev) => setF({ ...f, reason: ev.target.value })}
              />
            </Field>
            <div className="mb-3">
              <Button type="submit" busy={save.busy} className="w-full">
                {t("p.save")}
              </Button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title={t("p.emp.sal.history")}>
        <Table
          rows={salaries.data.history}
          rowKey={(h) => h.id}
          columns={[
            {
              key: "from",
              label: t("p.emp.job.effective"),
              render: (h) => formatDate(h.effectiveFrom, lang, { short: true }),
            },
            {
              key: "gross",
              label: t("p.emp.sal.gross"),
              align: "right",
              render: (h) => formatTaka(h.gross, lang),
            },
            { key: "structure", label: t("p.emp.sal.structure") },
            { key: "reason", label: t("p.reason") },
            {
              key: "status",
              label: t("p.status"),
              render: (h) => (
                <Badge color={h.status === "active" ? "green" : "gray"}>
                  {h.status}
                </Badge>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}

// ------------------------------------------------------------------ bank

function BankTab({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const [sent, setSent] = useState(false);
  const accounts = useApi<
    Array<{
      id: string;
      kind: string;
      provider: string | null;
      bankName: string | null;
      accountName: string;
      number: string;
      status: string;
      approvedAt: string | null;
    }>
  >(`/employees/${id}/bank-accounts`);
  return (
    <Panel
      actions={
        can("employee.bank.manage") && (
          <BankRequest
            employeeId={id}
            onDone={() => {
              setSent(true);
              accounts.reload();
            }}
          />
        )
      }
    >
      {sent && <Alert kind="success">{t("py.bank.sent")}</Alert>}
      <p className="mb-3 text-sm text-slate-500">{t("p.emp.bank.hint")}</p>
      {accounts.error ? (
        <ErrorBox error={accounts.error} />
      ) : (
        <Table
          rows={accounts.data}
          rowKey={(a) => a.id}
          columns={[
            { key: "kind", label: t("p.emp.bank.kind") },
            {
              key: "provider",
              label: t("p.emp.bank.provider"),
              render: (a) => a.bankName ?? a.provider ?? "—",
            },
            { key: "accountName", label: t("p.name") },
            {
              key: "number",
              label: t("p.emp.bank.number"),
              className: "font-mono",
            },
            {
              key: "status",
              label: t("p.status"),
              render: (a) => (
                <Badge
                  color={
                    a.status === "approved"
                      ? "green"
                      : a.status === "pending"
                        ? "amber"
                        : "gray"
                  }
                >
                  {t(`py.bank.status.${a.status}`)}
                </Badge>
              ),
            },
            {
              key: "approvedAt",
              label: t("p.date"),
              render: (a) =>
                a.approvedAt
                  ? formatDate(a.approvedAt.slice(0, 10), lang, { short: true })
                  : "—",
            },
          ]}
        />
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ leave

function LeaveTab({ id, companyId }: { id: string; companyId: string }) {
  const { t, lang } = useI18n();
  const balances = useApi<{
    balances: Array<{
      leaveTypeId: string;
      code: string;
      nameEn: string;
      nameBn: string | null;
      usesBalance: boolean;
      balance: number;
      pending: number;
      available: number;
    }>;
  }>(`/employees/${id}/leave-balances`);
  if (balances.error) return <ErrorBox error={balances.error} />;
  return (
    <>
      <Panel>
        <Table
          rows={balances.data?.balances.filter((b) => b.usesBalance)}
          rowKey={(b) => b.leaveTypeId}
          columns={[
            {
              key: "name",
              label: t("p.emp.leave.type"),
              render: (b) =>
                `${b.code} · ${lang === "bn" ? (b.nameBn ?? b.nameEn) : b.nameEn}`,
            },
            {
              key: "balance",
              label: t("p.emp.leave.balance"),
              align: "right",
              render: (b) => formatDays(b.balance, lang),
            },
            {
              key: "pending",
              label: t("p.emp.leave.pending"),
              align: "right",
              render: (b) => formatDays(b.pending, lang),
            },
            {
              key: "available",
              label: t("p.emp.leave.available"),
              align: "right",
              render: (b) => formatDays(b.available, lang),
            },
          ]}
        />
      </Panel>
      <EmployeeLeave id={id} companyId={companyId} />
    </>
  );
}

// ------------------------------------------------------------------ attendance & consent

interface ConsentRecord {
  current: Array<{
    purpose: string;
    status: "granted" | "withdrawn" | "none";
    since: string | null;
  }>;
  history: Array<{
    id: string;
    purpose: string;
    granted: boolean;
    noticeVersion: string;
    method: "app" | "paper";
    recordedAt: string;
  }>;
}

function AttendanceTab({ id, companyId }: { id: string; companyId: string }) {
  const { t, lang } = useI18n();
  const profile = useApi<{
    deviceUserId: string | null;
    webPunchAllowed: boolean;
  }>(`/employees/${id}/attendance-profile`);
  const consents = useApi<ConsentRecord>(`/employees/${id}/consents`);
  const save = useAction();
  const record = useAction();
  const [deviceUserId, setDeviceUserId] = useState<string | null>(null);
  const [paper, setPaper] = useState({
    purpose: "biometric_attendance",
    granted: "true",
  });
  if (!profile.data || !consents.data)
    return profile.error ? <ErrorBox error={profile.error} /> : <Loading />;
  const p = profile.data;
  return (
    <>
      <EmployeeAttendance id={id} companyId={companyId} />
      <Panel title={t("p.nav.attendance")}>
        <ActionMessage action={save} />
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (
              await save.run(
                () =>
                  api.patch(`/employees/${id}/attendance-profile`, {
                    deviceUserId: deviceUserId ?? p.deviceUserId ?? undefined,
                  }),
                t("p.saved"),
              )
            )
              profile.reload();
          }}
        >
          <Field label={t("p.emp.att.deviceUser")}>
            <Input
              className="max-w-[12rem]"
              pattern="[A-Za-z0-9]{1,20}"
              value={deviceUserId ?? p.deviceUserId ?? ""}
              onChange={(ev) => setDeviceUserId(ev.target.value)}
            />
          </Field>
          <div className="mb-3">
            <Button type="submit" variant="secondary" busy={save.busy}>
              {t("p.save")}
            </Button>
          </div>
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.webPunchAllowed}
              onChange={(ev) =>
                save
                  .run(
                    () =>
                      api.patch(`/employees/${id}/attendance-profile`, {
                        webPunchAllowed: ev.target.checked,
                      }),
                    t("p.saved"),
                  )
                  .then(profile.reload)
              }
            />
            {t("p.emp.att.webPunch")}
          </label>
        </form>
      </Panel>
      <Panel title={t("p.emp.att.consents")}>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {consents.data.current.map((c) => (
            <div
              key={c.purpose}
              className="rounded-lg border border-slate-200 p-3"
            >
              <p className="text-sm font-medium">
                {t(`p.emp.att.purpose.${c.purpose}`)}
              </p>
              <Badge
                color={
                  c.status === "granted"
                    ? "green"
                    : c.status === "withdrawn"
                      ? "amber"
                      : "gray"
                }
              >
                {t(`p.emp.att.${c.status}`)}
              </Badge>
              {c.since && (
                <span className="ml-2 text-xs text-slate-500">
                  {formatDate(c.since.slice(0, 10), lang, { short: true })}
                </span>
              )}
            </div>
          ))}
        </div>
        <ActionMessage action={record} />
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (
              await record.run(
                () =>
                  api.post(`/employees/${id}/consents`, {
                    purpose: paper.purpose,
                    granted: paper.granted === "true",
                  }),
                t("p.saved"),
              )
            )
              consents.reload();
          }}
        >
          <Field label={t("p.emp.att.recordPaper")}>
            <Select
              value={paper.purpose}
              onChange={(ev) =>
                setPaper({ ...paper, purpose: ev.target.value })
              }
            >
              {[
                "biometric_attendance",
                "location_attendance",
                "selfie_attendance",
              ].map((k) => (
                <option key={k} value={k}>
                  {t(`p.emp.att.purpose.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("p.emp.att.grantedQ")}>
            <Select
              value={paper.granted}
              onChange={(ev) =>
                setPaper({ ...paper, granted: ev.target.value })
              }
            >
              <option value="true">{t("p.emp.att.agrees")}</option>
              <option value="false">{t("p.emp.att.withdraws")}</option>
            </Select>
          </Field>
          <div className="mb-3">
            <Button type="submit" variant="secondary" busy={record.busy}>
              {t("p.save")}
            </Button>
          </div>
        </form>
        <Table
          rows={consents.data.history}
          rowKey={(h) => h.id}
          columns={[
            {
              key: "date",
              label: t("p.date"),
              render: (h) =>
                formatDate(h.recordedAt.slice(0, 10), lang, { short: true }),
            },
            {
              key: "purpose",
              label: t("p.emp.att.consents"),
              render: (h) => t(`p.emp.att.purpose.${h.purpose}`),
            },
            {
              key: "granted",
              label: t("p.status"),
              render: (h) =>
                h.granted ? t("p.emp.att.granted") : t("p.emp.att.withdrawn"),
            },
            {
              key: "method",
              label: "",
              render: (h) => t(`p.emp.att.method.${h.method}`),
            },
            {
              key: "notice",
              label: "",
              render: (h) => (
                <span className="font-mono text-xs">{h.noticeVersion}</span>
              ),
            },
          ]}
        />
      </Panel>
    </>
  );
}

// ------------------------------------------------------------------ payslips

function PayslipsTab({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const slips = useApi<
    Array<{
      runId: string;
      period: string;
      runType: string;
      bonusName: string | null;
      gross: string;
      deductions: string;
      net: string;
      tax: string;
    }>
  >(`/employees/${id}/payslips`);
  const download = useAction();
  if (slips.error) return <ErrorBox error={slips.error} />;
  return (
    <Panel>
      <ActionMessage action={download} />
      <Table
        rows={slips.data}
        rowKey={(s) => s.runId}
        columns={[
          {
            key: "period",
            label: t("p.period"),
            render: (s) =>
              `${formatMonth(s.period, lang)}${s.bonusName ? ` · ${s.bonusName}` : ""}`,
          },
          {
            key: "gross",
            label: t("p.emp.sal.gross"),
            align: "right",
            render: (s) => formatTaka(s.gross, lang),
          },
          {
            key: "deductions",
            label: t("p.run.deductions"),
            align: "right",
            render: (s) => formatTaka(s.deductions, lang),
          },
          {
            key: "net",
            label: t("p.run.net"),
            align: "right",
            render: (s) => formatTaka(s.net, lang),
          },
          {
            key: "pdf",
            label: "",
            align: "right",
            render: (s) => (
              <Button
                variant="ghost"
                className="min-h-8 px-2 py-1 text-sm"
                onClick={() =>
                  download.run(async () =>
                    saveDownload(
                      await api.file(
                        `/payroll-runs/${s.runId}/employees/${id}/payslip.pdf?lang=${lang}`,
                      ),
                      `payslip-${s.period}.pdf`,
                    ),
                  )
                }
              >
                {t("p.emp.pay.pdf")}
              </Button>
            ),
          },
        ]}
      />
    </Panel>
  );
}
