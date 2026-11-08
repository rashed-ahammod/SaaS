"use client";
/**
 * One requisition: the items and the approval, then (Accounts) the quotations side by
 * side, the comparative statement, and raising the purchase order.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { Taka } from "@/components/portal/finance";
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
import { BudgetCheckNote } from "@/components/portal/budgets";
import {
  ChooseDialog,
  OrderDialog,
  QuotationDialog,
} from "@/components/portal/procurement";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatDate, formatTaka, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  REQ_STATE_COLOR,
  type ProcurementSettings,
  type Quotation,
  type Requisition,
} from "@/lib/procurement-types";

export default function RequisitionPage({
  params,
}: PageProps<"/portal/procurement/requisitions/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const router = useRouter();
  const { can } = usePortal();
  const r = useApi<Requisition>(`/purchase-requisitions/${id}`);
  const settings = useApi<ProcurementSettings>(
    r.data ? `/companies/${r.data.companyId}/procurement-settings` : null,
  );
  const [adding, setAdding] = useState(false);
  const [choosing, setChoosing] = useState<Quotation | null>(null);
  const [ordering, setOrdering] = useState<Quotation | null>(null);
  const [withdrawing, setWithdrawing] = useState<Quotation | null>(null);
  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  const d = r.data!;
  const manage = can("procurement.manage");
  const cs = d.comparativeStatement;
  const open = d.state === "approved";
  const active = d.quotations.filter((q) => q.state === "active");
  // which quotation may be ordered: the approved choice, or (no statement needed) any
  const orderable = (q: Quotation) =>
    open &&
    q.state === "active" &&
    (cs.needed
      ? cs.state === "approved" && q.id === cs.selectedQuotationId
      : cs.state !== "in_approval");

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {d.title}
            <Badge color={REQ_STATE_COLOR[d.state]}>
              {t(`pr.state.${d.state}`)}
            </Badge>
          </span>
        }
        subtitle={[
          d.number,
          `${d.requester.code} · ${d.requester.name}`,
          d.departmentName,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <Panel>
        <dl className="grid gap-4 sm:grid-cols-4">
          <Detail label={t("pr.estimate")}>
            {formatTaka(d.estimatedTotal, lang)}
          </Detail>
          <Detail label={t("pr.neededBy")}>
            {d.neededBy ? formatDate(d.neededBy, lang) : "—"}
          </Detail>
          <Detail label={t("pr.p.approval")}>
            {d.approvalRequestId ? (
              <Link
                className="text-emerald-800 underline"
                href={`/portal/approvals/${d.approvalRequestId}`}
              >
                {t(`pr.state.${d.state}`)}
              </Link>
            ) : (
              "—"
            )}
          </Detail>
          <Detail label={t("pr.order")}>
            {d.purchaseOrder ? (
              <Link
                className="text-emerald-800 underline"
                href={`/portal/procurement/orders/${d.purchaseOrder.id}`}
              >
                {d.purchaseOrder.number}
              </Link>
            ) : (
              "—"
            )}
          </Detail>
        </dl>
        {d.budget && (
          <p className="mt-3">
            <span className="mr-2 text-sm font-semibold">{t("bg.check")}:</span>
            <BudgetCheckNote check={d.budget.check} />
          </p>
        )}
        <p className="mt-3 text-sm text-slate-700">
          <span className="font-semibold">{t("pr.p.justification")}:</span>{" "}
          {d.justification}
        </p>
      </Panel>

      <Panel title={t("pr.lines")}>
        <Table
          rows={d.lines}
          rowKey={(l) => l.id}
          columns={[
            { key: "item", label: t("pr.item"), render: (l) => l.description },
            {
              key: "qty",
              label: t("pr.qty"),
              align: "right",
              render: (l) => `${l.quantity} ${l.unit}`,
            },
            {
              key: "price",
              label: t("pr.estPrice"),
              align: "right",
              render: (l) => <Taka value={l.estimatedUnitPrice} />,
            },
            // the quotations side by side: the comparative statement
            ...active.map((q) => ({
              key: q.id,
              label: q.vendorName,
              align: "right" as const,
              render: (l: Requisition["lines"][number]) => {
                const p = q.lines.find((x) => x.requisitionLineId === l.id);
                return p ? <Taka value={p.unitPrice} /> : "";
              },
            })),
          ]}
        />
      </Panel>

      {(d.state === "approved" ||
        d.state === "ordered" ||
        d.quotations.length > 0) && (
        <Panel
          title={t("pr.p.quotations")}
          actions={
            manage &&
            open &&
            cs.state === "none" && (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                {t("pr.p.addQuotation")}
              </Button>
            )
          }
        >
          {settings.data && (
            <p className="mb-3 text-sm text-slate-600">
              {cs.needed
                ? t("pr.p.csNeeded", {
                    threshold: formatTaka(
                      settings.data.quotationThreshold,
                      lang,
                    ),
                    n: num(cs.minQuotations, lang),
                  })
                : t("pr.p.csNotNeeded", {
                    threshold: formatTaka(
                      settings.data.quotationThreshold,
                      lang,
                    ),
                  })}
            </p>
          )}
          <Table
            rows={d.quotations}
            rowKey={(q) => q.id}
            empty={t("pr.p.none")}
            columns={[
              {
                key: "vendor",
                label: t("pr.p.vendor"),
                render: (q) => `${q.vendorCode} · ${q.vendorName}`,
              },
              {
                key: "ref",
                label: t("pr.p.quotationRef"),
                render: (q) => (
                  <span className="font-mono text-xs">{q.reference}</span>
                ),
              },
              {
                key: "days",
                label: t("pr.p.deliveryDays"),
                align: "right",
                render: (q) =>
                  q.deliveryDays === null ? "" : num(q.deliveryDays, lang),
              },
              {
                key: "total",
                label: t("pr.p.total"),
                align: "right",
                render: (q) => <Taka value={q.total} />,
              },
              {
                key: "flags",
                label: "",
                render: (q) => (
                  <span className="flex flex-wrap gap-1">
                    {q.state === "withdrawn" && (
                      <Badge color="gray">{t("pr.p.withdrawn")}</Badge>
                    )}
                    {q.lowest && (
                      <Badge color="green">{t("pr.p.lowest")}</Badge>
                    )}
                    {q.selected && (
                      <Badge color="blue">{t("pr.p.chosen")}</Badge>
                    )}
                  </span>
                ),
              },
              {
                key: "act",
                label: "",
                align: "right",
                render: (q) =>
                  !manage || q.state !== "active" ? null : (
                    <span className="flex justify-end gap-1">
                      {open && cs.state === "none" && cs.needed && (
                        <Button
                          variant="secondary"
                          className="min-h-8 px-2 py-1 text-sm"
                          onClick={() => setChoosing(q)}
                        >
                          {t("pr.p.choose")}
                        </Button>
                      )}
                      {orderable(q) && (
                        <Button
                          className="min-h-8 px-2 py-1 text-sm"
                          onClick={() => setOrdering(q)}
                        >
                          {t("pr.p.makeOrder")}
                        </Button>
                      )}
                      {open && cs.state === "none" && (
                        <Button
                          variant="ghost"
                          className="min-h-8 px-2 py-1 text-sm"
                          onClick={() => setWithdrawing(q)}
                        >
                          {t("pr.p.withdraw")}
                        </Button>
                      )}
                    </span>
                  ),
              },
            ]}
          />
          {cs.needed && (
            <p className="mt-3 text-sm">
              <span className="font-semibold">{t("pr.p.cs")}:</span>{" "}
              {t(`pr.p.cs.${cs.state}`)}
              {cs.reason && (
                <span className="text-slate-600"> · “{cs.reason}”</span>
              )}
            </p>
          )}
        </Panel>
      )}

      {adding && (
        <QuotationDialog
          r={d}
          onClose={() => setAdding(false)}
          onDone={() => (setAdding(false), r.reload())}
        />
      )}
      {choosing && (
        <ChooseDialog
          r={d}
          q={choosing}
          onClose={() => setChoosing(null)}
          onDone={() => (setChoosing(null), r.reload())}
        />
      )}
      {ordering && (
        <OrderDialog
          r={d}
          q={ordering}
          onClose={() => setOrdering(null)}
          onDone={(orderId) =>
            router.push(`/portal/procurement/orders/${orderId}`)
          }
        />
      )}
      {withdrawing && (
        <WithdrawQuotation
          q={withdrawing}
          onClose={() => setWithdrawing(null)}
          onDone={() => (setWithdrawing(null), r.reload())}
        />
      )}
    </div>
  );
}

function WithdrawQuotation({
  q,
  onClose,
  onDone,
}: {
  q: Quotation;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={`${t("pr.p.withdraw")}: ${q.vendorName}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/quotations/${q.id}/withdraw`, { reason }),
            )
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
            id="q-withdraw-reason"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("pr.p.withdraw")}
        />
      </form>
    </Modal>
  );
}
