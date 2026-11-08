"use client";
/** One purchase request: the items, where it is (approval, ordered); a draft is changed, sent or cancelled. */
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { RequisitionForm } from "@/components/requisition-form";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardTitle,
  ErrorBox,
  Field,
  Loading,
  PageTitle,
  Row,
  TextArea,
} from "@/components/ui";
import { api, ApiError, useApi } from "@/lib/api";
import { formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { REQ_STATE_COLOR, type Requisition } from "@/lib/procurement-types";

export default function RequisitionPage({
  params,
}: PageProps<"/requisitions/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const router = useRouter();
  const r = useApi<Requisition>(`/purchase-requisitions/${id}`);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (done) setNote(done);
      r.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  const d = r.data!;
  if (editing) {
    return (
      <div className="space-y-4">
        <PageTitle>{d.number}</PageTitle>
        <RequisitionForm
          companyId={d.companyId}
          existing={d}
          onCancel={() => setEditing(false)}
          onSaved={() => (
            setEditing(false),
            setNote(t("pr.saved")),
            r.reload()
          )}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageTitle>{d.title}</PageTitle>
      {error && <Alert kind="error">{error}</Alert>}
      {note && !error && <Alert kind="success">{note}</Alert>}
      <Card>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm text-slate-500">{d.number}</span>
          <Badge color={REQ_STATE_COLOR[d.state]}>
            {t(`pr.state.${d.state}`)}
          </Badge>
        </div>
        <p className="mb-2 text-sm text-slate-700">{d.justification}</p>
        {d.neededBy && (
          <Row label={t("pr.neededBy")} value={formatDate(d.neededBy, lang)} />
        )}
        {d.purchaseOrder && (
          <Row
            label={t("pr.order")}
            value={`${d.purchaseOrder.number} · ${t(`pr.os.${d.purchaseOrder.state}`)}`}
          />
        )}
      </Card>
      <Card>
        <CardTitle>{t("pr.lines")}</CardTitle>
        {d.lines.map((l) => (
          <Row
            key={l.id}
            label={`${l.quantity} ${l.unit} · ${l.description}`}
            value={formatTaka(
              String(Number(l.quantity) * Number(l.estimatedUnitPrice)),
              lang,
            )}
          />
        ))}
        <Row
          label={t("pr.estimate")}
          value={formatTaka(d.estimatedTotal, lang)}
          strong
        />
      </Card>

      {d.state === "draft" && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t("pr.edit")}
          </Button>
          <Button
            busy={busy}
            onClick={() =>
              run(
                () => api.post(`/purchase-requisitions/${id}/submit`),
                t("pr.sent"),
              )
            }
          >
            {t("pr.submit")}
          </Button>
        </div>
      )}
      {d.state === "draft" &&
        (cancelling ? (
          <Card>
            <Field label={t("pr.cancelReason")}>
              <TextArea
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                id="pr-cancel-reason"
              />
            </Field>
            <Button
              variant="danger"
              className="w-full"
              busy={busy}
              disabled={!reason.trim()}
              onClick={() =>
                run(() =>
                  api.post(`/purchase-requisitions/${id}/cancel`, { reason }),
                ).then(() => router.push("/requisitions"))
              }
            >
              {t("pr.cancel")}
            </Button>
          </Card>
        ) : (
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setCancelling(true)}
          >
            {t("pr.cancel")}
          </Button>
        ))}
    </div>
  );
}
