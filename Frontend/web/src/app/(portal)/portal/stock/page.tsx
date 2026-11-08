"use client";
/**
 * Stores and consumables (WP19): what is on hand in each store (and what is running
 * low), receiving and stock counts, the employees' requests to issue, and the setup.
 */
import { useState } from "react";
import { PageHeader, Panel, Table, Tabs } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  IssueDialog,
  LedgerPanel,
  MovesDialog,
  qty,
  SetupPanel,
} from "@/components/portal/stock";
import { Badge, Button, ErrorBox, Select } from "@/components/ui";
import { useApi } from "@/lib/api";
import {
  STOCK_REQUEST_COLOR,
  type StockBalance,
  type StockRequest,
  type Store,
} from "@/lib/asset-types";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Tab = "stock" | "requests" | "setup";

export default function StockPage() {
  const { t } = useI18n();
  const { company } = usePortal();
  const [tab, setTab] = useState<Tab>("stock");
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("st.title")} subtitle={company.legalName} />
      <Tabs<Tab>
        tabs={[
          { key: "stock", label: t("st.tab.stock") },
          { key: "requests", label: t("st.tab.requests") },
          { key: "setup", label: t("st.tab.setup") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "stock" && <OnHand companyId={company.id} />}
      {tab === "requests" && <Requests companyId={company.id} />}
      {tab === "setup" && <SetupPanel companyId={company.id} />}
    </div>
  );
}

function OnHand({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const stores = useApi<Store[]>(`/companies/${companyId}/stores`);
  const [storeId, setStoreId] = useState("");
  const [low, setLow] = useState(false);
  const [moving, setMoving] = useState<
    "receipt" | "adjustment" | "opening" | null
  >(null);
  const [ledgerKey, setLedgerKey] = useState(0);
  const query = new URLSearchParams({
    ...(storeId ? { storeId } : {}),
    ...(low ? { belowReorder: "true" } : {}),
  }).toString();
  const balances = useApi<StockBalance[]>(
    `/companies/${companyId}/stock${query ? `?${query}` : ""}`,
  );
  const store = stores.data?.find((s) => s.id === storeId);
  const manage = can("stock.manage");
  return (
    <>
      <Panel
        actions={
          <>
            <Select
              aria-label={t("st.store")}
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              id="stock-store"
            >
              <option value="">{t("p.all")}</option>
              {stores.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={low}
                onChange={(e) => setLow(e.target.checked)}
                id="stock-low"
              />{" "}
              {t("st.belowOnly")}
            </label>
            {manage && store && (
              <>
                <Button onClick={() => setMoving("receipt")}>
                  {t("st.receive")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setMoving("adjustment")}
                >
                  {t("st.adjust")}
                </Button>
                <Button variant="ghost" onClick={() => setMoving("opening")}>
                  {t("st.opening")}
                </Button>
              </>
            )}
          </>
        }
      >
        {balances.error ? (
          <ErrorBox error={balances.error} onRetry={balances.reload} />
        ) : (
          <Table
            rows={balances.data}
            rowKey={(b) => `${b.storeId}:${b.itemId}`}
            empty={t("st.none")}
            columns={[
              {
                key: "store",
                label: t("st.store"),
                render: (b) => b.storeName,
              },
              {
                key: "item",
                label: t("st.item"),
                render: (b) =>
                  lang === "bn" && b.itemNameBn ? b.itemNameBn : b.itemName,
              },
              {
                key: "qty",
                label: t("st.onHand"),
                align: "right",
                render: (b) => `${qty(b.quantity, lang)} ${b.unit}`,
              },
              {
                key: "reorder",
                label: t("st.reorder"),
                align: "right",
                render: (b) => qty(b.reorderLevel, lang),
              },
              {
                key: "low",
                label: "",
                render: (b) =>
                  b.belowReorder ? (
                    <Badge color="red">{t("st.low")}</Badge>
                  ) : null,
              },
            ]}
          />
        )}
      </Panel>
      {store && <LedgerPanel key={`${store.id}:${ledgerKey}`} store={store} />}
      {moving && store && (
        <MovesDialog
          companyId={companyId}
          store={store}
          kind={moving}
          onClose={() => setMoving(null)}
          onDone={() => (
            setMoving(null),
            setLedgerKey((k) => k + 1),
            balances.reload()
          )}
        />
      )}
    </>
  );
}

function Requests({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const [state, setState] = useState("");
  const requests = useApi<StockRequest[]>(
    `/companies/${companyId}/stock-requests${state ? `?state=${state}` : ""}`,
  );
  const [issuing, setIssuing] = useState<string | null>(null);
  return (
    <Panel
      actions={
        <Select
          aria-label={t("p.status")}
          value={state}
          onChange={(e) => setState(e.target.value)}
          id="request-state"
        >
          <option value="">{t("p.all")}</option>
          {(
            [
              "in_approval",
              "approved",
              "partially_issued",
              "issued",
              "rejected",
              "cancelled",
            ] as const
          ).map((s) => (
            <option key={s} value={s}>
              {t(`st.req.${s}`)}
            </option>
          ))}
        </Select>
      }
    >
      {requests.error ? (
        <ErrorBox error={requests.error} onRetry={requests.reload} />
      ) : (
        <Table
          rows={requests.data}
          rowKey={(r) => r.id}
          empty={t("st.none")}
          columns={[
            {
              key: "number",
              label: "#",
              className: "font-mono whitespace-nowrap",
              render: (r) => r.number,
            },
            {
              key: "date",
              label: t("st.moveDate"),
              render: (r) =>
                formatDate(r.createdAt.slice(0, 10), lang, { short: true }),
            },
            {
              key: "who",
              label: t("as.employee"),
              render: (r) =>
                `${r.requesterName ?? ""}${r.departmentName ? ` · ${r.departmentName}` : ""}`,
            },
            {
              key: "store",
              label: t("st.store"),
              render: (r) => r.storeName ?? "",
            },
            {
              key: "note",
              label: t("as.note"),
              render: (r) => <span className="text-xs">{r.note ?? ""}</span>,
            },
            {
              key: "state",
              label: t("p.status"),
              render: (r) => (
                <Badge color={STOCK_REQUEST_COLOR[r.state]}>
                  {t(`st.req.${r.state}`)}
                </Badge>
              ),
            },
            {
              key: "act",
              label: "",
              align: "right",
              render: (r) =>
                can("stock.manage") &&
                (r.state === "approved" || r.state === "partially_issued") ? (
                  <Button
                    variant="secondary"
                    className="min-h-8 px-2 py-1 text-sm"
                    onClick={() => setIssuing(r.id)}
                  >
                    {t("st.issue")}
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      {issuing && (
        <IssueDialog
          requestId={issuing}
          onClose={() => setIssuing(null)}
          onDone={() => (setIssuing(null), requests.reload())}
        />
      )}
    </Panel>
  );
}
