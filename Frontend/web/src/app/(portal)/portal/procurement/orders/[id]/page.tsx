"use client";
/**
 * One purchase order: the lines (ordered / received / billed), issue or cancel it,
 * record what arrived (Accounts or the Dept Head), and enter the vendor's bill for
 * what was received; each bill shows its three-way match.
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
import { BillFromOrder, ReceiveDialog } from "@/components/portal/procurement";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  MATCH_COLOR,
  ORDER_STATE_COLOR,
  type Order,
} from "@/lib/procurement-types";

export default function OrderPage({
  params,
}: PageProps<"/portal/procurement/orders/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const router = useRouter();
  const { can } = usePortal();
  const o = useApi<Order>(`/purchase-orders/${id}`);
  const action = useAction();
  const [receiving, setReceiving] = useState(false);
  const [billing, setBilling] = useState(false);
  const [cancelling, setCancelling] = useState<
    { kind: "order" } | { kind: "receipt"; id: string; number: string } | null
  >(null);
  if (o.loading && !o.data) return <Loading />;
  if (o.error) return <ErrorBox error={o.error} onRetry={o.reload} />;
  const d = o.data!;
  const manage = can("procurement.manage");
  const receivable =
    (d.state === "issued" || d.state === "partially_received") &&
    can("procurement.receive");
  const billable =
    can("payables.manage") &&
    d.lines.some((l) => Number(l.received) > Number(l.billed));

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {d.number}
            <Badge color={ORDER_STATE_COLOR[d.state]}>
              {t(`pr.os.${d.state}`)}
            </Badge>
          </span>
        }
        subtitle={`${d.vendor.code} · ${d.vendor.name}`}
        actions={
          <>
            {manage && d.state === "draft" && (
              <Button
                busy={action.busy}
                onClick={() =>
                  action
                    .run(() => api.post(`/purchase-orders/${id}/issue`))
                    .then(o.reload)
                }
              >
                {t("pr.p.issue")}
              </Button>
            )}
            {receivable && (
              <Button variant="secondary" onClick={() => setReceiving(true)}>
                {t("pr.p.receive")}
              </Button>
            )}
            {billable && (
              <Button variant="secondary" onClick={() => setBilling(true)}>
                {t("pr.p.enterBill")}
              </Button>
            )}
            <Button variant="ghost" onClick={() => window.print()}>
              {t("pr.p.printOrder")}
            </Button>
            {manage &&
              (d.state === "draft" || d.state === "issued") &&
              !d.receipts.some((g) => g.state === "active") &&
              !d.bills.some((b) => b.state !== "cancelled") && (
                <Button
                  variant="ghost"
                  className="text-red-700"
                  onClick={() => setCancelling({ kind: "order" })}
                >
                  {t("pr.p.cancelOrder")}
                </Button>
              )}
          </>
        }
      />
      <ActionMessage action={action} />
      <Panel>
        <dl className="grid gap-4 sm:grid-cols-4">
          <Detail label={t("pr.p.orderDate")}>
            {formatDate(d.orderDate, lang)}
          </Detail>
          <Detail label={t("pr.p.deliveryDate")}>
            {d.deliveryDate ? formatDate(d.deliveryDate, lang) : "—"}
          </Detail>
          <Detail label={t("pr.p.deliverTo")}>{d.deliverTo ?? "—"}</Detail>
          <Detail label={t("pr.p.tab.requisitions")}>
            <Link
              className="text-emerald-800 underline"
              href={`/portal/procurement/requisitions/${d.requisition.id}`}
            >
              {d.requisition.number}
            </Link>
          </Detail>
        </dl>
        {d.terms && <p className="mt-3 text-sm text-slate-700">{d.terms}</p>}
        {d.cancelReason && (
          <p className="mt-3 text-sm text-red-700">{d.cancelReason}</p>
        )}
        {d.state === "in_approval" && (
          <p className="mt-3 text-sm text-amber-800">
            {t("bg.waitingAdmin")}{" "}
            {d.approvalRequestId && (
              <Link
                className="underline"
                href={`/portal/approvals/${d.approvalRequestId}`}
              >
                {t("pr.p.approval")}
              </Link>
            )}
          </p>
        )}
        {d.budget && (
          <p className="mt-3">
            <span className="mr-2 text-sm font-semibold">{t("bg.check")}:</span>
            <BudgetCheckNote check={d.budget} />
          </p>
        )}
      </Panel>

      <Panel title={t("pr.lines")}>
        <Table
          rows={d.lines}
          rowKey={(l) => l.id}
          columns={[
            { key: "item", label: t("pr.item"), render: (l) => l.description },
            {
              key: "ordered",
              label: t("pr.p.ordered"),
              align: "right",
              render: (l) => `${l.quantity} ${l.unit}`,
            },
            {
              key: "price",
              label: t("pr.p.unitPrice"),
              align: "right",
              render: (l) => <Taka value={l.unitPrice} />,
            },
            {
              key: "vat",
              label: t("pr.p.vat"),
              align: "right",
              render: (l) => l.vatPercent,
            },
            {
              key: "amount",
              label: t("p.amount"),
              align: "right",
              render: (l) => <Taka value={l.amount} />,
            },
            {
              key: "account",
              label: t("pr.p.account"),
              render: (l) => (
                <span className="text-xs">
                  {l.accountCode} · {l.accountName}
                </span>
              ),
            },
            {
              key: "received",
              label: t("pr.p.received"),
              align: "right",
              render: (l) => l.received,
            },
            {
              key: "billed",
              label: t("pr.p.billed"),
              align: "right",
              render: (l) => l.billed,
            },
          ]}
        />
        <p className="mt-3 text-right font-semibold">
          {t("pr.p.total")}: <Taka value={d.total} />
        </p>
      </Panel>

      <Panel title={t("pr.p.receipts")}>
        <Table
          rows={d.receipts}
          rowKey={(g) => g.id}
          empty={t("pr.p.none")}
          columns={[
            {
              key: "number",
              label: t("pr.p.number"),
              render: (g) => (
                <span className="font-mono text-xs">{g.number}</span>
              ),
            },
            {
              key: "date",
              label: t("pr.p.receivedDate"),
              render: (g) => formatDate(g.receivedDate, lang, { short: true }),
            },
            {
              key: "lines",
              label: t("pr.lines"),
              render: (g) =>
                g.lines
                  .map(
                    (l) =>
                      `${d.lines.find((x) => x.id === l.poLineId)?.description ?? ""}: ${l.quantity}`,
                  )
                  .join("; "),
            },
            {
              key: "by",
              label: t("pr.p.recordedBy"),
              render: (g) => g.recordedBy ?? "",
            },
            {
              key: "note",
              label: t("lv.emp.note"),
              render: (g) => (
                <span className="text-xs">
                  {g.state === "cancelled" ? g.cancelReason : g.note}
                </span>
              ),
            },
            {
              key: "state",
              label: "",
              render: (g) =>
                g.state === "cancelled" ? (
                  <Badge color="gray">{t("pr.os.cancelled")}</Badge>
                ) : null,
            },
            {
              key: "act",
              label: "",
              align: "right",
              render: (g) =>
                manage && g.state === "active" ? (
                  <Button
                    variant="ghost"
                    className="min-h-8 px-2 py-1 text-sm text-red-700"
                    onClick={() =>
                      setCancelling({
                        kind: "receipt",
                        id: g.id,
                        number: g.number,
                      })
                    }
                  >
                    {t("pr.p.cancelReceipt")}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Panel>

      <Panel title={t("pr.p.bills")}>
        <Table
          rows={d.bills}
          rowKey={(b) => b.id}
          empty={t("pr.p.none")}
          onRowClick={(b) => router.push(`/portal/bills/${b.id}`)}
          columns={[
            { key: "billNo", label: t("f.b.billNo"), render: (b) => b.billNo },
            {
              key: "date",
              label: t("f.b.billDate"),
              render: (b) => formatDate(b.billDate, lang, { short: true }),
            },
            {
              key: "state",
              label: t("p.status"),
              render: (b) => t(`f.b.state.${b.state}`),
            },
            {
              key: "match",
              label: t("pr.m.title"),
              render: (b) => (
                <Badge color={MATCH_COLOR[b.matchStatus]}>
                  {t(`pr.m.${b.matchStatus}`)}
                </Badge>
              ),
            },
            {
              key: "total",
              label: t("f.b.total"),
              align: "right",
              render: (b) => <Taka value={b.total} />,
            },
          ]}
        />
      </Panel>

      {receiving && (
        <ReceiveDialog
          o={d}
          onClose={() => setReceiving(false)}
          onDone={() => (setReceiving(false), o.reload())}
        />
      )}
      {billing && (
        <BillFromOrder
          o={d}
          onClose={() => setBilling(false)}
          onDone={(billId) => router.push(`/portal/bills/${billId}`)}
        />
      )}
      {cancelling && (
        <CancelDialog
          title={
            cancelling.kind === "order"
              ? `${t("pr.p.cancelOrder")}: ${d.number}`
              : `${t("pr.p.cancelReceipt")}: ${cancelling.number}`
          }
          path={
            cancelling.kind === "order"
              ? `/purchase-orders/${id}/cancel`
              : `/goods-receipts/${cancelling.id}/cancel`
          }
          onClose={() => setCancelling(null)}
          onDone={() => (setCancelling(null), o.reload())}
        />
      )}
    </div>
  );
}

function CancelDialog({
  title,
  path,
  onClose,
  onDone,
}: {
  title: string;
  path: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal title={title} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save.run(() => api.post(path, { reason }))) onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("p.reason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="po-cancel-reason"
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}
