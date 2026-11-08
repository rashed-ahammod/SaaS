"use client";
/**
 * Accounts: claims to pay, all claims, cash advances (pay out, cash returned, recover from salary),
 * salary advances to pay out (approved loans), the advances sub-ledger, categories.
 */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AdvanceBadge, ClaimBadge } from "@/components/expenses";
import { AccountSelect, Taka, useAccounts } from "@/components/portal/finance";
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
import type { Loan } from "@/components/portal/employee-payroll";
import type {
  AdvanceBalances,
  AdvanceSummary,
  ClaimSummary,
  ExpenseCategory,
} from "@/lib/expense-types";
import { addMonths, dhakaToday, formatDate, formatMonth } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Tab =
  "toPay" | "claims" | "advances" | "loans" | "balances" | "categories";

export default function ExpensesPage() {
  const { t } = useI18n();
  const { company } = usePortal();
  const [tab, setTab] = useState<Tab>("toPay");
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("x.p.title")} subtitle={company.legalName} />
      <Tabs<Tab>
        tabs={[
          { key: "toPay", label: t("x.p.tab.toPay") },
          { key: "claims", label: t("x.p.tab.claims") },
          { key: "advances", label: t("x.p.tab.advances") },
          { key: "loans", label: t("py.loan.toPay") },
          { key: "balances", label: t("x.p.tab.balances") },
          { key: "categories", label: t("x.p.tab.categories") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "toPay" && <Claims companyId={company.id} state="approved" />}
      {tab === "claims" && <Claims companyId={company.id} />}
      {tab === "advances" && <Advances companyId={company.id} />}
      {tab === "loans" && <SalaryAdvances companyId={company.id} />}
      {tab === "balances" && <Balances companyId={company.id} />}
      {tab === "categories" && <Categories companyId={company.id} />}
    </div>
  );
}

function Claims({ companyId, state }: { companyId: string; state?: string }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const claims = useApi<ClaimSummary[]>(
    `/companies/${companyId}/expense-claims${state ? `?state=${state}` : ""}`,
  );
  if (claims.loading && !claims.data) return <Loading />;
  if (claims.error)
    return <ErrorBox error={claims.error} onRetry={claims.reload} />;
  return (
    <Panel>
      <Table
        rows={claims.data?.filter((c) => c.state !== "draft" || !state)}
        rowKey={(c) => c.id}
        onRowClick={(c) => router.push(`/portal/expenses/claims/${c.id}`)}
        columns={[
          {
            key: "number",
            label: t("f.v.number"),
            render: (c) => (
              <span className="font-mono text-xs">{c.number}</span>
            ),
          },
          {
            key: "employee",
            label: t("p.employee"),
            render: (c) => `${c.employeeCode} · ${c.employeeName}`,
          },
          {
            key: "title",
            label: t("x.newTitle"),
            render: (c) => <span className="line-clamp-2">{c.title}</span>,
          },
          {
            key: "date",
            label: t("p.date"),
            render: (c) =>
              formatDate((c.submittedAt ?? c.createdAt).slice(0, 10), lang, {
                short: true,
              }),
          },
          {
            key: "state",
            label: t("p.status"),
            render: (c) => <ClaimBadge state={c.state} />,
          },
          {
            key: "total",
            label: t("x.total"),
            align: "right",
            render: (c) => <Taka value={c.total} />,
          },
          {
            key: "payable",
            label: t("x.payable"),
            align: "right",
            render: (c) =>
              ["approved", "paid"].includes(c.state) ? (
                <Taka value={c.payable} />
              ) : (
                ""
              ),
          },
        ]}
      />
    </Panel>
  );
}

type AdvanceAction = {
  kind: "payout" | "refund" | "recover";
  advance: AdvanceSummary;
};

