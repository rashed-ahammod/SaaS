"use client";
/** One Gate 1 comparison: every employee, explanations of differences, acceptance by Accounts. */
import { use, useState } from "react";
import {
  ActionMessage,
  Detail,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Stat,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  Alert,
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatMonth, formatTaka, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ComparisonLine, ComparisonSummary } from "@/lib/portal-types";

const OUTCOME_COLOR = {
  match: "green",
  different: "amber",
  missing_in_erp: "red",
  missing_in_legacy: "red",
} as const;

export default function ComparisonPage({
  params,
}: PageProps<"/portal/gate-1/[id]">) {
  const { id } = use(params);
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const cmp = useApi<ComparisonSummary & { lines: ComparisonLine[] }>(
    `/parallel-comparisons/${id}`,
  );
  const [explaining, setExplaining] = useState<ComparisonLine | null>(null);
  const [accepting, setAccepting] = useState(false);

  if (cmp.loading && !cmp.data) return <Loading />;
  if (cmp.error) return <ErrorBox error={cmp.error} onRetry={cmp.reload} />;
  const c = cmp.data!;
  const open = c.status === "open";
  const figures = Object.keys(c.totals.legacy);
  const figure = (row: Record<string, string> | null, f: string) =>
    row?.[f] !== undefined ? formatTaka(row[f], lang) : "—";

  return (
    <div>
      <PageHeader
        title={`${t("p.g1.title")}: ${formatMonth(c.period, lang)}`}
        subtitle={c.fileName}
        actions={
          open &&
          can("payroll.verify") && (
            <Button onClick={() => setAccepting(true)}>
              {t("p.g1.accept")}
            </Button>
          )
        }
      />
      {c.outdated && <Alert kind="warning">{t("p.g1.outdated")}</Alert>}
      {c.status === "accepted" && (
        <Alert kind="success">
          {t("p.g1.accepted")} {c.acceptanceNote ?? ""}
        </Alert>
      )}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t("p.g1.matched")}
          value={num(c.matched, lang)}
          tone="good"
        />
        <Stat
          label={t("p.g1.different")}
          value={num(c.different, lang)}
          tone={c.different ? "warn" : "default"}
        />
        <Stat
          label={t("p.g1.missingInErp")}
          value={num(c.missingInErp, lang)}
          tone={c.missingInErp ? "warn" : "default"}
        />
        <Stat
          label={t("p.g1.missingInLegacy")}
          value={num(c.missingInLegacy, lang)}
          tone={c.missingInLegacy ? "warn" : "default"}
        />
      </div>
      <Panel title={t("p.g1.totals")}>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {figures.map((f) => (
            <Detail key={f} label={f}>
              {t("p.g1.legacy")}: {formatTaka(c.totals.legacy[f], lang)}
              <br />
              {t("p.g1.erp")}: {formatTaka(c.totals.erp[f], lang)}
            </Detail>
          ))}
        </dl>
      </Panel>
      <Panel>
        <Table
          rows={c.lines}
          rowKey={(l) => l.employeeCode}
          columns={[
            {
              key: "employeeCode",
              label: t("p.code"),
              className: "font-mono whitespace-nowrap",
            },
            {
              key: "outcome",
              label: t("p.status"),
              render: (l) => (
                <Badge color={OUTCOME_COLOR[l.outcome]}>
                  {t(`p.g1.outcome.${l.outcome}`)}
                </Badge>
              ),
            },
            ...figures.map((f) => ({
              key: f,
              label: f,
              align: "right" as const,
              render: (l: ComparisonLine) => (
                <span
                  className={
                    l.differences[f] ? "font-semibold text-amber-800" : ""
                  }
                >
                  {figure(l.legacy, f)}
                  <br />
                  <span className="text-xs text-slate-500">
                    {figure(l.erp, f)}
                  </span>
                </span>
              ),
            })),
            {
              key: "explanation",
              label: t("p.g1.explanation"),
              render: (l) => l.explanation ?? "",
            },
            {
              key: "act",
              label: "",
              align: "right",
              render: (l) =>
                l.outcome !== "match" && open && can("payroll.prepare") ? (
                  <Button
                    variant={l.explanation ? "ghost" : "secondary"}
                    className="min-h-8 px-2 py-1 text-sm"
                    onClick={() => setExplaining(l)}
                  >
                    {t("p.g1.explain")}
                  </Button>
                ) : null,
            },
          ]}
        />
        <p className="mt-2 text-xs text-slate-500">
          {t("p.g1.legacy")} /{" "}
          <span className="text-slate-400">{t("p.g1.erp")}</span>
        </p>
      </Panel>
      {explaining && (
        <Explain
          comparisonId={id}
          line={explaining}
          onClose={() => setExplaining(null)}
          onDone={cmp.reload}
        />
      )}
      {accepting && (
        <Accept
          comparisonId={id}
          onClose={() => setAccepting(false)}
          onDone={cmp.reload}
        />
      )}
    </div>
  );
}

function Explain({
  comparisonId,
  line,
  onClose,
  onDone,
}: {
  comparisonId: string;
  line: ComparisonLine;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [text, setText] = useState(line.explanation ?? "");
  return (
    <Modal
      title={`${t("p.g1.explain")}: ${line.employeeCode}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(
                `/parallel-comparisons/${comparisonId}/lines/${encodeURIComponent(line.employeeCode)}/explain`,
                { explanation: text },
              ),
            )
          ) {
            onClose();
            onDone();
          }
        }}
      >
        <ActionMessage action={save} />
        {Object.keys(line.differences).length > 0 && (
          <p className="mb-2 text-sm text-slate-600">
            {t("p.g1.diff")}:{" "}
            {Object.entries(line.differences)
              .map(([k, v]) => `${k} ${v}`)
              .join(", ")}
          </p>
        )}
        <Field label={t("p.g1.explanation")}>
          <Input
            required
            maxLength={1000}
            placeholder={t("p.g1.explainHint")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function Accept({
  comparisonId,
  onClose,
  onDone,
}: {
  comparisonId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [note, setNote] = useState("");
  return (
    <Modal title={t("p.g1.accept")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(
                `/parallel-comparisons/${comparisonId}/accept`,
                note ? { note } : {},
              ),
            )
          ) {
            onClose();
            onDone();
          }
        }}
      >
        <ActionMessage action={save} />
        <p className="mb-3 text-sm text-slate-600">{t("p.g1.acceptHint")}</p>
        <Field label={t("p.note")}>
          <Input
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("p.g1.accept")}
        />
      </form>
    </Modal>
  );
}
