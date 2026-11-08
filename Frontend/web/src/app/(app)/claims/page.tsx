"use client";
/** Expense claims and cash advances: my claims (status), my advances, start a claim, ask for an advance. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AdvanceBadge, ClaimBadge } from "@/components/expenses";
import {
  Alert,
  Button,
  Card,
  CardTitle,
  Empty,
  ErrorBox,
  Field,
  Input,
  Loading,
  PageTitle,
  Select,
} from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import type { AdvanceSummary, ClaimSummary } from "@/lib/expense-types";
import { formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function ClaimsPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const claims = useApi<ClaimSummary[]>("/me/expense-claims");
  const advances = useApi<AdvanceSummary[]>("/me/expense-advances");
  const [mode, setMode] = useState<"none" | "claim" | "advance">("none");
  const [message, setMessage] = useState<string | null>(null);
  const openAdvances = (advances.data ?? []).filter((a) => a.state === "paid");

  return (
    <div className="space-y-4">
      <PageTitle>{t("x.title")}</PageTitle>
      {message && <Alert kind="success">{message}</Alert>}
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => setMode("claim")}>{t("x.new")}</Button>
        <Button variant="secondary" onClick={() => setMode("advance")}>
          {t("x.askAdvance")}
        </Button>
      </div>

      {mode === "claim" && (
        <NewClaim
          advances={openAdvances}
          onCancel={() => setMode("none")}
          onCreated={(id) => router.push(`/claims/${id}`)}
        />
      )}
      {mode === "advance" && (
        <AskAdvance
          onCancel={() => setMode("none")}
          onDone={() => {
            setMode("none");
            setMessage(t("x.advanceAsked"));
            advances.reload();
          }}
        />
      )}

      <Card>
        <CardTitle>{t("x.myClaims")}</CardTitle>
        {claims.loading ? (
          <Loading />
        ) : claims.error ? (
          <ErrorBox error={claims.error} onRetry={claims.reload} />
        ) : !claims.data?.filter((c) => c.state !== "cancelled").length ? (
          <Empty />
        ) : (
          <ul className="divide-y divide-slate-100">
            {claims.data
              .filter((c) => c.state !== "cancelled")
              .map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/claims/${c.id}`}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {c.title}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {c.number} ·{" "}
                        {formatDate(c.createdAt.slice(0, 10), lang, {
                          short: true,
                        })}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-semibold tabular-nums">
                        {formatTaka(c.total, lang)}
                      </span>
                      <ClaimBadge state={c.state} />
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardTitle>{t("x.myAdvances")}</CardTitle>
        {advances.loading ? (
          <Loading />
        ) : !advances.data?.length ? (
          <Empty />
        ) : (
          <ul className="divide-y divide-slate-100">
            {advances.data.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {a.purpose}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {a.number}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-semibold tabular-nums">
                    {formatTaka(a.amount, lang)}
                  </span>
                  {a.state === "paid" && (
                    <span className="block text-xs text-amber-700">
                      {t("x.open")}: {formatTaka(a.open, lang)}
                    </span>
                  )}
                  <AdvanceBadge state={a.state} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function NewClaim({
  advances,
  onCancel,
  onCreated,
}: {
  advances: AdvanceSummary[];
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const [title, setTitle] = useState("");
  const [advanceId, setAdvanceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const claim = await api.post<{ id: string }>("/me/expense-claims", {
        title: title.trim(),
        ...(advanceId ? { advanceId } : {}),
      });
      onCreated(claim.id);
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t("x.newTitle")} hint={t("x.titleHint")}>
          <Input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            id="claim-title"
          />
        </Field>
        {advances.length > 0 && (
          <Field label={t("x.againstAdvance")}>
            <Select
              value={advanceId}
              onChange={(e) => setAdvanceId(e.target.value)}
              id="claim-advance"
            >
              <option value="">{t("x.noAdvance")}</option>
              {advances.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.number} · {formatTaka(a.open, lang)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" busy={busy}>
            {t("x.new")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function AskAdvance({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [f, setF] = useState({ purpose: "", amount: "", neededBy: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/me/expense-advances", {
        purpose: f.purpose.trim(),
        amount: f.amount,
        ...(f.neededBy ? { neededBy: f.neededBy } : {}),
      });
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t("x.purpose")}>
          <Input
            required
            maxLength={300}
            value={f.purpose}
            onChange={(e) => setF({ ...f, purpose: e.target.value })}
            id="advance-purpose"
          />
        </Field>
        <Field label={t("x.amount")}>
          <Input
            required
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]{1,2})?"
            value={f.amount}
            onChange={(e) => setF({ ...f, amount: e.target.value })}
            id="advance-amount"
          />
        </Field>
        <Field label={t("x.neededBy")}>
          <Input
            type="date"
            value={f.neededBy}
            onChange={(e) => setF({ ...f, neededBy: e.target.value })}
            id="advance-needed"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" busy={busy}>
            {t("x.askAdvance")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
