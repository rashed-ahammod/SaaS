"use client";
/**
 * Customer 360 (Phase 3 WP28; spec §6.8): contacts, activities, opportunities, quotations,
 * orders, invoices, dues and tickets on one page.
 *
 * A block the viewer may not see is not here at all — the API leaves it out rather than
 * sending an empty one, and the page says so plainly instead of pretending there is
 * nothing. Accounts sees the money; a Sales user sees their own customer's work; only
 * someone who may see tickets sees the tickets.
 */
import Link from "next/link";
import { use } from "react";
import { Detail, PageHeader, Panel, Stat, Table } from "@/components/portal/kit";
import { PriorityBadge, StateBadge, useWhen } from "@/components/portal/support";
import { Badge, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Customer360 } from "@/lib/support-types";

export default function Customer360Page({
  params,
}: PageProps<"/portal/crm/customers/[id]/360">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const when = useWhen();
  const page = useApi<Customer360>(`/customers/${id}/360`);
  if (page.loading && !page.data) return <Loading />;
  if (page.error) return <ErrorBox error={page.error} onRetry={page.reload} />;
  const p = page.data!;
  const taka = (v: string) => formatTaka(v, lang);

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">{p.customer.code}</span>
            {p.customer.name}
          </span>
        }
        subtitle={t("su.c360Hint")}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={t("su.c360")}>
          <dl className="grid gap-3">
            <Detail label={t("cr.phone")}>{p.customer.phone ?? "—"}</Detail>
            <Detail label={t("cr.email")}>{p.customer.email ?? "—"}</Detail>
            <Detail label={t("cr.address")}>
              {[p.customer.address, p.customer.district]
                .filter(Boolean)
                .join(", ") || "—"}
            </Detail>
            <Detail label={t("cr.customers")}>
              <Link className="underline" href={`/portal/crm/customers/${id}`}>
                {t("cr.customers")}
              </Link>
            </Detail>
          </dl>
        </Panel>

        <Panel title={t("su.contacts")} className="lg:col-span-2">
          <Table
            rows={p.contacts}
            rowKey={(c) => c.id}
            empty={t("st.none")}
            columns={[
              {
                key: "name",
                label: t("cr.name"),
                render: (c) => (
                  <span>
                    {c.name}
                    {c.isPrimary && (
                      <>
                        {" "}
                        <Badge color="blue">{t("cr.primary")}</Badge>
                      </>
                    )}
                  </span>
                ),
              },
              {
                key: "designation",
                label: t("cr.designation"),
                render: (c) => c.designation ?? "",
              },
              {
                key: "phone",
                label: t("cr.phone"),
                render: (c) => c.phone ?? "",
              },
              {
                key: "email",
                label: t("cr.email"),
                render: (c) => c.email ?? "",
              },
            ]}
          />
        </Panel>
      </div>

      {p.dues ? (
        <Panel title={t("su.dues")}>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Stat label={t("su.owed")} value={taka(p.dues.owed)} />
            <Stat label={t("su.overdue")} value={taka(p.dues.overdue)} />
            <Stat
              label={t("cr.creditLimit")}
              value={taka(p.dues.creditLimit)}
            />
            <Stat
              label={t("cr.paymentTerms")}
              value={String(p.dues.paymentTermsDays)}
            />
          </div>
          <Table
            rows={p.dues.items}
            rowKey={(i) => i.id}
            empty={t("st.none")}
            columns={[
              {
                key: "ref",
                label: t("su.number"),
                className: "font-mono",
                render: (i) => i.reference,
              },
              {
                key: "due",
                label: t("sa.dueDate"),
                render: (i) => (
                  <span>
                    {i.dueDate}{" "}
                    {i.overdue && <Badge color="red">{t("su.overdue")}</Badge>}
                  </span>
                ),
              },
              {
                key: "amount",
                label: t("su.owed"),
                align: "right",
                render: (i) => taka(i.outstanding),
              },
            ]}
          />
        </Panel>
      ) : (
        <Panel title={t("su.dues")}>
          <p className="text-sm text-slate-500">{t("su.hidden")}</p>
        </Panel>
      )}

      {p.tickets ? (
        <Panel title={t("su.tickets")}>
          <Table
            rows={p.tickets}
            rowKey={(x) => x.id}
            empty={t("st.none")}
            columns={[
              {
                key: "number",
                label: t("su.number"),
                className: "font-mono",
                render: (x) => (
                  <Link
                    className="underline"
                    href={`/portal/support/tickets/${x.id}`}
                  >
                    {x.number}
                  </Link>
                ),
              },
              {
                key: "subject",
                label: t("su.subject"),
                render: (x) => (
                  <span>
                    {x.subject}
                    <span className="block text-xs text-slate-500">
                      {x.categoryName}
                    </span>
                  </span>
                ),
              },
              {
                key: "priority",
                label: t("su.priority"),
                render: (x) => <PriorityBadge priority={x.priority} />,
              },
              {
                key: "state",
                label: t("su.state"),
                render: (x) => (
                  <span className="flex flex-wrap items-center gap-1">
                    <StateBadge state={x.state} />
                    {x.breached && (
                      <Badge color="red">{t("su.breached")}</Badge>
                    )}
                  </span>
                ),
              },
              {
                key: "created",
                label: t("su.created"),
                render: (x) => when(x.createdAt),
              },
            ]}
          />
        </Panel>
      ) : (
        <Panel title={t("su.tickets")}>
          <p className="text-sm text-slate-500">{t("su.hidden")}</p>
        </Panel>
      )}

      {p.opportunities && (
        <Panel title={t("su.opportunities")}>
          <Table
            rows={p.opportunities}
            rowKey={(o) => o.id}
            empty={t("st.none")}
            columns={[
              {
                key: "number",
                label: t("su.number"),
                className: "font-mono",
                render: (o) => (
                  <Link
                    className="underline"
                    href={`/portal/crm/opportunities/${o.id}`}
                  >
                    {o.number}
                  </Link>
                ),
              },
              {
                key: "title",
                label: t("su.subject"),
                render: (o) => o.title,
              },
              {
                key: "stage",
                label: t("cr.stage"),
                render: (o) => o.stageName ?? "",
              },
              {
                key: "value",
                label: t("cr.value"),
                align: "right",
                render: (o) => taka(o.value),
              },
              {
                key: "close",
                label: t("cr.expectedClose"),
                render: (o) => o.expectedCloseOn,
              },
            ]}
          />
        </Panel>
      )}

      {p.quotations && (
        <Panel title={t("su.quotations")}>
          <Table
            rows={p.quotations}
            rowKey={(q) => q.id}
            empty={t("st.none")}
            columns={[
              {
                key: "number",
                label: t("su.number"),
                className: "font-mono",
                render: (q) => (
                  <Link
                    className="underline"
                    href={`/portal/sales/quotations/${q.id}`}
                  >
                    {q.number}
                  </Link>
                ),
              },
              {
                key: "date",
                label: t("su.created"),
                render: (q) => q.quoteDate,
              },
              {
                key: "state",
                label: t("su.state"),
                render: (q) => q.state,
              },
              {
                key: "total",
                label: t("sa.total"),
                align: "right",
                render: (q) => taka(q.total),
              },
            ]}
          />
        </Panel>
      )}

      {p.invoices && (
        <Panel title={t("su.invoices")}>
          <Table
            rows={p.invoices}
            rowKey={(i) => i.id}
            empty={t("st.none")}
            columns={[
              {
                key: "no",
                label: t("su.number"),
                className: "font-mono",
                render: (i) => i.invoiceNo,
              },
              {
                key: "date",
                label: t("su.created"),
                render: (i) => i.invoiceDate,
              },
              {
                key: "due",
                label: t("sa.dueDate"),
                render: (i) => i.dueDate,
              },
              {
                key: "total",
                label: t("sa.total"),
                align: "right",
                render: (i) => taka(i.total),
              },
            ]}
          />
        </Panel>
      )}

      {p.activities && (
        <Panel title={t("su.activities")}>
          <ol className="space-y-2">
            {p.activities.length === 0 && (
              <li className="text-sm text-slate-500">{t("st.none")}</li>
            )}
            {p.activities.map((a) => (
              <li key={a.id} className="border-l-2 border-slate-200 pl-3">
                <p className="text-sm">
                  <Badge color={a.doneAt ? "green" : "blue"}>{a.kind}</Badge>{" "}
                  {a.subject}
                </p>
                <p className="text-xs text-slate-500">{when(a.at)}</p>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}
