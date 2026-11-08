"use client";
/** My tax certificate: salary and tax deducted each month of an income year, as a PDF for my tax return. */
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Loading,
  PageTitle,
  Row,
  Select,
} from "@/components/ui";
import { api, ApiError, saveDownload, useApi } from "@/lib/api";
import { formatMonth, formatTaka } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

interface Certificate {
  fiscalYear: string;
  final: boolean;
  months: Array<{ period: string; gross: string; tax: string }>;
  totals: { gross: string; tax: string; taxIncludingEarlier: string };
}

export default function TaxCertificatePage() {
  const { t, lang } = useI18n();
  const years = useApi<Array<{ fiscalYear: string; final: boolean }>>(
    "/me/tax-certificates",
  );
  const [year, setYear] = useState("");
  const chosen = year || years.data?.[0]?.fiscalYear || "";
  const cert = useApi<Certificate>(
    chosen ? `/me/tax-certificate?fiscalYear=${chosen}` : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      await saveDownload(
        await api.file(
          `/me/tax-certificate/pdf?fiscalYear=${chosen}&lang=${lang}`,
        ),
        `tax-certificate-${chosen}.pdf`,
      );
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageTitle>{t("py.tax.title")}</PageTitle>
      {years.loading ? (
        <Loading />
      ) : years.error ? (
        <ErrorBox error={years.error} onRetry={years.reload} />
      ) : !years.data?.length ? (
        <Empty>{t("py.tax.none")}</Empty>
      ) : (
        <>
          <Select
            aria-label={t("py.tax.year")}
            value={chosen}
            onChange={(e) => setYear(e.target.value)}
            id="my-tax-year"
          >
            {years.data.map((y) => (
              <option key={y.fiscalYear} value={y.fiscalYear}>
                {t("py.tax.year")} {y.fiscalYear}
              </option>
            ))}
          </Select>
          {error && <Alert kind="error">{error}</Alert>}
          {cert.error ? (
            <ErrorBox error={cert.error} onRetry={cert.reload} />
          ) : !cert.data ? (
            <Loading />
          ) : (
            <Card>
              <p className="mb-2">
                <Badge color={cert.data.final ? "green" : "amber"}>
                  {cert.data.final
                    ? t("py.tax.final")
                    : t("py.tax.provisional")}
                </Badge>
              </p>
              {cert.data.months.map((m) => (
                <Row
                  key={m.period}
                  label={formatMonth(m.period, lang)}
                  value={`${formatTaka(m.gross, lang)} · ${t("py.tax.withheld")} ${formatTaka(m.tax, lang)}`}
                />
              ))}
              <Row
                label={t("py.tax.totalTax")}
                value={formatTaka(cert.data.totals.taxIncludingEarlier, lang)}
                strong
              />
              <Button className="mt-3 w-full" busy={busy} onClick={download}>
                {t("py.tax.download")}
              </Button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
