"use client";
/**
 * Logins and their roles.
 *
 * The three things an Admin comes here to do are a login's whole life: open it,
 * give it a new password, and close it on the last working day. Each is a route
 * that already existed; this screen is where they finally have a button.
 *
 * Roles are shown by name with one line of what they are for, never as keys, and
 * the roles themselves (names, the scopes each may be granted with, which ones
 * need an end date) come from GET /roles, so the list cannot drift from the API.
 * Granting and revoking is high-risk: the API asks for a 2FA code (step-up), and
 * nobody can grant a role to themselves or disable their own login.
 */
import Link from "next/link";
import { useState } from "react";
import {
  ActionMessage,
  Detail,
  FormButtons,
  Modal,
  PageHeader,
  Panel,
  Table,
  useAction,
} from "@/components/portal/kit";
import { useOrg } from "@/components/portal/org";
import { usePortal } from "@/components/portal/portal-context";
import {
  Alert,
  Badge,
  Button,
  ErrorBox,
  Field,
  Input,
  Loading,
  Select,
} from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { dhakaToday, formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { EmployeeSummary, Page } from "@/lib/portal-types";

interface User {
  id: string;
  email: string;
  status: "active" | "disabled";
  employeeId: string | null;
  phone: string | null;
  preferredLanguage: "bn" | "en" | null;
  mfaEnabled: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  version: number;
}

interface RoleGrant {
  id: string;
  role: string | null;
  customRoleId: string | null;
  scopeType: string;
  scopeId: string | null;
  expiresAt: string | null;
}

interface UserDetail extends User {
  roles: RoleGrant[];
  fieldGrants?: Array<{ id: string; fieldGroup: string; grantedAt: string }>;
}

/** GET /roles: the system roles (fixed) and the company's custom roles. */
interface RoleInfo {
  type: "system" | "custom";
  key?: string;
  id?: string;
  nameEn: string;
  nameBn?: string | null;
  allowedScopes: string[];
  timeLimited?: boolean;
  privileged?: boolean;
  isActive?: boolean;
}

const FIELD_GROUPS = ["salary", "bank", "identity", "complaint"];

export default function UsersPage() {
  const { t, lang } = useI18n();
  const { company } = usePortal();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const users = useApi<User[]>(
    `/users${search ? `?q=${encodeURIComponent(search)}` : ""}`,
  );
  const people = useApi<Page<EmployeeSummary>>(
    company ? `/employees?companyId=${company.id}&pageSize=200` : null,
  );
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const nameOf = (employeeId: string | null) =>
    people.data?.items.find((p) => p.id === employeeId)?.fullNameEn ?? "";

  return (
    <div>
      <PageHeader
        title={t("p.users.title")}
        actions={
          <>
            <Link
              className="self-center text-sm underline"
              href="/portal/users/roles"
            >
              {t("ac.roles")}
            </Link>
            <Button onClick={() => setCreating(true)}>
              {t("p.users.new")}
            </Button>
          </>
        }
      />
      <Panel>
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <Input
            className="max-w-xs"
            aria-label={t("p.search")}
            placeholder={t("p.users.email")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button type="submit" variant="secondary">
            {t("p.search")}
          </Button>
        </form>
        {users.error ? (
          <ErrorBox error={users.error} />
        ) : (
          <Table
            rows={users.data}
            rowKey={(u) => u.id}
            onRowClick={(u) => setOpen(u.id)}
            columns={[
              { key: "email", label: t("p.users.email") },
              {
                key: "employee",
                label: t("p.users.linkEmployee"),
                render: (u) =>
                  nameOf(u.employeeId) || (
                    <span className="text-slate-400">
                      {t("p.users.unlink")}
                    </span>
                  ),
              },
              {
                key: "status",
                label: t("p.status"),
                render: (u) => (
                  <Badge color={u.status === "active" ? "green" : "gray"}>
                    {t(`p.users.status.${u.status}`)}
                  </Badge>
                ),
              },
              {
                key: "mfa",
                label: t("p.users.mfa"),
                render: (u) => (u.mfaEnabled ? "✓" : ""),
              },
              {
                key: "last",
                label: t("p.users.lastLogin"),
                render: (u) =>
                  u.lastLoginAt
                    ? formatDate(u.lastLoginAt.slice(0, 10), lang, {
                        short: true,
                      })
                    : "—",
              },
            ]}
          />
        )}
      </Panel>
      {open && (
        <UserDialog
          id={open}
          onClose={() => setOpen(null)}
          onChanged={users.reload}
        />
      )}
      {creating && (
        <NewUser
          people={people.data?.items ?? []}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            users.reload();
            setOpen(id);
          }}
        />
      )}
    </div>
  );
}

