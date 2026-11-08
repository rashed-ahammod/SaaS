"use client";
/**
 * One approval request, written for the person who has to decide:
 *
 *   what is being asked   the module's snapshot, field by field, in words
 *   who approves it       the whole chain, which step it is on, and who is waiting
 *   what has happened     the history as sentences, with the names of the people
 *   the decision          approve / return / reject (a comment is required to
 *                         return or reject); the requester may withdraw instead
 *
 * The engine always sent the chain, the approvers and their reasons; until now the
 * screen printed only the raw snapshot, so an approver could not see who came
 * after them or why it had been sent to them.
 */
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import {
  ActionMessage,
  Detail,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  useAction,
} from "@/components/portal/kit";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  TextArea,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import {
  assignedBecauseKey,
  formatSnapshotValue,
  snapshotFields,
  tidyKey,
} from "@/lib/approval-text";
import {
  formatDate,
  formatMonth,
  formatTaka,
  formatTime,
  num,
} from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";
import type { ApprovalRequest } from "@/lib/types";

const APPROVER_STATES = [
  "pending",
  "approved",
  "rejected",
  "returned",
  "skipped",
  "cancelled",
];

export default function PortalApprovalPage({
  params,
}: PageProps<"/portal/approvals/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const router = useRouter();
  const req = useApi<ApprovalRequest>(`/approvals/requests/${id}`);
  const action = useAction();
  const [comment, setComment] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const { me } = useSession();

  if (req.loading && !req.data) return <Loading />;
  if (req.error) return <ErrorBox error={req.error} />;
  const r = req.data!;
  const pending = r.state === "in_approval";
  const mine = r.requesterUserId === me.id;
  // an approver of the current step, or someone who may act for one (the API decides; the requester never approves their own)
  const mayDecide = pending && !mine;

  const value = (key: string, v: unknown) =>
    formatSnapshotValue(key, v, {
      date: (iso) => formatDate(iso, lang, { short: true }),
      month: (period) => formatMonth(period, lang),
      taka: (x) => formatTaka(x, lang),
      number: (x) => num(x, lang),
      yes: t("p.yes"),
      no: t("p.no"),
    });

  const decide = (decision: "approve" | "return" | "reject") =>
    action
      .run(async () => {
        if (decision !== "approve" && !comment.trim())
          throw new Error(t("appr.commentRequired"));
        await api.post(
          `/approvals/requests/${id}/${decision}`,
          comment.trim() ? { comment: comment.trim() } : {},
        );
        return true;
      }, t("appr.done"))
      .then((ok) => ok !== undefined && router.push("/portal/approvals"));

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t(`appr.type.${r.requestType}`)}
            <Badge
              color={
                pending
                  ? "amber"
                  : r.state === "executed" || r.state === "approved"
                    ? "green"
                    : "gray"
              }
            >
              {t(`ac.state.${r.state}`)}
            </Badge>
          </span>
        }
        subtitle={r.summary}
      />
      <ActionMessage action={action} />

      <Panel title={t("appr.details")}>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label={t("appr.requestedBy")}>
            {r.requesterName ?? "—"}
            <span className="block text-xs text-slate-500">
              {t("appr.submitted", {
                date: formatDate(r.submittedAt.slice(0, 10), lang, {
                  short: true,
                }),
              })}
            </span>
          </Detail>
          {snapshotFields(r.snapshot).map(([k, v]) => (
            <Detail key={k} label={t(`appr.f.${k}`, {}, tidyKey(k))}>
              {value(k, v)}
            </Detail>
          ))}
        </dl>
      </Panel>

      <Chain request={r} />

      <Panel title={t("appr.history")}>
        <ol className="space-y-2 text-sm">
          {r.history.map((h, i) => (
            <li key={i}>
              <span className="font-medium">
                {t(`appr.act.${h.action}`, {}, h.action)}
              </span>
              {h.actorName && <span> · {h.actorName}</span>}
              {h.onBehalfOfName && (
                <span className="text-slate-500">
                  {" "}
                  {t("appr.onBehalfOfName", { name: h.onBehalfOfName })}
                </span>
              )}
              {h.step !== null && (
                <span className="text-slate-500">
                  {" "}
                  · {t("appr.step", { n: num(h.step, lang) })}
                </span>
              )}
              <span className="text-slate-500">
                {" "}
                · {formatDate(h.at.slice(0, 10), lang, { short: true })}{" "}
                {formatTime(h.at, lang)}
              </span>
              {h.comment && (
                <span className="block text-slate-600">“{h.comment}”</span>
              )}
            </li>
          ))}
        </ol>
      </Panel>

      {pending && mine && (
        <Panel>
          <Button variant="secondary" onClick={() => setWithdrawing(true)}>
            {t("ac.withdraw")}
          </Button>
        </Panel>
      )}
      {withdrawing && (
        <Modal
          title={t("ac.withdraw")}
          open
          onClose={() => setWithdrawing(false)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action.run(
                  () =>
                    api.post(`/approvals/requests/${id}/cancel`, { comment }),
                  t("p.done"),
                )
              ) {
                setWithdrawing(false);
                setComment("");
                req.reload();
              }
            }}
          >
            <ActionMessage action={action} />
            <Field label={t("ac.withdrawReason")}>
              <Input
                required
                maxLength={1000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                id="withdraw-reason"
              />
            </Field>
            <FormButtons
              busy={action.busy}
              onCancel={() => setWithdrawing(false)}
              submitLabel={t("ac.withdraw")}
            />
          </form>
        </Modal>
      )}

      {mayDecide && (
        <Panel>
          <Field label={t("appr.comment")}>
            <TextArea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button busy={action.busy} onClick={() => decide("approve")}>
              {t("appr.approve")}
            </Button>
            <Button
              variant="secondary"
              busy={action.busy}
              onClick={() => decide("return")}
            >
              {t("appr.return")}
            </Button>
            <Button
              variant="danger"
              busy={action.busy}
              onClick={() => decide("reject")}
            >
              {t("appr.reject")}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

/**
 * The chain: one block per step, the people on it, and what each of them did. The
 * step the request is on is marked, so an approver can see both who is holding it
 * up and who still has to agree after them.
 */
function Chain({ request }: { request: ApprovalRequest }) {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const steps = request.steps ?? [];
  const approvers = request.approvers ?? [];
  if (!steps.length && !approvers.length) return null;
  const count = Math.max(steps.length, ...approvers.map((a) => a.step), 0);

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-baseline gap-2">
          {t("appr.chain")}
          {request.chainName && (
            <span className="text-xs font-normal text-slate-500">
              {request.chainName}
            </span>
          )}
        </span>
      }
    >
      <ol className="space-y-3">
        {Array.from({ length: count }, (_, i) => i + 1).map((step) => {
          const people = approvers.filter((a) => a.step === step);
          const current =
            request.state === "in_approval" && request.currentStep === step;
          return (
            <li
              key={step}
              className={`rounded-lg px-3 py-2 ${current ? "bg-amber-50 ring-1 ring-amber-200" : "bg-slate-50"}`}
            >
              <p className="text-sm font-semibold text-slate-800">
                {t("appr.step", { n: num(step, lang) })}
                {current && (
                  <span className="ml-2 text-xs font-normal text-amber-800">
                    {people.some((p) => p.userId === me.id)
                      ? t("appr.youAreHere")
                      : t("appr.waitingOn", {
                          who:
                            people
                              .filter((p) => p.status === "pending")
                              .map((p) => p.name ?? "—")
                              .join(", ") || "—",
                        })}
                  </span>
                )}
              </p>
              <ul className="mt-1 space-y-1 text-sm">
                {people.map((p) => {
                  const because = assignedBecauseKey(p.assignedBecause ?? null);
                  return (
                    <li
                      key={`${p.userId}-${p.slot ?? 0}`}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <span>{p.name ?? p.userId.slice(0, 8)}</span>
                      {because && (
                        <span className="text-xs text-slate-500">
                          {t(because)}
                        </span>
                      )}
                      <Badge
                        color={
                          p.status === "approved"
                            ? "green"
                            : p.status === "pending"
                              ? "amber"
                              : "gray"
                        }
                      >
                        {APPROVER_STATES.includes(p.status)
                          ? t(`appr.approverState.${p.status}`)
                          : p.status}
                      </Badge>
                      {p.actedAt && (
                        <span className="text-xs text-slate-500">
                          {formatDate(p.actedAt.slice(0, 10), lang, {
                            short: true,
                          })}
                        </span>
                      )}
                      {p.overdue && (
                        <Badge color="red">{t("appr.overdue")}</Badge>
                      )}
                    </li>
                  );
                })}
                {!people.length && (
                  <li className="text-sm text-slate-500">
                    {steps[step - 1]?.approverRule ?? "—"}
                  </li>
                )}
              </ul>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
