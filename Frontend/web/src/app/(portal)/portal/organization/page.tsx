"use client";
/** The company structure: companies (Admin), branches, departments (with heads), designations, grades. */
import { useState, type FormEvent, type ReactNode } from "react";
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
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { currentPosition } from "@/lib/device";
import type {
  Branch,
  Department,
  Designation,
  EmployeeSummary,
  Grade,
  Page,
} from "@/lib/portal-types";

type Tab = "branches" | "departments" | "designations" | "grades" | "companies";
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Geo-fence settings that are probably a mistake (misuse review): a very wide radius, or a point outside Bangladesh (lat / lng swapped). */
function fenceWarnings(
  lat: string | undefined,
  lng: string | undefined,
  radius: string | undefined,
): Array<"ar.g.radiusLarge" | "ar.g.outsideBd"> {
  const warnings: Array<"ar.g.radiusLarge" | "ar.g.outsideBd"> = [];
  if (Number(radius) > 300) warnings.push("ar.g.radiusLarge");
  const la = Number(lat);
  const ln = Number(lng);
  if (
    lat &&
    lng &&
    !Number.isNaN(la) &&
    !Number.isNaN(ln) &&
    !(la >= 20.5 && la <= 26.7 && ln >= 88 && ln <= 92.7)
  )
    warnings.push("ar.g.outsideBd");
  return warnings;
}

