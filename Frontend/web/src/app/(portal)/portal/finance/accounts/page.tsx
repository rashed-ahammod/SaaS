"use client";
/** Chart of accounts (tree), which account each automatic posting uses, and the months (close in order). */
import { useState, type FormEvent } from "react";
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
import { AccountSelect, useAccounts } from "@/components/portal/finance";
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
import type {
  Account,
  AccountType,
  Period,
  PostingAccount,
} from "@/lib/finance-types";
import { formatMonth } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Tab = "chart" | "posting" | "periods";

export default function AccountsPage() {
  const { t } = useI18n();
  const { company } = usePortal();
  const [tab, setTab] = useState<Tab>("chart");
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("f.a.title")} subtitle={company.legalName} />
      <Tabs<Tab>
        tabs={[
          { key: "chart", label: t("f.a.tab.chart") },
          { key: "posting", label: t("f.a.tab.posting") },
          { key: "periods", label: t("f.a.tab.periods") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "chart" && <Chart companyId={company.id} />}
      {tab === "posting" && <Posting companyId={company.id} />}
      {tab === "periods" && <Periods companyId={company.id} />}
    </div>
  );
}

function Chart({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const accounts = useAccounts(companyId);
  const [creating, setCreating] = useState(false);
  if (accounts.loading) return <Loading />;
  if (accounts.error)
    return <ErrorBox error={accounts.error} onRetry={accounts.reload} />;
  return (
    <Panel
      actions={
        can("ledger.setup") && (
          <Button onClick={() => setCreating(true)}>{t("f.a.new")}</Button>
        )
      }
    >
      <Table
        rows={accounts.data}
        rowKey={(a) => a.id}
        columns={[
          {
            key: "code",
            label: t("p.code"),
            render: (a) => <span className="font-mono text-xs">{a.code}</span>,
          },
          {
            key: "name",
            label: t("p.name"),
            render: (a) => (
              <span
                style={{ paddingLeft: `${a.depth * 1.25}rem` }}
                className={a.postable ? "" : "font-semibold text-slate-800"}
              >
                {lang === "bn" && a.nameBn ? a.nameBn : a.nameEn}
              </span>
            ),
          },
          {
            key: "type",
            label: t("f.v.type"),
            render: (a) => t(`f.a.type.${a.type}`),
          },
          {
            key: "flags",
            label: "",
            render: (a) =>
              !a.postable ? (
                <Badge>{t("f.a.group")}</Badge>
              ) : a.role ? (
                <Badge color="blue">{a.role}</Badge>
              ) : null,
          },
        ]}
      />
      {creating && (
        <NewAccount
          companyId={companyId}
          accounts={accounts.data ?? []}
          onClose={() => setCreating(false)}
          onDone={() => (setCreating(false), accounts.reload())}
        />
      )}
    </Panel>
  );
}

function NewAccount({
  companyId,
  accounts,
  onClose,
  onDone,
}: {
  companyId: string;
  accounts: Account[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    code: "",
    nameEn: "",
    nameBn: "",
    type: "expense" as AccountType,
    parentId: "",
  });
  const groups = accounts.filter((a) => !a.postable && a.type === f.type);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      code: f.code,
      nameEn: f.nameEn,
      type: f.type,
      ...(f.nameBn ? { nameBn: f.nameBn } : {}),
      ...(f.parentId ? { parentId: f.parentId } : {}),
    };
    if (
      await save.run(() => api.post(`/companies/${companyId}/accounts`, body))
    )
      onDone();
  }
  return (
    <Modal title={t("f.a.new")} open onClose={onClose}>
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("p.code")}>
            <Input
              required
              maxLength={20}
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
              id="account-code"
            />
          </Field>
          <Field label={t("f.v.type")}>
            <Select
              value={f.type}
              onChange={(e) =>
                setF({
                  ...f,
                  type: e.target.value as AccountType,
                  parentId: "",
                })
              }
              id="account-type"
            >
              {(
                ["asset", "liability", "equity", "income", "expense"] as const
              ).map((k) => (
                <option key={k} value={k}>
                  {t(`f.a.type.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("p.name")}>
          <Input
            required
            maxLength={150}
            value={f.nameEn}
            onChange={(e) => setF({ ...f, nameEn: e.target.value })}
            id="account-name"
          />
        </Field>
        <Field label={t("f.vd.nameBn")}>
          <Input
            maxLength={150}
            value={f.nameBn}
            onChange={(e) => setF({ ...f, nameBn: e.target.value })}
            id="account-name-bn"
          />
        </Field>
        <Field label={t("f.a.parent")}>
          <AccountSelect
            accounts={groups}
            value={f.parentId}
            onChange={(parentId) => setF({ ...f, parentId })}
            id="account-parent"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("p.create")}
        />
      </form>
    </Modal>
  );
}

function Posting({ companyId }: { companyId: string }) {
  const { t } = useI18n();
  const { can } = usePortal();
  const rows = useApi<PostingAccount[]>(
    `/companies/${companyId}/posting-accounts`,
  );
  const { postable } = useAccounts(companyId);
  const save = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  if (rows.loading) return <Loading />;
  if (rows.error) return <ErrorBox error={rows.error} onRetry={rows.reload} />;
  return (
    <Panel>
      <ActionMessage action={save} />
      <Table
        rows={rows.data}
        rowKey={(r) => r.key}
        columns={[
          {
            key: "key",
            label: t("f.a.key"),
            render: (r) => <span className="font-mono text-xs">{r.key}</span>,
          },
          {
            key: "account",
            label: t("f.v.account"),
            render: (r) =>
              editing === r.key ? (
                <div className="flex gap-2">
                  <AccountSelect
                    accounts={postable}
                    value={choice}
                    onChange={setChoice}
                    id={`posting-${r.key}`}
                  />
                  <Button
                    busy={save.busy}
                    onClick={() =>
                      save
                        .run(
                          () =>
                            api.put(
                              `/companies/${companyId}/posting-accounts`,
                              { key: r.key, accountId: choice },
                            ),
                          t("p.saved"),
                        )
                        .then((ok) => ok && (setEditing(null), rows.reload()))
                    }
                  >
                    {t("p.save")}
                  </Button>
                </div>
              ) : r.accountCode ? (
                `${r.accountCode} · ${r.accountName}`
              ) : (
                <Badge color="amber">—</Badge>
              ),
          },
          {
            key: "actions",
            label: "",
            render: (r) =>
              can("ledger.setup") && editing !== r.key ? (
                <button
                  className="text-sm font-medium text-emerald-800 hover:underline"
                  onClick={() => (
                    setEditing(r.key),
                    setChoice(r.accountId ?? "")
                  )}
                >
                  {t("f.a.change")}
                </button>
              ) : null,
          },
        ]}
      />
    </Panel>
  );
}

function Periods({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const periods = useApi<Period[]>(`/companies/${companyId}/periods`);
  const close = useAction();
  const [confirming, setConfirming] = useState<string | null>(null);
  if (periods.loading) return <Loading />;
  if (periods.error)
    return <ErrorBox error={periods.error} onRetry={periods.reload} />;
  return (
    <Panel>
      <ActionMessage action={close} />
      <Table
        rows={periods.data}
        rowKey={(p) => p.period}
        columns={[
          {
            key: "period",
            label: t("p.period"),
            render: (p) => formatMonth(p.period, lang),
          },
          {
            key: "state",
            label: t("p.status"),
            render: (p) => (
              <Badge color={p.state === "closed" ? "gray" : "green"}>
                {p.state === "closed" ? t("f.p.closed") : t("f.p.open")}
              </Badge>
            ),
          },
          {
            key: "actions",
            label: "",
            align: "right",
            render: (p) =>
              can("ledger.periods.close") && p.state === "open" ? (
                <button
                  className="text-sm font-medium text-emerald-800 hover:underline"
                  onClick={() => setConfirming(p.period)}
                >
                  {t("f.p.close")}
                </button>
              ) : null,
          },
        ]}
      />
      {confirming && (
        <Modal title={t("f.p.close")} open onClose={() => setConfirming(null)}>
          <p className="text-sm">
            {t("f.p.closeConfirm", { period: formatMonth(confirming, lang) })}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {t("p.cancel")}
            </Button>
            <Button
              variant="danger"
              busy={close.busy}
              onClick={() =>
                close
                  .run(
                    () =>
                      api.post(
                        `/companies/${companyId}/periods/${confirming}/close`,
                      ),
                    t("f.p.closedDone"),
                  )
                  .then(() => (setConfirming(null), periods.reload()))
              }
            >
              {t("f.p.close")}
            </Button>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
