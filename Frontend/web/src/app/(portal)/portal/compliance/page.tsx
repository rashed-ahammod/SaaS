"use client";
/** The compliance calendar (WP21): returns, deposits and renewals, when they are due and whether they are done. */
import { useState } from "react";
import {
  ActionMessage,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, Button, ErrorBox, Field, Input, Select } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dhakaToday, formatDate, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { ComplianceItem } from "@/lib/vat-types";

const STATE_COLOR = {
  open: "amber",
  done: "green",
  not_applicable: "gray",
} as const;

export default function CompliancePage() {
  const { t, lang } = useI18n();
  const { company, can } = usePortal();
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [closing, setClosing] = useState<ComplianceItem | null>(null);
  const items = useApi<ComplianceItem[]>(
    company
      ? `/companies/${company.id}/compliance${showClosed ? "" : "?state=open"}`
      : null,
  );
  if (!company) return null;
  const manage = can("compliance.manage");
  const when = (i: ComplianceItem) => {
    if (i.daysLeft === null) return "";
    if (i.daysLeft === 0)
      return (
        <span className="font-medium text-amber-700">{t("cp.today")}</span>
      );
    if (i.daysLeft < 0)
      return (
        <span className="font-semibold text-red-700">
          {t("cp.overdue", { n: num(-i.daysLeft, lang) })}
        </span>
      );
    return (
      <span className={i.daysLeft <= 7 ? "text-amber-700" : "text-slate-600"}>
        {t("cp.daysLeft", { n: num(i.daysLeft, lang) })}
      </span>
    );
  };
  return (
    <div>
      <PageHeader
        title={t("cp.title")}
        subtitle={company.legalName}
        actions={
          manage && (
            <Button onClick={() => setAdding(true)}>{t("cp.add")}</Button>
          )
        }
      />
      <Panel
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => setShowClosed(e.target.checked)}
              id="show-closed"
            />{" "}
            {t("cp.showClosed")}
          </label>
        }
      >
        <p className="mb-3 text-sm text-slate-600">{t("cp.hint")}</p>
        {items.error ? (
          <ErrorBox error={items.error} onRetry={items.reload} />
        ) : (
          <Table
            rows={items.data}
            rowKey={(i) => i.id}
            empty={t("st.none")}
            columns={[
              {
                key: "due",
                label: t("cp.due"),
                className: "whitespace-nowrap",
                render: (i) => (
                  <span>
                    {formatDate(i.dueDate, lang, { short: true })}
                    <span className="block text-xs">{when(i)}</span>
                  </span>
                ),
              },
              {
                key: "what",
                label: t("cp.what"),
                render: (i) => (
                  <span>
                    {i.title}
                    {i.note && (
                      <span className="block text-xs text-slate-500">
                        {i.note}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: "state",
                label: "",
                render: (i) => (
                  <Badge color={STATE_COLOR[i.state]}>
                    {t(`cp.state.${i.state}`)}
                  </Badge>
                ),
              },
              {
                key: "evidence",
                label: t("cp.evidence"),
                render: (i) => (
                  <span className="text-xs">
                    {i.evidence ?? ""}
                    {i.doneOn
                      ? ` · ${formatDate(i.doneOn, lang, { short: true })}`
                      : ""}
                  </span>
                ),
              },
              {
                key: "act",
                label: "",
                align: "right",
                render: (i) =>
                  manage && i.state === "open" ? (
                    <Button
                      variant="ghost"
                      className="min-h-8 px-2 py-1 text-xs"
                      onClick={() => setClosing(i)}
                    >
                      {t("cp.close")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Panel>
      {adding && (
        <AddDialog
          companyId={company.id}
          onClose={() => setAdding(false)}
          onDone={() => (setAdding(false), items.reload())}
        />
      )}
      {closing && (
        <CloseDialog
          item={closing}
          onClose={() => setClosing(null)}
          onDone={() => (setClosing(null), items.reload())}
        />
      )}
    </div>
  );
}

function AddDialog({
  companyId,
  onClose,
  onDone,
}: {
  companyId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({ title: "", dueDate: dhakaToday(), note: "" });
  return (
    <Modal title={t("cp.add")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/companies/${companyId}/compliance`, {
                title: f.title,
                dueDate: f.dueDate,
                ...(f.note ? { note: f.note } : {}),
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("cp.what")}>
          <Input
            required
            maxLength={200}
            value={f.title}
            onChange={(e) => setF({ ...f, title: e.target.value })}
            id="cp-title"
          />
        </Field>
        <Field label={t("cp.due")}>
          <Input
            type="date"
            required
            value={f.dueDate}
            onChange={(e) => setF({ ...f, dueDate: e.target.value })}
            id="cp-due"
          />
        </Field>
        <Field label={t("as.note")}>
          <Input
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="cp-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cp.add")}
        />
      </form>
    </Modal>
  );
}

function CloseDialog({
  item,
  onClose,
  onDone,
}: {
  item: ComplianceItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    state: "done",
    doneOn: dhakaToday(),
    evidence: "",
  });
  return (
    <Modal title={item.title} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save.run(() => api.post(`/compliance/${item.id}/close`, f)))
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("cp.closeAs")}>
          <Select
            value={f.state}
            onChange={(e) => setF({ ...f, state: e.target.value })}
            id="cp-state"
          >
            <option value="done">{t("cp.state.done")}</option>
            <option value="not_applicable">
              {t("cp.state.not_applicable")}
            </option>
          </Select>
        </Field>
        <Field label={t("cp.doneOn")}>
          <Input
            type="date"
            required
            value={f.doneOn}
            onChange={(e) => setF({ ...f, doneOn: e.target.value })}
            id="cp-done-on"
          />
        </Field>
        <Field label={t("cp.evidence")}>
          <Input
            required
            maxLength={500}
            value={f.evidence}
            onChange={(e) => setF({ ...f, evidence: e.target.value })}
            id="cp-evidence"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("cp.close")}
        />
      </form>
    </Modal>
  );
}
