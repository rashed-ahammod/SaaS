"use client";
/** One quotation: its lines against the price list and the discount limits; submit, send, accept into an order, revise. */
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
import { usePortal } from "@/components/portal/portal-context";
import { PdfButtons, QuotationDialog } from "@/components/portal/sales";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { QUOTE_STATE_COLOR, type QuotationDetail } from "@/lib/sales-types";

export default function QuotationPage({
  params,
}: PageProps<"/portal/sales/quotations/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company } = usePortal();
  const quote = useApi<QuotationDetail>(`/quotations/${id}`);
  const action = useAction();
  const [dialog, setDialog] = useState<"revise" | "accept" | "reject" | null>(
    null,
  );
  if (quote.loading && !quote.data) return <Loading />;
  if (quote.error)
    return <ErrorBox error={quote.error} onRetry={quote.reload} />;
  const q = quote.data!;
  const step = (path: string) =>
    action
      .run(() =>
        api.post(`/quotations/${q.id}/${path}`, { version: q.version }),
      )
      .then((r) => r && quote.reload());
  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">
              {q.number}
              {q.revision > 1 ? ` r${q.revision}` : ""}
            </span>{" "}
            {q.customer.name}{" "}
            <Badge color={QUOTE_STATE_COLOR[q.state]}>
              {t(`sa.state.${q.state}`)}
            </Badge>
          </span>
        }
        subtitle={`${q.customer.code} · ${t(`cr.type.${q.customer.customerType}`)}`}
        actions={
          <>
            {q.canWork && q.state === "draft" && (
              <Button onClick={() => step("submit")}>{t("sa.submit")}</Button>
            )}
            {q.canWork && q.state === "approved" && (
              <Button onClick={() => step("send")}>{t("sa.send")}</Button>
            )}
            {q.canWork && q.state === "sent" && (
              <Button onClick={() => setDialog("accept")}>
                {t("sa.accept")}
              </Button>
            )}
            {q.canWork && q.state === "sent" && (
              <Button variant="secondary" onClick={() => setDialog("reject")}>
                {t("sa.reject")}
              </Button>
            )}
            {q.canWork &&
              ["draft", "approved", "sent", "rejected", "expired"].includes(
                q.state,
              ) && (
                <Button variant="secondary" onClick={() => setDialog("revise")}>
                  {t("sa.revise")}
                </Button>
              )}
            {q.canWork &&
              ["draft", "in_approval", "approved"].includes(q.state) && (
                <Button variant="ghost" onClick={() => step("cancel")}>
                  {t("sa.cancel")}
                </Button>
              )}
            <PdfButtons
              path={`/quotations/${q.id}/pdf`}
              name={`${q.number.replace(/\//g, "-")}-r${q.revision}`}
            />
          </>
        }
      />
      <ActionMessage action={action} />
      {q.needsApproval && ["draft", "in_approval"].includes(q.state) && (
        <p
          className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="status"
        >
          {t("sa.needsApproval")}
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel>
          <dl className="grid gap-3">
            <Detail label={t("sa.quoteDate")}>
              {formatDate(q.quoteDate, lang)}
            </Detail>
            <Detail label={t("sa.validUntil")}>
              {formatDate(q.validUntil, lang)}
            </Detail>
            <Detail label={t("sa.customer")}>
              <Link
                className="underline"
                href={`/portal/crm/customers/${q.customer.id}`}
              >
                {q.customer.code} · {q.customer.name}
              </Link>
            </Detail>
            {q.opportunity && (
              <Detail label={t("sa.opportunity")}>
                <Link
                  className="underline"
                  href={`/portal/crm/opportunities/${q.opportunity.id}`}
                >
                  {q.opportunity.number} · {q.opportunity.title}
                </Link>
              </Detail>
            )}
            {q.order && (
              <Detail label={t("sa.order")}>
                <Link
                  className="font-mono text-xs underline"
                  href={`/portal/sales/orders/${q.order.id}`}
                >
                  {q.order.number}
                </Link>
              </Detail>
            )}
            {q.terms && <Detail label={t("sa.terms")}>{q.terms}</Detail>}
            {q.rejectReason && (
              <Detail label={t("sa.reason")}>{q.rejectReason}</Detail>
            )}
            {q.revisions.length > 1 && (
              <Detail label={t("sa.revision")}>
                {q.revisions.map((r) => (
                  <Link
                    key={r.id}
                    className={`mr-2 text-xs ${r.id === q.id ? "font-bold" : "underline"}`}
                    href={`/portal/sales/quotations/${r.id}`}
                  >
                    r{r.revision} ({t(`sa.state.${r.state}`)})
                  </Link>
                ))}
              </Detail>
            )}
          </dl>
        </Panel>
        <Panel title={t("sa.lines")} className="lg:col-span-2">
          <Table
            rows={q.lines}
            rowKey={(l) => l.id}
            columns={[
              {
                key: "desc",
                label: t("sa.product"),
                render: (l) => (
                  <span>
                    {l.description}
                    <span className="block font-mono text-xs text-slate-500">
                      {l.productCode}
                    </span>
                  </span>
                ),
              },
              {
                key: "qty",
                label: t("sa.quantity"),
                align: "right",
                render: (l) => `${Number(l.quantity)} ${l.unit}`,
              },
              {
                key: "list",
                label: t("sa.listPrice"),
                align: "right",
                render: (l) =>
                  l.listPrice ? formatTaka(l.listPrice, lang) : "—",
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
                render: (l) => (
                  <span>
                    {Number(l.discountPercent)}{" "}
                    <span className="text-xs text-slate-500">
                      / {Number(l.discountLimit)}
                    </span>
                    {l.overLimit && (
                      <Badge color="amber"> {t("sa.overLimit")}</Badge>
                    )}
                  </span>
                ),
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
          <dl className="mt-3 grid grid-cols-2 gap-1 text-sm sm:ml-auto sm:w-72">
            <dt>{t("sa.subtotal")}</dt>
            <dd className="text-right tabular-nums">
              {formatTaka(q.subtotal, lang)}
            </dd>
            <dt>{t("sa.discountTotal")}</dt>
            <dd className="text-right tabular-nums">
              {formatTaka(q.discountTotal, lang)}
            </dd>
            <dt>{t("sa.value")}</dt>
            <dd className="text-right tabular-nums">
              {formatTaka(q.value, lang)}
            </dd>
            {Number(q.sdTotal) > 0 && (
              <>
                <dt>{t("sa.sd")}</dt>
                <dd className="text-right tabular-nums">
                  {formatTaka(q.sdTotal, lang)}
                </dd>
              </>
            )}
            <dt>{t("sa.vat")}</dt>
            <dd className="text-right tabular-nums">
              {formatTaka(q.vatTotal, lang)}
            </dd>
            <dt className="font-semibold">{t("sa.total")}</dt>
            <dd className="text-right font-semibold tabular-nums">
              {formatTaka(q.total, lang)}
            </dd>
          </dl>
        </Panel>
      </div>
      {dialog === "revise" && company && (
        <QuotationDialog
          companyId={company.id}
          revising={q}
          onClose={() => setDialog(null)}
          onDone={(nid) => router.push(`/portal/sales/quotations/${nid}`)}
        />
      )}
      {(dialog === "accept" || dialog === "reject") && (
        <DecisionDialog
          q={q}
          accept={dialog === "accept"}
          onClose={() => setDialog(null)}
          onDone={() => (setDialog(null), quote.reload())}
        />
      )}
    </div>
  );
}

function DecisionDialog({
  q,
  accept,
  onClose,
  onDone,
}: {
  q: QuotationDetail;
  accept: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [text, setText] = useState("");
  return (
    <Modal
      title={accept ? t("sa.accept") : t("sa.reject")}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = accept
            ? { version: q.version, ...(text ? { customerRef: text } : {}) }
            : { version: q.version, ...(text ? { reason: text } : {}) };
          if (
            await save.run(() =>
              api.post(
                `/quotations/${q.id}/${accept ? "accept" : "reject"}`,
                body,
              ),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={accept ? t("sa.customerRef") : t("sa.reason")}>
          <Input
            maxLength={accept ? 100 : 500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            id="decision-text"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={accept ? t("sa.accept") : t("sa.reject")}
        />
      </form>
    </Modal>
  );
}
