"use client";
/**
 * Employees of the selected company: search, filter by status, department,
 * branch and designation, page through, and download what the filters show.
 *
 * The branch filter matters because a company here has several branches with
 * their own weekend and geo-fence, and "who works at Gazipur" was a question
 * the list could not answer.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/portal/guide";
import { PageHeader, Panel, Table, useAction } from "@/components/portal/kit";
import { EMPLOYEE_STATUS_COLOR } from "@/components/portal/labels";
import { useOrg } from "@/components/portal/org";
import { usePortal } from "@/components/portal/portal-context";
import {
  Badge,
  Button,
  ButtonLink,
  ErrorBox,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, saveDownload, useApi } from "@/lib/api";
import { formatDate, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { EmployeeSummary, Page } from "@/lib/portal-types";

export default function EmployeesPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const org = useOrg(company?.id);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [page, setPage] = useState(1);
  const download = useAction();

  /** The filters, as the API takes them; the export sends the same ones. */
  const filters = new URLSearchParams({ companyId: company?.id ?? "" });
  if (search) filters.set("q", search);
  if (status) filters.set("status", status);
  if (departmentId) filters.set("departmentId", departmentId);
  if (branchId) filters.set("branchId", branchId);
  if (designationId) filters.set("designationId", designationId);
  const filtered =
    search || status || departmentId || branchId || designationId;

  const params = new URLSearchParams(filters);
  params.set("page", String(page));
  params.set("pageSize", "25");
  const list = useApi<Page<EmployeeSummary>>(
    company ? `/employees?${params}` : null,
  );
  const pages = list.data
    ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize))
    : 1;

  /** Narrowing the list always goes back to page 1, or the page is out of range. */
  const narrow =
    (set: (value: string) => void) => (e: { target: { value: string } }) => {
      set(e.target.value);
      setPage(1);
    };

  return (
    <div>
      <PageHeader
        title={t("p.emp.title")}
        subtitle={
          list.data
            ? t("p.emp.count", { n: num(list.data.total, lang) })
            : undefined
        }
        actions={
          <>
            <Button
              variant="secondary"
              busy={download.busy}
              title={t("p.emp.exportHint")}
              onClick={() =>
                download.run(async () =>
                  saveDownload(
                    await api.file(`/employees/export.csv?${filters}`),
                    "employees.csv",
                  ),
                )
              }
            >
              {t("p.emp.export")}
            </Button>
            {can("employee.manage") && (
              <ButtonLink href="/portal/employees/new">
                {t("p.emp.new")}
              </ButtonLink>
            )}
          </>
        }
      />
      <Panel>
        <form
          className="mb-3 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(q.trim());
          }}
        >
          <Input
            className="max-w-xs"
            placeholder={t("p.emp.searchHint")}
            aria-label={t("p.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Select
            className="max-w-[12rem]"
            aria-label={t("p.status")}
            value={status}
            onChange={narrow(setStatus)}
          >
            <option value="">
              {t("p.status")}: {t("p.all")}
            </option>
            {(
              ["draft", "probation", "active", "notice", "separated"] as const
            ).map((s) => (
              <option key={s} value={s}>
                {t(`p.emp.status.${s}`)}
              </option>
            ))}
          </Select>
          <Select
            className="max-w-[14rem]"
            aria-label={t("p.department")}
            value={departmentId}
            onChange={narrow(setDepartmentId)}
          >
            <option value="">
              {t("p.department")}: {t("p.all")}
            </option>
            {org.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {"— ".repeat(d.depth ?? 0)}
                {d.name}
              </option>
            ))}
          </Select>
          <Select
            className="max-w-[12rem]"
            aria-label={t("p.emp.filterBranch")}
            value={branchId}
            onChange={narrow(setBranchId)}
          >
            <option value="">
              {t("p.branch")}: {t("p.all")}
            </option>
            {org.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select
            className="max-w-[14rem]"
            aria-label={t("p.emp.filterDesignation")}
            value={designationId}
            onChange={narrow(setDesignationId)}
          >
            <option value="">
              {t("p.designation")}: {t("p.all")}
            </option>
            {org.designations.map((d) => (
              <option key={d.id} value={d.id}>
                {lang === "bn" ? (d.nameBn ?? d.nameEn) : d.nameEn}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            {t("p.search")}
          </Button>
        </form>
        {download.error && (
          <p className="mb-2 text-sm text-red-700">{download.error}</p>
        )}
        {list.loading ? (
          <Loading />
        ) : list.error ? (
          <ErrorBox error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            rows={list.data?.items}
            empty={
              filtered ? (
                <EmptyState
                  text={t("g.empty.search")}
                  hint={t("g.empty.searchHint")}
                />
              ) : (
                <EmptyState
                  text={t("g.empty.employees")}
                  hint={t("g.empty.employeesHint")}
                  action={
                    can("employee.manage") && (
                      <ButtonLink href="/portal/employees/new">
                        {t("p.emp.new")}
                      </ButtonLink>
                    )
                  }
                />
              )
            }
            rowKey={(e) => e.id}
            onRowClick={(e) => router.push(`/portal/employees/${e.id}`)}
            columns={[
              {
                key: "employeeCode",
                label: t("p.code"),
                className: "font-mono whitespace-nowrap",
              },
              {
                key: "name",
                label: t("p.name"),
                render: (e) =>
                  lang === "bn" ? (e.fullNameBn ?? e.fullNameEn) : e.fullNameEn,
              },
              {
                key: "branch",
                label: t("p.branch"),
                render: (e) => e.currentAssignment?.branch.name ?? "—",
              },
              {
                key: "department",
                label: t("p.department"),
                render: (e) => e.currentAssignment?.department.name ?? "—",
              },
              {
                key: "designation",
                label: t("p.designation"),
                render: (e) =>
                  (lang === "bn"
                    ? (e.currentAssignment?.designation.nameBn ??
                      e.currentAssignment?.designation.nameEn)
                    : e.currentAssignment?.designation.nameEn) ?? "—",
              },
              {
                key: "joinDate",
                label: t("p.emp.joined"),
                render: (e) => formatDate(e.joinDate, lang, { short: true }),
              },
              {
                key: "status",
                label: t("p.status"),
                render: (e) => (
                  <Badge color={EMPLOYEE_STATUS_COLOR[e.status]}>
                    {t(`p.emp.status.${e.status}`)}
                  </Badge>
                ),
              },
            ]}
          />
        )}
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-end gap-2 text-sm">
            <Button
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t("p.prev")}
            </Button>
            <span>
              {t("p.pageOf", {
                page: num(page, lang),
                pages: num(pages, lang),
              })}
            </span>
            <Button
              variant="ghost"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              {t("p.next")}
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
