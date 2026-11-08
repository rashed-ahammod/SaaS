"use client";
/**
 * Stock pieces of the portal (WP19):
 *   MovesDialog     receive, adjust (stock count) or load the opening stock of a store
 *   LedgerPanel     the stock ledger of one store
 *   IssueDialog     hand out what a request asked for (all or part)
 *   SetupPanel      the stores and the items
 */
import { useState } from "react";
import {
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { StockItem, StockRequest, Store } from "@/lib/asset-types";
import { dhakaToday, formatDate, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { EmployeeSummary, Page } from "@/lib/portal-types";
import {
  ActionMessage,
  FormButtons,
  Modal,
  Panel,
  Table,
  useAction,
} from "./kit";
import { usePortal } from "./portal-context";

const QTY = "\\d+(\\.\\d{1,3})?";
const SIGNED_QTY = "-?\\d+(\\.\\d{1,3})?";

export const qty = (q: string, lang: "en" | "bn") => num(Number(q), lang);

export function MovesDialog({
  companyId,
  store,
  kind,
  onClose,
  onDone,
}: {
  companyId: string;
  store: Store;
  kind: "receipt" | "adjustment" | "opening";
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const items = useApi<StockItem[]>(`/companies/${companyId}/stock-items`);
  const [f, setF] = useState({
    moveDate: dhakaToday(),
    reference: "",
    note: "",
  });
  const [lines, setLines] = useState([{ itemId: "", quantity: "" }]);
  const title = t(
    kind === "receipt"
      ? "st.receive"
      : kind === "adjustment"
        ? "st.adjust"
        : "st.opening",
  );
  return (
    <Modal title={`${title} · ${store.name}`} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            kind,
            moveDate: f.moveDate,
            ...(f.reference ? { reference: f.reference } : {}),
            ...(f.note ? { note: f.note } : {}),
            lines: lines.filter((l) => l.itemId),
          };
          if (
            (await save.run(() =>
              api.post(`/stores/${store.id}/moves`, body),
            )) !== undefined
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("st.moveDate")}>
            <Input
              type="date"
              required
              value={f.moveDate}
              onChange={(e) => setF({ ...f, moveDate: e.target.value })}
              id="move-date"
            />
          </Field>
          <Field label={t("st.reference")}>
            <Input
              maxLength={200}
              value={f.reference}
              onChange={(e) => setF({ ...f, reference: e.target.value })}
              id="move-reference"
            />
          </Field>
        </div>
        <Field label={t("st.reason")}>
          <Input
            required={kind === "adjustment"}
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="move-note"
          />
        </Field>
        {kind === "adjustment" && (
          <p className="mb-3 text-sm text-gray-600">{t("st.adjustHint")}</p>
        )}
        <ItemLines
          items={items.data ?? []}
          lines={lines}
          setLines={setLines}
          pattern={kind === "adjustment" ? SIGNED_QTY : QTY}
        />
        <FormButtons busy={save.busy} onCancel={onClose} submitLabel={title} />
      </form>
    </Modal>
  );
}

/** Item + quantity rows, shared by the store's moves and the employee's request. */
export function ItemLines({
  items,
  lines,
  setLines,
  pattern = QTY,
}: {
  items: StockItem[];
  lines: Array<{ itemId: string; quantity: string }>;
  setLines: (l: Array<{ itemId: string; quantity: string }>) => void;
  pattern?: string;
}) {
  const { t, lang } = useI18n();
  const edit = (i: number, k: "itemId" | "quantity", v: string) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return (
    <div className="mb-3 space-y-2">
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2">
          <Select
            aria-label={t("st.item")}
            required={i === 0}
            value={l.itemId}
            onChange={(e) => edit(i, "itemId", e.target.value)}
            className="flex-1"
            id={`line-item-${i}`}
          >
            <option value="">—</option>
            {items
              .filter((it) => it.isActive)
              .map((it) => (
                <option key={it.id} value={it.id}>
                  {lang === "bn" && it.nameBn ? it.nameBn : it.name} ({it.unit})
                </option>
              ))}
          </Select>
          <Input
            aria-label={t("st.quantity")}
            required={!!l.itemId}
            inputMode="decimal"
            pattern={pattern}
            value={l.quantity}
            onChange={(e) => edit(i, "quantity", e.target.value)}
            className="w-28"
            id={`line-qty-${i}`}
          />
          {lines.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              aria-label="×"
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
            >
              ×
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        onClick={() => setLines([...lines, { itemId: "", quantity: "" }])}
      >
        + {t("st.me.addItem")}
      </Button>
    </div>
  );
}

export function LedgerPanel({ store }: { store: Store }) {
  const { t, lang } = useI18n();
  const moves = useApi<
    Array<{
      id: string;
      moveDate: string;
      kind:
        | "opening"
        | "receipt"
        | "issue"
        | "adjustment"
        | "sales_issue"
        | "sales_return";
      quantity: string;
      reference: string | null;
      note: string | null;
      itemCode: string;
      itemName: string;
      unit: string;
      requestNumber: string | null;
    }>
  >(`/stores/${store.id}/moves`);
  return (
    <Panel title={`${t("st.ledger")} · ${store.name}`}>
      {moves.error ? (
        <ErrorBox error={moves.error} onRetry={moves.reload} />
      ) : (
        <Table
          rows={moves.data}
          rowKey={(m) => m.id}
          empty={t("st.none")}
          columns={[
            {
              key: "date",
              label: t("st.moveDate"),
              render: (m) => formatDate(m.moveDate, lang, { short: true }),
            },
            { key: "kind", label: "", render: (m) => t(`st.move.${m.kind}`) },
            { key: "item", label: t("st.item"), render: (m) => m.itemName },
            {
              key: "qty",
              label: t("st.quantity"),
              align: "right",
              render: (m) => (
                <span className={Number(m.quantity) < 0 ? "text-red-700" : ""}>
                  {qty(m.quantity, lang)} {m.unit}
                </span>
              ),
            },
            {
              key: "ref",
              label: t("st.reference"),
              render: (m) => (
                <span className="text-xs">
                  {m.requestNumber ?? m.reference ?? ""}
                  {m.note ? ` · ${m.note}` : ""}
                </span>
              ),
            },
          ]}
        />
      )}
    </Panel>
  );
}

export function IssueDialog({
  requestId,
  onClose,
  onDone,
}: {
  requestId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const r = useApi<StockRequest>(`/stock-requests/${requestId}`);
  const [issueDate, setIssueDate] = useState(dhakaToday());
  const [give, setGive] = useState<Record<string, string>>({});
  const lines = r.data?.lines ?? [];
  const left = (l: (typeof lines)[number]) =>
    Math.max(0, Number(l.quantityRequested) - Number(l.quantityIssued));
  const value = (l: (typeof lines)[number]) =>
    give[l.itemId] ?? String(Math.min(left(l), Number(l.inStock ?? left(l))));
  return (
    <Modal
      title={`${t("st.issue")} · ${r.data?.number ?? ""}`}
      open
      onClose={onClose}
      wide
    >
      {!r.data ? (
        <Loading />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const body = {
              issueDate,
              lines: lines
                .map((l) => ({ itemId: l.itemId, quantity: value(l) }))
                .filter((l) => Number(l.quantity) > 0),
            };
            if (
              (await save.run(() =>
                api.post(`/stock-requests/${requestId}/issue`, body),
              )) !== undefined
            )
              onDone();
          }}
        >
          <ActionMessage action={save} />
          <p className="mb-3 text-sm text-gray-600">
            {r.data.requesterName} · {r.data.departmentName ?? ""}
            {r.data.note ? ` · ${r.data.note}` : ""}
          </p>
          <Field label={t("st.issueDate")}>
            <Input
              type="date"
              required
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              id="issue-date"
            />
          </Field>
          <Table
            rows={lines}
            rowKey={(l) => l.itemId}
            columns={[
              {
                key: "item",
                label: t("st.item"),
                render: (l) =>
                  lang === "bn" && l.itemNameBn ? l.itemNameBn : l.itemName,
              },
              {
                key: "asked",
                label: t("st.requested"),
                align: "right",
                render: (l) => `${qty(l.quantityRequested, lang)} ${l.unit}`,
              },
              {
                key: "issued",
                label: t("st.issued"),
                align: "right",
                render: (l) => qty(l.quantityIssued, lang),
              },
              {
                key: "stock",
                label: t("st.inStock"),
                align: "right",
                render: (l) =>
                  l.inStock === undefined ? "" : qty(l.inStock, lang),
              },
              {
                key: "give",
                label: t("st.issue"),
                align: "right",
                render: (l) => (
                  <Input
                    aria-label={`${t("st.issue")} ${l.itemName}`}
                    inputMode="decimal"
                    pattern={QTY}
                    className="w-24 text-right"
                    value={value(l)}
                    onChange={(e) =>
                      setGive({ ...give, [l.itemId]: e.target.value })
                    }
                    disabled={left(l) === 0}
                  />
                ),
              },
            ]}
          />
          <FormButtons
            busy={save.busy}
            onCancel={onClose}
            submitLabel={t("st.issue")}
          />
        </form>
      )}
    </Modal>
  );
}

export function SetupPanel({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const stores = useApi<Store[]>(`/companies/${companyId}/stores`);
  const items = useApi<StockItem[]>(`/companies/${companyId}/stock-items`);
  const [dialog, setDialog] = useState<"store" | "item" | StockItem | null>(
    null,
  );
  const manage = can("stock.manage");
  return (
    <>
      <Panel
        title={t("st.store")}
        actions={
          manage && (
            <Button variant="secondary" onClick={() => setDialog("store")}>
              {t("st.newStore")}
            </Button>
          )
        }
      >
        <Table
          rows={stores.data}
          rowKey={(s) => s.id}
          empty={t("st.none")}
          columns={[
            {
              key: "code",
              label: t("st.code"),
              className: "font-mono",
              render: (s) => s.code,
            },
            { key: "name", label: t("st.name"), render: (s) => s.name },
            {
              key: "keeper",
              label: t("st.keeper"),
              render: (s) => s.keeperName ?? "—",
            },
          ]}
        />
      </Panel>
      <Panel
        title={t("st.item")}
        actions={
          manage && (
            <Button variant="secondary" onClick={() => setDialog("item")}>
              {t("st.newItem")}
            </Button>
          )
        }
      >
        <Table
          rows={items.data}
          rowKey={(i) => i.id}
          empty={t("st.none")}
          onRowClick={manage ? (i) => setDialog(i) : undefined}
          columns={[
            {
              key: "code",
              label: t("st.code"),
              className: "font-mono",
              render: (i) => i.code,
            },
            { key: "name", label: t("st.name"), render: (i) => i.name },
            {
              key: "nameBn",
              label: t("st.nameBn"),
              render: (i) => i.nameBn ?? "",
            },
            { key: "unit", label: t("st.unit"), render: (i) => i.unit },
            {
              key: "reorder",
              label: t("st.reorder"),
              align: "right",
              render: (i) => qty(i.reorderLevel, lang),
            },
          ]}
        />
      </Panel>
      {dialog === "store" && (
        <StoreDialog
          companyId={companyId}
          onClose={() => setDialog(null)}
          onDone={() => (setDialog(null), stores.reload())}
        />
      )}
      {(dialog === "item" || (dialog && typeof dialog === "object")) && (
        <ItemDialog
          companyId={companyId}
          item={typeof dialog === "object" ? dialog : undefined}
          onClose={() => setDialog(null)}
          onDone={() => (setDialog(null), items.reload())}
        />
      )}
    </>
  );
}

function StoreDialog({
  companyId,
  onClose,
  onDone,
}: {
  companyId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const people = useApi<Page<EmployeeSummary>>(
    `/employees?companyId=${companyId}&pageSize=200`,
  );
  const [f, setF] = useState({ code: "", name: "", keeperEmployeeId: "" });
  return (
    <Modal title={t("st.newStore")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            code: f.code,
            name: f.name,
            ...(f.keeperEmployeeId
              ? { keeperEmployeeId: f.keeperEmployeeId }
              : {}),
          };
          if (
            (await save.run(() =>
              api.post(`/companies/${companyId}/stores`, body),
            )) !== undefined
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("st.code")}>
          <Input
            required
            maxLength={20}
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
            id="store-code"
          />
        </Field>
        <Field label={t("st.name")}>
          <Input
            required
            maxLength={200}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            id="store-name"
          />
        </Field>
        <Field label={t("st.keeper")}>
          <Select
            value={f.keeperEmployeeId}
            onChange={(e) => setF({ ...f, keeperEmployeeId: e.target.value })}
            id="store-keeper"
          >
            <option value="">—</option>
            {people.data?.items
              .filter((p) => p.status !== "separated")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.employeeCode} · {p.fullNameEn}
                </option>
              ))}
          </Select>
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("st.newStore")}
        />
      </form>
    </Modal>
  );
}

