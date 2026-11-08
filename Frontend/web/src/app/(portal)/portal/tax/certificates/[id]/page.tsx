"use client";
/** A withholding certificate to a vendor, laid out to be printed from the browser. */
import { useParams } from "next/navigation";
import { Panel, Table } from "@/components/portal/kit";
import { Taka } from "@/components/portal/finance";
import { Button, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/api";
import type { CertificateDetail } from "@/lib/finance-types";
import { formatDate, num } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

export default function CertificatePage() {
  const { id } = useParams<{ id: string }>();
  const { t, lang } = useI18n();
  const cert = useApi<CertificateDetail>(`/tax-certificates/${id}`);
  if (cert.loading && !cert.data) return <Loading />;
  if (cert.error) return <ErrorBox error={cert.error} onRetry={cert.reload} />;
  const c = cert.data!;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex justify-end print:hidden">
        <Button variant="secondary" onClick={() => window.print()}>
          {t("p.download")}
        </Button>
      </div>
      <Panel>
        <div className="mb-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {c.deductor.name}
          </p>
          <h1 className="mt-1 text-xl font-bold">{c.title}</h1>
          <p className="mt-1 font-mono text-sm">{c.number}</p>
        </div>
        <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-slate-500">
              {t("f.b.vendor")}
            </dt>
            <dd className="font-semibold">{c.vendor.name}</dd>
            {c.vendor.nameBn && <dd>{c.vendor.nameBn}</dd>}
            {c.vendor.address && (
              <dd className="text-slate-600">{c.vendor.address}</dd>
            )}
          </div>
          <div>
            <dt className="text-xs uppercase text-slate-500">TIN / BIN</dt>
            <dd>{`${c.vendor.tin ?? "—"} / ${c.vendor.bin ?? "—"}`}</dd>
            <dt className="mt-2 text-xs uppercase text-slate-500">
              {t("p.period")}
            </dt>
            <dd>{`${formatDate(c.periodFrom, lang)} – ${formatDate(c.periodTo, lang)}`}</dd>
          </div>
        </dl>
        <Table
          rows={c.lines}
          rowKey={(l) => `${l.billNo}-${l.challanNo}`}
          columns={[
            {
              key: "bill",
              label: t("f.b.billNo"),
              render: (l) =>
                `${l.billNo} (${formatDate(l.billDate, lang, { short: true })})`,
            },
            {
              key: "base",
              label: c.taxType === "tds" ? t("f.b.base") : t("f.b.vat"),
              align: "right",
              render: (l) => <Taka value={l.base} />,
            },
            {
              key: "rate",
              label: "%",
              align: "right",
              render: (l) => num(Number(l.percent), lang),
            },
            {
              key: "amount",
              label: t("p.amount"),
              align: "right",
              render: (l) => <Taka value={l.amount} />,
            },
            {
              key: "challan",
              label: t("f.t.challanNo"),
              render: (l) =>
                `${l.challanNo} (${formatDate(l.challanDate, lang, { short: true })})`,
            },
          ]}
        />
        <p className="mt-4 text-right text-lg font-bold">
          {t("p.total")}: <Taka value={c.amount} />
        </p>
        <p className="mt-8 text-sm text-slate-600">
          {formatDate(c.issuedAt.slice(0, 10), lang)}
        </p>
      </Panel>
    </div>
  );
}
