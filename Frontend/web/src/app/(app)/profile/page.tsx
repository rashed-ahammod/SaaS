"use client";
/**
 * Me: my record, my contact details (the only part employees change themselves,
 * spec §3), language, two-step verification for privileged roles, sign out.
 */
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { BACK_OFFICE } from "@/components/portal/portal-context";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardTitle,
  Field,
  Input,
  PageTitle,
  Row,
  TextArea,
} from "@/components/ui";
import { BankAccountForm } from "@/components/bank-account-form";
import { ConsentItem } from "@/components/consents";
import { ResignationCard } from "@/components/resignation-card";
import { api, ApiError, saveDownload, useApi } from "@/lib/api";
import type { MyAsset } from "@/lib/asset-types";
import type { Consent } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSession } from "@/lib/session";

const PRIVILEGED = ["admin", "system_admin", "hr", "accounts"];

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
  const askedFor2fa = useSearchParams().get("setup2fa") === "1";
  const privileged = me.roles.some((r) => PRIVILEGED.includes(r.split(":")[0]));
  // the name as this screen shows it, so the avatar matches it in both languages
  const shownName = profile
    ? lang === "bn"
      ? (profile.fullNameBn ?? profile.fullNameEn)
      : profile.fullNameEn
    : "";
  const initials =
    shownName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || (profile?.employeeCode.slice(0, 2).toUpperCase() ?? "");

  return (
    <div className="space-y-4">
      <PageTitle>{t("me.title")}</PageTitle>

      {profile && (
        <Card>
          <div className="mb-3 flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xl font-bold text-white"
            >
              {initials}
            </span>
            <p className="text-lg font-bold">{shownName}</p>
          </div>
          <Row label={t("me.code")} value={profile.employeeCode} />
          <Row
            label={t("me.joined")}
            value={formatDate(profile.joinDate, lang)}
          />
        </Card>
      )}

      {(askedFor2fa || (privileged && !me.mfaEnabled)) && <TwoFactorSetup />}

      {profile && <MyJob />}

      {profile && <ContactForm />}

      {profile && <SalaryAccount employeeId={profile.id} />}

      {profile && <MyAssets />}

      {profile && <MyDocuments employeeId={profile.id} />}

      {profile && <Consents />}

      {profile && <ResignationCard />}

      {me.permissions?.some((p) => BACK_OFFICE.includes(p)) && (
        <ButtonLink href="/portal" variant="secondary" className="w-full">
          {t("p.openPortal")}
        </ButtonLink>
      )}

      <Card>
        <CardTitle>{t("me.language")}</CardTitle>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={lang === "bn" ? "primary" : "secondary"}
            onClick={() => setLang("bn")}
          >
            বাংলা
          </Button>
          <Button
            variant={lang === "en" ? "primary" : "secondary"}
            onClick={() => setLang("en")}
          >
            English
          </Button>
        </div>
      </Card>

      <p className="px-1 text-sm text-slate-500">{t("me.install")}</p>
      <Button variant="danger" className="w-full" onClick={signOut}>
        {t("me.signOut")}
      </Button>
    </div>
  );
}

