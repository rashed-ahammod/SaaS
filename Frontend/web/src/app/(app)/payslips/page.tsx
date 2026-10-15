'use client';
/** My payslips: one row per approved run, newest first. */
import Link from 'next/link';
import { Card, Empty, ErrorBox, Loading, PageTitle } from '@/components/ui';
import { useApi } from '@/lib/api';
import { formatMonth, formatTaka } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { PayslipSummary } from '@/lib/types';

export default function PayslipsPage() {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useApi<PayslipSummary[]>('/me/payslips');

  return (
    <div>
      <PageTitle>{t('pay.title')}</PageTitle>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.length ? (
        <Empty />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {data.map((p) => (
              <li key={p.runId}>
                <Link href={`/payslips/${p.runId}`} className="flex items-center justify-between gap-2 px-4 py-3 active:bg-slate-50">
                  <span>
                    <span className="block font-medium">{formatMonth(p.period, lang)}</span>
                    <span className="block text-sm text-slate-500">{p.runType === 'bonus' && p.bonusName ? p.bonusName : t(`pay.type.${p.runType}`)}</span>
                  </span>
                  <span className="font-bold tabular-nums">{formatTaka(p.net, lang)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
