"use client";
/**
 * Payroll pieces of the employee screen in the portal (payroll fixes):
 *   - EmployeeLoans       salary advances: list with what is recovered / still owed; HR adds one
 *   - EmployeeStatements  PF ledger (HR sets the opening balance), earlier income this year
 *                         (YTD openings, HR), and the annual tax certificates (PDF)
 *   - BankRequest         HR asks for a new salary account on the employee's behalf
 */
import { useState } from "react";
import { BankAccountForm } from "@/components/bank-account-form";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, saveDownload, useApi } from "@/lib/api";
import {
  dhakaToday,
  formatDate,
  formatMonth,
  formatTaka,
  num,
} from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  ActionMessage,
  FormButtons,
  Modal,
  Panel,
  Table,
  useAction,
} from "./kit";
import { usePortal } from "./portal-context";

export interface Loan {
  id: string;
  employeeId: string;
  employeeCode?: string;
  fullNameEn?: string;
  principal: string;
  installment: string;
  firstPeriod: string;
  reason: string;
  state: "pending" | "approved" | "rejected" | "cancelled" | "closed";
  recovered: string;
  outstanding: string | null;
  origin: "request" | "import" | "advance";
  paidAt: string | null;
}

export const LOAN_STATE_COLOR = {
  pending: "amber",
  approved: "green",
  rejected: "red",
  cancelled: "gray",
  closed: "blue",
} as const;

interface PfLedger {
  member: boolean;
  opening: {
    asOf: string;
    employeePart: string;
    employerPart: string;
    note: string | null;
  } | null;
  entries: Array<{
    runId: string | null;
    kind?: string;
    date?: string | null;
    note?: string | null;
    period: string;
    runType: string;
    bonusName: string | null;
    employeePart: string;
    employerPart: string;
    balance: string;
  }>;
  totals: { employeePart: string; employerPart: string; balance: string };
}

interface YtdOpening {
  id: string;
  fiscalYear: string;
  kind: "opening" | "prior_employer";
  taxableIncome: string;
  taxWithheld: string;
  note: string | null;
}

interface TaxCertificate {
  fiscalYear: string;
  final: boolean;
  months: Array<{
    period: string;
    gross: string;
    taxableIncome: string;
    tax: string;
    challans: Array<{ challanNo: string; challanDate: string }>;
  }>;
  totals: {
    gross: string;
    taxableIncome: string;
    tax: string;
    taxIncludingEarlier: string;
  };
}

