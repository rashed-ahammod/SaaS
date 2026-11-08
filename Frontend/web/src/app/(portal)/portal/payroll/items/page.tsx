"use client";
/** Monthly items: one-off amounts for a month (commission, arrears, deductions). */
import { useState } from "react";
import {
  ActionMessage,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { usePortal } from "@/components/portal/portal-context";
import { Badge, Button, ErrorBox, Field, Input, Select } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dhakaToday, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { EmployeeSummary, Page } from "@/lib/portal-types";

interface Variable {
  id: string;
  employeeCode: string;
  fullNameEn: string;
  headCode: string;
  amount: string;
  note: string | null;
  status: string;
}

export default function ItemsPage() {
  const { t, lang } = useI18n();
  const { company } = usePortal();
  const c = company ? `/companies/${company.id}` : null;
  const [period, setPeriod] = useState(dhakaToday().slice(0, 7));
  const items = useApi<Variable[]>(
    c && `${c}/payroll-variables?period=${period}`,
  );
  const heads = useApi<{ heads: Array<{ code: string; nameEn: string }> }>(
    c && `${c}/salary-heads`,
  );
  const people = useApi<Page<EmployeeSummary>>(
    company ? `/employees?companyId=${company.id}&pageSize=200` : null,
  );
  const save = useAction();
  const [f, setF] = useState({
    employeeId: "",
    headCode: "",
    amount: "",
    note: "",
  });

  return (
    <div>
      <PageHeader
        title={t("p.items.title")}
        subtitle={t("p.items.hint")}
        actions={
          <Input
            type="month"
            aria-label={t("p.period")}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        }
      />
      <Panel>
        <ActionMessage action={save} />
        <form
          className="mb-4 grid items-end gap-x-3 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = {
              ...f,
              period,
              ...(f.note ? {} : { note: undefined }),
            };
            if (
              await save.run(
                () => api.post(`${c}/payroll-variables`, body),
                t("p.saved"),
              )
            ) {
              setF({ employeeId: "", headCode: "", amount: "", note: "" });
              items.reload();
            }
          }}
        >
          <Field label={t("p.employee")}>
            <Select
              required
              value={f.employeeId}
              onChange={(e) => setF({ ...f, employeeId: e.target.value })}
            >
              <option value="">—</option>
              {people.data?.items
                .filter((p) => p.status !== "separated")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.employeeCode} · {p.fullNameEn}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t("p.items.head")}>
            <Select
              required
              value={f.headCode}
              onChange={(e) => setF({ ...f, headCode: e.target.value })}
            >
              <option value="">—</option>
              {heads.data?.heads.map((h) => (
                <option key={h.code} value={h.code}>
                  {h.code} · {h.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("p.amount")}>
            <Input
              required
              inputMode="decimal"
              pattern="-?\d+(\.\d{1,2})?"
              value={f.amount}
              onChange={(e) => setF({ ...f, amount: e.target.value })}
            />
          </Field>
          <Field label={t("p.note")}>
            <Input
              maxLength={300}
              value={f.note}
              onChange={(e) => setF({ ...f, note: e.target.value })}
            />
          </Field>
          <div className="mb-3">
            <Button type="submit" busy={save.busy} className="w-full">
              {t("p.items.add")}
            </Button>
          </div>
        </form>
        {items.error ? (
          <ErrorBox error={items.error} />
        ) : (
          <Table
            rows={items.data}
            rowKey={(v) => v.id}
            columns={[
              {
                key: "employeeCode",
                label: t("p.code"),
                className: "font-mono whitespace-nowrap",
              },
              { key: "fullNameEn", label: t("p.name") },
              {
                key: "headCode",
                label: t("p.items.head"),
                className: "font-mono text-xs",
              },
              {
                key: "amount",
                label: t("p.amount"),
                align: "right",
                render: (v) => formatTaka(v.amount, lang),
              },
              { key: "note", label: t("p.note") },
              {
                key: "status",
                label: t("p.status"),
                render: (v) => (
                  <Badge
                    color={
                      v.status === "open"
                        ? "blue"
                        : v.status === "paid"
                          ? "green"
                          : "gray"
                    }
                  >
                    {v.status}
                  </Badge>
                ),
              },
              {
                key: "act",
                label: "",
                align: "right",
                render: (v) =>
                  v.status === "open" ? (
                    <Button
                      variant="ghost"
                      className="min-h-8 px-2 py-1 text-sm"
                      onClick={() => {
                        const reason = window.prompt(t("p.reason"));
                        if (reason)
                          void save
                            .run(
                              () =>
                                api.post(`/payroll-variables/${v.id}/cancel`, {
                                  reason,
                                }),
                              t("p.done"),
                            )
                            .then(items.reload);
                      }}
                    >
                      {t("p.items.cancel")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}
