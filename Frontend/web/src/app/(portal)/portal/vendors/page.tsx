"use client";
/** Vendors of the selected company (search); Accounts adds one with its tax details. */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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
import type { Category, Vendor } from "@/lib/finance-types";
import { useI18n } from "@/lib/i18n";

export default function VendorsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { company, can } = usePortal();
  const [search, setSearch] = useState("");
  const vendors = useApi<Vendor[]>(
    company
      ? `/companies/${company.id}/vendors${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`
      : null,
  );
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        title={t("f.vd.title")}
        actions={
          can("payables.manage") && (
            <Button onClick={() => setCreating(true)}>{t("f.vd.new")}</Button>
          )
        }
      />
      <Panel
        actions={
          <Input
            placeholder={t("p.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t("p.search")}
            id="vendor-search"
          />
        }
      >
        {vendors.loading && !vendors.data ? (
          <Loading />
        ) : vendors.error ? (
          <ErrorBox error={vendors.error} onRetry={vendors.reload} />
        ) : (
          <Table
            rows={vendors.data}
            rowKey={(v) => v.id}
            onRowClick={(v) => router.push(`/portal/vendors/${v.id}`)}
            columns={[
              {
                key: "code",
                label: t("p.code"),
                render: (v) => (
                  <span className="font-mono text-xs">{v.code}</span>
                ),
              },
              {
                key: "name",
                label: t("f.vd.name"),
                render: (v) => (
                  <>
                    {v.name}
                    {v.nameBn && (
                      <span className="block text-xs text-slate-500">
                        {v.nameBn}
                      </span>
                    )}
                  </>
                ),
              },
              {
                key: "tin",
                label: "TIN",
                render: (v) => v.tin ?? <Badge color="amber">—</Badge>,
              },
              {
                key: "bin",
                label: "BIN",
                render: (v) => v.bin ?? <Badge color="amber">—</Badge>,
              },
              {
                key: "category",
                label: t("f.vd.category"),
                render: (v) => v.withholdingCategory,
              },
              {
                key: "active",
                label: t("p.status"),
                render: (v) => (
                  <Badge color={v.isActive ? "green" : "gray"}>
                    {v.isActive ? t("f.vd.active") : t("f.vd.inactive")}
                  </Badge>
                ),
              },
            ]}
          />
        )}
      </Panel>
      {creating && company && (
        <NewVendor
          companyId={company.id}
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/portal/vendors/${id}`)}
        />
      )}
    </div>
  );
}

function NewVendor({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t, lang } = useI18n();
  const save = useAction();
  const cats = useApi<{ categories: Category[] }>(
    `/companies/${companyId}/withholding-categories`,
  );
  const [f, setF] = useState<Record<string, string>>({
    vendorType: "company",
    withholdingCategory: "SUPPLY",
  });
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = Object.fromEntries(
      Object.entries(f).filter(([, v]) => v.trim() !== ""),
    );
    if (body.paymentTermsDays)
      body.paymentTermsDays = Number(body.paymentTermsDays);
    const v = await save.run(
      () => api.post<{ id: string }>(`/companies/${companyId}/vendors`, body),
      t("f.vd.saved"),
    );
    if (v) onCreated(v.id);
  }

  return (
    <Modal title={t("f.vd.new")} open onClose={onClose} wide>
      <form onSubmit={submit}>
        <ActionMessage action={save} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("f.vd.name")}>
            <Input
              required
              maxLength={200}
              value={f.name ?? ""}
              onChange={set("name")}
              id="vendor-name"
            />
          </Field>
          <Field label={t("f.vd.nameBn")}>
            <Input
              maxLength={200}
              value={f.nameBn ?? ""}
              onChange={set("nameBn")}
              id="vendor-name-bn"
            />
          </Field>
          <Field label={t("f.vd.type")}>
            <Select
              value={f.vendorType}
              onChange={set("vendorType")}
              id="vendor-type"
            >
              <option value="company">{t("f.vd.type.company")}</option>
              <option value="individual">{t("f.vd.type.individual")}</option>
            </Select>
          </Field>
          <Field label={t("f.vd.category")}>
            <Select
              value={f.withholdingCategory}
              onChange={set("withholdingCategory")}
              id="vendor-category"
            >
              {cats.data?.categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {lang === "bn" && c.nameBn ? c.nameBn : c.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("f.vd.tin")} hint={t("f.vd.noTin")}>
            <Input
              inputMode="numeric"
              pattern="[0-9]{12}"
              value={f.tin ?? ""}
              onChange={set("tin")}
              id="vendor-tin"
            />
          </Field>
          <Field label={t("f.vd.bin")} hint={t("f.vd.noBin")}>
            <Input
              pattern="[0-9]{9}(-?[0-9]{4})?"
              placeholder="000123456-0101"
              value={f.bin ?? ""}
              onChange={set("bin")}
              id="vendor-bin"
            />
          </Field>
          <Field label={t("f.vd.phone")}>
            <Input
              inputMode="tel"
              pattern="01[3-9][0-9]{8}"
              placeholder="01712345678"
              value={f.phone ?? ""}
              onChange={set("phone")}
              id="vendor-phone"
            />
          </Field>
          <Field label={t("f.vd.terms")}>
            <Input
              type="number"
              min={0}
              max={365}
              value={f.paymentTermsDays ?? ""}
              onChange={set("paymentTermsDays")}
              id="vendor-terms"
            />
          </Field>
        </div>
        <Field label={t("f.vd.address")}>
          <Input
            maxLength={500}
            value={f.address ?? ""}
            onChange={set("address")}
            id="vendor-address"
          />
        </Field>
        <FormButtons
          busy={save.busy}
          onCancel={onClose}
          submitLabel={t("p.create")}
        />
      </form>
    </Modal>
  );
}
