'use client';
/**
 * Apply for leave: type, dates (or a half day), reason. "Check days" asks the
 * server how many days count (weekends, holidays, sandwich rule), the balance,
 * and how many colleagues would be off; then the request goes for approval.
 */
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { Alert, Button, Card, ErrorBox, Field, Input, Loading, PageTitle, Select, TextArea } from '@/components/ui';
import { api, ApiError, useApi } from '@/lib/api';
import { dhakaToday, formatDate, formatDays, num } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import type { Balance, LeavePreview, LeaveType } from '@/lib/types';

export default function ApplyLeavePage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { profile } = useSession();
  const balances = useApi<{ balances: Balance[] }>('/me/leave-balances');
  const types = useApi<LeaveType[]>(profile ? `/companies/${profile.companyId}/leave-types` : null);

  const today = dhakaToday();
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [halfDay, setHalfDay] = useState<'' | 'first_half' | 'second_half'>('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<LeavePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null);

  const typeInfo = useMemo(() => types.data?.find((x) => x.id === leaveTypeId), [types.data, leaveTypeId]);
  const options = balances.data?.balances ?? [];

  const body = () => ({
    leaveTypeId,
    fromDate,
    toDate: halfDay ? fromDate : toDate,
    ...(halfDay ? { halfDay } : {}),
    ...(reason.trim() ? { reason: reason.trim() } : {}),
  });

  async function check() {
    if (!profile) return;
    setBusy('check');
    setError(null);
    try {
      setPreview(await api.post<LeavePreview>(`/employees/${profile.id}/leave-requests/preview`, body()));
    } catch (e) {
      setPreview(null);
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  async function apply(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setBusy('apply');
    setError(null);
    try {
      await api.post(`/employees/${profile.id}/leave-requests`, body());
      router.push('/leave');
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  // any change makes the preview out of date
  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null);
  };

  if (balances.loading) return <Loading />;
  if (balances.error) return <ErrorBox error={balances.error} onRetry={balances.reload} />;

  return (
    <div>
      <PageTitle>{t('leave.apply')}</PageTitle>
      <Card>
        <form onSubmit={apply}>
          {error && <Alert kind="error">{error}</Alert>}
          <Field label={t('leave.type')}>
            <Select value={leaveTypeId} onChange={(e) => change(setLeaveTypeId)(e.target.value)} required>
              <option value="">—</option>
              {options.map((b) => (
                <option key={b.leaveTypeId} value={b.leaveTypeId}>
                  {(lang === 'bn' ? (b.nameBn ?? b.nameEn) : b.nameEn) + (b.usesBalance ? ` (${formatDays(b.available, lang)})` : '')}
                </option>
              ))}
            </Select>
          </Field>

          {typeInfo?.allowHalfDay && (
            <Field label={t('leave.halfDay')}>
              <Select value={halfDay} onChange={(e) => change(setHalfDay)(e.target.value as typeof halfDay)}>
                <option value="">{t('leave.fullDay')}</option>
                <option value="first_half">{t('leave.firstHalf')}</option>
                <option value="second_half">{t('leave.secondHalf')}</option>
              </Select>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('leave.from')}>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  change(setFromDate)(e.target.value);
                  if (e.target.value > toDate) setToDate(e.target.value);
                }}
                required
              />
            </Field>
            {!halfDay && (
              <Field label={t('leave.to')}>
                <Input type="date" value={toDate} min={fromDate} onChange={(e) => change(setToDate)(e.target.value)} required />
              </Field>
            )}
          </div>

          <Field label={t('leave.reason')}>
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>

          {preview && (
            <Alert kind={preview.teamWarnings.length ? 'warning' : 'info'}>
              <p className="font-semibold">{t('leave.preview', { n: formatDays(preview.days, lang) })}</p>
              {preview.available !== null && <p>{t('leave.previewAvailable', { n: formatDays(preview.available, lang) })}</p>}
              {preview.teamWarnings.map((w) => (
                <p key={w.date}>{t('leave.teamWarning', { date: formatDate(w.date, lang, { short: true }), count: num(w.onLeave, lang), total: num(w.headcount, lang) })}</p>
              ))}
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" busy={busy === 'check'} disabled={!leaveTypeId} onClick={check}>
              {t('leave.check')}
            </Button>
            <Button type="submit" busy={busy === 'apply'} disabled={!leaveTypeId}>
              {t('common.submit')}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
