"use client";
/** Payroll setup: company payroll settings, salary heads, salary structures. */
import { useState } from "react";
import {
  ActionMessage,
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

interface Settings {
  roundingIncrement: "0.01" | "1";
  unpaidDayBasis: "calendar" | "fixed30" | "fixed26";
  otHoursBasis: number;
  otMonthlyLimitHours: number;
  pfEmployeePercent: string;
  pfEmployerPercent: string;
  netChangeFlagPercent: number;
}

export default function PayrollSetupPage() {
  const { t, lang } = useI18n();
  const { company } = usePortal();
  const c = company ? `/companies/${company.id}` : null;
  const settings = useApi<Settings>(c && `${c}/payroll-settings`);
  const heads = useApi<{
    heads: Array<{
      id: string;
      code: string;
      nameEn: string;
      nameBn: string | null;
      kind: string;
      taxable: boolean;
    }>;
    systemHeads: Array<{ code: string; kind: string; taxable: boolean }>;
  }>(c && `${c}/salary-heads`);
  const structures = useApi<
    Array<{
      id: string;
      code: string;
      name: string;
      rules: Array<Record<string, string | boolean>>;
    }>
  >(c && `${c}/salary-structures`);
  const save = useAction();
  const defaults = useAction();
  const [edit, setEdit] = useState<Partial<Settings>>({});

  if (settings.error) return <ErrorBox error={settings.error} />;
  if (!settings.data) return <Loading />;
  const s = { ...settings.data, ...edit };
  const set =
    <K extends keyof Settings>(k: K) =>
    (e: { target: { value: string } }) =>
      setEdit({
        ...edit,
        [k]: (typeof settings.data![k] === "number"
          ? Number(e.target.value)
          : e.target.value) as Settings[K],
      });

  return (
    <div>
      <PageHeader title={t("p.setup.title")} />
      {company && <PfInterestPanel companyId={company.id} />}
      <Panel title={t("p.setup.settings")}>
        <ActionMessage action={save} />
        <form
          className="grid items-end gap-x-4 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await save.run(
                () => api.put(`${c}/payroll-settings`, edit),
                t("p.saved"),
              )
            ) {
              setEdit({});
              settings.reload();
            }
          }}
        >
          <Field label={t("p.setup.rounding")}>
            <Select
              value={s.roundingIncrement}
              onChange={set("roundingIncrement")}
            >
              <option value="0.01">0.01</option>
              <option value="1">1</option>
            </Select>
          </Field>
          <Field label={t("p.setup.unpaidBasis")}>
            <Select value={s.unpaidDayBasis} onChange={set("unpaidDayBasis")}>
              <option value="calendar">calendar</option>
              <option value="fixed30">fixed30</option>
              <option value="fixed26">fixed26</option>
            </Select>
          </Field>
          <Field label={t("p.setup.otBasis")}>
            <Input
              type="number"
              min={1}
              value={s.otHoursBasis}
              onChange={set("otHoursBasis")}
            />
          </Field>
          <Field label={t("p.setup.otLimit")}>
            <Input
              type="number"
              min={0}
              value={s.otMonthlyLimitHours}
              onChange={set("otMonthlyLimitHours")}
            />
          </Field>
          <Field label={t("p.setup.pfEmployee")}>
            <Input
              inputMode="decimal"
              value={s.pfEmployeePercent}
              onChange={set("pfEmployeePercent")}
            />
          </Field>
          <Field label={t("p.setup.pfEmployer")}>
            <Input
              inputMode="decimal"
              value={s.pfEmployerPercent}
              onChange={set("pfEmployerPercent")}
            />
          </Field>
          <Field label={t("p.setup.netChange")}>
            <Input
              type="number"
              min={1}
              value={s.netChangeFlagPercent}
              onChange={set("netChangeFlagPercent")}
            />
          </Field>
          <div className="mb-3">
            <Button
              type="submit"
              busy={save.busy}
              disabled={!Object.keys(edit).length}
              className="w-full"
            >
              {t("p.save")}
            </Button>
          </div>
        </form>
      </Panel>
      <Panel
        title={t("p.setup.heads")}
        actions={
          !heads.data?.heads.length && (
            <Button
              busy={defaults.busy}
              onClick={() =>
                defaults
                  .run(
                    () => api.post(`${c}/salary-heads/defaults`),
                    t("p.done"),
                  )
                  .then(() => (heads.reload(), structures.reload()))
              }
            >
              {t("p.setup.headsDefaults")}
            </Button>
          )
        }
      >
        <ActionMessage action={defaults} />
        <Table
          rows={[
            ...(heads.data?.heads ?? []),
            ...(heads.data?.systemHeads ?? []).map((h) => ({
              ...h,
              id: h.code,
              nameEn: "(system)",
              nameBn: null,
            })),
          ]}
          rowKey={(h) => h.id}
          columns={[
            { key: "code", label: t("p.code"), className: "font-mono" },
            {
              key: "name",
              label: t("p.name"),
              render: (h) =>
                lang === "bn" ? (h.nameBn ?? h.nameEn) : h.nameEn,
            },
            { key: "kind", label: t("p.setup.kind") },
            {
              key: "taxable",
              label: t("p.setup.taxable"),
              render: (h) => (h.taxable ? t("p.yes") : t("p.no")),
            },
          ]}
        />
      </Panel>
      <Panel title={t("p.setup.structures")}>
        <Table
          rows={structures.data}
          rowKey={(s) => s.id}
          columns={[
            { key: "code", label: t("p.code"), className: "font-mono" },
            { key: "name", label: t("p.name") },
            {
              key: "rules",
              label: t("p.setup.rules"),
              render: (s) => (
                <span className="flex flex-wrap gap-1">
                  {s.rules.map((r, i) => (
                    <Badge key={i}>
                      {r.percent
                        ? `${r.head} ${r.percent}% of ${r.of}`
                        : r.fixed
                          ? `${r.head} ${r.fixed}`
                          : `${r.head} = rest`}
                    </Badge>
                  ))}
                </span>
              ),
            },
          ]}
        />
      </Panel>
    </div>
  );
}

/** PF interest for a fiscal year: the rate the trustees declared, on each member's 30 June balance. */
function PfInterestPanel({ companyId }: { companyId: string }) {
  const { t } = useI18n();
  const action = useAction();
  const [f, setF] = useState({ fiscalYear: "2025-26", ratePercent: "" });
  return (
    <Panel title={t("pf2.interest")}>
      <p className="mb-3 text-sm text-slate-600">{t("pf2.interestHint")}</p>
      <ActionMessage action={action} />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await action.run(async () => {
            const r = await api.post<{
              total: string;
              members: number;
              voucherNumber: string;
            }>(`/companies/${companyId}/pf-interest`, f);
            return r;
          }, t("p.done"));
        }}
      >
        <Field label={t("pf2.fiscalYear")}>
          <Input
            required
            pattern="\d{4}-\d{2}"
            value={f.fiscalYear}
            onChange={(e) => setF({ ...f, fiscalYear: e.target.value })}
            id="pf-interest-year"
          />
        </Field>
        <Field label={t("pf2.rate")}>
          <Input
            required
            inputMode="decimal"
            value={f.ratePercent}
            onChange={(e) => setF({ ...f, ratePercent: e.target.value })}
            id="pf-interest-rate"
          />
        </Field>
        <div className="mb-3">
          <Button type="submit" busy={action.busy}>
            {t("pf2.credit")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
