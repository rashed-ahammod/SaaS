"use client";
/**
 * Tax withheld from salaries (payroll fixes): per month of an income year, what
 * payroll deducted, what the recorded treasury challans deposited, and what is
 * still to deposit. Accounts records a challan (printed on every employee's tax
 * certificate) or cancels one entered by mistake.
 */
import { useState } from "react";
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
import { dhakaToday, formatDate, formatMonth, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { currentFiscalYear } from "./employee-payroll";
import {
  ActionMessage,
  FormButtons,
  Modal,
  Panel,
  Table,
  useAction,
} from "./kit";
import { usePortal } from "./portal-context";

interface SalaryTax {
  fiscalYear: string;
  months: Array<{
    period: string;
    withheld: string;
    deposited: string;
    due: string;
  }>;
  challans: Array<{
    id: string;
    period: string;
    challanNo: string;
    challanDate: string;
    amount: string;
    state: "active" | "cancelled";
    cancelledReason: string | null;
  }>;
}

/** The current income year and the four before it. */
function fiscalYears(): string[] {
  const start = Number(currentFiscalYear().slice(0, 4));
  return [0, 1, 2, 3, 4].map(
    (i) => `${start - i}-${String(start - i + 1).slice(2)}`,
  );
}

export function SalaryTax({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const [year, setYear] = useState(currentFiscalYear());
  const data = useApi<SalaryTax>(
    `/companies/${companyId}/salary-tax-challans?fiscalYear=${year}`,
  );
  const [adding, setAdding] = useState<{
    period: string;
    amount: string;
  } | null>(null);
  const [cancelling, setCancelling] = useState<
    SalaryTax["challans"][number] | null
  >(null);
  const write = can("payables.tax");

  return (
    <>
      <Panel
        title={t("py.ch.title")}
        actions={
          <>
            <Select
              aria-label={t("py.tax.year")}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              id="salary-tax-year"
            >
              {fiscalYears().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            {write && (
              <Button
                variant="secondary"
                onClick={() =>
                  setAdding({ period: dhakaToday().slice(0, 7), amount: "" })
                }
              >
                {t("py.ch.add")}
              </Button>
            )}
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-500">{t("py.ch.hint")}</p>
        {data.error ? (
          <ErrorBox error={data.error} onRetry={data.reload} />
        ) : !data.data ? (
          <Loading />
        ) : (
          <Table
            rows={data.data.months}
            rowKey={(m) => m.period}
            columns={[
              {
                key: "period",
                label: t("py.ch.month"),
                render: (m) => formatMonth(m.period, lang),
              },
              {
                key: "withheld",
                label: t("py.ch.withheld"),
                align: "right",
                render: (m) => formatTaka(m.withheld, lang),
              },
              {
                key: "deposited",
                label: t("py.ch.deposited"),
                align: "right",
                render: (m) => formatTaka(m.deposited, lang),
              },
              {
                key: "due",
                label: t("py.ch.due"),
                align: "right",
                render: (m) =>
                  Number(m.due) > 0 ? (
                    <strong className="text-amber-700">
                      {formatTaka(m.due, lang)}
                    </strong>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "act",
                label: "",
                align: "right",
                render: (m) =>
                  write && Number(m.due) > 0 ? (
                    <Button
                      variant="ghost"
                      className="min-h-8 px-2 py-1 text-sm"
                      onClick={() =>
                        setAdding({ period: m.period, amount: m.due })
                      }
                    >
                      {t("py.ch.add")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Panel>
      {data.data && data.data.challans.length > 0 && (
        <Panel title={t("py.tax.challan")}>
          <Table
            rows={data.data.challans}
            rowKey={(c) => c.id}
            columns={[
              {
                key: "challanNo",
                label: t("py.ch.no"),
                className: "font-mono",
              },
              {
                key: "date",
                label: t("py.ch.date"),
                render: (c) => formatDate(c.challanDate, lang, { short: true }),
              },
              {
                key: "period",
                label: t("py.ch.month"),
                render: (c) => formatMonth(c.period, lang),
              },
              {
                key: "amount",
                label: t("p.amount"),
                align: "right",
                render: (c) => formatTaka(c.amount, lang),
              },
              {
                key: "state",
                label: t("p.status"),
                render: (c) =>
                  c.state === "cancelled" ? (
                    <Badge color="gray">{t("py.ch.cancelled")}</Badge>
                  ) : null,
              },
              {
                key: "act",
                label: "",
                align: "right",
                render: (c) =>
                  write && c.state === "active" ? (
                    <Button
                      variant="ghost"
                      className="min-h-8 px-2 py-1 text-sm text-red-700"
                      onClick={() => setCancelling(c)}
                    >
                      {t("py.ch.cancel")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Panel>
      )}
      {adding && (
        <ChallanForm
          companyId={companyId}
          initial={adding}
          onClose={() => setAdding(null)}
          onDone={() => (setAdding(null), data.reload())}
        />
      )}
      {cancelling && (
        <CancelChallan
          challan={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => (setCancelling(null), data.reload())}
        />
      )}
    </>
  );
}

function ChallanForm({
  companyId,
  initial,
  onClose,
  onDone,
}: {
  companyId: string;
  initial: { period: string; amount: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    period: initial.period,
    challanNo: "",
    challanDate: dhakaToday(),
    amount: initial.amount,
  });
  return (
    <Modal title={t("py.ch.add")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(
              () => api.post(`/companies/${companyId}/salary-tax-challans`, f),
              t("py.ch.saved"),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("py.ch.month")}>
            <Input
              type="month"
              required
              value={f.period}
              onChange={(e) => setF({ ...f, period: e.target.value })}
              id="challan-period"
            />
          </Field>
          <Field label={t("py.ch.no")}>
            <Input
              required
              maxLength={50}
              value={f.challanNo}
              onChange={(e) => setF({ ...f, challanNo: e.target.value })}
              id="challan-no"
            />
          </Field>
          <Field label={t("py.ch.date")}>
            <Input
              type="date"
              required
              value={f.challanDate}
              onChange={(e) => setF({ ...f, challanDate: e.target.value })}
              id="challan-date"
            />
          </Field>
          <Field label={t("p.amount")}>
            <Input
              required
              inputMode="decimal"
              pattern="\d+(\.\d{1,2})?"
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
              id="challan-amount"
            />
          </Field>
        </div>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function CancelChallan({
  challan,
  onClose,
  onDone,
}: {
  challan: SalaryTax["challans"][number];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={`${t("py.ch.cancel")}: ${challan.challanNo}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/salary-tax-challans/${challan.id}/cancel`, { reason }),
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
            id="challan-cancel-reason"
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}
