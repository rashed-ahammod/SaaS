"use client";
/**
 * My salary advances: what I asked for, what is still owed, and a new request
 * (approved by my department head, then Accounts; deducted from salary monthly).
 */
import { useState, type FormEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
  Empty,
  ErrorBox,
  Field,
  Input,
  Loading,
  PageTitle,
  Row,
  TextArea,
} from "@/components/ui";
import type { Loan } from "@/components/portal/employee-payroll";
import { api, ApiError, useApi } from "@/lib/api";
import { dhakaToday, formatMonth, formatTaka, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

const STATE_COLOR = {
  pending: "amber",
  approved: "green",
  rejected: "red",
  cancelled: "gray",
  closed: "blue",
} as const;

function nextMonth(): string {
  const [y, m] = dhakaToday().split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export default function AdvancesPage() {
  const { t, lang } = useI18n();
  const { profile } = useSession();
  const loans = useApi<Loan[]>(
    profile ? `/employees/${profile.id}/loans` : null,
  );
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState(false);

  return (
    <div className="space-y-4">
      <PageTitle>{t("py.loan.title")}</PageTitle>
      {sent && <Alert kind="success">{t("py.loan.sent")}</Alert>}
      {asking && profile ? (
        <AskForm
          employeeId={profile.id}
          onCancel={() => setAsking(false)}
          onDone={() => {
            setAsking(false);
            setSent(true);
            loans.reload();
          }}
        />
      ) : (
        <Button
          className="w-full"
          onClick={() => (setSent(false), setAsking(true))}
        >
          {t("py.loan.ask")}
        </Button>
      )}
      {loans.loading || !profile ? (
        <Loading />
      ) : loans.error ? (
        <ErrorBox error={loans.error} onRetry={loans.reload} />
      ) : !loans.data?.length ? (
        <Empty>{t("py.loan.none")}</Empty>
      ) : (
        loans.data.map((l) => (
          <Card key={l.id}>
            <div className="mb-1 flex items-start justify-between gap-2">
              <span className="text-lg font-bold">
                {formatTaka(l.principal, lang)}
              </span>
              <Badge color={STATE_COLOR[l.state]}>
                {t(`py.loan.state.${l.state}`)}
              </Badge>
            </div>
            <p className="mb-2 text-sm text-slate-600">{l.reason}</p>
            <Row
              label={t("py.loan.installment")}
              value={formatTaka(l.installment, lang)}
            />
            <Row
              label={t("py.loan.firstPeriod")}
              value={formatMonth(l.firstPeriod, lang)}
            />
            {l.outstanding !== null && (
              <>
                <Row
                  label={t("py.loan.recovered")}
                  value={formatTaka(l.recovered, lang)}
                />
                <Row
                  label={t("py.loan.outstanding")}
                  value={formatTaka(l.outstanding, lang)}
                  strong
                />
              </>
            )}
          </Card>
        ))
      )}
    </div>
  );
}

function AskForm({
  employeeId,
  onCancel,
  onDone,
}: {
  employeeId: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const [f, setF] = useState({
    principal: "",
    installment: "",
    firstPeriod: nextMonth(),
    reason: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const months =
    Number(f.principal) > 0 && Number(f.installment) > 0
      ? Math.ceil(Number(f.principal) / Number(f.installment))
      : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/employees/${employeeId}/loans`, f);
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{t("py.loan.ask")}</CardTitle>
      <form onSubmit={submit}>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("py.loan.principal")}>
            <Input
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={f.principal}
              onChange={(e) => setF({ ...f, principal: e.target.value })}
              id="ask-principal"
            />
          </Field>
          <Field label={t("py.loan.installment")}>
            <Input
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={f.installment}
              onChange={(e) => setF({ ...f, installment: e.target.value })}
              id="ask-installment"
            />
          </Field>
        </div>
        <Field label={t("py.loan.firstPeriod")}>
          <Input
            type="month"
            required
            min={nextMonth()}
            value={f.firstPeriod}
            onChange={(e) => setF({ ...f, firstPeriod: e.target.value })}
            id="ask-first"
          />
        </Field>
        {months !== null && (
          <p className="mb-3 text-sm text-slate-600">
            {t("py.loan.plan", {
              installment: formatTaka(f.installment, lang),
              n: num(months, lang),
            })}
          </p>
        )}
        <Field label={t("py.loan.reason")}>
          <TextArea
            required
            maxLength={500}
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
            id="ask-reason"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" busy={busy}>
            {t("common.submit")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
