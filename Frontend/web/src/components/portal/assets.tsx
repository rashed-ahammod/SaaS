"use client";
/**
 * Asset pieces of the portal (WP19):
 *   NewAssetDialog, AssignDialog, ReturnDialog, MaintenanceDialog, DisposeDialog
 *   AssetLabel          the tag with a QR code, to print and stick on the asset
 *   ClassesPanel        asset classes (the standard ones in one click)
 *   DepreciationPanel   preview, run and reverse the monthly depreciation
 */
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { AccountSelect, Taka, useAccounts } from "@/components/portal/finance";
import { useOrg } from "@/components/portal/org";
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
import type { Asset, AssetClass, DepreciationRun } from "@/lib/asset-types";
import { dhakaToday, formatMonth, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { EmployeeSummary, Page } from "@/lib/portal-types";
import {
  ActionMessage,
  FormButtons,
  Modal,
  Panel,
  Table,
  useAction,
} from "./kit";
import { usePortal } from "./portal-context";

const MONEY = "\\d+(\\.\\d{1,2})?";

export function NewAssetDialog({
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
  const classes = useApi<AssetClass[]>(`/companies/${companyId}/asset-classes`);
  const { departments } = useOrg(companyId);
  const [f, setF] = useState({
    classId: "",
    name: "",
    serialNo: "",
    inServiceDate: dhakaToday(),
    cost: "",
    residualValue: "",
    departmentId: "",
    location: "",
    openingAccumulated: "",
    openingAsOf: "",
    note: "",
  });
  const [old, setOld] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={t("as.new")} open onClose={onClose} wide>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = Object.fromEntries(
            Object.entries({
              ...f,
              ...(old ? {} : { openingAccumulated: "", openingAsOf: "" }),
            }).filter(([, v]) => v !== ""),
          );
          const a = await save.run(() =>
            api.post<{ id: string }>(`/companies/${companyId}/assets`, body),
          );
          if (a && typeof a === "object") onDone(a.id);
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("as.class")}>
            <Select
              required
              value={f.classId}
              onChange={set("classId")}
              id="asset-class"
            >
              <option value="">—</option>
              {classes.data
                ?.filter((c) => c.isActive)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t("as.name")}>
            <Input
              required
              maxLength={200}
              value={f.name}
              onChange={set("name")}
              id="asset-name"
            />
          </Field>
          <Field label={t("as.serial")}>
            <Input
              maxLength={100}
              value={f.serialNo}
              onChange={set("serialNo")}
              id="asset-serial"
            />
          </Field>
          <Field label={t("as.inService")}>
            <Input
              type="date"
              required
              value={f.inServiceDate}
              onChange={set("inServiceDate")}
              id="asset-date"
            />
          </Field>
          <Field label={t("as.cost")}>
            <Input
              required
              inputMode="decimal"
              pattern={MONEY}
              value={f.cost}
              onChange={set("cost")}
              id="asset-cost"
            />
          </Field>
          <Field label={t("as.residual")}>
            <Input
              inputMode="decimal"
              pattern={MONEY}
              value={f.residualValue}
              onChange={set("residualValue")}
              id="asset-residual"
            />
          </Field>
          <Field label={t("as.department")}>
            <Select
              value={f.departmentId}
              onChange={set("departmentId")}
              id="asset-department"
            >
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {"— ".repeat(d.depth ?? 0)}
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("as.location")}>
            <Input
              maxLength={200}
              value={f.location}
              onChange={set("location")}
              id="asset-location"
            />
          </Field>
        </div>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={old}
            onChange={(e) => setOld(e.target.checked)}
            id="asset-old"
          />{" "}
          {t("as.opening")}
        </label>
        {old && (
          <div className="grid gap-x-3 sm:grid-cols-2">
            <Field label={t("as.openingAccumulated")}>
              <Input
                required
                inputMode="decimal"
                pattern={MONEY}
                value={f.openingAccumulated}
                onChange={set("openingAccumulated")}
                id="asset-opening"
              />
            </Field>
            <Field label={t("as.openingAsOf")}>
              <Input
                type="date"
                required
                value={f.openingAsOf}
                onChange={set("openingAsOf")}
                id="asset-opening-date"
              />
            </Field>
          </div>
        )}
        <Field label={t("as.note")}>
          <Input
            maxLength={500}
            value={f.note}
            onChange={set("note")}
            id="asset-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("as.new")}
        />
      </form>
    </Modal>
  );
}

