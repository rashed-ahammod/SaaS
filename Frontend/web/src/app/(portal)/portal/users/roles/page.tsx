"use client";
/**
 * Roles: the fixed system roles and the company's custom roles (a system role
 * with fewer permissions).
 *
 * A permission is shown as the sentence it means ("Verify payroll runs"), not as
 * the key behind it ("payroll.verify"), and the sentences come from
 * GET /permissions in both languages. They are grouped by the part of the
 * business they belong to, because a list of eighty ticks in key order is not a
 * thing anyone can read.
 */
import { useMemo, useState } from "react";
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
  Loading,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

interface Role {
  type: "system" | "custom";
  key?: string;
  id?: string;
  nameEn: string;
  nameBn?: string | null;
  basedOn?: string;
  allowedScopes?: string[];
  timeLimited?: boolean;
  permissions: string[];
  isActive?: boolean;
  version?: number;
}

interface Permission {
  key: string;
  description: string;
  descriptionBn: string;
}

/**
 * Which part of the business a permission belongs to, by the start of its key.
 * The first match wins, so the longer prefixes come first.
 */
const GROUP_OF: Array<[string, string]> = [
  ["org.", "org"],
  ["employee.", "people"],
  ["users.", "access"],
  ["roles.", "access"],
  ["attendance.", "time"],
  ["leave.", "time"],
  ["payroll.", "payroll"],
  ["payslip.", "payroll"],
  ["crm.", "sales"],
  ["sales.", "sales"],
  ["receivables.", "sales"],
  ["ledger.", "money"],
  ["payables.", "money"],
  ["expenses.", "money"],
  ["procurement.", "money"],
  ["budgets.", "money"],
  ["assets.", "money"],
  ["stock.", "money"],
  ["bank.", "money"],
  ["vat.", "money"],
  ["compliance.", "money"],
];
const GROUP_ORDER = [
  "org",
  "people",
  "access",
  "time",
  "payroll",
  "sales",
  "money",
  "admin",
];
const groupOf = (key: string) =>
  GROUP_OF.find(([prefix]) => key.startsWith(prefix))?.[1] ?? "admin";

export default function RolesPage() {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const roles = useApi<Role[]>("/roles");
  const permissions = useApi<Permission[]>("/permissions");
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  if (roles.loading && !roles.data) return <Loading />;
  if (roles.error)
    return <ErrorBox error={roles.error} onRetry={roles.reload} />;
  const manage = can("roles.manage");
  const name = (r: Role) => (lang === "bn" ? (r.nameBn ?? r.nameEn) : r.nameEn);

  return (
    <div>
      <PageHeader
        title={t("ac.roles")}
        actions={
          manage && (
            <Button onClick={() => setEditing("new")}>{t("ac.newRole")}</Button>
          )
        }
      />
      <p className="mb-4 text-sm text-slate-600">{t("ac.rolesHint")}</p>
      <Panel>
        <Table
          rows={roles.data}
          rowKey={(r) => r.id ?? r.key!}
          onRowClick={
            manage
              ? (r) => (r.type === "custom" ? setEditing(r) : setEditing(r))
              : undefined
          }
          columns={[
            {
              key: "name",
              label: t("ac.name"),
              render: (r) => (
                <span>
                  {name(r)}
                  {/* what the role is for: the line the system roles have, or the base of a custom one */}
                  <span className="block text-xs text-slate-500">
                    {r.type === "system"
                      ? t(`ac.roleAbout.${r.key}`)
                      : `${t("ac.basedOn")}: ${roles.data?.find((s) => s.key === r.basedOn) ? name(roles.data.find((s) => s.key === r.basedOn)!) : r.basedOn}`}
                  </span>
                </span>
              ),
            },
            {
              key: "type",
              label: "",
              render: (r) => (
                <Badge color={r.type === "system" ? "gray" : "blue"}>
                  {t(r.type === "system" ? "ac.system" : "ac.custom")}
                </Badge>
              ),
            },
            {
              key: "perms",
              label: t("ac.permissions"),
              className: "tabular-nums",
              render: (r) => num(r.permissions.length, lang),
            },
            {
              key: "scopes",
              label: t("ac.roleScopes"),
              render: (r) =>
                (r.allowedScopes ?? [])
                  .map((s) => t(`p.users.scope.${s}`))
                  .join(", "),
            },
            {
              key: "active",
              label: t("ac.active"),
              render: (r) =>
                r.type === "custom" ? (
                  r.isActive ? (
                    <Badge color="green">✓</Badge>
                  ) : (
                    <Badge color="gray">—</Badge>
                  )
                ) : (
                  ""
                ),
            },
          ]}
        />
      </Panel>
      {editing && (
        <RoleDialog
          role={editing === "new" ? null : editing}
          system={(roles.data ?? []).filter((r) => r.type === "system")}
          permissions={permissions.data ?? []}
          canEdit={manage}
          onClose={() => setEditing(null)}
          onDone={() => (setEditing(null), roles.reload())}
        />
      )}
    </div>
  );
}

