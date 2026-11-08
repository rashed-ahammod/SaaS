"use client";
/**
 * One budget: each account's budget, actual, committed and what is left; a draft is
 * changed, sent to the Admin or cancelled; an approved one changes through a request
 * the Admin approves (Accounts, or the Dept Head for their department).
 */
import Link from "next/link";
import { use, useState } from "react";
import {
  BudgetForm,
  PositionTable,
  RevisionDialog,
} from "@/components/portal/budgets";
import {
  ActionMessage,
  Detail,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { BUDGET_STATE_COLOR, type Budget } from "@/lib/budget-types";
import { formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function BudgetPage({
  params,
}: PageProps<"/portal/budgets/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const b = useApi<Budget>(`/budgets/${id}`);
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [revising, setRevising] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  if (b.loading && !b.data) return <Loading />;
  if (b.error) return <ErrorBox error={b.error} onRetry={b.reload} />;
  const d = b.data!;
  const manage = can("budgets.manage");

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {d.departmentName} · {d.fiscalYear}
            <Badge color={BUDGET_STATE_COLOR[d.state]}>
              {t(`bg.state.${d.state}`)}
            </Badge>
          </span>
        }
        subtitle={`${formatDate(d.fiscalYearFrom, lang, { short: true })} – ${formatDate(d.fiscalYearTo, lang, { short: true })}`}
        actions={
          <>
            {manage && d.state === "draft" && (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {t("bg.edit")}
                </Button>
                <Button
                  busy={action.busy}
                  onClick={() =>
                    action
                      .run(() => api.post(`/budgets/${id}/submit`))
                      .then(b.reload)
                  }
                >
                  {t("bg.submit")}
                </Button>
                <Button
                  variant="ghost"
                  className="text-red-700"
                  onClick={() => setCancelling(true)}
                >
                  {t("bg.cancel")}
                </Button>
              </>
            )}
            {d.canRequestChange &&
              !d.revisions.some((r) => r.state === "in_approval") && (
                <Button variant="secondary" onClick={() => setRevising(true)}>
                  {t("bg.askChange")}
                </Button>
              )}
          </>
        }
      />
      <ActionMessage action={action} />
      <Panel>
        <dl className="grid gap-4 sm:grid-cols-4">
          <Detail label={t("bg.budget")}>{formatTaka(d.total, lang)}</Detail>
          <Detail label={t("bg.used")}>
            {formatTaka(d.position?.used ?? "0", lang)}
          </Detail>
          <Detail label={t("bg.available")}>
            {formatTaka(d.position?.available ?? d.total, lang)}
          </Detail>
          <Detail label={t("bg.note")}>{d.note ?? "—"}</Detail>
        </dl>
      </Panel>
      <Panel title={t("bg.lines")}>
        <PositionTable rows={d.lines} total={d.position ?? undefined} />
      </Panel>
      {d.unbudgeted.length > 0 && (
        <Panel title={t("bg.unbudgeted")}>
          <PositionTable rows={d.unbudgeted} />
        </Panel>
      )}
      {d.revisions.length > 0 && (
        <Panel title={t("bg.revisions")}>
          <Table
            rows={d.revisions}
            rowKey={(r) => r.id}
            columns={[
              {
                key: "date",
                label: t("p.date"),
                render: (r) =>
                  formatDate(r.createdAt.slice(0, 10), lang, { short: true }),
              },
              {
                key: "reason",
                label: t("bg.changeReason"),
                render: (r) => r.reason,
              },
              {
                key: "lines",
                label: t("bg.lines"),
                render: (r) => (
                  <span className="text-xs">
                    {r.lines
                      .map(
                        (l) =>
                          `${l.accountCode}: ${formatTaka(l.oldAmount, lang)} → ${formatTaka(l.newAmount, lang)}`,
                      )
                      .join("; ")}
                  </span>
                ),
              },
              {
                key: "state",
                label: t("p.status"),
                render: (r) =>
                  r.state === "in_approval" && r.approvalRequestId ? (
                    <Link
                      className="text-emerald-800 underline"
                      href={`/portal/approvals/${r.approvalRequestId}`}
                    >
                      {t(`bg.rev.${r.state}`)}
                    </Link>
                  ) : (
                    t(`bg.rev.${r.state}`)
                  ),
              },
            ]}
          />
        </Panel>
      )}
      {editing && (
        <BudgetForm
          companyId={d.companyId}
          existing={d}
          onClose={() => setEditing(false)}
          onDone={() => (setEditing(false), b.reload())}
        />
      )}
      {revising && (
        <RevisionDialog
          budget={d}
          onClose={() => setRevising(false)}
          onDone={() => (setRevising(false), b.reload())}
        />
      )}
      {cancelling && (
        <CancelBudget
          id={id}
          onClose={() => setCancelling(false)}
          onDone={() => (setCancelling(false), b.reload())}
        />
      )}
    </div>
  );
}

function CancelBudget({
  id,
  onClose,
  onDone,
}: {
  id: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal title={t("bg.cancel")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() => api.post(`/budgets/${id}/cancel`, { reason }))
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("p.reason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="budget-cancel-reason"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("bg.cancel")}
        />
      </form>
    </Modal>
  );
}
