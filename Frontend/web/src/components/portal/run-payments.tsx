"use client";
/**
 * Payments of an approved run and its bank / wallet files (WP7): generate a
 * file per channel (step-up code), download it, mark it paid once the bank
 * confirms, import the bank's return lines, or ask to cancel it (Admin approves).
 * A payment the bank returned is paid again (to the account approved now) in the
 * next file of its channel.
 */
import { useState } from "react";
import {
  ActionMessage,
  FormButtons,
  Modal,
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
  TextArea,
} from "@/components/ui";
import { api, saveDownload, useApi } from "@/lib/api";
import { formatTaka, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

interface Payments {
  runState: string;
  summary: Array<{
    channel: string;
    status: string;
    count: number;
    amount: string;
  }>;
  payments: Array<{
    id: string;
    employeeCode: string;
    fullNameEn: string;
    amount: string;
    channel: string;
    reference: string;
    status: string;
    returnedReason: string | null;
  }>;
}

interface DisbursementFile {
  id: string;
  channel: string;
  adapter: string;
  fileName: string;
  payments: number;
  total: string;
  state: "active" | "settled" | "cancelled";
  cancelApprovalRequestId: string | null;
}

const CHANNELS = ["bank", "bkash", "nagad", "rocket", "upay", "cash"];

export function RunPayments({ runId }: { runId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const payments = useApi<Payments>(`/payroll-runs/${runId}/payments`);
  const files = useApi<DisbursementFile[]>(
    `/payroll-runs/${runId}/disbursement-files`,
  );
  const action = useAction();
  const [channel, setChannel] = useState("bank");
  const [returnsFor, setReturnsFor] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [reissueFor, setReissueFor] = useState<
    Payments["payments"][number] | null
  >(null);
  const disburse = can("payroll.disburse");
  const reload = () => {
    payments.reload();
    files.reload();
  };

  if (payments.error) return <ErrorBox error={payments.error} />;
  if (!payments.data) return <Loading />;
  const waiting = payments.data.summary.filter((s) => s.status === "approved");

  return (
    <>
      <ActionMessage action={action} />
      <Panel title={t("p.pay.channel")}>
        <Table
          rows={payments.data.summary}
          rowKey={(s) => `${s.channel}-${s.status}`}
          empty={t("p.pay.notYet")}
          columns={[
            { key: "channel", label: t("p.pay.channel") },
            { key: "status", label: t("p.status") },
            {
              key: "count",
              label: t("p.pay.count"),
              align: "right",
              render: (s) => num(s.count, lang),
            },
            {
              key: "amount",
              label: t("p.amount"),
              align: "right",
              render: (s) => formatTaka(s.amount, lang),
            },
          ]}
        />
        {disburse && waiting.length > 0 && (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label={t("p.pay.channel")}>
              <Select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                {CHANNELS.filter((c) =>
                  waiting.some((w) => w.channel === c),
                ).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="mb-3">
              <Button
                busy={action.busy}
                onClick={() =>
                  action
                    .run(
                      () =>
                        api.post(`/payroll-runs/${runId}/disbursement-files`, {
                          channel: waiting.some((w) => w.channel === channel)
                            ? channel
                            : waiting[0].channel,
                        }),
                      t("p.pay.generated"),
                    )
                    .then(reload)
                }
              >
                {t("p.pay.generate")}
              </Button>
            </div>
          </div>
        )}
      </Panel>
      <Panel title={t("p.pay.files")}>
        <Table
          rows={files.data}
          rowKey={(f) => f.id}
          columns={[
            {
              key: "fileName",
              label: t("p.file"),
              className: "font-mono text-xs",
            },
            { key: "channel", label: t("p.pay.channel") },
            {
              key: "payments",
              label: t("p.pay.count"),
              align: "right",
              render: (f) => num(f.payments, lang),
            },
            {
              key: "total",
              label: t("p.total"),
              align: "right",
              render: (f) => formatTaka(f.total, lang),
            },
            {
              key: "state",
              label: t("p.status"),
              render: (f) => (
                <Badge
                  color={
                    f.state === "settled"
                      ? "green"
                      : f.state === "cancelled"
                        ? "red"
                        : f.cancelApprovalRequestId
                          ? "amber"
                          : "blue"
                  }
                >
                  {t(`p.pay.state.${f.state}`)}
                </Badge>
              ),
            },
            {
              key: "act",
              label: "",
              align: "right",
              render: (f) => (
                <span className="flex flex-wrap justify-end gap-1">
                  <Button
                    variant="ghost"
                    className="min-h-8 px-2 py-1 text-sm"
                    onClick={() =>
                      action.run(async () =>
                        saveDownload(
                          await api.file(
                            `/disbursement-files/${f.id}/download`,
                          ),
                          f.fileName,
                        ),
                      )
                    }
                  >
                    {t("p.download")}
                  </Button>
                  {disburse &&
                    f.state === "active" &&
                    !f.cancelApprovalRequestId && (
                      <>
                        <Button
                          variant="secondary"
                          className="min-h-8 px-2 py-1 text-sm"
                          onClick={() =>
                            action
                              .run(
                                () =>
                                  api.post(
                                    `/disbursement-files/${f.id}/settle`,
                                  ),
                                t("p.done"),
                              )
                              .then(reload)
                          }
                        >
                          {t("p.pay.settle")}
                        </Button>
                        <Button
                          variant="ghost"
                          className="min-h-8 px-2 py-1 text-sm"
                          onClick={() => setReturnsFor(f.id)}
                        >
                          {t("p.pay.returns")}
                        </Button>
                        <Button
                          variant="ghost"
                          className="min-h-8 px-2 py-1 text-sm text-red-700"
                          onClick={() => setCancelFor(f.id)}
                        >
                          {t("p.pay.cancelFile")}
                        </Button>
                      </>
                    )}
                </span>
              ),
            },
          ]}
        />
      </Panel>
      <Panel title={t("p.pay.count")}>
        <Table
          rows={payments.data.payments}
          rowKey={(p) => p.id}
          columns={[
            {
              key: "employeeCode",
              label: t("p.code"),
              className: "font-mono whitespace-nowrap",
            },
            { key: "fullNameEn", label: t("p.name") },
            { key: "channel", label: t("p.pay.channel") },
            {
              key: "reference",
              label: t("p.pay.reference"),
              className: "font-mono text-xs",
            },
            {
              key: "amount",
              label: t("p.amount"),
              align: "right",
              render: (p) => formatTaka(p.amount, lang),
            },
            {
              key: "status",
              label: t("p.status"),
              render: (p) => (
                <Badge
                  color={
                    p.status === "paid"
                      ? "green"
                      : p.status === "returned"
                        ? "red"
                        : "gray"
                  }
                >
                  {p.status}
                </Badge>
              ),
            },
            {
              key: "returnedReason",
              label: t("p.reason"),
              render: (p) => (
                <span className="text-xs text-slate-600">
                  {p.returnedReason ?? ""}
                </span>
              ),
            },
            {
              key: "act",
              label: "",
              align: "right",
              render: (p) =>
                disburse && p.status === "returned" ? (
                  <Button
                    variant="secondary"
                    className="min-h-8 px-2 py-1 text-sm"
                    onClick={() => setReissueFor(p)}
                  >
                    {t("py.pay.reissue")}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Panel>
      {returnsFor && (
        <ReturnsDialog
          fileId={returnsFor}
          onClose={() => setReturnsFor(null)}
          onDone={reload}
        />
      )}
      {cancelFor && (
        <CancelFileDialog
          fileId={cancelFor}
          onClose={() => setCancelFor(null)}
          onDone={reload}
        />
      )}
      {reissueFor && (
        <ReissueDialog
          payment={reissueFor}
          onClose={() => setReissueFor(null)}
          onDone={reload}
        />
      )}
    </>
  );
}

function ReturnsDialog({
  fileId,
  onClose,
  onDone,
}: {
  fileId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [content, setContent] = useState("");
  return (
    <Modal title={t("p.pay.returns")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/disbursement-files/${fileId}/returns`, { content }),
            )
          ) {
            onClose();
            onDone();
          }
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("p.pay.returnsHint")}>
          <TextArea
            rows={6}
            required
            className="font-mono text-xs"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function CancelFileDialog({
  fileId,
  onClose,
  onDone,
}: {
  fileId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal title={t("p.pay.cancelFile")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/disbursement-files/${fileId}/cancel`, { reason }),
            )
          ) {
            onClose();
            onDone();
          }
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("p.reason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

function ReissueDialog({
  payment,
  onClose,
  onDone,
}: {
  payment: Payments["payments"][number];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={`${t("py.pay.reissue")} · ${payment.employeeCode}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/payments/${payment.id}/reissue`, { reason }),
            )
          ) {
            onClose();
            onDone();
          }
        }}
      >
        <ActionMessage action={save} />
        <p className="mb-3 text-sm text-slate-600">
          {t("py.pay.reissueHint", {
            amount: formatTaka(payment.amount, lang),
            reason: payment.returnedReason ?? "—",
          })}
        </p>
        <Field label={t("p.reason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="reissue-reason"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("py.pay.reissue")}
        />
      </form>
    </Modal>
  );
}
