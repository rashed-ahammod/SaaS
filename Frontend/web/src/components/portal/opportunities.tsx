"use client";
/**
 * Opportunity pieces of the portal (Phase 3 WP24):
 *   OpportunityFields              title, value, expected close, stage (also used when qualifying a lead)
 *   OpportunityDialog              a new opportunity for a customer
 *   MoveStageDialog, WonDialog, LostDialog, ReopenDialog   the opportunity's next steps
 *   OpportunitiesPanel             a customer's or lead's opportunities
 *   StageHistory                   every change of stage or state
 *   StagesPanel                    the company's stages (Admin)
 *   TargetsPanel                   targets, won and expected for a month; the Sales head / Admin sets them
 */
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, ErrorBox, Field, Input, Select } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import {
  LOST_REASONS,
  OPP_STATE_COLOR,
  type Customer,
  type OpportunityBrief,
  type OpportunityDetail,
  type Stage,
  type TargetRow,
} from "@/lib/crm-types";
import { dhakaToday, formatDate, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import {
  ActionMessage,
  FormButtons,
  Modal,
  Panel,
  Table,
  useAction,
} from "./kit";
import { useOrg } from "./org";

const only = (f: Record<string, string>) =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));

export function useStages(companyId: string | null | undefined) {
  return useApi<Stage[]>(
    companyId ? `/companies/${companyId}/opportunity-stages` : null,
  );
}

export function StageSelect({
  stages,
  value,
  onChange,
  id,
  allowEmpty,
}: {
  stages: Stage[] | undefined;
  value: string;
  onChange: (v: string) => void;
  id: string;
  allowEmpty?: string;
}) {
  const { lang } = useI18n();
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      id={id}
      required={!allowEmpty}
    >
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {stages
        ?.filter((s) => s.isActive)
        .map((s) => (
          <option key={s.id} value={s.id}>
            {(lang === "bn" && s.nameBn) || s.name} · {s.probability}%
          </option>
        ))}
    </Select>
  );
}

export const emptyOpportunity = () => ({
  title: "",
  value: "",
  expectedCloseOn: "",
  stageId: "",
  probability: "",
});

