"use client";
/** Gate 1: where the company stands, and uploading the old system's register for a run. */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import {
  ActionMessage,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, saveDownload, useApi } from "@/lib/api";
import { formatDate, formatMonth, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ComparisonSummary, Gate1, RunSummary } from "@/lib/portal-types";

export default function Gate1Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Gate1View />
    </Suspense>
  );
}

function Gate1View() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const gate = useApi<Gate1>(
    company ? `/companies/${company.id}/gate-1` : null,
  );
  const runs = useApi<RunSummary[]>(
    company ? `/companies/${company.id}/payroll-runs` : null,
  );
  const preselected = useSearchParams().get("runId") ?? "";
  const [runId, setRunId] = useState(preselected);
  const [tolerance, setTolerance] = useState("0.00");
  const [file, setFile] = useState<File | null>(null);
  const upload = useAction();
  const template = useAction();
  const comparable =
    runs.data?.filter(
      (r) =>
        r.runType === "regular" && !["draft", "cancelled"].includes(r.state),
    ) ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !runId) return;
    const form = new FormData();
    form.set("file", file);
    form.set("tolerance", tolerance);
    const res = await upload.run(() =>
      api.upload<ComparisonSummary>(
        `/payroll-runs/${runId}/parallel-comparisons`,
        form,
      ),
    );
    if (res) router.push(`/portal/gate-1/${res.id}`);
  }

  const g = gate.data;
  return (
    <div>
      <PageHeader title={t("p.g1.title")} subtitle={t("p.g1.intro")} />
      {g && (
        <Alert kind={g.gate1Passed ? "success" : "info"}>
          {g.gate1Passed
            ? t("p.g1.passed", {
                months: g.acceptedMonths
                  .map((m) => formatMonth(m, lang))
                  .join(", "),
              })
            : t("p.g1.notYet", {
                n: num(g.acceptedMonths.length, lang),
                required: num(g.requiredMonths, lang),
              })}
        </Alert>
      )}
      {can("payroll.prepare") && (
        <Panel
          title={t("p.g1.compare")}
          actions={
            <Button
              variant="ghost"
              onClick={() =>
                template.run(async () =>
                  saveDownload(
                    await api.file("/parallel-comparisons/template"),
                    "payroll-register-template.csv",
                  ),
                )
              }
            >
              {t("p.g1.template")}
            </Button>
          }
        >
          <ActionMessage action={upload} />
          <form
            onSubmit={submit}
            className="grid items-end gap-x-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Field label={t("p.g1.run")}>
              <Select
                required
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
              >
                <option value="">—</option>
                {comparable.map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatMonth(r.period, lang)} ·{" "}
                    {t(`p.run.state.${r.state}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("p.g1.tolerance")}>
              <Input
                inputMode="decimal"
                pattern="\d{1,4}(\.\d{1,2})?"
                value={tolerance}
                onChange={(e) => setTolerance(e.target.value)}
              />
            </Field>
            <Field label={t("p.file")}>
              <input
                type="file"
                required
                accept=".xlsx,.csv"
                aria-label={t("p.file")}
                className="block w-full text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <div className="mb-3">
              <Button type="submit" busy={upload.busy} className="w-full">
                {t("p.upload")}
              </Button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title={t("p.g1.comparisons")}>
        <Table
          rows={g?.comparisons}
          rowKey={(c) => c.id}
          onRowClick={(c) => router.push(`/portal/gate-1/${c.id}`)}
          columns={[
            {
              key: "period",
              label: t("p.period"),
              render: (c) => formatMonth(c.period, lang),
            },
            {
              key: "file",
              label: t("p.file"),
              render: (c) => <span className="text-xs">{c.fileName}</span>,
            },
            {
              key: "matched",
              label: t("p.g1.matched"),
              align: "right",
              render: (c) => num(c.matched, lang),
            },
            {
              key: "different",
              label: t("p.g1.different"),
              align: "right",
              render: (c) => num(c.different, lang),
            },
            {
              key: "missing",
              label: `${t("p.g1.missingInErp")} / ${t("p.g1.missingInLegacy")}`,
              align: "right",
              render: (c) =>
                `${num(c.missingInErp, lang)} / ${num(c.missingInLegacy, lang)}`,
            },
            {
              key: "status",
              label: t("p.status"),
              render: (c) => (
                <span className="flex gap-1">
                  <Badge color={c.status === "accepted" ? "green" : "amber"}>
                    {t(`p.g1.status.${c.status}`)}
                  </Badge>
                  {c.outdated && <Badge color="red">!</Badge>}
                </span>
              ),
            },
            {
              key: "created",
              label: t("p.date"),
              render: (c) =>
                formatDate(c.createdAt.slice(0, 10), lang, { short: true }),
            },
          ]}
        />
      </Panel>
    </div>
  );
}
