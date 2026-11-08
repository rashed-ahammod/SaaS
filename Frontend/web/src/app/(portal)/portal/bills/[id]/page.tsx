"use client";
/** One vendor bill: amounts, tax at source, journal, payments, the three-way match (bills against a PO); submit, cancel, pay. */
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
  useAction,
} from "@/components/portal/kit";
import { AccountSelect, Taka, useAccounts } from "@/components/portal/finance";
import {
  BILL_STATE_COLOR,
  CHALLAN_STATE_COLOR,
  PAY_STATUS_COLOR,
} from "@/components/portal/labels";
import { usePortal } from "@/components/portal/portal-context";
import { MatchPanel } from "@/components/portal/procurement";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  ErrorBox,
  Field,
  Input,
  Loading,
  Row,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { Bill } from "@/lib/finance-types";
import { dhakaToday, formatDate, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function BillPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const bill = useApi<Bill>(`/vendor-bills/${id}`);
  const act = useAction();
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (bill.loading && !bill.data) return <Loading />;
  if (bill.error) return <ErrorBox error={bill.error} onRetry={bill.reload} />;
  const b = bill.data!;
  const maker = can("payables.manage");
  const run = (work: () => Promise<unknown>, done: string) =>
    act.run(work, done).then((ok) => ok && bill.reload());
  const payable = Number(b.outstanding) - Number(b.pendingPayments);

  return (
    <div>
      <PageHeader
        title={`${b.vendor.name}: ${b.billNo}`}
        subtitle={b.narration}
        actions={
          <>
            {maker && b.state === "draft" && (
              <>
                <Button
                  busy={act.busy}
                  onClick={() =>
                    run(
                      () => api.post(`/vendor-bills/${b.id}/submit`),
                      t("f.b.submitted"),
                    )
                  }
                >
                  {t("f.b.submit")}
                </Button>
                <Button
                  variant="danger"
                  busy={act.busy}
                  onClick={() =>
                    run(
                      () =>
                        api.post(`/vendor-bills/${b.id}/cancel`, {
                          reason: "Withdrawn by the maker",
                        }),
                      t("p.done"),
                    )
                  }
                >
                  {t("f.b.cancel")}
                </Button>
              </>
            )}
            {maker &&
              b.state === "approved" &&
              payable > 0 &&
              b.matchStatus !== "mismatch" && (
                <Button onClick={() => setPaying(true)}>{t("f.b.pay")}</Button>
              )}
            {b.purchaseOrderId && (
              <ButtonLink
                variant="ghost"
                href={`/portal/procurement/orders/${b.purchaseOrderId}`}
              >
                {t("pr.p.order")}
              </ButtonLink>
            )}
            {b.state === "in_approval" && b.approvalRequestId && (
              <ButtonLink
                variant="secondary"
                href={`/portal/approvals/${b.approvalRequestId}`}
              >
                {t("p.run.openApproval")}
              </ButtonLink>
            )}
          </>
        }
      />
      <ActionMessage action={act} />
      {notice && <Alert kind="success">{notice}</Alert>}
      <MatchPanel bill={b} onChanged={bill.reload} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail label={t("f.b.vendor")}>
              <Link
                className="text-emerald-800 underline"
                href={`/portal/vendors/${b.vendor.id}`}
              >
                {b.vendor.code} · {b.vendor.name}
              </Link>
            </Detail>
            <Detail label="TIN / BIN">{`${b.vendor.tin ?? "—"} / ${b.vendor.bin ?? "—"}`}</Detail>
            <Detail label={t("p.status")}>
              <Badge color={BILL_STATE_COLOR[b.state]}>
                {t(`f.b.state.${b.state}`)}
              </Badge>{" "}
              {b.paymentStatus && (
                <Badge color={PAY_STATUS_COLOR[b.paymentStatus]}>
                  {t(`f.b.pay.${b.paymentStatus}`)}
                </Badge>
              )}
            </Detail>
            <Detail label={t("f.b.billDate")}>
              {formatDate(b.billDate, lang)}
            </Detail>
            <Detail label={t("f.b.dueDate")}>
              {formatDate(b.dueDate, lang)}
            </Detail>
            <Detail label={t("f.vd.category")}>{b.withholdingCategory}</Detail>
            <Detail label={t("f.b.journal")}>
              {b.voucherId ? (
                <Link
                  className="font-mono text-xs text-emerald-800 underline"
                  href={`/portal/finance/vouchers/${b.voucherId}`}
                >
                  {b.voucherNumber}
                </Link>
              ) : (
                "—"
              )}
            </Detail>
            <Detail label={t("f.b.rulePack")}>{b.rulePack}</Detail>
          </dl>
          {b.cancelReason && (
            <p className="mt-3 text-sm text-slate-600">{b.cancelReason}</p>
          )}
          <div className="mt-4">
            <Table
              rows={b.lines}
              rowKey={(l) => String(l.lineNo)}
              columns={[
                {
                  key: "account",
                  label: t("f.v.account"),
                  render: (l) => `${l.accountCode} · ${l.accountName}`,
                },
                {
                  key: "description",
                  label: t("f.b.description"),
                  render: (l) => l.description,
                },
                {
                  key: "amount",
                  label: t("f.b.base"),
                  align: "right",
                  render: (l) => <Taka value={l.amount} />,
                },
                {
                  key: "vatp",
                  label: t("f.b.vatPercent"),
                  align: "right",
                  render: (l) => `${num(Number(l.vatPercent), lang)}%`,
                },
                {
                  key: "vat",
                  label: t("f.b.vat"),
                  align: "right",
                  render: (l) => <Taka value={l.vatAmount} />,
                },
              ]}
            />
          </div>
        </Panel>
        <Panel title={t("f.b.withheld")}>
          <Row label={t("f.b.base")} value={<Taka value={b.baseAmount} />} />
          <Row label={t("f.b.vat")} value={<Taka value={b.vatAmount} />} />
          <Row label={t("f.b.total")} value={<Taka value={b.total} />} strong />
          <Row
            label={`${t("f.b.tds")} (${num(Number(b.tdsPercent), lang)}%)`}
            value={<Taka value={`-${b.tdsAmount}`} />}
          />
          <Row
            label={`${t("f.b.vds")} (${num(Number(b.vdsPercent), lang)}%)`}
            value={<Taka value={`-${b.vdsAmount}`} />}
          />
          <Row
            label={t("f.b.net")}
            value={<Taka value={b.netPayable} />}
            strong
          />
          {Number(b.inputVat) > 0 && (
            <Row
              label={t("f.b.inputVat")}
              value={<Taka value={b.inputVat} />}
            />
          )}
          {Number(b.vatInCost) > 0 && (
            <Row
              label={t("f.b.vatInCost")}
              value={<Taka value={b.vatInCost} />}
            />
          )}
          {b.state === "approved" && (
            <>
              <Row
                label={t("f.b.paid")}
                value={<Taka value={b.paidAmount} />}
              />
              <Row
                label={t("f.b.outstanding")}
                value={<Taka value={b.outstanding} />}
                strong
              />
            </>
          )}
          <p className="mt-3 text-xs text-slate-500">{t("f.t.placeholder")}</p>
        </Panel>
      </div>
      {b.withholdings.length > 0 && (
        <Panel title={t("f.b.withheld")}>
          <Table
            rows={b.withholdings}
            rowKey={(w) => w.id}
            columns={[
              {
                key: "type",
                label: t("f.v.type"),
                render: (w) =>
                  w.taxType === "tds" ? t("f.t.tds") : t("f.t.vds"),
              },
              {
                key: "amount",
                label: t("p.amount"),
                align: "right",
                render: (w) => <Taka value={w.amount} />,
              },
              {
                key: "challan",
                label: t("f.t.challanNo"),
                render: (w) =>
                  w.challanNo ? (
                    <>
                      {w.challanNo}{" "}
                      {w.challanState && (
                        <Badge
                          color={
                            CHALLAN_STATE_COLOR[
                              w.challanState as keyof typeof CHALLAN_STATE_COLOR
                            ] ?? "gray"
                          }
                        >
                          {t(`f.t.state.${w.challanState}`)}
                        </Badge>
                      )}
                    </>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "cert",
                label: t("f.t.certified"),
                render: (w) => w.certificateNo ?? "—",
              },
            ]}
          />
        </Panel>
      )}
      {b.payments.length > 0 && (
        <Panel title={t("f.b.payments")}>
          <Table
            rows={b.payments}
            rowKey={(p) => p.paymentId}
            columns={[
              {
                key: "date",
                label: t("p.date"),
                render: (p) => formatDate(p.paymentDate, lang, { short: true }),
              },
              {
                key: "method",
                label: t("f.b.method"),
                render: (p) => t(`f.b.method.${p.method}`),
              },
              {
                key: "voucher",
                label: t("f.v.number"),
                render: (p) => (
                  <span className="font-mono text-xs">{p.voucherNumber}</span>
                ),
              },
              {
                key: "state",
                label: t("p.status"),
                render: (p) => t(`f.pay.state.${p.state}`),
              },
              {
                key: "amount",
                label: t("p.amount"),
                align: "right",
                render: (p) => <Taka value={p.amount} />,
              },
            ]}
          />
        </Panel>
      )}
      {b.state === "approved" && b.paymentStatus === "unpaid" && (
        <Alert kind="info">{t("f.b.void")}</Alert>
      )}
      {paying && (
        <Pay
          bill={b}
          max={payable}
          onClose={() => setPaying(false)}
          onDone={() => (
            setPaying(false),
            setNotice(t("f.b.paymentSent")),
            bill.reload()
          )}
        />
      )}
    </div>
  );
}

function Pay({
  bill,
  max,
  onClose,
  onDone,
}: {
  bill: Bill;
  max: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const { postable } = useAccounts(bill.companyId);
  const [f, setF] = useState({
    method: "bank_transfer",
    paymentDate: dhakaToday(),
    reference: "",
    paidFromAccountId: "",
    amount: String(max),
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      vendorId: bill.vendorId,
      paymentDate: f.paymentDate,
      method: f.method,
      paidFromAccountId: f.paidFromAccountId,
      ...(f.reference ? { reference: f.reference } : {}),
      allocations: [{ billId: bill.id, amount: f.amount }],
    };
    if (
      await save.run(
        () => api.post(`/companies/${bill.companyId}/vendor-payments`, body),
        t("f.b.paymentSent"),
      )
    )
      onDone();
  }
  return (
    <Modal title={t("f.b.payTitle")} open onClose={onClose}>
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <Field label={t("f.b.method")}>
          <Select
            value={f.method}
            onChange={(e) => setF({ ...f, method: e.target.value })}
            id="pay-method"
          >
            {(
              ["bank_transfer", "cheque", "cash", "mobile_wallet"] as const
            ).map((m) => (
              <option key={m} value={m}>
                {t(`f.b.method.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("f.b.payFrom")}>
          <AccountSelect
            accounts={postable}
            filter={(a) => a.role === "cash" || a.role === "bank"}
            value={f.paidFromAccountId}
            onChange={(paidFromAccountId) => setF({ ...f, paidFromAccountId })}
            required
            id="pay-from"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("p.date")}>
            <Input
              type="date"
              required
              value={f.paymentDate}
              onChange={(e) => setF({ ...f, paymentDate: e.target.value })}
              id="pay-date"
            />
          </Field>
          <Field label={t("p.amount")}>
            <Input
              required
              inputMode="decimal"
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
              id="pay-amount"
            />
          </Field>
        </div>
        <Field label={t("f.b.reference")}>
          <Input
            required={f.method === "cheque"}
            maxLength={80}
            value={f.reference}
            onChange={(e) => setF({ ...f, reference: e.target.value })}
            id="pay-reference"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("f.b.pay")}
        />
      </form>
    </Modal>
  );
}
