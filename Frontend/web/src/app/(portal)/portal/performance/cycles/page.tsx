"use client";
/**
 * Appraisal cycles (Phase 3 WP30): the cycles a company has run, the phase each one is in,
 * and HR starting a new one.
 */
import { useRouter } from "next/navigation";
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
import {
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Select,
  TextArea,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  CYCLE_KINDS,
  CYCLE_STATE_COLOR,
  type CycleRow,
} from "@/lib/performance-types";

export default function CyclesPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const [creating, setCreating] = useState(false);
  const cycles = useApi<{ cycles: CycleRow[] }>(
    company ? `/companies/${company.id}/appraisal-cycles` : null,
  );
  if (!company) return null;
  return (
    <div>
      <PageHeader
        title={t("pf.cycles")}
        subtitle={company.legalName}
        actions={
          can("performance.manage") && (
            <Button onClick={() => setCreating(true)}>{t("pf.newCycle")}</Button>
          )
        }
      />
      <Panel>
        {cycles.error ? (
          <ErrorBox error={cycles.error} onRetry={cycles.reload} />
        ) : (
          <Table
            rows={cycles.data?.cycles}
            rowKey={(c) => c.id}
            empty={t("st.none")}
            onRowClick={(c) => router.push(`/portal/performance/cycles/${c.id}`)}
            columns={[
              { key: "name", label: t("pf.name"), render: (c) => c.name },
              {
                key: "kind",
                label: t("pf.kind"),
                render: (c) => t(`pf.kind.${c.kind}`),
              },
              {
                key: "period",
                label: t("pf.period"),
                render: (c) => `${c.periodFrom} – ${c.periodTo}`,
              },
              {
                key: "state",
                label: t("pf.state"),
                render: (c) => (
                  <Badge color={CYCLE_STATE_COLOR[c.state]}>
                    {t(`pf.state.${c.state}`)}
                  </Badge>
                ),
              },
              {
                key: "appraisals",
                label: t("pf.appraisals"),
                align: "right",
                render: (c) => c.appraisals,
              },
              {
                key: "increment",
                label: t("pf.incrementFrom"),
                render: (c) => c.incrementFrom ?? "—",
              },
            ]}
          />
        )}
      </Panel>
      {creating && (
        <CycleDialog
          companyId={company.id}
          onClose={() => setCreating(false)}
          onDone={(id) => router.push(`/portal/performance/cycles/${id}`)}
        />
      )}
    </div>
  );
}

function CycleDialog({
  companyId,
  onClose,
  onDone,
}: {
  companyId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    name: "",
    kind: "annual",
    periodFrom: "",
    periodTo: "",
    incrementFrom: "",
    note: "",
  });
  return (
    <Modal title={t("pf.newCycle")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const created = await save.run(() =>
            api.post<{ id: string }>(
              `/companies/${companyId}/appraisal-cycles`,
              {
                name: f.name,
                kind: f.kind,
                periodFrom: f.periodFrom,
                periodTo: f.periodTo,
                ...(f.incrementFrom ? { incrementFrom: f.incrementFrom } : {}),
                ...(f.note ? { note: f.note } : {}),
              },
            ),
          );
          if (created && typeof created === "object") onDone(created.id);
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("pf.name")}>
          <Input
            required
            maxLength={100}
            id="cycle-name"
            placeholder="2025-26 annual"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("pf.kind")}>
            <Select
              id="cycle-kind"
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value })}
            >
              {CYCLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`pf.kind.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("pf.incrementFrom")}>
            <Input
              type="date"
              id="cycle-increment"
              value={f.incrementFrom}
              onChange={(e) => setF({ ...f, incrementFrom: e.target.value })}
            />
          </Field>
          <Field label={t("pf.periodFrom")}>
            <Input
              required
              type="date"
              id="cycle-from"
              value={f.periodFrom}
              onChange={(e) => setF({ ...f, periodFrom: e.target.value })}
            />
          </Field>
          <Field label={t("pf.periodTo")}>
            <Input
              required
              type="date"
              id="cycle-to"
              value={f.periodTo}
              onChange={(e) => setF({ ...f, periodTo: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t("pf.note")}>
          <TextArea
            rows={2}
            maxLength={1000}
            id="cycle-note"
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("pf.newCycle")}
        />
      </form>
    </Modal>
  );
}
