"use client";
/** AI (WP11) for the Admin and HR: switches, usage against the quota, the policy documents the assistant answers from, recent answers. */
import { useState } from "react";
import {
  ActionMessage,
  Detail,
  PageHeader,
  Panel,
  Stat,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, Button, Field, Input, Select, TextArea } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { formatDate, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

interface Settings {
  provider: string;
  model: string | null;
  planTier: string;
  enabled: boolean;
  assistantEnabled: boolean;
  payrollExplanationsEnabled: boolean;
  bankMatchSuggestionsEnabled: boolean;
  documentReaderEnabled: boolean;
  monthlyQuota: number;
}

interface Usage {
  quota: number;
  used: number;
  features: Array<{
    feature: string;
    calls: number;
    answered: number;
    failed: number;
    notHelpful: number;
    notHelpfulRate: number | null;
  }>;
}

export default function AiPage() {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const manage = can("ai.manage");
  const settings = useApi<Settings>(manage ? "/ai/settings" : null);
  const usage = useApi<Usage>(manage ? "/ai/usage" : null);
  const log = useApi<
    Array<{
      id: string;
      at: string;
      userEmail: string;
      feature: string;
      input: string;
      output: string | null;
      status: string;
      humanAction: string | null;
    }>
  >(can("ai.manage", "audit.view") ? "/ai/interactions?limit=20" : null);
  const docs = useApi<
    Array<{
      id: string;
      title: string;
      language: string;
      chunks: number;
      active: boolean;
      createdAt: string;
    }>
  >(can("ai.policies.manage") ? "/ai/policy-documents" : null);
  const action = useAction();
  const [doc, setDoc] = useState({ title: "", language: "en", body: "" });

  const toggle = (
    key:
      | "enabled"
      | "assistantEnabled"
      | "payrollExplanationsEnabled"
      | "bankMatchSuggestionsEnabled"
      | "documentReaderEnabled",
    value: boolean,
  ) =>
    action
      .run(() => api.put("/ai/settings", { [key]: value }), t("p.saved"))
      .then(() => (settings.reload(), usage.reload()));

  return (
    <div>
      <PageHeader title={t("p.ai.title")} />
      <ActionMessage action={action} />
      {settings.data && (
        <Panel title={t("p.ai.settings")}>
          <dl className="mb-4 grid gap-4 sm:grid-cols-3">
            <Detail label={t("p.ai.provider")}>
              {settings.data.provider}{" "}
              {settings.data.model && `· ${settings.data.model}`}
            </Detail>
            <Detail label={t("p.ai.plan")}>{settings.data.planTier}</Detail>
          </dl>
          {(
            [
              "enabled",
              "assistantEnabled",
              "payrollExplanationsEnabled",
              "bankMatchSuggestionsEnabled",
              "documentReaderEnabled",
            ] as const
          ).map((key) => (
            <label key={key} className="mb-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.data![key]}
                onChange={(e) => toggle(key, e.target.checked)}
              />
              {t(
                {
                  enabled: "p.ai.enabled",
                  assistantEnabled: "p.ai.assistant",
                  payrollExplanationsEnabled: "p.ai.flags",
                  bankMatchSuggestionsEnabled: "bk.ai.feature",
                  documentReaderEnabled: "cl.ai.feature",
                }[key],
              )}
            </label>
          ))}
        </Panel>
      )}
      {usage.data && (
        <Panel title={t("p.ai.usage")}>
          <p className="mb-3 text-sm text-slate-600">
            {t("p.ai.used", {
              used: num(usage.data.used, lang),
              quota: num(usage.data.quota, lang),
            })}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {usage.data.features.map((f) => (
              <Stat
                key={f.feature}
                label={t(
                  {
                    assistant: "p.ai.assistant",
                    payroll_flag_explanation: "p.ai.flags",
                    bank_match_suggestion: "bk.ai.feature",
                    document_reader: "cl.ai.feature",
                  }[f.feature] ?? f.feature,
                )}
                value={num(f.calls, lang)}
                hint={`${t("p.ai.answered")} ${num(f.answered, lang)} · ${t("p.ai.failed")} ${num(f.failed, lang)} · ${t("p.ai.notHelpful")} ${num(f.notHelpful, lang)}`}
                tone={
                  f.notHelpfulRate !== null && f.notHelpfulRate > 0.3
                    ? "warn"
                    : "default"
                }
              />
            ))}
          </div>
        </Panel>
      )}
      {docs.data && (
        <Panel title={t("p.ai.policies")}>
          <p className="mb-3 text-sm text-slate-500">{t("p.ai.policyHint")}</p>
          <Table
            rows={docs.data}
            rowKey={(d) => d.id}
            columns={[
              { key: "title", label: t("p.ai.titleField") },
              { key: "language", label: t("p.ai.language") },
              {
                key: "chunks",
                label: t("p.ai.pieces"),
                align: "right",
                render: (d) => num(d.chunks, lang),
              },
              {
                key: "active",
                label: t("p.status"),
                render: (d) => (
                  <Badge color={d.active ? "green" : "gray"}>
                    {d.active ? t("p.ai.active") : t("p.ai.retired")}
                  </Badge>
                ),
              },
              {
                key: "date",
                label: t("p.date"),
                render: (d) =>
                  formatDate(d.createdAt.slice(0, 10), lang, { short: true }),
              },
              {
                key: "act",
                label: "",
                align: "right",
                render: (d) =>
                  d.active ? (
                    <Button
                      variant="ghost"
                      className="min-h-8 px-2 py-1 text-sm"
                      onClick={() =>
                        action
                          .run(
                            () =>
                              api.post(
                                `/ai/policy-documents/${d.id}/deactivate`,
                              ),
                            t("p.done"),
                          )
                          .then(docs.reload)
                      }
                    >
                      {t("p.ai.retire")}
                    </Button>
                  ) : null,
              },
            ]}
          />
          <form
            className="mt-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await action.run(
                  () => api.post("/ai/policy-documents", doc),
                  t("p.saved"),
                )
              ) {
                setDoc({ title: "", language: "en", body: "" });
                docs.reload();
              }
            }}
          >
            <div className="grid gap-x-4 sm:grid-cols-3">
              <Field label={t("p.ai.titleField")}>
                <Input
                  required
                  maxLength={200}
                  value={doc.title}
                  onChange={(e) => setDoc({ ...doc, title: e.target.value })}
                />
              </Field>
              <Field label={t("p.ai.language")}>
                <Select
                  value={doc.language}
                  onChange={(e) => setDoc({ ...doc, language: e.target.value })}
                >
                  <option value="en">English</option>
                  <option value="bn">বাংলা</option>
                </Select>
              </Field>
            </div>
            <Field label={t("p.ai.body")}>
              <TextArea
                rows={8}
                required
                value={doc.body}
                onChange={(e) => setDoc({ ...doc, body: e.target.value })}
              />
            </Field>
            <Button type="submit" busy={action.busy}>
              {t("p.ai.addPolicy")}
            </Button>
          </form>
        </Panel>
      )}
      {log.data && (
        <Panel title={t("p.ai.log")}>
          <Table
            rows={log.data}
            rowKey={(l) => l.id}
            columns={[
              {
                key: "at",
                label: t("p.date"),
                render: (l) =>
                  formatDate(l.at.slice(0, 10), lang, { short: true }),
              },
              {
                key: "user",
                label: t("p.audit.actor"),
                render: (l) => <span className="text-xs">{l.userEmail}</span>,
              },
              {
                key: "input",
                label: t("p.ai.body"),
                render: (l) => <span className="text-xs">{l.input}</span>,
              },
              {
                key: "output",
                label: "",
                render: (l) => (
                  <span className="text-xs text-slate-600">
                    {l.output?.slice(0, 200)}
                  </span>
                ),
              },
              {
                key: "status",
                label: t("p.status"),
                render: (l) => (
                  <Badge color={l.status === "ok" ? "green" : "red"}>
                    {l.status}
                  </Badge>
                ),
              },
              {
                key: "human",
                label: "",
                render: (l) =>
                  l.humanAction === "helpful"
                    ? "👍"
                    : l.humanAction === "not_helpful"
                      ? "👎"
                      : "",
              },
            ]}
          />
        </Panel>
      )}
    </div>
  );
}
