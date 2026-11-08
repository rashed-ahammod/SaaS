"use client";
/**
 * One expense claim. While it is a draft: add expenses, take a photo of each receipt,
 * save, send for approval. Afterwards: where it is, what was settled and what is paid.
 */
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClaimBadge, ReceiptView } from "@/components/expenses";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardTitle,
  ErrorBox,
  Field,
  Input,
  Loading,
  PageTitle,
  Row,
  Select,
} from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import type { ReadDocument } from "@/lib/close-types";
import type { Claim, ExpenseCategory } from "@/lib/expense-types";
import { dhakaToday, formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

interface LineInput {
  expenseDate: string;
  categoryId: string;
  description: string;
  amount: string;
  receiptId: string | null;
  receiptType?: string;
}

export default function ClaimPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const router = useRouter();
  const claim = useApi<Claim>(`/expense-claims/${id}`);
  const categories = useApi<ExpenseCategory[]>(
    claim.data ? `/companies/${claim.data.companyId}/expense-categories` : null,
  );
  // the AI receipt reader (WP22), when the company has it switched on
  const ai = useApi<{ documentReader?: { available: boolean } }>("/ai/status");
  const [aiFilled, setAiFilled] = useState<number[]>([]);
  const [lines, setLines] = useState<LineInput[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // the draft's lines, once loaded
  useEffect(() => {
    if (!claim.data || lines !== null) return;
    const types = new Map(
      claim.data.receipts.map((r) => [r.id, r.contentType]),
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- copy the loaded lines into the editor once
    setLines(
      claim.data.lines.map((l) => ({
        expenseDate: l.expenseDate,
        categoryId: l.categoryId,
        description: l.description,
        amount: Number(l.amount).toString(),
        receiptId: l.receiptId,
        receiptType: l.receiptId ? types.get(l.receiptId) : undefined,
      })),
    );
  }, [claim.data, lines]);

  const active = useMemo(
    () => (categories.data ?? []).filter((c) => c.isActive),
    [categories.data],
  );
  if (claim.loading && !claim.data) return <Loading />;
  if (claim.error)
    return <ErrorBox error={claim.error} onRetry={claim.reload} />;
  const c = claim.data!;
  const draft = c.state === "draft";
  const catOf = (categoryId: string) => active.find((x) => x.id === categoryId);
  const needsReceipt = (l: LineInput) => {
    const cat = catOf(l.categoryId);
    return !!cat && Number(l.amount || 0) > Number(cat.receiptRequiredAbove);
  };
  const total =
    (lines ?? []).reduce(
      (n, l) => n + Math.round(Number(l.amount || 0) * 100),
      0,
    ) / 100;

  const run = async (
    key: string,
    work: () => Promise<unknown>,
    done?: string,
  ) => {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      await work();
      if (done) setMessage(done);
      return true;
    } catch (err) {
      const e = err as ApiError;
      const lineNos = (e.details as { lines?: number[] } | undefined)?.lines;
      setError(lineNos ? `${e.message} (${lineNos.join(", ")})` : e.message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const set = (i: number, patch: Partial<LineInput>) =>
    setLines((ls) => ls!.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const save = () =>
    api.patch<Claim>(`/expense-claims/${id}`, {
      version: claim.data!.version,
      lines: lines!.map((l) => ({
        expenseDate: l.expenseDate,
        categoryId: l.categoryId,
        description: l.description.trim(),
        amount: l.amount,
        ...(l.receiptId ? { receiptId: l.receiptId } : {}),
      })),
    });
  const upload = (i: number, file: File) =>
    run(
      `upload-${i}`,
      async () => {
        const form = new FormData();
        form.append("file", file);
        const r = await api.upload<{ id: string; contentType?: string }>(
          `/expense-claims/${id}/receipts`,
          form,
        );
        set(i, { receiptId: r.id, receiptType: r.contentType ?? file.type });
        // the receipt read by AI fills what is still empty on the line; the employee checks it
        if (ai.data?.documentReader?.available) {
          const read = new FormData();
          read.append("file", file);
          read.append("kind", "receipt");
          const doc = await api
            .upload<ReadDocument>("/ai/document-reader", read)
            .catch(() => null);
          if (doc?.readable && doc.fields) {
            const f = doc.fields;
            setLines((ls) =>
              ls!.map((l, j) =>
                j === i
                  ? {
                      ...l,
                      amount:
                        l.amount || (f.total ? String(Number(f.total)) : ""),
                      description:
                        l.description ||
                        [f.vendorName, f.lines[0]?.description]
                          .filter(Boolean)
                          .join(": ")
                          .slice(0, 300),
                      expenseDate:
                        f.date && f.date <= dhakaToday()
                          ? f.date
                          : l.expenseDate,
                    }
                  : l,
              ),
            );
            setAiFilled((xs) => [...new Set([...xs, i])]);
          }
        }
      },
      t("x.uploaded"),
    );

  return (
    <div className="space-y-4">
      <PageTitle
        action={
          <ButtonLink href="/claims" variant="ghost">
            {t("common.back")}
          </ButtonLink>
        }
      >
        {c.title}
      </PageTitle>
      <p className="-mt-2 text-sm text-slate-500">
        {c.number} · <ClaimBadge state={c.state} />
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      {message && <Alert kind="success">{message}</Alert>}

      {draft && lines ? (
        <>
          {lines.map((l, i) => (
            <Card key={i}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("x.date")}>
                    <Input
                      type="date"
                      required
                      max={dhakaToday()}
                      value={l.expenseDate}
                      onChange={(e) => set(i, { expenseDate: e.target.value })}
                      id={`line-date-${i}`}
                    />
                  </Field>
                  <Field label={t("x.amount")}>
                    <Input
                      required
                      inputMode="decimal"
                      value={l.amount}
                      onChange={(e) => set(i, { amount: e.target.value })}
                      id={`line-amount-${i}`}
                    />
                  </Field>
                </div>
                <Field label={t("x.category")}>
                  <Select
                    required
                    value={l.categoryId}
                    onChange={(e) => set(i, { categoryId: e.target.value })}
                    id={`line-category-${i}`}
                  >
                    <option value="">—</option>
                    {active.map((x) => (
                      <option key={x.id} value={x.id}>
                        {lang === "bn" && x.nameBn ? x.nameBn : x.nameEn}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("x.description")}>
                  <Input
                    required
                    maxLength={300}
                    value={l.description}
                    onChange={(e) => set(i, { description: e.target.value })}
                    id={`line-desc-${i}`}
                  />
                </Field>
                {aiFilled.includes(i) && (
                  <p className="text-sm text-emerald-800">
                    {t("cl.ai.filled")}
                  </p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {l.receiptId ? (
                      <ReceiptView
                        claimId={id}
                        receiptId={l.receiptId}
                        contentType={l.receiptType}
                      />
                    ) : (
                      <span
                        className={`text-sm ${needsReceipt(l) ? "font-semibold text-amber-700" : "text-slate-500"}`}
                      >
                        {needsReceipt(l)
                          ? t("x.receiptNeeded")
                          : t("x.receiptOptional")}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-white px-3 text-sm font-semibold text-emerald-800 ring-1 ring-emerald-700">
                      {busy === `upload-${i}`
                        ? t("x.uploading")
                        : `📷 ${t("x.takePhoto")}`}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        capture="environment"
                        className="sr-only"
                        aria-label={`${t("x.receipt")} ${i + 1}`}
                        id={`line-receipt-${i}`}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void upload(i, file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setLines(lines.filter((_, j) => j !== i))
                        }
                      >
                        {t("x.remove")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
          <Button
            variant="secondary"
            className="w-full"
            onClick={() =>
              setLines([
                ...lines,
                {
                  expenseDate: dhakaToday(),
                  categoryId: "",
                  description: "",
                  amount: "",
                  receiptId: null,
                },
              ])
            }
          >
            + {t("x.addLine")}
          </Button>
          <Card>
            <Row label={t("x.total")} value={formatTaka(total, lang)} strong />
          </Card>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              busy={busy === "save"}
              disabled={!lines.length}
              onClick={() =>
                run(
                  "save",
                  async () => (await save(), claim.reload()),
                  t("x.saved"),
                )
              }
            >
              {t("x.save")}
            </Button>
            <Button
              busy={busy === "submit"}
              disabled={!lines.length}
              onClick={async () => {
                const ok = await run(
                  "submit",
                  async () => {
                    await save();
                    await api.post(`/expense-claims/${id}/submit`);
                  },
                  t("x.submitted"),
                );
                if (ok) {
                  setLines(null);
                  claim.reload();
                }
              }}
            >
              {t("x.submit")}
            </Button>
          </div>
          <Button
            variant="ghost"
            className="w-full"
            busy={busy === "cancel"}
            onClick={() =>
              run("cancel", () =>
                api.post(`/expense-claims/${id}/cancel`),
              ).then((ok) => ok && router.push("/claims"))
            }
          >
            {t("x.cancel")}
          </Button>
        </>
      ) : (
        <>
          <Card>
            <CardTitle>{t("x.lines")}</CardTitle>
            <ul className="divide-y divide-slate-100">
              {c.lines.map((l) => (
                <li
                  key={l.lineNo}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{l.description}</span>
                    <span className="block text-xs text-slate-500">
                      {formatDate(l.expenseDate, lang, { short: true })} ·{" "}
                      {l.categoryName}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {l.receiptId && (
                      <ReceiptView
                        claimId={id}
                        receiptId={l.receiptId}
                        contentType={
                          c.receipts.find((r) => r.id === l.receiptId)
                            ?.contentType
                        }
                      />
                    )}
                    <span className="font-semibold tabular-nums">
                      {formatTaka(l.amount, lang)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <Row
              label={t("x.total")}
              value={formatTaka(c.total, lang)}
              strong
            />
            {Number(c.advanceApplied) > 0 && (
              <Row
                label={t("x.advanceApplied")}
                value={formatTaka(c.advanceApplied, lang)}
              />
            )}
            {["approved", "paid"].includes(c.state) && (
              <Row
                label={t("x.payable")}
                value={formatTaka(c.payable, lang)}
                strong
              />
            )}
          </Card>
          {c.state === "in_approval" && c.approvalRequestId && (
            <Button
              variant="ghost"
              className="w-full"
              busy={busy === "withdraw"}
              onClick={() => {
                const reason = window.prompt(t("ac.withdrawReason"));
                if (reason)
                  void run("withdraw", () =>
                    api.post(
                      `/approvals/requests/${c.approvalRequestId}/cancel`,
                      { comment: reason },
                    ),
                  ).then((ok) => ok && claim.reload());
              }}
            >
              {t("ac.withdraw")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
