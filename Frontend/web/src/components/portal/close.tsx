"use client";
/**
 * Finance close pieces of the portal (WP22):
 *   CashFlowView, DepartmentCostView, ReceivablesAgingView   reports
 *   ChecklistPanel     the month-end checklist and the close
 *   Gate2Panel         the Gate 2 report, criterion by criterion
 *   OpeningPanel       the opening trial balance from the old system
 *   AccountMapPanel    old system accounts -> ours
 *   ComparisonsPanel   the old system's trial balance against ours
 *   ReadScanButton     the AI bill reader: fills a form from a photo or PDF
 */
import { useState } from "react";
import { AccountSelect, Taka, useAccounts } from "@/components/portal/finance";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type {
  AccountMapRow,
  CashFlow,
  Checklist,
  Comparison,
  DepartmentCost,
  Gate2Report,
  OpeningStatus,
  ReadDocument,
  ReceivablesAging,
} from "@/lib/close-types";
import { dhakaToday, formatDate, formatMonth, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  ActionMessage,
  FormButtons,
  Modal,
  Panel,
  Table,
  useAction,
} from "./kit";
import { usePortal } from "./portal-context";

// ------------------------------------------------------------ reports

export function CashFlowView({ path }: { path: string }) {
  const { t, lang } = useI18n();
  const r = useApi<CashFlow>(path);
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  if (!r.data) return <Loading />;
  const d = r.data;
  return (
    <Panel>
      <div className="max-w-3xl text-sm">
        <Line label={t("cl.cf.opening")} value={d.openingCash} strong />
        {d.sections.map((s) => (
          <div key={s.activity} className="mt-4">
            <h3 className="mb-1 font-semibold">{t(`cl.cf.${s.activity}`)}</h3>
            {s.rows.map((row) => (
              <Line
                key={row.accountId}
                label={`${row.code} · ${row.name}`}
                value={row.net}
              />
            ))}
            <Line label={t("cl.cf.net")} value={s.net} strong />
          </div>
        ))}
        <div className="mt-4">
          <Line label={t("cl.cf.net")} value={d.netChange} strong />
          <Line label={t("cl.cf.closing")} value={d.closingCash} strong />
        </div>
        <p
          className={`mt-3 rounded-lg px-3 py-2 ${Number(d.difference) === 0 ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}
          role="status"
        >
          {Number(d.difference) === 0
            ? t("cl.cf.agrees")
            : t("cl.cf.differs", { amount: formatTaka(d.difference, lang) })}
        </p>
      </div>
    </Panel>
  );
}

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-4 border-b border-slate-100 py-1 ${strong ? "font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">
        <Taka value={value} />
      </span>
    </div>
  );
}

export function DepartmentCostView({ path }: { path: string }) {
  const { t } = useI18n();
  const r = useApi<DepartmentCost>(path);
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  if (!r.data) return <Loading />;
  const d = r.data;
  return (
    <Panel>
      <Table
        rows={[
          ...d.rows,
          {
            departmentId: "total",
            code: null,
            name: t("cl.dept.total"),
            amounts: d.totals,
            total: d.total,
          },
        ]}
        rowKey={(x) => x.departmentId ?? "none"}
        empty={t("st.none")}
        columns={[
          {
            key: "dept",
            label: t("as.department"),
            render: (x) =>
              x.departmentId === "total" ? (
                <strong>{x.name}</strong>
              ) : x.name ? (
                `${x.code} · ${x.name}`
              ) : (
                <em>{t("cl.dept.none")}</em>
              ),
          },
          ...d.groups.map((g) => ({
            key: g.id,
            label: `${g.code} ${g.name}`,
            align: "right" as const,
            render: (x: (typeof d.rows)[number]) => (
              <Taka value={x.amounts[g.id]} />
            ),
          })),
          {
            key: "total",
            label: t("cl.dept.total"),
            align: "right",
            render: (x) => (
              <strong>
                <Taka value={x.total} />
              </strong>
            ),
          },
        ]}
      />
    </Panel>
  );
}

export function ReceivablesAgingView({ path }: { path: string }) {
  const { t } = useI18n();
  const r = useApi<ReceivablesAging>(path);
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  if (!r.data) return <Loading />;
  const d = r.data;
  const keys = [...d.buckets, "total"] as const;
  return (
    <Panel>
      <Table
        rows={[...d.customers, { customer: t("cl.ar.total"), ...d.totals }]}
        rowKey={(x) => x.customer}
        empty={t("st.none")}
        columns={[
          {
            key: "customer",
            label: t("cl.ar.customer"),
            render: (x) => x.customer,
          },
          ...keys.map((k) => ({
            key: k,
            label: t(`cl.ar.${k}`),
            align: "right" as const,
            render: (x: (typeof d.customers)[number]) => <Taka value={x[k]} />,
          })),
        ]}
      />
    </Panel>
  );
}

// ------------------------------------------------------------ month-end close

export function ChecklistPanel({
  companyId,
  period,
  onChanged,
}: {
  companyId: string;
  period: string;
  onChanged?: () => void;
}) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const list = useApi<Checklist>(
    `/companies/${companyId}/month-close/${period}`,
  );
  const action = useAction();
  const [ticking, setTicking] = useState<string | null>(null);
  const manage = can("ledger.periods.close");
  const reload = () => (list.reload(), onChanged?.());
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  const d = list.data;
  return (
    <Panel
      title={`${formatMonth(period, lang)} · ${d.state === "closed" ? t("cl.mc.closed") : t("cl.mc.open")}`}
      actions={
        manage &&
        d.state === "open" && (
          <Button
            disabled={!d.ready}
            busy={action.busy}
            onClick={() =>
              action
                .run(
                  () =>
                    api.post(
                      `/companies/${companyId}/month-close/${period}/close`,
                    ),
                  t("p.done"),
                )
                .then((r) => r && reload())
            }
          >
            {t("cl.mc.closeMonth")}
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-slate-600">{t("cl.mc.hint")}</p>
      <ActionMessage action={action} />
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {d.items.map((i) => (
          <li
            key={i.key}
            className="flex items-start justify-between gap-3 p-3"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {t(`cl.mc.item.${i.key}`)}
              </span>
              {i.detail && (
                <span
                  className={`block text-xs ${i.ok ? "text-slate-600" : "text-red-700"}`}
                >
                  {i.detail}
                </span>
              )}
              {i.doneBy && (
                <span className="block text-xs text-slate-500">
                  {i.doneBy}
                  {i.doneAt
                    ? ` · ${formatDate(i.doneAt.slice(0, 10), lang, { short: true })}`
                    : ""}
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge
                color={i.notApplicable ? "gray" : i.ok ? "green" : "amber"}
              >
                {i.notApplicable
                  ? t("cl.mc.na")
                  : i.ok
                    ? t("cl.mc.done")
                    : t("cl.mc.notDone")}
              </Badge>
              {manage &&
                d.state === "open" &&
                i.kind === "manual" &&
                !i.notApplicable &&
                (i.ok ? (
                  <Button
                    variant="ghost"
                    className="min-h-8 px-2 py-1 text-xs"
                    onClick={() =>
                      action
                        .run(() =>
                          api.delete(
                            `/companies/${companyId}/month-close/${period}/items/${i.key}`,
                          ),
                        )
                        .then(reload)
                    }
                  >
                    {t("cl.mc.untick")}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    className="min-h-8 px-2 py-1 text-xs"
                    onClick={() => setTicking(i.key)}
                  >
                    {t("cl.mc.tick")}
                  </Button>
                ))}
            </span>
          </li>
        ))}
      </ul>
      {ticking && (
        <TickDialog
          companyId={companyId}
          period={period}
          itemKey={ticking}
          onClose={() => setTicking(null)}
          onDone={() => (setTicking(null), reload())}
        />
      )}
    </Panel>
  );
}

function TickDialog({
  companyId,
  period,
  itemKey,
  onClose,
  onDone,
}: {
  companyId: string;
  period: string;
  itemKey: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [note, setNote] = useState("");
  return (
    <Modal title={t(`cl.mc.item.${itemKey}`)} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(
                `/companies/${companyId}/month-close/${period}/items/${itemKey}`,
                { note },
              ),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("cl.mc.note")}>
          <Input
            required
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            id="tick-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cl.mc.tick")}
        />
      </form>
    </Modal>
  );
}

export function Gate2Panel({
  companyId,
  reloadKey,
}: {
  companyId: string;
  reloadKey?: number;
}) {
  const { t, lang } = useI18n();
  const r = useApi<Gate2Report>(
    `/companies/${companyId}/gate-2${reloadKey ? `?r=${reloadKey}` : ""}`,
  );
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  if (!r.data) return <Loading />;
  const d = r.data;
  return (
    <Panel title={t("cl.g2.title")}>
      <p className="mb-3 text-sm text-slate-600">{t("cl.g2.hint")}</p>
      <p
        className={`mb-3 rounded-lg px-3 py-2 font-medium ${d.passed ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}
        role="status"
      >
        {d.passed
          ? t("cl.g2.passed", { month: formatMonth(d.month!, lang) })
          : t("cl.g2.notYet")}
      </p>
      <ul className="space-y-2 text-sm">
        {d.criteria.map((c) => (
          <li key={c.key} className="flex items-start gap-2">
            <span
              aria-hidden
              className={c.ok ? "text-emerald-600" : "text-slate-400"}
            >
              {c.ok ? "✓" : "○"}
            </span>
            <span>
              {t(`cl.g2.${c.key}`)}
              {c.detail && (
                <span className="block text-xs text-slate-500">{c.detail}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ------------------------------------------------------------ opening and the old system

export function OpeningPanel({
  companyId,
  onChanged,
}: {
  companyId: string;
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const status = useApi<OpeningStatus>(
    `/companies/${companyId}/opening-balances`,
  );
  const action = useAction();
  const [cutOver, setCutOver] = useState(`${dhakaToday().slice(0, 7)}-01`);
  const [file, setFile] = useState<File | null>(null);
  const live = status.data?.imports.find((i) => i.state !== "cancelled");
  return (
    <Panel title={t("cl.ob.import")}>
      <p className="mb-3 text-sm text-slate-600">{t("cl.ob.hint")}</p>
      <ActionMessage action={action} />
      {live ? (
        <p className="text-sm">
          <Badge color={live.state === "posted" ? "green" : "amber"}>
            {t(`cl.ob.state.${live.state}`)}
          </Badge>{" "}
          {live.fileName} · {formatDate(live.cutOverDate, lang)} ·{" "}
          {t("cl.ob.rows", { n: live.rows })} ·{" "}
          {formatTaka(live.totalDebit, lang)}
          {live.voucherNumber && (
            <span className="font-mono"> · {live.voucherNumber}</span>
          )}{" "}
          · {t("cl.ob.mapped", { n: status.data!.mappedOldAccounts })}
        </p>
      ) : (
        can("ledger.setup") && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!file) return;
              const form = new FormData();
              form.append("file", file);
              form.append("cutOverDate", cutOver);
              if (
                await action.run(
                  () =>
                    api.upload(
                      `/companies/${companyId}/opening-balances`,
                      form,
                    ),
                  t("p.done"),
                )
              ) {
                status.reload();
                onChanged();
              }
            }}
          >
            <Field label={t("cl.ob.cutOver")}>
              <Input
                type="date"
                required
                value={cutOver}
                onChange={(e) => setCutOver(e.target.value)}
                id="opening-cut-over"
              />
            </Field>
            <Field label={t("cl.ob.file")}>
              <Input
                type="file"
                accept=".csv,text/csv"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                id="opening-file"
              />
            </Field>
            <Button className="mb-3" type="submit" busy={action.busy}>
              {t("cl.ob.import")}
            </Button>
          </form>
        )
      )}
    </Panel>
  );
}

export function AccountMapPanel({
  companyId,
  reloadKey,
}: {
  companyId: string;
  reloadKey: number;
}) {
  const { t } = useI18n();
  const { can } = usePortal();
  const map = useApi<AccountMapRow[]>(
    `/companies/${companyId}/account-map?r=${reloadKey}`,
  );
  const accounts = useAccounts(companyId);
  const save = useAction();
  const [f, setF] = useState({ oldCode: "", oldName: "", accountId: "" });
  return (
    <Panel title={t("cl.ob.map")}>
      <Table
        rows={map.data}
        rowKey={(m) => m.oldCode}
        empty={t("st.none")}
        columns={[
          {
            key: "old",
            label: t("cl.ob.oldCode"),
            className: "font-mono",
            render: (m) => m.oldCode,
          },
          {
            key: "oldName",
            label: t("cl.ob.oldName"),
            render: (m) => m.oldName ?? "",
          },
          {
            key: "ours",
            label: t("cl.ob.ours"),
            render: (m) => `${m.accountCode} · ${m.accountName}`,
          },
        ]}
      />
      {can("ledger.setup") && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await save.run(
                () =>
                  api.put(`/companies/${companyId}/account-map`, {
                    oldCode: f.oldCode,
                    ...(f.oldName ? { oldName: f.oldName } : {}),
                    accountId: f.accountId,
                  }),
                t("p.saved"),
              )
            ) {
              setF({ oldCode: "", oldName: "", accountId: "" });
              map.reload();
            }
          }}
        >
          <ActionMessage action={save} />
          <Field label={t("cl.ob.oldCode")}>
            <Input
              required
              maxLength={40}
              value={f.oldCode}
              onChange={(e) => setF({ ...f, oldCode: e.target.value })}
              id="map-old-code"
            />
          </Field>
          <Field label={t("cl.ob.oldName")}>
            <Input
              maxLength={200}
              value={f.oldName}
              onChange={(e) => setF({ ...f, oldName: e.target.value })}
              id="map-old-name"
            />
          </Field>
          <Field label={t("cl.ob.ours")}>
            <AccountSelect
              id="map-account"
              required
              accounts={accounts.postable}
              value={f.accountId}
              onChange={(accountId) => setF({ ...f, accountId })}
            />
          </Field>
          <Button
            className="mb-3"
            type="submit"
            variant="secondary"
            busy={save.busy}
          >
            {t("cl.ob.addMap")}
          </Button>
        </form>
      )}
    </Panel>
  );
}

export function ComparisonsPanel({
  companyId,
  onChanged,
}: {
  companyId: string;
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const list = useApi<Comparison[]>(
    `/companies/${companyId}/old-system-comparisons`,
  );
  const action = useAction();
  const [asOf, setAsOf] = useState(dhakaToday());
  const [file, setFile] = useState<File | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const detail = useApi<Comparison>(
    open ? `/old-system-comparisons/${open}` : null,
  );
  return (
    <Panel title={t("cl.ob.compare")}>
      <p className="mb-3 text-sm text-slate-600">{t("cl.ob.compareHint")}</p>
      <ActionMessage action={action} />
      {can("ledger.setup") && (
        <form
          className="mb-3 flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!file) return;
            const form = new FormData();
            form.append("file", file);
            form.append("asOf", asOf);
            const r = await action.run(() =>
              api.upload<Comparison>(
                `/companies/${companyId}/old-system-comparisons`,
                form,
              ),
            );
            if (r && typeof r === "object") {
              setOpen(r.id);
              list.reload();
              onChanged();
            }
          }}
        >
          <Field label={t("cl.ob.asOf")}>
            <Input
              type="date"
              required
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              id="compare-as-of"
            />
          </Field>
          <Field label={t("cl.ob.file")}>
            <Input
              type="file"
              accept=".csv,text/csv"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              id="compare-file"
            />
          </Field>
          <Button className="mb-3" type="submit" busy={action.busy}>
            {t("cl.ob.compare")}
          </Button>
        </form>
      )}
      <Table
        rows={list.data}
        rowKey={(x) => x.id}
        empty={t("st.none")}
        onRowClick={(x) => setOpen(x.id)}
        columns={[
          {
            key: "asOf",
            label: t("cl.ob.asOf"),
            render: (x) => formatDate(x.asOf, lang, { short: true }),
          },
          {
            key: "file",
            label: t("cl.ob.file"),
            className: "font-mono text-xs",
            render: (x) => x.fileName,
          },
          {
            key: "result",
            label: "",
            render: (x) =>
              x.matched ? (
                <Badge color="green">{t("cl.ob.matched")}</Badge>
              ) : (
                <Badge color="red">
                  {t("cl.ob.notMatched", { d: x.differences, u: x.unmapped })}
                </Badge>
              ),
          },
          {
            key: "note",
            label: "",
            render: (x) => <span className="text-xs">{x.note ?? ""}</span>,
          },
        ]}
      />
      {open && detail.data && (
        <div className="mt-4">
          <Table
            rows={detail.data.lines?.filter(
              (l) => Number(l.difference) !== 0 || Number(l.ourBalance) !== 0,
            )}
            rowKey={(l) => l.accountId}
            columns={[
              {
                key: "acct",
                label: t("cl.ob.ours"),
                render: (l) => `${l.accountCode} · ${l.accountName}`,
              },
              {
                key: "old",
                label: t("cl.ob.oldCode"),
                className: "font-mono text-xs",
                render: (l) => l.oldCodes.join(", "),
              },
              {
                key: "oldBal",
                label: t("cl.ob.old"),
                align: "right",
                render: (l) => <Taka value={l.oldBalance} />,
              },
              {
                key: "ours",
                label: t("cl.ob.oursBal"),
                align: "right",
                render: (l) => <Taka value={l.ourBalance} />,
              },
              {
                key: "diff",
                label: t("cl.ob.diff"),
                align: "right",
                render: (l) => (
                  <span
                    className={
                      Number(l.difference) !== 0
                        ? "font-semibold text-red-700"
                        : ""
                    }
                  >
                    <Taka value={l.difference} />
                  </span>
                ),
              },
            ]}
          />
          {!!detail.data.unmappedAccounts?.length && (
            <div className="mt-3 text-sm">
              <p className="font-medium text-red-700">{t("cl.ob.unmapped")}</p>
              <ul>
                {detail.data.unmappedAccounts.map((u) => (
                  <li key={u.oldCode}>
                    <span className="font-mono">{u.oldCode}</span> {u.oldName} ·{" "}
                    <Taka value={u.balance} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------ AI bill reader

/** Reads a photo / PDF of a bill and hands the fields to the form; the person checks them. */
export function ReadScanButton({
  companyId,
  kind,
  onRead,
}: {
  companyId?: string;
  kind: "bill" | "receipt";
  onRead: (doc: ReadDocument) => void;
}) {
  const { t } = useI18n();
  const ai = useApi<{ documentReader?: { available: boolean } }>("/ai/status");
  const action = useAction();
  const [doc, setDoc] = useState<ReadDocument | null>(null);
  if (!ai.data?.documentReader?.available) return null;
  return (
    <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm">
      <label className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-emerald-900">{t("cl.ai.read")}</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          aria-label={t("cl.ai.read")}
          id="read-scan"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const form = new FormData();
            form.append("file", f);
            form.append("kind", kind);
            if (companyId) form.append("companyId", companyId);
            const r = await action.run(() =>
              api.upload<ReadDocument>("/ai/document-reader", form),
            );
            if (r && typeof r === "object") {
              setDoc(r);
              if (r.readable) onRead(r);
            }
          }}
        />
        {action.busy && <span>{t("cl.ai.reading")}</span>}
      </label>
      <p className="mt-1 text-xs text-emerald-900">{t("cl.ai.readHint")}</p>
      <ActionMessage action={action} />
      {doc && !doc.readable && (
        <p className="mt-1 text-amber-800">{t("cl.ai.unreadable")}</p>
      )}
      {doc?.vendor && (
        <p className="mt-1 text-emerald-900">
          {t("cl.ai.vendorFound", {
            by: doc.vendor.matchedBy === "bin" ? "BIN" : "name",
            name: doc.vendor.name,
          })}
        </p>
      )}
      {doc?.warnings.map((w) => (
        <p key={w} className="mt-1 text-amber-800">
          {t(`cl.ai.warn.${w.split(":")[0]}`)}
        </p>
      ))}
    </div>
  );
}
