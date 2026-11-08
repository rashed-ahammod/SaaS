"use client";
/**
 * CRM pieces of the portal (Phase 3 WP23):
 *   LeadDialog, CustomerDialog       new lead / customer
 *   ActivityTimeline                 calls, meetings, notes, tasks; log one; tick a task
 *   QualifyDialog, DisqualifyDialog, AssignDialog   the lead's next steps (qualify may open an opportunity, WP24)
 *   ContactDialog, CreditDialog      a customer's contacts; Accounts' credit terms
 *   MyTasks                          the salesperson's open tasks
 */
import Link from "next/link";
import { useState } from "react";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Select,
  TextArea,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import {
  CUSTOMER_TYPES,
  DISTRICTS,
  LEAD_SOURCES,
  type Activity,
  type Customer,
  type Lead,
  type Salesperson,
} from "@/lib/crm-types";
import { dhakaToday, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { ActionMessage, FormButtons, Modal, Panel, useAction } from "./kit";
import {
  emptyOpportunity,
  OpportunityFields,
  opportunityBody,
} from "./opportunities";

export function DistrictSelect({
  value,
  onChange,
  id,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  required?: boolean;
}) {
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      id={id}
      required={required}
    >
      <option value="">—</option>
      {DISTRICTS.map((d) => (
        <option key={d} value={d}>
          {d}
        </option>
      ))}
    </Select>
  );
}

export function SalespersonSelect({
  companyId,
  value,
  onChange,
  id,
  allowAuto,
}: {
  companyId: string;
  value: string;
  onChange: (v: string) => void;
  id: string;
  allowAuto?: string;
}) {
  const people = useApi<Salesperson[]>(`/companies/${companyId}/salespeople`);
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      id={id}
      required={!allowAuto}
    >
      <option value="">{allowAuto ?? "—"}</option>
      {people.data?.map((p) => (
        <option key={p.userId} value={p.userId}>
          {p.name}
          {p.employeeCode ? ` (${p.employeeCode})` : ""}
        </option>
      ))}
    </Select>
  );
}

/** "Already known as ..." from a 409 CRM_DUPLICATE */
function useDuplicateText() {
  const { t } = useI18n();
  return (details: unknown) => {
    const e = (
      details as
        | {
            existing?: {
              type: string;
              number?: string;
              code?: string;
              name?: string;
            };
          }
        | undefined
    )?.existing;
    return e
      ? t("cr.duplicate", {
          what: [
            e.type === "lead"
              ? `${t("cr.leads")} ${e.number}`
              : `${t("cr.customers")} ${e.code}`,
            e.name,
          ]
            .filter(Boolean)
            .join(" · "),
        })
      : null;
  };
}

