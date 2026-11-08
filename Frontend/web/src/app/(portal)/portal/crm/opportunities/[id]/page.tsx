"use client";
/** One opportunity: value, probability, stage; move it, win or lose it, open it again; its stage history. */
import Link from "next/link";
import { use, useState } from "react";
import { AssignDialog } from "@/components/portal/crm";
import {
  LostDialog,
  MoveStageDialog,
  ReopenDialog,
  StageHistory,
  WonDialog,
} from "@/components/portal/opportunities";
import { Detail, PageHeader, Panel } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, Button, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { OPP_STATE_COLOR, type OpportunityDetail } from "@/lib/crm-types";
import { formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function OpportunityPage({
  params,
}: PageProps<"/portal/crm/opportunities/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  const opp = useApi<OpportunityDetail>(`/opportunities/${id}`);
  const [dialog, setDialog] = useState<
    "stage" | "won" | "lost" | "reopen" | "assign" | null
  >(null);
  if (opp.loading && !opp.data) return <Loading />;
  if (opp.error) return <ErrorBox error={opp.error} onRetry={opp.reload} />;
  const o = opp.data!;
  const open = o.state === "open";
  const done = () => (setDialog(null), opp.reload());
  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base">{o.number}</span> {o.title}{" "}
            <Badge color={OPP_STATE_COLOR[o.state]}>
              {t(`cr.ostate.${o.state}`)}
            </Badge>
          </span>
        }
        subtitle={`${o.customer.code} · ${o.customer.name}`}
        actions={
          <>
            {open && o.canWork && (
              <Button onClick={() => setDialog("stage")}>
                {t("cr.moveStage")}
              </Button>
            )}
            {open && o.canWork && (
              <Button variant="secondary" onClick={() => setDialog("won")}>
                {t("cr.markWon")}
              </Button>
            )}
            {open && o.canWork && (
              <Button variant="secondary" onClick={() => setDialog("lost")}>
                {t("cr.markLost")}
              </Button>
            )}
            {!open && o.canWork && (
              <Button variant="secondary" onClick={() => setDialog("reopen")}>
                {t("cr.reopen")}
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
            <Detail label={t("cr.stage")}>
              {(lang === "bn" && o.stageNameBn) || o.stageName}
            </Detail>
            <Detail label={t("cr.value")}>{formatTaka(o.value, lang)}</Detail>
            <Detail label={t("cr.probability")}>{o.probability}%</Detail>
            <Detail label={t("cr.weighted")}>
              {formatTaka(o.weighted, lang)}
            </Detail>
            <Detail label={open ? t("cr.expectedClose") : t("cr.closedOn")}>
              {formatDate(o.closedOn ?? o.expectedCloseOn, lang)}
            </Detail>
            {o.lostReason && (
              <Detail label={t("cr.lostReason")}>
                {t(`cr.lost.${o.lostReason}`)}
              </Detail>
            )}
            {o.closeNote && <Detail label={t("cr.note")}>{o.closeNote}</Detail>}
            <Detail label={t("cr.owner")}>{o.ownerName ?? "—"}</Detail>
            <Detail label={t("cr.customers")}>
              <Link
                className="underline"
                href={`/portal/crm/customers/${o.customer.id}`}
              >
                {o.customer.code} · {o.customer.name}
              </Link>
            </Detail>
            {o.lead && (
              <Detail label={t("cr.lead")}>
                <Link
                  className="font-mono text-xs underline"
                  href={`/portal/crm/leads/${o.lead.id}`}
                >
                  {o.lead.number}
                </Link>
              </Detail>
            )}
          </dl>
        </Panel>
        <div className="lg:col-span-2">
          <StageHistory o={o} />
        </div>
      </div>
      {dialog === "stage" && company && (
        <MoveStageDialog
          o={o}
          companyId={company.id}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === "won" && (
        <WonDialog o={o} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === "lost" && (
        <LostDialog o={o} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog === "reopen" && company && (
        <ReopenDialog
          o={o}
          companyId={company.id}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === "assign" && company && (
        <AssignDialog
          companyId={company.id}
          path={`/opportunities/${o.id}/assign`}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </div>
  );
}
