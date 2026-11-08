"use client";
/**
 * Approvals: what waits for me (or for someone who delegated to me), what I sent and where it
 * stands, and my delegations (who approves for me while I am away). Chains: /portal/approvals/chains.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ActionMessage,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Table,
  Tabs,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dhakaToday, formatDate, formatTaka, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { CompanyApprovalRequest, InboxItem } from "@/lib/types";

type Tab = "waiting" | "mine" | "all" | "delegations";
interface MyRequest {
  id: string;
  requestType: string;
  summary: string;
  state: string;
  currentStep: number;
  amount: string | null;
  days: number | null;
  submittedAt: string;
  completedAt: string | null;
}
interface Delegation {
  id: string;
  fromUserId: string;
  toUserId: string;
  startsOn: string;
  endsOn: string;
  reason: string | null;
  revokedAt: string | null;
}
const REQUEST_STATE_COLOR: Record<string, "amber" | "green" | "gray" | "red"> =
  {
    in_approval: "amber",
    approved: "green",
    executed: "green",
    rejected: "red",
    returned: "amber",
    cancelled: "gray",
  };

export default function PortalApprovalsPage() {
  const { t } = useI18n();
  const { can } = usePortal();
  const [tab, setTab] = useState<Tab>("waiting");
  const seesAll = can("approvals.view_all");
  return (
    <div>
      <PageHeader
        title={t("p.nav.approvals")}
        actions={
          can("approvals.configure") && (
            <Link className="text-sm underline" href="/portal/approvals/chains">
              {t("ac.chains")}
            </Link>
          )
        }
      />
      <Tabs
        tabs={[
          { key: "waiting" as Tab, label: t("ac.waiting") },
          { key: "mine" as Tab, label: t("ac.mine") },
          ...(seesAll ? [{ key: "all" as Tab, label: t("ac.all") }] : []),
          { key: "delegations" as Tab, label: t("ac.delegations") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "waiting" && <Waiting />}
      {tab === "mine" && <Mine />}
      {tab === "all" && <Everything />}
      {tab === "delegations" && <Delegations />}
    </div>
  );
}

function Waiting() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const inbox = useApi<InboxItem[]>("/approvals/inbox");
  return (
    <Panel>
      {inbox.loading ? (
        <Loading />
      ) : inbox.error ? (
        <ErrorBox error={inbox.error} onRetry={inbox.reload} />
      ) : (
        <Table
          rows={inbox.data}
          rowKey={(i) => `${i.requestId}-${i.onBehalfOf ?? ""}`}
          empty={t("appr.empty")}
          onRowClick={(i) => router.push(`/portal/approvals/${i.requestId}`)}
          columns={[
            {
              key: "type",
              label: t("p.run.type"),
              render: (i) => (
                <Badge color="blue">{t(`appr.type.${i.requestType}`)}</Badge>
              ),
            },
            {
              key: "summary",
              label: t("appr.details"),
              render: (i) =>
                `${i.summary}${i.onBehalfOf ? ` · ${t("appr.onBehalf")}` : ""}`,
            },
            {
              key: "amount",
              label: t("p.amount"),
              align: "right",
              render: (i) =>
                i.amount
                  ? formatTaka(i.amount, lang)
                  : i.days
                    ? `${num(i.days, lang)} d`
                    : "",
            },
            {
              key: "step",
              label: "",
              render: (i) => t("appr.step", { n: num(i.step, lang) }),
            },
            {
              key: "submitted",
              label: t("p.date"),
              render: (i) =>
                formatDate(i.submittedAt.slice(0, 10), lang, { short: true }),
            },
            {
              key: "escalates",
              label: "",
              // the deadline was always printed in grey, whether it had passed or not
              render: (i) =>
                i.overdue ? (
                  <Badge color="red">{t("ac.allOverdue")}</Badge>
                ) : (
                  <span className="text-xs text-slate-500">
                    {t("appr.escalates", {
                      date: formatDate(i.escalationAt.slice(0, 10), lang, {
                        short: true,
                      }),
                    })}
                  </span>
                ),
            },
          ]}
        />
      )}
    </Panel>
  );
}

function Mine() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const mine = useApi<MyRequest[]>("/approvals/requests/mine");
  return (
    <Panel>
      {mine.error ? (
        <ErrorBox error={mine.error} onRetry={mine.reload} />
      ) : (
        <Table
          rows={mine.data}
          rowKey={(r) => r.id}
          empty={t("st.none")}
          onRowClick={(r) => router.push(`/portal/approvals/${r.id}`)}
          columns={[
            {
              key: "type",
              label: t("p.run.type"),
              render: (r) => (
                <Badge color="blue">{t(`appr.type.${r.requestType}`)}</Badge>
              ),
            },
            {
              key: "summary",
              label: t("appr.details"),
              render: (r) => r.summary,
            },
            {
              key: "amount",
              label: t("p.amount"),
              align: "right",
              render: (r) =>
                r.amount
                  ? formatTaka(r.amount, lang)
                  : r.days
                    ? `${num(r.days, lang)} d`
                    : "",
            },
            {
              key: "submitted",
              label: t("p.date"),
              render: (r) =>
                formatDate(r.submittedAt.slice(0, 10), lang, { short: true }),
            },
            {
              key: "state",
              label: t("cr.state"),
              render: (r) => (
                <Badge color={REQUEST_STATE_COLOR[r.state] ?? "gray"}>
                  {t(`ac.state.${r.state}`)}
                </Badge>
              ),
            },
          ]}
        />
      )}
    </Panel>
  );
}

/**
 * Every request of the company, for the holder of approvals.view_all. The one
 * question an Admin is asked about approvals is "what is stuck?", and until this
 * tab existed the permission could only open a request whose id you already had.
 */