function Advances({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const advances = useApi<AdvanceSummary[]>(
    `/companies/${companyId}/expense-advances`,
  );
  const [acting, setActing] = useState<AdvanceAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (advances.loading && !advances.data) return <Loading />;
  if (advances.error)
    return <ErrorBox error={advances.error} onRetry={advances.reload} />;
  return (
    <Panel>
      {notice && (
        <p className="mb-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      <Table
        rows={advances.data}
        rowKey={(a) => a.id}
        columns={[
          {
            key: "number",
            label: t("f.v.number"),
            render: (a) => (
              <span className="font-mono text-xs">{a.number}</span>
            ),
          },
          {
            key: "employee",
            label: t("p.employee"),
            render: (a) => `${a.employeeCode} · ${a.employeeName}`,
          },
          {
            key: "purpose",
            label: t("x.purpose"),
            render: (a) => <span className="line-clamp-2">{a.purpose}</span>,
          },
          {
            key: "needed",
            label: t("x.neededBy"),
            render: (a) =>
              a.neededBy ? formatDate(a.neededBy, lang, { short: true }) : "",
          },
          {
            key: "state",
            label: t("p.status"),
            render: (a) => <AdvanceBadge state={a.state} />,
          },
          {
            key: "amount",
            label: t("p.amount"),
            align: "right",
            render: (a) => <Taka value={a.amount} />,
          },
          {
            key: "open",
            label: t("x.open"),
            align: "right",
            render: (a) => (a.state === "paid" ? <Taka value={a.open} /> : ""),
          },
          {
            key: "actions",
            label: "",
            align: "right",
            render: (a) =>
              !can("expenses.pay") ? null : a.state === "approved" &&
                !a.voucherId ? (
                <Button
                  variant="secondary"
                  onClick={() => setActing({ kind: "payout", advance: a })}
                >
                  {t("x.p.payout")}
                </Button>
              ) : a.state === "paid" && Number(a.open) > 0 ? (
                <span className="flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    onClick={() => setActing({ kind: "refund", advance: a })}
                  >
                    {t("x.p.refund")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setActing({ kind: "recover", advance: a })}
                  >
                    {t("x.p.recover")}
                  </Button>
                </span>
              ) : null,
          },
        ]}
      />
      {acting && (
        <AdvanceDialog
          companyId={companyId}
          action={acting}
          onClose={() => setActing(null)}
          onDone={(text) => {
            setActing(null);
            setNotice(text);
            advances.reload();
          }}
        />
      )}
    </Panel>
  );
}

function AdvanceDialog({
  companyId,
  action,
  onClose,
  onDone,
}: {
  companyId: string;
  action: AdvanceAction;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const { postable } = useAccounts(companyId);
  const a = action.advance;
  const [f, setF] = useState({
    method: "cash",
    accountId: "",
    date: dhakaToday(),
    amount: a.open,
    installment: "",
    firstPeriod: addMonths(dhakaToday().slice(0, 7), 1),
  });
  const money = (x: { role: string | null }) =>
    x.role === "cash" || x.role === "bank";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const done =
      action.kind === "payout"
        ? await save.run(() =>
            api.post(`/expense-advances/${a.id}/payout`, {
              method: f.method,
              paidFromAccountId: f.accountId,
              paymentDate: f.date,
            }),
          )
        : action.kind === "refund"
          ? await save.run(() =>
              api.post(`/expense-advances/${a.id}/refund`, {
                amount: f.amount,
                receivedIntoAccountId: f.accountId,
                date: f.date,
              }),
            )
          : await save.run(() =>
              api.post(`/expense-advances/${a.id}/recover-from-salary`, {
                installment: f.installment,
                firstPeriod: f.firstPeriod,
              }),
            );
    if (done) onDone(action.kind === "recover" ? t("x.p.done") : t("x.p.sent"));
  }

  const title =
    action.kind === "payout"
      ? t("x.p.payout")
      : action.kind === "refund"
        ? t("x.p.refund")
        : t("x.p.recover");
  return (
    <Modal title={`${title}: ${a.number}`} open onClose={onClose}>
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <p className="mb-3 text-sm text-slate-600">
          {a.employeeName} · {a.purpose} ·{" "}
          <Taka value={action.kind === "payout" ? a.amount : a.open} />
        </p>
        {action.kind === "payout" && (
          <Field label={t("x.p.method")}>
            <Select
              value={f.method}
              onChange={(e) => setF({ ...f, method: e.target.value })}
              id="adv-method"
            >
              {(["cash", "bank_transfer", "mobile_wallet"] as const).map(
                (m) => (
                  <option key={m} value={m}>
                    {t(`x.p.method.${m}`)}
                  </option>
                ),
              )}
            </Select>
          </Field>
        )}
        {action.kind !== "recover" ? (
          <>
            <Field
              label={
                action.kind === "payout"
                  ? t("x.p.payFrom")
                  : t("x.p.receivedInto")
              }
            >
              <AccountSelect
                accounts={postable}
                filter={money}
                value={f.accountId}
                onChange={(accountId) => setF({ ...f, accountId })}
                required
                id="adv-account"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("p.date")}>
                <Input
                  type="date"
                  required
                  value={f.date}
                  onChange={(e) => setF({ ...f, date: e.target.value })}
                  id="adv-date"
                />
              </Field>
              {action.kind === "refund" && (
                <Field label={t("p.amount")}>
                  <Input
                    required
                    inputMode="decimal"
                    value={f.amount}
                    onChange={(e) => setF({ ...f, amount: e.target.value })}
                    id="adv-amount"
                  />
                </Field>
              )}
            </div>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("x.p.installment")}>
              <Input
                required
                inputMode="decimal"
                value={f.installment}
                onChange={(e) => setF({ ...f, installment: e.target.value })}
                id="adv-installment"
              />
            </Field>
            <Field label={t("x.p.firstPeriod")}>
              <Input
                type="month"
                required
                value={f.firstPeriod}
                onChange={(e) => setF({ ...f, firstPeriod: e.target.value })}
                id="adv-first"
              />
            </Field>
          </div>
        )}
        <FormButtons busy={save.busy} onCancel={onClose} submitLabel={title} />
      </form>
    </Modal>
  );
}

function Balances({ companyId }: { companyId: string }) {
  const { t } = useI18n();
  const { can } = usePortal();
  const b = useApi<AdvanceBalances>(
    `/companies/${companyId}/employee-advances/balances`,
  );
  const post = useAction();
  const [date, setDate] = useState("");
  if (b.loading && !b.data) return <Loading />;
  if (b.error) return <ErrorBox error={b.error} onRetry={b.reload} />;
  const d = b.data!;
  return (
    <Panel
      title={
        <>
          {t("x.p.tab.balances")}{" "}
          <Badge color={d.total === d.books ? "green" : "red"}>
            {d.total === d.books ? t("f.r.balancedYes") : t("f.r.balancedNo")}
          </Badge>
        </>
      }
    >
      <ActionMessage action={post} />
      {d.total !== d.books && Number(d.books) === 0 && can("expenses.pay") && (
        <div className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="mb-2">{t("fa.postOpeningHint")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("fa.date")}>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                id="advances-opening-date"
              />
            </Field>
            <div className="mb-3">
              <Button
                variant="secondary"
                busy={post.busy}
                disabled={!date}
                onClick={() =>
                  post
                    .run(
                      () =>
                        api.post(
                          `/companies/${companyId}/employee-advances/opening-posting`,
                          { date },
                        ),
                      t("p.done"),
                    )
                    .then((ok) => ok && b.reload())
                }
              >
                {t("fa.postOpening")}
              </Button>
            </div>
          </div>
        </div>
      )}
      <Table
        rows={[
          ...d.employees,
          {
            employeeId: "total",
            employeeCode: "",
            employeeName: t("p.total"),
            salaryAdvances: "",
            cashAdvances: "",
            total: d.total,
            books: d.books,
            difference: "",
          },
        ]}
        rowKey={(r) => r.employeeId}
        columns={[
          {
            key: "employee",
            label: t("p.employee"),
            render: (r) =>
              r.employeeId === "total" ? (
                <strong>{r.employeeName}</strong>
              ) : (
                `${r.employeeCode} · ${r.employeeName}`
              ),
          },
          {
            key: "salary",
            label: t("x.p.salaryAdvances"),
            align: "right",
            render: (r) =>
              r.salaryAdvances ? <Taka value={r.salaryAdvances} /> : "",
          },
          {
            key: "cash",
            label: t("x.p.cashAdvances"),
            align: "right",
            render: (r) =>
              r.cashAdvances ? <Taka value={r.cashAdvances} /> : "",
          },
          {
            key: "total",
            label: t("p.total"),
            align: "right",
            render: (r) => (
              <strong>
                <Taka value={r.total} />
              </strong>
            ),
          },
          {
            key: "books",
            label: t("x.p.books"),
            align: "right",
            render: (r) => <Taka value={r.books} />,
          },
          {
            key: "diff",
            label: t("x.p.difference"),
            align: "right",
            render: (r) =>
              r.difference && r.difference !== "0.00" ? (
                <span className="font-semibold text-red-700">
                  <Taka value={r.difference} />
                </span>
              ) : (
                ""
              ),
          },
        ]}
      />
    </Panel>
  );
}

function Categories({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const cats = useApi<ExpenseCategory[]>(
    `/companies/${companyId}/expense-categories`,
  );
  const save = useAction();
  if (cats.loading && !cats.data) return <Loading />;
  if (cats.error) return <ErrorBox error={cats.error} onRetry={cats.reload} />;
  return (
    <Panel
      actions={
        can("expenses.pay") && (
          <Button
            variant="secondary"
            busy={save.busy}
            onClick={() =>
              save
                .run(
                  () =>
                    api.post(
                      `/companies/${companyId}/expense-categories/defaults`,
                    ),
                  t("p.saved"),
                )
                .then((ok) => ok && cats.reload())
            }
          >
            {t("x.p.defaults")}
          </Button>
        )
      }
    >
      <ActionMessage action={save} />
      <Table
        rows={cats.data}
        rowKey={(c) => c.id}
        columns={[
          {
            key: "code",
            label: t("p.code"),
            render: (c) => <span className="font-mono text-xs">{c.code}</span>,
          },
          {
            key: "name",
            label: t("p.name"),
            render: (c) => (lang === "bn" && c.nameBn ? c.nameBn : c.nameEn),
          },
          {
            key: "account",
            label: t("x.p.account"),
            render: (c) => `${c.accountCode} · ${c.accountName}`,
          },
          {
            key: "receipt",
            label: t("x.p.receiptAbove"),
            align: "right",
            render: (c) => <Taka value={c.receiptRequiredAbove} />,
          },
          {
            key: "active",
            label: t("p.status"),
            render: (c) => (
              <Badge color={c.isActive ? "green" : "gray"}>
                {c.isActive ? t("f.vd.active") : t("f.vd.inactive")}
              </Badge>
            ),
          },
        ]}
      />
    </Panel>
  );
}

/** Approved salary advances (loans) not paid out yet: Accounts pays them out through the books. */
function SalaryAdvances({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const loans = useApi<Array<Loan & { payoutVoucherId: string | null }>>(
    `/companies/${companyId}/loans?state=approved&unpaid=true`,
  );
  const [paying, setPaying] = useState<Loan | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (loans.loading && !loans.data) return <Loading />;
  if (loans.error)
    return <ErrorBox error={loans.error} onRetry={loans.reload} />;
  return (
    <Panel>
      {notice && (
        <p className="mb-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      <Table
        rows={loans.data}
        rowKey={(l) => l.id}
        empty={t("py.loan.toPayNone")}
        columns={[
          {
            key: "employee",
            label: t("p.employee"),
            render: (l) => `${l.employeeCode} · ${l.fullNameEn}`,
          },
          {
            key: "reason",
            label: t("py.loan.reason"),
            render: (l) => <span className="line-clamp-2">{l.reason}</span>,
          },
          {
            key: "first",
            label: t("py.loan.firstPeriod"),
            render: (l) => formatMonth(l.firstPeriod, lang),
          },
          {
            key: "installment",
            label: t("py.loan.installment"),
            align: "right",
            render: (l) => <Taka value={l.installment} />,
          },
          {
            key: "principal",
            label: t("p.amount"),
            align: "right",
            render: (l) => (
              <strong>
                <Taka value={l.principal} />
              </strong>
            ),
          },
          {
            key: "actions",
            label: "",
            align: "right",
            render: (l) =>
              l.payoutVoucherId ? (
                <Badge color="amber">{t("py.loan.payoutSent")}</Badge>
              ) : can("expenses.pay") ? (
                <Button variant="secondary" onClick={() => setPaying(l)}>
                  {t("py.loan.payout")}
                </Button>
              ) : null,
          },
        ]}
      />
      {paying && (
        <LoanPayoutDialog
          companyId={companyId}
          loan={paying}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            setNotice(t("py.loan.payoutSent"));
            loans.reload();
          }}
        />
      )}
    </Panel>
  );
}

function LoanPayoutDialog({
  companyId,
  loan,
  onClose,
  onDone,
}: {
  companyId: string;
  loan: Loan;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const { postable } = useAccounts(companyId);
  const [f, setF] = useState({
    method: "cash",
    accountId: "",
    date: dhakaToday(),
  });
  return (
    <Modal
      title={`${t("py.loan.payout")}: ${loan.employeeCode}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/loans/${loan.id}/payout`, {
                method: f.method,
                paidFromAccountId: f.accountId,
                paymentDate: f.date,
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <p className="mb-3 text-sm text-slate-600">
          {loan.fullNameEn} · <Taka value={loan.principal} /> ·{" "}
          {t("py.loan.payoutHint", {
            month: formatMonth(loan.firstPeriod, lang),
          })}
        </p>
        <Field label={t("x.p.method")}>
          <Select
            value={f.method}
            onChange={(e) => setF({ ...f, method: e.target.value })}
            id="loan-method"
          >
            {(["cash", "bank_transfer", "mobile_wallet"] as const).map((m) => (
              <option key={m} value={m}>
                {t(`x.p.method.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("x.p.payFrom")}>
          <AccountSelect
            accounts={postable}
            filter={(x) => x.role === "cash" || x.role === "bank"}
            value={f.accountId}
            onChange={(accountId) => setF({ ...f, accountId })}
            required
            id="loan-account"
          />
        </Field>
        <Field label={t("p.date")}>
          <Input
            type="date"
            required
            value={f.date}
            onChange={(e) => setF({ ...f, date: e.target.value })}
            id="loan-date"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("py.loan.payout")}
        />
      </form>
    </Modal>
  );
}