export function AssignDialog({
  asset,
  onClose,
  onDone,
}: {
  asset: Asset;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const people = useApi<Page<EmployeeSummary>>(
    `/employees?companyId=${asset.companyId}&pageSize=200`,
  );
  const [f, setF] = useState({
    employeeId: "",
    assignedOn: dhakaToday(),
    expectedReturn: "",
    note: "",
  });
  return (
    <Modal title={`${t("as.assign")}: ${asset.tag}`} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(
                `/assets/${asset.id}/assign`,
                Object.fromEntries(
                  Object.entries(f).filter(([, v]) => v !== ""),
                ),
              ),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <Field label={t("as.employee")}>
          <Select
            required
            value={f.employeeId}
            onChange={(e) => setF({ ...f, employeeId: e.target.value })}
            id="assign-employee"
          >
            <option value="">—</option>
            {people.data?.items
              .filter((p) => p.status !== "separated" && p.status !== "draft")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.employeeCode} · {p.fullNameEn}
                </option>
              ))}
          </Select>
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("as.assignedOn")}>
            <Input
              type="date"
              required
              value={f.assignedOn}
              onChange={(e) => setF({ ...f, assignedOn: e.target.value })}
              id="assign-date"
            />
          </Field>
          <Field label={t("as.expectedReturn")}>
            <Input
              type="date"
              value={f.expectedReturn}
              onChange={(e) => setF({ ...f, expectedReturn: e.target.value })}
              id="assign-return"
            />
          </Field>
        </div>
        <Field label={t("as.note")}>
          <Input
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="assign-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("as.assign")}
        />
      </form>
    </Modal>
  );
}

export function ReturnDialog({
  asset,
  onClose,
  onDone,
}: {
  asset: Asset;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    returnedOn: dhakaToday(),
    condition: "good",
    note: "",
  });
  return (
    <Modal title={`${t("as.return")}: ${asset.tag}`} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/assets/${asset.id}/return`, {
                ...f,
                ...(f.note ? {} : { note: undefined }),
              }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("as.returnedOn")}>
            <Input
              type="date"
              required
              value={f.returnedOn}
              onChange={(e) => setF({ ...f, returnedOn: e.target.value })}
              id="return-date"
            />
          </Field>
          <Field label={t("as.condition")}>
            <Select
              value={f.condition}
              onChange={(e) => setF({ ...f, condition: e.target.value })}
              id="return-condition"
            >
              {(["good", "damaged", "lost"] as const).map((c) => (
                <option key={c} value={c}>
                  {t(`as.condition.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("as.note")}>
          <Input
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="return-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("as.return")}
        />
      </form>
    </Modal>
  );
}