function NewUser({
  people,
  onClose,
  onCreated,
}: {
  people: EmployeeSummary[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    email: "",
    password: "",
    employeeId: "",
    phone: "",
    preferredLanguage: "bn",
  });
  return (
    <Modal title={t("p.users.new")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const user = await save.run(() =>
            api.post<{ id: string }>("/users", {
              email: f.email,
              password: f.password,
              preferredLanguage: f.preferredLanguage,
              ...(f.phone ? { phone: f.phone } : {}),
              ...(f.employeeId ? { employeeId: f.employeeId } : {}),
            }),
          );
          if (user) onCreated(user.id);
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("p.users.email")}>
          <Input
            type="email"
            required
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
        </Field>
        <Field label={t("p.users.password")}>
          <Input
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
          />
        </Field>
        <Field label={t("p.users.linkEmployee")}>
          <Select
            value={f.employeeId}
            onChange={(e) => setF({ ...f, employeeId: e.target.value })}
          >
            <option value="">—</option>
            {people
              .filter((p) => p.status !== "separated")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.employeeCode} · {p.fullNameEn}
                </option>
              ))}
          </Select>
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("p.users.phone")}>
            <Input
              inputMode="tel"
              placeholder="01712345678"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
            />
          </Field>
          <Field label={t("p.users.language")}>
            <Select
              value={f.preferredLanguage}
              onChange={(e) =>
                setF({ ...f, preferredLanguage: e.target.value })
              }
            >
              <option value="bn">বাংলা</option>
              <option value="en">English</option>
            </Select>
          </Field>
        </div>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("p.create")}
        />
      </form>
    </Modal>
  );
}

function UserDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const { company } = usePortal();
  // retired departments too: an existing grant may name one, and it should still read as a name
  const org = useOrg(company?.id, { includeInactive: true });
  const user = useApi<UserDetail>(`/users/${id}`);
  const roles = useApi<RoleInfo[]>("/roles");
  const action = useAction();
  const [revoking, setRevoking] = useState<{
    what: string;
    path: string;
  } | null>(null);

  const reload = () => {
    user.reload();
    onChanged();
  };

  return (
    <Modal
      title={user.data?.email ?? t("p.users.title")}
      open
      onClose={onClose}
      wide
    >
      {!user.data ? (
        user.error ? (
          <ErrorBox error={user.error} />
        ) : (
          <Loading />
        )
      ) : (
        <>
          <ActionMessage action={action} />
          <Account user={user.data} action={action} onChanged={reload} />
          <Roles
            user={user.data}
            roles={roles.data ?? []}
            org={org}
            action={action}
            onChanged={reload}
            onRevoke={setRevoking}
          />
          <FieldAccess
            user={user.data}
            action={action}
            onChanged={reload}
            onRevoke={setRevoking}
          />
          {revoking && (
            <RevokeDialog
              what={revoking.what}
              onClose={() => setRevoking(null)}
              onDone={async (reason) => {
                const ok = await action.run(
                  () => api.post(revoking.path, { reason }),
                  t("p.done"),
                );
                setRevoking(null);
                if (ok) reload();
              }}
            />
          )}
          {/* a locked account unlocks itself; say so instead of leaving the Admin guessing */}
          {user.data.lockedUntil &&
            new Date(user.data.lockedUntil) > new Date() && (
              <Alert kind="warning">
                {t("p.users.locked", {
                  when: formatDate(user.data.lockedUntil.slice(0, 10), lang),
                })}
              </Alert>
            )}
        </>
      )}
    </Modal>
  );
}

