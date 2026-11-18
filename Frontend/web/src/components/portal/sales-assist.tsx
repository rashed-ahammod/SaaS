"use client";
/**
 * The sales assistant panel (Phase 3 WP31), on a lead or a customer.
 *
 * It asks for one thing at a time — a score with reasons, the next step, a follow-up
 * message, quotation text, or a summary of a call note — and shows the answer as text the
 * salesperson copies, edits and sends themselves. Nothing here saves anything: the assistant
 * suggests, the person acts.
 */
import { useState } from "react";
import { ActionMessage, Panel, useAction } from "@/components/portal/kit";
import {
  Alert,
  Badge,
  Button,
  Field,
  Select,
  TextArea,
} from "@/components/ui";
import { api } from "@/lib/api";
import type { AssistResult } from "@/lib/commission-types";
import { useI18n } from "@/lib/i18n";

const ASKS = [
  "score",
  "next_step",
  "follow_up",
  "quotation_text",
  "call_note",
] as const;

export function SalesAssistPanel({
  subject,
  id,
  /** A lead has no quotation text to draft until it is a customer. */
  asks = ASKS,
}: {
  subject: "lead" | "customer";
  id: string;
  asks?: readonly (typeof ASKS)[number][];
}) {
  const { t } = useI18n();
  const run = useAction();
  const [ask, setAsk] = useState<(typeof ASKS)[number]>(asks[0]);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<AssistResult | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <Panel title={t("cm.assist")}>
      <p className="mb-3 text-xs text-slate-500">{t("cm.assistHint")}</p>
      <ActionMessage action={run} />
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setCopied(false);
          const answer = await run.run<AssistResult>(() =>
            api.post<AssistResult>(`/${subject}s/${id}/assist`, {
              ask,
              ...(ask === "call_note" && note ? { note } : {}),
            }),
          );
          if (answer) setResult(answer);
        }}
      >
        <Field label={t("cm.assist")}>
          <Select
            id="assist-ask"
            value={ask}
            onChange={(e) => setAsk(e.target.value as (typeof ASKS)[number])}
          >
            {asks.map((a) => (
              <option key={a} value={a}>
                {t(`cm.ask.${a}`)}
              </option>
            ))}
          </Select>
        </Field>
        {ask === "call_note" && (
          <Field label={t("cm.callNote")}>
            <TextArea
              required
              rows={4}
              maxLength={4000}
              id="assist-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        )}
        <div>
          <Button type="submit" busy={run.busy}>
            {t(`cm.ask.${ask}`)}
          </Button>
        </div>
      </form>

      {result && (
        <div className="mt-4 grid gap-2">
          {result.score !== null && (
            <p>
              <Badge
                color={
                  result.score >= 70
                    ? "green"
                    : result.score >= 40
                      ? "amber"
                      : "gray"
                }
              >
                {t("cm.score")}: {result.score}
              </Badge>
            </p>
          )}
          {result.reasons.length > 0 && (
            <ul className="list-disc pl-5 text-sm">
              {result.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {result.text && (
            <>
              <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">
                {result.text}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(result.text!);
                      setCopied(true);
                    } catch {
                      setCopied(false);
                    }
                  }}
                >
                  {t("cm.copy")}
                </Button>
                {copied && <span className="text-xs text-emerald-700">{t("cm.copied")}</span>}
              </div>
            </>
          )}
          <p className="text-xs text-slate-500">
            {t("cm.model")}: {result.model}
          </p>
          <Alert kind="info">{t("cm.assistHint")}</Alert>
        </div>
      )}
    </Panel>
  );
}
