"use client";
/**
 * The AI assistant (WP11): questions about company policy and the user's own
 * leave, attendance and pay, in Bangla or English. Read-only: it answers and
 * points to the right screen; it never applies or changes anything.
 *
 * Shown only while the API says the assistant is available (GET /ai/status). If
 * the AI does not answer in time, the user sees the server's message and every
 * other screen keeps working.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  ErrorBox,
  Loading,
  PageTitle,
  Spinner,
  TextArea,
} from "@/components/ui";
import { api, useApi, type ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { AiStatus, AssistantAnswer } from "@/lib/types";

interface Turn {
  question: string;
  answer?: AssistantAnswer;
  error?: ApiError;
  feedback?: "helpful" | "not_helpful";
}

/** Earlier turns sent with a question, so follow-ups make sense (the API takes up to 6). */
function historyOf(turns: Turn[]) {
  return turns
    .filter((t) => t.answer)
    .slice(-3)
    .flatMap((t) => [
      { role: "user" as const, text: t.question },
      { role: "assistant" as const, text: t.answer!.answer },
    ]);
}

export default function AssistantPage() {
  const { t } = useI18n();
  const status = useApi<AiStatus>("/ai/status");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  // block body on purpose: newer browsers return a Promise from scrollIntoView, which must not become the effect's cleanup
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setQuestion("");
    const history = historyOf(turns);
    setTurns((all) => [...all, { question: q }]);
    try {
      const answer = await api.post<AssistantAnswer>("/ai/assistant", {
        question: q,
        history,
      });
      setTurns((all) =>
        all.map((turn, i) =>
          i === all.length - 1 ? { ...turn, answer } : turn,
        ),
      );
    } catch (error) {
      setTurns((all) =>
        all.map((turn, i) =>
          i === all.length - 1 ? { ...turn, error: error as ApiError } : turn,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function rate(index: number, action: "helpful" | "not_helpful") {
    const turn = turns[index];
    if (!turn.answer || turn.feedback) return;
    setTurns((all) =>
      all.map((x, i) => (i === index ? { ...x, feedback: action } : x)),
    );
    await api
      .post(`/ai/interactions/${turn.answer.interactionId}/feedback`, {
        action,
      })
      .catch(() => undefined);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(question);
  }

  if (status.loading) return <Loading />;
  if (!status.data?.assistant.available) {
    return (
      <div>
        <PageTitle>{t("ai.title")}</PageTitle>
        <Alert kind="info">{t("ai.unavailable")}</Alert>
        <ButtonLink href="/" variant="secondary" className="w-full">
          {t("nav.home")}
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageTitle>{t("ai.title")}</PageTitle>
      <Card className="mb-3">
        <p className="text-slate-700">{t("ai.intro")}</p>
        {turns.length === 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {(["ai.example1", "ai.example2", "ai.example3"] as const).map(
              (k) => (
                <button
                  key={k}
                  onClick={() => ask(t(k))}
                  className="min-h-11 rounded-xl bg-emerald-50 px-3 py-2 text-left text-emerald-900 ring-1 ring-emerald-200 active:bg-emerald-100"
                >
                  {t(k)}
                </button>
              ),
            )}
          </div>
        )}
      </Card>

      <ol className="space-y-3" aria-live="polite">
        {turns.map((turn, i) => (
          <li key={i} className="space-y-2">
            <p className="ml-10 rounded-2xl rounded-br-sm bg-emerald-700 px-3 py-2 text-white">
              {turn.question}
            </p>
            {turn.error ? (
              <ErrorBox error={turn.error} />
            ) : turn.answer ? (
              <div className="mr-6 rounded-2xl rounded-bl-sm bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200">
                <p className="whitespace-pre-line text-slate-900">
                  {turn.answer.answer}
                </p>
                {turn.answer.sources.length > 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    {t("ai.sources")}:{" "}
                    {turn.answer.sources
                      .slice(0, 2)
                      .map((s) =>
                        [s.title, s.heading].filter(Boolean).join(" — "),
                      )
                      .join("; ")}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  {turn.feedback ? (
                    <span className="text-xs text-slate-500">
                      {t("ai.thanks")}
                    </span>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        className="min-h-9 px-2 text-sm"
                        onClick={() => rate(i, "helpful")}
                      >
                        👍 {t("ai.helpful")}
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-h-9 px-2 text-sm"
                        onClick={() => rate(i, "not_helpful")}
                      >
                        👎 {t("ai.notHelpful")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p
                className="flex items-center gap-2 text-slate-500"
                role="status"
              >
                <Spinner small /> {t("ai.thinking")}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div ref={end} />

      <form
        onSubmit={submit}
        className="sticky bottom-24 mt-4 rounded-2xl bg-slate-50 pt-2"
      >
        <label className="sr-only" htmlFor="question">
          {t("ai.placeholder")}
        </label>
        <TextArea
          id="question"
          rows={2}
          maxLength={1000}
          value={question}
          placeholder={t("ai.placeholder")}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <Button
          type="submit"
          busy={busy}
          disabled={!question.trim()}
          className="mt-2 w-full"
        >
          {t("ai.send")}
        </Button>
        <p className="mt-2 text-center text-xs text-slate-500">
          {t("ai.disclaimer")}
        </p>
      </form>
    </div>
  );
}