export function LeadDialog({
  companyId,
  canChooseOwner,
  onClose,
  onDone,
}: {
  companyId: string;
  canChooseOwner: boolean;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const dupText = useDuplicateText();
  const [dup, setDup] = useState<string | null>(null);
  const [f, setF] = useState({
    name: "",
    organisation: "",
    phone: "",
    email: "",
    district: "",
    source: "walk_in",
    sourceDetail: "",
    message: "",
    ownerId: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={t("cr.newLead")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setDup(null);
          const body = Object.fromEntries(
            Object.entries(f).filter(([, v]) => v !== ""),
          );
          try {
            const r = await api.post<{ id: string }>(
              `/companies/${companyId}/leads`,
              body,
            );
            onDone(r.id);
          } catch (err) {
            const text = dupText((err as { details?: unknown }).details);
            if (text) setDup(text);
            else await save.run(() => Promise.reject(err));
          }
        }}
      >
        <ActionMessage action={save} />
        {dup && (
          <p
            className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
            role="alert"
          >
            {dup}
          </p>
        )}
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("cr.name")}>
            <Input
              required
              maxLength={200}
              value={f.name}
              onChange={set("name")}
              id="lead-name"
            />
          </Field>
          <Field label={t("cr.organisation")}>
            <Input
              maxLength={200}
              value={f.organisation}
              onChange={set("organisation")}
              id="lead-org"
            />
          </Field>
          <Field label={t("cr.phone")}>
            <Input
              inputMode="tel"
              maxLength={40}
              value={f.phone}
              onChange={set("phone")}
              id="lead-phone"
              placeholder="01711-223344"
            />
          </Field>
          <Field label={t("cr.email")}>
            <Input
              type="email"
              maxLength={200}
              value={f.email}
              onChange={set("email")}
              id="lead-email"
            />
          </Field>
          <Field label={t("cr.district")}>
            <DistrictSelect
              value={f.district}
              onChange={(district) => setF({ ...f, district })}
              id="lead-district"
            />
          </Field>
          <Field label={t("cr.source")}>
            <Select value={f.source} onChange={set("source")} id="lead-source">
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`cr.source.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("cr.sourceDetail")}>
            <Input
              maxLength={200}
              value={f.sourceDetail}
              onChange={set("sourceDetail")}
              id="lead-source-detail"
            />
          </Field>
          {canChooseOwner && (
            <Field label={t("cr.owner")}>
              <SalespersonSelect
                companyId={companyId}
                value={f.ownerId}
                onChange={(ownerId) => setF({ ...f, ownerId })}
                id="lead-owner"
                allowAuto={t("cr.ownerAuto")}
              />
            </Field>
          )}
        </div>
        <Field label={t("cr.message")}>
          <TextArea
            maxLength={4000}
            rows={3}
            value={f.message}
            onChange={set("message")}
            id="lead-message"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cr.newLead")}
        />
      </form>
    </Modal>
  );
}

function CustomerFields({
  f,
  setF,
}: {
  f: Record<string, string>;
  setF: (f: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-x-3 sm:grid-cols-2">
      <Field label={t("cr.name")}>
        <Input
          required
          maxLength={200}
          value={f.name}
          onChange={set("name")}
          id="cust-name"
        />
      </Field>
      <Field label={t("cr.kindOfCustomer")}>
        <Select value={f.kind} onChange={set("kind")} id="cust-kind">
          <option value="company">{t("cr.kind.company")}</option>
          <option value="person">{t("cr.kind.person")}</option>
        </Select>
      </Field>
      <Field label={t("cr.customerType")}>
        <Select
          value={f.customerType}
          onChange={set("customerType")}
          id="cust-type"
        >
          {CUSTOMER_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`cr.type.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("cr.bin")}>
        <Input
          pattern="[0-9]{9}-?[0-9]{4}"
          value={f.bin}
          onChange={set("bin")}
          id="cust-bin"
          placeholder="000123456-0101"
        />
      </Field>
      <Field label={t("cr.phone")}>
        <Input
          inputMode="tel"
          maxLength={40}
          value={f.phone}
          onChange={set("phone")}
          id="cust-phone"
        />
      </Field>
      <Field label={t("cr.email")}>
        <Input
          type="email"
          maxLength={200}
          value={f.email}
          onChange={set("email")}
          id="cust-email"
        />
      </Field>
      <Field label={t("cr.district")}>
        <DistrictSelect
          value={f.district}
          onChange={(district) => setF({ ...f, district })}
          id="cust-district"
        />
      </Field>
      <Field label={t("cr.address")}>
        <Input
          maxLength={500}
          value={f.address}
          onChange={set("address")}
          id="cust-address"
        />
      </Field>
    </div>
  );
}

const emptyCustomer = () => ({
  kind: "company",
  name: "",
  customerType: "retail",
  bin: "",
  phone: "",
  email: "",
  district: "",
  address: "",
});
const only = (f: Record<string, string>) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));

export function CustomerDialog({
  companyId,
  onClose,
  onDone,
}: {
  companyId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState<Record<string, string>>(emptyCustomer());
  return (
    <Modal title={t("cr.newCustomerBtn")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const c = await save.run(() =>
            api.post<{ id: string }>(
              `/companies/${companyId}/customers`,
              only(f),
            ),
          );
          if (c && typeof c === "object") onDone(c.id);
        }}
      >
        <ActionMessage action={save} />
        <CustomerFields f={f} setF={setF} />
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cr.newCustomerBtn")}
        />
      </form>
    </Modal>
  );
}

export function QualifyDialog({
  lead,
  companyId,
  onClose,
  onDone,
}: {
  lead: Lead;
  companyId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [f, setF] = useState<Record<string, string>>({
    ...emptyCustomer(),
    name: lead.organisation ?? lead.name,
    kind: lead.organisation ? "company" : "person",
    district: lead.district ?? "",
  });
  const [customerId, setCustomerId] = useState("");
  const customers = useApi<Customer[]>(
    mode === "existing" ? `/companies/${companyId}/customers` : null,
  );
  const [withOpp, setWithOpp] = useState(false);
  const [opp, setOpp] = useState<Record<string, string>>(emptyOpportunity());
  return (
    <Modal
      title={`${t("cr.qualify")}: ${lead.number}`}
      open
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            ...(mode === "existing" ? { customerId } : { customer: only(f) }),
            ...(withOpp ? { opportunity: opportunityBody(opp) } : {}),
          };
          if (await save.run(() => api.post(`/leads/${lead.id}/qualify`, body)))
            onDone();
        }}
      >
        <p className="mb-3 text-sm text-slate-600">{t("cr.qualifyHint")}</p>
        <ActionMessage action={save} />
        <div className="mb-3 flex gap-4 text-sm">
          {(["new", "existing"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input
                type="radio"
                name="qualify-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />{" "}
              {t(m === "new" ? "cr.newCustomer" : "cr.existingCustomer")}
            </label>
          ))}
        </div>
        {mode === "new" ? (
          <CustomerFields f={f} setF={setF} />
        ) : (
          <Field label={t("cr.customers")}>
            <Select
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              id="qualify-customer"
            >
              <option value="">—</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <label className="mb-3 mt-2 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={withOpp}
            onChange={(e) => setWithOpp(e.target.checked)}
            id="qualify-opportunity"
          />{" "}
          {t("cr.openOpportunity")}
        </label>
        {withOpp && (
          <OpportunityFields companyId={companyId} f={opp} setF={setOpp} />
        )}
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cr.qualify")}
        />
      </form>
    </Modal>
  );
}