/** The login itself: who it belongs to, how to reach them, a new password, and closing it. */
function Account({
  user,
  action,
  onChanged,
}: {
  user: UserDetail;
  action: ReturnType<typeof useAction>;
  onChanged: () => void;
}) {
  const { t, lang } = useI18n();
  const { company } = usePortal();
  const people = useApi<Page<EmployeeSummary>>(
    company ? `/employees?companyId=${company.id}&pageSize=200` : null,
  );
  const [f, setF] = useState({
    employeeId: user.employeeId ?? "",
    phone: user.phone ?? "",
    preferredLanguage: user.preferredLanguage ?? "bn",
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState(false);

  const patch = (body: Record<string, unknown>, message: string) =>
    action
      .run(
        () =>
          api.patch(`/users/${user.id}`, { ...body, version: user.version }),
        message,
      )
      .then((ok) => ok && onChanged());

  return (
    <Panel title={t("p.users.account")}>
      <dl className="mb-3 grid gap-4 sm:grid-cols-3">
        <Detail label={t("p.status")}>
          <Badge color={user.status === "active" ? "green" : "gray"}>
            {t(`p.users.status.${user.status}`)}
          </Badge>
        </Detail>
        <Detail label={t("p.users.mfa")}>{user.mfaEnabled ? "✓" : "—"}</Detail>
        <Detail label={t("p.users.lastLogin")}>
          {user.lastLoginAt
            ? formatDate(user.lastLoginAt.slice(0, 10), lang)
            : "—"}
        </Detail>
      </dl>

      <div className="grid gap-x-3 sm:grid-cols-3">
        <Field label={t("p.users.linkEmployee")}>
          <Select
            value={f.employeeId}
            onChange={(e) => setF({ ...f, employeeId: e.target.value })}
          >
            <option value="">{t("p.users.unlink")}</option>
            {(people.data?.items ?? [])
              .filter(
                (p) => p.status !== "separated" || p.id === user.employeeId,
              )
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.employeeCode} · {p.fullNameEn}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={t("p.users.phone")}>
          <Input
            inputMode="tel"
            placeholder="01712345678"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
        </Field>
        <Field label={t("p.users.language")}>
          <Select
            value={f.preferredLanguage}
            onChange={(e) =>
              setF({ ...f, preferredLanguage: e.target.value as "bn" | "en" })
            }
          >
            <option value="bn">বাংলা</option>
            <option value="en">English</option>
          </Select>
        </Field>
      </div>
      <Button
        variant="secondary"
        busy={action.busy}
        onClick={() =>
          patch(
            {
              employeeId: f.employeeId === "" ? null : f.employeeId,
              ...(f.phone ? { phone: f.phone } : {}),
              preferredLanguage: f.preferredLanguage,
            },
            t("p.saved"),
          )
        }
      >
        {t("p.save")}
      </Button>

      <hr className="my-4 border-slate-100" />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          // step-up: the api helper asks for the 2FA code and sends the request again
          const ok = await action.run(
            () =>
              api.post(`/users/${user.id}/password`, { newPassword: password }),
            t("p.users.passwordSet"),
          );
          if (ok) setPassword("");
        }}
      >
        <Field label={t("p.users.newPassword")}>
          <Input
            type="password"
            minLength={10}
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <div className="mb-3">
          <Button type="submit" variant="secondary" busy={action.busy}>
            {t("p.users.resetPassword")}
          </Button>
        </div>
      </form>

      <hr className="my-4 border-slate-100" />
      <p className="mb-2 text-xs text-slate-500">{t("p.users.disableHint")}</p>
      {user.status === "active" ? (
        <>
          <Button
            variant="secondary"
            className="text-red-700"
            onClick={() => setConfirm(true)}
          >
            {t("p.users.disable")}
          </Button>
          {confirm && (
            <Modal
              title={t("p.users.disable")}
              open
              onClose={() => setConfirm(false)}
            >
              <p className="mb-2 text-sm font-medium text-slate-800">
                {user.email}
              </p>
              <p className="mb-4 text-sm text-slate-600">
                {t("p.users.disableHint")}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirm(false)}>
                  {t("p.cancel")}
                </Button>
                <Button
                  busy={action.busy}
                  onClick={async () => {
                    await patch({ status: "disabled" }, t("p.users.disabled"));
                    setConfirm(false);
                  }}
                >
                  {t("p.users.disable")}
                </Button>
              </div>
            </Modal>
          )}
        </>
      ) : (
        <Button
          variant="secondary"
          busy={action.busy}
          onClick={() => patch({ status: "active" }, t("p.users.enabled"))}
        >
          {t("p.users.enable")}
        </Button>
      )}
    </Panel>
  );
}

