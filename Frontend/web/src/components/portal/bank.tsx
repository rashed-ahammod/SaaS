"use client";
/**
 * Bank reconciliation pieces of the portal (WP20):
 *   NewBankAccountDialog   a ledger bank account set up for reconciliation
 *   StatementsPanel        import a statement (CSV) and the files imported so far
 *   MatchPanel             unmatched bank lines and book lines side by side: match by hand,
 *                          automatically, from the rules' options or an AI suggestion;
 *                          record a bank charge; undo a match
 *   ReconciliationPanel    the statement as of a date: bank balance, items in transit,
 *                          adjusted balance = the books
 */
import { useState } from "react";
import { AccountSelect, Taka, useAccounts } from "@/components/portal/finance";
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
  BankAccount,
  BankMatch,
  BankStatement,
  LedgerLine,
  MatchOption,
  Reconciliation,
  StatementLine,
} from "@/lib/bank-types";
import { dhakaToday, formatDate, formatTaka } from "@/lib/format";
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

const SIGNED_MONEY = "-?\\d+(\\.\\d{1,2})?";
const cents = (v: string) => Math.round(Number(v) * 100);

export function NewBankAccountDialog({
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
  const accounts = useAccounts(companyId);
  const [f, setF] = useState({
    accountId: "",
    bankName: "",
    branch: "",
    accountName: "",
    accountNo: "",
    statementFormat: "dbbl",
    reconcileFrom: `${dhakaToday().slice(0, 7)}-01`,
    openingBankBalance: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={t("bk.new")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = Object.fromEntries(
            Object.entries(f).filter(([, v]) => v !== ""),
          );
          const b = await save.run(() =>
            api.post<{ id: string }>(
              `/companies/${companyId}/bank-accounts`,
              body,
            ),
          );
          if (b && typeof b === "object") onDone(b.id);
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("bk.ledgerAccount")}>
            <AccountSelect
              id="bank-ledger"
              required
              accounts={accounts.postable}
              value={f.accountId}
              onChange={(accountId) => setF({ ...f, accountId })}
              filter={(a) => a.role === "bank"}
            />
          </Field>
          <Field label={t("bk.bank")}>
            <Input
              required
              maxLength={100}
              value={f.bankName}
              onChange={set("bankName")}
              id="bank-name"
            />
          </Field>
          <Field label={t("bk.branch")}>
            <Input
              maxLength={100}
              value={f.branch}
              onChange={set("branch")}
              id="bank-branch"
            />
          </Field>
          <Field label={t("bk.accountName")}>
            <Input
              required
              maxLength={200}
              value={f.accountName}
              onChange={set("accountName")}
              id="bank-account-name"
            />
          </Field>
          <Field label={t("bk.accountNo")}>
            <Input
              required
              pattern="[0-9A-Za-z-]{4,30}"
              value={f.accountNo}
              onChange={set("accountNo")}
              id="bank-account-no"
            />
          </Field>
          <Field label={t("bk.format")} hint={t("bk.formatHint")}>
            <Select
              value={f.statementFormat}
              onChange={set("statementFormat")}
              id="bank-format"
            >
              {(["dbbl", "brac", "city", "generic"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`bk.format.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("bk.reconcileFrom")}>
            <Input
              type="date"
              required
              value={f.reconcileFrom}
              onChange={set("reconcileFrom")}
              id="bank-from"
            />
          </Field>
          <Field label={t("bk.openingBank")} hint={t("bk.openingHint")}>
            <Input
              required
              inputMode="decimal"
              pattern={SIGNED_MONEY}
              value={f.openingBankBalance}
              onChange={set("openingBankBalance")}
              id="bank-opening"
            />
          </Field>
        </div>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("bk.new")}
        />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------ statements

export function StatementsPanel({
  account,
  onImported,
}: {
  account: BankAccount;
  onImported: () => void;
}) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const statements = useApi<BankStatement[]>(
    `/bank-accounts/${account.id}/statements`,
  );
  const action = useAction();
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      {can("bank.reconcile") && (
        <Panel title={t("bk.import")}>
          <p className="mb-3 text-sm text-slate-600">
            {t("bk.importHint")} ({t(`bk.format.${account.statementFormat}`)})
          </p>
          <ActionMessage action={action} />
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!file) return;
              const form = new FormData();
              form.append("file", file);
              const r = await action.run(() =>
                api.upload<{
                  imported: number;
                  skipped: number;
                  autoMatched: number;
                }>(`/bank-accounts/${account.id}/statements`, form),
              );
              if (r && typeof r === "object") {
                action.run(
                  async () => undefined,
                  t("bk.imported", {
                    imported: r.imported,
                    skipped: r.skipped,
                    matched: r.autoMatched,
                  }),
                );
                statements.reload();
                onImported();
              }
            }}
          >
            <Field label={t("bk.file")}>
              <Input
                type="file"
                accept=".csv,text/csv"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                id="statement-file"
              />
            </Field>
            <Button className="mb-3" type="submit" busy={action.busy}>
              {t("bk.import")}
            </Button>
          </form>
        </Panel>
      )}
      <Panel title={t("bk.tab.statements")}>
        {statements.error ? (
          <ErrorBox error={statements.error} onRetry={statements.reload} />
        ) : (
          <Table
            rows={statements.data}
            rowKey={(s) => s.id}
            empty={t("bk.none")}
            columns={[
              {
                key: "file",
                label: t("bk.file"),
                render: (s) => (
                  <span className="font-mono text-xs">{s.fileName}</span>
                ),
              },
              {
                key: "source",
                label: "",
                render: (s) => (
                  <Badge color={s.source === "n8n" ? "blue" : "gray"}>
                    {t(`bk.source.${s.source}`)}
                  </Badge>
                ),
              },
              {
                key: "period",
                label: t("bk.period"),
                render: (s) =>
                  `${formatDate(s.periodFrom, lang, { short: true })} – ${formatDate(s.periodTo, lang, { short: true })}`,
              },
              {
                key: "lines",
                label: t("bk.lines"),
                align: "right",
                render: (s) => s.linesImported,
              },
              {
                key: "skipped",
                label: t("bk.skipped"),
                align: "right",
                render: (s) => s.linesSkipped,
              },
              {
                key: "closing",
                label: t("bk.closing"),
                align: "right",
                render: (s) => <Taka value={s.closingBalance} />,
              },
              {
                key: "at",
                label: t("bk.importedAt"),
                render: (s) =>
                  formatDate(s.importedAt.slice(0, 10), lang, { short: true }),
              },
            ]}
          />
        )}
      </Panel>
    </>
  );
}

// ------------------------------------------------------------ matching

export function MatchPanel({
  account,
  onChanged,
}: {
  account: BankAccount;
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const reconcile = can("bank.reconcile");
  const [showMatched, setShowMatched] = useState(false);
  const state = showMatched ? "all" : "unmatched";
  const bankLines = useApi<StatementLine[]>(
    `/bank-accounts/${account.id}/statement-lines?state=${state}`,
  );
  const bookLines = useApi<LedgerLine[]>(
    `/bank-accounts/${account.id}/ledger-lines?state=${state}`,
  );
  const [bankPick, setBankPick] = useState<string[]>([]);
  const [bookPick, setBookPick] = useState<string[]>([]);
  const [optionsFor, setOptionsFor] = useState<StatementLine | null>(null);
  const [recordFor, setRecordFor] = useState<StatementLine | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const action = useAction();
  const reload = () => (
    setBankPick([]),
    setBookPick([]),
    bankLines.reload(),
    bookLines.reload(),
    onChanged()
  );

  const sum = (
    rows: Array<{ id: string; amount: string }> | undefined,
    ids: string[],
  ) =>
    (rows ?? [])
      .filter((r) => ids.includes(r.id))
      .reduce((a, r) => a + cents(r.amount), 0);
  const bankTotal = sum(bankLines.data, bankPick);
  const bookTotal = sum(bookLines.data, bookPick);
  const canMatch =
    bankPick.length > 0 && bookPick.length > 0 && bankTotal === bookTotal;
  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const pick = <T extends { id: string; matchId: string | null }>(
    list: string[],
    set: (v: string[]) => void,
    label: string,
  ) => ({
    key: "pick",
    label: "",
    render: (l: T) =>
      l.matchId ? (
        reconcile ? (
          <Button
            variant="ghost"
            className="min-h-8 px-2 py-1 text-xs"
            onClick={() => setUndoing(l.matchId)}
          >
            {t("bk.undo")}
          </Button>
        ) : (
          <Badge color="green">{t("bk.matched")}</Badge>
        )
      ) : reconcile ? (
        <input
          type="checkbox"
          aria-label={`${label} ${l.id}`}
          checked={list.includes(l.id)}
          onChange={() => toggle(list, set, l.id)}
        />
      ) : null,
  });

  return (
    <>
      <Panel
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showMatched}
                onChange={(e) => setShowMatched(e.target.checked)}
                id="show-matched"
              />{" "}
              {t("bk.showMatched")}
            </label>
            {reconcile && (
              <Button
                variant="secondary"
                busy={action.busy}
                onClick={() =>
                  action
                    .run(async () => {
                      const r = await api.post<{ matched: number }>(
                        `/bank-accounts/${account.id}/auto-match`,
                      );
                      reload();
                      return r;
                    })
                    .then(
                      (r) =>
                        r &&
                        typeof r === "object" &&
                        action.run(
                          async () => undefined,
                          t("bk.autoMatched", { n: r.matched }),
                        ),
                    )
                }
              >
                {t("bk.autoMatch")}
              </Button>
            )}
          </>
        }
      >
        <ActionMessage action={action} />
        {reconcile && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-600">{t("bk.matchHint")}</span>
            <span className="tabular-nums">
              {t("bk.selected", {
                bank: formatTaka(bankTotal / 100, lang),
                books: formatTaka(bookTotal / 100, lang),
              })}
            </span>
            {bankPick.length > 0 &&
              bookPick.length > 0 &&
              bankTotal !== bookTotal && (
                <span className="text-red-700">
                  {t("bk.difference")}{" "}
                  {formatTaka((bankTotal - bookTotal) / 100, lang)}
                </span>
              )}
            <Button
              disabled={!canMatch}
              busy={action.busy}
              onClick={() =>
                action
                  .run(
                    () =>
                      api.post(`/bank-accounts/${account.id}/matches`, {
                        statementLineIds: bankPick,
                        ledgerLineIds: bookPick,
                      }),
                    t("p.done"),
                  )
                  .then((r) => r && reload())
              }
            >
              {t("bk.match")}
            </Button>
          </div>
        )}
        <div className="grid gap-4 xl:grid-cols-2">
          <section aria-label={t("bk.statementSide")}>
            <h3 className="mb-2 font-semibold">{t("bk.statementSide")}</h3>
            {bankLines.error ? (
              <ErrorBox error={bankLines.error} onRetry={bankLines.reload} />
            ) : (
              <Table
                rows={bankLines.data}
                rowKey={(l) => l.id}
                empty={t("bk.none")}
                columns={[
                  pick<StatementLine>(
                    bankPick,
                    setBankPick,
                    t("bk.statementSide"),
                  ),
                  {
                    key: "date",
                    label: t("bk.date"),
                    className: "whitespace-nowrap",
                    render: (l) => formatDate(l.date, lang, { short: true }),
                  },
                  {
                    key: "desc",
                    label: t("bk.description"),
                    render: (l) => (
                      <span className="text-sm">
                        {l.description}
                        {l.reference && (
                          <span className="block font-mono text-xs text-slate-500">
                            {l.reference}
                          </span>
                        )}
                      </span>
                    ),
                  },
                  {
                    key: "amount",
                    label: t("bk.amount"),
                    align: "right",
                    render: (l) => (
                      <span
                        className={Number(l.amount) < 0 ? "text-red-700" : ""}
                      >
                        <Taka value={l.amount} />
                      </span>
                    ),
                  },
                  {
                    key: "act",
                    label: "",
                    align: "right",
                    render: (l) =>
                      !l.matchId && reconcile ? (
                        <span className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            className="min-h-8 px-2 py-1 text-xs"
                            onClick={() => setOptionsFor(l)}
                          >
                            {t("bk.options")}
                          </Button>
                          <Button
                            variant="ghost"
                            className="min-h-8 px-2 py-1 text-xs"
                            onClick={() => setRecordFor(l)}
                          >
                            {t("bk.record")}
                          </Button>
                        </span>
                      ) : null,
                  },
                ]}
              />
            )}
          </section>
          <section aria-label={t("bk.ledgerSide")}>
            <h3 className="mb-2 font-semibold">{t("bk.ledgerSide")}</h3>
            {bookLines.error ? (
              <ErrorBox error={bookLines.error} onRetry={bookLines.reload} />
            ) : (
              <Table
                rows={bookLines.data}
                rowKey={(l) => l.id}
                empty={t("bk.none")}
                columns={[
                  pick<LedgerLine>(bookPick, setBookPick, t("bk.ledgerSide")),
                  {
                    key: "date",
                    label: t("bk.date"),
                    className: "whitespace-nowrap",
                    render: (l) => formatDate(l.date, lang, { short: true }),
                  },
                  {
                    key: "voucher",
                    label: t("bk.voucher"),
                    render: (l) => (
                      <span className="text-sm">
                        <span className="block font-mono text-xs">
                          {l.voucherNumber}
                        </span>
                        {l.narration}
                      </span>
                    ),
                  },
                  {
                    key: "amount",
                    label: t("bk.amount"),
                    align: "right",
                    render: (l) => (
                      <span
                        className={Number(l.amount) < 0 ? "text-red-700" : ""}
                      >
                        <Taka value={l.amount} />
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </section>
        </div>
      </Panel>
      {optionsFor && (
        <OptionsDialog
          account={account}
          line={optionsFor}
          onClose={() => setOptionsFor(null)}
          onDone={() => (setOptionsFor(null), reload())}
        />
      )}
      {recordFor && (
        <RecordDialog
          account={account}
          line={recordFor}
          onClose={() => setRecordFor(null)}
        />
      )}
      {undoing && (
        <UndoDialog
          matchId={undoing}
          onClose={() => setUndoing(null)}
          onDone={() => (setUndoing(null), reload())}
        />
      )}
    </>
  );
}

function LinesList({ lines }: { lines: LedgerLine[] }) {
  const { lang } = useI18n();
  return (
    <ul className="text-sm">
      {lines.map((l) => (
        <li key={l.id}>
          <span className="font-mono text-xs">{l.voucherNumber}</span> ·{" "}
          {formatDate(l.date, lang, { short: true })} · {l.narration} ·{" "}
          <Taka value={l.amount} />
        </li>
      ))}
    </ul>
  );
}

function OptionsDialog({
  account,
  line,
  onClose,
  onDone,
}: {
  account: BankAccount;
  line: StatementLine;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const options = useApi<{ options: MatchOption[] }>(
    `/bank-statement-lines/${line.id}/options`,
  );
  const action = useAction();
  const [suggestion, setSuggestion] = useState<{
    suggestion: { ledgerLineIds: string[]; lines: LedgerLine[] } | null;
    reason: string | null;
  } | null>(null);
  const accept = (ledgerLineIds: string[], fromSuggestion: boolean) =>
    action
      .run(() =>
        api.post(`/bank-accounts/${account.id}/matches`, {
          statementLineIds: [line.id],
          ledgerLineIds,
          fromSuggestion,
        }),
      )
      .then((r) => r && onDone());
  return (
    <Modal title={t("bk.options")} open onClose={onClose} wide>
      <p className="mb-3 text-sm">
        {formatDate(line.date, lang)} · {line.description}{" "}
        {line.reference && (
          <span className="font-mono">({line.reference})</span>
        )}{" "}
        ·{" "}
        <strong>
          <Taka value={line.amount} />
        </strong>
      </p>
      <ActionMessage action={action} />
      {options.error ? (
        <ErrorBox error={options.error} />
      ) : !options.data ? (
        <Loading />
      ) : !options.data.options.length ? (
        <p className="text-sm text-slate-600">{t("bk.noOptions")}</p>
      ) : (
        <>
          <ul className="mb-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {options.data.options.map((o) => (
              <li
                key={o.ledgerLineIds.join()}
                className="flex items-start justify-between gap-3 p-3"
              >
                <LinesList lines={o.lines} />
                <Button
                  variant="secondary"
                  className="shrink-0"
                  busy={action.busy}
                  onClick={() => accept(o.ledgerLineIds, true)}
                >
                  {t("bk.accept")}
                </Button>
              </li>
            ))}
          </ul>
          <div className="rounded-lg bg-emerald-50 p-3">
            {!suggestion ? (
              <Button
                variant="secondary"
                busy={action.busy}
                onClick={() =>
                  action.run(async () =>
                    setSuggestion(
                      await api.post(
                        `/bank-statement-lines/${line.id}/ai-suggestion`,
                      ),
                    ),
                  )
                }
              >
                {t("bk.askAi")}
              </Button>
            ) : suggestion.suggestion ? (
              <div>
                <p className="mb-1 text-sm font-semibold text-emerald-900">
                  {t("bk.ai.says")}
                </p>
                <LinesList lines={suggestion.suggestion.lines} />
                {suggestion.reason && (
                  <p className="mt-1 text-sm text-emerald-900">
                    “{suggestion.reason}”
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-600">
                  {t("bk.ai.check")}
                </p>
                <Button
                  className="mt-2"
                  busy={action.busy}
                  onClick={() =>
                    accept(suggestion.suggestion!.ledgerLineIds, true)
                  }
                >
                  {t("bk.accept")}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-emerald-900">
                {t("bk.ai.none")}
                {suggestion.reason ? ` “${suggestion.reason}”` : ""}
              </p>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function RecordDialog({
  account,
  line,
  onClose,
}: {
  account: BankAccount;
  line: StatementLine;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const accounts = useAccounts(account.companyId);
  const [f, setF] = useState({ accountId: "", narration: line.description });
  const income = Number(line.amount) > 0;
  return (
    <Modal title={t("bk.record")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const v = await save.run(() =>
            api.post<{ number: string }>(
              `/bank-statement-lines/${line.id}/voucher`,
              f,
            ),
          );
          if (v && typeof v === "object")
            save.run(
              async () => undefined,
              t("bk.recorded", { number: v.number }),
            );
        }}
      >
        <p className="mb-3 text-sm text-slate-600">{t("bk.recordHint")}</p>
        <ActionMessage action={save} />
        <Field label={t("bk.recordAccount")}>
          <AccountSelect
            id="record-account"
            required
            accounts={accounts.postable}
            value={f.accountId}
            onChange={(accountId) => setF({ ...f, accountId })}
            filter={(a) => a.type === (income ? "income" : "expense")}
          />
        </Field>
        <Field label={t("bk.narration")}>
          <Input
            required
            maxLength={500}
            value={f.narration}
            onChange={(e) => setF({ ...f, narration: e.target.value })}
            id="record-narration"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("bk.record")}
        />
      </form>
    </Modal>
  );
}

function UndoDialog({
  matchId,
  onClose,
  onDone,
}: {
  matchId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const match = useApi<BankMatch>(`/bank-matches/${matchId}`);
  const [reason, setReason] = useState("");
  return (
    <Modal title={t("bk.undo")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/bank-matches/${matchId}/undo`, { reason }),
            )
          )
            onDone();
        }}
      >
        {match.data && (
          <p className="mb-3 text-sm">
            <Badge color="gray">{t(`bk.kind.${match.data.kind}`)}</Badge>{" "}
            {formatTaka(match.data.total, lang)} ·{" "}
            {formatDate(match.data.matchedAt.slice(0, 10), lang, {
              short: true,
            })}
            {match.data.note && ` · ${match.data.note}`}
          </p>
        )}
        <ActionMessage action={save} />
        <Field label={t("bk.undoReason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="undo-reason"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("bk.undo")}
        />
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------ reconciliation

export function ReconciliationPanel({ account }: { account: BankAccount }) {
  const { t, lang } = useI18n();
  const [asOf, setAsOf] = useState(dhakaToday());
  const r = useApi<Reconciliation>(
    `/bank-accounts/${account.id}/reconciliation?asOf=${asOf}`,
  );
  const d = r.data;
  const row = (label: string, value: string | null, strong = false) => (
    <div
      className={`flex justify-between gap-4 border-b border-slate-100 py-1.5 ${strong ? "font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">
        <Taka value={value} />
      </span>
    </div>
  );
  const neg = (v: string) =>
    Number(v) === 0 ? "0.00" : (-Number(v)).toFixed(2);
  return (
    <>
      <Panel
        title={`${account.bankName} · ${account.accountNo}`}
        actions={
          <>
            <Field label={t("bk.asOf")}>
              <Input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                id="recon-as-of"
              />
            </Field>
            <Button
              variant="ghost"
              className="print:hidden"
              onClick={() => window.print()}
            >
              {t("bk.print")}
            </Button>
          </>
        }
      >
        {r.error ? (
          <ErrorBox error={r.error} onRetry={r.reload} />
        ) : !d ? (
          <Loading />
        ) : d.bankBalance === null ? (
          <p className="text-sm text-slate-600">
            {t("bk.beforeStart", { date: formatDate(d.reconcileFrom, lang) })}
          </p>
        ) : (
          <div className="max-w-2xl text-sm">
            {row(t("bk.bankBalance"), d.bankBalance, true)}
            {row(t("bk.addTransit"), d.depositsInTransit.total)}
            {row(t("bk.lessUnpresented"), d.unpresentedPayments.total)}
            {row(t("bk.lessBankCredits"), neg(d.bankCreditsNotInBooks.total))}
            {row(t("bk.addBankDebits"), neg(d.bankDebitsNotInBooks.total))}
            {row(t("bk.adjusted"), d.adjustedBankBalance, true)}
            {row(t("bk.ledgerBalance"), d.ledgerBalance, true)}
            <p
              className={`mt-3 rounded-lg px-3 py-2 font-medium ${d.reconciled ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}
              role="status"
            >
              {d.reconciled
                ? t("bk.reconciled")
                : t("bk.notReconciled", {
                    amount: formatTaka(d.difference ?? "0", lang),
                  })}
            </p>
            {d.statementAgrees === false && (
              <p className="mt-2 text-sm text-amber-800">
                {t("bk.statementDisagrees", {
                  amount: formatTaka(d.statementShowsBalance ?? "0", lang),
                })}
              </p>
            )}
          </div>
        )}
      </Panel>
      {d && d.bankBalance !== null && (
        <>
          <ItemsPanel
            title={t("bk.addTransit")}
            lines={d.depositsInTransit.lines}
          />
          <ItemsPanel
            title={t("bk.lessUnpresented")}
            lines={d.unpresentedPayments.lines}
          />
          <ItemsPanel
            title={t("bk.lessBankCredits")}
            lines={d.bankCreditsNotInBooks.lines}
          />
          <ItemsPanel
            title={t("bk.addBankDebits")}
            lines={d.bankDebitsNotInBooks.lines}
          />
        </>
      )}
    </>
  );
}

function ItemsPanel({
  title,
  lines,
}: {
  title: string;
  lines: Array<LedgerLine | StatementLine>;
}) {
  const { t, lang } = useI18n();
  if (!lines.length) return null;
  return (
    <Panel title={title}>
      <Table
        rows={lines}
        rowKey={(l) => l.id}
        columns={[
          {
            key: "date",
            label: t("bk.date"),
            render: (l) => formatDate(l.date, lang, { short: true }),
          },
          {
            key: "what",
            label: t("bk.description"),
            render: (l) =>
              "voucherNumber" in l
                ? `${l.voucherNumber} · ${l.narration}`
                : `${l.description}${l.reference ? ` (${l.reference})` : ""}`,
          },
          {
            key: "amount",
            label: t("bk.amount"),
            align: "right",
            render: (l) => <Taka value={l.amount} />,
          },
        ]}
      />
    </Panel>
  );
}
