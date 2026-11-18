"use client";
/**
 * Customer tickets (Phase 3 WP28): what is open, what is late, and whose desk it is on.
 * A Sales user sees the tickets of their own customers; a Dept Head their department's;
 * the Admin the company's.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  NewTicketDialog,
  PriorityBadge,
  StateBadge,
  useWhen,
} from "@/components/portal/support";
import { Badge, Button, ErrorBox, Input, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  TICKET_PRIORITIES,
  TICKET_STATES,
  type TicketRow,
} from "@/lib/support-types";

export default function TicketsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const when = useWhen();
  const { company, can } = usePortal();
  const [state, setState] = useState("open_only");
  const [priority, setPriority] = useState("");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const query = new URLSearchParams({
    ...(state ? { state } : {}),
    ...(priority ? { priority } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  }).toString();
  const tickets = useApi<{ tickets: TicketRow[] }>(
    company ? `/companies/${company.id}/support/tickets?${query}` : null,
  );
  if (!company) return null;
  return (
    <div>
      <PageHeader
        title={t("su.tickets")}
        subtitle={company.legalName}
        actions={
          can("support.own", "support.manage") && (
            <Button onClick={() => setCreating(true)}>
              {t("su.newTicket")}
            </Button>
          )
        }
      />
      <Panel
        actions={
          <>
            <Input
              aria-label={t("su.search")}
              placeholder={t("su.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              id="ticket-search"
            />
            <Select
              aria-label={t("su.state")}
              value={state}
              onChange={(e) => setState(e.target.value)}
              id="ticket-state"
            >
              <option value="open_only">{t("su.filterOpen")}</option>
              <option value="breached">{t("su.filterBreached")}</option>
              <option value="">{t("su.filterAll")}</option>
              {TICKET_STATES.map((s) => (
                <option key={s} value={s}>
                  {t(`su.state.${s}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("su.priority")}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              id="ticket-priority-filter"
            >
              <option value="">{t("su.filterAll")}</option>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`su.priority.${p}`)}
                </option>
              ))}
            </Select>
          </>
        }
      >
        {tickets.error ? (
          <ErrorBox error={tickets.error} onRetry={tickets.reload} />
        ) : (
          <Table
            rows={tickets.data?.tickets}
            rowKey={(x) => x.id}
            empty={t("st.none")}
            onRowClick={(x) => router.push(`/portal/support/tickets/${x.id}`)}
            columns={[
              {
                key: "number",
                label: t("su.number"),
                className: "font-mono",
                render: (x) => x.number,
              },
              {
                key: "customer",
                label: t("su.customer"),
                render: (x) => x.customerName,
              },
              {
                key: "subject",
                label: t("su.subject"),
                render: (x) => (
                  <span>
                    {x.subject}
                    <span className="block text-xs text-slate-500">
                      {x.categoryName}
                    </span>
                  </span>
                ),
              },
              {
                key: "priority",
                label: t("su.priority"),
                render: (x) => <PriorityBadge priority={x.priority} />,
              },
              {
                key: "state",
                label: t("su.state"),
                render: (x) => (
                  <span className="flex flex-wrap items-center gap-1">
                    <StateBadge state={x.state} />
                    {x.breached && (
                      <Badge color="red">{t("su.breached")}</Badge>
                    )}
                  </span>
                ),
              },
              {
                key: "due",
                label: t("su.resolution"),
                render: (x) =>
                  x.resolvedAt ? when(x.resolvedAt) : when(x.resolutionDueAt),
              },
              {
                key: "created",
                label: t("su.created"),
                render: (x) => when(x.createdAt),
              },
            ]}
          />
        )}
      </Panel>
      {creating && (
        <NewTicketDialog
          companyId={company.id}
          onClose={() => setCreating(false)}
          onDone={(id) => router.push(`/portal/support/tickets/${id}`)}
        />
      )}
    </div>
  );
}