function ContactForm() {
  const { t } = useI18n();
  const { profile, reloadProfile } = useSession();
  const p = profile!;
  const [form, setForm] = useState({
    phone: p.phone ?? "",
    personalEmail: p.personalEmail ?? "",
    presentAddress: p.presentAddress ?? "",
    emergencyContactName: p.emergencyContact.name ?? "",
    emergencyContactPhone: p.emergencyContact.phone ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      // send only what changed, plus the version read (someone else may have changed it meanwhile)
      const before = {
        phone: p.phone ?? "",
        personalEmail: p.personalEmail ?? "",
        presentAddress: p.presentAddress ?? "",
        emergencyContactName: p.emergencyContact.name ?? "",
        emergencyContactPhone: p.emergencyContact.phone ?? "",
      };
      const changes = Object.fromEntries(
        Object.entries(form).filter(
          ([k, v]) =>
            v.trim() !== before[k as keyof typeof before] && v.trim() !== "",
        ),
      );
      await api.patch("/me/contact", { ...changes, version: p.version });
      await reloadProfile();
      setMessage({ kind: "success", text: t("common.saved") });
    } catch (err) {
      setMessage({ kind: "error", text: (err as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>{t("me.contact")}</CardTitle>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <form onSubmit={save}>
        <Field label={t("me.phone")}>
          <Input
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => set("phone")(e.target.value)}
          />
        </Field>
        <Field label={t("me.email")}>
          <Input
            type="email"
            value={form.personalEmail}
            onChange={(e) => set("personalEmail")(e.target.value)}
          />
        </Field>
        <Field label={t("me.address")}>
          <TextArea
            value={form.presentAddress}
            onChange={(e) => set("presentAddress")(e.target.value)}
            maxLength={500}
          />
        </Field>
        <Field label={t("me.emergencyName")}>
          <Input
            value={form.emergencyContactName}
            onChange={(e) => set("emergencyContactName")(e.target.value)}
            maxLength={200}
          />
        </Field>
        <Field label={t("me.emergencyPhone")}>
          <Input
            type="tel"
            inputMode="tel"
            value={form.emergencyContactPhone}
            onChange={(e) => set("emergencyContactPhone")(e.target.value)}
          />
        </Field>
        <Button type="submit" busy={busy} className="w-full">
          {t("common.save")}
        </Button>
      </form>
    </Card>
  );
}

function TwoFactorSetup() {
  const { t } = useI18n();
  const [setup, setSetup] = useState<{
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setSetup(
        await api.post<{ secret: string; otpauthUrl: string }>(
          "/auth/mfa/setup",
        ),
      );
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  // The QR is drawn here in the browser, not fetched from a chart service: the
  // otpauth link contains the 2FA secret itself, so it must never leave the
  // device. If drawing fails the key below is still there to type by hand.
  useEffect(() => {
    if (!setup) return;
    let alive = true;
    QRCode.toDataURL(setup.otpauthUrl, { margin: 1, width: 352 }).then(
      (url) => alive && setQr(url),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [setup]);

  async function enable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/session/mfa-enable", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-erp-client": "pwa",
        // The API requires a key on every write, and this call does not go
        // through lib/api.ts, which adds one. Without it the only answer is
        // "Idempotency-Key header is required", and 2FA cannot be turned on at
        // all — which locks every privileged role out of the portal.
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ code: code.trim() }),
    });
    setBusy(false);
    if (res.ok) setDone(true);
    else
      setError(
        ((await res.json().catch(() => ({}))) as { message?: string })
          .message ?? t("common.error"),
      );
  }

  return (
    <Card>
      <CardTitle>{t("me.mfa")}</CardTitle>
      {error && <Alert kind="error">{error}</Alert>}
      {done ? (
        <Alert kind="success">{t("me.mfaDone")}</Alert>
      ) : setup ? (
        <form onSubmit={enable}>
          <p className="mb-2 text-sm">{t("me.mfaScan")}</p>
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URI, nothing for next/image to fetch or optimise
            <img
              src={qr}
              alt=""
              width={176}
              height={176}
              className="mx-auto mb-3 rounded-xl border border-slate-200 bg-white"
            />
          )}
          <p className="mb-1 text-sm text-slate-600">{t("me.mfaKey")}</p>
          <p className="mb-3 rounded-xl bg-slate-100 p-3 text-center font-mono text-lg tracking-widest break-all select-all">
            {setup.secret}
          </p>
          <Field label={t("login.code")}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </Field>
          <Button type="submit" busy={busy} className="w-full">
            {t("login.verify")}
          </Button>
        </form>
      ) : (
        <Button busy={busy} className="w-full" onClick={start}>
          {t("me.mfaStart")}
        </Button>
      )}
    </Card>
  );
}