function RoleDialog({
  role,
  system,
  permissions,
  canEdit,
  onClose,
  onDone,
}: {
  role: Role | null;
  system: Role[];
  permissions: Permission[];
  canEdit: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const readOnly = role?.type === "system" || !canEdit;
  const [f, setF] = useState({
    nameEn: role?.nameEn ?? "",
    nameBn: role?.nameBn ?? "",
    basedOn: role?.basedOn ?? role?.key ?? "dept_head",
    isActive: role?.isActive ?? true,
  });
  const base = system.find((s) => s.key === f.basedOn);
  const [perms, setPerms] = useState<string[]>(
    role?.permissions ?? base?.permissions ?? [],
  );
  const [q, setQ] = useState("");

  // the permissions on offer are the base role's, described and grouped
  const groups = useMemo(() => {
    const described = (base?.permissions ?? []).map((key) => {
      const p = permissions.find((x) => x.key === key);
      return {
        key,
        text: (lang === "bn" ? p?.descriptionBn : p?.description) ?? key,
      };
    });
    const needle = q.trim().toLowerCase();
    const matching = needle
      ? described.filter((p) =>
          `${p.text} ${p.key}`.toLowerCase().includes(needle),
        )
      : described;
    return GROUP_ORDER.map((g) => ({
      group: g,
      items: matching.filter((p) => groupOf(p.key) === g),
    })).filter((g) => g.items.length > 0);
  }, [base, permissions, lang, q]);

  const toggle = (key: string, on: boolean) =>
    setPerms((list) =>
      on ? [...new Set([...list, key])] : list.filter((x) => x !== key),
    );
  const title = role
    ? lang === "bn"
      ? (role.nameBn ?? role.nameEn)
      : role.nameEn
    : t("ac.newRole");

  return (
    <Modal title={title} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (readOnly) return onClose();
          const body = {
            nameEn: f.nameEn,
            ...(f.nameBn ? { nameBn: f.nameBn } : {}),
            permissions: perms,
          };
          const ok = role
            ? await save.run(() =>
                api.patch(`/roles/${role.id}`, {
                  ...body,
                  isActive: f.isActive,
                  version: role.version,
                }),
              )
            : await save.run(() =>
                api.post("/roles", { ...body, basedOn: f.basedOn }),
              );
          if (ok) onDone();
        }}
      >
        <ActionMessage action={save} />
        {role?.type === "system" ? (
          <p className="mb-3 text-sm text-slate-600">
            {t(`ac.roleAbout.${role.key}`)}
          </p>
        ) : (
          <div className="grid gap-x-3 sm:grid-cols-3">
            <Field label={t("ac.name")}>
              <Input
                required
                maxLength={100}
                value={f.nameEn}
                onChange={(e) => setF({ ...f, nameEn: e.target.value })}
                id="role-name"
                placeholder="Branch accountant"
              />
            </Field>
            <Field label={t("sa.nameBn")}>
              <Input
                maxLength={100}
                value={f.nameBn}
                onChange={(e) => setF({ ...f, nameBn: e.target.value })}
                id="role-name-bn"
              />
            </Field>
            <Field label={t("ac.basedOn")} hint={t("ac.basedOnHint")}>
              <Select
                disabled={!!role}
                value={f.basedOn}
                onChange={(e) => {
                  setF({ ...f, basedOn: e.target.value });
                  setPerms(
                    system.find((s) => s.key === e.target.value)?.permissions ??
                      [],
                  );
                }}
                id="role-base"
              >
                {system.map((s) => (
                  <option key={s.key} value={s.key}>
                    {lang === "bn" ? (s.nameBn ?? s.nameEn) : s.nameEn}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <fieldset className="mb-3">
          <legend className="mb-1 text-sm font-medium text-slate-700">
            {t("ac.permissions")}
          </legend>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Input
              className="max-w-xs"
              aria-label={t("ac.permSearch")}
              placeholder={t("ac.permSearch")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="text-xs text-slate-500">
              {t("ac.permChosen", {
                n: num(perms.length, lang),
                total: num(base?.permissions.length ?? 0, lang),
              })}
            </span>
            {!readOnly && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-8 px-2 py-1 text-xs"
                  onClick={() => setPerms(base?.permissions ?? [])}
                >
                  {t("ac.permAll")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-8 px-2 py-1 text-xs"
                  onClick={() => setPerms([])}
                >
                  {t("ac.permNone")}
                </Button>
              </>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {groups.length === 0 && (
              <p className="p-2 text-sm text-slate-500">
                {t("ac.permNoMatch")}
              </p>
            )}
            {groups.map((g) => (
              <div key={g.group} className="mb-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t(`ac.permGroup.${g.group}`)}
                </p>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {g.items.map((p) => (
                    <li key={p.key}>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          disabled={readOnly}
                          checked={perms.includes(p.key)}
                          onChange={(e) => toggle(p.key, e.target.checked)}
                        />
                        <span>
                          {p.text}
                          <span className="block font-mono text-[10px] text-slate-400">
                            {p.key}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </fieldset>

        {role?.type === "custom" && (
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.isActive}
              onChange={(e) => setF({ ...f, isActive: e.target.checked })}
            />{" "}
            {t("ac.active")}
          </label>
        )}
        {readOnly ? (
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t("p.close")}
            </Button>
          </div>
        ) : (
          <FormButtons
            busy={save.busy}
            onCancel={onClose}
            submitLabel={role ? t("p.save") : t("ac.newRole")}
          />
        )}
      </form>
    </Modal>
  );
}
