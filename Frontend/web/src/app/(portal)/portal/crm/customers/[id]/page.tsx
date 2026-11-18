"use client";
/** One customer: details, contacts, credit terms (Accounts), the leads that became it, its opportunities and every activity. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import {
  ActivityTimeline,
  AssignDialog,
  ContactDialog,
  CreditDialog,
} from "@/components/portal/crm";
import {
  OpportunitiesPanel,
  OpportunityDialog,
} from "@/components/portal/opportunities";
import {
  CustomerAccountPanel,
  QuotationDialog,
  ReceiptDialog,
} from "@/components/portal/sales";
import { Detail, PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  Badge,
  Button,
  ButtonLink,
  ErrorBox,
  Loading,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import type { Customer } from "@/lib/crm-types";
import { formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function CustomerPage({
  params,
}: PageProps<"/portal/crm/customers/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  const customer = useApi<Customer>(`/customers/${id}`);
  const router = useRouter();
  const [dialog, setDialog] = useState<
    | "contact"
    | "credit"
    | "assign"
    | "opportunity"
    | "quotation"
    | "receipt"
    | null
  >(null);
  if (customer.loading && !customer.data) return <Loading />;
  if (customer.error)
    return <ErrorBox error={customer.error} onRetry={customer.reload} />;
  const c = customer.data!;
  const done = () => (setDialog(null), customer.reload());
  const sales = can("crm.own", "crm.view", "crm.manage", "crm.assign");
  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">{c.code}</span> {c.name}{" "}
            <Badge color="gray">{t(`cr.type.${c.customerType}`)}</Badge>
          </span>
        }
        subtitle={c.nameBn ?? undefined}
        actions={
          <>
            {c.canSetCredit && (
              <Button onClick={() => setDialog("credit")}>
                {t("cr.setCredit")}
              </Button>
            )}
            {c.canWork && (
              <Button onClick={() => setDialog("quotation")}>
                {t("sa.newQuotation")}
              </Button>
            )}
            {can("receivables.manage") && (
              <Button variant="secondary" onClick={() => setDialog("receipt")}>
                {t("sa.newReceipt")}
              </Button>
            )}
            {c.canWork && (
              <Button variant="secondary" onClick={() => setDialog("contact")}>
                {t("cr.addContact")}
              </Button>
            )}
            {can("crm.assign", "crm.manage") && (
              <Button variant="ghost" onClick={() => setDialog("assign")}>
                {t("cr.assign")}
              </Button>
            )}
            <ButtonLink variant="ghost" href={`/portal/crm/customers/${id}/360`}>
              {t("su.c360")}
            </ButtonLink>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel>
          <dl className="grid gap-3">
            <Detail label={t("cr.phone")}>{c.phone ?? "—"}</Detail>
            <Detail label={t("cr.email")}>{c.email ?? "—"}</Detail>
            <Detail label={t("cr.bin")}>{c.bin ?? "—"}</Detail>
            <Detail label={t("cr.address")}>
              {[c.address, c.district].filter(Boolean).join(", ") || "—"}
            </Detail>
            <Detail label={t("cr.accountManager")}>
              {c.managerName ?? "—"}
            </Detail>
            <Detail label={t("cr.creditLimit")}>
              {formatTaka(c.creditLimit, lang)} · {t("cr.paymentTerms")}:{" "}
              {c.paymentTermsDays}
            </Detail>
            {!!c.leads?.length && (
              <Detail label={t("cr.fromLead")}>
                {c.leads.map((l) => (
                  <Link
                    key={l.id}
                    className="mr-2 font-mono text-xs underline"
                    href={`/portal/crm/leads/${l.id}`}
                  >
                    {l.number}
                  </Link>
                ))}
              </Detail>
            )}
          </dl>
        </Panel>
        <Panel title={t("cr.contacts")} className="lg:col-span-2">
          <Table
            rows={c.contacts}
            rowKey={(x) => x.id}
            empty={t("st.none")}
            columns={[
              {
                key: "name",
                label: t("cr.name"),
                render: (x) => (
                  <span>
                    {x.name}{" "}
                    {x.isPrimary && (
                      <Badge color="green">{t("cr.primary")}</Badge>
                    )}
                  </span>
                ),
              },
              {
                key: "designation",
                label: t("cr.designation"),
                render: (x) => x.designation ?? "",
              },
              {
                key: "phone",
                label: t("cr.phone"),
                render: (x) => x.phone ?? "",
              },
              {
                key: "email",
                label: t("cr.email"),
                render: (x) => x.email ?? "",
              },
            ]}
          />
        </Panel>
      </div>
      {sales && (
        <OpportunitiesPanel
          rows={c.opportunities ?? []}
          actions={
            c.canWork && (
              <Button
                variant="secondary"
                onClick={() => setDialog("opportunity")}
              >
                {t("cr.newOpportunity")}
              </Button>
            )
          }
        />
      )}
      {(sales || can("receivables.view")) && (
        <CustomerAccountPanel
          customerId={c.id}
          canApply={can("receivables.manage")}
        />
      )}
      {sales && (
        <ActivityTimeline
          activities={c.activities ?? []}
          postPath={`/customers/${c.id}/activities`}
          canWork={!!c.canWork}
          onChanged={customer.reload}
        />
      )}
      {dialog === "contact" && (
        <ContactDialog
          customerId={c.id}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === "credit" && (
        <CreditDialog
          customer={c}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === "assign" && company && (
        <AssignDialog
          companyId={company.id}
          path={`/customers/${c.id}/assign`}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === "quotation" && company && (
        <QuotationDialog
          companyId={company.id}
          customerId={c.id}
          onClose={() => setDialog(null)}
          onDone={(qid) => router.push(`/portal/sales/quotations/${qid}`)}
        />
      )}
      {dialog === "receipt" && company && (
        <ReceiptDialog
          companyId={company.id}
          customerId={c.id}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === "opportunity" && company && (
        <OpportunityDialog
          companyId={company.id}
          customer={c}
          onClose={() => setDialog(null)}
          onDone={(oid) => router.push(`/portal/crm/opportunities/${oid}`)}
        />
      )}
    </div>
  );
}
