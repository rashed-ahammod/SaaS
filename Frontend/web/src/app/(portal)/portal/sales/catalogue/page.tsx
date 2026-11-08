"use client";
/** Products, price lists and discount limits (Phase 3 WP25): set up by the Admin or Accounts, read by salespeople. */
import { useState } from "react";
import { SalespersonSelect } from "@/components/portal/crm";
import {
  ActionMessage,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Table,
  Tabs,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, Button, ErrorBox, Field, Input, Select } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { CUSTOMER_TYPES } from "@/lib/crm-types";
import { formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { DiscountLimit, PriceList, Product } from "@/lib/sales-types";

type Tab = "products" | "prices" | "limits";

export default function CataloguePage() {
  const { t } = useI18n();
  const { company, can } = usePortal();
  const [tab, setTab] = useState<Tab>("products");
  if (!company) return null;
  const manage = can("sales.catalogue");
  return (
    <div>
      <PageHeader title={t("sa.nav.catalogue")} subtitle={company.legalName} />
      <Tabs
        tabs={[
          { key: "products" as Tab, label: t("sa.products") },
          { key: "prices" as Tab, label: t("sa.priceLists") },
          { key: "limits" as Tab, label: t("sa.limits") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "products" && (
        <ProductsTab companyId={company.id} manage={manage} />
      )}
      {tab === "prices" && <PricesTab companyId={company.id} manage={manage} />}
      {tab === "limits" && <LimitsTab companyId={company.id} manage={manage} />}
    </div>
  );
}

function ProductsTab({
  companyId,
  manage,
}: {
  companyId: string;
  manage: boolean;
}) {
  const { t } = useI18n();
  const products = useApi<Product[]>(`/companies/${companyId}/products`);
  const vatItems = useApi<Array<{ id: string; code: string; nameEn: string }>>(
    manage ? `/companies/${companyId}/vat-items` : null,
  );
  const stockItems = useApi<
    Array<{ id: string; code: string; name: string; unit: string }>
  >(manage ? `/companies/${companyId}/stock-items` : null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const save = useAction();
  const [f, setF] = useState({
    code: "",
    name: "",
    nameBn: "",
    kind: "goods",
    unit: "",
    vatItemId: "",
    stockItemId: "",
  });
  return (
    <Panel
      actions={
        manage && (
          <Button onClick={() => setAdding(true)}>{t("sa.newProduct")}</Button>
        )
      }
    >
      {products.error ? (
        <ErrorBox error={products.error} onRetry={products.reload} />
      ) : (
        <Table
          rows={products.data}
          rowKey={(p) => p.id}
          empty={t("st.none")}
          onRowClick={manage ? (p) => setEditing(p) : undefined}
          columns={[
            {
              key: "code",
              label: t("sa.code"),
              className: "font-mono text-xs",
              render: (p) => p.code,
            },
            {
              key: "name",
              label: t("sa.name"),
              render: (p) => (
                <span>
                  {p.name}
                  {p.nameBn && (
                    <span className="block text-xs text-slate-500">
                      {p.nameBn}
                    </span>
                  )}
                </span>
              ),
            },
            { key: "unit", label: t("sa.unit"), render: (p) => p.unit },
            {
              key: "kind",
              label: t("sa.kind"),
              render: (p) => t(`sa.kind.${p.kind}`),
            },
            {
              key: "vat",
              label: t("sa.vatItem"),
              render: (p) => p.vatItem ?? "",
            },
            {
              key: "stock",
              label: t("sa.stockItem"),
              className: "font-mono text-xs",
              render: (p) => p.stockItem ?? "",
            },
            {
              key: "active",
              label: t("sa.active"),
              render: (p) =>
                p.isActive ? (
                  <Badge color="green">✓</Badge>
                ) : (
                  <Badge color="gray">—</Badge>
                ),
            },
          ]}
        />
      )}
      {editing && (
        <ProductEdit
          product={editing}
          vatItems={vatItems.data ?? []}
          stockItems={stockItems.data ?? []}
          onClose={() => setEditing(null)}
          onDone={() => (setEditing(null), products.reload())}
        />
      )}
      {adding && (
        <Modal title={t("sa.newProduct")} open onClose={() => setAdding(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const body = Object.fromEntries(
                Object.entries(f).filter(
                  ([k, v]) =>
                    v !== "" && !(k === "stockItemId" && f.kind !== "goods"),
                ),
              );
              if (
                await save.run(() =>
                  api.post(`/companies/${companyId}/products`, body),
                )
              ) {
                setAdding(false);
                products.reload();
              }
            }}
          >
            <ActionMessage action={save} />
            <div className="grid gap-x-3 sm:grid-cols-2">
              <Field label={t("sa.code")}>
                <Input
                  required
                  pattern="[A-Z0-9-]{1,30}"
                  value={f.code}
                  onChange={(e) =>
                    setF({ ...f, code: e.target.value.toUpperCase() })
                  }
                  id="product-code"
                />
              </Field>
              <Field label={t("sa.unit")}>
                <Input
                  required
                  maxLength={20}
                  value={f.unit}
                  onChange={(e) => setF({ ...f, unit: e.target.value })}
                  id="product-unit"
                  placeholder="can / bottle / kg"
                />
              </Field>
              <Field label={t("sa.name")}>
                <Input
                  required
                  maxLength={200}
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                  id="product-name"
                />
              </Field>
              <Field label={t("sa.nameBn")}>
                <Input
                  maxLength={200}
                  value={f.nameBn}
                  onChange={(e) => setF({ ...f, nameBn: e.target.value })}
                  id="product-name-bn"
                />
              </Field>
              <Field label={t("sa.kind")}>
                <Select
                  value={f.kind}
                  onChange={(e) => setF({ ...f, kind: e.target.value })}
                  id="product-kind"
                >
                  <option value="goods">{t("sa.kind.goods")}</option>
                  <option value="service">{t("sa.kind.service")}</option>
                </Select>
              </Field>
              <Field label={t("sa.vatItem")}>
                <Select
                  required
                  value={f.vatItemId}
                  onChange={(e) => setF({ ...f, vatItemId: e.target.value })}
                  id="product-vat"
                >
                  <option value="">—</option>
                  {vatItems.data?.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code} · {v.nameEn}
                    </option>
                  ))}
                </Select>
              </Field>
              {f.kind === "goods" && (
                <Field label={t("sa.stockItem")} hint={t("sa.stockHint")}>
                  <Select
                    value={f.stockItemId}
                    onChange={(e) =>
                      setF({ ...f, stockItemId: e.target.value })
                    }
                    id="product-stock"
                  >
                    <option value="">{t("sa.notInStore")}</option>
                    {stockItems.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} · {s.name} ({s.unit})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <FormButtons
              busy={save.busy}
              onCancel={() => setAdding(false)}
              submitLabel={t("sa.newProduct")}
            />
          </form>
        </Modal>
      )}
    </Panel>
  );
}

function PricesTab({
  companyId,
  manage,
}: {
  companyId: string;
  manage: boolean;
}) {
  const { t, lang } = useI18n();
  const lists = useApi<PriceList[]>(`/companies/${companyId}/price-lists`);
  const products = useApi<Product[]>(
    manage ? `/companies/${companyId}/products` : null,
  );
  const [adding, setAdding] = useState(false);
  const save = useAction();
  const [f, setF] = useState({
    name: "",
    fiscalYear: "2026-27",
    customerType: "",
  });
  const [prices, setPrices] = useState<Record<string, string>>({});
  return (
    <>
      <Panel
        actions={
          manage && (
            <Button onClick={() => setAdding(true)}>
              {t("sa.newPriceList")}
            </Button>
          )
        }
      >
        <p className="text-sm text-slate-600">{t("sa.priceListHint")}</p>
      </Panel>
      {lists.error && <ErrorBox error={lists.error} onRetry={lists.reload} />}
      {lists.data
        ?.filter((l) => l.isActive)
        .map((l) => (
          <Panel
            key={l.id}
            title={`${l.name} · ${l.fiscalYear} · ${l.customerType ? t(`cr.type.${l.customerType}`) : t("sa.allCustomers")}`}
          >
            <Table
              rows={l.prices}
              rowKey={(p) => p.productId}
              columns={[
                {
                  key: "code",
                  label: t("sa.code"),
                  className: "font-mono text-xs",
                  render: (p) => p.code,
                },
                { key: "name", label: t("sa.name"), render: (p) => p.name },
                { key: "unit", label: t("sa.unit"), render: (p) => p.unit },
                {
                  key: "price",
                  label: t("sa.unitPrice"),
                  align: "right",
                  render: (p) => formatTaka(p.unitPrice, lang),
                },
              ]}
            />
          </Panel>
        ))}
      {adding && (
        <Modal
          title={t("sa.newPriceList")}
          open
          onClose={() => setAdding(false)}
          wide
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const body = {
                name: f.name,
                fiscalYear: f.fiscalYear,
                ...(f.customerType ? { customerType: f.customerType } : {}),
                prices: Object.entries(prices)
                  .filter(([, v]) => v !== "")
                  .map(([productId, unitPrice]) => ({ productId, unitPrice })),
              };
              if (
                await save.run(() =>
                  api.post(`/companies/${companyId}/price-lists`, body),
                )
              ) {
                setAdding(false);
                lists.reload();
              }
            }}
          >
            <ActionMessage action={save} />
            <div className="grid gap-x-3 sm:grid-cols-3">
              <Field label={t("sa.name")}>
                <Input
                  required
                  maxLength={100}
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                  id="pl-name"
                />
              </Field>
              <Field label={t("sa.fiscalYear")}>
                <Input
                  required
                  pattern="\d{4}-\d{2}"
                  value={f.fiscalYear}
                  onChange={(e) => setF({ ...f, fiscalYear: e.target.value })}
                  id="pl-year"
                />
              </Field>
              <Field label={t("sa.customerType")}>
                <Select
                  value={f.customerType}
                  onChange={(e) => setF({ ...f, customerType: e.target.value })}
                  id="pl-type"
                >
                  <option value="">{t("sa.allCustomers")}</option>
                  {CUSTOMER_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {t(`cr.type.${x}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Table
              rows={products.data?.filter((p) => p.isActive)}
              rowKey={(p) => p.id}
              columns={[
                {
                  key: "code",
                  label: t("sa.code"),
                  className: "font-mono text-xs",
                  render: (p) => p.code,
                },
                {
                  key: "name",
                  label: t("sa.name"),
                  render: (p) => `${p.name} (${p.unit})`,
                },
                {
                  key: "price",
                  label: t("sa.unitPrice"),
                  render: (p) => (
                    <Input
                      aria-label={`${t("sa.unitPrice")} ${p.code}`}
                      inputMode="decimal"
                      className="w-32"
                      value={prices[p.id] ?? ""}
                      onChange={(e) =>
                        setPrices({ ...prices, [p.id]: e.target.value })
                      }
                    />
                  ),
                },
              ]}
            />
            <FormButtons
              busy={save.busy}
              onCancel={() => setAdding(false)}
              submitLabel={t("sa.newPriceList")}
            />
          </form>
        </Modal>
      )}
    </>
  );
}

function LimitsTab({
  companyId,
  manage,
}: {
  companyId: string;
  manage: boolean;
}) {
  const { t } = useI18n();
  const limits = useApi<DiscountLimit[]>(
    `/companies/${companyId}/discount-limits`,
  );
  const products = useApi<Product[]>(`/companies/${companyId}/products`);
  const save = useAction();
  const [rows, setRows] = useState<Array<{
    userId: string;
    productId: string;
    customerType: string;
    maxPercent: string;
  }> | null>(null);
  const editing =
    rows ??
    limits.data?.map((l) => ({
      userId: l.userId ?? "",
      productId: l.productId ?? "",
      customerType: l.customerType ?? "",
      maxPercent: String(Number(l.maxPercent)),
    })) ??
    [];
  const set = (i: number, k: string, v: string) =>
    setRows(editing.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  if (limits.error)
    return <ErrorBox error={limits.error} onRetry={limits.reload} />;
  return (
    <Panel title={t("sa.limits")}>
      <p className="mb-3 text-sm text-slate-600">{t("sa.limitsHint")}</p>
      <ActionMessage action={save} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            limits: editing.map((r) => ({
              maxPercent: r.maxPercent,
              ...(r.userId ? { userId: r.userId } : {}),
              ...(r.productId ? { productId: r.productId } : {}),
              ...(r.customerType ? { customerType: r.customerType } : {}),
            })),
          };
          if (
            await save.run(
              () => api.put(`/companies/${companyId}/discount-limits`, body),
              t("p.saved"),
            )
          ) {
            setRows(null);
            limits.reload();
          }
        }}
      >
        {editing.map((r, i) => (
          <div
            key={i}
            className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_8rem_2rem]"
          >
            <SalespersonSelect
              companyId={companyId}
              value={r.userId}
              onChange={(v) => set(i, "userId", v)}
              id={`limit-user-${i}`}
              allowAuto={t("sa.any")}
            />
            <Select
              aria-label={t("sa.product")}
              disabled={!manage}
              value={r.productId}
              onChange={(e) => set(i, "productId", e.target.value)}
            >
              <option value="">{t("sa.any")}</option>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("sa.customerType")}
              disabled={!manage}
              value={r.customerType}
              onChange={(e) => set(i, "customerType", e.target.value)}
            >
              <option value="">{t("sa.any")}</option>
              {CUSTOMER_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`cr.type.${x}`)}
                </option>
              ))}
            </Select>
            <Input
              aria-label={t("sa.maxPercent")}
              required
              disabled={!manage}
              inputMode="decimal"
              value={r.maxPercent}
              onChange={(e) => set(i, "maxPercent", e.target.value)}
            />
            {manage && (
              <button
                type="button"
                className="text-red-700"
                onClick={() => setRows(editing.filter((_, j) => j !== i))}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {manage && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setRows([
                  ...editing,
                  {
                    userId: "",
                    productId: "",
                    customerType: "",
                    maxPercent: "5",
                  },
                ])
              }
            >
              {t("sa.addRow")}
            </Button>
            <Button type="submit" busy={save.busy}>
              {t("p.save")}
            </Button>
          </div>
        )}
      </form>
    </Panel>
  );
}

function ProductEdit({
  product,
  vatItems,
  stockItems,
  onClose,
  onDone,
}: {
  product: Product;
  vatItems: Array<{ id: string; code: string; nameEn: string }>;
  stockItems: Array<{ id: string; code: string; name: string; unit: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    name: product.name,
    nameBn: product.nameBn ?? "",
    unit: product.unit,
    vatItemId: product.vatItemId,
    stockItemId: product.stockItemId ?? "",
    isActive: product.isActive,
  });
  return (
    <Modal title={`${product.code} · ${product.name}`} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.patch(`/products/${product.id}`, {
                ...f,
                nameBn: f.nameBn || undefined,
                stockItemId: f.stockItemId || null,
                version: product.version,
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("sa.name")}>
          <Input
            required
            maxLength={200}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            id="product-edit-name"
          />
        </Field>
        <Field label={t("sa.nameBn")}>
          <Input
            maxLength={200}
            value={f.nameBn}
            onChange={(e) => setF({ ...f, nameBn: e.target.value })}
            id="product-edit-name-bn"
          />
        </Field>
        <Field label={t("sa.unit")}>
          <Input
            required
            maxLength={20}
            value={f.unit}
            onChange={(e) => setF({ ...f, unit: e.target.value })}
            id="product-edit-unit"
          />
        </Field>
        <Field label={t("sa.vatItem")}>
          <Select
            value={f.vatItemId}
            onChange={(e) => setF({ ...f, vatItemId: e.target.value })}
            id="product-edit-vat"
          >
            {vatItems.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} · {v.nameEn}
              </option>
            ))}
          </Select>
        </Field>
        {product.kind === "goods" && (
          <Field label={t("sa.stockItem")} hint={t("sa.stockHint")}>
            <Select
              value={f.stockItemId}
              onChange={(e) => setF({ ...f, stockItemId: e.target.value })}
              id="product-edit-stock"
            >
              <option value="">{t("sa.notInStore")}</option>
              {stockItems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name} ({s.unit})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.isActive}
            onChange={(e) => setF({ ...f, isActive: e.target.checked })}
          />{" "}
          {t("sa.active")}
        </label>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("p.save")}
        />
      </form>
    </Modal>
  );
}