function ItemDialog({
  companyId,
  item,
  onClose,
  onDone,
}: {
  companyId: string;
  item?: StockItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    code: item?.code ?? "",
    name: item?.name ?? "",
    nameBn: item?.nameBn ?? "",
    unit: item?.unit ?? "",
    reorderLevel: item?.reorderLevel ? String(Number(item.reorderLevel)) : "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      title={item ? `${item.code} · ${item.name}` : t("st.newItem")}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = Object.fromEntries(
            Object.entries(f).filter(
              ([k, v]) => v !== "" && !(item && k === "code"),
            ),
          );
          const ok = item
            ? await save.run(() => api.patch(`/stock-items/${item.id}`, body))
            : await save.run(() =>
                api.post(`/companies/${companyId}/stock-items`, body),
              );
          if (ok !== undefined) onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("st.code")}>
            <Input
              required
              disabled={!!item}
              maxLength={30}
              value={f.code}
              onChange={set("code")}
              id="item-code"
            />
          </Field>
          <Field label={t("st.unit")}>
            <Input
              required
              maxLength={20}
              value={f.unit}
              onChange={set("unit")}
              id="item-unit"
            />
          </Field>
          <Field label={t("st.name")}>
            <Input
              required
              maxLength={200}
              value={f.name}
              onChange={set("name")}
              id="item-name"
            />
          </Field>
          <Field label={t("st.nameBn")}>
            <Input
              maxLength={200}
              value={f.nameBn}
              onChange={set("nameBn")}
              id="item-name-bn"
            />
          </Field>
          <Field label={t("st.reorder")}>
            <Input
              inputMode="decimal"
              pattern={QTY}
              value={f.reorderLevel}
              onChange={set("reorderLevel")}
              id="item-reorder"
            />
          </Field>
        </div>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={item ? t("p.save") : t("st.newItem")}
        />
      </form>
    </Modal>
  );
}
