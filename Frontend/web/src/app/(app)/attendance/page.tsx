'use client';
/**
 * Attendance: punch in / out, and the month's days.
 *
 * Punching from the phone (spec §6.2): the phone must be registered and
 * approved by HR, and the employee must be inside the office geo-fence. The
 * server records its own time, never the phone's. Employees allowed to punch
 * from an office computer use "Punch from office computer".
 */
import { useEffect, useState } from 'react';
import { DayBadge } from '@/components/status';
import { Alert, Button, Card, CardTitle, Empty, ErrorBox, Field, Input, Loading, PageTitle } from '@/components/ui';
import { api, ApiError, useApi } from '@/lib/api';
import { currentPosition, defaultDeviceName, deviceId } from '@/lib/device';
import { addMonths, dhakaToday, formatDate, formatMonth, formatTime, monthRange, num, weekdayName } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { AttendanceDays, Device } from '@/lib/types';

export default function AttendancePage() {
  const { t } = useI18n();
  const [month, setMonth] = useState(dhakaToday().slice(0, 7));
  const [refresh, setRefresh] = useState(0);

  return (
    <div>
      <PageTitle>{t('att.title')}</PageTitle>
      <PunchCard onPunched={() => setRefresh((n) => n + 1)} />
      <MonthDays month={month} setMonth={setMonth} refresh={refresh} />
    </div>
  );
}

function PunchCard({ onPunched }: { onPunched: () => void }) {
  const { t, lang } = useI18n();
  const devices = useApi<Device[]>('/me/devices');
  const [myId, setMyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<'phone' | 'web' | 'register' | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the install id lives in this browser only
    setMyId(deviceId());
    setName(defaultDeviceName());
  }, []);

  const mine = devices.data?.find((d) => d.deviceId === myId);

  async function run(kind: 'phone' | 'web' | 'register', work: () => Promise<void>) {
    setBusy(kind);
    setMessage(null);
    try {
      await work();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as ApiError).message || t('common.error') });
    } finally {
      setBusy(null);
    }
  }

  const punchPhone = () =>
    run('phone', async () => {
      setMessage({ kind: 'info', text: t('att.locating') });
      let position;
      try {
        position = await currentPosition();
      } catch {
        setMessage({ kind: 'error', text: t('att.locationDenied') });
        return;
      }
      const res = await api.post<{ punchedAt: string }>('/me/punches/mobile', { deviceId: myId, ...position });
      setMessage({ kind: 'success', text: t('att.punched', { time: formatTime(res.punchedAt, lang) }) });
      onPunched();
    });

  const punchWeb = () =>
    run('web', async () => {
      const res = await api.post<{ punchedAt: string }>('/me/punches/web');
      setMessage({ kind: 'success', text: t('att.punched', { time: formatTime(res.punchedAt, lang) }) });
      onPunched();
    });

  const register = () =>
    run('register', async () => {
      await api.post('/me/devices', { deviceId: myId, name: name.trim() || defaultDeviceName() });
      devices.reload();
    });

  return (
    <Card className="mb-4">
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      {devices.loading || !myId ? (
        <Loading />
      ) : mine?.status === 'active' ? (
        <Button className="mb-3 w-full py-4 text-lg" busy={busy === 'phone'} onClick={punchPhone}>
          {t('att.punch')}
        </Button>
      ) : mine?.status === 'pending' ? (
        <Alert kind="warning">{t('att.phonePending')}</Alert>
      ) : (
        <div className="mb-3">
          <p className="mb-2 text-sm text-slate-600">{mine?.status === 'revoked' ? t('att.phoneRevoked') : t('att.phoneNotRegistered')}</p>
          <Field label={t('att.phoneName')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          <Button variant="secondary" className="w-full" busy={busy === 'register'} onClick={register}>
            {t('att.registerPhone')}
          </Button>
        </div>
      )}
      <Button variant="ghost" className="w-full text-sm" busy={busy === 'web'} onClick={punchWeb}>
        {t('att.punchOffice')}
      </Button>
    </Card>
  );
}

function MonthDays({ month, setMonth, refresh }: { month: string; setMonth: (m: string) => void; refresh: number }) {
  const { t, lang } = useI18n();
  const today = dhakaToday();
  const { from, to: monthEnd } = monthRange(month);
  const to = monthEnd > today ? today : monthEnd;
  const { data, error, loading, reload } = useApi<AttendanceDays>(`/me/attendance?from=${from}&to=${to}`);

  // reload after a punch
  useEffect(() => {
    if (refresh) reload();
  }, [refresh, reload]);

  const totals = data?.totals;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <Button variant="ghost" aria-label="previous month" onClick={() => setMonth(addMonths(month, -1))}>
          ‹
        </Button>
        <CardTitle>{formatMonth(month, lang)}</CardTitle>
        <Button variant="ghost" aria-label="next month" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(addMonths(month, 1))}>
          ›
        </Button>
      </div>
      {totals && (
        <p className="mb-2 text-sm text-slate-600">
          {t('att.summary', { p: num(totals.present ?? 0, lang), l: num(totals.late ?? 0, lang), a: num(totals.absent ?? 0, lang), lv: num(totals.on_leave ?? 0, lang) })}
        </p>
      )}
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.days.length ? (
        <Empty />
      ) : (
        <ul className="divide-y divide-slate-100">
          {[...data.days].reverse().map((d) => (
            <li key={d.date} className="flex items-center justify-between gap-2 py-2.5">
              <div>
                <p className="font-medium">
                  {weekdayName(d.date, lang)}, {formatDate(d.date, lang, { short: true })}
                </p>
                <p className="text-xs text-slate-500 tabular-nums">
                  {d.holidayName ??
                    `${t('att.in')} ${formatTime(d.firstIn, lang)} · ${t('att.out')} ${formatTime(d.lastOut, lang)}${d.lateMinutes ? ` · ${t('att.late', { m: num(d.lateMinutes, lang) })}` : ''}`}
                </p>
              </div>
              <DayBadge status={d.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
