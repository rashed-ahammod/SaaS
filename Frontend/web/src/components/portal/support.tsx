"use client";
/**
 * Support pieces shared by the ticket screens (Phase 3 WP28):
 *   PriorityBadge / StateBadge  the two things a service desk reads first
 *   SlaPanel                    the two clocks: what was met, what was missed
 *   TicketThread                replies to the customer and internal notes, told apart
 *   NewTicketDialog             raise a ticket for a customer
 *   TicketTextAction            one short form (reply, note, question, resolution, reason)
 */
import { useState } from "react";
import {
  ActionMessage,
  Detail,
  FormButtons,
  Modal,
  Panel,
  useAction,
} from "@/components/portal/kit";
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Select,
  TextArea,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { Customer } from "@/lib/crm-types";
import { useI18n } from "@/lib/i18n";
import {
  PRIORITY_COLOR,
  TICKET_PRIORITIES,
  TICKET_SOURCES,
  TICKET_STATE_COLOR,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
  type TicketState,
} from "@/lib/support-types";

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const { t } = useI18n();
  return (
    <Badge color={PRIORITY_COLOR[priority]}>
      {t(`su.priority.${priority}`)}
    </Badge>
  );
}

export function StateBadge({ state }: { state: TicketState }) {
  const { t } = useI18n();
  return (
    <Badge color={TICKET_STATE_COLOR[state]}>{t(`su.state.${state}`)}</Badge>
  );
}

