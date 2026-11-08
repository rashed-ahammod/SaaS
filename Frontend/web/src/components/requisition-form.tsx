"use client";
/**
 * A purchase request: what for, why, by when, and the items (quantity, unit, an
 * estimated price each). Used in the app to create one or change a draft.
 */
import { useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Card,
  CardTitle,
  Field,
  Input,
  TextArea,
} from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Requisition } from "@/lib/procurement-types";

interface Line {
  description: string;
  quantity: string;
  unit: string;
  estimatedUnitPrice: string;
}

const empty: Line = {
  description: "",
  quantity: "1",
  unit: "pcs",
  estimatedUnitPrice: "",
};

export function RequisitionForm({
  companyId,
  existing,
  onSaved,
  onCancel,
}: {
  companyId: string;
  existing?: Requisition;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  const [f, setF] = useState({
    title: existing?.title ?? "",
    justification: existing?.justification ?? "",
    neededBy: existing?.neededBy ?? "",
  });
  const [lines, setLines] = useState<Line[]>(
    existing?.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      estimatedUnitPrice: l.estimatedUnitPrice,
    })) ?? [{ ...empty }],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = lines.reduce(
    (sum, l) =>
      sum + (Number(l.quantity) || 0) * (Number(l.estimatedUnitPrice) || 0),
    0,
  );
  const setLine = (i: number, k: keyof Line, v: string) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      title: f.title,
      justification: f.justification,
      ...(f.neededBy ? { neededBy: f.neededBy } : {}),
      lines,
    };
    try {
      const saved = existing
        ? await api.patch<{ id: string }>(
            `/purchase-requisitions/${existing.id}`,
            { ...body, version: existing.version },
          )
        : await api.post<{ id: string }>(
            `/companies/${companyId}/purchase-requisitions`,
            body,
          );
      onSaved(saved.id);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{existing ? t("pr.edit") : t("pr.new")}</CardTitle>
      <form onSubmit={submit}>
        {error && <Alert kind="error">{error}</Alert>}
        <Field label={t("pr.what")}>
          <Input
            required
            maxLength={200}
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            id="pr-title"
          />
        </Field>
        <Field label={t("pr.why")}>
          <TextArea
            required
            maxLength={1000}
            value={f.justification}
            onChange={(e) => setF({ ...f, justification: e.target.value })}
            id="pr-why"
          />
        </Field>
        <Field label={t("pr.neededBy")}>
          <Input
            type="date"
            value={f.neededBy}
            onChange={(e) => setF({ ...f, neededBy: e.target.value })}
            id="pr-needed"
          />
        </Field>
        <p className="mb-2 text-sm font-semibold">{t("pr.lines")}</p>
        {lines.map((l, i) => (
          <div key={i} className="mb-3 rounded-xl bg-slate-50 p-3">
            <Field label={t("pr.item")}>
              <Input
                required
                maxLength={300}
                value={l.description}
                onChange={(e) => setLine(i, "description", e.target.value)}
                id={`pr-item-${i}`}
              />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label={t("pr.qty")}>
                <Input
                  required
                  inputMode="decimal"
                  pattern="\d+(\.\d{1,3})?"
                  value={l.quantity}
                  onChange={(e) => setLine(i, "quantity", e.target.value)}
                  id={`pr-qty-${i}`}
                />
              </Field>
              <Field label={t("pr.unit")}>
                <Input
                  required
                  maxLength={20}
                  value={l.unit}
                  onChange={(e) => setLine(i, "unit", e.target.value)}
                  id={`pr-unit-${i}`}
                />
              </Field>
              <Field label={t("pr.estPrice")}>
                <Input
                  required
                  inputMode="decimal"
                  pattern="\d+(\.\d{1,2})?"
                  value={l.estimatedUnitPrice}
                  onChange={(e) =>
                    setLine(i, "estimatedUnitPrice", e.target.value)
                  }
                  id={`pr-price-${i}`}
                />
              </Field>
            </div>
            {lines.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-8 px-2 py-1 text-sm"
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
              >
                {t("pr.removeLine")}
              </Button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          className="mb-3 w-full"
          onClick={() => setLines([...lines, { ...empty }])}
        >
          + {t("pr.addLine")}
        </Button>
        <p className="mb-3 text-right font-semibold">
          {t("pr.estimate")}: {formatTaka(String(total), lang)}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" busy={busy}>
            {t("pr.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