export function OpportunityFields({
  companyId,
  f,
  setF,
}: {
  companyId: string;
  f: Record<string, string>;
  setF: (f: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const stages = useStages(companyId);
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-x-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label={t("cr.title")}>
          <Input
            required
            maxLength={200}
            value={f.title}
            onChange={set("title")}
            id="opp-title"
          />
        </Field>
      </div>
      <Field label={t("cr.value")}>
        <Input
          required
          inputMode="decimal"
          pattern="\d+(\.\d{1,2})?"
          value={f.value}
          onChange={set("value")}
          id="opp-value"
          placeholder="850000"
        />
      </Field>
      <Field label={t("cr.expectedClose")}>
        <Input
          required
          type="date"
          value={f.expectedCloseOn}
          onChange={set("expectedCloseOn")}
          id="opp-close"
        />
      </Field>
      <Field label={t("cr.stage")}>
        <StageSelect
          stages={stages.data}
          value={f.stageId}
          onChange={(stageId) => setF({ ...f, stageId })}
          id="opp-stage"
          allowEmpty={stages.data?.find((s) => s.isActive)?.name ?? "—"}
        />
      </Field>
      <Field label={t("cr.probability")} hint={t("cr.probabilityHint")}>
        <Input
          type="number"
          min={0}
          max={100}
          value={f.probability}
          onChange={set("probability")}
          id="opp-probability"
        />
      </Field>
    </div>
  );
}

/** The opportunity part of a request body: empty fields left out, probability as a number. */
export function opportunityBody(f: Record<string, string>) {
  const { probability, ...rest } = only(f);
  return {
    ...rest,
    ...(probability ? { probability: Number(probability) } : {}),
  };
}

export function OpportunityDialog({
  companyId,
  customer,
  onClose,
  onDone,
}: {
  companyId: string;
  customer?: { id: string; name: string };
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [customerId, setCustomerId] = useState(customer?.id ?? "");
  const [f, setF] = useState<Record<string, string>>(emptyOpportunity());
  const customers = useApi<Customer[]>(
    customer ? null : `/companies/${companyId}/customers`,
  );
  return (
    <Modal
      title={
        customer
          ? `${t("cr.newOpportunity")}: ${customer.name}`
          : t("cr.newOpportunity")
      }
      open
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const o = await save.run(() =>
            api.post<{ id: string }>(`/companies/${companyId}/opportunities`, {
              customerId,
              ...opportunityBody(f),
            }),
          );
          if (o && typeof o === "object") onDone(o.id);
        }}
      >
        <ActionMessage action={save} />
        {!customer && (
          <Field label={t("cr.customers")}>
            <Select
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              id="opp-customer"
            >
              <option value="">—</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <OpportunityFields companyId={companyId} f={f} setF={setF} />
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cr.newOpportunity")}
        />
      </form>
    </Modal>
  );
}

export function MoveStageDialog({
  o,
  companyId,
  onClose,
  onDone,
}: {
  o: OpportunityDetail;
  companyId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const stages = useStages(companyId);
  const [f, setF] = useState({ stageId: "", probability: "", note: "" });
  return (
    <Modal title={`${t("cr.moveStage")}: ${o.number}`} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            version: o.version,
            stageId: f.stageId,
            ...(f.probability ? { probability: Number(f.probability) } : {}),
            ...(f.note ? { note: f.note } : {}),
          };
          if (
            await save.run(() => api.post(`/opportunities/${o.id}/stage`, body))
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("cr.stage")}>
          <StageSelect
            stages={stages.data?.filter((s) => s.id !== o.stageId)}
            value={f.stageId}
            onChange={(stageId) => setF({ ...f, stageId })}
            id="move-stage"
            allowEmpty="—"
          />
        </Field>
        <Field label={t("cr.probability")} hint={t("cr.probabilityHint")}>
          <Input
            type="number"
            min={0}
            max={100}
            value={f.probability}
            onChange={(e) => setF({ ...f, probability: e.target.value })}
            id="move-probability"
          />
        </Field>
        <Field label={t("cr.note")}>
          <Input
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="move-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cr.moveStage")}
        />
      </form>
    </Modal>
  );
}

export function WonDialog({
  o,
  onClose,
  onDone,
}: {
  o: OpportunityDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    closedOn: dhakaToday(),
    value: String(Number(o.value)),
    note: "",
  });
  return (
    <Modal title={`${t("cr.markWon")}: ${o.number}`} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/opportunities/${o.id}/won`, {
                version: o.version,
                ...only(f),
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("cr.closedOn")}>
          <Input
            required
            type="date"
            max={dhakaToday()}
            value={f.closedOn}
            onChange={(e) => setF({ ...f, closedOn: e.target.value })}
            id="won-date"
          />
        </Field>
        <Field label={t("cr.value")}>
          <Input
            required
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            value={f.value}
            onChange={(e) => setF({ ...f, value: e.target.value })}
            id="won-value"
          />
        </Field>
        <Field label={t("cr.note")}>
          <Input
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="won-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cr.markWon")}
        />
      </form>
    </Modal>
  );
}

export function LostDialog({
  o,
  onClose,
  onDone,
}: {
  o: OpportunityDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({ reason: "", closedOn: dhakaToday(), note: "" });
  return (
    <Modal title={`${t("cr.markLost")}: ${o.number}`} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/opportunities/${o.id}/lost`, {
                version: o.version,
                ...only(f),
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("cr.lostReason")}>
          <Select
            required
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
            id="lost-reason"
          >
            <option value="">—</option>
            {LOST_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`cr.lost.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("cr.closedOn")}>
          <Input
            required
            type="date"
            max={dhakaToday()}
            value={f.closedOn}
            onChange={(e) => setF({ ...f, closedOn: e.target.value })}
            id="lost-date"
          />
        </Field>
        <Field label={t("cr.note")}>
          <Input
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="lost-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cr.markLost")}
        />
      </form>
    </Modal>
  );
}

export function ReopenDialog({
  o,
  companyId,
  onClose,
  onDone,
}: {
  o: OpportunityDetail;
  companyId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const stages = useStages(companyId);
  const [f, setF] = useState({ stageId: "", expectedCloseOn: "", note: "" });
  return (
    <Modal title={`${t("cr.reopen")}: ${o.number}`} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/opportunities/${o.id}/reopen`, {
                version: o.version,
                ...f,
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("cr.stage")}>
          <StageSelect
            stages={stages.data}
            value={f.stageId}
            onChange={(stageId) => setF({ ...f, stageId })}
            id="reopen-stage"
            allowEmpty="—"
          />
        </Field>
        <Field label={t("cr.expectedClose")}>
          <Input
            required
            type="date"
            value={f.expectedCloseOn}
            onChange={(e) => setF({ ...f, expectedCloseOn: e.target.value })}
            id="reopen-close"
          />
        </Field>
        <Field label={t("cr.reason")}>
          <Input
            required
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="reopen-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cr.reopen")}
        />
      </form>
    </Modal>
  );
}