export function MaintenanceDialog({
  asset,
  onClose,
  onDone,
}: {
  asset: Asset;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const [f, setF] = useState({
    doneOn: dhakaToday(),
    kind: "service",
    description: "",
    cost: "",
    nextDue: "",
  });
  return (
    <Modal
      title={`${t("as.addMaintenance")}: ${asset.tag}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(
                `/assets/${asset.id}/maintenance`,
                Object.fromEntries(
                  Object.entries(f).filter(([, v]) => v !== ""),
                ),
              ),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("as.doneOn")}>
            <Input
              type="date"
              required
              value={f.doneOn}
              onChange={(e) => setF({ ...f, doneOn: e.target.value })}
              id="mnt-date"
            />
          </Field>
          <Field label={t("as.kind")}>
            <Select
              value={f.kind}
              onChange={(e) => setF({ ...f, kind: e.target.value })}
              id="mnt-kind"
            >
              {(["service", "repair", "inspection"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`as.kind.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("as.cost")}>
            <Input
              inputMode="decimal"
              pattern={MONEY}
              value={f.cost}
              onChange={(e) => setF({ ...f, cost: e.target.value })}
              id="mnt-cost"
            />
          </Field>
          <Field label={t("as.nextDue")}>
            <Input
              type="date"
              value={f.nextDue}
              onChange={(e) => setF({ ...f, nextDue: e.target.value })}
              id="mnt-next"
            />
          </Field>
        </div>
        <Field label={t("as.description")}>
          <Input
            required
            maxLength={500}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            id="mnt-description"
          />
        </Field>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

export function DisposeDialog({
  asset,
  onClose,
  onDone,
}: {
  asset: Asset;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const save = useAction();
  const { postable } = useAccounts(asset.companyId);
  const [f, setF] = useState({
    disposedOn: dhakaToday(),
    method: "sale",
    proceeds: "",
    receivedIntoAccountId: "",
    note: "",
  });
  return (
    <Modal title={`${t("as.dispose")}: ${asset.tag}`} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body =
            f.method === "sale"
              ? f
              : { disposedOn: f.disposedOn, method: f.method, note: f.note };
          if (
            await save.run(() => api.post(`/assets/${asset.id}/dispose`, body))
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <p className="mb-3 text-sm text-amber-800">{t("as.disposeHint")}</p>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("as.disposedOn")}>
            <Input
              type="date"
              required
              value={f.disposedOn}
              onChange={(e) => setF({ ...f, disposedOn: e.target.value })}
              id="dispose-date"
            />
          </Field>
          <Field label={t("as.method")}>
            <Select
              value={f.method}
              onChange={(e) => setF({ ...f, method: e.target.value })}
              id="dispose-method"
            >
              {(["sale", "scrap", "write_off"] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`as.method.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          {f.method === "sale" && (
            <>
              <Field label={t("as.proceeds")}>
                <Input
                  required
                  inputMode="decimal"
                  pattern={MONEY}
                  value={f.proceeds}
                  onChange={(e) => setF({ ...f, proceeds: e.target.value })}
                  id="dispose-proceeds"
                />
              </Field>
              <Field label={t("as.receivedInto")}>
                <AccountSelect
                  accounts={postable}
                  filter={(a) => a.role === "cash" || a.role === "bank"}
                  value={f.receivedIntoAccountId}
                  onChange={(id) => setF({ ...f, receivedIntoAccountId: id })}
                  required
                  id="dispose-account"
                />
              </Field>
            </>
          )}
        </div>
        <Field label={t("as.note")}>
          <Input
            required
            maxLength={500}
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            id="dispose-note"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("as.dispose")}
        />
      </form>
    </Modal>
  );
}

/** The tag label: company, tag, name and a QR code of the tag (printed from the browser). */
export function AssetLabel({
  asset,
  company,
}: {
  asset: Asset;
  company: string;
}) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(`${asset.tag}|${asset.serialNo ?? ""}`, {
      margin: 1,
      width: 160,
    }).then(
      (url) => alive && setQr(url),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [asset.tag, asset.serialNo]);
  return (
    <div
      className="flex w-80 items-center gap-3 rounded border border-slate-400 p-3"
      data-testid="asset-label"
    >
      {qr ? (
        // eslint-disable-next-line @next/next/no-img-element -- a generated data URL
        <img src={qr} alt={asset.tag} width={96} height={96} />
      ) : (
        <span className="h-24 w-24" />
      )}
      <span>
        <span className="block text-xs text-slate-600">{company}</span>
        <span className="block font-mono text-lg font-bold">{asset.tag}</span>
        <span className="block text-sm">{asset.name}</span>
        {asset.serialNo && (
          <span className="block font-mono text-xs text-slate-600">
            {asset.serialNo}
          </span>
        )}
      </span>
    </div>
  );
}

export function ClassesPanel({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const classes = useApi<AssetClass[]>(`/companies/${companyId}/asset-classes`);
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const manage = can("assets.manage");
  return (
    <Panel
      actions={
        manage && (
          <>
            <Button
              variant="secondary"
              busy={action.busy}
              onClick={() =>
                action
                  .run(() =>
                    api.post(`/companies/${companyId}/asset-classes/defaults`),
                  )
                  .then(classes.reload)
              }
            >
              {t("as.defaults")}
            </Button>
            <Button variant="secondary" onClick={() => setAdding(true)}>
              {t("as.newClass")}
            </Button>
          </>
        )
      }
    >
      <ActionMessage action={action} />
      {classes.error ? (
        <ErrorBox error={classes.error} />
      ) : (
        <Table
          rows={classes.data}
          rowKey={(c) => c.id}
          empty={t("st.none")}
          columns={[
            { key: "code", label: t("as.code"), className: "font-mono" },
            { key: "name", label: t("st.name") },
            {
              key: "method",
              label: t("as.method"),
              render: (c) => t(`as.classMethod.${c.method}`),
            },
            {
              key: "life",
              label: `${t("as.life")} / ${t("as.rate")}`,
              render: (c) =>
                c.method === "straight_line"
                  ? num(c.usefulLifeMonths ?? 0, lang)
                  : `${num(Number(c.annualRatePercent), lang)}%`,
            },
            {
              key: "residual",
              label: t("as.residual"),
              align: "right",
              render: (c) => `${num(Number(c.residualPercent), lang)}%`,
            },
            {
              key: "active",
              label: "",
              render: (c) =>
                c.isActive ? null : <Badge color="gray">—</Badge>,
            },
          ]}
        />
      )}
      {adding && (
        <NewClassDialog
          companyId={companyId}
          onClose={() => setAdding(false)}
          onDone={() => (setAdding(false), classes.reload())}
        />
      )}
    </Panel>
  );
}

function NewClassDialog({
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
  const { postable } = useAccounts(companyId);
  const [f, setF] = useState({
    code: "",
    name: "",
    assetAccountId: "",
    method: "straight_line",
    usefulLifeMonths: "60",
    annualRatePercent: "20",
    residualPercent: "0",
  });
  return (
    <Modal title={t("as.newClass")} open onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const body = {
            code: f.code,
            name: f.name,
            assetAccountId: f.assetAccountId,
            method: f.method,
            residualPercent: f.residualPercent,
            ...(f.method === "straight_line"
              ? { usefulLifeMonths: Number(f.usefulLifeMonths) }
              : { annualRatePercent: f.annualRatePercent }),
          };
          if (
            await save.run(() =>
              api.post(`/companies/${companyId}/asset-classes`, body),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <div className="grid gap-x-3 sm:grid-cols-2">
          <Field label={t("as.code")}>
            <Input
              required
              maxLength={12}
              value={f.code}
              onChange={(e) => setF({ ...f, code: e.target.value })}
              id="class-code"
            />
          </Field>
          <Field label={t("st.name")}>
            <Input
              required
              maxLength={100}
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              id="class-name"
            />
          </Field>
        </div>
        <Field label={t("as.account")}>
          <AccountSelect
            accounts={postable}
            filter={(a) => a.type === "asset" && !a.role}
            value={f.assetAccountId}
            onChange={(id) => setF({ ...f, assetAccountId: id })}
            required
            id="class-account"
          />
        </Field>
        <div className="grid gap-x-3 sm:grid-cols-3">
          <Field label={t("as.method")}>
            <Select
              value={f.method}
              onChange={(e) => setF({ ...f, method: e.target.value })}
              id="class-method"
            >
              <option value="straight_line">
                {t("as.classMethod.straight_line")}
              </option>
              <option value="reducing_balance">
                {t("as.classMethod.reducing_balance")}
              </option>
            </Select>
          </Field>
          {f.method === "straight_line" ? (
            <Field label={t("as.life")}>
              <Input
                type="number"
                min={1}
                max={600}
                required
                value={f.usefulLifeMonths}
                onChange={(e) =>
                  setF({ ...f, usefulLifeMonths: e.target.value })
                }
                id="class-life"
              />
            </Field>
          ) : (
            <Field label={t("as.rate")}>
              <Input
                inputMode="decimal"
                required
                value={f.annualRatePercent}
                onChange={(e) =>
                  setF({ ...f, annualRatePercent: e.target.value })
                }
                id="class-rate"
              />
            </Field>
          )}
          <Field label={`${t("as.residual")} %`}>
            <Input
              inputMode="decimal"
              value={f.residualPercent}
              onChange={(e) => setF({ ...f, residualPercent: e.target.value })}
              id="class-residual"
            />
          </Field>
        </div>
        <FormButtons busy={save.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

export function DepreciationPanel({ companyId }: { companyId: string }) {
  const { t, lang } = useI18n();
  const { can } = usePortal();
  const runs = useApi<DepreciationRun[]>(
    `/companies/${companyId}/depreciation-runs`,
  );
  const action = useAction();
  const lastMonth = (() => {
    const [y, m] = dhakaToday().split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const [period, setPeriod] = useState(lastMonth);
  const [preview, setPreview] = useState<Array<{
    assetId: string;
    tag: string;
    name: string;
    charge: string;
    accumulatedAfter: string;
    bookValueAfter: string;
  }> | null>(null);
  const [reversing, setReversing] = useState<DepreciationRun | null>(null);
  const depreciate = can("assets.depreciate");
  const latest = runs.data?.find((r) => r.state === "posted");
  return (
    <>
      {depreciate && (
        <Panel title={t("as.run")}>
          <ActionMessage action={action} />
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("as.runFor")}>
              <Input
                type="month"
                value={period}
                onChange={(e) => (setPeriod(e.target.value), setPreview(null))}
                id="dep-period"
              />
            </Field>
            <div className="mb-3 flex gap-2">
              <Button
                variant="secondary"
                busy={action.busy}
                onClick={() =>
                  action.run(async () =>
                    setPreview(
                      await api.get(
                        `/companies/${companyId}/depreciation-runs/preview?period=${period}`,
                      ),
                    ),
                  )
                }
              >
                {t("as.preview")}
              </Button>
              <Button
                busy={action.busy}
                onClick={() =>
                  action
                    .run(
                      () =>
                        api.post(`/companies/${companyId}/depreciation-runs`, {
                          period,
                        }),
                      t("p.done"),
                    )
                    .then(() => (setPreview(null), runs.reload()))
                }
              >
                {t("as.run")}
              </Button>
            </div>
          </div>
          {preview && (
            <Table
              rows={preview}
              rowKey={(p) => p.assetId}
              empty={t("as.nothingToRun")}
              columns={[
                {
                  key: "tag",
                  label: t("as.tag"),
                  className: "font-mono",
                  render: (p) => p.tag,
                },
                { key: "name", label: t("as.name"), render: (p) => p.name },
                {
                  key: "charge",
                  label: t("as.charge"),
                  align: "right",
                  render: (p) => <Taka value={p.charge} />,
                },
                {
                  key: "acc",
                  label: t("as.accumulated"),
                  align: "right",
                  render: (p) => <Taka value={p.accumulatedAfter} />,
                },
                {
                  key: "book",
                  label: t("as.bookValue"),
                  align: "right",
                  render: (p) => <Taka value={p.bookValueAfter} />,
                },
              ]}
            />
          )}
        </Panel>
      )}
      <Panel title={t("as.runs")}>
        {runs.error ? (
          <ErrorBox error={runs.error} />
        ) : !runs.data ? (
          <Loading />
        ) : (
          <Table
            rows={runs.data}
            rowKey={(r) => r.id}
            empty={t("st.none")}
            columns={[
              {
                key: "period",
                label: t("as.period"),
                render: (r) => formatMonth(r.period, lang),
              },
              {
                key: "total",
                label: t("as.runTotal"),
                align: "right",
                render: (r) => <Taka value={r.total} />,
              },
              {
                key: "voucher",
                label: "",
                render: (r) => (
                  <span className="font-mono text-xs">
                    {r.voucherNumber ?? ""}
                  </span>
                ),
              },
              {
                key: "state",
                label: t("p.status"),
                render: (r) =>
                  r.reversalPending ? (
                    <Badge color="amber">{t("as.reversalPending")}</Badge>
                  ) : (
                    <Badge color={r.state === "posted" ? "green" : "gray"}>
                      {t(`as.state.${r.state}`)}
                    </Badge>
                  ),
              },
              {
                key: "act",
                label: "",
                align: "right",
                render: (r) =>
                  depreciate && r.id === latest?.id && !r.reversalPending ? (
                    <Button
                      variant="ghost"
                      className="min-h-8 px-2 py-1 text-sm text-red-700"
                      onClick={() => setReversing(r)}
                    >
                      {t("as.reverse")}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Panel>
      {reversing && (
        <ReverseRun
          run={reversing}
          onClose={() => setReversing(null)}
          onDone={() => (setReversing(null), runs.reload())}
        />
      )}
    </>
  );
}

function ReverseRun({
  run,
  onClose,
  onDone,
}: {
  run: DepreciationRun;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={`${t("as.reverse")}: ${formatMonth(run.period, lang)}`}
      open
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await save.run(() =>
              api.post(`/depreciation-runs/${run.id}/reverse`, { reason }),
            )
          )
            onDone();
        }}
      >
        <ActionMessage action={save} />
        <p className="mb-3 text-sm text-slate-600">{t("as.reverseHint")}</p>
        <Field label={t("p.reason")}>
          <Input
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            id="dep-reverse-reason"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("as.reverse")}
        />
      </form>
    </Modal>
  );
}
