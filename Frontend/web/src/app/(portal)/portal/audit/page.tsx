"use client";
/** The audit log (append-only, hash-chained): who changed what, when, from where. */
import { useState } from "react";
import { PageHeader, Panel, Table } from "@/components/portal/kit";
import { Button, ErrorBox, Input, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import { formatDate, formatTime, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Page } from "@/lib/portal-types";

interface Entry {
  seq: number;
  occurredAt: string;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}

export default function AuditPage() {
  const { t, lang } = useI18n();
  const [action, setAction] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const log = useApi<Page<Entry>>(
    `/audit-log?page=${page}&pageSize=50${filter ? `&action=${encodeURIComponent(filter)}` : ""}`,
  );
  const pages = log.data
    ? Math.max(1, Math.ceil(log.data.total / log.data.pageSize))
    : 1;
  return (
    <div>
      <PageHeader title={t("p.audit.title")} />
      <Panel>
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setFilter(action.trim());
          }}
        >
          <Input
            className="max-w-xs"
            aria-label={t("p.audit.filterAction")}
            placeholder="payroll_run."
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
          <Button type="submit" variant="secondary">
            {t("p.search")}
          </Button>
        </form>
        {log.loading ? (
          <Loading />
        ) : log.error ? (
          <ErrorBox error={log.error} />
        ) : (
          <Table
            rows={log.data?.items}
            rowKey={(e) => String(e.seq)}
            columns={[
              {
                key: "seq",
                label: "#",
                align: "right",
                render: (e) => num(e.seq, lang),
              },
              {
                key: "when",
                label: t("p.audit.when"),
                render: (e) => (
                  <span className="whitespace-nowrap">
                    {formatDate(e.occurredAt.slice(0, 10), lang, {
                      short: true,
                    })}{" "}
                    {formatTime(e.occurredAt, lang)}
                  </span>
                ),
              },
              {
                key: "action",
                label: t("p.audit.action"),
                render: (e) => (
                  <span className="font-mono text-xs">{e.action}</span>
                ),
              },
              {
                key: "entity",
                label: t("p.audit.entity"),
                render: (e) => <span className="text-xs">{e.entity}</span>,
              },
              {
                key: "changes",
                label: t("p.audit.changes"),
                render: (e) => (
                  <span
                    className="block max-w-xl truncate text-xs text-slate-500"
                    title={JSON.stringify(e.after)}
                  >
                    {e.after ? JSON.stringify(e.after) : ""}
                  </span>
                ),
              },
              {
                key: "ip",
                label: "IP",
                render: (e) => <span className="text-xs">{e.ip ?? ""}</span>,
              },
            ]}
          />
        )}
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-end gap-2 text-sm">
            <Button
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t("p.prev")}
            </Button>
            <span>
              {t("p.pageOf", {
                page: num(page, lang),
                pages: num(pages, lang),
              })}
            </span>
            <Button
              variant="ghost"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              {t("p.next")}
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