/** Consent for attendance data (WP12): read each notice, agree or withdraw. */
/** Company assets with me (laptop, phone...): confirm I received each one. */
function MyAssets() {
  const { t, lang } = useI18n();
  const { data, reload } = useApi<MyAsset[]>("/me/assets");
  const [busy, setBusy] = useState<string | null>(null);
  if (!data?.length) return null;
  return (
    <Card>
      <CardTitle>{t("as.me.title")}</CardTitle>
      <ul className="divide-y divide-slate-100">
        {data.map((a) => (
          <li key={a.assignmentId} className="py-2">
            <p className="font-medium">{a.name}</p>
            <p className="text-sm text-slate-500">
              {a.tag}
              {a.serialNo ? ` · ${a.serialNo}` : ""} ·{" "}
              {formatDate(a.assignedOn, lang, { short: true })}
            </p>
            {a.returnedOn ? (
              <p className="text-sm text-slate-500">
                {t("as.me.returned", {
                  date: formatDate(a.returnedOn, lang, { short: true }),
                })}
              </p>
            ) : a.acknowledgedAt ? (
              <p className="text-sm text-emerald-700">
                {t("as.me.acknowledged", {
                  date: formatDate(a.acknowledgedAt.slice(0, 10), lang, {
                    short: true,
                  }),
                })}
              </p>
            ) : (
              <Button
                variant="secondary"
                className="mt-1 w-full"
                busy={busy === a.assignmentId}
                onClick={async () => {
                  setBusy(a.assignmentId);
                  try {
                    await api.post(
                      `/me/assets/${a.assignmentId}/acknowledge`,
                      {},
                    );
                    reload();
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {t("as.me.acknowledge")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Consents() {
  const { t } = useI18n();
  const { data, reload } = useApi<Consent[]>("/me/consents");
  if (!data) return null;
  return (
    <Card>
      <CardTitle>{t("consent.title")}</CardTitle>
      {data.map((c) => (
        <ConsentItem key={c.purpose} consent={c} onChanged={reload} />
      ))}
    </Card>
  );
}

interface SalaryAccountRow {
  id: string;
  kind: "bank" | "wallet";
  provider: string | null;
  bankName: string | null;
  accountName: string;
  number: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "retired";
}

/** Where my salary goes, and a request to change it (HR approves). */
function SalaryAccount({ employeeId }: { employeeId: string }) {
  const { t } = useI18n();
  const accounts = useApi<SalaryAccountRow[]>(
    `/employees/${employeeId}/bank-accounts`,
  );
  const [changing, setChanging] = useState(false);
  const [sent, setSent] = useState(false);
  const shown = (accounts.data ?? []).filter(
    (a) => a.status === "approved" || a.status === "pending",
  );
  return (
    <Card>
      <CardTitle>{t("py.bank.title")}</CardTitle>
      {sent && <Alert kind="success">{t("py.bank.sent")}</Alert>}
      {accounts.data && !shown.length && (
        <p className="mb-3 text-sm text-slate-600">{t("py.bank.none")}</p>
      )}
      {shown.map((a) => (
        <div key={a.id} className="mb-3 flex items-start justify-between gap-2">
          <span>
            <span className="block font-medium">
              {a.bankName ?? a.provider}
            </span>
            <span className="block font-mono text-sm text-slate-600">
              {a.number}
            </span>
            <span className="block text-sm text-slate-500">
              {a.accountName}
            </span>
          </span>
          <Badge color={a.status === "approved" ? "green" : "amber"}>
            {t(`py.bank.status.${a.status}`)}
          </Badge>
        </div>
      ))}
      {changing ? (
        <BankAccountForm
          employeeId={employeeId}
          onCancel={() => setChanging(false)}
          onDone={() => {
            setChanging(false);
            setSent(true);
            accounts.reload();
          }}
        />
      ) : (
        accounts.data &&
        !shown.some((a) => a.status === "pending") && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => (setSent(false), setChanging(true))}
          >
            {shown.length ? t("py.bank.change") : t("py.bank.new")}
          </Button>
        )
      )}
    </Card>
  );
}

/** Where I work: designation, department, office, line manager, probation / notice. */
function MyJob() {
  const { t, lang } = useI18n();
  const { profile } = useSession();
  if (!profile) return null;
  const a = profile.currentAssignment;
  const status =
    profile.status === "probation" && profile.probationEndDate
      ? t("lc.prob.onProbation", {
          date: formatDate(profile.probationEndDate, lang),
        })
      : profile.status === "notice" && profile.lastWorkingDay
        ? `${t("p.emp.status.notice")} · ${t("lc.notice.lastDay")}: ${formatDate(profile.lastWorkingDay, lang)}`
        : t(`p.emp.status.${profile.status}`);
  return (
    <Card>
      <CardTitle>{t("lc.me.job")}</CardTitle>
      {a && (
        <>
          <Row
            label={t("lc.me.designation")}
            value={
              lang === "bn"
                ? (a.designation.nameBn ?? a.designation.nameEn)
                : a.designation.nameEn
            }
          />
          <Row label={t("lc.me.department")} value={a.department.name} />
          <Row label={t("lc.me.branch")} value={a.branch.name} />
          <Row
            label={t("lc.me.manager")}
            value={a.lineManager?.fullNameEn ?? "—"}
          />
        </>
      )}
      <Row label={t("lc.me.status")} value={status} />
    </Card>
  );
}

interface MyDocument {
  id: string;
  docType: string;
  title: string | null;
  fileName: string;
  expiresOn: string | null;
}

/** The documents HR holds about me (NID copy, certificates ...), to view or download. */
function MyDocuments({ employeeId }: { employeeId: string }) {
  const { t, lang } = useI18n();
  const docs = useApi<MyDocument[]>(`/employees/${employeeId}/documents`);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardTitle>{t("lc.me.docs")}</CardTitle>
      {error && <Alert kind="error">{error}</Alert>}
      {docs.data && !docs.data.length && (
        <p className="text-sm text-slate-600">{t("lc.me.noDocs")}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {docs.data?.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left active:bg-slate-50"
              onClick={async () => {
                setError(null);
                try {
                  await saveDownload(
                    await api.file(
                      `/employees/${employeeId}/documents/${d.id}/file`,
                    ),
                    d.fileName,
                  );
                } catch (e) {
                  setError((e as ApiError).message);
                }
              }}
            >
              <span>
                <span className="block font-medium">
                  {t(`lc.doc.type.${d.docType}`)}
                </span>
                <span className="block text-sm text-slate-500">
                  {d.title ?? d.fileName}
                  {d.expiresOn
                    ? ` · ${t("lc.doc.expires")} ${formatDate(d.expiresOn, lang, { short: true })}`
                    : ""}
                </span>
              </span>
              <span aria-hidden className="text-slate-400">
                ↓
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
