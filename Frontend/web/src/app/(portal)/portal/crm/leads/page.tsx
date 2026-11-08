"use client";
/** Leads (Phase 3 WP23): the salesperson's own, the Sales head's department, the company for the Admin. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LeadDialog, MyTasks } from "@/components/portal/crm";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, Button, ErrorBox, Input, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import { LEAD_SOURCES, LEAD_STATE_COLOR, type Lead } from "@/lib/crm-types";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function LeadsPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const [state, setState] = useState("open");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const query = new URLSearchParams({
    ...(state ? { state } : {}),
    ...(source ? { source } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  }).toString();
  const leads = useApi<Lead[]>(
    company ? `/companies/${company.id}/leads?${query}` : null,
  );
  if (!company) return null;
  const canCreate = can("crm.own", "crm.assign", "crm.manage");
  return (
    <div>
      <PageHeader
        title={t("cr.leads")}
        subtitle={company.legalName}
        actions={
          canCreate && (
            <Button onClick={() => setCreating(true)}>{t("cr.newLead")}</Button>
          )
        }
      />
      <div className="grid gap-5 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <Panel
            actions={
              <>
                <Input
                  aria-label={t("cr.search")}
                  placeholder={t("cr.search")}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  id="lead-search"
                />
                <Select
                  aria-label={t("cr.state")}
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  id="lead-state"
                >
                  <option value="">{t("p.all")}</option>
                  {(
                    [
                      "open",
                      "new",
                      "contacted",
                      "qualified",
                      "disqualified",
                    ] as const
                  ).map((s) => (
                    <option key={s} value={s}>
                      {t(`cr.state.${s}`)}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={t("cr.source")}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  id="lead-source-filter"
                >
                  <option value="">{t("p.all")}</option>
                  {LEAD_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {t(`cr.source.${s}`)}
                    </option>
                  ))}
                </Select>
              </>
            }
          >
            {leads.error ? (
              <ErrorBox error={leads.error} onRetry={leads.reload} />
            ) : (
              <Table
                rows={leads.data}
                rowKey={(l) => l.id}
                empty={t("st.none")}
                onRowClick={(l) => router.push(`/portal/crm/leads/${l.id}`)}
                columns={[
                  {
                    key: "number",
                    label: t("cr.number"),
                    className: "font-mono whitespace-nowrap text-xs",
                    render: (l) => l.number,
                  },
                  {
                    key: "name",
                    label: t("cr.name"),
                    render: (l) => (
                      <span>
                        {l.name}
                        {l.organisation && (
                          <span className="block text-xs text-slate-500">
                            {l.organisation}
                          </span>
                        )}
                      </span>
                    ),
                  },
                  {
                    key: "phone",
                    label: t("cr.phone"),
                    className: "whitespace-nowrap",
                    render: (l) => l.phone ?? l.email ?? "",
                  },
                  {
                    key: "district",
                    label: t("cr.district"),
                    render: (l) => l.district ?? "",
                  },
                  {
                    key: "source",
                    label: t("cr.source"),
                    render: (l) => t(`cr.source.${l.source}`),
                  },
                  {
                    key: "owner",
                    label: t("cr.owner"),
                    render: (l) => l.ownerName ?? "",
                  },
                  {
                    key: "state",
                    label: t("cr.state"),
                    render: (l) => (
                      <Badge color={LEAD_STATE_COLOR[l.state]}>
                        {t(`cr.state.${l.state}`)}
                      </Badge>
                    ),
                  },
                  {
                    key: "last",
                    label: t("cr.lastActivity"),
                    render: (l) =>
                      formatDate(
                        (l.lastActivityAt ?? l.createdAt).slice(0, 10),
                        lang,
                        { short: true },
                      ),
                  },
                ]}
              />
            )}
          </Panel>
        </div>
        {can("crm.own") && <MyTasks companyId={company.id} />}
      </div>
      {creating && (
        <LeadDialog
          companyId={company.id}
          canChooseOwner={can("crm.assign", "crm.manage")}
          onClose={() => setCreating(false)}
          onDone={(id) => router.push(`/portal/crm/leads/${id}`)}
        />
      )}
    </div>
  );
}
