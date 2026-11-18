"use client";
/**
 * One application (Phase 3 WP29): the applicant, the blind CV screening with its reasons,
 * the interviews, the offer, and — when the offer is accepted — the employee record it
 * became without anything being retyped.
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
  AppStateBadge,
  OfferStateBadge,
  useWhen,
} from "@/components/portal/hiring";
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
  INTERVIEW_KINDS,
  type Application,
  type Offer,
  type Screening,
} from "@/lib/hiring-types";
import type { Branch, Department, Designation, Grade } from "@/lib/portal-types";

export default function ApplicationPage({
  params,
}: PageProps<"/portal/hiring/applications/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const when = useWhen();
  const { company, can } = usePortal();
  const screen = useAction();
  const move = useAction();
  const schedule = useAction();
  const offerAction = useAction();
  const [screening, setScreening] = useState<Screening | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [moveNote, setMoveNote] = useState("");
  const [interview, setInterview] = useState({
    scheduledAt: "",
    kind: "in_person",
    place: "",
    panel: [] as string[],
  });
  const [offerForm, setOfferForm] = useState<OfferFields>({
    branchId: "",
    departmentId: "",
    designationId: "",
    gradeId: "",
    grossSalary: "",
    joiningOn: "",
    validUntil: "",
    probationMonths: "6",
    terms: "",
  });
  const application = useApi<Application>(`/applications/${id}`);
  const offer = useApi<Offer>(
    application.data?.offer ? `/job-offers/${application.data.offer.id}` : null,
  );
  const people = useApi<Array<{ userId: string; name: string }>>(
    company && can("recruitment.manage")
      ? `/companies/${company.id}/employees?pageSize=200`
      : null,
  );
  if (application.loading && !application.data) return <Loading />;
  if (application.error)
    return <ErrorBox error={application.error} onRetry={application.reload} />;
  const a = application.data!;
  const mayManage = can("recruitment.manage");
  const latest = a.screenings[0];
  const shown = screening ?? null;

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {a.applicant.name ?? t("hr.redacted")}
            <AppStateBadge state={a.state} />
          </span>
        }
        subtitle={`${a.opening.number} · ${a.opening.title}`}
        actions={
          mayManage &&
          !["hired", "rejected", "withdrawn"].includes(a.state) && (
            <Button
              busy={screen.busy}
              onClick={async () => {
                const result = await screen.run<Screening>(() =>
                  api.post<Screening>(`/applications/${a.id}/screen`),
                );
                if (result) {
                  setScreening(result);
                  application.reload();
                }
              }}
            >
              {t("hr.screen")}
            </Button>
          )
        }
      />
      <ActionMessage action={screen} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t("hr.applicant")}>
          <dl className="grid gap-3">
            <Detail label={t("hr.phone")}>{a.applicant.phone ?? "—"}</Detail>
            <Detail label={t("hr.email")}>{a.applicant.email ?? "—"}</Detail>
            <Detail label={t("hr.district")}>
              {a.applicant.district ?? "—"}
            </Detail>
            <Detail label={t("hr.source")}>
              {t(`hr.source.${a.applicant.source}`)}
              {a.applicant.sourceDetail
                ? ` · ${a.applicant.sourceDetail}`
                : ""}
            </Detail>
            <Detail label={t("hr.cv")}>
              {a.applicant.cvFileName ? (
                <a
                  className="underline"
                  href={`/api/erp/applicants/${a.applicant.id}/cv`}
                >
                  {t("hr.downloadCv")}
                </a>
              ) : a.applicant.hasCvText ? (
                t("hr.cvText")
              ) : (
                "—"
              )}
            </Detail>
            <Detail label={t("hr.retentionUntil")}>
              {a.applicant.retentionUntil}
              {a.applicant.redacted && (
                <>
                  {" "}
                  <Badge color="gray">{t("hr.redacted")}</Badge>
                </>
              )}
            </Detail>
            <Detail label={t("hr.appliedOn")}>{a.appliedOn}</Detail>
            {a.rejectedReason && (
              <Detail label={t("hr.rejectReason")}>{a.rejectedReason}</Detail>
            )}
            {a.hiredEmployeeId && (
              <Detail label={t("hr.hiredEmployee")}>
                <Link
                  className="underline"
                  href={`/portal/employees/${a.hiredEmployeeId}`}
                >
                  {t("hr.hiredEmployee")}
                </Link>
              </Detail>
            )}
          </dl>
        </Panel>

        <Panel title={t("hr.screening")} className="lg:col-span-2">
          <p className="mb-3 text-xs text-slate-500">{t("hr.screeningHint")}</p>
          {!latest && !shown ? (
            <p className="text-sm text-slate-500">{t("hr.noScreening")}</p>
          ) : (
            <div className="grid gap-3">
              <Detail label={t("hr.score")}>
                <Badge
                  color={
                    (shown?.score ?? latest?.score ?? 0) >= 70
                      ? "green"
                      : (shown?.score ?? latest?.score ?? 0) >= 40
                        ? "amber"
                        : "gray"
                  }
                >
                  {shown?.score ?? latest?.score}
                </Badge>
              </Detail>
              <Detail label={t("hr.reasons")}>
                <ul className="list-disc pl-5">
                  {(shown?.reasons ?? latest?.reasons ?? []).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </Detail>
              {shown?.removed?.length ? (
                <Detail label={t("hr.removedBefore")}>
                  <span className="text-xs text-slate-500">
                    {shown.removed.join(", ")}
                  </span>
                </Detail>
              ) : null}
              <Detail label={t("hr.model")}>
                <span className="text-xs text-slate-500">
                  {shown?.model ?? latest?.model} ·{" "}
                  {latest ? when(latest.at) : ""}
                </span>
              </Detail>
            </div>
          )}
        </Panel>
      </div>

      {mayManage && !["hired", "rejected", "withdrawn"].includes(a.state) && (
        <Panel title={t("hr.move")}>
          <ActionMessage action={move} />
          <form
            className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              const done = await move.run(
                () =>
                  api.post(`/applications/${a.id}/move`, {
                    to: moveTo,
                    ...(moveNote ? { note: moveNote } : {}),
                  }),
                t("hr.saved"),
              );
              if (done) {
                setMoveTo("");
                setMoveNote("");
                application.reload();
              }
            }}
          >
            <Field label={t("hr.move")}>
              <Select
                required
                id="move-to"
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value)}
              >
                <option value="">—</option>
                {(
                  ["screened", "shortlisted", "rejected", "withdrawn"] as const
                ).map((s) => (
                  <option key={s} value={s}>
                    {t(`hr.appState.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("hr.moveNote")}>
              <Input
                id="move-note"
                value={moveNote}
                onChange={(e) => setMoveNote(e.target.value)}
              />
            </Field>
            <Button type="submit" className="mb-3" busy={move.busy}>
              {t("hr.move")}
            </Button>
          </form>
        </Panel>
      )}

      <Panel title={t("hr.interviews")}>
        <Table
          rows={a.interviews}
          rowKey={(i) => i.id}
          empty={t("st.none")}
          columns={[
            {
              key: "round",
              label: t("hr.round"),
              render: (i) => i.roundNo,
            },
            {
              key: "kind",
              label: t("hr.kind"),
              render: (i) => t(`hr.kind.${i.kind}`),
            },
            {
              key: "when",
              label: t("hr.scheduledAt"),
              render: (i) => when(i.scheduledAt),
            },
            {
              key: "place",
              label: t("hr.place"),
              render: (i) => i.place ?? "",
            },
            {
              key: "state",
              label: t("hr.state"),
              render: (i) => (
                <Link
                  className="underline"
                  href={`/portal/hiring/interviews/${i.id}`}
                >
                  {i.outcome ? t(`hr.outcome.${i.outcome}`) : i.state}
                </Link>
              ),
            },
          ]}
        />
        {mayManage &&
          ["screened", "shortlisted", "interviewing"].includes(a.state) && (
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const done = await schedule.run(
                  () =>
                    api.post(`/applications/${a.id}/interviews`, {
                      scheduledAt: new Date(
                        interview.scheduledAt,
                      ).toISOString(),
                      kind: interview.kind,
                      ...(interview.place ? { place: interview.place } : {}),
                      panelUserIds: interview.panel,
                    }),
                  t("hr.saved"),
                );
                if (done) {
                  setInterview({ ...interview, scheduledAt: "", place: "" });
                  application.reload();
                }
              }}
            >
              <ActionMessage action={schedule} />
              <Field label={t("hr.scheduledAt")}>
                <Input
                  required
                  type="datetime-local"
                  id="interview-when"
                  value={interview.scheduledAt}
                  onChange={(e) =>
                    setInterview({ ...interview, scheduledAt: e.target.value })
                  }
                />
              </Field>
              <Field label={t("hr.kind")}>
                <Select
                  id="interview-kind"
                  value={interview.kind}
                  onChange={(e) =>
                    setInterview({ ...interview, kind: e.target.value })
                  }
                >
                  {INTERVIEW_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`hr.kind.${k}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("hr.place")}>
                <Input
                  id="interview-place"
                  value={interview.place}
                  onChange={(e) =>
                    setInterview({ ...interview, place: e.target.value })
                  }
                />
              </Field>
              <Field label={t("hr.panel")}>
                <Select
                  required
                  multiple
                  id="interview-panel"
                  value={interview.panel}
                  onChange={(e) =>
                    setInterview({
                      ...interview,
                      panel: [...e.target.selectedOptions].map((o) => o.value),
                    })
                  }
                >
                  {(people.data ?? []).map((p) => (
                    <option key={p.userId} value={p.userId}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <Button type="submit" busy={schedule.busy}>
                  {t("hr.scheduleInterview")}
                </Button>
              </div>
            </form>
          )}
      </Panel>

      <Panel title={t("hr.offer")}>
        <ActionMessage action={offerAction} />
        {offer.data ? (
          <div className="grid gap-3">
            {offer.data.outsideGradeRange &&
              offer.data.state === "in_approval" && (
                <Alert kind="warning">{t("hr.outsideGradeRange")}</Alert>
              )}
            <dl className="grid gap-3 sm:grid-cols-2">
              <Detail label={t("hr.number")}>
                <span className="font-mono">{offer.data.number}</span>{" "}
                <OfferStateBadge state={offer.data.state} />
              </Detail>
              <Detail label={t("hr.grossSalary")}>
                {offer.data.grossSalary
                  ? formatTaka(offer.data.grossSalary, lang)
                  : t("hr.salaryHidden")}
              </Detail>
              <Detail label={t("hr.joiningOn")}>{offer.data.joiningOn}</Detail>
              <Detail label={t("hr.validUntil")}>
                {offer.data.validUntil}
              </Detail>
              <Detail label={t("hr.probationMonths")}>
                {offer.data.probationMonths}
              </Detail>
              <Detail label={t("hr.designation")}>
                {offer.data.designationName ?? "—"}
              </Detail>
            </dl>
            <div className="flex flex-wrap gap-2">
              <a
                className="text-sm underline"
                href={`/api/erp/job-offers/${offer.data.id}/letter.pdf?lang=${lang}`}
              >
                {t("hr.letter")}
              </a>
              {mayManage &&
                ["draft", "approved"].includes(offer.data.state) && (
                  <Button
                    busy={offerAction.busy}
                    onClick={() =>
                      offerAction
                        .run(
                          () =>
                            api.post(`/job-offers/${offer.data!.id}/send`),
                          t("hr.saved"),
                        )
                        .then(() => (offer.reload(), application.reload()))
                    }
                  >
                    {t("hr.sendOffer")}
                  </Button>
                )}
              {mayManage && offer.data.state === "sent" && (
                <>
                  <Button
                    busy={offerAction.busy}
                    onClick={() =>
                      offerAction
                        .run(
                          () =>
                            api.post(`/job-offers/${offer.data!.id}/accept`),
                          t("hr.saved"),
                        )
                        .then(() => (offer.reload(), application.reload()))
                    }
                  >
                    {t("hr.acceptOffer")}
                  </Button>
                  <Button
                    variant="secondary"
                    busy={offerAction.busy}
                    onClick={() =>
                      offerAction
                        .run(
                          () =>
                            api.post(`/job-offers/${offer.data!.id}/decline`, {
                              reason: "Declined by the candidate",
                            }),
                          t("hr.saved"),
                        )
                        .then(() => (offer.reload(), application.reload()))
                    }
                  >
                    {t("hr.declineOffer")}
                  </Button>
                </>
              )}
            </div>
            {a.state === "hired" && <Alert kind="success">{t("hr.hiredHint")}</Alert>}
          </div>
        ) : mayManage &&
          ["shortlisted", "interviewing"].includes(a.state) ? (
          <OfferForm
            applicationId={a.id}
            companyId={company?.id ?? ""}
            form={offerForm}
            setForm={setOfferForm}
            onDone={() => {
              application.reload();
            }}
          />
        ) : (
          <p className="text-sm text-slate-500">{t("st.none")}</p>
        )}
      </Panel>

      <Panel title={t("hr.history")}>
        <ol className="space-y-2">
          {a.events.map((e) => (
            <li key={e.id} className="border-l-2 border-slate-200 pl-3 text-sm">
              <AppStateBadge
                state={e.to as Application["state"]}
              />{" "}
              {e.note}
              <span className="block text-xs text-slate-500">
                {when(e.at)}
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

/** The offer HR writes: placement, salary, joining date and validity. */
interface OfferFields {
  branchId: string;
  departmentId: string;
  designationId: string;
  gradeId: string;
  grossSalary: string;
  joiningOn: string;
  validUntil: string;
  probationMonths: string;
  terms: string;
}

