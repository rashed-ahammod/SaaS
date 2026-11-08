"use client";
/** Integrations: outgoing events that gave up (replay once the cause is fixed), e-mail / SMS that did not go out, and the service keys of n8n and devices. */
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
import { Badge, Button, Field, Input } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatDate, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function IntegrationsPage() {
  const { t, lang } = useI18n();
  const dead = useApi<
    Array<{
      id: string;
      type: string;
      attempts: number;
      lastError: string | null;
      createdAt: string;
    }>
  >("/integrations/outbox?status=dead");
  const failed = useApi<
    Array<{
      id: string;
      event_type: string;
      kind: string;
      channel: string;
      attempts: number;
      provider: string | null;
      last_error: string | null;
      created_at: string;
    }>
  >("/notifications/deliveries?status=failed");
  const action = useAction();
  return (
    <div>
      <PageHeader title={t("p.int.title")} />
      <ActionMessage action={action} />
      <Panel title={t("p.int.outbox")}>
        <Table
          rows={dead.data}
          rowKey={(e) => e.id}
          columns={[
            {
              key: "type",
              label: t("p.int.event"),
              render: (e) => (
                <span className="font-mono text-xs">{e.type}</span>
              ),
            },
            {
              key: "attempts",
              label: t("p.int.attempts"),
              align: "right",
              render: (e) => num(e.attempts, lang),
            },
            {
              key: "error",
              label: t("p.int.error"),
              render: (e) => (
                <span className="text-xs text-red-700">{e.lastError}</span>
              ),
            },
            {
              key: "date",
              label: t("p.date"),
              render: (e) =>
                formatDate(e.createdAt.slice(0, 10), lang, { short: true }),
            },
            {
              key: "act",
              label: "",
              align: "right",
              render: (e) => (
                <Button
                  variant="secondary"
                  className="min-h-8 px-2 py-1 text-sm"
                  onClick={() =>
                    action
                      .run(
                        () => api.post(`/integrations/outbox/${e.id}/replay`),
                        t("p.done"),
                      )
                      .then(dead.reload)
                  }
                >
                  {t("p.int.replay")}
                </Button>
              ),
            },
          ]}
        />
      </Panel>
      <Panel title={t("p.int.deliveries")}>
        <Table
          rows={failed.data}
          rowKey={(n) => n.id}
          columns={[
            {
              key: "event",
              label: t("p.int.event"),
              render: (n) => (
                <span className="font-mono text-xs">
                  {n.event_type} · {n.kind}
                </span>
              ),
            },
            {
              key: "channel",
              label: t("p.int.channel"),
              render: (n) => <Badge>{n.channel}</Badge>,
            },
            {
              key: "attempts",
              label: t("p.int.attempts"),
              align: "right",
              render: (n) => num(n.attempts, lang),
            },
            {
              key: "error",
              label: t("p.int.error"),
              render: (n) => (
                <span className="text-xs text-red-700">{n.last_error}</span>
              ),
            },
            {
              key: "date",
              label: t("p.date"),
              render: (n) =>
                formatDate(n.created_at.slice(0, 10), lang, { short: true }),
            },
          ]}
        />
      </Panel>
      <ServiceKeys />
    </div>
  );
}

interface ServiceKey {
  id: string;
  name: string;
  permissions: string[];
  companyId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** The keys n8n and attendance devices call the API with (each only its listed permissions); the secret is shown once. */
function ServiceKeys() {
  const { t, lang } = useI18n();
  const { company } = usePortal();
  const keys = useApi<ServiceKey[]>("/service-keys");
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", permissions: "" });
  return (
    <Panel
      title={t("ac.serviceKeys")}
      actions={
        <Button onClick={() => setAdding(true)}>{t("ac.newKey")}</Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">{t("ac.serviceKeysHint")}</p>
      <ActionMessage action={action} />
      {shown && (
        <p
          className="mb-3 break-all rounded-lg bg-amber-50 p-3 font-mono text-xs text-amber-900"
          role="status"
        >
          {t("ac.keyShown")} {shown}
        </p>
      )}
      <Table
        rows={keys.data}
        rowKey={(k) => k.id}
        empty={t("st.none")}
        columns={[
          { key: "name", label: t("ac.name"), render: (k) => k.name },
          {
            key: "perms",
            label: t("ac.permissions"),
            render: (k) => (
              <span className="font-mono text-xs">
                {k.permissions.join(", ")}
              </span>
            ),
          },
          {
            key: "used",
            label: t("ac.lastUsed"),
            render: (k) =>
              k.lastUsedAt
                ? formatDate(k.lastUsedAt.slice(0, 10), lang, { short: true })
                : "—",
          },
          {
            key: "act",
            label: "",
            align: "right",
            render: (k) =>
              k.revokedAt ? (
                <Badge color="gray">{t("ac.revoked")}</Badge>
              ) : (
                <Button
                  variant="ghost"
                  className="min-h-8 px-2 py-1 text-sm text-red-700"
                  onClick={() => {
                    const reason = window.prompt(t("p.reason"));
                    if (reason)
                      void action
                        .run(
                          () =>
                            api.post(`/service-keys/${k.id}/revoke`, {
                              reason,
                            }),
                          t("p.done"),
                        )
                        .then(keys.reload);
                  }}
                >
                  {t("ac.revoke")}
                </Button>
              ),
          },
        ]}
      />
      {adding && (
        <Modal title={t("ac.newKey")} open onClose={() => setAdding(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const body = {
                name: f.name,
                permissions: f.permissions.split(/[\s,]+/).filter(Boolean),
                ...(company ? { companyId: company.id } : {}),
              };
              const k = await action.run(() =>
                api.post<{ authorizationHeader: string }>(
                  "/service-keys",
                  body,
                ),
              );
              if (k && typeof k === "object") {
                setShown(k.authorizationHeader);
                setAdding(false);
                keys.reload();
              }
            }}
          >
            <Field label={t("ac.name")}>
              <Input
                required
                maxLength={100}
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
                id="key-name"
                placeholder="n8n website leads"
              />
            </Field>
            <Field label={t("ac.permissions")}>
              <Input
                required
                value={f.permissions}
                onChange={(e) => setF({ ...f, permissions: e.target.value })}
                id="key-perms"
                placeholder="crm.capture"
              />
            </Field>
            <FormButtons
              busy={action.busy}
              onCancel={() => setAdding(false)}
              submitLabel={t("ac.newKey")}
            />
          </form>
        </Modal>
      )}
    </Panel>
  );
}
