"use client";
/** Vendor bills (filters); Accounts enters a vendor's invoice: tax at source is worked out by the server. */
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
import { ReadScanButton } from "@/components/portal/close";
import {
  BillLinesEditor,
  emptyBillLine,
  Taka,
  useAccounts,
  type BillLineInput,
  type VatItemChoice,
} from "@/components/portal/finance";
import { BILL_STATE_COLOR, PAY_STATUS_COLOR } from "@/components/portal/labels";
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
import type { BillSummary, Vendor } from "@/lib/finance-types";
import { dhakaToday, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function BillsPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const [state, setState] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const query = new URLSearchParams({
    ...(state ? { state } : {}),
    ...(openOnly ? { open: "true" } : {}),
  }).toString();
  const bills = useApi<BillSummary[]>(
    company
      ? `/companies/${company.id}/vendor-bills${query ? `?${query}` : ""}`
      : null,
  );
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title={t("f.b.title")}
        actions={
          can("payables.manage") && (
            <Button onClick={() => setCreating(true)}>{t("f.b.new")}</Button>
          )
        }
      />
      <Panel
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(e) => setOpenOnly(e.target.checked)}
                id="bills-open"
              />
              {t("f.b.openOnly")}
            </label>
            <Select
              aria-label={t("p.status")}
              value={state}
              onChange={(e) => setState(e.target.value)}
              id="bills-state"
            >
              <option value="">{t("f.v.allStates")}</option>
              {(["draft", "in_approval", "approved", "cancelled"] as const).map(
                (k) => (
                  <option key={k} value={k}>
                    {t(`f.b.state.${k}`)}
                  </option>
                ),
              )}
            </Select>
          </>
        }
      >
        {bills.loading && !bills.data ? (
          <Loading />
        ) : bills.error ? (
          <ErrorBox error={bills.error} onRetry={bills.reload} />
        ) : (
          <Table
            rows={bills.data}
            rowKey={(b) => b.id}
            onRowClick={(b) => router.push(`/portal/bills/${b.id}`)}
            columns={[
              {
                key: "vendor",
                label: t("f.b.vendor"),
                render: (b) => `${b.vendorCode} · ${b.vendorName}`,
              },
              {
                key: "billNo",
                label: t("f.b.billNo"),
                render: (b) => b.billNo,
              },
              {
                key: "date",
                label: t("f.b.billDate"),
                render: (b) => formatDate(b.billDate, lang, { short: true }),
              },
              {
                key: "due",
                label: t("f.b.dueDate"),
                render: (b) => formatDate(b.dueDate, lang, { short: true }),
              },
              {
                key: "state",
                label: t("p.status"),
                render: (b) => (
                  <>
                    <Badge color={BILL_STATE_COLOR[b.state]}>
                      {t(`f.b.state.${b.state}`)}
                    </Badge>{" "}
                    {b.paymentStatus && (
                      <Badge color={PAY_STATUS_COLOR[b.paymentStatus]}>
                        {t(`f.b.pay.${b.paymentStatus}`)}
                      </Badge>
                    )}
                  </>
                ),
              },
              {
                key: "total",
                label: t("f.b.total"),
                align: "right",
                render: (b) => <Taka value={b.total} />,
              },
              {
                key: "tax",
                label: `${t("f.b.tds")} + ${t("f.b.vds")}`,
                align: "right",
                render: (b) => (
                  <Taka value={Number(b.tdsAmount) + Number(b.vdsAmount)} />
                ),
              },
              {
                key: "outstanding",
                label: t("f.b.outstanding"),
                align: "right",
                render: (b) => (
                  <Taka
                    value={
                      b.state === "approved" ? b.outstanding : b.netPayable
                    }
                  />
                ),
              },
            ]}
          />
        )}
      </Panel>
      {creating && company && (
        <NewBill
          companyId={company.id}
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/portal/bills/${id}`)}
        />
      )}
    </div>
  );
}

function NewBill({
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
  const vendors = useApi<Vendor[]>(
    `/companies/${companyId}/vendors?active=true`,
  );
  const { postable } = useAccounts(companyId);
  const { departments } = useOrg(companyId);
  const [f, setF] = useState({
    vendorId: "",
    billNo: "",
    billDate: dhakaToday(),
    dueDate: "",
    narration: "",
  });
  const [lines, setLines] = useState<BillLineInput[]>([emptyBillLine()]);
  // VAT items with their rate for the bill's fiscal year (July-June)
  const fy = (() => {
    const [y, m] = f.billDate.split("-").map(Number);
    const s = m >= 7 ? y : y - 1;
    return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
  })();
  const vatItems = useApi<
    Array<{
      id: string;
      code: string;
      nameEn: string;
      isActive: boolean;
      rates: Array<{ vatPercent: string }>;
    }>
  >(`/companies/${companyId}/vat-items?fiscalYear=${fy}`);
  const vatChoices: VatItemChoice[] = (vatItems.data ?? [])
    .filter((x) => x.isActive && x.rates.length)
    .map((x) => ({
      id: x.id,
      code: x.code,
      nameEn: x.nameEn,
      vatPercent: x.rates[0].vatPercent,
    }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = {
      vendorId: f.vendorId,
      billNo: f.billNo,
      billDate: f.billDate,
      narration: f.narration,
      ...(f.dueDate ? { dueDate: f.dueDate } : {}),
      lines: lines.map((l) => ({
        accountId: l.accountId,
        description: l.description,
        amount: l.amount,
        vatPercent: l.vatPercent,
        ...(l.vatItemId ? { vatItemId: l.vatItemId } : {}),
        ...(l.departmentId ? { departmentId: l.departmentId } : {}),
      })),
    };
    const b = await save.run(
      () =>
        api.post<{ id: string }>(`/companies/${companyId}/vendor-bills`, body),
      t("f.b.created"),
    );
    if (b) onCreated(b.id);
  }

  return (
    <Modal title={t("f.b.new")} open onClose={onClose} wide>
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <ReadScanButton
          companyId={companyId}
          kind="bill"
          onRead={(doc) => {
            const d = doc.fields!;
            setF((x) => ({
              ...x,
              vendorId: doc.vendor?.id ?? x.vendorId,
              billNo: d.documentNo ?? x.billNo,
              billDate: d.date ?? x.billDate,
              narration:
                x.narration ||
                [d.vendorName, d.documentNo].filter(Boolean).join(", "),
            }));
            if (d.lines.length)
              setLines(
                d.lines.map((l) => ({
                  ...emptyBillLine(),
                  description: l.description,
                  amount: String(Number(l.amount)),
                  vatPercent: l.vatPercent ? String(Number(l.vatPercent)) : "0",
                })),
              );
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("f.b.vendor")}>
            <Select
              required
              value={f.vendorId}
              onChange={(e) => setF({ ...f, vendorId: e.target.value })}
              id="bill-vendor"
            >
              <option value="">—</option>
              {vendors.data?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} · {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("f.b.billNo")}>
            <Input
              required
              maxLength={60}
              value={f.billNo}
              onChange={(e) => setF({ ...f, billNo: e.target.value })}
              id="bill-no"
            />
          </Field>
          <Field label={t("f.b.billDate")}>
            <Input
              type="date"
              required
              value={f.billDate}
              onChange={(e) => setF({ ...f, billDate: e.target.value })}
              id="bill-date"
            />
          </Field>
          <Field label={t("f.b.dueDate")} hint={t("f.b.dueHint")}>
            <Input
              type="date"
              value={f.dueDate}
              onChange={(e) => setF({ ...f, dueDate: e.target.value })}
              id="bill-due"
            />
          </Field>
        </div>
        <Field label={t("f.v.narration")}>
          <Input
            required
            maxLength={500}
            value={f.narration}
            onChange={(e) => setF({ ...f, narration: e.target.value })}
            id="bill-narration"
          />
        </Field>
        <BillLinesEditor
          lines={lines}
          onChange={setLines}
          accounts={postable}
          departments={departments}
          vatItems={vatChoices}
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