function OfferForm({
  applicationId,
  companyId,
  form,
  setForm,
  onDone,
}: {
  applicationId: string;
  companyId: string;
  form: OfferFields;
  setForm: (f: OfferFields) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const branches = useApi<Branch[]>(`/companies/${companyId}/branches`);
  const departments = useApi<Department[]>(
    `/companies/${companyId}/departments`,
  );
  const designations = useApi<Designation[]>(
    `/companies/${companyId}/designations`,
  );
  const grades = useApi<Grade[]>(`/companies/${companyId}/grades`);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const done = await save.run(
          () =>
            api.post(`/applications/${applicationId}/offer`, {
              branchId: form.branchId,
              departmentId: form.departmentId,
              designationId: form.designationId,
              gradeId: form.gradeId,
              grossSalary: form.grossSalary,
              joiningOn: form.joiningOn,
              validUntil: form.validUntil,
              probationMonths: Number(form.probationMonths || 0),
              ...(form.terms ? { terms: form.terms } : {}),
            }),
          t("hr.saved"),
        );
        if (done) onDone();
      }}
    >
      <ActionMessage action={save} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("hr.branch")}>
          <Select
            required
            id="offer-branch"
            value={form.branchId}
            onChange={(e) => setForm({ ...form, branchId: e.target.value })}
          >
            <option value="">—</option>
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("hr.department")}>
          <Select
            required
            id="offer-department"
            value={form.departmentId}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
          >
            <option value="">—</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("hr.designation")}>
          <Select
            required
            id="offer-designation"
            value={form.designationId}
            onChange={(e) =>
              setForm({ ...form, designationId: e.target.value })
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
        <Field label={t("hr.grade")}>
          <Select
            required
            id="offer-grade"
            value={form.gradeId}
            onChange={(e) => setForm({ ...form, gradeId: e.target.value })}
          >
            <option value="">—</option>
            {(grades.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.salaryMin ? ` (${g.salaryMin}–${g.salaryMax ?? ""})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("hr.grossSalary")}>
          <Input
            required
            id="offer-salary"
            inputMode="decimal"
            value={form.grossSalary}
            onChange={(e) => setForm({ ...form, grossSalary: e.target.value })}
          />
        </Field>
        <Field label={t("hr.probationMonths")}>
          <Input
            type="number"
            min={0}
            max={24}
            id="offer-probation"
            value={form.probationMonths}
            onChange={(e) =>
              setForm({ ...form, probationMonths: e.target.value })
            }
          />
        </Field>
        <Field label={t("hr.joiningOn")}>
          <Input
            required
            type="date"
            id="offer-joining"
            value={form.joiningOn}
            onChange={(e) => setForm({ ...form, joiningOn: e.target.value })}
          />
        </Field>
        <Field label={t("hr.validUntil")}>
          <Input
            required
            type="date"
            id="offer-valid"
            value={form.validUntil}
            onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
          />
        </Field>
      </div>
      <Field label={t("hr.terms")}>
        <TextArea
          rows={2}
          id="offer-terms"
          value={form.terms}
          onChange={(e) => setForm({ ...form, terms: e.target.value })}
        />
      </Field>
      <Button type="submit" busy={save.busy}>
        {t("hr.makeOffer")}
      </Button>
    </form>
  );
}
