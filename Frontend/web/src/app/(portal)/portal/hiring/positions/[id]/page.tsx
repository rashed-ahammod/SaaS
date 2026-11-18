"use client";
/**
 * One new-position request (Phase 3 WP29): what was asked for, what the manpower plan said
 * at the time, where the approval stands, and — once it is approved — HR opening it for
 * hiring.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import {
  ActionMessage,
  Detail,
  PageHeader,
  Panel,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  OpeningDialog,
  PositionStateBadge,
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
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { PositionRequest } from "@/lib/hiring-types";

export default function PositionPage({
  params,
}: PageProps<"/portal/hiring/positions/[id]">) {
  const { id } = use(params);
  const { t } = useI18n();
  const router = useRouter();
  const when = useWhen();
  const { can } = usePortal();
  const cancel = useAction();
  const [reason, setReason] = useState("");
  const [opening, setOpening] = useState(false);
  const request = useApi<PositionRequest>(`/position-requests/${id}`);
  if (request.loading && !request.data) return <Loading />;
  if (request.error)
    return <ErrorBox error={request.error} onRetry={request.reload} />;
  const r = request.data!;
  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">{r.number}</span>
            {r.designationName}
            <PositionStateBadge state={r.state} />
            {r.withinPlan ? (
              <Badge color="green">{t("hr.withinPlan")}</Badge>
            ) : (
              <Badge color="amber">{t("hr.outsidePlan")}</Badge>
            )}
          </span>
        }
        subtitle={r.departmentName ?? undefined}
        actions={
          <>
            {r.state === "approved" && can("recruitment.manage") && (
              <Button onClick={() => setOpening(true)}>
                {t("hr.openOpening")}
              </Button>
            )}
            {r.opening && (
              <Link
                className="text-sm underline"
                href={`/portal/hiring/openings/${r.opening.id}`}
              >
                {r.opening.number}
              </Link>
            )}
          </>
        }
      />
      {!r.withinPlan && <Alert kind="warning">{r.plan.reason}</Alert>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title={t("hr.positions")}>
          <dl className="grid gap-3">
            <Detail label={t("hr.headcount")}>{r.headcount}</Detail>
            <Detail label={t("hr.employmentType")}>
              {t(`hr.type.${r.employmentType}`)}
            </Detail>
            <Detail label={t("hr.grade")}>{r.gradeName ?? "—"}</Detail>
            <Detail label={t("hr.branch")}>{r.branchName ?? "—"}</Detail>
            <Detail label={t("hr.reason")}>{r.reason}</Detail>
            <Detail label={t("hr.appliedOn")}>{when(r.createdAt)}</Detail>
            {r.approvalRequestId && (
              <Detail label={t("hr.state")}>
                <Link
                  className="underline"
                  href={`/portal/approvals?request=${r.approvalRequestId}`}
                >
                  {t("hr.state.in_approval")}
                </Link>
              </Detail>
            )}
          </dl>
        </Panel>
        <Panel title={t("hr.planCheck")}>
          <dl className="grid gap-3">
            <Detail label={t("hr.fiscalYear")}>{r.plan.fiscalYear}</Detail>
            <Detail label={t("hr.headcount")}>{r.plan.planned ?? "—"}</Detail>
            <Detail label={t("hr.filled")}>{r.plan.filled}</Detail>
            <Detail label={t("hr.requested")}>{r.plan.requested}</Detail>
            <Detail label={t("hr.left")}>{r.plan.left ?? "—"}</Detail>
            <Detail label={t("hr.reason")}>{r.plan.reason}</Detail>
          </dl>
        </Panel>
      </div>
      {r.state === "in_approval" && (
        <Panel title={t("hr.cancelRequest")}>
          <ActionMessage action={cancel} />
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const done = await cancel.run(
                () =>
                  api.post(`/position-requests/${r.id}/cancel`, { reason }),
                t("hr.saved"),
              );
              if (done) request.reload();
            }}
          >
            <Field label={t("hr.reason")}>
              <Input
                required
                maxLength={500}
                id="position-cancel-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="secondary" busy={cancel.busy}>
              {t("hr.cancelRequest")}
            </Button>
          </form>
        </Panel>
      )}
      {opening && (
        <OpeningDialog
          positionRequestId={r.id}
          defaultPosts={r.headcount}
          onClose={() => setOpening(false)}
          onDone={(openingId) =>
            router.push(`/portal/hiring/openings/${openingId}`)
          }
        />
      )}
    </div>
  );
}
