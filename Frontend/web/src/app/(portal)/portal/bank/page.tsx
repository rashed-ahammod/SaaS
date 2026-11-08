"use client";
/** Bank reconciliation (WP20): the company's bank accounts, each with its books and statement position. */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { NewBankAccountDialog } from "@/components/portal/bank";
import { Taka } from "@/components/portal/finance";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, Button, ErrorBox } from "@/components/ui";
import { useApi } from "@/lib/api";
import type { BankAccount } from "@/lib/bank-types";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function BankPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const [creating, setCreating] = useState(false);
  const accounts = useApi<BankAccount[]>(
    company ? `/companies/${company.id}/bank-accounts` : null,
  );
  if (!company) return null;
  return (
    <div>
      <PageHeader
        title={t("bk.title")}
        subtitle={company.legalName}
        actions={
          can("bank.reconcile") && (
            <Button onClick={() => setCreating(true)}>{t("bk.new")}</Button>
          )
        }
      />
      <Panel>
        {accounts.error ? (
          <ErrorBox error={accounts.error} onRetry={accounts.reload} />
        ) : (
          <Table
            rows={accounts.data}
            rowKey={(b) => b.id}
            empty={t("bk.none")}
            onRowClick={(b) => router.push(`/portal/bank/${b.id}`)}
            columns={[
              {
                key: "bank",
                label: t("bk.bank"),
                render: (b) => (
                  <span>
                    {b.bankName}
                    {b.branch && (
                      <span className="block text-xs text-slate-500">
                        {b.branch}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: "no",
                label: t("bk.accountNo"),
                className: "font-mono",
                render: (b) => b.accountNo,
              },
              {
                key: "ledger",
                label: t("bk.ledgerAccount"),
                render: (b) => `${b.accountCode} · ${b.accountNameEn}`,
              },
              {
                key: "balance",
                label: t("bk.ledgerBalance"),
                align: "right",
                render: (b) => <Taka value={b.ledgerBalance} />,
              },
              {
                key: "last",
                label: t("bk.lastStatement"),
                render: (b) =>
                  b.lastStatementDate
                    ? formatDate(b.lastStatementDate, lang, { short: true })
                    : "—",
              },
              {
                key: "open",
                label: t("bk.unmatched"),
                align: "right",
                render: (b) =>
                  b.unmatchedStatementLines ? (
                    <Badge color="amber">{b.unmatchedStatementLines}</Badge>
                  ) : (
                    <Badge color="green">0</Badge>
                  ),
              },
            ]}
          />
        )}
      </Panel>
      {creating && (
        <NewBankAccountDialog
          companyId={company.id}
          onClose={() => setCreating(false)}
          onDone={(id) => router.push(`/portal/bank/${id}`)}
        />
      )}
    </div>
  );
}