function FenceWarnings({
  lat,
  lng,
  radius,
}: {
  lat?: string;
  lng?: string;
  radius?: string;
}) {
  const { t } = useI18n();
  const warnings = fenceWarnings(lat, lng, radius);
  const valid =
    lat && lng && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng));
  if (!valid && !warnings.length) return null;
  return (
    <div className="mt-2 space-y-1 text-sm">
      {warnings.map((w) => (
        <p key={w} className="rounded bg-amber-50 px-2 py-1 text-amber-800">
          ⚠ {t(w)}
        </p>
      ))}
      {valid && (
        <a
          className="font-medium text-emerald-800 underline"
          href={`https://www.google.com/maps?q=${Number(lat)},${Number(lng)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          📍 {t("ar.g.openMap")}
        </a>
      )}
    </div>
  );
}

export default function OrganizationPage() {
  const { t } = useI18n();
  const { can } = usePortal();
  const [tab, setTab] = useState<Tab>("branches");
  return (
    <div>
      <PageHeader title={t("p.org.title")} />
      <Tabs
        tabs={[
          { key: "branches" as Tab, label: t("p.org.branches") },
          { key: "departments" as Tab, label: t("p.org.departments") },
          { key: "designations" as Tab, label: t("p.org.designations") },
          { key: "grades" as Tab, label: t("p.org.grades") },
          ...(can("org.structure.manage")
            ? [{ key: "companies" as Tab, label: t("p.company") }]
            : []),
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "companies" ? <Companies /> : <Structure tab={tab} />}
    </div>
  );
}

/** A one-line add form under a table. */
function AddRow({
  onSubmit,
  busy,
  children,
}: {
  onSubmit: (e: FormEvent) => void;
  busy: boolean;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
      {children}
      <div className="mb-3">
        <Button type="submit" busy={busy}>
          {t("p.add")}
        </Button>
      </div>
    </form>
  );
}

function Structure({ tab }: { tab: Exclude<Tab, "companies"> }) {
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  // this screen is where retiring happens, so it asks for the retired ones too
  const org = useOrg(company?.id, { includeInactive: true });
  const [showInactive, setShowInactive] = useState(false);
  const live = <T extends { isActive?: boolean }>(rows: T[]) =>
    showInactive ? rows : rows.filter((r) => r.isActive !== false);
  const [editDepartment, setEditDepartment] = useState<Department | null>(null);
  const [editDesignation, setEditDesignation] = useState<Designation | null>(
    null,
  );
  const [editGrade, setEditGrade] = useState<Grade | null>(null);
  const people = useApi<Page<EmployeeSummary>>(
    company ? `/employees?companyId=${company.id}&pageSize=200` : null,
  );
  const action = useAction();
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const c = `/companies/${company?.id}`;
  const add =
    (path: string, body: Record<string, unknown>) => async (e: FormEvent) => {
      e.preventDefault();
      const clean = Object.fromEntries(
        Object.entries(body).filter(([, v]) => v !== "" && v !== undefined),
      );
      if (await action.run(() => api.post(path, clean), t("p.saved"))) {
        setF({});
        org.reload();
      }
    };
  const structure = can("org.structure.manage");
  const jobs = can("org.jobs.manage");
  const [editing, setEditing] = useState<Branch | null>(null);

  /** "Retired" beside a name, so nobody wonders why it is greyed out. */
  const nameCell = (
    text: ReactNode,
    isActive: boolean | undefined,
    indent = 0,
  ) => (
    <span
      style={indent ? { paddingLeft: `${indent * 1.25}rem` } : undefined}
      className={isActive === false ? "text-slate-400" : undefined}
    >
      {text}
      {isActive === false && (
        <span className="ml-2 text-xs">({t("p.org.inactive")})</span>
      )}
    </span>
  );

  return (
    <Panel>
      <ActionMessage action={action} />
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
        {t("p.org.showInactive")}
      </label>
      {tab === "branches" && (
        <>
          <Table
            rows={live(org.branches)}
            rowKey={(b) => b.id}
            columns={[
              { key: "code", label: t("p.code"), className: "font-mono" },
              {
                key: "name",
                label: t("p.name"),
                render: (b) => nameCell(b.name, b.isActive),
              },
              { key: "address", label: t("p.org.address") },
              {
                key: "weekend",
                label: t("p.org.weekend"),
                render: (b) => b.weekendDays.join(", "),
              },
              {
                key: "geo",
                label: t("p.org.geofence"),
                render: (b) =>
                  b.geoFence
                    ? `${b.geoFence.lat}, ${b.geoFence.lng} · ${b.geoFence.radiusM} m`
                    : "—",
              },
              ...(structure
                ? [
                    {
                      key: "edit",
                      label: "",
                      align: "right" as const,
                      render: (b: Branch) => (
                        <Button
                          variant="ghost"
                          className="min-h-8 px-3 py-1 text-sm"
                          onClick={() => setEditing(b)}
                        >
                          {t("p.org.editBranch")}
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {editing && (
            <EditBranch
              branch={editing}
              onClose={() => setEditing(null)}
              onSaved={() => (setEditing(null), org.reload())}
            />
          )}
          {structure && (
            <AddRow
              busy={action.busy}
              onSubmit={add(`${c}/branches`, {
                code: f.code,
                name: f.name,
                address: f.address,
                weekendDays: (f.weekend ?? "FRI,SAT")
                  .split(",")
                  .filter((d) => WEEKDAYS.includes(d)),
                ...(f.lat && f.lng
                  ? {
                      geoLat: Number(f.lat),
                      geoLng: Number(f.lng),
                      geoRadiusM: Number(f.radius || 150),
                    }
                  : {}),
              })}
            >
              <Field label={t("p.code")}>
                <Input
                  required
                  className="w-24"
                  value={f.code ?? ""}
                  onChange={set("code")}
                />
              </Field>
              <Field label={t("p.name")}>
                <Input required value={f.name ?? ""} onChange={set("name")} />
              </Field>
              <Field label={t("p.org.address")}>
                <Input value={f.address ?? ""} onChange={set("address")} />
              </Field>
              <Field label={t("p.org.weekend")}>
                <Input
                  className="w-28"
                  placeholder="FRI,SAT"
                  value={f.weekend ?? ""}
                  onChange={set("weekend")}
                />
              </Field>
              <Field label="lat">
                <Input
                  className="w-28"
                  inputMode="decimal"
                  value={f.lat ?? ""}
                  onChange={set("lat")}
                />
              </Field>
              <Field label="lng">
                <Input
                  className="w-28"
                  inputMode="decimal"
                  value={f.lng ?? ""}
                  onChange={set("lng")}
                />
              </Field>
              <Field label="m">
                <Input
                  className="w-20"
                  inputMode="numeric"
                  value={f.radius ?? ""}
                  onChange={set("radius")}
                />
              </Field>
            </AddRow>
          )}
          {structure && (f.lat || f.lng || f.radius) && (
            <FenceWarnings lat={f.lat} lng={f.lng} radius={f.radius || "150"} />
          )}
        </>
      )}
      {tab === "departments" && (
        <>
          <Table
            rows={live(org.departments)}
            rowKey={(d) => d.id}
            columns={[
              { key: "code", label: t("p.code"), className: "font-mono" },
              {
                key: "name",
                label: t("p.name"),
                render: (d) => nameCell(d.name, d.isActive, d.depth ?? 0),
              },
              {
                key: "cost",
                label: t("p.org.costCentre"),
                render: (d) => d.costCentreCode ?? "",
              },
              {
                key: "head",
                label: t("p.org.head"),
                render: (d) =>
                  structure ? (
                    <Select
                      aria-label={`${t("p.org.head")} ${d.name}`}
                      className="min-h-9 py-1 text-sm"
                      value={d.headEmployeeId ?? ""}
                      onChange={(e) =>
                        action
                          .run(
                            () =>
                              api.patch(`/departments/${d.id}`, {
                                headEmployeeId: e.target.value || null,
                                version: d.version,
                              }),
                            t("p.saved"),
                          )
                          .then(org.reload)
                      }
                    >
                      <option value="">—</option>
                      {people.data?.items.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.employeeCode} · {p.fullNameEn}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    (people.data?.items.find((p) => p.id === d.headEmployeeId)
                      ?.fullNameEn ?? "")
                  ),
              },
              ...(structure
                ? [
                    {
                      key: "edit",
                      label: "",
                      align: "right" as const,
                      render: (d: Department) => (
                        <Button
                          variant="ghost"
                          className="min-h-8 px-3 py-1 text-sm"
                          onClick={() => setEditDepartment(d)}
                        >
                          {t("p.org.edit")}
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {editDepartment && (
            <EditDepartment
              department={editDepartment}
              departments={org.departments}
              onClose={() => setEditDepartment(null)}
              onSaved={() => (setEditDepartment(null), org.reload())}
            />
          )}
          {structure && (
            <AddRow
              busy={action.busy}
              onSubmit={add(`${c}/departments`, {
                code: f.code,
                name: f.name,
                parentId: f.parentId,
                costCentreCode: f.cost,
              })}
            >
              <Field label={t("p.code")}>
                <Input
                  required
                  className="w-28"
                  value={f.code ?? ""}
                  onChange={set("code")}
                />
              </Field>
              <Field label={t("p.name")}>
                <Input required value={f.name ?? ""} onChange={set("name")} />
              </Field>
              <Field label={t("p.org.parent")}>
                <Select value={f.parentId ?? ""} onChange={set("parentId")}>
                  <option value="">—</option>
                  {org.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {"— ".repeat(d.depth ?? 0)}
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("p.org.costCentre")}>
                <Input
                  className="w-28"
                  value={f.cost ?? ""}
                  onChange={set("cost")}
                />
              </Field>
            </AddRow>
          )}
        </>
      )}
      {tab === "designations" && (
        <>
          <Table
            rows={live(org.designations)}
            rowKey={(d) => d.id}
            columns={[
              { key: "code", label: t("p.code"), className: "font-mono" },
              {
                key: "name",
                label: t("p.name"),
                render: (d) =>
                  nameCell(
                    lang === "bn" ? (d.nameBn ?? d.nameEn) : d.nameEn,
                    d.isActive,
                  ),
              },
              {
                key: "nameBn",
                label: t("p.org.nameBn"),
                render: (d) => d.nameBn ?? "",
              },
              ...(jobs
                ? [
                    {
                      key: "edit",
                      label: "",
                      align: "right" as const,
                      render: (d: Designation) => (
                        <Button
                          variant="ghost"
                          className="min-h-8 px-3 py-1 text-sm"
                          onClick={() => setEditDesignation(d)}
                        >
                          {t("p.org.edit")}
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {editDesignation && (
            <EditDesignation
              designation={editDesignation}
              onClose={() => setEditDesignation(null)}
              onSaved={() => (setEditDesignation(null), org.reload())}
            />
          )}
          {jobs && (
            <AddRow
              busy={action.busy}
              onSubmit={add(`${c}/designations`, {
                code: f.code,
                nameEn: f.name,
                nameBn: f.nameBn,
              })}
            >
              <Field label={t("p.code")}>
                <Input
                  required
                  className="w-28"
                  value={f.code ?? ""}
                  onChange={set("code")}
                />
              </Field>
              <Field label={t("p.name")}>
                <Input required value={f.name ?? ""} onChange={set("name")} />
              </Field>
              <Field label={t("p.org.nameBn")}>
                <Input value={f.nameBn ?? ""} onChange={set("nameBn")} />
              </Field>
            </AddRow>
          )}
        </>
      )}
      {tab === "grades" && (
        <>
          <Table
            rows={live(org.grades)}
            rowKey={(g) => g.id}
            columns={[
              { key: "code", label: t("p.code"), className: "font-mono" },
              {
                key: "name",
                label: t("p.name"),
                render: (g) => nameCell(g.name, g.isActive),
              },
              {
                key: "rank",
                label: t("p.org.rank"),
                className: "tabular-nums",
                render: (g) => g.rank,
              },
              {
                key: "ot",
                label: t("p.org.otEligible"),
                render: (g) =>
                  g.otEligible ? (
                    <Badge color="green">{t("p.yes")}</Badge>
                  ) : (
                    t("p.no")
                  ),
              },
              {
                key: "range",
                label: t("p.org.salaryRange"),
                // one end alone is still useful ("from 150000"), but it must not read as the whole range
                render: (g) =>
                  g.salaryMin || g.salaryMax
                    ? `${g.salaryMin ?? "…"} – ${g.salaryMax ?? "…"}`
                    : "",
              },
              ...(jobs
                ? [
                    {
                      key: "edit",
                      label: "",
                      align: "right" as const,
                      render: (g: Grade) => (
                        <Button
                          variant="ghost"
                          className="min-h-8 px-3 py-1 text-sm"
                          onClick={() => setEditGrade(g)}
                        >
                          {t("p.org.edit")}
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {editGrade && (
            <EditGrade
              grade={editGrade}
              onClose={() => setEditGrade(null)}
              onSaved={() => (setEditGrade(null), org.reload())}
            />
          )}
          {jobs && (
            <AddRow
              busy={action.busy}
              onSubmit={add(`${c}/grades`, {
                code: f.code,
                name: f.name,
                otEligible: f.ot === "yes",
                ...(f.rank ? { rank: Number(f.rank) } : {}),
                salaryMin: f.salaryMin,
                salaryMax: f.salaryMax,
              })}
            >
              <Field label={t("p.code")}>
                <Input
                  required
                  className="w-24"
                  value={f.code ?? ""}
                  onChange={set("code")}
                />
              </Field>
              <Field label={t("p.name")}>
                <Input required value={f.name ?? ""} onChange={set("name")} />
              </Field>
              <Field label={t("p.org.rank")}>
                <Input
                  className="w-20"
                  type="number"
                  min={0}
                  max={1000}
                  value={f.rank ?? ""}
                  onChange={set("rank")}
                />
              </Field>
              <Field label={t("p.org.otEligible")}>
                <Select value={f.ot ?? "no"} onChange={set("ot")}>
                  <option value="no">{t("p.no")}</option>
                  <option value="yes">{t("p.yes")}</option>
                </Select>
              </Field>
              <Field label={t("p.org.salaryMin")}>
                <Input
                  className="w-28"
                  inputMode="decimal"
                  value={f.salaryMin ?? ""}
                  onChange={set("salaryMin")}
                />
              </Field>
              <Field label={t("p.org.salaryMax")}>
                <Input
                  className="w-28"
                  inputMode="decimal"
                  value={f.salaryMax ?? ""}
                  onChange={set("salaryMax")}
                />
              </Field>
            </AddRow>
          )}
        </>
      )}
    </Panel>
  );
}

function Companies() {
  const { t } = useI18n();
  const { companies, reloadCompanies } = usePortal();
  const action = useAction();
  const [f, setF] = useState({ legalName: "", employeeCodePrefix: "" });
  return (
    <Panel>
      <ActionMessage action={action} />
      <Table
        rows={companies}
        rowKey={(c) => c.id}
        columns={[
          { key: "legalName", label: t("p.org.legalName") },
          {
            key: "shortName",
            label: t("p.name"),
            render: (c) => c.shortName ?? "",
          },
          {
            key: "employeeCodePrefix",
            label: t("p.org.prefix"),
            className: "font-mono",
          },
        ]}
      />
      <AddRow
        busy={action.busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await action.run(
              () =>
                api.post("/companies", {
                  legalName: f.legalName,
                  ...(f.employeeCodePrefix
                    ? { employeeCodePrefix: f.employeeCodePrefix }
                    : {}),
                }),
              t("p.saved"),
            )
          ) {
            setF({ legalName: "", employeeCodePrefix: "" });
            await reloadCompanies();
          }
        }}
      >
        <Field label={t("p.org.legalName")}>
          <Input
            required
            value={f.legalName}
            onChange={(e) => setF({ ...f, legalName: e.target.value })}
          />
        </Field>
        <Field label={t("p.org.prefix")}>
          <Input
            className="w-24"
            value={f.employeeCodePrefix}
            onChange={(e) => setF({ ...f, employeeCodePrefix: e.target.value })}
          />
        </Field>
      </AddRow>
      <AttendanceRules />
      <EmployeeRules />
    </Panel>
  );
}

interface CompanyRules {
  id: string;
  legalName: string;
  attendanceCorrectionLimit: number;
  latePenaltyEnabled: boolean;
  latePenaltyEvery: number;
  version: number;
}

/** Spec §5 / §6.2 company settings: corrections per month, the late penalty (off until legal review). */
function AttendanceRules() {
  const { t } = useI18n();
  const { company } = usePortal();
  const rules = useApi<CompanyRules>(
    company ? `/companies/${company.id}` : null,
  );
  const save = useAction();
  const [f, setF] = useState<{
    limit: string;
    enabled: boolean;
    every: string;
  } | null>(null);
  if (!rules.data) return null;
  const r = rules.data;
  const v = f ?? {
    limit: String(r.attendanceCorrectionLimit),
    enabled: r.latePenaltyEnabled,
    every: String(r.latePenaltyEvery),
  };
  return (
    <section className="mt-6 border-t border-slate-200 pt-4">
      <h3 className="mb-2 font-semibold">
        {t("ar.p.rules")}: {r.legalName}
      </h3>
      <ActionMessage action={save} />
      <form
        className="grid items-end gap-x-3 sm:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          // the latest version: the other rules panel may have saved the company meanwhile
          const { version } = await api.get<{ version: number }>(
            `/companies/${r.id}`,
          );
          const body = {
            version,
            attendanceCorrectionLimit: Number(v.limit),
            latePenaltyEnabled: v.enabled,
            latePenaltyEvery: Number(v.every),
          };
          if (
            await save.run(
              () => api.patch(`/companies/${r.id}`, body),
              t("p.saved"),
            )
          ) {
            setF(null);
            rules.reload();
          }
        }}
      >
        <Field label={t("ar.p.correctionLimit")}>
          <Input
            type="number"
            min={0}
            max={31}
            required
            value={v.limit}
            onChange={(e) => setF({ ...v, limit: e.target.value })}
            id="rules-correction-limit"
          />
        </Field>
        <label className="mb-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={v.enabled}
            onChange={(e) => setF({ ...v, enabled: e.target.checked })}
            id="rules-late-penalty"
          />
          {t("ar.p.latePenalty")}
        </label>
        <Field label={t("ar.p.latePenaltyEvery")}>
          <Input
            type="number"
            min={1}
            max={31}
            required
            disabled={!v.enabled}
            value={v.every}
            onChange={(e) => setF({ ...v, every: e.target.value })}
            id="rules-late-every"
          />
        </Field>
        <div className="mb-3">
          <Button type="submit" busy={save.busy} className="w-full">
            {t("p.save")}
          </Button>
        </div>
      </form>
      <p className="text-xs text-amber-700">{t("ar.p.latePenaltyNote")}</p>
    </section>
  );
}

/** Probation length, notice periods and retirement age (spec §3: company settings). */
function EmployeeRules() {
  const { t } = useI18n();
  const { company } = usePortal();
  const rules = useApi<
    CompanyRules & {
      probationMonths: number;
      noticeDaysResignation: number;
      noticeDaysTermination: number;
      retirementAge: number;
    }
  >(company ? `/companies/${company.id}` : null);
  const save = useAction();
  const [f, setF] = useState<{
    probation: string;
    resign: string;
    terminate: string;
    retire: string;
  } | null>(null);
  if (!rules.data) return null;
  const r = rules.data;
  const v = f ?? {
    probation: String(r.probationMonths),
    resign: String(r.noticeDaysResignation),
    terminate: String(r.noticeDaysTermination),
    retire: String(r.retirementAge),
  };
  return (
    <section className="mt-6 border-t border-slate-200 pt-4">
      <h3 className="mb-2 font-semibold">
        {t("lc.rules.title")}: {r.legalName}
      </h3>
      <ActionMessage action={save} />
      <form
        className="grid items-end gap-x-3 sm:grid-cols-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const { version } = await api.get<{ version: number }>(
            `/companies/${r.id}`,
          );
          const body = {
            version,
            probationMonths: Number(v.probation),
            noticeDaysResignation: Number(v.resign),
            noticeDaysTermination: Number(v.terminate),
            retirementAge: Number(v.retire),
          };
          if (
            await save.run(
              () => api.patch(`/companies/${r.id}`, body),
              t("p.saved"),
            )
          ) {
            setF(null);
            rules.reload();
          }
        }}
      >
        <Field label={t("lc.rules.probation")}>
          <Input
            type="number"
            min={0}
            max={12}
            required
            value={v.probation}
            onChange={(e) => setF({ ...v, probation: e.target.value })}
            id="rules-probation"
          />
        </Field>
        <Field label={t("lc.rules.noticeResign")}>
          <Input
            type="number"
            min={0}
            max={365}
            required
            value={v.resign}
            onChange={(e) => setF({ ...v, resign: e.target.value })}
            id="rules-notice-resign"
          />
        </Field>
        <Field label={t("lc.rules.noticeTerminate")}>
          <Input
            type="number"
            min={0}
            max={365}
            required
            value={v.terminate}
            onChange={(e) => setF({ ...v, terminate: e.target.value })}
            id="rules-notice-terminate"
          />
        </Field>
        <Field label={t("lc.rules.retirement")}>
          <Input
            type="number"
            min={40}
            max={80}
            required
            value={v.retire}
            onChange={(e) => setF({ ...v, retire: e.target.value })}
            id="rules-retirement"
          />
        </Field>
        <div className="mb-3">
          <Button type="submit" busy={save.busy} className="w-full">
            {t("p.save")}
          </Button>
        </div>
      </form>
      <p className="text-xs text-amber-700">{t("lc.rules.hint")}</p>
    </section>
  );
}

/**
 * Change a branch: name, address, weekly holidays and the geo-fence of phone punches
 * (centre + radius). "Use my current location" fills the centre while standing in the office.
 */
/**
 * Retiring instead of deleting: an entry that is in use somewhere cannot go
 * away, so a wrong or finished one is taken out of the pickers and left on the
 * old records. The same checkbox brings it back.
 */
function RetireField({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="mb-3 mt-1 flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        checked={!value}
        onChange={(e) => onChange(!e.target.checked)}
      />
      <span>
        {t("p.org.deactivate")}
        <span className="block text-xs text-slate-500">
          {t("p.org.retireHint")}
        </span>
      </span>
    </label>
  );
}

function EditDepartment({
  department,
  departments,
  onClose,
  onSaved,
}: {
  department: Department;
  departments: Department[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    code: department.code,
    name: department.name,
    parentId: department.parentId ?? "",
    cost: department.costCentreCode ?? "",
    isActive: department.isActive !== false,
  });
  return (
    <Modal
      title={`${t("p.org.editDepartment")}: ${department.code}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            version: department.version,
            code: f.code,
            name: f.name,
            parentId: f.parentId === "" ? null : f.parentId,
            costCentreCode: f.cost,
            isActive: f.isActive,
          };
          if (
            await save.run(
              () => api.patch(`/departments/${department.id}`, body),
              t("p.saved"),
            )
          )
            onSaved();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("p.code")}>
            <Input
              required
              maxLength={30}
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
        </div>
        <Field label={t("p.org.parent")} hint={t("p.org.parentHint")}>
          <Select
            value={f.parentId}
            onChange={(e) => setF({ ...f, parentId: e.target.value })}
          >
            <option value="">—</option>
            {departments
              .filter((d) => d.id !== department.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {"— ".repeat(d.depth ?? 0)}
                  {d.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t("p.org.costCentre")}>
          <Input
            maxLength={30}
            value={f.cost}
            onChange={(e) => setF({ ...f, cost: e.target.value })}
          />
        </Field>
        <RetireField
          value={f.isActive}
          onChange={(v) => setF({ ...f, isActive: v })}
        />
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function EditDesignation({
  designation,
  onClose,
  onSaved,
}: {
  designation: Designation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    code: designation.code,
    nameEn: designation.nameEn,
    nameBn: designation.nameBn ?? "",
    isActive: designation.isActive !== false,
  });
  return (
    <Modal
      title={`${t("p.org.editDesignation")}: ${designation.code}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            version: designation.version,
            code: f.code,
            nameEn: f.nameEn,
            nameBn: f.nameBn,
            isActive: f.isActive,
          };
          if (
            await save.run(
              () => api.patch(`/designations/${designation.id}`, body),
              t("p.saved"),
            )
          )
            onSaved();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label={t("p.code")}>
            <Input
              required
              maxLength={30}
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
            />
          </Field>
          <Field label={t("p.name")}>
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
        </div>
        <RetireField
          value={f.isActive}
          onChange={(v) => setF({ ...f, isActive: v })}
        />
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function EditGrade({
  grade,
  onClose,
  onSaved,
}: {
  grade: Grade;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    code: grade.code,
    name: grade.name,
    rank: String(grade.rank ?? 0),
    otEligible: grade.otEligible,
    salaryMin: grade.salaryMin ?? "",
    salaryMax: grade.salaryMax ?? "",
    isActive: grade.isActive !== false,
  });
  return (
    <Modal
      title={`${t("p.org.editGrade")}: ${grade.code}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            version: grade.version,
            code: f.code,
            name: f.name,
            rank: Number(f.rank || 0),
            otEligible: f.otEligible,
            ...(f.salaryMin ? { salaryMin: f.salaryMin } : {}),
            ...(f.salaryMax ? { salaryMax: f.salaryMax } : {}),
            isActive: f.isActive,
          };
          if (
            await save.run(
              () => api.patch(`/grades/${grade.id}`, body),
              t("p.saved"),
            )
          )
            onSaved();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label={t("p.code")}>
            <Input
              required
              maxLength={30}
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
          <Field label={t("p.org.rank")}>
            <Input
              type="number"
              min={0}
              max={1000}
              value={f.rank}
              onChange={(e) => setF({ ...f, rank: e.target.value })}
            />
          </Field>
          <Field label={t("p.org.salaryMin")}>
            <Input
              inputMode="decimal"
              value={f.salaryMin}
              onChange={(e) => setF({ ...f, salaryMin: e.target.value })}
            />
          </Field>
          <Field label={t("p.org.salaryMax")}>
            <Input
              inputMode="decimal"
              value={f.salaryMax}
              onChange={(e) => setF({ ...f, salaryMax: e.target.value })}
            />
          </Field>
          <Field label={t("p.org.otEligible")}>
            <Select
              value={f.otEligible ? "yes" : "no"}
              onChange={(e) =>
                setF({ ...f, otEligible: e.target.value === "yes" })
              }
            >
              <option value="no">{t("p.no")}</option>
              <option value="yes">{t("p.yes")}</option>
            </Select>
          </Field>
        </div>
        <RetireField
          value={f.isActive}
          onChange={(v) => setF({ ...f, isActive: v })}
        />
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function EditBranch({
  branch,
  onClose,
  onSaved,
}: {
  branch: Branch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    name: branch.name,
    address: branch.address ?? "",
    weekend: branch.weekendDays.join(","),
    lat: branch.geoFence ? String(branch.geoFence.lat) : "",
    lng: branch.geoFence ? String(branch.geoFence.lng) : "",
    radius: branch.geoFence ? String(branch.geoFence.radiusM) : "150",
    fence: branch.geoFence !== null,
    isActive: branch.isActive !== false,
  });
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const doubtful = f.fence && fenceWarnings(f.lat, f.lng, f.radius).length > 0;

  async function here() {
    setLocating(true);
    setLocError(null);
    try {
      const p = await currentPosition();
      setF((x) => ({
        ...x,
        fence: true,
        lat: p.latitude.toFixed(6),
        lng: p.longitude.toFixed(6),
      }));
    } catch {
      setLocError(t("att.locationDenied"));
    } finally {
      setLocating(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      version: branch.version,
      name: f.name,
      address: f.address,
      isActive: f.isActive,
      weekendDays: f.weekend
        .split(",")
        .map((d) => d.trim().toUpperCase())
        .filter((d) => WEEKDAYS.includes(d)),
      ...(f.fence
        ? {
            geoLat: Number(f.lat),
            geoLng: Number(f.lng),
            geoRadiusM: Number(f.radius),
          }
        : { geoLat: null, geoLng: null, geoRadiusM: null }),
    };
    if (
      await save.run(
        () => api.patch(`/branches/${branch.id}`, body),
        t("p.saved"),
      )
    )
      onSaved();
  }

  return (
    <Modal
      title={`${t("p.org.editBranch")}: ${branch.code}`}
      open
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <Field label={t("p.name")}>
          <Input
            required
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            id="branch-name"
          />
        </Field>
        <Field label={t("p.org.address")}>
          <Input
            value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
            id="branch-address"
          />
        </Field>
        <Field label={t("p.org.weekend")}>
          <Input
            placeholder="FRI,SAT"
            value={f.weekend}
            onChange={(e) => setF({ ...f, weekend: e.target.value })}
            id="branch-weekend"
          />
        </Field>
        <label className="mt-2 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={f.fence}
            onChange={(e) => setF({ ...f, fence: e.target.checked })}
            id="branch-fence"
          />
          {t("p.org.fenceOn")}
        </label>
        {f.fence && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("p.org.lat")}>
                <Input
                  required
                  inputMode="decimal"
                  value={f.lat}
                  onChange={(e) => setF({ ...f, lat: e.target.value })}
                  id="branch-lat"
                />
              </Field>
              <Field label={t("p.org.lng")}>
                <Input
                  required
                  inputMode="decimal"
                  value={f.lng}
                  onChange={(e) => setF({ ...f, lng: e.target.value })}
                  id="branch-lng"
                />
              </Field>
              <Field label={t("p.org.radius")}>
                <Input
                  required
                  type="number"
                  min={10}
                  max={5000}
                  value={f.radius}
                  onChange={(e) => setF({ ...f, radius: e.target.value })}
                  id="branch-radius"
                />
              </Field>
            </div>
            <Button
              type="button"
              variant="secondary"
              busy={locating}
              onClick={here}
            >
              📍 {t("p.org.useHere")}
            </Button>
            {locError && (
              <p className="mt-1 text-sm text-red-700">{locError}</p>
            )}
            <FenceWarnings lat={f.lat} lng={f.lng} radius={f.radius} />
            {doubtful && (
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  required
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                  id="branch-fence-checked"
                />
                {t("ar.g.confirm")}
              </label>
            )}
            <p className="mt-2 text-xs text-slate-500">
              {t("p.org.fenceHint")}
            </p>
          </>
        )}
        <RetireField
          value={f.isActive}
          onChange={(v) => setF({ ...f, isActive: v })}
        />
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}
