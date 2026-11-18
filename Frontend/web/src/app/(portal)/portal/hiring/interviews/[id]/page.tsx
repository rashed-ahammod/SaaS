"use client";
/**
 * One interview (Phase 3 WP29): when and where, who is on the panel, every scorecard given,
 * and the form a panel member fills in for themselves. HR records the round's outcome.
 */
import Link from "next/link";
import { use, useState } from "react";
import {
  ActionMessage,
  Detail,
  PageHeader,
  Panel,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { useWhen } from "@/components/portal/hiring";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
  TextArea,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { RECOMMENDATIONS, type Interview } from "@/lib/hiring-types";

export default function InterviewPage({
  params,
}: PageProps<"/portal/hiring/interviews/[id]">) {
  const { id } = use(params);
  const { t } = useI18n();
  const when = useWhen();
  const { can } = usePortal();
  const card = useAction();
  const finish = useAction();
  const [form, setForm] = useState({
    overall: "4",
    recommendation: "hire",
    notes: "",
    criteria: "",
  });
  const [outcome, setOutcome] = useState("proceed");
  const interview = useApi<Interview>(`/interviews/${id}`);
  if (interview.loading && !interview.data) return <Loading />;
  if (interview.error)
    return <ErrorBox error={interview.error} onRetry={interview.reload} />;
  const i = interview.data!;

  /** "Route knowledge: 5" per line -> { "Route knowledge": 5 } */
  const parseCriteria = (text: string) =>
    Object.fromEntries(
      text
        .split("\n")
        .map((line) => line.split(":"))
        .filter((parts) => parts.length >= 2 && Number(parts[1]?.trim()))
        .map((parts) => [
          parts[0].trim(),
          Math.min(5, Math.max(1, Number(parts[1].trim()))),
        ]),
    );

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t("hr.interviews")} · {t("hr.round")} {i.roundNo}
            <Badge color={i.state === "done" ? "green" : "amber"}>
              {i.outcome ? t(`hr.outcome.${i.outcome}`) : i.state}
            </Badge>
          </span>
        }
        subtitle={when(i.scheduledAt)}
        actions={
          <Link
            className="text-sm underline"
            href={`/portal/hiring/applications/${i.applicationId}`}
          >
            {t("hr.applicant")}
          </Link>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t("hr.interviews")}>
          <dl className="grid gap-3">
            <Detail label={t("hr.kind")}>{t(`hr.kind.${i.kind}`)}</Detail>
            <Detail label={t("hr.place")}>{i.place ?? "—"}</Detail>
            <Detail label={t("hr.panel")}>{i.panelUserIds.length}</Detail>
          </dl>
        </Panel>

        <Panel title={t("hr.scorecard")} className="lg:col-span-2">
          {i.scorecards.length === 0 ? (
            <p className="text-sm text-slate-500">{t("hr.scorecardMissing")}</p>
          ) : (
            <ul className="space-y-3">
              {i.scorecards.map((c) => (
                <li
                  key={c.id}
                  className="border-l-2 border-slate-200 pl-3 text-sm"
                >
                  <p>
                    <Badge
                      color={
                        c.recommendation === "hire"
                          ? "green"
                          : c.recommendation === "no_hire"
                            ? "red"
                            : "amber"
                      }
                    >
                      {t(`hr.rec.${c.recommendation}`)}
                    </Badge>{" "}
                    {t("hr.overall")}: {c.overall}
                  </p>
                  {Object.entries(c.scores ?? {}).length > 0 && (
                    <p className="text-xs text-slate-500">
                      {Object.entries(c.scores)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ")}
                    </p>
                  )}
                  {c.notes && <p className="mt-1">{c.notes}</p>}
                  <p className="text-xs text-slate-500">{when(c.at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {i.iAmOnPanel && i.state !== "cancelled" && (
        <Panel title={t("hr.myScorecard")}>
          <ActionMessage action={card} />
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const done = await card.run(
                () =>
                  api.post(`/interviews/${i.id}/scorecard`, {
                    overall: Number(form.overall),
                    recommendation: form.recommendation,
                    scores: parseCriteria(form.criteria),
                    ...(form.notes ? { notes: form.notes } : {}),
                  }),
                t("hr.saved"),
              );
              if (done) interview.reload();
            }}
          >
            <Field label={t("hr.overall")}>
              <Input
                required
                type="number"
                min={1}
                max={5}
                id="card-overall"
                value={form.overall}
                onChange={(e) => setForm({ ...form, overall: e.target.value })}
              />
            </Field>
            <Field label={t("hr.recommendation")}>
              <Select
                id="card-recommendation"
                value={form.recommendation}
                onChange={(e) =>
                  setForm({ ...form, recommendation: e.target.value })
                }
              >
                {RECOMMENDATIONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`hr.rec.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label={t("hr.scorecard")} hint="Route knowledge: 5">
                <TextArea
                  rows={3}
                  id="card-criteria"
                  value={form.criteria}
                  onChange={(e) =>
                    setForm({ ...form, criteria: e.target.value })
                  }
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label={t("hr.notes")}>
                <TextArea
                  rows={3}
                  maxLength={4000}
                  id="card-notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </Field>
            </div>
            <div>
              <Button type="submit" busy={card.busy}>
                {t("hr.giveScorecard")}
              </Button>
            </div>
          </form>
        </Panel>
      )}

      {can("recruitment.manage") && i.state === "scheduled" && (
        <Panel title={t("hr.finishInterview")}>
          <ActionMessage action={finish} />
          <form
            className="grid gap-3 sm:grid-cols-[12rem_auto] sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              const done = await finish.run(
                () => api.post(`/interviews/${i.id}/finish`, { outcome }),
                t("hr.saved"),
              );
              if (done) interview.reload();
            }}
          >
            <Field label={t("hr.outcome")}>
              <Select
                id="interview-outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              >
                {(["proceed", "hold", "reject"] as const).map((o) => (
                  <option key={o} value={o}>
                    {t(`hr.outcome.${o}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" className="mb-3" busy={finish.busy}>
              {t("hr.finishInterview")}
            </Button>
          </form>
        </Panel>
      )}
    </div>
  );
}
