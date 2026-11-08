"use client";
/** Customers (Phase 3 WP23): within the viewer's scope; Accounts sees all for credit terms. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CustomerDialog } from "@/components/portal/crm";
import { Taka } from "@/components/portal/finance";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Button, ErrorBox, Input, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import { CUSTOMER_TYPES, type Customer } from "@/lib/crm-types";
import { useI18n } from "@/lib/i18n";

export default function CustomersPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [creating, setCreating] = useState(false);
  const query = new URLSearchParams({
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(type ? { type } : {}),
  }).toString();
  const customers = useApi<Customer[]>(
    company ? `/companies/${company.id}/customers?${query}` : null,
  );
  if (!company) return null;
  return (
    <div>
      <PageHeader
        title={t("cr.customers")}
        subtitle={company.legalName}
        actions={
          can("crm.own", "crm.assign", "crm.manage") && (
            <Button onClick={() => setCreating(true)}>
              {t("cr.newCustomerBtn")}
            </Button>
          )
        }
      />
      <Panel
        actions={
          <>
            <Input
              aria-label={t("cr.search")}
              placeholder={t("cr.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              id="customer-search"
            />
            <Select
              aria-label={t("cr.customerType")}
              value={type}
              onChange={(e) => setType(e.target.value)}
              id="customer-type"
            >
              <option value="">{t("p.all")}</option>
              {CUSTOMER_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`cr.type.${x}`)}
                </option>
              ))}
            </Select>
          </>
        }
      >
        {customers.error ? (
          <ErrorBox error={customers.error} onRetry={customers.reload} />
        ) : (
          <Table
            rows={customers.data}
            rowKey={(c) => c.id}
            empty={t("st.none")}
            onRowClick={(c) => router.push(`/portal/crm/customers/${c.id}`)}
            columns={[
              {
                key: "code",
                label: t("cr.code"),
                className: "font-mono",
                render: (c) => c.code,
              },
              {
                key: "name",
                label: t("cr.name"),
                render: (c) => (
                  <span>
                    {c.name}
                    {c.bin && (
                      <span className="block font-mono text-xs text-slate-500">
                        {c.bin}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: "type",
                label: t("cr.customerType"),
                render: (c) => t(`cr.type.${c.customerType}`),
              },
              {
                key: "district",
                label: t("cr.district"),
                render: (c) => c.district ?? "",
              },
              {
                key: "manager",
                label: t("cr.accountManager"),
                render: (c) => c.managerName ?? "",
              },
              {
                key: "credit",
                label: t("cr.creditLimit"),
                align: "right",
                render: (c) => <Taka value={c.creditLimit} />,
              },
              {
                key: "terms",
                label: t("cr.paymentTerms"),
                align: "right",
                render: (c) => c.paymentTermsDays,
              },
            ]}
          />
        )}
      </Panel>
      {creating && (
        <CustomerDialog
          companyId={company.id}
          onClose={() => setCreating(false)}
          onDone={(id) => router.push(`/portal/crm/customers/${id}`)}
        />
      )}
    </div>
  );
}
