"use client";
/** One bank account: match statement lines to the books, import statements, and the reconciliation. */
import { use, useState } from "react";
import {
  MatchPanel,
  ReconciliationPanel,
  StatementsPanel,
} from "@/components/portal/bank";
import { PageHeader, Tabs } from "@/components/portal/kit";
import { Badge, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import type { BankAccount } from "@/lib/bank-types";
import { formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Tab = "match" | "statements" | "reconciliation";

export default function BankAccountPage({
  params,
}: PageProps<"/portal/bank/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const account = useApi<BankAccount>(`/bank-accounts/${id}`);
  const [tab, setTab] = useState<Tab>("match");
  if (account.loading && !account.data) return <Loading />;
  if (account.error)
    return <ErrorBox error={account.error} onRetry={account.reload} />;
  const b = account.data!;
  return (
    <div>
      <PageHeader
        title={`${b.bankName} · ${b.accountNo}`}
        subtitle={`${b.accountCode} · ${b.accountNameEn} · ${t("bk.ledgerBalance")} ${formatTaka(b.ledgerBalance, lang)} · ${t("bk.reconcileFrom")} ${formatDate(b.reconcileFrom, lang, { short: true })}`}
        actions={
          <Badge color="gray">{t(`bk.format.${b.statementFormat}`)}</Badge>
        }
      />
      <Tabs<Tab>
        tabs={[
          { key: "match", label: t("bk.tab.match") },
          { key: "statements", label: t("bk.tab.statements") },
          { key: "reconciliation", label: t("bk.tab.reconciliation") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "match" && <MatchPanel account={b} onChanged={account.reload} />}
      {tab === "statements" && (
        <StatementsPanel account={b} onImported={account.reload} />
      )}
      {tab === "reconciliation" && <ReconciliationPanel account={b} />}
    </div>
  );
}
