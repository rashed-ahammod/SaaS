"use client";
/** One vendor: details, bank account (maker-checker), bills, account statement, tax certificates. */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  ActionMessage,
  Detail,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Table,
  Tabs,
  useAction,
} from "@/components/portal/kit";
import { Taka } from "@/components/portal/finance";
import {
  BANK_STATE_COLOR,
  BILL_STATE_COLOR,
  PAY_STATUS_COLOR,
} from "@/components/portal/labels";
import { usePortal } from "@/components/portal/portal-context";
import {
  Alert,
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { BillSummary, Vendor } from "@/lib/finance-types";
import { dhakaToday, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type Tab = "bills" | "statement";

interface StatementData {
  opening: string;
  closing: string;
  lines: Array<{
    voucherId: string;
    number: string;
    date: string;
    narration: string;
    debit: string;
    credit: string;
    balance: string;
  }>;
}

export default function VendorPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  const vendor = useApi<Vendor>(`/vendors/${id}`);
  const bills = useApi<BillSummary[]>(
    company ? `/companies/${company.id}/vendor-bills?vendorId=${id}` : null,
  );
  const statement = useApi<StatementData>(
    `/vendors/${id}/statement?to=${dhakaToday()}`,
  );
  const [tab, setTab] = useState<Tab>("bills");
  const [bankOpen, setBankOpen] = useState(false);
  const [certOpen, setCertOpen] = useState(false);
  const toggle = useAction();

  if (vendor.loading && !vendor.data) return <Loading />;
  if (vendor.error)
    return <ErrorBox error={vendor.error} onRetry={vendor.reload} />;
  const v = vendor.data!;

  return (
    <div>
      <PageHeader
        title={v.name}
        subtitle={`${v.code}${v.nameBn ? ` · ${v.nameBn}` : ""}`}
        actions={
          <>
            {can("payables.manage") && (
              <Button variant="secondary" onClick={() => setBankOpen(true)}>
                {t("f.vd.bankRequest")}
              </Button>
            )}
            {can("payables.tax") && (
              <Button onClick={() => setCertOpen(true)}>
                {t("f.vd.certificate")}
              </Button>
            )}
            {can("payables.manage") && (
              <Button
                variant="ghost"
                busy={toggle.busy}
                onClick={() =>
                  toggle
                    .run(
                      () =>
                        api.patch(`/vendors/${v.id}`, {
                          version: v.version,
                          isActive: !v.isActive,
                        }),
                      t("p.saved"),
                    )
                    .then((ok) => ok && vendor.reload())
                }
              >
                {v.isActive ? t("f.vd.inactive") : t("f.vd.active")}
              </Button>
            )}
          </>
        }
      />
      <ActionMessage action={toggle} />
      <Panel>
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Detail label="TIN">
            {v.tin ?? <Badge color="amber">{t("f.vd.noTin")}</Badge>}
          </Detail>
          <Detail label="BIN">
            {v.bin ?? <Badge color="amber">{t("f.vd.noBin")}</Badge>}
          </Detail>
          <Detail label={t("f.vd.category")}>{v.withholdingCategory}</Detail>
          <Detail label={t("f.vd.terms")}>{v.paymentTermsDays ?? "—"}</Detail>
          <Detail label={t("f.vd.phone")}>{v.phone}</Detail>
          <Detail label={t("f.vd.email")}>{v.email}</Detail>
          <Detail label={t("f.vd.address")}>{v.address}</Detail>
          <Detail label={t("p.status")}>
            <Badge color={v.isActive ? "green" : "gray"}>
              {v.isActive ? t("f.vd.active") : t("f.vd.inactive")}
            </Badge>
          </Detail>
        </dl>
      </Panel>
      <Panel title={t("f.vd.bank")}>
        <Table
          rows={v.bankAccounts}
          rowKey={(b) => b.id}
          columns={[
            {
              key: "bank",
              label: t("f.vd.bankName"),
              render: (b) => b.bankName,
            },
            {
              key: "account",
              label: t("f.vd.accountNumber"),
              render: (b) => <span className="font-mono">{b.account}</span>,
            },
            {
              key: "status",
              label: t("p.status"),
              render: (b) => (
                <Badge
                  color={
                    BANK_STATE_COLOR[
                      b.status as keyof typeof BANK_STATE_COLOR
                    ] ?? "gray"
                  }
                >
                  {t(`f.vd.bankState.${b.status}`)}
                </Badge>
              ),
            },
            {
              key: "approval",
              label: "",
              render: (b) =>
                b.status === "pending" && b.approvalRequestId ? (
                  <Link
                    className="text-sm text-emerald-800 underline"
                    href={`/portal/approvals/${b.approvalRequestId}`}
                  >
                    {t("p.run.openApproval")}
                  </Link>
                ) : null,
            },
          ]}
        />
      </Panel>
      <Tabs<Tab>
        tabs={[
          { key: "bills", label: t("f.b.title") },
          { key: "statement", label: t("f.vd.statement") },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "bills" && (
        <Panel>
          <Table
            rows={bills.data}
            rowKey={(b) => b.id}
            columns={[
              {
                key: "billNo",
                label: t("f.b.billNo"),
                render: (b) => (
                  <Link
                    className="text-emerald-800 hover:underline"
                    href={`/portal/bills/${b.id}`}
                  >
                    {b.billNo}
                  </Link>
                ),
              },
              {
                key: "date",
                label: t("f.b.billDate"),
                render: (b) => formatDate(b.billDate, lang, { short: true }),
              },
              {
                key: "state",
                label: t("p.status"),
                render: (b) => (
                  <Badge color={BILL_STATE_COLOR[b.state]}>
                    {t(`f.b.state.${b.state}`)}
                  </Badge>
                ),
              },
              {
                key: "pay",
                label: "",
                render: (b) =>
                  b.paymentStatus ? (
                    <Badge color={PAY_STATUS_COLOR[b.paymentStatus]}>
                      {t(`f.b.pay.${b.paymentStatus}`)}
                    </Badge>
                  ) : null,
              },
              {
                key: "net",
                label: t("f.b.net"),
                align: "right",
                render: (b) => <Taka value={b.netPayable} />,
              },
              {
                key: "outstanding",
                label: t("f.b.outstanding"),
                align: "right",
                render: (b) => <Taka value={b.outstanding} />,
              },
            ]}
          />
        </Panel>
      )}
      {tab === "statement" && (
        <Panel>
          {statement.data && (
            <>
              <p className="mb-2 text-sm">
                {t("f.r.opening")}: <Taka value={statement.data.opening} />
              </p>
              <Table
                rows={statement.data.lines}
                rowKey={(l) => `${l.voucherId}-${l.balance}`}
                columns={[
                  {
                    key: "date",
                    label: t("p.date"),
                    render: (l) => formatDate(l.date, lang, { short: true }),
                  },
                  {
                    key: "number",
                    label: t("f.v.number"),
                    render: (l) => (
                      <Link
                        className="font-mono text-xs text-emerald-800 hover:underline"
                        href={`/portal/finance/vouchers/${l.voucherId}`}
                      >
                        {l.number}
                      </Link>
                    ),
                  },
                  {
                    key: "narration",
                    label: t("f.v.narration"),
                    render: (l) => (
                      <span className="line-clamp-2">{l.narration}</span>
                    ),
                  },
                  {
                    key: "debit",
                    label: t("f.v.debit"),
                    align: "right",
                    render: (l) =>
                      Number(l.debit) ? <Taka value={l.debit} /> : "",
                  },
                  {
                    key: "credit",
                    label: t("f.v.credit"),
                    align: "right",
                    render: (l) =>
                      Number(l.credit) ? <Taka value={l.credit} /> : "",
                  },
                  {
                    key: "balance",
                    label: t("f.r.balance"),
                    align: "right",
                    render: (l) => <Taka value={l.balance} />,
                  },
                ]}
              />
            </>
          )}
        </Panel>
      )}
      {bankOpen && (
        <BankAccount
          vendorId={v.id}
          onClose={() => setBankOpen(false)}
          onDone={() => (setBankOpen(false), vendor.reload())}
        />
      )}
      {certOpen && (
        <IssueCertificate vendorId={v.id} onClose={() => setCertOpen(false)} />
      )}
    </div>
  );
}

function BankAccount({
  vendorId,
  onClose,
  onDone,
}: {
  vendorId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (
      await save.run(
        () => api.post(`/vendors/${vendorId}/bank-accounts`, f),
        t("f.vd.bankRequested"),
      )
    )
      onDone();
  }
  return (
    <Modal title={t("f.vd.bankRequest")} open onClose={onClose}>
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <Field label={t("f.vd.bankName")}>
          <Input
            required
            maxLength={150}
            placeholder="BRAC Bank PLC"
            value={f.bankName ?? ""}
            onChange={set("bankName")}
            id="vbank-name"
          />
        </Field>
        <Field label={t("f.vd.branch")}>
          <Input
            required
            maxLength={150}
            value={f.branchName ?? ""}
            onChange={set("branchName")}
            id="vbank-branch"
          />
        </Field>
        <Field label={t("f.vd.routing")}>
          <Input
            required
            inputMode="numeric"
            pattern="[0-9]{9}"
            value={f.routingNumber ?? ""}
            onChange={set("routingNumber")}
            id="vbank-routing"
          />
        </Field>
        <Field label={t("f.vd.accountName")}>
          <Input
            required
            maxLength={150}
            value={f.accountName ?? ""}
            onChange={set("accountName")}
            id="vbank-account-name"
          />
        </Field>
        <Field label={t("f.vd.accountNumber")}>
          <Input
            required
            inputMode="numeric"
            pattern="[0-9]{8,20}"
            value={f.accountNumber ?? ""}
            onChange={set("accountNumber")}
            id="vbank-account-number"
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function IssueCertificate({
  vendorId,
  onClose,
}: {
  vendorId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const year = dhakaToday().slice(0, 4);
  const [f, setF] = useState({
    taxType: "tds",
    from: `${Number(dhakaToday().slice(5, 7)) >= 7 ? year : Number(year) - 1}-07-01`,
    to: dhakaToday(),
  });
  const [issued, setIssued] = useState<{ id: string; number: string } | null>(
    null,
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    const c = await save.run(() =>
      api.post<{ id: string; number: string }>(
        `/vendors/${vendorId}/tax-certificates`,
        f,
      ),
    );
    if (c) setIssued(c);
  }
  return (
    <Modal title={t("f.vd.certificate")} open onClose={onClose}>
      {issued ? (
        <>
          <Alert kind="success">
            {t("f.vd.certificateDone", { number: issued.number })}
          </Alert>
          <div className="mt-4 flex justify-end gap-2">
            <Link
              className="font-semibold text-emerald-800 underline"
              href={`/portal/tax/certificates/${issued.id}`}
            >
              {t("p.view")}
            </Link>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <ActionMessage action={save} />
          <Field label={t("f.v.type")}>
            <Select
              value={f.taxType}
              onChange={(e) => setF({ ...f, taxType: e.target.value })}
              id="cert-type"
            >
              <option value="tds">{t("f.t.tds")}</option>
              <option value="vds">{t("f.t.vds")}</option>
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("p.from")}>
              <Input
                type="date"
                required
                value={f.from}
                onChange={(e) => setF({ ...f, from: e.target.value })}
                id="cert-from"
              />
            </Field>
            <Field label={t("p.to")}>
              <Input
                type="date"
                required
                value={f.to}
                onChange={(e) => setF({ ...f, to: e.target.value })}
                id="cert-to"
              />
            </Field>
          </div>
          <FormButtons
            busy={save.busy}
            onCancel={onClose}
            submitLabel={t("p.create")}
          />
        </form>
      )}
    </Modal>
  );
}
