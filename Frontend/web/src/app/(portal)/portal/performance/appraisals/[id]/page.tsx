"use client";
/**
 * One appraisal (Phase 3 WP30): its goals and weights, the employee's self-review, the
 * manager's rating (with an AI draft to rewrite), HR's calibration, the year's feedback, and
 * the increment or promotion it leads to.
 *
 * Which parts are editable follows the step the appraisal is at, and who is looking.
 */
import Link from "next/link";
import { use, useState } from "react";
import {
  ActionMessage,
  Detail,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  Alert,
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
import { formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  APPRAISAL_STATE_COLOR,
  FEEDBACK_COLOR,
  FEEDBACK_KINDS,
  PROPOSAL_KINDS,
  PROPOSAL_STATE_COLOR,
  type Appraisal,
  type FeedbackNote,
  type Kpi,
  type Proposal,
  type ReviewDraft,
} from "@/lib/performance-types";
import type { Designation, Grade } from "@/lib/portal-types";

interface GoalRow {
  kpiId: string;
  title: string;
  target: string;
  weight: string;
}

export default function AppraisalPage({
  params,
}: PageProps<"/portal/performance/appraisals/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  const goalsAction = useAction();
  const selfAction = useAction();
  const rateAction = useAction();
  const calibrateAction = useAction();
  const draftAction = useAction();
  const feedbackAction = useAction();
  const proposalAction = useAction();

  const appraisal = useApi<Appraisal>(`/appraisals/${id}`);
  const kpis = useApi<{ kpis: Kpi[] }>(
    company ? `/companies/${company.id}/kpis` : null,
  );
  const feedback = useApi<{ notes: FeedbackNote[] }>(
    appraisal.data ? `/employees/${appraisal.data.employeeId}/feedback` : null,
  );
  const proposal = useApi<Proposal>(
    appraisal.data?.proposal
      ? `/increment-proposals/${appraisal.data.proposal.id}`
      : null,
  );

  const [goalRows, setGoalRows] = useState<GoalRow[] | null>(null);
  const [self, setSelf] = useState({ review: "", scores: {} as Record<string, string> });
  const [rating, setRating] = useState({
    rating: "",
    comment: "",
    scores: {} as Record<string, string>,
  });
  const [calibration, setCalibration] = useState({ rating: "", note: "" });
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [note, setNote] = useState({
    body: "",
    kind: "note",
    shared: false,
  });

  if (appraisal.loading && !appraisal.data) return <Loading />;
  if (appraisal.error)
    return <ErrorBox error={appraisal.error} onRetry={appraisal.reload} />;
  const a = appraisal.data!;
  const mayManage = can("performance.manage");
  const mayRate = can("performance.rate") || mayManage;
  const isMine = can("performance.own") && !!a.goals;
  const rows: GoalRow[] =
    goalRows ??
    a.goals.map((g) => ({
      kpiId: g.kpiId ?? "",
      title: g.title,
      target: g.target ?? "",
      weight: String(g.weight),
    }));
  const setRow = (i: number, patch: Partial<GoalRow>) =>
    setGoalRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {a.employeeName ?? t("pf.appraisal")}
            <Badge color={APPRAISAL_STATE_COLOR[a.state]}>
              {t(`pf.appState.${a.state}`)}
            </Badge>
            {a.finalRating && (
              <Badge color="green">
                {t("pf.finalRating")}: {a.finalRating}
              </Badge>
            )}
          </span>
        }
        subtitle={`${a.cycle.name} · ${a.cycle.periodFrom} – ${a.cycle.periodTo}`}
        actions={
          <Link
            className="text-sm underline"
            href={`/portal/performance/cycles/${a.cycle.id}`}
          >
            {t("pf.cycles")}
          </Link>
        }
      />

      <Panel title={t("pf.goals")}>
        <p className="mb-3 text-xs text-slate-500">{t("pf.weightsHint")}</p>
        <Table
          rows={a.goals}
          rowKey={(g) => g.id}
          empty={t("st.none")}
          columns={[
            {
              key: "title",
              label: t("pf.goal"),
              render: (g) => (
                <span>
                  {g.title}
                  {g.kpiCode && (
                    <span className="block font-mono text-xs text-slate-500">
                      {g.kpiCode}
                    </span>
                  )}
                </span>
              ),
            },
            { key: "target", label: t("pf.target"), render: (g) => g.target ?? "—" },
            {
              key: "weight",
              label: t("pf.weight"),
              align: "right",
              render: (g) => g.weight,
            },
            {
              key: "self",
              label: t("pf.selfScore"),
              align: "right",
              render: (g) => g.selfScore ?? "—",
            },
            {
              key: "manager",
              label: t("pf.managerScore"),
              align: "right",
              render: (g) => g.managerScore ?? "—",
            },
          ]}
        />
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Detail label={t("pf.weights")}>{a.weights}</Detail>
          <Detail label={t("pf.weightedScore")}>
            {a.weightedScore ?? "—"}
          </Detail>
          <Detail label={t("pf.suggestedRating")}>
            {a.suggestedRating ?? "—"}
            <span className="block text-xs text-slate-500">
              {t("pf.suggestedHint")}
            </span>
          </Detail>
        </dl>

        {mayRate && ["goals", "self_review"].includes(a.state) && (
          <form
            className="mt-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const done = await goalsAction.run(
                () =>
                  api.put(`/appraisals/${a.id}/goals`, {
                    goals: rows
                      .filter((r) => r.title.trim())
                      .map((r) => ({
                        ...(r.kpiId ? { kpiId: r.kpiId } : {}),
                        title: r.title,
                        ...(r.target ? { target: r.target } : {}),
                        weight: Number(r.weight || 0),
                      })),
                  }),
                t("pf.saved"),
              );
              if (done) {
                setGoalRows(null);
                appraisal.reload();
              }
            }}
          >
            <ActionMessage action={goalsAction} />
            {rows.map((r, i) => (
              <div
                key={i}
                className="grid gap-3 sm:grid-cols-[1fr_12rem_8rem_6rem_auto] sm:items-end"
              >
                <Field label={t("pf.goal")}>
                  <Input
                    required
                    id={`goal-title-${i}`}
                    value={r.title}
                    onChange={(e) => setRow(i, { title: e.target.value })}
                  />
                </Field>
                <Field label={t("pf.fromKpi")}>
                  <Select
                    id={`goal-kpi-${i}`}
                    value={r.kpiId}
                    onChange={(e) => {
                      const kpi = (kpis.data?.kpis ?? []).find(
                        (k) => k.id === e.target.value,
                      );
                      setRow(i, {
                        kpiId: e.target.value,
                        ...(kpi
                          ? {
                              title: r.title || kpi.title,
                              weight: r.weight || String(kpi.defaultWeight),
                            }
                          : {}),
                      });
                    }}
                  >
                    <option value="">—</option>
                    {(kpis.data?.kpis ?? []).map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.title}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("pf.target")}>
                  <Input
                    id={`goal-target-${i}`}
                    value={r.target}
                    onChange={(e) => setRow(i, { target: e.target.value })}
                  />
                </Field>
                <Field label={t("pf.weight")}>
                  <Input
                    required
                    type="number"
                    min={1}
                    max={100}
                    id={`goal-weight-${i}`}
                    value={r.weight}
                    onChange={(e) => setRow(i, { weight: e.target.value })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  className="mb-3"
                  onClick={() => setGoalRows(rows.filter((_, j) => j !== i))}
                >
                  {t("pf.removeGoal")}
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setGoalRows([
                    ...rows,
                    { kpiId: "", title: "", target: "", weight: "" },
                  ])
                }
              >
                {t("pf.addGoal")}
              </Button>
              <Button type="submit" busy={goalsAction.busy}>
                {t("pf.setGoals")}
              </Button>
            </div>
          </form>
        )}
      </Panel>

      <Panel title={t("pf.selfReview")}>
        {a.selfReview ? (
          <p className="whitespace-pre-wrap text-sm">{a.selfReview}</p>
        ) : isMine && a.state === "self_review" ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const done = await selfAction.run(
                () =>
                  api.post(`/appraisals/${a.id}/self-review`, {
                    review: self.review,
                    scores: Object.entries(self.scores)
                      .filter(([, v]) => v)
                      .map(([goalId, v]) => ({
                        goalId,
                        score: Number(v),
                      })),
                  }),
                t("pf.saved"),
              );
              if (done) appraisal.reload();
            }}
          >
            <ActionMessage action={selfAction} />
            {a.goals.map((g) => (
              <Field key={g.id} label={`${g.title} — ${t("pf.score")}`}>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  id={`self-score-${g.id}`}
                  value={self.scores[g.id] ?? ""}
                  onChange={(e) =>
                    setSelf({
                      ...self,
                      scores: { ...self.scores, [g.id]: e.target.value },
                    })
                  }
                />
              </Field>
            ))}
            <Field label={t("pf.selfReview")} hint={t("pf.selfReviewHint")}>
              <TextArea
                required
                rows={5}
                maxLength={8000}
                id="self-review"
                value={self.review}
                onChange={(e) => setSelf({ ...self, review: e.target.value })}
              />
            </Field>
            <Button type="submit" busy={selfAction.busy}>
              {t("pf.submitSelfReview")}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-500">{t("st.none")}</p>
        )}
      </Panel>

      {mayRate && (
        <Panel title={t("pf.rate")}>
          {a.managerComment ? (
            <div className="grid gap-3">
              <Detail label={t("pf.managerRating")}>
                <Badge color="blue">{a.managerRating}</Badge>
              </Detail>
              <p className="whitespace-pre-wrap text-sm">{a.managerComment}</p>
            </div>
          ) : a.state === "manager_review" ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const done = await rateAction.run(
                  () =>
                    api.post(`/appraisals/${a.id}/rate`, {
                      rating: Number(rating.rating),
                      comment: rating.comment,
                      scores: Object.entries(rating.scores)
                        .filter(([, v]) => v)
                        .map(([goalId, v]) => ({
                          goalId,
                          score: Number(v),
                        })),
                    }),
                  t("pf.saved"),
                );
                if (done) appraisal.reload();
              }}
            >
              <ActionMessage action={rateAction} />
              <ActionMessage action={draftAction} />
              <div className="mb-3">
                <Button
                  type="button"
                  variant="secondary"
                  busy={draftAction.busy}
                  onClick={async () => {
                    const d = await draftAction.run<ReviewDraft>(() =>
                      api.post<ReviewDraft>(
                        `/appraisals/${a.id}/review-draft`,
                      ),
                    );
                    if (d) {
                      setDraft(d);
                      setRating({ ...rating, comment: d.draft });
                    }
                  }}
                >
                  {t("pf.getDraft")}
                </Button>
                <span className="block text-xs text-slate-500">
                  {t("pf.draftHint")}
                </span>
              </div>
              {draft && (
                <Alert kind="info">
                  {t("pf.draft")} · {draft.model}
                </Alert>
              )}
              {a.goals.map((g) => (
                <Field key={g.id} label={`${g.title} — ${t("pf.score")}`}>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    id={`manager-score-${g.id}`}
                    value={rating.scores[g.id] ?? ""}
                    onChange={(e) =>
                      setRating({
                        ...rating,
                        scores: { ...rating.scores, [g.id]: e.target.value },
                      })
                    }
                  />
                </Field>
              ))}
              <Field label={t("pf.rating")}>
                <Input
                  required
                  type="number"
                  min={1}
                  max={5}
                  id="manager-rating"
                  value={rating.rating}
                  onChange={(e) =>
                    setRating({ ...rating, rating: e.target.value })
                  }
                />
              </Field>
              <Field label={t("pf.comment")}>
                <TextArea
                  required
                  rows={6}
                  maxLength={8000}
                  id="manager-comment"
                  value={rating.comment}
                  onChange={(e) =>
                    setRating({ ...rating, comment: e.target.value })
                  }
                />
              </Field>
              <Button type="submit" busy={rateAction.busy}>
                {t("pf.submitRating")}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-slate-500">{t("st.none")}</p>
          )}
        </Panel>
      )}

      {mayManage && (
        <Panel title={t("pf.calibrate")}>
          {a.calibratedRating ? (
            <div className="grid gap-3">
              <Detail label={t("pf.calibratedRating")}>
                <Badge color="green">{a.calibratedRating}</Badge>
              </Detail>
              <Detail label={t("pf.calibrationNote")}>
                {a.calibrationNote ?? "—"}
              </Detail>
            </div>
          ) : a.managerRating ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const done = await calibrateAction.run(
                  () =>
                    api.post(`/appraisals/${a.id}/calibrate`, {
                      rating: Number(calibration.rating),
                      ...(calibration.note ? { note: calibration.note } : {}),
                    }),
                  t("pf.saved"),
                );
                if (done) appraisal.reload();
              }}
            >
              <ActionMessage action={calibrateAction} />
              <Field label={t("pf.rating")}>
                <Input
                  required
                  type="number"
                  min={1}
                  max={5}
                  id="calibrated-rating"
                  value={calibration.rating}
                  onChange={(e) =>
                    setCalibration({ ...calibration, rating: e.target.value })
                  }
                />
              </Field>
              <Field label={t("pf.calibrationNote")}>
                <TextArea
                  rows={2}
                  maxLength={2000}
                  id="calibration-note"
                  value={calibration.note}
                  onChange={(e) =>
                    setCalibration({ ...calibration, note: e.target.value })
                  }
                />
              </Field>
              <Button type="submit" busy={calibrateAction.busy}>
                {t("pf.submitCalibration")}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-slate-500">{t("st.none")}</p>
          )}
        </Panel>
      )}

      <Panel title={t("pf.feedback")}>
        <ul className="mb-4 space-y-2">
          {(feedback.data?.notes ?? []).length === 0 && (
            <li className="text-sm text-slate-500">{t("pf.noFeedback")}</li>
          )}
          {(feedback.data?.notes ?? []).map((n) => (
            <li key={n.id} className="border-l-2 border-slate-200 pl-3 text-sm">
              <p>
                <Badge color={FEEDBACK_COLOR[n.kind]}>
                  {t(`pf.kind.${n.kind}`)}
                </Badge>{" "}
                {n.body}
              </p>
              <p className="text-xs text-slate-500">
                {n.at.slice(0, 10)}
                {n.sharedWithEmployee ? ` · ${t("pf.sharedWithEmployee")}` : ""}
              </p>
            </li>
          ))}
        </ul>
        {mayRate && (
          <form
            className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              const done = await feedbackAction.run(
                () =>
                  api.post(`/employees/${a.employeeId}/feedback`, {
                    body: note.body,
                    kind: note.kind,
                    sharedWithEmployee: note.shared,
                  }),
                t("pf.saved"),
              );
              if (done) {
                setNote({ body: "", kind: "note", shared: false });
                feedback.reload();
              }
            }}
          >
            <ActionMessage action={feedbackAction} />
            <Field label={t("pf.feedbackBody")}>
              <Input
                required
                maxLength={4000}
                id="feedback-body"
                value={note.body}
                onChange={(e) => setNote({ ...note, body: e.target.value })}
              />
            </Field>
            <Field label={t("pf.feedbackKind")}>
              <Select
                id="feedback-kind"
                value={note.kind}
                onChange={(e) => setNote({ ...note, kind: e.target.value })}
              >
                {FEEDBACK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`pf.kind.${k}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="mb-3">
              <label className="mb-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  id="feedback-shared"
                  checked={note.shared}
                  onChange={(e) =>
                    setNote({ ...note, shared: e.target.checked })
                  }
                />
                {t("pf.shareWithEmployee")}
              </label>
              <Button type="submit" busy={feedbackAction.busy}>
                {t("pf.addFeedback")}
              </Button>
            </div>
          </form>
        )}
      </Panel>

      <Panel title={t("pf.proposals")}>
        <ActionMessage action={proposalAction} />
        {proposal.data ? (
          <div className="grid gap-3">
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label={t("pf.proposalKind")}>
                {t(`pf.proposalKind.${proposal.data.kind}`)}{" "}
                <Badge color={PROPOSAL_STATE_COLOR[proposal.data.state]}>
                  {t(`pf.proposalState.${proposal.data.state}`)}
                </Badge>
              </Detail>
              <Detail label={t("pf.newGross")}>
                {proposal.data.newGross
                  ? formatTaka(proposal.data.newGross, lang)
                  : t("pf.salaryHidden")}
              </Detail>
              <Detail label={t("pf.effectiveFrom")}>
                {proposal.data.effectiveFrom}
              </Detail>
              <Detail label={t("pf.justification")}>
                {proposal.data.justification}
              </Detail>
              {proposal.data.newDesignationName && (
                <Detail label={t("pf.newDesignation")}>
                  {proposal.data.newDesignationName}
                </Detail>
              )}
              {proposal.data.newGradeName && (
                <Detail label={t("pf.newGrade")}>
                  {proposal.data.newGradeName}
                </Detail>
              )}
            </dl>
            {proposal.data.state === "approved" &&
              can("performance.propose") && (
                <div>
                  <Button
                    busy={proposalAction.busy}
                    onClick={() =>
                      proposalAction
                        .run(
                          () =>
                            api.post(
                              `/increment-proposals/${proposal.data!.id}/apply`,
                            ),
                          t("pf.saved"),
                        )
                        .then(() => (proposal.reload(), appraisal.reload()))
                    }
                  >
                    {t("pf.apply")}
                  </Button>
                  <span className="block text-xs text-slate-500">
                    {t("pf.applyHint")}
                  </span>
                </div>
              )}
            {proposal.data.state === "applied" && (
              <Alert kind="success">{t("pf.applyHint")}</Alert>
            )}
          </div>
        ) : can("performance.propose") ? (
          a.calibratedRating ? (
            <ProposalForm
              appraisalId={a.id}
              companyId={company?.id ?? ""}
              defaultFrom={a.cycle.incrementFrom ?? ""}
              onDone={() => appraisal.reload()}
            />
          ) : (
            <Alert kind="info">{t("pf.notCalibrated")}</Alert>
          )
        ) : (
          <p className="text-sm text-slate-500">{t("st.none")}</p>
        )}
      </Panel>
    </div>
  );
}

interface ProposalFields {
  kind: string;
  newGross: string;
  structureId: string;
  newDesignationId: string;
  newGradeId: string;
  effectiveFrom: string;
  justification: string;
}

function ProposalForm({
  appraisalId,
  companyId,
  defaultFrom,
  onDone,
}: {
  appraisalId: string;
  companyId: string;
  defaultFrom: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const structures = useApi<Array<{ id: string; code: string; name: string }>>(
    `/companies/${companyId}/salary-structures`,
  );
  const designations = useApi<Designation[]>(
    `/companies/${companyId}/designations`,
  );
  const grades = useApi<Grade[]>(`/companies/${companyId}/grades`);
  const [f, setF] = useState<ProposalFields>({
    kind: "increment",
    newGross: "",
    structureId: "",
    newDesignationId: "",
    newGradeId: "",
    effectiveFrom: defaultFrom,
    justification: "",
  });
  const wantsSalary = f.kind === "increment" || f.kind === "both";
  const wantsPost = f.kind === "promotion" || f.kind === "both";
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const done = await save.run(
          () =>
            api.post(`/appraisals/${appraisalId}/proposal`, {
              kind: f.kind,
              ...(wantsSalary
                ? { newGross: f.newGross, structureId: f.structureId }
                : {}),
              ...(wantsPost && f.newDesignationId
                ? { newDesignationId: f.newDesignationId }
                : {}),
              ...(wantsPost && f.newGradeId ? { newGradeId: f.newGradeId } : {}),
              ...(f.effectiveFrom ? { effectiveFrom: f.effectiveFrom } : {}),
              justification: f.justification,
            }),
          t("pf.saved"),
        );
        if (done) onDone();
      }}
    >
      <ActionMessage action={save} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("pf.proposalKind")}>
          <Select
            id="proposal-kind"
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
          >
            {PROPOSAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`pf.proposalKind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("pf.effectiveFrom")}>
          <Input
            type="date"
            id="proposal-from"
            value={f.effectiveFrom}
            onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })}
          />
        </Field>
        {wantsSalary && (
          <>
            <Field label={t("pf.newGross")}>
              <Input
                required
                inputMode="decimal"
                id="proposal-gross"
                value={f.newGross}
                onChange={(e) => setF({ ...f, newGross: e.target.value })}
              />
            </Field>
            <Field label={t("pf.structure")}>
              <Select
                required
                id="proposal-structure"
                value={f.structureId}
                onChange={(e) => setF({ ...f, structureId: e.target.value })}
              >
                <option value="">—</option>
                {(structures.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
        {wantsPost && (
          <>
            <Field label={t("pf.newDesignation")}>
              <Select
                id="proposal-designation"
                value={f.newDesignationId}
                onChange={(e) =>
                  setF({ ...f, newDesignationId: e.target.value })
                }
              >
                <option value="">—</option>
                {(designations.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nameEn}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("pf.newGrade")}>
              <Select
                id="proposal-grade"
                value={f.newGradeId}
                onChange={(e) => setF({ ...f, newGradeId: e.target.value })}
              >
                <option value="">—</option>
                {(grades.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
      </div>
      <Field label={t("pf.justification")}>
        <TextArea
          required
          rows={3}
          maxLength={2000}
          id="proposal-justification"
          value={f.justification}
          onChange={(e) => setF({ ...f, justification: e.target.value })}
        />
      </Field>
      <Button type="submit" busy={save.busy}>
        {t("pf.propose")}
      </Button>
    </form>
  );
}
