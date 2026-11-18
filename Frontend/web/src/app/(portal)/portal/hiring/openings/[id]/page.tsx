"use client";
/**
 * One job opening (Phase 3 WP29): the post as advertised, where it was advertised, and the
 * people who applied — sorted by the blind CV screening score, which is a sorting aid and
 * nothing more.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  ApplicantDialog,
  OpeningStateBadge,
  useWhen,
} from "@/components/portal/hiring";
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
import { useI18n } from "@/lib/i18n";
import { POSTING_CHANNELS, type Opening } from "@/lib/hiring-types";

export default function OpeningPage({
  params,
}: PageProps<"/portal/hiring/openings/[id]">) {
  const { id } = use(params);
  const { t } = useI18n();
  const router = useRouter();
  const when = useWhen();
  const { can } = usePortal();
  const act = useAction();
  const posting = useAction();
  const [channel, setChannel] = useState("facebook");
  const [reference, setReference] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [adding, setAdding] = useState(false);
  const opening = useApi<Opening>(`/job-openings/${id}`);
  if (opening.loading && !opening.data) return <Loading />;
  if (opening.error)
    return <ErrorBox error={opening.error} onRetry={opening.reload} />;
  const o = opening.data!;
  const mayManage = can("recruitment.manage");
  const run = (path: string, body?: unknown) =>
    act
      .run(() => api.post(`/job-openings/${o.id}/${path}`, body), t("hr.saved"))
      .then(() => opening.reload());

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">{o.number}</span>
            {o.title}
            <OpeningStateBadge state={o.state} />
          </span>
        }
        subtitle={[o.departmentName, o.designationName]
          .filter(Boolean)
          .join(" · ")}
        actions={
          mayManage && (
            <>
              {o.state === "open" && (
                <Button onClick={() => setAdding(true)}>
                  {t("hr.newApplicant")}
                </Button>
              )}
              {o.state === "open" && (
                <Button
                  variant="secondary"
                  busy={act.busy}
                  onClick={() => run("hold")}
                >
                  {t("hr.hold")}
                </Button>
              )}
              {o.state === "on_hold" && (
                <Button
                  variant="secondary"
                  busy={act.busy}
                  onClick={() => run("resume")}
                >
                  {t("hr.resume")}
                </Button>
              )}
            </>
          )
        }
      />
      <ActionMessage action={act} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t("hr.title")} className="lg:col-span-2">
          <p className="mb-3 whitespace-pre-wrap text-sm">{o.description}</p>
          <h3 className="mb-1 text-sm font-semibold">{t("hr.requirements")}</h3>
          <ul className="mb-3 list-disc pl-5 text-sm">
            {o.requirements.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label={t("hr.posts")}>{o.openings}</Detail>
            <Detail label={t("hr.closingOn")}>{o.closingOn ?? "—"}</Detail>
            <Detail label={t("hr.grade")}>{o.gradeName ?? "—"}</Detail>
            <Detail label={t("hr.branch")}>{o.branchName ?? "—"}</Detail>
            <Detail label={t("hr.positions")}>
              <Link
                className="font-mono text-xs underline"
                href={`/portal/hiring/positions/${o.positionRequest.id}`}
              >
                {o.positionRequest.number}
              </Link>{" "}
              {o.positionRequest.withinPlan ? (
                <Badge color="green">{t("hr.withinPlan")}</Badge>
              ) : (
                <Badge color="amber">{t("hr.outsidePlan")}</Badge>
              )}
            </Detail>
          </dl>
        </Panel>

        <Panel title={t("hr.postings")}>
          <ul className="mb-3 space-y-2 text-sm">
            {o.postings.length === 0 && (
              <li className="text-slate-500">{t("st.none")}</li>
            )}
            {o.postings.map((p) => (
              <li key={p.id}>
                <Badge color="blue">{t(`hr.channel.${p.channel}`)}</Badge>{" "}
                {p.postedOn}
                {p.reference && (
                  <span className="block text-xs text-slate-500">
                    {p.reference}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {mayManage && o.state === "open" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const done = await posting.run(
                  () =>
                    api.post(`/job-openings/${o.id}/postings`, {
                      channel,
                      ...(reference ? { reference } : {}),
                    }),
                  t("hr.saved"),
                );
                if (done) {
                  setReference("");
                  opening.reload();
                }
              }}
            >
              <ActionMessage action={posting} />
              <Field label={t("hr.channel")}>
                <Select
                  id="posting-channel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  {POSTING_CHANNELS.map((x) => (
                    <option key={x} value={x}>
                      {t(`hr.channel.${x}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("hr.reference")}>
                <Input
                  id="posting-reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
              <Button type="submit" variant="secondary" busy={posting.busy}>
                {t("hr.addPosting")}
              </Button>
            </form>
          )}
        </Panel>
      </div>

      <Panel title={t("hr.applications")}>
        <Table
          rows={o.applications}
          rowKey={(a) => a.id}
          empty={t("st.none")}
          onRowClick={(a) =>
            router.push(`/portal/hiring/applications/${a.id}`)
          }
          columns={[
            {
              key: "name",
              label: t("hr.applicant"),
              render: (a) => a.name ?? t("hr.redacted"),
            },
            {
              key: "district",
              label: t("hr.district"),
              render: (a) => a.district ?? "",
            },
            {
              key: "score",
              label: t("hr.score"),
              align: "right",
              render: (a) =>
                a.screeningScore === null ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <Badge
                    color={
                      a.screeningScore >= 70
                        ? "green"
                        : a.screeningScore >= 40
                          ? "amber"
                          : "gray"
                    }
                  >
                    {a.screeningScore}
                  </Badge>
                ),
            },
            {
              key: "state",
              label: t("hr.state"),
              render: (a) => <AppStateBadge state={a.state} />,
            },
            {
              key: "applied",
              label: t("hr.appliedOn"),
              render: (a) => a.appliedOn,
            },
          ]}
        />
      </Panel>

      {mayManage && o.state === "open" && (
        <Panel title={t("hr.close")}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await run("close", { reason: closeReason });
              setCloseReason("");
            }}
          >
            <Field label={t("hr.closeReason")}>
              <Input
                required
                maxLength={500}
                id="opening-close-reason"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="ghost" busy={act.busy}>
              {t("hr.close")}
            </Button>
          </form>
        </Panel>
      )}

      {adding && (
        <ApplicantDialog
          companyId={o.companyId}
          openingId={o.id}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            opening.reload();
          }}
        />
      )}
      <p className="text-xs text-slate-500">{when(o.createdAt)}</p>
    </div>
  );
}
