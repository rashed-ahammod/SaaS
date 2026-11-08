"use client";
/** Quotations (Phase 3 WP25): the salesperson's own, the Sales head's team, every one for the Admin and Accounts. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { QuotationDialog } from "@/components/portal/sales";
import { Badge, Button, ErrorBox, Input, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { QUOTE_STATE_COLOR, type Quotation } from "@/lib/sales-types";

export default function QuotationsPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const [state, setState] = useState("open");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const query = new URLSearchParams({
    ...(state ? { state } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  }).toString();
  const list = useApi<Quotation[]>(
    company ? `/companies/${company.id}/quotations?${query}` : null,
  );
  if (!company) return null;
  return (
    <div>
      <PageHeader
        title={t("sa.quotations")}
        subtitle={company.legalName}
        actions={
          can("crm.own", "crm.assign", "crm.manage") && (
            <Button onClick={() => setCreating(true)}>
              {t("sa.newQuotation")}
            </Button>
          )
        }
      />
      <Panel
        actions={
          <>
            <Input
              aria-label={t("cr.search")}
              placeholder={t("cr.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              id="quote-search"
            />
            <Select
              aria-label={t("cr.state")}
              value={state}
              onChange={(e) => setState(e.target.value)}
              id="quote-state"
            >
              <option value="">{t("p.all")}</option>
              {[
                "open",
                "draft",
                "in_approval",
                "approved",
                "sent",
                "accepted",
                "rejected",
                "expired",
                "cancelled",
              ].map((s) => (
                <option key={s} value={s}>
                  {t(`sa.state.${s}`)}
                </option>
              ))}
            </Select>
          </>
        }
      >
        {list.error ? (
          <ErrorBox error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            rows={list.data}
            rowKey={(x) => x.id}
            empty={t("st.none")}
            onRowClick={(x) => router.push(`/portal/sales/quotations/${x.id}`)}
            columns={[
              {
                key: "number",
                label: t("sa.number"),
                className: "font-mono whitespace-nowrap text-xs",
                render: (x) =>
                  `${x.number}${x.revision > 1 ? ` r${x.revision}` : ""}`,
              },
              {
                key: "customer",
                label: t("sa.customer"),
                render: (x) => x.customer ?? "",
              },
              {
                key: "date",
                label: t("sa.quoteDate"),
                render: (x) => formatDate(x.quoteDate, lang, { short: true }),
              },
              {
                key: "valid",
                label: t("sa.validUntil"),
                render: (x) => formatDate(x.validUntil, lang, { short: true }),
              },
              {
                key: "total",
                label: t("sa.total"),
                align: "right",
                render: (x) => formatTaka(x.total, lang),
              },
              {
                key: "owner",
                label: t("cr.owner"),
                render: (x) => x.ownerName ?? "",
              },
              {
                key: "state",
                label: t("cr.state"),
                render: (x) => (
                  <Badge color={QUOTE_STATE_COLOR[x.state]}>
                    {t(`sa.state.${x.state}`)}
                  </Badge>
                ),
              },
            ]}
          />
        )}
      </Panel>
      {creating && (
        <QuotationDialog
          companyId={company.id}
          onClose={() => setCreating(false)}
          onDone={(id) => router.push(`/portal/sales/quotations/${id}`)}
        />
      )}
    </div>
  );
}
