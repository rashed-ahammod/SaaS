"use client";
/** Sales territories (Admin): districts and the salespeople who take their leads in turn; the pipeline stages (WP24). */
import { useState } from "react";
import { SalespersonSelect } from "@/components/portal/crm";
import { StagesPanel } from "@/components/portal/opportunities";
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
import { Badge, Button, ErrorBox, Field, Input } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { DISTRICTS, type Territory } from "@/lib/crm-types";
import { useI18n } from "@/lib/i18n";

export default function TerritoriesPage() {
  const { t } = useI18n();
  const { company, can } = usePortal();
  const list = useApi<Territory[]>(
    company ? `/companies/${company.id}/sales-territories` : null,
  );
  const [editing, setEditing] = useState<Territory | "new" | null>(null);
  if (!company) return null;
  const manage = can("crm.manage");
  return (
    <div>
      <PageHeader
        title={t("cr.territories")}
        subtitle={company.legalName}
        actions={
          manage && (
            <Button onClick={() => setEditing("new")}>
              {t("cr.newTerritory")}
            </Button>
          )
        }
      />
      <Panel>
        <p className="mb-3 text-sm text-slate-600">{t("cr.territoryHint")}</p>
        {list.error ? (
          <ErrorBox error={list.error} onRetry={list.reload} />
        ) : (
          <Table
            rows={list.data}
            rowKey={(x) => x.id}
            empty={t("st.none")}
            onRowClick={manage ? (x) => setEditing(x) : undefined}
            columns={[
              {
                key: "code",
                label: t("cr.code"),
                className: "font-mono",
                render: (x) => x.code,
              },
              {
                key: "name",
                label: t("cr.name"),
                render: (x) => (
                  <span>
                    {x.name} {!x.isActive && <Badge color="gray">—</Badge>}
                  </span>
                ),
              },
              {
                key: "districts",
                label: t("cr.districts"),
                render: (x) => (
                  <span className="text-sm">{x.districts.join(", ")}</span>
                ),
              },
              {
                key: "members",
                label: t("cr.members"),
                render: (x) => x.members.map((m) => m.name).join(", "),
              },
            ]}
          />
        )}
      </Panel>
      <StagesPanel companyId={company.id} />
      {editing && (
        <TerritoryDialog
          companyId={company.id}
          territory={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => (setEditing(null), list.reload())}
        />
      )}
    </div>
  );
}

function TerritoryDialog({
  companyId,
  territory,
  onClose,
  onDone,
}: {
  companyId: string;
  territory: Territory | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    code: territory?.code ?? "",
    name: territory?.name ?? "",
    districts: territory?.districts ?? [],
    memberIds: territory?.members.map((m) => m.userId) ?? [],
  });
  const [adding, setAdding] = useState("");
  return (
    <Modal
      title={
        territory
          ? `${territory.code} · ${territory.name}`
          : t("cr.newTerritory")
      }
      open
      onClose={onClose}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = territory
            ? await save.run(() =>
                api.put(`/sales-territories/${territory.id}`, {
                  ...f,
                  version: territory.version,
                }),
              )
            : await save.run(() =>
                api.post(`/companies/${companyId}/sales-territories`, f),
              );
          if (ok) onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("cr.code")}>
            <Input
              required
              disabled={!!territory}
              pattern="[A-Z0-9-]{1,20}"
              value={f.code}
              onChange={(e) =>
                setF({ ...f, code: e.target.value.toUpperCase() })
              }
              id="territory-code"
            />
          </Field>
          <Field label={t("cr.name")}>
            <Input
              required
              maxLength={100}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              id="territory-name"
            />
          </Field>
        </div>
        <fieldset className="mb-3">
          <legend className="mb-1 text-sm font-medium text-slate-700">
            {t("cr.districts")}
          </legend>
          <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 text-sm sm:grid-cols-4">
            {DISTRICTS.map((d) => (
              <label key={d} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={f.districts.includes(d)}
                  onChange={(e) =>
                    setF({
                      ...f,
                      districts: e.target.checked
                        ? [...f.districts, d]
                        : f.districts.filter((x) => x !== d),
                    })
                  }
                />{" "}
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={t("cr.members")}>
          <div className="flex gap-2">
            <SalespersonSelect
              companyId={companyId}
              value={adding}
              onChange={setAdding}
              id="territory-member"
              allowAuto="—"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!adding}
              onClick={() => (
                setF({
                  ...f,
                  memberIds: [...new Set([...f.memberIds, adding])],
                }),
                setAdding("")
              )}
            >
              +
            </Button>
          </div>
        </Field>
        <ul className="mb-3 text-sm">
          {f.memberIds.map((id) => (
            <li key={id} className="flex items-center gap-2">
              <span className="font-mono text-xs">
                {territory?.members.find((m) => m.userId === id)?.name ??
                  id.slice(0, 8)}
              </span>
              <button
                type="button"
                className="text-red-700"
                onClick={() =>
                  setF({ ...f, memberIds: f.memberIds.filter((x) => x !== id) })
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={territory ? t("p.save") : t("cr.newTerritory")}
        />
      </form>
    </Modal>
  );
}
