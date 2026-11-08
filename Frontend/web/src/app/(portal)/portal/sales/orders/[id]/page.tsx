"use client";
/** One sales order: the credit check, delivery, and the invoice (Accounts). */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
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
import { dhakaToday, formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { ORDER_STATE_COLOR, type SalesOrderDetail } from "@/lib/sales-types";

export default function OrderPage({
  params,
}: PageProps<"/portal/sales/orders/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const router = useRouter();
  const order = useApi<SalesOrderDetail>(`/sales-orders/${id}`);
  const action = useAction();
  const [dialog, setDialog] = useState<"deliver" | "cancel" | null>(null);
  if (order.loading && !order.data) return <Loading />;
  if (order.error)
    return <ErrorBox error={order.error} onRetry={order.reload} />;
  const o = order.data!;
  const c = o.creditCheck;
  const mayWork = o.canWork || o.canInvoice;
  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">{o.number}</span>{" "}
            {o.customer.name}{" "}
            <Badge color={ORDER_STATE_COLOR[o.state]}>
              {t(`sa.ostate.${o.state}`)}
            </Badge>
          </span>
        }
        subtitle={o.customerRef ?? undefined}
        actions={
          <>
            {mayWork && o.state === "confirmed" && (
              <Button onClick={() => setDialog("deliver")}>
                {t("sa.deliver")}
              </Button>
            )}
            {o.canInvoice && o.state === "delivered" && (
              <Button
                onClick={() =>
                  action
                    .run(() =>
                      api.post<{ id: string }>(
                        `/sales-orders/${o.id}/invoice`,
                        {},
                      ),
                    )
                    .then(
                      (r) =>
                        r &&
                        typeof r === "object" &&
                        router.push(`/portal/sales/invoices/${r.id}`),
                    )
                }
              >
                {t("sa.makeInvoice")}
              </Button>
            )}
            {mayWork && ["in_approval", "confirmed"].includes(o.state) && (
              <Button variant="ghost" onClick={() => setDialog("cancel")}>
                {t("sa.cancel")}
              </Button>
            )}
          </>
        }
      />
      <ActionMessage action={action} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel>
          <dl className="grid gap-3">
            <Detail label={t("sa.orderDate")}>
              {formatDate(o.orderDate, lang)}
            </Detail>
            <Detail label={t("sa.customer")}>
              <Link
                className="underline"
                href={`/portal/crm/customers/${o.customer.id}`}
              >
                {o.customer.code} · {o.customer.name}
              </Link>
            </Detail>
            {o.quotation && (
              <Detail label={t("sa.quotations")}>
                <Link
                  className="font-mono text-xs underline"
                  href={`/portal/sales/quotations/${o.quotation.id}`}
                >
                  {o.quotation.number} r{o.quotation.revision}
                </Link>
              </Detail>
            )}
            {o.deliveredOn && (
              <Detail label={t("sa.deliveredOn")}>
                {formatDate(o.deliveredOn, lang)} · {o.deliveryChallanNo}
              </Detail>
            )}
            {o.store && (
              <Detail label={t("sa.store")}>
                {o.store.code} · {o.store.name}
              </Detail>
            )}
            {o.invoice && (
              <Detail label={t("sa.invoice")}>
                <Link
                  className="font-mono text-xs underline"
                  href={`/portal/sales/invoices/${o.invoice.id}`}
                >
                  {o.invoice.invoiceNo}
                </Link>
              </Detail>
            )}
            {o.cancelReason && (
              <Detail label={t("sa.reason")}>{o.cancelReason}</Detail>
            )}
          </dl>
          <h3 className="mb-2 mt-4 text-sm font-semibold">
            {t("sa.creditCheck")}
          </h3>
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt>{t("sa.creditLimit")}</dt>
            <dd className="text-right tabular-nums">
              {formatTaka(c.creditLimit, lang)}
            </dd>
            <dt>{t("sa.openInvoices")}</dt>
            <dd className="text-right tabular-nums">
              {formatTaka(c.openInvoices, lang)}
            </dd>
            <dt>{t("sa.openOrders")}</dt>
            <dd className="text-right tabular-nums">
              {formatTaka(c.openOrders, lang)}
            </dd>
            <dt>{t("sa.exposure")}</dt>
            <dd
              className={`text-right tabular-nums ${c.over ? "font-semibold text-red-700" : ""}`}
            >
              {formatTaka(c.exposure, lang)}
            </dd>
            {c.over && (
              <>
                <dt>{t("sa.overBy")}</dt>
                <dd className="text-right tabular-nums text-red-700">
                  {formatTaka(c.overBy, lang)}
                </dd>
              </>
            )}
          </dl>
        </Panel>
        <Panel title={t("sa.lines")} className="lg:col-span-2">
          <Table
            rows={o.lines}
            rowKey={(l) => l.id}
            columns={[
              {
                key: "desc",
                label: t("sa.product"),
                render: (l) => l.description,
              },
              {
                key: "qty",
                label: t("sa.quantity"),
                align: "right",
                render: (l) => `${Number(l.quantity)} ${l.unit}`,
              },
              {
                key: "price",
                label: t("sa.unitPrice"),
                align: "right",
                render: (l) => formatTaka(l.unitPrice, lang),
              },
              {
                key: "disc",
                label: t("sa.discount"),
                align: "right",
                render: (l) => Number(l.discountPercent),
              },
              {
                key: "value",
                label: t("sa.value"),
                align: "right",
                render: (l) => formatTaka(l.value, lang),
              },
              {
                key: "vat",
                label: t("sa.vat"),
                align: "right",
                render: (l) => formatTaka(l.vatAmount, lang),
              },
            ]}
          />
          <p className="mt-3 text-right text-sm font-semibold">
            {t("sa.total")}: {formatTaka(o.total, lang)}
          </p>
        </Panel>
      </div>
      {dialog && (
        <OrderDialog
          o={o}
          kind={dialog}
          onClose={() => setDialog(null)}
          onDone={() => (setDialog(null), order.reload())}
        />
      )}
    </div>
  );
}