function Everything() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company } = usePortal();
  const [filters, setFilters] = useState({
    requestType: "",
    open: true,
    overdue: false,
  });
  const query = new URLSearchParams({
    companyId: company?.id ?? "",
    ...(filters.requestType ? { requestType: filters.requestType } : {}),
    ...(filters.open ? { open: "true" } : {}),
    ...(filters.overdue ? { overdue: "true" } : {}),
  });
  const rows = useApi<CompanyApprovalRequest[]>(
    company ? `/approvals/requests?${query}` : null,
  );
  // the kinds actually in use, so the filter never offers an empty answer
  const types = [...new Set(rows.data?.map((r) => r.requestType) ?? [])].sort();

  return (
    <Panel
      actions={
        <>
          <Select
            aria-label={t("ac.allType")}
            value={filters.requestType}
            onChange={(e) =>
              setFilters({ ...filters, requestType: e.target.value })
            }
            id="all-type"
          >
            <option value="">{t("p.all")}</option>
            {types.map((x) => (
              <option key={x} value={x}>
                {t(`appr.type.${x}`, {}, x)}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={filters.open}
              onChange={(e) =>
                setFilters({ ...filters, open: e.target.checked })
              }
              id="all-open"
            />
            {t("ac.onlyOpen")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={filters.overdue}
              onChange={(e) =>
                setFilters({ ...filters, overdue: e.target.checked })
              }
              id="all-overdue"
            />
            {t("ac.onlyOverdue")}
          </label>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">{t("ac.allHint")}</p>
      {rows.error ? (
        <ErrorBox error={rows.error} onRetry={rows.reload} />
      ) : (
        <Table
          rows={rows.data}
          rowKey={(r) => r.id}
          empty={t("ac.allNone")}
          onRowClick={(r) => router.push(`/portal/approvals/${r.id}`)}
          columns={[
            {
              key: "type",
              label: t("p.run.type"),
              render: (r) => (
                <Badge color="blue">
                  {t(`appr.type.${r.requestType}`, {}, r.requestType)}
                </Badge>
              ),
            },
            {
              key: "summary",
              label: t("appr.details"),
              render: (r) => r.summary,
            },
            {
              key: "requester",
              label: t("ac.allRequester"),
              render: (r) => r.requesterName ?? "—",
            },
            {
              key: "amount",
              label: t("p.amount"),
              align: "right",
              render: (r) =>
                r.amount
                  ? formatTaka(r.amount, lang)
                  : r.days
                    ? `${num(r.days, lang)} d`
                    : "",
            },
            {
              key: "submitted",
              label: t("ac.allWaiting"),
              render: (r) =>
                formatDate(r.submittedAt.slice(0, 10), lang, { short: true }),
            },
            {
              key: "step",
              label: "",
              render: (r) =>
                r.state === "in_approval"
                  ? t("appr.step", { n: num(r.currentStep, lang) })
                  : "",
            },
            {
              key: "state",
              label: t("cr.state"),
              render: (r) => (
                <span className="flex flex-wrap items-center gap-1">
                  <Badge color={REQUEST_STATE_COLOR[r.state] ?? "gray"}>
                    {t(`ac.state.${r.state}`)}
                  </Badge>
                  {r.overdue && <Badge color="red">{t("ac.allOverdue")}</Badge>}
                </span>
              ),
            },
          ]}
        />
      )}
    </Panel>
  );
}

function Delegations() {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const list = useApi<Delegation[]>("/delegations");
  const users = useApi<Array<{ userId: string; name: string }>>(
    "/delegations/candidates",
  );
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const name = (id: string) => {
    const u = users.data?.find((x) => x.userId === id);
    return u ? u.name : id === me.id ? me.email : id.slice(0, 8);
  };
  return (
    <Panel
      actions={
        <Button onClick={() => setAdding(true)}>{t("ac.newDelegation")}</Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">{t("ac.delegationHint")}</p>
      <ActionMessage action={action} />
      {list.error ? (
        <ErrorBox error={list.error} onRetry={list.reload} />
      ) : (
        <Table
          rows={list.data}
          rowKey={(d) => d.id}
          empty={t("st.none")}
          columns={[
            {
              key: "who",
              label: "",
              render: (d) =>
                d.fromUserId === me.id ? (
                  <span>
                    {t("ac.given")} → {name(d.toUserId)}
                  </span>
                ) : (
                  <span>
                    {t("ac.received")} ← {name(d.fromUserId)}
                  </span>
                ),
            },
            {
              key: "from",
              label: t("ac.startsOn"),
              render: (d) => formatDate(d.startsOn, lang, { short: true }),
            },
            {
              key: "to",
              label: t("ac.endsOn"),
              render: (d) => formatDate(d.endsOn, lang, { short: true }),
            },
            {
              key: "reason",
              label: t("ac.reason"),
              render: (d) => d.reason ?? "",
            },
            {
              key: "act",
              label: "",
              align: "right",
              render: (d) =>
                d.revokedAt ? (
                  <Badge color="gray">{t("ac.revoked")}</Badge>
                ) : (
                  d.fromUserId === me.id && (
                    <Button
                      variant="ghost"
                      className="min-h-8 px-2 py-1 text-sm text-red-700"
                      onClick={() =>
                        action
                          .run(
                            () => api.post(`/delegations/${d.id}/revoke`),
                            t("p.done"),
                          )
                          .then(list.reload)
                      }
                    >
                      {t("ac.revoke")}
                    </Button>
                  )
                ),
            },
          ]}
        />
      )}
      {adding && (
        <DelegationDialog
          users={users.data ?? []}
          onClose={() => setAdding(false)}
          onDone={() => (setAdding(false), list.reload())}
        />
      )}
    </Panel>
  );
}

function DelegationDialog({
  users,
  onClose,
  onDone,
}: {
  users: Array<{ userId: string; name: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    toUserId: "",
    startsOn: dhakaToday(),
    endsOn: "",
    reason: "",
  });
  return (
    <Modal title={t("ac.newDelegation")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post("/delegations", {
                toUserId: f.toUserId,
                startsOn: f.startsOn,
                endsOn: f.endsOn,
                ...(f.reason ? { reason: f.reason } : {}),
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("ac.delegateTo")}>
          <Select
            required
            value={f.toUserId}
            onChange={(e) => setF({ ...f, toUserId: e.target.value })}
            id="delegate-to"
          >
            <option value="">—</option>
            {users.map((u) => (
              <option key={u.userId} value={u.userId}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("ac.startsOn")}>
            <Input
              required
              type="date"
              value={f.startsOn}
              onChange={(e) => setF({ ...f, startsOn: e.target.value })}
              id="delegate-from"
            />
          </Field>
          <Field label={t("ac.endsOn")}>
            <Input
              required
              type="date"
              min={f.startsOn}
              value={f.endsOn}
              onChange={(e) => setF({ ...f, endsOn: e.target.value })}
              id="delegate-until"
            />
          </Field>
        </div>
        <Field label={t("ac.reason")}>
          <Input
            maxLength={500}
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
            id="delegate-reason"
            placeholder="Annual leave, 3-12 Nov"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("ac.newDelegation")}
        />
      </form>
    </Modal>
  );
}
