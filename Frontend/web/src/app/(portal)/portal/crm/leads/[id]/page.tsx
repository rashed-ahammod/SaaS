"use client";
/** One lead: who, what they wrote, the activities; qualify, disqualify or hand over. */
import Link from "next/link";
import { use, useState } from "react";
import {
  ActivityTimeline,
  AssignDialog,
  QualifyDialog,
  ReasonDialog,
} from "@/components/portal/crm";
import { OpportunitiesPanel } from "@/components/portal/opportunities";
import { Detail, PageHeader, Panel } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, Button, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { LEAD_STATE_COLOR, type Lead } from "@/lib/crm-types";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function LeadPage({
  params,
}: PageProps<"/portal/crm/leads/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  const lead = useApi<Lead>(`/leads/${id}`);
  const [dialog, setDialog] = useState<
    "qualify" | "disqualify" | "assign" | null
  >(null);
  if (lead.loading && !lead.data) return <Loading />;
  if (lead.error) return <ErrorBox error={lead.error} onRetry={lead.reload} />;
  const l = lead.data!;
  const open = l.state === "new" || l.state === "contacted";
  const done = () => (setDialog(null), lead.reload());
  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">{l.number}</span> {l.name}{" "}
            <Badge color={LEAD_STATE_COLOR[l.state]}>
              {t(`cr.state.${l.state}`)}
            </Badge>
          </span>
        }
        subtitle={l.organisation ?? undefined}
        actions={
          <>
            {open && l.canWork && (
              <Button onClick={() => setDialog("qualify")}>
                {t("cr.qualify")}
              </Button>
            )}
            {open && l.canWork && (
              <Button
                variant="secondary"
                onClick={() => setDialog("disqualify")}
              >
                {t("cr.disqualify")}
              </Button>
            )}
            {open && can("crm.assign", "crm.manage") && (
              <Button variant="ghost" onClick={() => setDialog("assign")}>
                {t("cr.assign")}
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel>
          <dl className="grid gap-3">
            <Detail label={t("cr.phone")}>{l.phone ?? "—"}</Detail>
            <Detail label={t("cr.email")}>{l.email ?? "—"}</Detail>
            <Detail label={t("cr.district")}>
              {l.district ?? "—"}
              {l.territory ? ` · ${l.territory}` : ""}
            </Detail>
            <Detail label={t("cr.source")}>
              {t(`cr.source.${l.source}`)}
              {l.sourceDetail ? ` · ${l.sourceDetail}` : ""}
            </Detail>
            <Detail label={t("cr.owner")}>{l.ownerName ?? "—"}</Detail>
            <Detail label={t("cr.created")}>
              {formatDate(l.createdAt.slice(0, 10), lang)}
            </Detail>
            {l.disqualifyReason && (
              <Detail label={t("cr.reason")}>{l.disqualifyReason}</Detail>
            )}
            {l.customerId && (
              <Detail label={t("cr.customers")}>
                <Link
                  className="underline"
                  href={`/portal/crm/customers/${l.customerId}`}
                >
                  {t("cr.customers")}
                </Link>
              </Detail>
            )}
          </dl>
          {l.message && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase text-slate-500">
                {t("cr.message")}
              </p>
              <p className="whitespace-pre-line text-sm">{l.message}</p>
              <p className="mt-1 text-xs text-slate-500">
                {t("cr.messageHint")}
              </p>
            </div>
          )}
        </Panel>
        <div className="lg:col-span-2">
          {!!l.opportunities?.length && (
            <OpportunitiesPanel rows={l.opportunities} />
          )}
          <ActivityTimeline
            activities={l.activities ?? []}
            postPath={`/leads/${l.id}/activities`}
            canWork={!!l.canWork && l.state !== "qualified"}
            onChanged={lead.reload}
          />
        </div>
      </div>
      {dialog === "qualify" && company && (
        <QualifyDialog
          lead={l}
          companyId={company.id}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === "disqualify" && (
        <ReasonDialog
          title={t("cr.disqualify")}
          path={`/leads/${l.id}/disqualify`}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === "assign" && company && (
        <AssignDialog
          companyId={company.id}
          path={`/leads/${l.id}/assign`}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </div>
  );
}
