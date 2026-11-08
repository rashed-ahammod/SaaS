"use client";
/** Opportunities (Phase 3 WP24): the pipeline board by stage, or a list; within the viewer's scope. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { OpportunityDialog } from "@/components/portal/opportunities";
import { PageHeader, Panel, Stat, Table, Tabs } from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  Badge,
  Button,
  ErrorBox,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { useApi } from "@/lib/api";
import {
  OPP_STATE_COLOR,
  type Board,
  type OpportunityRow,
} from "@/lib/crm-types";
import { formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function OpportunitiesPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const [tab, setTab] = useState<"board" | "list">("board");
  const [creating, setCreating] = useState(false);
  if (!company) return null;
  return (
    <div>
      <PageHeader
        title={t("cr.opportunities")}
        subtitle={company.legalName}
        actions={
          can("crm.own", "crm.assign", "crm.manage") && (
            <Button onClick={() => setCreating(true)}>
              {t("cr.newOpportunity")}
            </Button>
          )
        }
      />
      <Tabs
        tabs={[
          { key: "board" as const, label: t("cr.board") },
          { key: "list" as const, label: t("cr.list") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "board" ? (
        <BoardView companyId={company.id} />
      ) : (
        <ListView companyId={company.id} />
      )}
      {creating && (
        <OpportunityDialog
          companyId={company.id}
          onClose={() => setCreating(false)}
          onDone={(id) => router.push(`/portal/crm/opportunities/${id}`)}
        />
      )}
    </div>
  );
}

function BoardView({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const board = useApi<Board>(`/companies/${companyId}/pipeline`);
  if (board.error)
    return <ErrorBox error={board.error} onRetry={board.reload} />;
  if (!board.data) return <Loading />;
  const b = board.data;
  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label={t("cr.openTotal")}
          value={formatTaka(b.open.value, lang)}
          hint={`${b.open.count} · ${t("cr.weighted")} ${formatTaka(b.open.weighted, lang)}`}
        />
        <Stat
          label={t("cr.weighted")}
          value={formatTaka(b.open.weighted, lang)}
        />
        <Stat
          label={t("cr.wonThisMonth")}
          value={formatTaka(b.wonThisMonth.value, lang)}
          hint={String(b.wonThisMonth.count)}
          tone="good"
        />
        <Stat
          label={t("cr.lostThisMonth")}
          value={formatTaka(b.lostThisMonth.value, lang)}
          hint={String(b.lostThisMonth.count)}
          tone={b.lostThisMonth.count ? "warn" : "default"}
        />
      </div>
      <div
        className="flex gap-3 overflow-x-auto pb-3"
        role="list"
        aria-label={t("cr.board")}
      >
        {b.stages.map((s) => (
          <section
            key={s.id}
            role="listitem"
            aria-label={s.name}
            className="w-72 shrink-0 rounded-xl bg-slate-100 p-3"
          >
            <h2 className="text-sm font-semibold">
              {(lang === "bn" && s.nameBn) || s.name}{" "}
              <span className="font-normal text-slate-500">
                · {s.probability}%
              </span>
            </h2>
            <p className="mb-2 text-xs text-slate-600">
              {s.count} · {formatTaka(s.value, lang)} · {t("cr.weighted")}{" "}
              {formatTaka(s.weighted, lang)}
            </p>
            <ul className="space-y-2">
              {s.opportunities.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/portal/crm/opportunities/${o.id}`}
                    className="block rounded-lg bg-white p-2 text-sm shadow-sm ring-1 ring-slate-200 hover:ring-slate-400"
                  >
                    <span className="block font-medium">{o.title}</span>
                    <span className="block text-xs text-slate-600">
                      {o.customer}
                    </span>
                    <span className="mt-1 flex items-center justify-between text-xs">
                      <span className="tabular-nums">
                        {formatTaka(o.value, lang)} · {o.probability}%
                      </span>
                      <span
                        className={
                          o.late
                            ? "font-semibold text-red-700"
                            : "text-slate-500"
                        }
                      >
                        {o.late && `${t("cr.late")} · `}
                        {formatDate(o.expectedCloseOn, lang, { short: true })}
                      </span>
                    </span>
                    <span className="block text-xs text-slate-500">
                      {o.ownerName}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function ListView({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [state, setState] = useState("open");
  const [q, setQ] = useState("");
  const query = new URLSearchParams({
    ...(state ? { state } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  }).toString();
  const list = useApi<OpportunityRow[]>(
    `/companies/${companyId}/opportunities?${query}`,
  );
  return (
    <Panel
      actions={
        <>
          <Input
            aria-label={t("cr.search")}
            placeholder={t("cr.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            id="opp-search"
          />
          <Select
            aria-label={t("cr.state")}
            value={state}
            onChange={(e) => setState(e.target.value)}
            id="opp-state"
          >
            <option value="">{t("p.all")}</option>
            {(["open", "won", "lost"] as const).map((s) => (
              <option key={s} value={s}>
                {t(`cr.ostate.${s}`)}
              </option>
            ))}
          </Select>
        </>
      }
    >
      {list.error ? (
        <ErrorBox error={list.error} onRetry={list.reload} />
      ) : (
        <Table
          rows={list.data}
          rowKey={(o) => o.id}
          empty={t("st.none")}
          onRowClick={(o) => router.push(`/portal/crm/opportunities/${o.id}`)}
          columns={[
            {
              key: "number",
              label: t("cr.number"),
              className: "font-mono whitespace-nowrap text-xs",
              render: (o) => o.number,
            },
            {
              key: "title",
              label: t("cr.title"),
              render: (o) => (
                <span>
                  {o.title}
                  <span className="block text-xs text-slate-500">
                    {o.customer}
                  </span>
                </span>
              ),
            },
            {
              key: "stage",
              label: t("cr.stage"),
              render: (o) =>
                o.state === "open" ? (
                  (lang === "bn" && o.stageNameBn) || o.stageName
                ) : (
                  <Badge color={OPP_STATE_COLOR[o.state]}>
                    {t(`cr.ostate.${o.state}`)}
                  </Badge>
                ),
            },
            {
              key: "value",
              label: t("cr.value"),
              align: "right",
              render: (o) => formatTaka(o.value, lang),
            },
            {
              key: "probability",
              label: "%",
              align: "right",
              render: (o) => o.probability,
            },
            {
              key: "weighted",
              label: t("cr.weighted"),
              align: "right",
              render: (o) => formatTaka(o.weighted, lang),
            },
            {
              key: "close",
              label: t("cr.expectedClose"),
              render: (o) =>
                formatDate(o.closedOn ?? o.expectedCloseOn, lang, {
                  short: true,
                }),
            },
            {
              key: "owner",
              label: t("cr.owner"),
              render: (o) => o.ownerName ?? "",
            },
          ]}
        />
      )}
    </Panel>
  );
}
