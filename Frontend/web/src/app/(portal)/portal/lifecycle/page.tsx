"use client";
/**
 * Probation, leavers and papers running out: probations ending soon (the Dept
 * Head recommends, HR decides), people leaving with the clearance each
 * department gives before the final settlement (IT, Admin assets, Accounts
 * advances, Dept Head handover), and the documents whose expiry date is about
 * to pass — a date that was captured on upload and until now told nobody.
 *
 * The dashboard links straight to a tab (?tab=papers), so a reminder lands on
 * the list it is about.
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
  ProbationActions,
  ProbationSummary,
  SeparationView,
  type ProbationDue,
  type Separation,
} from "@/components/portal/employee-lifecycle";
import { PageHeader, Panel, Table, Tabs } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, ErrorBox, Loading, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDate, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Tab = "probation" | "leaving" | "left" | "papers";
const TABS: Tab[] = ["probation", "leaving", "left", "papers"];

export default function LifecyclePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Lifecycle />
    </Suspense>
  );
}

function Lifecycle() {
  const { t } = useI18n();
  const { company, can } = usePortal();
  const reviewer = can("employee.manage", "employee.lifecycle.review");
  const papers = can("employee.manage", "employee.documents.view");
  const asked = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(
    TABS.includes(asked as Tab)
      ? (asked as Tab)
      : reviewer
        ? "probation"
        : "leaving",
  );
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("lc.nav")} subtitle={company.legalName} />
      <Tabs<Tab>
        tabs={[
          ...(reviewer
            ? [{ key: "probation" as Tab, label: t("lc.tab.probation") }]
            : []),
          { key: "leaving", label: t("lc.tab.leaving") },
          { key: "left", label: t("lc.tab.left") },
          ...(papers
            ? [{ key: "papers" as Tab, label: t("lc.tab.papers") }]
            : []),
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "probation" && <Probation companyId={company.id} />}
      {tab === "leaving" && (
        <Leavers companyId={company.id} state="in_notice" />
      )}
      {tab === "left" && <Leavers companyId={company.id} state="separated" />}
      {tab === "papers" && <Papers companyId={company.id} />}
    </div>
  );
}

function Probation({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const due = useApi<ProbationDue[]>(
    `/companies/${companyId}/probation-reviews?withinDays=30`,
  );
  if (due.error) return <ErrorBox error={due.error} onRetry={due.reload} />;
  return (
    <Panel>
      <p className="mb-3 text-sm text-slate-500">{t("lc.prob.hint")}</p>
      <Table
        rows={due.data}
        rowKey={(d) => d.employeeId}
        empty={t("lc.prob.none")}
        columns={[
          {
            key: "employee",
            label: t("p.employee"),
            render: (d) => (
              <Link
                href={`/portal/employees/${d.employeeId}`}
                className="text-emerald-800 underline"
              >
                {d.employeeCode} ·{" "}
                {lang === "bn" ? (d.fullNameBn ?? d.fullNameEn) : d.fullNameEn}
              </Link>
            ),
          },
          {
            key: "ends",
            label: t("lc.prob.ends"),
            render: (d) =>
              formatDate(d.probationEndDate, lang, { short: true }),
          },
          {
            key: "review",
            label: t("lc.prob.outcome"),
            render: (d) => <ProbationSummary due={d} />,
          },
          {
            key: "act",
            label: "",
            align: "right",
            render: (d) => (
              <ProbationActions
                employeeId={d.employeeId}
                name={d.fullNameEn}
                review={d.review}
                onDone={due.reload}
              />
            ),
          },
        ]}
      />
    </Panel>
  );
}

function Leavers({
  companyId,
  state,
}: {
  companyId: string;
  state: "in_notice" | "separated";
}) {
  const { t, lang } = useI18n();
  const list = useApi<Separation[]>(
    `/companies/${companyId}/separations?state=${state}`,
  );
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  if (!list.data.length)
    return (
      <Panel>
        <p className="text-sm text-slate-500">{t("lc.sep.none")}</p>
      </Panel>
    );
  return (
    <>
      {list.data.map((s) => (
        <Panel
          key={s.id}
          title={
            <Link
              href={`/portal/employees/${s.employeeId}`}
              className="text-emerald-800 underline"
            >
              {s.employeeCode} ·{" "}
              {lang === "bn" ? (s.fullNameBn ?? s.fullNameEn) : s.fullNameEn}
            </Link>
          }
        >
          <SeparationView s={s} onChanged={list.reload} />
        </Panel>
      ))}
    </>
  );
}

interface ExpiringDocument {
  id: string;
  employeeId: string;
  employeeCode: string;
  fullNameEn: string;
  fullNameBn: string | null;
  docType: string;
  title: string | null;
  expiresOn: string;
  daysLeft: number;
}

/** Contracts, NIDs and licences that have run out or are about to. */
function Papers({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const [withinDays, setWithinDays] = useState("60");
  const list = useApi<ExpiringDocument[]>(
    `/companies/${companyId}/document-expiries?withinDays=${withinDays}`,
  );
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {t("lc.papers.hint", { n: num(Number(withinDays), lang) })}
        </p>
        <label className="flex items-center gap-2 text-sm whitespace-nowrap">
          {t("lc.papers.window")}
          <Select
            className="min-h-9 py-1"
            value={withinDays}
            onChange={(e) => setWithinDays(e.target.value)}
            aria-label={t("lc.papers.window")}
          >
            <option value="30">{t("lc.papers.days30")}</option>
            <option value="60">{t("lc.papers.days60")}</option>
            <option value="180">{t("lc.papers.days180")}</option>
          </Select>
        </label>
      </div>
      <Table
        rows={list.data}
        rowKey={(d) => d.id}
        empty={t("lc.papers.none")}
        columns={[
          {
            key: "employee",
            label: t("p.employee"),
            render: (d) => (
              <Link
                href={`/portal/employees/${d.employeeId}`}
                className="text-emerald-800 underline"
              >
                {d.employeeCode} ·{" "}
                {lang === "bn" ? (d.fullNameBn ?? d.fullNameEn) : d.fullNameEn}
              </Link>
            ),
          },
          {
            key: "type",
            label: t("lc.doc.type"),
            render: (d) => t(`lc.doc.type.${d.docType}`),
          },
          {
            key: "title",
            label: t("lc.doc.titleField"),
            render: (d) => d.title ?? "—",
          },
          {
            key: "on",
            label: t("lc.papers.expiresOn"),
            render: (d) => formatDate(d.expiresOn, lang, { short: true }),
          },
          {
            key: "left",
            label: "",
            render: (d) =>
              d.daysLeft < 0 ? (
                <Badge color="red">
                  {t("lc.papers.expiredAgo", { n: num(-d.daysLeft, lang) })}
                </Badge>
              ) : d.daysLeft === 0 ? (
                <Badge color="red">{t("lc.papers.today")}</Badge>
              ) : (
                <Badge color={d.daysLeft <= 30 ? "amber" : "gray"}>
                  {t("lc.papers.left", { n: num(d.daysLeft, lang) })}
                </Badge>
              ),
          },
        ]}
      />
    </Panel>
  );
}
