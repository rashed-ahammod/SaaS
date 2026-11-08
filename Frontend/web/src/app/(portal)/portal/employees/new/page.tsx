"use client";
/** Hire: a new employee record (draft) with the first placement. Then onboarding, then activation. */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ActionMessage,
  FormButtons,
  PageHeader,
  Panel,
  useAction,
} from "@/components/portal/kit";
import { useOrg } from "@/components/portal/org";
import { usePortal } from "@/components/portal/portal-context";
import { Field, Input, Select } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dhakaToday } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { EmployeeSummary, Page } from "@/lib/portal-types";

export default function NewEmployeePage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company } = usePortal();
  const org = useOrg(company?.id);
  const managers = useApi<Page<EmployeeSummary>>(
    company ? `/employees?companyId=${company.id}&pageSize=200` : null,
  );
  const people = (managers.data?.items ?? []).filter(
    (m) => m.status !== "separated",
  );
  const save = useAction();
  const [f, setF] = useState<Record<string, string>>({
    joinDate: dhakaToday(),
  });
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = Object.fromEntries(
      Object.entries({ ...f, companyId: company!.id }).filter(
        ([, v]) => v !== "",
      ),
    );
    const created = await save.run(() =>
      api.post<{ id: string }>("/employees", body),
    );
    if (created) router.push(`/portal/employees/${created.id}?created=1`);
  }

  return (
    <div>
      <PageHeader title={t("p.emp.new")} />
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <Panel title={t("p.emp.tab.profile")}>
          <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("p.emp.nameEn")}>
              <Input
                required
                maxLength={150}
                value={f.fullNameEn ?? ""}
                onChange={set("fullNameEn")}
              />
            </Field>
            <Field label={t("p.emp.nameBn")}>
              <Input
                maxLength={150}
                value={f.fullNameBn ?? ""}
                onChange={set("fullNameBn")}
              />
            </Field>
            <Field label={t("p.emp.codeAuto")}>
              <Input
                maxLength={30}
                value={f.employeeCode ?? ""}
                onChange={set("employeeCode")}
              />
            </Field>
            <Field label={t("p.emp.gender")}>
              <Select value={f.gender ?? ""} onChange={set("gender")}>
                <option value="">—</option>
                {(["male", "female", "other"] as const).map((g) => (
                  <option key={g} value={g}>
                    {t(`p.emp.gender.${g}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("p.emp.dob")}>
              <Input
                type="date"
                value={f.dateOfBirth ?? ""}
                onChange={set("dateOfBirth")}
              />
            </Field>
            <Field label={t("p.emp.nid")}>
              <Input
                inputMode="numeric"
                pattern="\d{10}|\d{13}|\d{17}"
                value={f.nid ?? ""}
                onChange={set("nid")}
              />
            </Field>
            <Field label={t("p.emp.tin")}>
              <Input
                inputMode="numeric"
                pattern="\d{12}"
                value={f.tin ?? ""}
                onChange={set("tin")}
              />
            </Field>
            <Field label={t("p.emp.phone")}>
              <Input
                inputMode="tel"
                placeholder="01712345678"
                value={f.phone ?? ""}
                onChange={set("phone")}
              />
            </Field>
            <Field label={t("p.emp.email")}>
              <Input
                type="email"
                value={f.personalEmail ?? ""}
                onChange={set("personalEmail")}
              />
            </Field>
            <Field label={t("p.emp.presentAddress")}>
              <Input
                maxLength={300}
                value={f.presentAddress ?? ""}
                onChange={set("presentAddress")}
              />
            </Field>
            <Field label={t("p.emp.permanentAddress")}>
              <Input
                maxLength={300}
                value={f.permanentAddress ?? ""}
                onChange={set("permanentAddress")}
              />
            </Field>
            <Field label={t("p.emp.festivalGroup")}>
              <Input
                maxLength={30}
                placeholder="eid"
                value={f.festivalGroup ?? ""}
                onChange={set("festivalGroup")}
              />
            </Field>
          </div>
        </Panel>
        {/* the one thing nobody has time to look for on the day it is needed */}
        <Panel title={t("p.emp.emergency")}>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label={t("p.emp.emergencyName")}>
              <Input
                maxLength={200}
                placeholder="Rahima Begum (mother)"
                value={f.emergencyContactName ?? ""}
                onChange={set("emergencyContactName")}
              />
            </Field>
            <Field label={t("p.emp.emergencyPhone")}>
              <Input
                inputMode="tel"
                placeholder="01812345678"
                value={f.emergencyContactPhone ?? ""}
                onChange={set("emergencyContactPhone")}
              />
            </Field>
          </div>
        </Panel>
        <Panel title={t("p.emp.placement")}>
          <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("p.emp.joined")}>
              <Input
                type="date"
                required
                value={f.joinDate ?? ""}
                onChange={set("joinDate")}
              />
            </Field>
            <Field label={t("p.branch")}>
              <Select
                required
                value={f.branchId ?? ""}
                onChange={set("branchId")}
              >
                <option value="">—</option>
                {org.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("p.department")}>
              <Select
                required
                value={f.departmentId ?? ""}
                onChange={set("departmentId")}
              >
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
              <Select
                required
                value={f.designationId ?? ""}
                onChange={set("designationId")}
              >
                <option value="">—</option>
                {org.designations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {lang === "bn" ? (d.nameBn ?? d.nameEn) : d.nameEn}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("p.grade")}>
              <Select
                required
                value={f.gradeId ?? ""}
                onChange={set("gradeId")}
              >
                <option value="">—</option>
                {org.grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.code} · {g.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("p.emp.manager")} hint={t("p.emp.managerHint")}>
              <Select
                value={f.lineManagerId ?? ""}
                onChange={set("lineManagerId")}
              >
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
          </div>
        </Panel>
        <FormButtons
          busy={save.busy}
          onCancel={() => router.push("/portal/employees")}
          submitLabel={t("p.create")}
        />
      </form>
    </div>
  );
}
