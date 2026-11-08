"use client";
/** Tax deducted at source: what waits to be deposited (by month), challans, certificates, salary tax challans, and the settings and rates. */
import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  ActionMessage,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Table,
  Tabs,
  useAction,
} from "@/components/portal/kit";
import { AccountSelect, Taka, useAccounts } from "@/components/portal/finance";
import { CHALLAN_STATE_COLOR } from "@/components/portal/labels";
import { usePortal } from "@/components/portal/portal-context";
import { SalaryTax } from "@/components/portal/salary-tax";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  ErrorBox,
  Field,
  Input,
  Loading,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type {
  Category,
  Certificate,
  Challan,
  PayablesSettings,
  Withholdings,
} from "@/lib/finance-types";
import { dhakaToday, formatDate, formatMonth, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Tab = "waiting" | "challans" | "certificates" | "salary" | "settings";

export default function TaxPage() {
  const { t } = useI18n();
  const { company } = usePortal();
  const [tab, setTab] = useState<Tab>("waiting");
  if (!company) return null;
  return (
    <div>
      <PageHeader title={t("f.t.title")} subtitle={company.legalName} />
      <Tabs<Tab>
        tabs={[
          { key: "waiting", label: t("f.t.tab.waiting") },
          { key: "challans", label: t("f.t.tab.challans") },
          { key: "certificates", label: t("f.t.tab.certificates") },
          { key: "salary", label: t("py.ch.tab") },
          { key: "settings", label: t("f.t.tab.settings") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "waiting" && <Waiting companyId={company.id} />}
      {tab === "challans" && <Challans companyId={company.id} />}
      {tab === "certificates" && <Certificates companyId={company.id} />}
      {tab === "salary" && <SalaryTax companyId={company.id} />}
      {tab === "settings" && <Settings companyId={company.id} />}
    </div>
  );
}

function Waiting({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const open = useApi<Withholdings>(
    `/companies/${companyId}/tax-withholdings?deposited=false`,
  );
  const [depositing, setDepositing] = useState<{
    taxType: "tds" | "vds";
    period: string;
    amount: number;
  } | null>(null);
  if (open.loading && !open.data) return <Loading />;
  if (open.error) return <ErrorBox error={open.error} onRetry={open.reload} />;

  // one row per tax and month, the amount waiting (in a pending challan or not yet)
  const groups = new Map<
    string,
    {
      taxType: "tds" | "vds";
      period: string;
      amount: number;
      count: number;
      pending: boolean;
    }
  >();
  for (const w of open.data!.items) {
    const key = `${w.taxType}-${w.period}`;
    const g = groups.get(key) ?? {
      taxType: w.taxType,
      period: w.period,
      amount: 0,
      count: 0,
      pending: false,
    };
    g.amount += Number(w.amount);
    g.count += 1;
    g.pending ||= w.challanState === "in_approval";
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort(
    (a, b) =>
      a.period.localeCompare(b.period) || a.taxType.localeCompare(b.taxType),
  );

  return (
    <>
      <Panel>
        <Table
          rows={rows}
          rowKey={(r) => `${r.taxType}-${r.period}`}
          columns={[
            {
              key: "type",
              label: t("f.v.type"),
              render: (r) =>
                r.taxType === "tds" ? t("f.t.tds") : t("f.t.vds"),
            },
            {
              key: "period",
              label: t("f.t.month"),
              render: (r) => formatMonth(r.period, lang),
            },
            {
              key: "count",
              label: t("f.b.title"),
              align: "right",
              render: (r) => num(r.count, lang),
            },
            {
              key: "amount",
              label: t("p.amount"),
              align: "right",
              render: (r) => <Taka value={r.amount} />,
            },
            {
              key: "actions",
              label: "",
              align: "right",
              render: (r) =>
                r.pending ? (
                  <Badge color="amber">{t("f.t.state.in_approval")}</Badge>
                ) : can("payables.tax") ? (
                  <Button variant="secondary" onClick={() => setDepositing(r)}>
                    {t("f.t.newChallan")}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Panel>
      <Panel title={t("f.b.withheld")}>
        <Table
          rows={open.data!.items}
          rowKey={(w) => w.id}
          columns={[
            {
              key: "date",
              label: t("p.date"),
              render: (w) => formatDate(w.deductedOn, lang, { short: true }),
            },
            {
              key: "vendor",
              label: t("f.b.vendor"),
              render: (w) => `${w.vendorCode} · ${w.vendorName}`,
            },
            { key: "tin", label: "TIN", render: (w) => w.vendorTin ?? "—" },
            { key: "bill", label: t("f.b.billNo"), render: (w) => w.billNo },
            {
              key: "type",
              label: t("f.v.type"),
              render: (w) => w.taxType.toUpperCase(),
            },
            {
              key: "rate",
              label: "%",
              align: "right",
              render: (w) => num(Number(w.percent), lang),
            },
            {
              key: "amount",
              label: t("p.amount"),
              align: "right",
              render: (w) => <Taka value={w.amount} />,
            },
          ]}
        />
      </Panel>
      {depositing && (
        <NewChallan
          companyId={companyId}
          group={depositing}
          onClose={() => setDepositing(null)}
          onDone={() => (setDepositing(null), open.reload())}
        />
      )}
    </>
  );
}

function NewChallan({
  companyId,
  group,
  onClose,
  onDone,
}: {
  companyId: string;
  group: { taxType: "tds" | "vds"; period: string; amount: number };
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const { postable } = useAccounts(companyId);
  const [f, setF] = useState({
    challanNo: "",
    challanDate: dhakaToday(),
    paidFromAccountId: "",
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      await save.run(
        () =>
          api.post(`/companies/${companyId}/tax-challans`, {
            taxType: group.taxType,
            period: group.period,
            ...f,
          }),
        t("f.t.challanSent"),
      )
    )
      onDone();
  }
  return (
    <Modal
      title={`${t("f.t.newChallan")}: ${group.taxType === "tds" ? t("f.t.tds") : t("f.t.vds")}, ${formatMonth(group.period, lang)}`}
      open
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <p className="mb-3 text-lg font-semibold">
          <Taka value={group.amount} />
        </p>
        <Field label={t("f.t.challanNo")}>
          <Input
            required
            maxLength={60}
            value={f.challanNo}
            onChange={(e) => setF({ ...f, challanNo: e.target.value })}
            id="challan-no"
          />
        </Field>
        <Field label={t("f.t.challanDate")}>
          <Input
            type="date"
            required
            value={f.challanDate}
            onChange={(e) => setF({ ...f, challanDate: e.target.value })}
            id="challan-date"
          />
        </Field>
        <Field label={t("f.b.payFrom")}>
          <AccountSelect
            accounts={postable}
            filter={(a) => a.role === "bank" || a.role === "cash"}
            value={f.paidFromAccountId}
            onChange={(paidFromAccountId) => setF({ ...f, paidFromAccountId })}
            required
            id="challan-from"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("f.t.newChallan")}
        />
      </form>
    </Modal>
  );
}

function Challans({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const challans = useApi<Challan[]>(`/companies/${companyId}/tax-challans`);
  if (challans.loading && !challans.data) return <Loading />;
  if (challans.error)
    return <ErrorBox error={challans.error} onRetry={challans.reload} />;
  return (
    <Panel>
      <Table
        rows={challans.data}
        rowKey={(c) => c.id}
        columns={[
          { key: "no", label: t("f.t.challanNo"), render: (c) => c.challanNo },
          {
            key: "type",
            label: t("f.v.type"),
            render: (c) => (c.taxType === "tds" ? t("f.t.tds") : t("f.t.vds")),
          },
          {
            key: "period",
            label: t("f.t.month"),
            render: (c) => formatMonth(c.period, lang),
          },
          {
            key: "date",
            label: t("f.t.challanDate"),
            render: (c) => formatDate(c.challanDate, lang, { short: true }),
          },
          {
            key: "state",
            label: t("p.status"),
            render: (c) => (
              <Badge color={CHALLAN_STATE_COLOR[c.state]}>
                {t(`f.t.state.${c.state}`)}
              </Badge>
            ),
          },
          {
            key: "voucher",
            label: t("f.v.number"),
            render: (c) =>
              c.voucherId ? (
                <Link
                  className="font-mono text-xs text-emerald-800 hover:underline"
                  href={`/portal/finance/vouchers/${c.voucherId}`}
                >
                  {c.voucherNumber}
                </Link>
              ) : (
                ""
              ),
          },
          {
            key: "amount",
            label: t("p.amount"),
            align: "right",
            render: (c) => <Taka value={c.amount} />,
          },
          {
            key: "approval",
            label: "",
            render: (c) =>
              c.state === "in_approval" && c.approvalRequestId ? (
                <ButtonLink
                  variant="ghost"
                  href={`/portal/approvals/${c.approvalRequestId}`}
                >
                  {t("p.run.openApproval")}
                </ButtonLink>
              ) : null,
          },
        ]}
      />
    </Panel>
  );
}

function Certificates({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const certs = useApi<Certificate[]>(
    `/companies/${companyId}/tax-certificates`,
  );
  if (certs.loading && !certs.data) return <Loading />;
  if (certs.error)
    return <ErrorBox error={certs.error} onRetry={certs.reload} />;
  return (
    <Panel>
      <Table
        rows={certs.data}
        rowKey={(c) => c.id}
        columns={[
          {
            key: "number",
            label: t("f.v.number"),
            render: (c) => (
              <Link
                className="font-mono text-xs text-emerald-800 hover:underline"
                href={`/portal/tax/certificates/${c.id}`}
              >
                {c.number}
              </Link>
            ),
          },
          {
            key: "vendor",
            label: t("f.b.vendor"),
            render: (c) => `${c.vendorCode} · ${c.vendorName}`,
          },
          {
            key: "period",
            label: t("p.period"),
            render: (c) =>
              `${formatDate(c.periodFrom, lang, { short: true })} – ${formatDate(c.periodTo, lang, { short: true })}`,
          },
          {
            key: "amount",
            label: t("p.amount"),
            align: "right",
            render: (c) => <Taka value={c.amount} />,
          },
        ]}
      />
    </Panel>
  );
}

function Settings({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const settings = useApi<PayablesSettings>(
    `/companies/${companyId}/payables-settings`,
  );
  const cats = useApi<{
    pack: string;
    noTinSurchargePercent: string;
    categories: Category[];
  }>(`/companies/${companyId}/withholding-categories`);
  const save = useAction();
  if (settings.loading && !settings.data) return <Loading />;
  if (settings.error)
    return <ErrorBox error={settings.error} onRetry={settings.reload} />;
  const s = settings.data!;
  const update = (patch: Partial<PayablesSettings>) =>
    save
      .run(
        () =>
          api.put(`/companies/${companyId}/payables-settings`, {
            vatWithholdingEntity: s.vatWithholdingEntity,
            defaultPaymentTermsDays: s.defaultPaymentTermsDays,
            ...patch,
          }),
        t("p.saved"),
      )
      .then((ok) => ok && settings.reload());
  return (
    <>
      <Panel>
        <ActionMessage action={save} />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!can("payables.tax") || save.busy}
            checked={s.vatWithholdingEntity}
            onChange={(e) => update({ vatWithholdingEntity: e.target.checked })}
            id="vds-entity"
          />
          {t("f.t.vdsEntity")}
        </label>
        <p className="mt-3 text-sm text-slate-600">
          {t("f.t.terms")}: {num(s.defaultPaymentTermsDays, lang)}
        </p>
      </Panel>
      {cats.data && (
        <Panel title={t("f.t.rates", { pack: cats.data.pack })}>
          <Alert kind="warning">{t("f.t.placeholder")}</Alert>
          <div className="mt-3">
            <Table
              rows={cats.data.categories}
              rowKey={(c) => c.code}
              columns={[
                {
                  key: "code",
                  label: t("p.code"),
                  render: (c) => (
                    <span className="font-mono text-xs">{c.code}</span>
                  ),
                },
                {
                  key: "name",
                  label: t("p.name"),
                  render: (c) =>
                    lang === "bn" && c.nameBn ? c.nameBn : c.nameEn,
                },
                {
                  key: "section",
                  label: "",
                  render: (c) => (
                    <span className="text-xs text-slate-500">{c.section}</span>
                  ),
                },
                {
                  key: "rate",
                  label: t("f.t.rate"),
                  render: (c) =>
                    c.tdsSlabs
                      ? c.tdsSlabs
                          .map(
                            (s) =>
                              `${s.upTo ? `≤ ৳${num(Number(s.upTo), lang)}` : ">"}: ${num(Number(s.percent), lang)}%`,
                          )
                          .join(" · ")
                      : `${num(Number(c.tdsPercent), lang)}%`,
                },
                {
                  key: "vds",
                  label: t("f.t.vdsShare"),
                  align: "right",
                  render: (c) =>
                    `${num(Number(c.vdsShareOfVatPercent), lang)}%`,
                },
              ]}
            />
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {t("f.t.noTin", {
              n: num(Number(cats.data.noTinSurchargePercent), lang),
            })}
          </p>
        </Panel>
      )}
    </>
  );
}
