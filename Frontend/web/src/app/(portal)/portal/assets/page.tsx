"use client";
/**
 * Fixed assets (WP19): the register (who has what, cost, book value), the monthly
 * depreciation (Accounts) and the asset classes (Admin).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ClassesPanel,
  DepreciationPanel,
  NewAssetDialog,
} from "@/components/portal/assets";
import { Taka } from "@/components/portal/finance";
import { PageHeader, Panel, Table, Tabs } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, Button, ErrorBox, Input, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import { ASSET_STATE_COLOR, type AssetSummary } from "@/lib/asset-types";
import { useI18n } from "@/lib/i18n";

type Tab = "register" | "depreciation" | "classes";

export default function AssetsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const [tab, setTab] = useState<Tab>("register");
  const [creating, setCreating] = useState(false);
  if (!company) return null;
  return (
    <div>
      <PageHeader
        title={t("as.title")}
        subtitle={company.legalName}
        actions={
          can("assets.manage") && (
            <Button onClick={() => setCreating(true)}>{t("as.new")}</Button>
          )
        }
      />
      <Tabs<Tab>
        tabs={[
          { key: "register", label: t("as.tab.register") },
          { key: "depreciation", label: t("as.tab.depreciation") },
          { key: "classes", label: t("as.tab.classes") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "register" && <Register companyId={company.id} />}
      {tab === "depreciation" && <DepreciationPanel companyId={company.id} />}
      {tab === "classes" && <ClassesPanel companyId={company.id} />}
      {creating && (
        <NewAssetDialog
          companyId={company.id}
          onClose={() => setCreating(false)}
          onDone={(id) => router.push(`/portal/assets/${id}`)}
        />
      )}
    </div>
  );
}

function Register({ companyId }: { companyId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [state, setState] = useState("");
  const [q, setQ] = useState("");
  const query = new URLSearchParams({
    ...(state ? { state } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  }).toString();
  const assets = useApi<AssetSummary[]>(
    `/companies/${companyId}/assets${query ? `?${query}` : ""}`,
  );
  return (
    <Panel
      actions={
        <>
          <Input
            aria-label={t("as.search")}
            placeholder={t("as.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            id="asset-search"
          />
          <Select
            aria-label={t("p.status")}
            value={state}
            onChange={(e) => setState(e.target.value)}
            id="asset-state"
          >
            <option value="">{t("p.all")}</option>
            {(["in_store", "assigned", "disposed"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`as.state.${s}`)}
              </option>
            ))}
          </Select>
        </>
      }
    >
      {assets.error ? (
        <ErrorBox error={assets.error} onRetry={assets.reload} />
      ) : (
        <Table
          rows={assets.data}
          rowKey={(a) => a.id}
          empty={t("st.none")}
          onRowClick={(a) => router.push(`/portal/assets/${a.id}`)}
          columns={[
            {
              key: "tag",
              label: t("as.tag"),
              className: "font-mono whitespace-nowrap",
              render: (a) => a.tag,
            },
            { key: "name", label: t("as.name"), render: (a) => a.name },
            { key: "class", label: t("as.class"), render: (a) => a.classCode },
            {
              key: "department",
              label: t("as.department"),
              render: (a) => a.departmentName ?? "",
            },
            {
              key: "holder",
              label: t("as.holder"),
              render: (a) =>
                a.holder ? (
                  <span className="text-sm">
                    {a.holder.name}
                    {!a.holder.acknowledged && (
                      <span className="block text-xs text-amber-700">
                        {t("as.notAcknowledged")}
                      </span>
                    )}
                  </span>
                ) : (
                  <Badge color={ASSET_STATE_COLOR[a.state]}>
                    {t(`as.state.${a.state}`)}
                  </Badge>
                ),
            },
            {
              key: "cost",
              label: t("as.cost"),
              align: "right",
              render: (a) => <Taka value={a.cost} />,
            },
            {
              key: "book",
              label: t("as.bookValue"),
              align: "right",
              render: (a) => <Taka value={a.bookValue} />,
            },
          ]}
        />
      )}
    </Panel>
  );
}