/** Date and time in Dhaka, in the reader's language. */
export function useWhen() {
  const { lang } = useI18n();
  return (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(lang === "bn" ? "bn-BD" : "en-GB", {
          timeZone: "Asia/Dhaka",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(iso))
      : "—";
}

export function SlaPanel({ ticket }: { ticket: Ticket }) {
  const { t } = useI18n();
  const when = useWhen();
  const answered = ticket.sla.firstResponseAt;
  return (
    <Panel title={t("su.sla")}>
      <p className="mb-3 text-xs text-slate-500">{t("su.slaHint")}</p>
      <dl className="grid gap-3">
        <Detail label={t("su.firstResponse")}>
          {answered
            ? t("su.answeredAt", { when: when(answered) })
            : t("su.dueBy", { when: when(ticket.sla.firstResponseDueAt) })}{" "}
          {ticket.sla.firstResponseBreached ? (
            <Badge color="red">{t("su.missed")}</Badge>
          ) : answered ? (
            <Badge color="green">{t("su.onTime")}</Badge>
          ) : null}
        </Detail>
        <Detail label={t("su.resolution")}>
          {ticket.resolvedAt
            ? when(ticket.resolvedAt)
            : t("su.dueBy", { when: when(ticket.sla.resolutionDueAt) })}{" "}
          {ticket.sla.resolutionBreached ? (
            <Badge color="red">{t("su.missed")}</Badge>
          ) : ticket.resolvedAt ? (
            <Badge color="green">{t("su.onTime")}</Badge>
          ) : null}
        </Detail>
        {ticket.sla.waitingSince && (
          <Detail label={t("su.state.waiting_customer")}>
            {t("su.waitingSince", { when: when(ticket.sla.waitingSince) })}
          </Detail>
        )}
        {ticket.reopenedCount > 0 && (
          <Detail label={t("su.reopen")}>
            {t("su.reopened", { n: ticket.reopenedCount })}
          </Detail>
        )}
      </dl>
    </Panel>
  );
}

const KIND_LABEL = {
  reply: "su.reply",
  note: "su.note",
  customer: "su.customerSaid",
} as const;

export function TicketThread({ ticket }: { ticket: Ticket }) {
  const { t } = useI18n();
  const when = useWhen();
  return (
    <Panel title={t("su.thread")}>
      <ol className="space-y-3">
        <li className="border-l-2 border-slate-300 pl-3">
          <p className="text-xs text-slate-500">
            <Badge color="gray">{t("su.description")}</Badge>{" "}
            {when(ticket.createdAt)}
          </p>
          <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
        </li>
        {ticket.messages.map((m) => (
          <li
            key={m.id}
            className={`border-l-2 pl-3 ${
              m.kind === "note" ? "border-amber-300" : "border-sky-300"
            }`}
          >
            <p className="text-xs text-slate-500">
              <Badge color={m.kind === "note" ? "amber" : "blue"}>
                {t(KIND_LABEL[m.kind])}
              </Badge>{" "}
              {when(m.at)}
            </p>
            <p className="whitespace-pre-wrap text-sm">{m.body}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function NewTicketDialog({
  companyId,
  customerId,
  onClose,
  onDone,
}: {
  companyId: string;
  /** Set when the ticket is raised from a customer's own page. */
  customerId?: string;
  onClose: () => void;
  onDone: (ticketId: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const categories = useApi<{ categories: TicketCategory[] }>(
    `/companies/${companyId}/support/categories`,
  );
  const customers = useApi<Customer[]>(
    customerId ? null : `/companies/${companyId}/customers`,
  );
  const [f, setF] = useState({
    customerId: customerId ?? "",
    categoryId: "",
    subject: "",
    description: "",
    priority: "",
    source: "phone",
  });
  return (
    <Modal title={t("su.newTicket")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const ticket = await save.run(() =>
            api.post<Ticket>(`/companies/${companyId}/support/tickets`, {
              customerId: f.customerId,
              categoryId: f.categoryId,
              subject: f.subject,
              description: f.description,
              source: f.source,
              ...(f.priority ? { priority: f.priority } : {}),
            }),
          );
          if (ticket && typeof ticket === "object") onDone(ticket.id);
        }}
      >
        <ActionMessage action={save} />
        {!customerId && (
          <Field label={t("su.customer")}>
            <Select
              required
              id="ticket-customer"
              value={f.customerId}
              onChange={(e) => setF({ ...f, customerId: e.target.value })}
            >
              <option value="">—</option>
              {(customers.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t("su.category")}>
          <Select
            required
            id="ticket-category"
            value={f.categoryId}
            onChange={(e) => setF({ ...f, categoryId: e.target.value })}
          >
            <option value="">—</option>
            {(categories.data?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("su.subject")}>
          <Input
            required
            maxLength={200}
            id="ticket-subject"
            value={f.subject}
            onChange={(e) => setF({ ...f, subject: e.target.value })}
          />
        </Field>
        <Field label={t("su.description")} hint={t("su.descriptionHint")}>
          <TextArea
            required
            rows={4}
            maxLength={4000}
            id="ticket-description"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("su.source")}>
            <Select
              id="ticket-source"
              value={f.source}
              onChange={(e) => setF({ ...f, source: e.target.value })}
            >
              {TICKET_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`su.source.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("su.priority")}>
            <Select
              id="ticket-priority"
              value={f.priority}
              onChange={(e) => setF({ ...f, priority: e.target.value })}
            >
              <option value="">{t("su.defaultPriority")}</option>
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`su.priority.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("su.newTicket")}
        />
      </form>
    </Modal>
  );
}

/** One short form and its button: a reply, an internal note, a question, a resolution, a reason. */
export function TicketTextAction({
  id,
  label,
  hint,
  submitLabel,
  onSubmit,
  onDone,
}: {
  id: string;
  label: string;
  hint?: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [text, setText] = useState("");
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const done = await save.run(
          () => onSubmit(text.trim()),
          t("su.saved"),
        );
        if (done) {
          setText("");
          onDone();
        }
      }}
    >
      <ActionMessage action={save} />
      <Field label={label} hint={hint}>
        <TextArea
          required
          rows={3}
          maxLength={4000}
          id={id}
          placeholder={t("su.messagePlaceholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" busy={save.busy} disabled={!text.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function ClosedNotice() {
  const { t } = useI18n();
  return <Alert kind="info">{t("su.closedNoReplies")}</Alert>;
}