/** The roles this login holds, and granting one more. */
function Roles({
  user,
  roles,
  org,
  action,
  onChanged,
  onRevoke,
}: {
  user: UserDetail;
  roles: RoleInfo[];
  org: ReturnType<typeof useOrg>;
  action: ReturnType<typeof useAction>;
  onChanged: () => void;
  onRevoke: (r: { what: string; path: string }) => void;
}) {
  const { t, lang } = useI18n();
  const { company } = usePortal();
  const system = roles.filter((r) => r.type === "system");
  const custom = roles.filter((r) => r.type === "custom" && r.isActive);
  const [choice, setChoice] = useState("");
  const [scopeType, setScopeType] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [expiresOn, setExpiresOn] = useState("");

  const chosen = choice.startsWith("custom:")
    ? custom.find((r) => r.id === choice.slice(7))
    : system.find((r) => r.key === choice);
  const scopes = chosen?.allowedScopes ?? [];
  const nameOfRole = (r: RoleInfo) =>
    lang === "bn" ? (r.nameBn ?? r.nameEn) : r.nameEn;
  const grantName = (g: RoleGrant) => {
    const found = g.role
      ? system.find((r) => r.key === g.role)
      : custom.find((r) => r.id === g.customRoleId);
    return found ? nameOfRole(found) : (g.role ?? g.customRoleId ?? "");
  };
  const scopeName = (g: RoleGrant) =>
    g.scopeType === "department"
      ? (org.departments.find((d) => d.id === g.scopeId)?.name ?? "")
      : g.scopeType === "company"
        ? company?.id === g.scopeId
          ? (company?.shortName ?? company?.legalName ?? "")
          : ""
        : "";

  const pick = (value: string) => {
    setChoice(value);
    const r = value.startsWith("custom:")
      ? custom.find((x) => x.id === value.slice(7))
      : system.find((x) => x.key === value);
    setScopeType(r?.allowedScopes[0] ?? "");
    setExpiresOn("");
  };

  const grant = () =>
    action
      .run(
        () =>
          api.post(`/users/${user.id}/roles`, {
            ...(chosen?.type === "custom"
              ? { customRoleId: chosen.id }
              : { role: choice }),
            scopeType,
            ...(scopeType === "company"
              ? { scopeId: company?.id }
              : scopeType === "department"
                ? { scopeId: departmentId }
                : {}),
            // end of that day in Dhaka, which is what "until the 31st" means to a person
            ...(expiresOn ? { expiresAt: `${expiresOn}T23:59:59+06:00` } : {}),
          }),
        t("p.saved"),
      )
      .then((ok) => ok && onChanged());

  return (
    <Panel title={t("p.users.roles")}>
      {user.roles.length === 0 && (
        <p className="mb-2 text-sm text-slate-500">{t("p.users.noRoles")}</p>
      )}
      <Table
        rows={user.roles}
        rowKey={(r) => r.id}
        columns={[
          {
            key: "role",
            label: t("p.users.role"),
            render: (r) => grantName(r),
          },
          {
            key: "scope",
            label: t("p.users.scope"),
            render: (r) =>
              `${t(`p.users.scope.${r.scopeType}`)} ${scopeName(r)}`.trim(),
          },
          {
            key: "until",
            label: t("p.users.until"),
            render: (r) =>
              r.expiresAt ? (
                <span
                  className={
                    new Date(r.expiresAt) < new Date()
                      ? "text-amber-700"
                      : undefined
                  }
                >
                  {formatDate(r.expiresAt.slice(0, 10), lang, { short: true })}
                  {new Date(r.expiresAt) < new Date()
                    ? ` · ${t("p.users.expired")}`
                    : ""}
                </span>
              ) : (
                <span className="text-slate-400">{t("p.users.permanent")}</span>
              ),
          },
          {
            key: "act",
            label: "",
            align: "right",
            render: (r) => (
              <Button
                variant="ghost"
                className="min-h-8 px-2 py-1 text-sm text-red-700"
                onClick={() =>
                  onRevoke({
                    what: grantName(r),
                    path: `/users/${user.id}/roles/${r.id}/revoke`,
                  })
                }
              >
                {t("p.users.revoke")}
              </Button>
            ),
          },
        ]}
      />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label={t("p.users.role")}>
          <Select value={choice} onChange={(e) => pick(e.target.value)}>
            <option value="">—</option>
            <optgroup label={t("ac.system")}>
              {system.map((r) => (
                <option key={r.key} value={r.key}>
                  {nameOfRole(r)}
                </option>
              ))}
            </optgroup>
            {custom.length > 0 && (
              <optgroup label={t("ac.custom")}>
                {custom.map((r) => (
                  <option key={r.id} value={`custom:${r.id}`}>
                    {nameOfRole(r)}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        {chosen && (
          <Field label={t("p.users.scope")} hint={t("p.users.scopeHint")}>
            <Select
              value={scopeType}
              onChange={(e) => setScopeType(e.target.value)}
            >
              {scopes.map((s) => (
                <option key={s} value={s}>
                  {t(`p.users.scope.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {scopeType === "department" && (
          <Field label={t("p.department")}>
            <Select
              required
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">—</option>
              {/* a retired department still names an old grant above, but is not offered for a new one */}
              {org.departments
                .filter((d) => d.isActive !== false)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {"— ".repeat(d.depth ?? 0)}
                    {d.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {chosen && (
          <Field
            label={
              chosen.timeLimited
                ? t("p.users.expiresRequired")
                : t("p.users.expires")
            }
            hint={t("p.users.expiresHint")}
          >
            <Input
              type="date"
              min={dhakaToday()}
              required={chosen.timeLimited}
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
            />
          </Field>
        )}
        <div className="mb-3">
          <Button
            busy={action.busy}
            disabled={
              !chosen ||
              !scopeType ||
              (scopeType === "department" && !departmentId) ||
              (chosen.timeLimited === true && !expiresOn)
            }
            onClick={grant}
          >
            {t("p.users.grant")}
          </Button>
        </div>
      </div>
      {/* one line about the role being granted, so an Admin is not guessing from a name */}
      {chosen?.type === "system" && (
        <p className="text-xs text-slate-600">
          {t(`ac.roleAbout.${chosen.key}`)}
          {chosen.privileged ? ` · ${t("p.users.privileged")}` : ""}
        </p>
      )}
    </Panel>
  );
}

/** Reading salary, bank, identity or complaint fields inside the roles the user already has. */
function FieldAccess({
  user,
  action,
  onChanged,
  onRevoke,
}: {
  user: UserDetail;
  action: ReturnType<typeof useAction>;
  onChanged: () => void;
  onRevoke: (r: { what: string; path: string }) => void;
}) {
  const { t } = useI18n();
  const [fieldGroup, setFieldGroup] = useState("salary");
  const held = new Set((user.fieldGrants ?? []).map((g) => g.fieldGroup));
  return (
    <Panel title={t("ac.fieldGrants")}>
      <p className="mb-2 text-xs text-slate-500">{t("ac.fieldGrantsHint")}</p>
      <ul className="mb-3 text-sm">
        {(user.fieldGrants ?? []).map((g) => (
          <li key={g.id} className="flex items-center gap-2">
            {t(`ac.field.${g.fieldGroup}`)}
            <Button
              variant="ghost"
              className="min-h-7 px-2 py-0.5 text-xs text-red-700"
              onClick={() =>
                onRevoke({
                  what: t(`ac.field.${g.fieldGroup}`),
                  path: `/users/${user.id}/field-grants/${g.id}/revoke`,
                })
              }
            >
              {t("p.users.revoke")}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex items-end gap-3">
        <Field label={t("ac.fieldGrants")}>
          <Select
            value={fieldGroup}
            onChange={(e) => setFieldGroup(e.target.value)}
            id="field-group"
          >
            {FIELD_GROUPS.filter((g) => !held.has(g)).map((g) => (
              <option key={g} value={g}>
                {t(`ac.field.${g}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="mb-3">
          <Button
            variant="secondary"
            busy={action.busy}
            disabled={held.has(fieldGroup)}
            onClick={() =>
              action
                .run(
                  () =>
                    api.post(`/users/${user.id}/field-grants`, { fieldGroup }),
                  t("p.saved"),
                )
                .then((ok) => ok && onChanged())
            }
          >
            {t("ac.grant")}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** Taking a role or a field grant away needs a reason, which the audit log keeps. */
function RevokeDialog({
  what,
  onClose,
  onDone,
}: {
  what: string;
  onClose: () => void;
  onDone: (reason: string) => void;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  return (
    <Modal title={t("p.users.revokeTitle", { what })} open onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onDone(reason.trim());
        }}
      >
        <Field label={t("p.users.revokeReason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <FormButtons onCancel={onClose} submitLabel={t("p.users.revoke")} />
      </form>
    </Modal>
  );
}
