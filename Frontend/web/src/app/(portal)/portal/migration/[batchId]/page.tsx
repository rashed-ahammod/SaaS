"use client";
/** One migration upload: rows with their errors, skip, dry run, commit, roll back, discard. */
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import {
  ActionMessage,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Stat,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import {
  Alert,
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { Batch } from "@/lib/portal-types";

interface Row {
  rowNo: number;
  status: "valid" | "error" | "skipped" | "committed" | "rolled_back";
  errors: Array<{ column: string; message: string }>;
  skipReason: string | null;
  data: Record<string, string>;
}

interface DryRun {
  willCreate: number;
  skipped: number;
  canCommit: boolean;
  totals: Record<string, unknown>;
}

export default function BatchPage({
  params,
}: PageProps<"/portal/migration/[batchId]">) {
  const { batchId } = use(params);
  const { t, lang } = useI18n();
  const router = useRouter();
  const { can } = usePortal();
  const batch = useApi<Batch & { rows: Row[] }>(`/imports/${batchId}`);
  const action = useAction();
  const [dry, setDry] = useState<DryRun | null>(null);
  const [skipping, setSkipping] = useState<number | null>(null);
  const [reasonFor, setReasonFor] = useState<"rollback" | null>(null);

  if (batch.loading && !batch.data) return <Loading />;
  if (batch.error)
    return <ErrorBox error={batch.error} onRetry={batch.reload} />;
  const b = batch.data!;
  const manage = can("data.import");
  const columns = Object.keys(b.rows[0]?.data ?? {}).slice(0, 6);

  return (
    <div>
      <PageHeader
        title={`${t("p.mig.title")}: ${b.entity}`}
        subtitle={b.fileName}
        actions={
          manage && (
            <>
              {b.state === "validated" && (
                <>
                  <Button
                    variant="secondary"
                    busy={action.busy}
                    onClick={() =>
                      action.run(async () =>
                        setDry(
                          await api.get<DryRun>(`/imports/${batchId}/dry-run`),
                        ),
                      )
                    }
                  >
                    {t("p.mig.dryRun")}
                  </Button>
                  <Button
                    busy={action.busy}
                    disabled={b.counts.errors > 0}
                    onClick={() =>
                      action
                        .run(
                          () => api.post(`/imports/${batchId}/commit`),
                          t("p.mig.committed"),
                        )
                        .then(batch.reload)
                    }
                  >
                    {t("p.mig.commit")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      action
                        .run(() => api.post(`/imports/${batchId}/discard`))
                        .then((ok) => ok && router.push("/portal/migration"))
                    }
                  >
                    {t("p.mig.discard")}
                  </Button>
                </>
              )}
              {b.state === "committed" && (
                <Button
                  variant="danger"
                  onClick={() => setReasonFor("rollback")}
                >
                  {t("p.mig.rollback")}
                </Button>
              )}
            </>
          )
        }
      />
      <ActionMessage action={action} />
      {dry && (
        <Alert kind={dry.canCommit ? "success" : "warning"}>
          {t("p.mig.willCreate", { n: num(dry.willCreate, lang) })}
          <pre className="mt-2 overflow-x-auto text-xs">
            {JSON.stringify(dry.totals, null, 2)}
          </pre>
        </Alert>
      )}
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label={t("p.mig.rows")} value={num(b.counts.total, lang)} />
        <Stat
          label={t("p.mig.valid")}
          value={num(b.counts.valid, lang)}
          tone="good"
        />
        <Stat
          label={t("p.mig.errors")}
          value={num(b.counts.errors, lang)}
          tone={b.counts.errors ? "warn" : "default"}
        />
        <Stat label={t("p.mig.skipped")} value={num(b.counts.skipped, lang)} />
      </div>
      <Panel
        title={
          <Badge color={b.state === "committed" ? "green" : "amber"}>
            {t(`p.mig.state.${b.state}`)}
          </Badge>
        }
      >
        <Table
          rows={b.rows}
          rowKey={(r) => String(r.rowNo)}
          columns={[
            {
              key: "rowNo",
              label: t("p.mig.row"),
              align: "right",
              render: (r) => num(r.rowNo, lang),
            },
            {
              key: "status",
              label: t("p.status"),
              render: (r) => (
                <Badge
                  color={
                    r.status === "error"
                      ? "red"
                      : r.status === "skipped"
                        ? "gray"
                        : "green"
                  }
                >
                  {r.status}
                </Badge>
              ),
            },
            ...columns.map((col) => ({
              key: col,
              label: col,
              render: (r: Row) => (
                <span className="text-xs">{r.data[col]}</span>
              ),
            })),
            {
              key: "errors",
              label: t("p.mig.errors"),
              render: (r) => (
                <span className="text-xs text-red-700">
                  {r.errors.map((e) => `${e.column}: ${e.message}`).join(" · ")}
                  {r.skipReason && (
                    <span className="text-slate-500">{r.skipReason}</span>
                  )}
                </span>
              ),
            },
            {
              key: "act",
              label: "",
              align: "right",
              render: (r) =>
                manage && b.state === "validated" && r.status === "error" ? (
                  <Button
                    variant="ghost"
                    className="min-h-8 px-2 py-1 text-sm"
                    onClick={() => setSkipping(r.rowNo)}
                  >
                    {t("p.mig.skip")}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Panel>
      {skipping !== null && (
        <ReasonDialog
          title={`${t("p.mig.skip")} ${num(skipping, lang)}`}
          onClose={() => setSkipping(null)}
          onSubmit={(reason) =>
            api.post(`/imports/${batchId}/rows/${skipping}/skip`, { reason })
          }
          onDone={batch.reload}
        />
      )}
      {reasonFor === "rollback" && (
        <ReasonDialog
          title={t("p.mig.rollback")}
          onClose={() => setReasonFor(null)}
          onSubmit={(reason) =>
            api.post(`/imports/${batchId}/rollback`, { reason })
          }
          onDone={batch.reload}
        />
      )}
    </div>
  );
}

function ReasonDialog({
  title,
  onClose,
  onSubmit,
  onDone,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal title={title} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save.run(() => onSubmit(reason))) {
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
            autoFocus
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}
