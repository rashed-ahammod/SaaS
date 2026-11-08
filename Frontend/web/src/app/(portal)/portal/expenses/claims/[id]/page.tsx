"use client";
/** One expense claim for Accounts: lines with receipts, the booking, and the payment. */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ClaimBadge, ReceiptView } from "@/components/expenses";
import { AccountSelect, Taka, useAccounts } from "@/components/portal/finance";
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
import { usePortal } from "@/components/portal/portal-context";
import {
  Alert,
  Button,
  ButtonLink,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { Claim } from "@/lib/expense-types";
import { dhakaToday, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function PortalClaimPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const claim = useApi<Claim>(`/expense-claims/${id}`);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (claim.loading && !claim.data) return <Loading />;
  if (claim.error)
    return <ErrorBox error={claim.error} onRetry={claim.reload} />;
  const c = claim.data!;
  const types = new Map(c.receipts.map((r) => [r.id, r.contentType]));

  return (
    <div>
      <PageHeader
        title={`${c.employee.name}: ${c.title}`}
        subtitle={c.number}
        actions={
          <>
            {can("expenses.pay") && c.state === "approved" && !c.payment && (
              <Button onClick={() => setPaying(true)}>{t("x.p.pay")}</Button>
            )}
            {c.state === "in_approval" && c.approvalRequestId && (
              <ButtonLink
                variant="secondary"
                href={`/portal/approvals/${c.approvalRequestId}`}
              >
                {t("p.run.openApproval")}
              </ButtonLink>
            )}
            {c.payment?.state === "in_approval" &&
              c.payment.approvalRequestId && (
                <ButtonLink
                  variant="secondary"
                  href={`/portal/approvals/${c.payment.approvalRequestId}`}
                >
                  {t("p.run.openApproval")}
                </ButtonLink>
              )}
          </>
        }
      />
      {notice && <Alert kind="success">{notice}</Alert>}
      <Panel>
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Detail
            label={t("p.employee")}
          >{`${c.employee.code} · ${c.employee.name}`}</Detail>
          <Detail label={t("p.status")}>
            <ClaimBadge state={c.state} />
          </Detail>
          <Detail label={t("x.total")}>
            <Taka value={c.total} />
          </Detail>
          <Detail label={t("x.advanceApplied")}>
            <Taka value={c.advanceApplied} />
          </Detail>
          <Detail label={t("x.payable")}>
            {["approved", "paid"].includes(c.state) ? (
              <Taka value={c.payable} />
            ) : (
              "—"
            )}
          </Detail>
          <Detail label={t("x.p.voucher")}>
            {c.postingVoucherId ? (
              <Link
                className="font-mono text-xs text-emerald-800 underline"
                href={`/portal/finance/vouchers/${c.postingVoucherId}`}
              >
                {c.postingVoucherNumber}
              </Link>
            ) : (
              "—"
            )}
            {c.payment && (
              <>
                {" · "}
                <Link
                  className="font-mono text-xs text-emerald-800 underline"
                  href={`/portal/finance/vouchers/${c.payment.voucherId}`}
                >
                  {c.payment.number}
                </Link>
              </>
            )}
          </Detail>
        </dl>
      </Panel>
      <Panel title={t("x.lines")}>
        <Table
          rows={c.lines}
          rowKey={(l) => String(l.lineNo)}
          columns={[
            {
              key: "date",
              label: t("x.date"),
              render: (l) => formatDate(l.expenseDate, lang, { short: true }),
            },
            {
              key: "category",
              label: t("x.category"),
              render: (l) => l.categoryName,
            },
            {
              key: "description",
              label: t("x.description"),
              render: (l) => l.description,
            },
            {
              key: "receipt",
              label: t("x.receipt"),
              render: (l) =>
                l.receiptId ? (
                  <ReceiptView
                    claimId={c.id}
                    receiptId={l.receiptId}
                    contentType={types.get(l.receiptId)}
                  />
                ) : l.receiptNeeded ? (
                  <span className="text-amber-700">{t("x.receiptNeeded")}</span>
                ) : (
                  "—"
                ),
            },
            {
              key: "amount",
              label: t("p.amount"),
              align: "right",
              render: (l) => <Taka value={l.amount} />,
            },
          ]}
        />
      </Panel>
      {paying && (
        <Pay
          claim={c}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            setNotice(t("x.p.sent"));
            claim.reload();
          }}
        />
      )}
    </div>
  );
}

function Pay({
  claim,
  onClose,
  onDone,
}: {
  claim: Claim;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const { postable } = useAccounts(claim.companyId);
  const [f, setF] = useState({
    method: "cash",
    paidFromAccountId: "",
    paymentDate: dhakaToday(),
    reference: "",
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      method: f.method,
      paidFromAccountId: f.paidFromAccountId,
      paymentDate: f.paymentDate,
      ...(f.reference ? { reference: f.reference } : {}),
    };
    if (
      await save.run(() =>
        api.post(`/expense-claims/${claim.id}/payment`, body),
      )
    )
      onDone();
  }
  return (
    <Modal title={`${t("x.p.pay")}: ${claim.number}`} open onClose={onClose}>
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <p className="mb-3 text-lg font-semibold">
          <Taka value={claim.payable} />
        </p>
        <Field label={t("x.p.method")}>
          <Select
            value={f.method}
            onChange={(e) => setF({ ...f, method: e.target.value })}
            id="claim-pay-method"
          >
            {(["cash", "bank_transfer", "mobile_wallet"] as const).map((m) => (
              <option key={m} value={m}>
                {t(`x.p.method.${m}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("x.p.payFrom")}>
          <AccountSelect
            accounts={postable}
            filter={(a) => a.role === "cash" || a.role === "bank"}
            value={f.paidFromAccountId}
            onChange={(paidFromAccountId) => setF({ ...f, paidFromAccountId })}
            required
            id="claim-pay-from"
          />
        </Field>
        <Field label={t("p.date")}>
          <Input
            type="date"
            required
            value={f.paymentDate}
            onChange={(e) => setF({ ...f, paymentDate: e.target.value })}
            id="claim-pay-date"
          />
        </Field>
        <Field label={t("f.b.reference")}>
          <Input
            maxLength={80}
            value={f.reference}
            onChange={(e) => setF({ ...f, reference: e.target.value })}
            id="claim-pay-ref"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("x.p.pay")}
        />
      </form>
    </Modal>
  );
}
