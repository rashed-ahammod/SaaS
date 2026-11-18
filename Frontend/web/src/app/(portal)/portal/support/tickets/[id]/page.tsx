"use client";
/**
 * One ticket (Phase 3 WP28): the customer, the two SLA clocks, the whole thread, and the
 * work — reply, internal note, ask the customer, resolve, close, reopen, hand over, change
 * the priority. Which buttons appear follows the ticket's state, so an impossible step is
 * never offered (the API refuses it anyway).
 */
import Link from "next/link";
import { use, useState } from "react";
import {
  ActionMessage,
  Detail,
  PageHeader,
  Panel,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  ClosedNotice,
  PriorityBadge,
  SlaPanel,
  StateBadge,
  TicketTextAction,
  TicketThread,
  useWhen,
} from "@/components/portal/support";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Loading,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  TICKET_PRIORITIES,
  type Ticket,
  type TicketPriority,
} from "@/lib/support-types";

type Doing = "reply" | "note" | "customer" | "ask" | "resolve" | "reopen" | null;

export default function TicketPage({
  params,
}: PageProps<"/portal/support/tickets/[id]">) {
  const { id } = use(params);
  const { t } = useI18n();
  const { can } = usePortal();
  const when = useWhen();
  const ticket = useApi<Ticket>(`/support/tickets/${id}`);
  const priority = useAction();
  const close = useAction();
  const assign = useAction();
  const [doing, setDoing] = useState<Doing>(null);
  const [newPriority, setNewPriority] = useState<TicketPriority | "">("");
  const [assignee, setAssignee] = useState("");
  // the people a ticket may be handed to; loaded with the other hooks, so the hook order
  // never changes between renders
  const loaded = ticket.data;
  const people = useApi<Array<{ userId: string; name: string }>>(
    loaded &&
      can("support.manage") &&
      !["resolved", "closed"].includes(loaded.state)
      ? `/companies/${loaded.companyId}/salespeople`
      : null,
  );

  if (ticket.loading && !ticket.data) return <Loading />;
  if (ticket.error)
    return <ErrorBox error={ticket.error} onRetry={ticket.reload} />;
  const x = ticket.data!;
  const done = () => {
    setDoing(null);
    ticket.reload();
  };
  const open = !["resolved", "closed"].includes(x.state);
  const mayWork = can("support.own", "support.manage");
  const mayManage = can("support.manage");

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">{x.number}</span> {x.subject}
            <PriorityBadge priority={x.priority} />
            <StateBadge state={x.state} />
            {(x.sla.firstResponseBreached || x.sla.resolutionBreached) && (
              <Badge color="red">{t("su.breached")}</Badge>
            )}
          </span>
        }
        subtitle={x.customer?.name}
        actions={
          <>
            {mayWork && open && (
              <>
                <Button onClick={() => setDoing("reply")}>
                  {t("su.addReply")}
                </Button>
                <Button variant="secondary" onClick={() => setDoing("note")}>
                  {t("su.addNote")}
                </Button>
                {x.state === "waiting_customer" ? (
                  <Button
                    variant="secondary"
                    onClick={() => setDoing("customer")}
                  >
                    {t("su.recordCustomer")}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => setDoing("ask")}>
                    {t("su.askCustomer")}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setDoing("resolve")}>
                  {t("su.resolve")}
                </Button>
              </>
            )}
            {mayWork && x.state === "resolved" && (
              <Button
                busy={close.busy}
                onClick={() =>
                  close
                    .run(
                      () => api.post(`/support/tickets/${x.id}/close`),
                      t("su.saved"),
                    )
                    .then(() => ticket.reload())
                }
              >
                {t("su.close")}
              </Button>
            )}
            {mayManage && !open && (
              <Button variant="secondary" onClick={() => setDoing("reopen")}>
                {t("su.reopen")}
              </Button>
            )}
          </>
        }
      />
      <ActionMessage action={close} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {x.state === "closed" && <ClosedNotice />}
          {doing === "reply" && (
            <Panel title={t("su.reply")}>
              <TicketTextAction
                id="ticket-reply"
                label={t("su.reply")}
                submitLabel={t("su.addReply")}
                onSubmit={(body) =>
                  api.post(`/support/tickets/${x.id}/messages`, {
                    kind: "reply",
                    body,
                  })
                }
                onDone={done}
              />
            </Panel>
          )}
          {doing === "note" && (
            <Panel title={t("su.note")}>
              <TicketTextAction
                id="ticket-note"
                label={t("su.note")}
                submitLabel={t("su.addNote")}
                onSubmit={(body) =>
                  api.post(`/support/tickets/${x.id}/messages`, {
                    kind: "note",
                    body,
                  })
                }
                onDone={done}
              />
            </Panel>
          )}
          {doing === "customer" && (
            <Panel title={t("su.customerSaid")}>
              <TicketTextAction
                id="ticket-customer-said"
                label={t("su.customerSaid")}
                submitLabel={t("su.recordCustomer")}
                onSubmit={(body) =>
                  api.post(`/support/tickets/${x.id}/messages`, {
                    kind: "customer",
                    body,
                  })
                }
                onDone={done}
              />
            </Panel>
          )}
          {doing === "ask" && (
            <Panel title={t("su.askCustomer")}>
              <TicketTextAction
                id="ticket-question"
                label={t("su.question")}
                hint={t("su.slaHint")}
                submitLabel={t("su.askCustomer")}
                onSubmit={(question) =>
                  api.post(`/support/tickets/${x.id}/wait`, { question })
                }
                onDone={done}
              />
            </Panel>
          )}
          {doing === "resolve" && (
            <Panel title={t("su.resolve")}>
              <TicketTextAction
                id="ticket-resolution"
                label={t("su.resolutionNote")}
                submitLabel={t("su.resolve")}
                onSubmit={(resolution) =>
                  api.post(`/support/tickets/${x.id}/resolve`, { resolution })
                }
                onDone={done}
              />
            </Panel>
          )}
          {doing === "reopen" && (
            <Panel title={t("su.reopen")}>
              <TicketTextAction
                id="ticket-reopen"
                label={t("su.reopenReason")}
                submitLabel={t("su.reopen")}
                onSubmit={(reason) =>
                  api.post(`/support/tickets/${x.id}/reopen`, { reason })
                }
                onDone={done}
              />
            </Panel>
          )}
          <TicketThread ticket={x} />
        </div>
        <div>
          <Panel title={t("su.ticket")}>
            <dl className="grid gap-3">
              <Detail label={t("su.customer")}>
                {x.customer ? (
                  <Link
                    className="underline"
                    href={`/portal/crm/customers/${x.customer.id}/360`}
                  >
                    {x.customer.name}
                  </Link>
                ) : (
                  "—"
                )}
              </Detail>
              <Detail label={t("su.contact")}>
                {x.contact
                  ? [x.contact.name, x.contact.phone]
                      .filter(Boolean)
                      .join(", ")
                  : (x.customer?.phone ?? "—")}
              </Detail>
              <Detail label={t("su.category")}>
                {x.category?.name ?? "—"}
              </Detail>
              <Detail label={t("su.source")}>
                {t(`su.source.${x.source}`)}
              </Detail>
              <Detail label={t("su.created")}>{when(x.createdAt)}</Detail>
              {x.resolutionNote && (
                <Detail label={t("su.resolutionNote")}>
                  {x.resolutionNote}
                </Detail>
              )}
            </dl>
          </Panel>
          <SlaPanel ticket={x} />
          {mayManage && open && (
            <Panel title={t("su.assign")}>
              <ActionMessage action={assign} />
              <Field label={t("su.assignTo")}>
                <Select
                  id="ticket-assignee"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">—</option>
                  {(people.data ?? [])
                    .filter((p) => p.userId !== x.assigneeId)
                    .map((p) => (
                      <option key={p.userId} value={p.userId}>
                        {p.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Button
                busy={assign.busy}
                disabled={!assignee}
                onClick={() =>
                  assign
                    .run(
                      () =>
                        api.post(`/support/tickets/${x.id}/assign`, {
                          assigneeId: assignee,
                        }),
                      t("su.saved"),
                    )
                    .then(() => {
                      setAssignee("");
                      ticket.reload();
                    })
                }
              >
                {t("su.assign")}
              </Button>
            </Panel>
          )}
          {mayWork && open && (
            <Panel title={t("su.changePriority")}>
              <ActionMessage action={priority} />
              <Field label={t("su.priority")}>
                <Select
                  id="ticket-new-priority"
                  value={newPriority}
                  onChange={(e) =>
                    setNewPriority(e.target.value as TicketPriority)
                  }
                >
                  <option value="">—</option>
                  {TICKET_PRIORITIES.filter((p) => p !== x.priority).map(
                    (p) => (
                      <option key={p} value={p}>
                        {t(`su.priority.${p}`)}
                      </option>
                    ),
                  )}
                </Select>
              </Field>
              <TicketTextAction
                id="ticket-priority-reason"
                label={t("su.priorityReason")}
                submitLabel={t("su.changePriority")}
                onSubmit={(reason) =>
                  api.put(`/support/tickets/${x.id}/priority`, {
                    priority: newPriority,
                    reason,
                  })
                }
                onDone={() => {
                  setNewPriority("");
                  ticket.reload();
                }}
              />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
