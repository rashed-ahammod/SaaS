"use client";
/** One voucher: lines, where it came from, and the maker's actions (submit, cancel, reverse). */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ActionMessage,
  Detail,
  Modal,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { Taka } from "@/components/portal/finance";
import { VOUCHER_STATE_COLOR } from "@/components/portal/labels";
import { usePortal } from "@/components/portal/portal-context";
import {
  Badge,
  Button,
  ButtonLink,
  ErrorBox,
  Field,
  Input,
  Loading,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import type { Voucher } from "@/lib/finance-types";
import { dhakaToday, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function VoucherPage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const voucher = useApi<Voucher>(`/vouchers/${id}`);
  const act = useAction();
  const [reversing, setReversing] = useState(false);

  if (voucher.loading && !voucher.data) return <Loading />;
  if (voucher.error)
    return <ErrorBox error={voucher.error} onRetry={voucher.reload} />;
  const v = voucher.data!;
  const maker = can("ledger.vouchers.prepare");
  const run = (work: () => Promise<unknown>, done: string) =>
    act.run(work, done).then((ok) => ok && voucher.reload());

  return (
    <div>
      <PageHeader
        title={<span className="font-mono">{v.number}</span>}
        subtitle={v.narration}
        actions={
          <>
            {maker && v.state === "draft" && !v.sourceType && (
              <>
                <Button
                  busy={act.busy}
                  onClick={() =>
                    run(
                      () => api.post(`/vouchers/${v.id}/submit`),
                      t("f.v.submitted"),
                    )
                  }
                >
                  {t("f.v.submit")}
                </Button>
                <Button
                  variant="danger"
                  busy={act.busy}
                  onClick={() =>
                    run(
                      () =>
                        api.post(`/vouchers/${v.id}/cancel`, {
                          reason: "Withdrawn by the maker",
                        }),
                      t("p.done"),
                    )
                  }
                >
                  {t("f.v.cancel")}
                </Button>
              </>
            )}
            {maker &&
              v.state === "posted" &&
              !v.reversedBy &&
              !v.reversalOf && (
                <Button variant="secondary" onClick={() => setReversing(true)}>
                  {t("f.v.reverse")}
                </Button>
              )}
            {v.approvalRequestId && v.state === "in_approval" && (
              <ButtonLink
                variant="secondary"
                href={`/portal/approvals/${v.approvalRequestId}`}
              >
                {t("p.run.openApproval")}
              </ButtonLink>
            )}
          </>
        }
      />
      <ActionMessage action={act} />
      <Panel>
        <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Detail label={t("f.v.type")}>
            {t(`f.v.type.${v.voucherType}`)}
          </Detail>
          <Detail label={t("p.date")}>{formatDate(v.voucherDate, lang)}</Detail>
          <Detail label={t("p.status")}>
            <Badge color={VOUCHER_STATE_COLOR[v.state]}>
              {t(`f.v.state.${v.state}`)}
            </Badge>
          </Detail>
          <Detail label={t("p.amount")}>
            <Taka value={v.total} />
          </Detail>
          <Detail label={t("f.v.source")}>
            {v.sourceType
              ? t(`f.v.source.${v.sourceType}`)
              : v.isOpening
                ? t("f.v.opening")
                : "—"}
          </Detail>
          <Detail
            label={v.reversalOf ? t("f.v.reversalOf") : t("f.v.reversedBy")}
          >
            {v.reversalOf ? (
              <Link
                className="text-emerald-800 underline"
                href={`/portal/finance/vouchers/${v.reversalOf}`}
              >
                {t("p.view")}
              </Link>
            ) : v.reversedBy ? (
              <Link
                className="text-emerald-800 underline"
                href={`/portal/finance/vouchers/${v.reversedBy}`}
              >
                {t("p.view")}
              </Link>
            ) : (
              "—"
            )}
          </Detail>
        </dl>
        {v.reason && <p className="mt-3 text-sm text-slate-600">{v.reason}</p>}
      </Panel>
      <Panel>
        <Table
          rows={v.lines}
          rowKey={(l) => String(l.lineNo)}
          columns={[
            {
              key: "account",
              label: t("f.v.account"),
              render: (l) => `${l.accountCode} · ${l.accountName}`,
            },
            {
              key: "dept",
              label: t("p.department"),
              render: (l) => l.department ?? "",
            },
            {
              key: "narration",
              label: t("f.v.narration"),
              render: (l) => l.narration ?? "",
            },
            {
              key: "debit",
              label: t("f.v.debit"),
              align: "right",
              render: (l) => (Number(l.debit) ? <Taka value={l.debit} /> : ""),
            },
            {
              key: "credit",
              label: t("f.v.credit"),
              align: "right",
              render: (l) =>
                Number(l.credit) ? <Taka value={l.credit} /> : "",
            },
          ]}
        />
      </Panel>
      {reversing && (
        <Reverse
          voucherId={v.id}
          onClose={() => setReversing(false)}
          onDone={() => (setReversing(false), voucher.reload())}
        />
      )}
    </div>
  );
}

function Reverse({
  voucherId,
  onClose,
  onDone,
}: {
  voucherId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(dhakaToday());
  return (
    <Modal title={t("f.v.reverse")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(
              () =>
                api.post(`/vouchers/${voucherId}/reverse`, {
                  reason,
                  voucherDate: date,
                }),
              t("f.v.reversed"),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("p.reason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="reverse-reason"
          />
        </Field>
        <Field label={t("p.date")}>
          <Input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            id="reverse-date"
          />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("p.cancel")}
          </Button>
          <Button type="submit" busy={save.busy}>
            {t("f.v.reverse")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