/** "2026-11" a month after today, the earliest sensible first deduction. */
function nextMonth(): string {
  const [y, m] = dhakaToday().split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** "2026-27" for today's income year (July to June). */
export function currentFiscalYear(): string {
  const [y, m] = dhakaToday().split("-").map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

// ------------------------------------------------------------------ salary advances

export function EmployeeLoans({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const loans = useApi<Loan[]>(`/employees/${id}/loans`);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      {notice && (
        <p className="mb-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      <Panel
        title={t("py.loan.title")}
        actions={
          can("payroll.prepare") && (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              {t("py.loan.new")}
            </Button>
          )
        }
      >
        {loans.error ? (
          <ErrorBox error={loans.error} />
        ) : (
          <Table
            rows={loans.data}
            rowKey={(l) => l.id}
            empty={t("py.loan.none")}
            columns={[
              {
                key: "principal",
                label: t("py.loan.principal"),
                align: "right",
                render: (l) => formatTaka(l.principal, lang),
              },
              {
                key: "installment",
                label: t("py.loan.installment"),
                align: "right",
                render: (l) => formatTaka(l.installment, lang),
              },
              {
                key: "first",
                label: t("py.loan.firstPeriod"),
                render: (l) => formatMonth(l.firstPeriod, lang),
              },
              {
                key: "reason",
                label: t("py.loan.reason"),
                render: (l) => (
                  <span className="line-clamp-2 text-sm">{l.reason}</span>
                ),
              },
              {
                key: "state",
                label: t("p.status"),
                render: (l) => (
                  <Badge color={LOAN_STATE_COLOR[l.state]}>
                    {t(`py.loan.state.${l.state}`)}
                  </Badge>
                ),
              },
              {
                key: "paid",
                label: t("py.loan.paidOut"),
                render: (l) =>
                  l.paidAt ? (
                    formatDate(l.paidAt.slice(0, 10), lang, { short: true })
                  ) : l.origin === "request" && l.state === "approved" ? (
                    <span className="text-xs text-amber-700">
                      {t("py.loan.notPaid")}
                    </span>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "recovered",
                label: t("py.loan.recovered"),
                align: "right",
                render: (l) => formatTaka(l.recovered, lang),
              },
              {
                key: "outstanding",
                label: t("py.loan.outstanding"),
                align: "right",
                render: (l) =>
                  l.outstanding === null ? (
                    "—"
                  ) : (
                    <strong>{formatTaka(l.outstanding, lang)}</strong>
                  ),
              },
            ]}
          />
        )}
      </Panel>
      {adding && (
        <LoanForm
          employeeId={id}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            setNotice(t("py.loan.sent"));
            loans.reload();
          }}
        />
      )}
    </>
  );
}

export function LoanForm({
  employeeId,
  onClose,
  onDone,
}: {
  employeeId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    principal: "",
    installment: "",
    firstPeriod: nextMonth(),
    reason: "",
  });
  const months =
    Number(f.principal) > 0 && Number(f.installment) > 0
      ? Math.ceil(Number(f.principal) / Number(f.installment))
      : null;
  return (
    <Modal title={t("py.loan.new")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() => api.post(`/employees/${employeeId}/loans`, f))
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label={t("py.loan.principal")}>
            <Input
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={f.principal}
              onChange={(e) => setF({ ...f, principal: e.target.value })}
              id="loan-principal"
            />
          </Field>
          <Field label={t("py.loan.installment")}>
            <Input
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={f.installment}
              onChange={(e) => setF({ ...f, installment: e.target.value })}
              id="loan-installment"
            />
          </Field>
          <Field label={t("py.loan.firstPeriod")}>
            <Input
              type="month"
              required
              value={f.firstPeriod}
              onChange={(e) => setF({ ...f, firstPeriod: e.target.value })}
              id="loan-first"
            />
          </Field>
        </div>
        {months !== null && (
          <p className="mb-3 text-sm text-slate-600">
            {t("py.loan.plan", {
              installment: formatTaka(f.installment, lang),
              n: num(months, lang),
            })}
          </p>
        )}
        <Field label={t("py.loan.reason")}>
          <Input
            required
            maxLength={500}
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
            id="loan-reason"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("common.submit")}
        />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ PF, earlier income, tax certificate

export function EmployeeStatements({ id }: { id: string }) {
  const { can } = usePortal();
  return (
    <>
      <PfPanel id={id} />
      {can("payroll.prepare") && <YtdPanel id={id} />}
      <TaxPanel id={id} />
    </>
  );
}

function PfPanel({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const ledger = useApi<PfLedger>(`/employees/${id}/pf-ledger`);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState<"withdraw" | "settle" | null>(null);
  const d = ledger.data;
  return (
    <Panel
      title={t("py.pf.title")}
      actions={
        <>
          {can("payroll.prepare") && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t("py.pf.openingSet")}
            </Button>
          )}
          {can("ledger.vouchers.prepare") && d?.member && (
            <Button variant="secondary" onClick={() => setPaying("withdraw")}>
              {t("pf2.withdraw")}
            </Button>
          )}
          {can("ledger.vouchers.prepare") && d?.member && (
            <Button variant="secondary" onClick={() => setPaying("settle")}>
              {t("pf2.settle")}
            </Button>
          )}
        </>
      }
    >
      {ledger.error ? (
        <ErrorBox error={ledger.error} />
      ) : !d ? (
        <Loading />
      ) : !d.member ? (
        <p className="text-sm text-slate-500">{t("py.pf.notMember")}</p>
      ) : (
        <>
          <dl className="mb-3 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-slate-500">{t("py.pf.employee")}</dt>
              <dd className="font-semibold">
                {formatTaka(d.totals.employeePart, lang)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t("py.pf.employer")}</dt>
              <dd className="font-semibold">
                {formatTaka(d.totals.employerPart, lang)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">{t("py.pf.balance")}</dt>
              <dd className="text-lg font-bold">
                {formatTaka(d.totals.balance, lang)}
              </dd>
            </div>
          </dl>
          <Table
            rows={[
              ...(d.opening
                ? [
                    {
                      key: "opening",
                      month: `${t("py.pf.opening")} · ${formatDate(d.opening.asOf, lang, { short: true })}`,
                      employee: d.opening.employeePart,
                      employer: d.opening.employerPart,
                      balance: String(
                        Number(d.opening.employeePart) +
                          Number(d.opening.employerPart),
                      ),
                    },
                  ]
                : []),
              ...d.entries.map((e, i) => ({
                key: e.runId ?? `${e.kind}-${i}`,
                month: `${e.date ? formatDate(e.date, lang, { short: true }) : formatMonth(e.period, lang)}${e.bonusName ? ` · ${e.bonusName}` : ""}${e.kind && e.kind !== "contribution" ? ` · ${t(`pf2.kind.${e.kind}`)}` : ""}`,
                employee: e.employeePart,
                employer: e.employerPart,
                balance: e.balance,
              })),
            ].reverse()}
            rowKey={(r) => r.key}
            columns={[
              { key: "month", label: t("p.period") },
              {
                key: "employee",
                label: t("py.pf.employee"),
                align: "right",
                render: (r) => formatTaka(r.employee, lang),
              },
              {
                key: "employer",
                label: t("py.pf.employer"),
                align: "right",
                render: (r) => formatTaka(r.employer, lang),
              },
              {
                key: "balance",
                label: t("py.pf.balance"),
                align: "right",
                render: (r) => <strong>{formatTaka(r.balance, lang)}</strong>,
              },
            ]}
          />
        </>
      )}
      {editing && (
        <PfOpeningForm
          id={id}
          current={d?.opening ?? null}
          onClose={() => setEditing(false)}
          onDone={() => (setEditing(false), ledger.reload())}
        />
      )}
      {paying && (
        <PfPaymentForm
          id={id}
          kind={paying}
          onClose={() => setPaying(null)}
          onDone={() => (setPaying(null), ledger.reload())}
        />
      )}
    </Panel>
  );
}

interface PfSettlement {
  date: string;
  yearsOfService: number;
  vestedPercent: string;
  ownPart: string;
  employerPart: string;
  vestedEmployerPart: string;
  forfeited: string;
  payable: string;
  canSettle: boolean;
  settlement: { state: string } | null;
}

/** Accounts pays out of the fund: a withdrawal from the member's own part, or the final settlement on leaving. */
function PfPaymentForm({
  id,
  kind,
  onClose,
  onDone,
}: {
  id: string;
  kind: "withdraw" | "settle";
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const { company } = usePortal();
  const save = useAction();
  const preview = useApi<PfSettlement>(
    kind === "settle" ? `/employees/${id}/pf-settlement` : null,
  );
  const money = useApi<
    Array<{
      id: string;
      code: string;
      nameEn: string;
      role: string | null;
      postable: boolean;
    }>
  >(company ? `/companies/${company.id}/accounts` : null);
  const [f, setF] = useState({
    amount: "",
    date: dhakaToday(),
    paidFromAccountId: "",
    reason: "",
  });
  const p = preview.data;
  return (
    <Modal
      title={kind === "withdraw" ? t("pf2.withdraw") : t("pf2.settle")}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const ok =
            kind === "withdraw"
              ? await save.run(
                  () => api.post(`/employees/${id}/pf-withdrawals`, f),
                  t("p.done"),
                )
              : await save.run(
                  () =>
                    api.post(`/employees/${id}/pf-settlement`, {
                      date: f.date,
                      paidFromAccountId: f.paidFromAccountId,
                    }),
                  t("p.done"),
                );
          if (ok) onDone();
        }}
      >
        <p className="mb-3 text-sm text-slate-600">
          {kind === "withdraw" ? t("pf2.withdrawHint") : t("pf2.settleHint")}
        </p>
        <ActionMessage action={save} />
        {kind === "settle" && p && (
          <dl className="mb-3 grid grid-cols-2 gap-1 text-sm">
            <dt>{t("pf2.years")}</dt>
            <dd className="text-right">{num(p.yearsOfService, lang)}</dd>
            <dt>{t("py.pf.yours")}</dt>
            <dd className="text-right">{formatTaka(p.ownPart, lang)}</dd>
            <dt>
              {t("pf2.vested")} ({Number(p.vestedPercent)}%)
            </dt>
            <dd className="text-right">
              {formatTaka(p.vestedEmployerPart, lang)}
            </dd>
            <dt>{t("pf2.forfeited")}</dt>
            <dd className="text-right">{formatTaka(p.forfeited, lang)}</dd>
            <dt className="font-semibold">{t("pf2.payable")}</dt>
            <dd className="text-right font-semibold">
              {formatTaka(p.payable, lang)}
            </dd>
          </dl>
        )}
        {kind === "settle" && p && !p.canSettle && (
          <p className="mb-3 text-sm text-amber-800">
            {p.settlement ? t("pf2.settled") : t("pf2.notLeaving")}
          </p>
        )}
        {kind === "withdraw" && (
          <Field label={t("pf2.amount")}>
            <Input
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
              id="pf-amount"
            />
          </Field>
        )}
        <Field label={t("pf2.date")}>
          <Input
            required
            type="date"
            value={f.date}
            onChange={(e) => setF({ ...f, date: e.target.value })}
            id="pf-date"
          />
        </Field>
        <Field label={t("pf2.paidFrom")}>
          <Select
            required
            value={f.paidFromAccountId}
            onChange={(e) => setF({ ...f, paidFromAccountId: e.target.value })}
            id="pf-from"
          >
            <option value="">—</option>
            {money.data
              ?.filter(
                (a) => a.postable && (a.role === "bank" || a.role === "cash"),
              )
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.nameEn}
                </option>
              ))}
          </Select>
        </Field>
        {kind === "withdraw" && (
          <Field label={t("pf2.reason")}>
            <Input
              required
              maxLength={500}
              value={f.reason}
              onChange={(e) => setF({ ...f, reason: e.target.value })}
              id="pf-reason"
            />
          </Field>
        )}
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={
            kind === "withdraw" ? t("pf2.withdraw") : t("pf2.settle")
          }
        />
      </form>
    </Modal>
  );
}