function OrderDialog({
  o,
  kind,
  onClose,
  onDone,
}: {
  o: SalesOrderDetail;
  kind: "deliver" | "cancel";
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({ text: "", date: dhakaToday(), storeId: "" });
  const stores = useApi<
    Array<{ id: string; code: string; name: string; isActive?: boolean }>
  >(
    kind === "deliver" && o.needsStore
      ? `/companies/${o.companyId}/stores`
      : null,
  );
  return (
    <Modal
      title={kind === "deliver" ? t("sa.deliver") : t("sa.cancel")}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body =
            kind === "deliver"
              ? {
                  version: o.version,
                  challanNo: f.text,
                  deliveredOn: f.date,
                  ...(f.storeId ? { storeId: f.storeId } : {}),
                }
              : { version: o.version, reason: f.text };
          if (
            await save.run(() =>
              api.post(`/sales-orders/${o.id}/${kind}`, body),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        {kind === "deliver" && o.needsStore && (
          <Field label={t("sa.store")} hint={t("sa.storeHint")}>
            <Select
              required
              value={f.storeId}
              onChange={(e) => setF({ ...f, storeId: e.target.value })}
              id="deliver-store"
            >
              <option value="">—</option>
              {stores.data
                ?.filter((s) => s.isActive !== false)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {kind === "deliver" && (
          <Field label={t("sa.deliveredOn")}>
            <Input
              required
              type="date"
              max={dhakaToday()}
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
              id="deliver-date"
            />
          </Field>
        )}
        <Field label={kind === "deliver" ? t("sa.challanNo") : t("sa.reason")}>
          <Input
            required
            maxLength={kind === "deliver" ? 50 : 500}
            value={f.text}
            onChange={(e) => setF({ ...f, text: e.target.value })}
            id="order-text"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={kind === "deliver" ? t("sa.deliver") : t("sa.cancel")}
        />
      </form>
    </Modal>
  );
}
