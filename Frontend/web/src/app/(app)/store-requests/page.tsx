"use client";
/** My store requests (paper, toner, files): ask the store, and see what was handed over. */
import { useState } from "react";
import { ItemLines, qty } from "@/components/portal/stock";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
  Empty,
  ErrorBox,
  Field,
  Input,
  Loading,
  PageTitle,
  Select,
} from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import {
  STOCK_REQUEST_COLOR,
  type StockItem,
  type StockRequest,
  type Store,
} from "@/lib/asset-types";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

export default function StoreRequestsPage() {
  const { t, lang } = useI18n();
  const { profile } = useSession();
  const mine = useApi<StockRequest[]>("/me/stock-requests");
  const [creating, setCreating] = useState(false);
  const [sent, setSent] = useState(false);

  return (
    <div className="space-y-4">
      <PageTitle>{t("st.me.title")}</PageTitle>
      {sent && <Alert kind="success">{t("st.me.sent")}</Alert>}
      {creating && profile ? (
        <RequestForm
          companyId={profile.companyId}
          onCancel={() => setCreating(false)}
          onSent={() => (setCreating(false), setSent(true), mine.reload())}
        />
      ) : (
        <Button
          className="w-full"
          onClick={() => (setCreating(true), setSent(false))}
        >
          {t("st.me.new")}
        </Button>
      )}
      <Card>
        <CardTitle>{t("st.me.mine")}</CardTitle>
        {mine.loading ? (
          <Loading />
        ) : mine.error ? (
          <ErrorBox error={mine.error} onRetry={mine.reload} />
        ) : !mine.data?.length ? (
          <Empty />
        ) : (
          <ul className="divide-y divide-slate-100">
            {mine.data.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-500">
                    {r.number} ·{" "}
                    {formatDate(r.createdAt.slice(0, 10), lang, {
                      short: true,
                    })}
                  </span>
                  <Badge color={STOCK_REQUEST_COLOR[r.state]}>
                    {t(`st.req.${r.state}`)}
                  </Badge>
                </div>
                <ul className="mt-1 text-sm">
                  {r.lines?.map((l) => (
                    <li key={l.itemId}>
                      {lang === "bn" && l.itemNameBn
                        ? l.itemNameBn
                        : l.itemName}
                      : {qty(l.quantityRequested, lang)} {l.unit}
                      {Number(l.quantityIssued) > 0 && (
                        <span className="text-emerald-700">
                          {" "}
                          · {t("st.issued")} {qty(l.quantityIssued, lang)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RequestForm({
  companyId,
  onCancel,
  onSent,
}: {
  companyId: string;
  onCancel: () => void;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const stores = useApi<Store[]>(`/companies/${companyId}/stores`);
  const items = useApi<StockItem[]>(`/companies/${companyId}/stock-items`);
  const [storeId, setStoreId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState([{ itemId: "", quantity: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const store = storeId || (stores.data?.length === 1 ? stores.data[0].id : "");
  return (
    <Card>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.post(`/companies/${companyId}/stock-requests`, {
              storeId: store,
              ...(note ? { note } : {}),
              lines: lines.filter((l) => l.itemId),
            });
            onSent();
          } catch (err) {
            setError((err as ApiError).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t("st.store")}>
          <Select
            required
            value={store}
            onChange={(e) => setStoreId(e.target.value)}
            id="request-store"
          >
            <option value="">—</option>
            {stores.data
              ?.filter((s) => s.isActive)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </Select>
        </Field>
        <ItemLines items={items.data ?? []} lines={lines} setLines={setLines} />
        <Field label={t("st.me.note")}>
          <Input
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            id="request-note"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" busy={busy}>
            {t("st.me.send")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