function PfOpeningForm({
  id,
  current,
  onClose,
  onDone,
}: {
  id: string;
  current: PfLedger["opening"];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    asOf: current?.asOf ?? "",
    employeePart: current?.employeePart ?? "",
    employerPart: current?.employerPart ?? "",
    note: current?.note ?? "",
  });
  return (
    <Modal title={t("py.pf.openingSet")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(
              () =>
                api.put(`/employees/${id}/pf-opening`, {
                  ...f,
                  note: f.note || undefined,
                }),
              t("py.pf.saved"),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <p className="mb-3 text-sm text-slate-600">{t("py.pf.openingHint")}</p>
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label={t("py.pf.asOf")}>
            <Input
              type="date"
              required
              value={f.asOf}
              onChange={(e) => setF({ ...f, asOf: e.target.value })}
              id="pf-asof"
            />
          </Field>
          <Field label={t("py.pf.employee")}>
            <Input
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={f.employeePart}
              onChange={(e) => setF({ ...f, employeePart: e.target.value })}
              id="pf-employee"
            />
          </Field>
          <Field label={t("py.pf.employer")}>
            <Input
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={f.employerPart}
              onChange={(e) => setF({ ...f, employerPart: e.target.value })}
              id="pf-employer"
            />
          </Field>
        </div>
        <Field label={t("lv.emp.note")}>
          <Input
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="pf-note"
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function YtdPanel({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const rows = useApi<YtdOpening[]>(`/employees/${id}/ytd-openings`);
  const [editing, setEditing] = useState<Partial<YtdOpening> | null>(null);
  return (
    <Panel
      title={t("py.tax.ytd")}
      actions={
        <Button variant="secondary" onClick={() => setEditing({})}>
          {t("py.tax.ytdAdd")}
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-500">{t("py.tax.ytdHint")}</p>
      {rows.error ? (
        <ErrorBox error={rows.error} />
      ) : (
        <Table
          rows={rows.data}
          rowKey={(r) => r.id}
          empty={t("py.tax.ytdNone")}
          columns={[
            {
              key: "fiscalYear",
              label: t("py.tax.year"),
              className: "font-mono",
            },
            {
              key: "kind",
              label: t("py.tax.kind"),
              render: (r) => t(`py.tax.kind.${r.kind}`),
            },
            {
              key: "taxable",
              label: t("py.tax.taxable"),
              align: "right",
              render: (r) => formatTaka(r.taxableIncome, lang),
            },
            {
              key: "tax",
              label: t("py.tax.withheld"),
              align: "right",
              render: (r) => formatTaka(r.taxWithheld, lang),
            },
            {
              key: "note",
              label: t("lv.emp.note"),
              render: (r) => (
                <span className="text-xs text-slate-600">{r.note ?? ""}</span>
              ),
            },
            {
              key: "act",
              label: "",
              align: "right",
              render: (r) => (
                <Button
                  variant="ghost"
                  className="min-h-8 px-2 py-1 text-sm"
                  onClick={() => setEditing(r)}
                >
                  {t("p.emp.edit")}
                </Button>
              ),
            },
          ]}
        />
      )}
      {editing && (
        <YtdForm
          id={id}
          current={editing}
          onClose={() => setEditing(null)}
          onDone={() => (setEditing(null), rows.reload())}
        />
      )}
    </Panel>
  );
}

function YtdForm({
  id,
  current,
  onClose,
  onDone,
}: {
  id: string;
  current: Partial<YtdOpening>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    fiscalYear: current.fiscalYear ?? currentFiscalYear(),
    kind: current.kind ?? "prior_employer",
    taxableIncome: current.taxableIncome ?? "",
    taxWithheld: current.taxWithheld ?? "",
    note: current.note ?? "",
  });
  return (
    <Modal title={t("py.tax.ytd")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(
              () =>
                api.put(`/employees/${id}/ytd-openings`, {
                  ...f,
                  note: f.note || undefined,
                }),
              t("py.tax.saved"),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("py.tax.fiscalYear")}>
            <Input
              required
              pattern="\d{4}-\d{2}"
              value={f.fiscalYear}
              onChange={(e) => setF({ ...f, fiscalYear: e.target.value })}
              id="ytd-year"
            />
          </Field>
          <Field label={t("py.tax.kind")}>
            <Select
              value={f.kind}
              onChange={(e) =>
                setF({ ...f, kind: e.target.value as YtdOpening["kind"] })
              }
              id="ytd-kind"
            >
              <option value="prior_employer">
                {t("py.tax.kind.prior_employer")}
              </option>
              <option value="opening">{t("py.tax.kind.opening")}</option>
            </Select>
          </Field>
          <Field label={t("py.tax.taxable")}>
            <Input
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={f.taxableIncome}
              onChange={(e) => setF({ ...f, taxableIncome: e.target.value })}
              id="ytd-taxable"
            />
          </Field>
          <Field label={t("py.tax.withheld")}>
            <Input
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={f.taxWithheld}
              onChange={(e) => setF({ ...f, taxWithheld: e.target.value })}
              id="ytd-tax"
            />
          </Field>
        </div>
        <Field label={t("lv.emp.note")}>
          <Input
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="ytd-note"
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function TaxPanel({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const years = useApi<Array<{ fiscalYear: string; final: boolean }>>(
    `/employees/${id}/tax-certificates`,
  );
  const [year, setYear] = useState("");
  const chosen = year || years.data?.[0]?.fiscalYear || "";
  const cert = useApi<TaxCertificate>(
    chosen ? `/employees/${id}/tax-certificate?fiscalYear=${chosen}` : null,
  );
  const download = useAction();
  return (
    <Panel
      title={t("py.tax.title")}
      actions={
        years.data?.length ? (
          <>
            <Select
              aria-label={t("py.tax.year")}
              value={chosen}
              onChange={(e) => setYear(e.target.value)}
              id="tax-year"
            >
              {years.data.map((y) => (
                <option key={y.fiscalYear} value={y.fiscalYear}>
                  {y.fiscalYear}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              busy={download.busy}
              onClick={() =>
                download.run(async () =>
                  saveDownload(
                    await api.file(
                      `/employees/${id}/tax-certificate/pdf?fiscalYear=${chosen}&lang=${lang}`,
                    ),
                    `tax-certificate-${chosen}.pdf`,
                  ),
                )
              }
            >
              {t("py.tax.download")}
            </Button>
          </>
        ) : null
      }
    >
      <ActionMessage action={download} />
      {years.error ? (
        <ErrorBox error={years.error} />
      ) : !years.data ? (
        <Loading />
      ) : !years.data.length ? (
        <p className="text-sm text-slate-500">{t("py.tax.none")}</p>
      ) : cert.error ? (
        <ErrorBox error={cert.error} />
      ) : !cert.data ? (
        <Loading />
      ) : (
        <TaxSummary cert={cert.data} />
      )}
    </Panel>
  );
}

export function TaxSummary({ cert }: { cert: TaxCertificate }) {
  const { t, lang } = useI18n();
  return (
    <>
      <p className="mb-2">
        <Badge color={cert.final ? "green" : "amber"}>
          {cert.final ? t("py.tax.final") : t("py.tax.provisional")}
        </Badge>
      </p>
      <Table
        rows={cert.months}
        rowKey={(m) => m.period}
        columns={[
          {
            key: "period",
            label: t("p.period"),
            render: (m) => formatMonth(m.period, lang),
          },
          {
            key: "gross",
            label: t("py.tax.gross"),
            align: "right",
            render: (m) => formatTaka(m.gross, lang),
          },
          {
            key: "tax",
            label: t("py.tax.withheld"),
            align: "right",
            render: (m) => formatTaka(m.tax, lang),
          },
          {
            key: "challan",
            label: t("py.tax.challan"),
            render: (m) =>
              Number(m.tax) === 0 ? (
                "—"
              ) : m.challans.length ? (
                m.challans
                  .map(
                    (c) =>
                      `${c.challanNo} (${formatDate(c.challanDate, lang, { short: true })})`,
                  )
                  .join(", ")
              ) : (
                <span className="text-xs text-amber-700">
                  {t("py.tax.notDeposited")}
                </span>
              ),
          },
        ]}
      />
      <p className="mt-3 text-right font-semibold">
        {t("py.tax.totalTax")}:{" "}
        {formatTaka(cert.totals.taxIncludingEarlier, lang)}
      </p>
    </>
  );
}

// ------------------------------------------------------------------ salary account

export function BankRequest({
  employeeId,
  onDone,
}: {
  employeeId: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("py.bank.new")}
      </Button>
      {open && (
        <Modal title={t("py.bank.new")} open onClose={() => setOpen(false)}>
          <BankAccountForm
            employeeId={employeeId}
            onCancel={() => setOpen(false)}
            onDone={() => {
              setOpen(false);
              onDone();
            }}
          />
        </Modal>
      )}
    </>
  );
}
