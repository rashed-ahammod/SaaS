"use client";
/** Approval chains (spec §5 "Default chains (customer can edit)"): the built-in defaults, and the company's own chains that come first. */
import { useState } from "react";
import {
  ActionMessage,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface Step {
  stepNo?: number;
  approverRule: string;
}
interface Chain {
  id?: string;
  requestType: string;
  name: string;
  priority?: number;
  conditions?: Record<string, unknown>;
  isActive?: boolean;
  version?: number;
  steps: Step[];
}
const RULES = [
  "line_manager",
  "dept_head",
  "role:hr",
  "role:accounts",
  "role:admin",
  "role:dept_head",
  "role:auditor",
];

export default function ChainsPage() {
  const { t } = useI18n();
  const { can } = usePortal();
  const chains = useApi<{ configured: Chain[]; builtIn: Chain[] }>(
    "/approvals/chains",
  );
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const rule = (r: string) => (r.startsWith("user:") ? r : t(`ac.rule.${r}`));
  const steps = (c: Chain) =>
    c.steps.map((s) => rule(s.approverRule)).join(" → ");
  const conditions = (c: Chain) =>
    Object.entries(c.conditions ?? {})
      .filter(
        ([, v]) =>
          v !== undefined && v !== null && !(Array.isArray(v) && !v.length),
      )
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
      .join(" · ");
  if (chains.loading && !chains.data) return <Loading />;
  if (chains.error)
    return <ErrorBox error={chains.error} onRetry={chains.reload} />;
  const types = [
    ...new Set(chains.data!.builtIn.map((c) => c.requestType)),
  ].sort();
  return (
    <div>
      <PageHeader
        title={t("ac.chains")}
        actions={
          can("approvals.configure") && (
            <Button onClick={() => setAdding(true)}>{t("ac.newChain")}</Button>
          )
        }
      />
      <p className="mb-4 text-sm text-slate-600">{t("ac.chainsHint")}</p>
      <ActionMessage action={action} />
      <Panel title={t("ac.configured")}>
        <Table
          rows={chains.data!.configured}
          rowKey={(c) => c.id!}
          empty={t("st.none")}
          columns={[
            {
              key: "type",
              label: t("ac.requestType"),
              render: (c) => t(`appr.type.${c.requestType}`),
            },
            {
              key: "name",
              label: t("ac.name"),
              render: (c) => (
                <span>
                  {c.name}
                  {conditions(c) && (
                    <span className="block text-xs text-slate-500">
                      {conditions(c)}
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: "priority",
              label: t("ac.priority"),
              align: "right",
              render: (c) => c.priority ?? "",
            },
            { key: "steps", label: t("ac.steps"), render: (c) => steps(c) },
            {
              key: "active",
              label: t("ac.active"),
              render: (c) => (
                <label className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={!!c.isActive}
                    onChange={(e) =>
                      action
                        .run(
                          () =>
                            api.patch(`/approvals/chains/${c.id}`, {
                              isActive: e.target.checked,
                              version: c.version,
                            }),
                          t("p.saved"),
                        )
                        .then(chains.reload)
                    }
                    aria-label={`${t("ac.active")} ${c.name}`}
                  />
                  {c.isActive ? (
                    <Badge color="green">✓</Badge>
                  ) : (
                    <Badge color="gray">—</Badge>
                  )}
                </label>
              ),
            },
          ]}
        />
      </Panel>
      <Panel title={t("ac.builtIn")}>
        <Table
          rows={chains.data!.builtIn}
          rowKey={(c) => `${c.requestType}-${c.name}`}
          columns={[
            {
              key: "type",
              label: t("ac.requestType"),
              render: (c) => t(`appr.type.${c.requestType}`),
            },
            {
              key: "name",
              label: t("ac.name"),
              render: (c) => (
                <span>
                  {c.name}
                  {conditions(c) && (
                    <span className="block text-xs text-slate-500">
                      {conditions(c)}
                    </span>
                  )}
                </span>
              ),
            },
            { key: "steps", label: t("ac.steps"), render: (c) => steps(c) },
          ]}
        />
      </Panel>
      {adding && (
        <ChainDialog
          types={types}
          onClose={() => setAdding(false)}
          onDone={() => (setAdding(false), chains.reload())}
        />
      )}
    </div>
  );
}

function ChainDialog({
  types,
  onClose,
  onDone,
}: {
  types: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    requestType: types[0] ?? "",
    name: "",
    priority: "10",
    minAmount: "",
    maxAmount: "",
  });
  const [steps, setSteps] = useState<string[]>(["dept_head"]);
  return (
    <Modal title={t("ac.newChain")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const conditions = {
            ...(f.minAmount ? { minAmount: f.minAmount } : {}),
            ...(f.maxAmount ? { maxAmount: f.maxAmount } : {}),
          };
          if (
            await save.run(() =>
              api.post("/approvals/chains", {
                requestType: f.requestType,
                name: f.name,
                priority: Number(f.priority),
                conditions,
                steps: steps.map((approverRule) => ({ approverRule })),
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("ac.requestType")}>
            <Select
              value={f.requestType}
              onChange={(e) => setF({ ...f, requestType: e.target.value })}
              id="chain-type"
            >
              {types.map((x) => (
                <option key={x} value={x}>
                  {t(`appr.type.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("ac.name")}>
            <Input
              required
              maxLength={200}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              id="chain-name"
              placeholder="Claims above Tk 50,000: Dept Head, Accounts, Admin"
            />
          </Field>
          <Field label={t("ac.priority")}>
            <Input
              required
              type="number"
              min={0}
              max={10000}
              value={f.priority}
              onChange={(e) => setF({ ...f, priority: e.target.value })}
              id="chain-priority"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("ac.minAmount")}>
              <Input
                inputMode="decimal"
                value={f.minAmount}
                onChange={(e) => setF({ ...f, minAmount: e.target.value })}
                id="chain-min"
              />
            </Field>
            <Field label={t("ac.maxAmount")}>
              <Input
                inputMode="decimal"
                value={f.maxAmount}
                onChange={(e) => setF({ ...f, maxAmount: e.target.value })}
                id="chain-max"
              />
            </Field>
          </div>
        </div>
        <fieldset className="mb-3">
          <legend className="mb-1 text-sm font-medium text-slate-700">
            {t("ac.steps")}
          </legend>
          {steps.map((s, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <span className="w-16 text-sm text-slate-500">
                {t("ac.step", { n: i + 1 })}
              </span>
              <Select
                aria-label={t("ac.step", { n: i + 1 })}
                value={s}
                onChange={(e) =>
                  setSteps(steps.map((x, j) => (j === i ? e.target.value : x)))
                }
              >
                {RULES.map((r) => (
                  <option key={r} value={r}>
                    {t(`ac.rule.${r}`)}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                className="text-red-700"
                disabled={steps.length === 1}
                onClick={() => setSteps(steps.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setSteps([...steps, "role:admin"])}
          >
            {t("ac.addStep")}
          </Button>
        </fieldset>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("ac.newChain")}
        />
      </form>
    </Modal>
  );
}
