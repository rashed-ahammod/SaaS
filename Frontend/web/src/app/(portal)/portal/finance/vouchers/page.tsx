"use client";
/** Vouchers of the selected company (filters by type and state); Accounts prepares a new one. */
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
import {
  emptyVoucherLine,
  Taka,
  useAccounts,
  VoucherLinesEditor,
  type VoucherLineInput,
} from "@/components/portal/finance";
import { VOUCHER_STATE_COLOR } from "@/components/portal/labels";
import { useOrg } from "@/components/portal/org";
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
import type { VoucherSummary, VoucherType } from "@/lib/finance-types";
import { dhakaToday, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

const TYPES: VoucherType[] = ["payment", "receipt", "journal", "contra"];

export default function VouchersPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const [type, setType] = useState("");
  const [state, setState] = useState("");
  const query = new URLSearchParams({
    ...(type ? { type } : {}),
    ...(state ? { state } : {}),
  }).toString();
  const vouchers = useApi<VoucherSummary[]>(
    company
      ? `/companies/${company.id}/vouchers${query ? `?${query}` : ""}`
      : null,
  );
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title={t("f.v.title")}
        actions={
          can("ledger.vouchers.prepare") && (
            <Button onClick={() => setCreating(true)}>{t("f.v.new")}</Button>
          )
        }
      />
      <Panel
        actions={
          <>
            <Select
              aria-label={t("f.v.type")}
              value={type}
              onChange={(e) => setType(e.target.value)}
              id="voucher-filter-type"
            >
              <option value="">{t("f.v.allTypes")}</option>
              {TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`f.v.type.${k}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t("p.status")}
              value={state}
              onChange={(e) => setState(e.target.value)}
              id="voucher-filter-state"
            >
              <option value="">{t("f.v.allStates")}</option>
              {(["draft", "in_approval", "posted", "cancelled"] as const).map(
                (k) => (
                  <option key={k} value={k}>
                    {t(`f.v.state.${k}`)}
                  </option>
                ),
              )}
            </Select>
          </>
        }
      >
        {vouchers.loading ? (
          <Loading />
        ) : vouchers.error ? (
          <ErrorBox error={vouchers.error} onRetry={vouchers.reload} />
        ) : (
          <Table
            rows={vouchers.data}
            rowKey={(v) => v.id}
            onRowClick={(v) => router.push(`/portal/finance/vouchers/${v.id}`)}
            columns={[
              {
                key: "number",
                label: t("f.v.number"),
                render: (v) => (
                  <span className="font-mono text-xs">{v.number}</span>
                ),
              },
              {
                key: "date",
                label: t("p.date"),
                render: (v) => formatDate(v.voucherDate, lang, { short: true }),
              },
              {
                key: "narration",
                label: t("f.v.narration"),
                render: (v) => (
                  <span className="line-clamp-2">{v.narration}</span>
                ),
              },
              {
                key: "source",
                label: t("f.v.source"),
                render: (v) =>
                  v.sourceType
                    ? t(`f.v.source.${v.sourceType}`)
                    : v.isOpening
                      ? t("f.v.opening")
                      : "",
              },
              {
                key: "state",
                label: t("p.status"),
                render: (v) => (
                  <Badge color={VOUCHER_STATE_COLOR[v.state]}>
                    {t(`f.v.state.${v.state}`)}
                  </Badge>
                ),
              },
              {
                key: "total",
                label: t("p.amount"),
                align: "right",
                render: (v) => <Taka value={v.total} />,
              },
            ]}
          />
        )}
      </Panel>
      {creating && company && (
        <NewVoucher
          companyId={company.id}
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/portal/finance/vouchers/${id}`)}
        />
      )}
    </div>
  );
}

function NewVoucher({
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
  const { postable } = useAccounts(companyId);
  const { departments } = useOrg(companyId);
  const [f, setF] = useState({
    voucherType: "payment",
    voucherDate: dhakaToday(),
    narration: "",
  });
  const [lines, setLines] = useState<VoucherLineInput[]>([
    emptyVoucherLine(),
    emptyVoucherLine(),
  ]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      ...f,
      lines: lines.map((l) => ({
        accountId: l.accountId,
        ...(l.departmentId ? { departmentId: l.departmentId } : {}),
        ...(l.debit ? { debit: l.debit } : {}),
        ...(l.credit ? { credit: l.credit } : {}),
      })),
    };
    const v = await save.run(() =>
      api.post<{ id: string }>(`/companies/${companyId}/vouchers`, body),
    );
    if (v) onCreated(v.id);
  }

  return (
    <Modal title={t("f.v.new")} open onClose={onClose} wide>
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("f.v.type")}>
            <Select
              value={f.voucherType}
              onChange={(e) => setF({ ...f, voucherType: e.target.value })}
              id="voucher-type"
            >
              {TYPES.map((k) => (
                <option key={k} value={k}>
                  {t(`f.v.type.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("p.date")}>
            <Input
              type="date"
              required
              value={f.voucherDate}
              onChange={(e) => setF({ ...f, voucherDate: e.target.value })}
              id="voucher-date"
            />
          </Field>
        </div>
        <Field label={t("f.v.narration")}>
          <Input
            required
            maxLength={500}
            value={f.narration}
            onChange={(e) => setF({ ...f, narration: e.target.value })}
            id="voucher-narration"
          />
        </Field>
        <VoucherLinesEditor
          lines={lines}
          onChange={setLines}
          accounts={postable}
          departments={departments}
        />
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("p.create")}
        />
      </form>
    </Modal>
  );
}