export function ReasonDialog({
  title,
  path,
  onClose,
  onDone,
}: {
  title: string;
  path: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal title={title} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save.run(() => api.post(path, { reason }))) onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("cr.reason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="reason"
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} submitLabel={title} />
      </form>
    </Modal>
  );
}

export function AssignDialog({
  companyId,
  path,
  onClose,
  onDone,
}: {
  companyId: string;
  path: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({ ownerId: "", note: "" });
  return (
    <Modal title={t("cr.assign")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save.run(() => api.post(path, only(f)))) onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("cr.assignTo")}>
          <SalespersonSelect
            companyId={companyId}
            value={f.ownerId}
            onChange={(ownerId) => setF({ ...f, ownerId })}
            id="assign-to"
          />
        </Field>
        <Field label={t("cr.note")}>
          <Input
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="assign-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cr.assign")}
        />
      </form>
    </Modal>
  );
}

export function ContactDialog({
  customerId,
  onClose,
  onDone,
}: {
  customerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    name: "",
    designation: "",
    phone: "",
    email: "",
    isPrimary: false,
  });
  return (
    <Modal title={t("cr.addContact")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            ...only({
              name: f.name,
              designation: f.designation,
              phone: f.phone,
              email: f.email,
            }),
            isPrimary: f.isPrimary,
          };
          if (
            await save.run(() =>
              api.post(`/customers/${customerId}/contacts`, body),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("cr.name")}>
          <Input
            required
            maxLength={200}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            id="contact-name"
          />
        </Field>
        <Field label={t("cr.designation")}>
          <Input
            maxLength={100}
            value={f.designation}
            onChange={(e) => setF({ ...f, designation: e.target.value })}
            id="contact-designation"
          />
        </Field>
        <Field label={t("cr.phone")}>
          <Input
            inputMode="tel"
            maxLength={40}
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
            id="contact-phone"
          />
        </Field>
        <Field label={t("cr.email")}>
          <Input
            type="email"
            maxLength={200}
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            id="contact-email"
          />
        </Field>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.isPrimary}
            onChange={(e) => setF({ ...f, isPrimary: e.target.checked })}
            id="contact-primary"
          />{" "}
          {t("cr.primary")}
        </label>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cr.addContact")}
        />
      </form>
    </Modal>
  );
}