export function OpportunitiesPanel({
  rows,
  actions,
}: {
  rows: OpportunityBrief[];
  actions?: React.ReactNode;
}) {
  const { t, lang } = useI18n();
  return (
    <Panel title={t("cr.opportunities")} actions={actions}>
      <Table
        rows={rows}
        rowKey={(o) => o.id}
        empty={t("st.none")}
        columns={[
          {
            key: "number",
            label: t("cr.number"),
            className: "font-mono whitespace-nowrap text-xs",
            render: (o) => (
              <Link
                className="underline"
                href={`/portal/crm/opportunities/${o.id}`}
              >
                {o.number}
              </Link>
            ),
          },
          { key: "title", label: t("cr.title"), render: (o) => o.title },
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
            key: "close",
            label: t("cr.expectedClose"),
            render: (o) =>
              formatDate(o.closedOn ?? o.expectedCloseOn, lang, {
                short: true,
              }),
          },
        ]}
      />
    </Panel>
  );
}

export function StageHistory({ o }: { o: OpportunityDetail }) {
  const { t, lang } = useI18n();
  return (
    <Panel title={t("cr.history")}>
      <p className="mb-3 text-xs text-slate-500">{t("cr.historyHint")}</p>
      <ol className="space-y-3">
        {o.history.map((h) => (
          <li key={h.id} className="border-l-2 border-slate-200 pl-3 text-sm">
            <p>
              {h.fromState && h.fromState !== h.toState ? (
                <Badge color={OPP_STATE_COLOR[h.toState]}>
                  {t(`cr.ostate.${h.toState}`)}
                </Badge>
              ) : (
                <span className="font-medium">
                  {h.fromStage ? `${h.fromStage} → ${h.toStage}` : h.toStage}
                </span>
              )}{" "}
              <span className="text-slate-600">
                · {formatTaka(h.value, lang)} · {h.probability}%
              </span>
            </p>
            {h.note && <p className="text-slate-700">{h.note}</p>}
            <p className="text-xs text-slate-500">
              {formatDate(h.changedAt.slice(0, 10), lang, { short: true })}
              {h.byName ? ` · ${h.byName}` : ""}
            </p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** The company's open stages (Admin adds, renames, re-orders, retires). */
export function StagesPanel({ companyId }: { companyId: string }) {
  const { t } = useI18n();
  const stages = useStages(companyId);
  const [editing, setEditing] = useState<Stage | "new" | null>(null);
  const manage = !!stages.data?.[0]?.canManage;
  return (
    <Panel
      title={t("cr.stages")}
      actions={
        manage && (
          <Button variant="secondary" onClick={() => setEditing("new")}>
            {t("cr.newStage")}
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-slate-600">{t("cr.stagesHint")}</p>
      {stages.error ? (
        <ErrorBox error={stages.error} onRetry={stages.reload} />
      ) : (
        <Table
          rows={stages.data}
          rowKey={(s) => s.id}
          onRowClick={manage ? (s) => setEditing(s) : undefined}
          columns={[
            { key: "order", label: t("cr.order"), render: (s) => s.sortOrder },
            {
              key: "name",
              label: t("cr.name"),
              render: (s) => (
                <span>
                  {s.name}
                  {s.nameBn && (
                    <span className="block text-xs text-slate-500">
                      {s.nameBn}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: "probability",
              label: t("cr.probability"),
              align: "right",
              render: (s) => `${s.probability}%`,
            },
            {
              key: "open",
              label: t("cr.ostate.open"),
              align: "right",
              render: (s) => s.openCount ?? 0,
            },
            {
              key: "active",
              label: t("cr.active"),
              render: (s) =>
                s.isActive ? (
                  <Badge color="green">✓</Badge>
                ) : (
                  <Badge color="gray">—</Badge>
                ),
            },
          ]}
        />
      )}
      {editing && (
        <StageDialog
          companyId={companyId}
          stage={editing === "new" ? null : editing}
          next={(stages.data?.length ?? 0) + 1}
          onClose={() => setEditing(null)}
          onDone={() => (setEditing(null), stages.reload())}
        />
      )}
    </Panel>
  );
}

function StageDialog({
  companyId,
  stage,
  next,
  onClose,
  onDone,
}: {
  companyId: string;
  stage: Stage | null;
  next: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    name: stage?.name ?? "",
    nameBn: stage?.nameBn ?? "",
    probability: String(stage?.probability ?? 50),
    sortOrder: String(stage?.sortOrder ?? next),
    isActive: stage?.isActive ?? true,
  });
  return (
    <Modal title={stage ? stage.name : t("cr.newStage")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            name: f.name,
            ...(f.nameBn ? { nameBn: f.nameBn } : {}),
            probability: Number(f.probability),
            sortOrder: Number(f.sortOrder),
          };
          const ok = stage
            ? await save.run(() =>
                api.put(`/opportunity-stages/${stage.id}`, {
                  ...body,
                  version: stage.version,
                  isActive: f.isActive,
                }),
              )
            : await save.run(() =>
                api.post(`/companies/${companyId}/opportunity-stages`, body),
              );
          if (ok) onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("cr.name")}>
          <Input
            required
            maxLength={80}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            id="stage-name"
          />
        </Field>
        <Field label={t("cr.nameBn")}>
          <Input
            maxLength={80}
            value={f.nameBn}
            onChange={(e) => setF({ ...f, nameBn: e.target.value })}
            id="stage-name-bn"
          />
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("cr.probability")}>
            <Input
              required
              type="number"
              min={0}
              max={100}
              value={f.probability}
              onChange={(e) => setF({ ...f, probability: e.target.value })}
              id="stage-probability"
            />
          </Field>
          <Field label={t("cr.order")}>
            <Input
              required
              type="number"
              min={1}
              max={99}
              value={f.sortOrder}
              onChange={(e) => setF({ ...f, sortOrder: e.target.value })}
              id="stage-order"
            />
          </Field>
        </div>
        {stage && (
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.isActive}
              onChange={(e) => setF({ ...f, isActive: e.target.checked })}
              id="stage-active"
            />{" "}
            {t("cr.active")}
          </label>
        )}
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={stage ? t("p.save") : t("cr.newStage")}
        />
      </form>
    </Modal>
  );
}

/** Targets for a month: what each salesperson and department won against it, and what is still expected. */
export function TargetsPanel({
  companyId,
  month,
  canSetDepartment,
}: {
  companyId: string;
  month: string;
  canSetDepartment: boolean;
}) {
  const { t, lang } = useI18n();
  const targets = useApi<{ month: string; rows: TargetRow[] }>(
    `/companies/${companyId}/sales-targets?month=${month}`,
  );
  const [editing, setEditing] = useState<TargetRow | null>(null);
  const newDepartment: TargetRow = {
    kind: "department",
    userId: null,
    departmentId: null,
    name: t("cr.departmentTarget"),
    targetId: null,
    amount: null,
    won: "0",
    expected: "0",
    attainment: null,
    canSet: true,
  };
  return (
    <Panel
      title={t("cr.targets")}
      actions={
        canSetDepartment && (
          <Button variant="secondary" onClick={() => setEditing(newDepartment)}>
            {t("cr.departmentTarget")}
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-slate-600">{t("cr.targetsHint")}</p>
      {targets.error ? (
        <ErrorBox error={targets.error} onRetry={targets.reload} />
      ) : (
        <Table
          rows={targets.data?.rows}
          rowKey={(r) => r.userId ?? r.departmentId!}
          empty={t("st.none")}
          onRowClick={(r) => r.canSet && setEditing(r)}
          columns={[
            {
              key: "name",
              label: t("cr.name"),
              render: (r) => (
                <span
                  className={r.kind === "department" ? "font-semibold" : ""}
                >
                  {r.name}
                  {r.kind === "department" && (
                    <span className="block text-xs text-slate-500">
                      {t("cr.department")}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: "target",
              label: t("cr.target"),
              align: "right",
              render: (r) => (r.amount ? formatTaka(r.amount, lang) : "—"),
            },
            {
              key: "won",
              label: t("cr.won"),
              align: "right",
              render: (r) => formatTaka(r.won, lang),
            },
            {
              key: "attainment",
              label: t("cr.attainment"),
              align: "right",
              render: (r) =>
                r.attainment === null ? (
                  "—"
                ) : (
                  <Badge
                    color={
                      r.attainment >= 100
                        ? "green"
                        : r.attainment >= 50
                          ? "amber"
                          : "gray"
                    }
                  >
                    {r.attainment}%
                  </Badge>
                ),
            },
            {
              key: "expected",
              label: t("cr.expected"),
              align: "right",
              render: (r) => formatTaka(r.expected, lang),
            },
            {
              key: "set",
              label: "",
              render: (r) =>
                r.canSet && (
                  <span className="text-xs text-slate-500 underline">
                    {t("cr.setTarget")}
                  </span>
                ),
            },
          ]}
        />
      )}
      {editing && (
        <TargetDialog
          companyId={companyId}
          month={month}
          row={editing}
          onClose={() => setEditing(null)}
          onDone={() => (setEditing(null), targets.reload())}
        />
      )}
    </Panel>
  );
}

function TargetDialog({
  companyId,
  month,
  row,
  onClose,
  onDone,
}: {
  companyId: string;
  month: string;
  row: TargetRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [amount, setAmount] = useState(
    row.amount ? String(Number(row.amount)) : "",
  );
  const [departmentId, setDepartmentId] = useState(row.departmentId ?? "");
  const org = useOrg(
    row.kind === "department" && !row.departmentId ? companyId : undefined,
  );
  return (
    <Modal
      title={`${t("cr.setTarget")}: ${row.name} · ${month}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const target =
            row.kind === "user"
              ? { userId: row.userId, amount }
              : { departmentId, amount };
          if (
            await save.run(() =>
              api.put(`/companies/${companyId}/sales-targets`, {
                month,
                targets: [target],
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        {row.kind === "department" && !row.departmentId && (
          <Field label={t("cr.department")}>
            <Select
              required
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              id="target-department"
            >
              <option value="">—</option>
              {org.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} · {d.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t("cr.target")}>
          <Input
            required
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            id="target-amount"
            placeholder="1500000"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cr.setTarget")}
        />
      </form>
    </Modal>
  );
}
