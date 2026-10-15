'use client';
/**
 * Me: my record, my contact details (the only part employees change themselves,
 * spec §3), language, two-step verification for privileged roles, sign out.
 */
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert, Button, Card, CardTitle, Field, Input, PageTitle, Row, TextArea } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const PRIVILEGED = ['admin', 'system_admin', 'hr', 'accounts'];

export default function ProfilePage() {
  return (
    <Suspense>
      <Profile />
    </Suspense>
  );
}

function Profile() {
  const { t, lang, setLang } = useI18n();
  const { me, profile, signOut } = useSession();
  const askedFor2fa = useSearchParams().get('setup2fa') === '1';
  const privileged = me.roles.some((r) => PRIVILEGED.includes(r.split(':')[0]));

  return (
    <div className="space-y-4">
      <PageTitle>{t('me.title')}</PageTitle>

      {profile && (
        <Card>
          <p className="text-lg font-bold">{lang === 'bn' ? (profile.fullNameBn ?? profile.fullNameEn) : profile.fullNameEn}</p>
          <Row label={t('me.code')} value={profile.employeeCode} />
          <Row label={t('me.joined')} value={formatDate(profile.joinDate, lang)} />
        </Card>
      )}

      {(askedFor2fa || (privileged && !me.mfaEnabled)) && <TwoFactorSetup />}

      {profile && <ContactForm />}

      <Card>
        <CardTitle>{t('me.language')}</CardTitle>
        <div className="grid grid-cols-2 gap-2">
          <Button variant={lang === 'bn' ? 'primary' : 'secondary'} onClick={() => setLang('bn')}>
            বাংলা
          </Button>
          <Button variant={lang === 'en' ? 'primary' : 'secondary'} onClick={() => setLang('en')}>
            English
          </Button>
        </div>
      </Card>

      <p className="px-1 text-sm text-slate-500">{t('me.install')}</p>
      <Button variant="danger" className="w-full" onClick={signOut}>
        {t('me.signOut')}
      </Button>
    </div>
  );
}

function ContactForm() {
  const { t } = useI18n();
  const { profile, reloadProfile } = useSession();
  const p = profile!;
  const [form, setForm] = useState({
    phone: p.phone ?? '',
    personalEmail: p.personalEmail ?? '',
    presentAddress: p.presentAddress ?? '',
    emergencyContactName: p.emergencyContact.name ?? '',
    emergencyContactPhone: p.emergencyContact.phone ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      // send only what changed, plus the version read (someone else may have changed it meanwhile)
      const before = { phone: p.phone ?? '', personalEmail: p.personalEmail ?? '', presentAddress: p.presentAddress ?? '', emergencyContactName: p.emergencyContact.name ?? '', emergencyContactPhone: p.emergencyContact.phone ?? '' };
      const changes = Object.fromEntries(Object.entries(form).filter(([k, v]) => v.trim() !== before[k as keyof typeof before] && v.trim() !== ''));
      await api.patch('/me/contact', { ...changes, version: p.version });
      await reloadProfile();
      setMessage({ kind: 'success', text: t('common.saved') });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{t('me.contact')}</CardTitle>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <form onSubmit={save}>
        <Field label={t('me.phone')}>
          <Input type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone')(e.target.value)} />
        </Field>
        <Field label={t('me.email')}>
          <Input type="email" value={form.personalEmail} onChange={(e) => set('personalEmail')(e.target.value)} />
        </Field>
        <Field label={t('me.address')}>
          <TextArea value={form.presentAddress} onChange={(e) => set('presentAddress')(e.target.value)} maxLength={500} />
        </Field>
        <Field label={t('me.emergencyName')}>
          <Input value={form.emergencyContactName} onChange={(e) => set('emergencyContactName')(e.target.value)} maxLength={200} />
        </Field>
        <Field label={t('me.emergencyPhone')}>
          <Input type="tel" inputMode="tel" value={form.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone')(e.target.value)} />
        </Field>
        <Button type="submit" busy={busy} className="w-full">
          {t('common.save')}
        </Button>
      </form>
    </Card>
  );
}

function TwoFactorSetup() {
  const { t } = useI18n();
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setSecret((await api.post<{ secret: string }>('/auth/mfa/setup')).secret);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function enable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/session/mfa-enable', { method: 'POST', headers: { 'content-type': 'application/json', 'x-erp-client': 'pwa' }, body: JSON.stringify({ code: code.trim() }) });
    setBusy(false);
    if (res.ok) setDone(true);
    else setError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? t('common.error'));
  }

  return (
    <Card>
      <CardTitle>{t('me.mfa')}</CardTitle>
      {error && <Alert kind="error">{error}</Alert>}
      {done ? (
        <Alert kind="success">{t('me.mfaDone')}</Alert>
      ) : secret ? (
        <form onSubmit={enable}>
          <p className="mb-2 text-sm">{t('me.mfaSetup')}</p>
          <p className="mb-3 rounded-xl bg-slate-100 p-3 text-center font-mono text-lg tracking-widest break-all select-all">{secret}</p>
          <Field label={t('login.code')}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required />
          </Field>
          <Button type="submit" busy={busy} className="w-full">
            {t('login.verify')}
          </Button>
        </form>
      ) : (
        <Button busy={busy} className="w-full" onClick={start}>
          {t('me.mfaStart')}
        </Button>
      )}
    </Card>
  );
}
