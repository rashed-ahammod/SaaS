"use client";
/** Data migration (WP8): templates, upload + check, the uploads, reconciliation and the Admin's sign-off. */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ActionMessage,
  Detail,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { api, saveDownload, useApi } from "@/lib/api";
import { dhakaNow, formatDate, formatTaka, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Batch } from "@/lib/portal-types";

interface Template {
  entity: string;
  order: number;
  title: string;
  description: string;
}

interface Reconciliation {
  headcount: number;
  totalGross: string;
  employeesWithoutSalary: number;
  departments: Array<{
    department: string;
    headcount: number;
    withSalary: number;
    gross: string;
  }>;
}

const firstOfMonth = () => {
  const d = dhakaNow();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

export default function MigrationPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const c = company ? `/companies/${company.id}` : null;
  const templates = useApi<Template[]>(
    can("data.import") ? "/imports/templates" : null,
  );
  const batches = useApi<Batch[]>(c && `${c}/imports`);
  const [entity, setEntity] = useState("employees");
  const [cutOverDate, setCutOver] = useState(firstOfMonth());
  const [file, setFile] = useState<File | null>(null);
  const upload = useAction();
  const download = useAction();
  const recon = useApi<Reconciliation>(
    c && `${c}/migration/reconciliation?cutOverDate=${cutOverDate}`,
  );
  const signoffs = useApi<
    Array<{ id: string; cutOverDate: string; note: string; signedAt: string }>
  >(c && `${c}/migration/sign-offs`);
  const sign = useAction();
  const [note, setNote] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("entity", entity);
    form.set("cutOverDate", cutOverDate);
    const batch = await upload.run(() =>
      api.upload<Batch>(`${c}/imports`, form),
    );
    if (batch) router.push(`/portal/migration/${batch.id}`);
  }

  return (
    <div>
      <PageHeader title={t("p.mig.title")} subtitle={t("p.mig.intro")} />
      {templates.data && (
        <Panel title={t("p.mig.templates")}>
          <ActionMessage action={download} />
          <Table
            rows={[...templates.data].sort((a, b) => a.order - b.order)}
            rowKey={(x) => x.entity}
            columns={[
              { key: "order", label: "#", render: (x) => num(x.order, lang) },
              {
                key: "title",
                label: t("p.mig.entity"),
                render: (x) => <span className="font-medium">{x.title}</span>,
              },
              {
                key: "description",
                label: "",
                render: (x) => (
                  <span className="text-xs text-slate-500">
                    {x.description}
                  </span>
                ),
              },
              {
                key: "dl",
                label: "",
                align: "right",
                render: (x) => (
                  <span className="flex justify-end gap-1">
                    {(["xlsx", "csv"] as const).map((fmt) => (
                      <Button
                        key={fmt}
                        variant="ghost"
                        className="min-h-8 px-2 py-1 text-sm"
                        onClick={() =>
                          download.run(async () =>
                            saveDownload(
                              await api.file(
                                `/imports/templates/${x.entity}?format=${fmt}`,
                              ),
                              `${x.entity}.${fmt}`,
                            ),
                          )
                        }
                      >
                        {fmt.toUpperCase()}
                      </Button>
                    ))}
                  </span>
                ),
              },
            ]}
          />
        </Panel>
      )}
      {can("data.import") && (
        <Panel title={t("p.mig.upload")}>
          <ActionMessage action={upload} />
          <form
            onSubmit={submit}
            className="grid items-end gap-x-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Field label={t("p.mig.entity")}>
              <Select
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
              >
                {templates.data
                  ?.sort((a, b) => a.order - b.order)
                  .map((x) => (
                    <option key={x.entity} value={x.entity}>
                      {x.title}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label={t("p.mig.cutOver")}>
              <Input
                type="date"
                required
                value={cutOverDate}
                onChange={(e) => setCutOver(e.target.value)}
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
                {t("p.mig.upload")}
              </Button>
            </div>
          </form>
        </Panel>
      )}
      <Panel title={t("p.mig.batches")}>
        <Table
          rows={batches.data}
          rowKey={(b) => b.id}
          onRowClick={(b) => router.push(`/portal/migration/${b.id}`)}
          columns={[
            { key: "entity", label: t("p.mig.entity") },
            {
              key: "file",
              label: t("p.file"),
              render: (b) => <span className="text-xs">{b.fileName}</span>,
            },
            {
              key: "cut",
              label: t("p.mig.cutOver"),
              render: (b) => formatDate(b.cutOverDate, lang, { short: true }),
            },
            {
              key: "rows",
              label: t("p.mig.rows"),
              align: "right",
              render: (b) =>
                `${num(b.counts.valid, lang)} / ${num(b.counts.total, lang)}`,
            },
            {
              key: "errors",
              label: t("p.mig.errors"),
              align: "right",
              render: (b) =>
                b.counts.errors ? (
                  <span className="font-semibold text-red-700">
                    {num(b.counts.errors, lang)}
                  </span>
                ) : (
                  "0"
                ),
            },
            {
              key: "state",
              label: t("p.status"),
              render: (b) => (
                <Badge
                  color={
                    b.state === "committed" || b.state === "signed_off"
                      ? "green"
                      : b.state === "validated"
                        ? "amber"
                        : "gray"
                  }
                >
                  {t(`p.mig.state.${b.state}`)}
                </Badge>
              ),
            },
          ]}
        />
      </Panel>
      <Panel
        title={`${t("p.mig.reconciliation")} · ${formatDate(cutOverDate, lang, { short: true })}`}
      >
        {recon.data && (
          <>
            <dl className="mb-4 grid gap-4 sm:grid-cols-3">
              <Detail label={t("p.mig.headcount")}>
                {num(recon.data.headcount, lang)}
              </Detail>
              <Detail label={t("p.mig.totalGross")}>
                {formatTaka(recon.data.totalGross, lang)}
              </Detail>
              <Detail label={t("p.mig.withoutSalary")}>
                {num(recon.data.employeesWithoutSalary, lang)}
              </Detail>
            </dl>
            <Table
              rows={recon.data.departments}
              rowKey={(d) => d.department}
              columns={[
                { key: "department", label: t("p.department") },
                {
                  key: "headcount",
                  label: t("p.mig.headcount"),
                  align: "right",
                  render: (d) => num(d.headcount, lang),
                },
                {
                  key: "withSalary",
                  label: t("p.emp.sal.current"),
                  align: "right",
                  render: (d) => num(d.withSalary, lang),
                },
                {
                  key: "gross",
                  label: t("p.mig.totalGross"),
                  align: "right",
                  render: (d) => formatTaka(d.gross, lang),
                },
              ]}
            />
          </>
        )}
        {can("data.import.sign_off") && (
          <form
            className="mt-4 flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await sign.run(
                  () =>
                    api.post(`${c}/migration/sign-off`, { cutOverDate, note }),
                  t("p.mig.signed"),
                )
              )
                signoffs.reload();
            }}
          >
            <Field label={t("p.note")}>
              <Input
                required
                maxLength={1000}
                className="min-w-[20rem]"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <div className="mb-3">
              <Button type="submit" busy={sign.busy}>
                {t("p.mig.signOff")}
              </Button>
            </div>
          </form>
        )}
        <ActionMessage action={sign} />
        {!!signoffs.data?.length && (
          <>
            <p className="mt-4 mb-1 text-sm font-semibold text-slate-600">
              {t("p.mig.signoffs")}
            </p>
            <Table
              rows={signoffs.data}
              rowKey={(s) => s.id}
              columns={[
                {
                  key: "cut",
                  label: t("p.mig.cutOver"),
                  render: (s) =>
                    formatDate(s.cutOverDate, lang, { short: true }),
                },
                { key: "note", label: t("p.note") },
                {
                  key: "signed",
                  label: t("p.date"),
                  render: (s) =>
                    formatDate(s.signedAt.slice(0, 10), lang, { short: true }),
                },
              ]}
            />
          </>
        )}
      </Panel>
    </div>
  );
}