export function CreditDialog({
  customer,
  onClose,
  onDone,
}: {
  customer: Customer;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    creditLimit: String(Number(customer.creditLimit)),
    paymentTermsDays: String(customer.paymentTermsDays),
  });
  return (
    <Modal
      title={`${t("cr.setCredit")}: ${customer.name}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.put(`/customers/${customer.id}/credit`, {
                version: customer.version,
                creditLimit: f.creditLimit,
                paymentTermsDays: Number(f.paymentTermsDays),
              }),
            )
          )
            onDone();
        }}
      >
        <p className="mb-3 text-sm text-slate-600">{t("cr.creditHint")}</p>
        <ActionMessage action={save} />
        <Field label={t("cr.creditLimit")}>
          <Input
            required
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            value={f.creditLimit}
            onChange={(e) => setF({ ...f, creditLimit: e.target.value })}
            id="credit-limit"
          />
        </Field>
        <Field label={t("cr.paymentTerms")}>
          <Input
            required
            type="number"
            min={0}
            max={365}
            value={f.paymentTermsDays}
            onChange={(e) => setF({ ...f, paymentTermsDays: e.target.value })}
            id="credit-days"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cr.setCredit")}
        />
      </form>
    </Modal>
  );
}

export function ActivityTimeline({
  activities,
  postPath,
  canWork,
  onChanged,
}: {
  activities: Activity[];
  postPath: string;
  canWork: boolean;
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    kind: "call",
    subject: "",
    body: "",
    dueOn: dhakaToday(),
  });
  return (
    <Panel title={t("cr.activities")}>
      {canWork && (
        <form
          className="mb-4 grid gap-x-3 sm:grid-cols-[8rem_1fr_9rem_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = {
              kind: f.kind,
              subject: f.subject,
              ...(f.body ? { body: f.body } : {}),
              ...(f.kind === "task" ? { dueOn: f.dueOn } : {}),
            };
            if (await save.run(() => api.post(postPath, body))) {
              setF({ ...f, subject: "", body: "" });
              onChanged();
            }
          }}
        >
          <Field label={t("cr.kind")}>
            <Select
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value })}
              id="activity-kind"
            >
              {(
                ["call", "meeting", "note", "task", "email", "sms"] as const
              ).map((k) => (
                <option key={k} value={k}>
                  {t(`cr.kind.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("cr.subject")}>
            <Input
              required
              maxLength={200}
              value={f.subject}
              onChange={(e) => setF({ ...f, subject: e.target.value })}
              id="activity-subject"
            />
          </Field>
          {f.kind === "task" ? (
            <Field label={t("cr.dueOn")}>
              <Input
                type="date"
                value={f.dueOn}
                onChange={(e) => setF({ ...f, dueOn: e.target.value })}
                id="activity-due"
              />
            </Field>
          ) : (
            <span />
          )}
          <Button className="mb-3 self-end" type="submit" busy={save.busy}>
            {t("cr.logActivity")}
          </Button>
          <div className="sm:col-span-4">
            <Field label={t("cr.details")}>
              <TextArea
                rows={2}
                maxLength={4000}
                value={f.body}
                onChange={(e) => setF({ ...f, body: e.target.value })}
                id="activity-body"
              />
            </Field>
          </div>
        </form>
      )}
      <ActionMessage action={save} />
      {!activities.length ? (
        <p className="text-sm text-slate-500">{t("st.none")}</p>
      ) : (
        <ol className="space-y-3">
          {activities.map((a) => (
            <li key={a.id} className="border-l-2 border-slate-200 pl-3">
              <p className="text-sm">
                <Badge
                  color={
                    a.kind === "enquiry"
                      ? "amber"
                      : a.kind === "task"
                        ? a.doneAt
                          ? "green"
                          : "blue"
                        : "gray"
                  }
                >
                  {t(`cr.kind.${a.kind}`)}
                </Badge>{" "}
                <span className="font-medium">{a.subject}</span>
                {a.kind === "task" && a.dueAt && (
                  <span className="text-slate-500">
                    {" "}
                    · {t("cr.dueOn")}{" "}
                    {formatDate(a.dueAt.slice(0, 10), lang, { short: true })}
                  </span>
                )}
                {a.kind === "task" && !a.doneAt && canWork && (
                  <Button
                    variant="ghost"
                    className="ml-2 min-h-7 px-2 py-0.5 text-xs"
                    onClick={() =>
                      save
                        .run(() => api.post(`/crm-activities/${a.id}/done`))
                        .then((r) => r && onChanged())
                    }
                  >
                    {t("cr.markDone")}
                  </Button>
                )}
              </p>
              {a.body && (
                <p className="whitespace-pre-line text-sm text-slate-700">
                  {a.body}
                </p>
              )}
              <p className="text-xs text-slate-500">
                {formatDate(a.createdAt.slice(0, 10), lang, { short: true })}
                {a.byName ? ` · ${a.byName}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export function MyTasks({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const tasks = useApi<Activity[]>(`/companies/${companyId}/crm/my-tasks`);
  const action = useAction();
  if (tasks.error)
    return <ErrorBox error={tasks.error} onRetry={tasks.reload} />;
  const today = dhakaToday();
  return (
    <Panel title={t("cr.myTasks")}>
      <ActionMessage action={action} />
      {!tasks.data?.length ? (
        <p className="text-sm text-slate-500">{t("cr.noTasks")}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {tasks.data.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-2">
              <span>
                <span
                  className={`block font-medium ${a.dueAt && a.dueAt.slice(0, 10) < today ? "text-red-700" : ""}`}
                >
                  {a.subject}
                </span>
                <span className="block text-xs text-slate-500">
                  {a.dueAt
                    ? formatDate(a.dueAt.slice(0, 10), lang, { short: true })
                    : ""}
                  {a.leadId && (
                    <>
                      {" "}
                      ·{" "}
                      <Link
                        className="underline"
                        href={`/portal/crm/leads/${a.leadId}`}
                      >
                        {a.lead}
                      </Link>
                    </>
                  )}
                  {!a.leadId && a.customerId && (
                    <>
                      {" "}
                      ·{" "}
                      <Link
                        className="underline"
                        href={`/portal/crm/customers/${a.customerId}`}
                      >
                        {a.customer}
                      </Link>
                    </>
                  )}
                </span>
              </span>
              <Button
                variant="ghost"
                className="min-h-7 shrink-0 px-2 py-0.5 text-xs"
                onClick={() =>
                  action
                    .run(() => api.post(`/crm-activities/${a.id}/done`))
                    .then((r) => r && tasks.reload())
                }
              >
                {t("cr.markDone")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
