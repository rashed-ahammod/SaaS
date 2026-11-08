"use client";
/** Payroll runs of the selected company; HR starts a new one (monthly, bonus, final settlement). */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ActionMessage,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { RUN_STATE_COLOR } from "@/components/portal/labels";
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
import { dhakaToday, formatMonth, formatTaka, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { EmployeeSummary, Page, RunSummary } from "@/lib/portal-types";

export default function RunsPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const runs = useApi<RunSummary[]>(
    company ? `/companies/${company.id}/payroll-runs` : null,
  );
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title={t("p.run.title")}
        actions={
          can("payroll.prepare") && (
            <Button onClick={() => setCreating(true)}>{t("p.run.new")}</Button>
          )
        }
      />
      <Panel>
        {runs.loading ? (
          <Loading />
        ) : runs.error ? (
          <ErrorBox error={runs.error} onRetry={runs.reload} />
        ) : (
          <Table
            rows={runs.data}
            rowKey={(r) => r.id}
            onRowClick={(r) => router.push(`/portal/payroll/runs/${r.id}`)}
            columns={[
              {
                key: "period",
                label: t("p.period"),
                render: (r) => formatMonth(r.period, lang),
              },
              {
                key: "type",
                label: t("p.run.type"),
                render: (r) =>
                  `${t(`p.run.type.${r.runType}`)}${r.bonusName ? ` · ${r.bonusName}` : ""}`,
              },
              {
                key: "state",
                label: t("p.status"),
                render: (r) => (
                  <Badge color={RUN_STATE_COLOR[r.state]}>
                    {t(`p.run.state.${r.state}`)}
                  </Badge>
                ),
              },
              {
                key: "headcount",
                label: t("p.run.headcount"),
                align: "right",
                render: (r) => num(r.headcount, lang),
              },
              {
                key: "gross",
                label: t("p.run.gross"),
                align: "right",
                render: (r) => formatTaka(r.totals.gross, lang),
              },
              {
                key: "net",
                label: t("p.run.net"),
                align: "right",
                render: (r) => formatTaka(r.totals.net, lang),
              },
            ]}
          />
        )}
      </Panel>
      {creating && company && (
        <NewRun
          companyId={company.id}
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/portal/payroll/runs/${id}`)}
        />
      )}
    </div>
  );
}

function NewRun({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState<Record<string, string>>({
    runType: "regular",
    period: dhakaToday().slice(0, 7),
  });
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const people = useApi<Page<EmployeeSummary>>(
    f.runType === "final_settlement"
      ? `/employees?companyId=${companyId}&status=notice&pageSize=200`
      : null,
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = Object.fromEntries(
      Object.entries(f).filter(([, v]) => v !== ""),
    );
    if (body.noticeShortfallDays)
      body.noticeShortfallDays = Number(body.noticeShortfallDays);
    const run = await save.run(() =>
      api.post<{ id: string }>(`/companies/${companyId}/payroll-runs`, body),
    );
    if (run) onCreated(run.id);
  }

  return (
    <Modal title={t("p.run.new")} open onClose={onClose}>
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <Field label={t("p.run.type")}>
          <Select value={f.runType} onChange={set("runType")}>
            {(["regular", "bonus", "final_settlement"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`p.run.type.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("p.period")}>
          <Input
            type="month"
            required
            value={f.period}
            onChange={set("period")}
          />
        </Field>
        {f.runType === "bonus" && (
          <>
            <Field label={t("p.run.bonusName")}>
              <Input
                required
                maxLength={100}
                value={f.bonusName ?? ""}
                onChange={set("bonusName")}
              />
            </Field>
            <Field label={t("p.run.bonusDate")}>
              <Input
                type="date"
                required
                value={f.bonusDate ?? ""}
                onChange={set("bonusDate")}
              />
            </Field>
            <Field label={t("p.run.festivalGroup")}>
              <Input
                maxLength={30}
                value={f.festivalGroup ?? ""}
                onChange={set("festivalGroup")}
              />
            </Field>
          </>
        )}
        {f.runType === "final_settlement" && (
          <>
            <Field label={t("p.run.settlementEmployee")}>
              <Select
                required
                value={f.employeeId ?? ""}
                onChange={set("employeeId")}
              >
                <option value="">—</option>
                {people.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.employeeCode} · {p.fullNameEn}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("p.run.shortfall")}>
              <Input
                type="number"
                min={0}
                value={f.noticeShortfallDays ?? ""}
                onChange={set("noticeShortfallDays")}
              />
            </Field>
          </>
        )}
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("p.create")}
        />
      </form>
    </Modal>
  );
}
