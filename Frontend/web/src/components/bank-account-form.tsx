"use client";
/**
 * Request a new salary account (bank or mobile wallet) for an employee: used by
 * the employee in the app (their own) and by HR in the portal. The request goes
 * to HR for approval; until then salary keeps going to the current account.
 * HR (2FA) is asked for the step-up code by the portal's handler; in the app, an
 * employee who has set up 2FA types the code into the form.
 */
import { useRef, useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const WALLETS = ["bkash", "nagad", "rocket", "upay"] as const;

export function BankAccountForm({
  employeeId,
  onDone,
  onCancel,
}: {
  employeeId: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<"bank" | "wallet">("bank");
  const [f, setF] = useState({
    accountName: "",
    bankName: "",
    branchName: "",
    routingNumber: "",
    accountNumber: "",
    walletProvider: "bkash",
    walletNumber: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askCode, setAskCode] = useState(false);
  const [code, setCode] = useState("");
  // the same key when the request is sent again with the code
  const key = useRef(crypto.randomUUID());
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body =
      kind === "bank"
        ? {
            kind,
            accountName: f.accountName,
            bankName: f.bankName,
            branchName: f.branchName,
            routingNumber: f.routingNumber,
            accountNumber: f.accountNumber,
          }
        : {
            kind,
            accountName: f.accountName,
            walletProvider: f.walletProvider,
            walletNumber: f.walletNumber,
          };
    try {
      await api.post(
        `/employees/${employeeId}/bank-accounts`,
        body,
        key.current,
        askCode ? code : undefined,
      );
      onDone();
    } catch (err) {
      if ((err as ApiError).code === "AUTH_STEP_UP_REQUIRED") setAskCode(true);
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <Alert kind="error">{error}</Alert>}
      <p className="mb-3 text-sm text-slate-600">{t("py.bank.hint")}</p>
      <Field label={t("py.bank.kind")}>
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value as "bank" | "wallet")}
          id="bank-kind"
        >
          <option value="bank">{t("py.bank.kind.bank")}</option>
          <option value="wallet">{t("py.bank.kind.wallet")}</option>
        </Select>
      </Field>
      <Field label={t("py.bank.accountName")}>
        <Input
          required
          maxLength={150}
          value={f.accountName}
          onChange={set("accountName")}
          id="bank-account-name"
          autoComplete="name"
        />
      </Field>
      {kind === "bank" ? (
        <>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Field label={t("py.bank.bankName")}>
              <Input
                required
                maxLength={150}
                placeholder="Dutch-Bangla Bank PLC"
                value={f.bankName}
                onChange={set("bankName")}
                id="bank-name"
              />
            </Field>
            <Field label={t("py.bank.branch")}>
              <Input
                required
                maxLength={150}
                value={f.branchName}
                onChange={set("branchName")}
                id="bank-branch"
              />
            </Field>
          </div>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Field label={t("py.bank.routing")}>
              <Input
                required
                inputMode="numeric"
                pattern="[0-9]{9}"
                maxLength={9}
                value={f.routingNumber}
                onChange={set("routingNumber")}
                id="bank-routing"
              />
            </Field>
            <Field label={t("py.bank.accountNumber")}>
              <Input
                required
                inputMode="numeric"
                pattern="[0-9]{8,20}"
                maxLength={20}
                value={f.accountNumber}
                onChange={set("accountNumber")}
                id="bank-number"
              />
            </Field>
          </div>
        </>
      ) : (
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("py.bank.wallet")}>
            <Select
              value={f.walletProvider}
              onChange={set("walletProvider")}
              id="bank-wallet"
            >
              {WALLETS.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("py.bank.walletNumber")}>
            <Input
              required
              inputMode="tel"
              pattern="01[3-9][0-9]{8}"
              placeholder="01712345678"
              maxLength={11}
              value={f.walletNumber}
              onChange={set("walletNumber")}
              id="bank-wallet-number"
            />
          </Field>
        </div>
      )}
      {askCode && (
        <Field label={t("p.stepUp.code")}>
          <Input
            required
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            id="bank-otp"
          />
        </Field>
      )}
      <div className="mt-2 flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        )}
        <Button type="submit" busy={busy}>
          {t("common.submit")}
        </Button>
      </div>
    </form>
  );
}
