"use client";
/** One employee: profile (with probation or leaving), onboarding, job history, documents, salary, bank, leave, attendance & consent, payslips, salary advances, PF & tax. */
import { useSearchParams } from "next/navigation";
import { Suspense, use, useState } from "react";
import { NoticeDialog } from "@/components/portal/employee-lifecycle";
import {
  EmployeeTabs,
  type EmployeeDetail,
  type TabKey,
} from "@/components/portal/employee-tabs";
import { EMPLOYEE_STATUS_COLOR } from "@/components/portal/labels";
import {
  ActionMessage,
  PageHeader,
  Tabs,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Alert, Badge, Button, ErrorBox, Loading } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function EmployeePage({
  params,
}: PageProps<"/portal/employees/[id]">) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Loading />}>
      <Employee id={id} />
    </Suspense>
  );
}

function Employee({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const params = useSearchParams();
  const created = params.get("created") === "1";
  // ?tab= lets another screen land where the work is, e.g. the attendance day list
  const asked = params.get("tab") as TabKey | null;
  const emp = useApi<EmployeeDetail>(`/employees/${id}`);
  const [tab, setTab] = useState<TabKey>(
    asked ?? (created ? "onboarding" : "profile"),
  );
  const action = useAction();
  const [notice, setNotice] = useState(false);

  if (emp.loading && !emp.data) return <Loading />;
  if (emp.error) return <ErrorBox error={emp.error} onRetry={emp.reload} />;
  const e = emp.data!;
  const manage = can("employee.manage");
  const a = e.currentAssignment;

  const tabs: Array<{ key: TabKey; label: string; show: boolean }> = [
    { key: "profile", label: t("p.emp.tab.profile"), show: true },
    { key: "onboarding", label: t("p.emp.tab.onboarding"), show: manage },
    { key: "job", label: t("p.emp.tab.job"), show: true },
    {
      key: "documents",
      label: t("lc.doc.tab"),
      show: can("employee.manage", "employee.documents.view"),
    },
    {
      key: "salary",
      label: t("p.emp.tab.salary"),
      show: can("payroll.prepare", "payroll.verify", "payroll.approve"),
    },
    {
      key: "bank",
      label: t("p.emp.tab.bank"),
      show: can("employee.bank.manage", "payroll.disburse"),
    },
    {
      key: "leave",
      label: t("p.emp.tab.leave"),
      show: can("leave.view", "leave.manage"),
    },
    {
      key: "attendance",
      label: t("p.emp.tab.attendance"),
      show: can("attendance.manage"),
    },
    {
      key: "payslips",
      label: t("p.emp.tab.payslips"),
      show: can("payroll.prepare", "payroll.verify", "payroll.approve"),
    },
    { key: "loans", label: t("py.tab.loans"), show: can("payroll.prepare") },
    {
      key: "statements",
      label: t("py.tab.statements"),
      show: can("payroll.prepare", "payroll.verify", "payroll.approve"),
    },
  ];

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {lang === "bn" ? (e.fullNameBn ?? e.fullNameEn) : e.fullNameEn}
            <Badge color={EMPLOYEE_STATUS_COLOR[e.status]}>
              {t(`p.emp.status.${e.status}`)}
            </Badge>
          </span>
        }
        subtitle={[
          e.employeeCode,
          a?.designation.nameEn,
          a?.department.name,
          a?.branch.name,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          manage && (
            <>
              {e.status === "draft" && (
                <Button
                  busy={action.busy}
                  onClick={() =>
                    action
                      .run(
                        () => api.post(`/employees/${id}/activate`),
                        t("p.emp.activated"),
                      )
                      .then(() => emp.reload())
                  }
                >
                  {t("p.emp.activate")}
                </Button>
              )}
              {(e.status === "active" || e.status === "probation") && (
                <Button variant="secondary" onClick={() => setNotice(true)}>
                  {t("lc.notice.title")}
                </Button>
              )}
            </>
          )
        }
      />
      {created && <Alert kind="success">{t("p.emp.created")}</Alert>}
      <ActionMessage action={action} />
      <Tabs tabs={tabs.filter((x) => x.show)} active={tab} onChange={setTab} />
      <EmployeeTabs tab={tab} employee={e} reload={emp.reload} />
      <NoticeDialog
        open={notice}
        onClose={() => setNotice(false)}
        employeeId={id}
        onDone={emp.reload}
      />
    </div>
  );
}
