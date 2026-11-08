"use client";
/**
 * The public enquiry form's screen (src/app/enquiry/[form]). Sends to /api/enquiry/<form>,
 * which passes it to the ERP as a lead; the page never sees the service key.
 */
import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  TextArea,
} from "@/components/ui";
import { DISTRICTS, DISTRICT_BN } from "@/lib/crm-types";
import { useI18n } from "@/lib/i18n";
import type { PublicEnquiryForm } from "@/lib/server/enquiry";

/** One id per opened form: pressing Send twice still makes one lead. */
function newFormId(): string {
  // randomUUID needs a secure context (HTTPS or localhost); a LAN test over http falls back
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const EMPTY = {
  name: "",
  organisation: "",
  phone: "",
  email: "",
  district: "",
  message: "",
  website: "",
};

export function EnquiryForm({
  form,
  shareRef,
}: {
  form: PublicEnquiryForm;
  shareRef: string;
}) {
  const { t, lang, setLang } = useI18n();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const formId = useRef("");
  const openedAt = useRef(0);

  const start = () => {
    formId.current = newFormId();
    openedAt.current = Date.now();
  };
  useEffect(start, []);

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function onSend(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch(`/api/enquiry/${encodeURIComponent(form.slug)}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-erp-client": "enquiry",
        },
        body: JSON.stringify({
          ...values,
          formId: formId.current,
          ref: shareRef,
          elapsedMs: Date.now() - openedAt.current,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        code?: string;
        problems?: string[];
      };
      if (res.ok) {
        setSent(true);
        setValues(EMPTY);
      } else if (body.code === "INVALID")
        setErrors(
          (body.problems ?? ["contact"]).map((p) => t(`eq.problem.${p}`)),
        );
      else if (body.code === "TOO_MANY") setErrors([t("eq.tooMany")]);
      else if (body.code === "FORM_NOT_FOUND") setErrors([t("eq.notFound")]);
      else setErrors([t("eq.unavailable")]);
    } catch {
      setErrors([t("eq.unavailable")]);
    } finally {
      setBusy(false);
    }
  }

  const companyName = lang === "bn" ? form.nameBn : form.nameEn;
  const districts = [...DISTRICTS].sort((a, b) =>
    lang === "bn"
      ? (DISTRICT_BN[a] ?? a).localeCompare(DISTRICT_BN[b] ?? b, "bn")
      : a.localeCompare(b),
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8">
      <div className="mb-5 text-center">
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={56}
          height={56}
          priority
          className="mx-auto mb-3 rounded-2xl"
        />
        <p className="text-sm font-semibold text-emerald-800">{companyName}</p>
        <h1 className="text-2xl font-bold text-slate-900">
          {sent ? t("eq.sentTitle") : t("eq.title")}
        </h1>
      </div>

      <Card>
        {sent ? (
          <div className="text-center">
            <Alert kind="success">{t("eq.sentBody")}</Alert>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                start();
                setSent(false);
              }}
            >
              {t("eq.again")}
            </Button>
          </div>
        ) : (
          <form onSubmit={onSend} noValidate>
            <p className="mb-4 text-sm text-slate-600">{t("eq.intro")}</p>
            {errors.length > 0 && (
              <Alert kind="error">
                {errors.map((m) => (
                  <span key={m} className="block">
                    {m}
                  </span>
                ))}
              </Alert>
            )}
            <Field label={t("eq.name")}>
              <Input
                id="eq-name"
                value={values.name}
                onChange={set("name")}
                autoComplete="name"
                maxLength={200}
                required
              />
            </Field>
            <Field label={t("eq.organisation")}>
              <Input
                id="eq-organisation"
                value={values.organisation}
                onChange={set("organisation")}
                autoComplete="organization"
                maxLength={200}
              />
            </Field>
            <Field label={t("eq.phone")} hint={t("eq.phoneHint")}>
              <Input
                id="eq-phone"
                type="tel"
                value={values.phone}
                onChange={set("phone")}
                autoComplete="tel"
                inputMode="tel"
                maxLength={40}
              />
            </Field>
            <Field label={t("eq.email")} hint={t("eq.contactHint")}>
              <Input
                id="eq-email"
                type="email"
                value={values.email}
                onChange={set("email")}
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                maxLength={200}
              />
            </Field>
            <Field label={t("eq.district")}>
              <Select
                id="eq-district"
                value={values.district}
                onChange={set("district")}
              >
                <option value="">{t("eq.districtPick")}</option>
                {districts.map((d) => (
                  <option key={d} value={d}>
                    {lang === "bn" ? (DISTRICT_BN[d] ?? d) : d}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("eq.message")} hint={t("eq.messageHint")}>
              <TextArea
                id="eq-message"
                value={values.message}
                onChange={set("message")}
                rows={4}
                maxLength={4000}
              />
            </Field>
            {/* people never see or fill this; a bot that fills every field is dropped */}
            <div
              aria-hidden
              className="absolute -left-[9999px] h-px w-px overflow-hidden"
            >
              <label>
                {t("eq.website")}
                <input
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={values.website}
                  onChange={set("website")}
                />
              </label>
            </div>
            <Button type="submit" busy={busy} className="w-full">
              {t("eq.send")}
            </Button>
            <p className="mt-3 text-center text-xs text-slate-500">
              {t("eq.privacy")}
            </p>
          </form>
        )}
      </Card>

      <div className="mt-6 flex justify-center gap-2">
        <Button
          variant={lang === "bn" ? "secondary" : "ghost"}
          onClick={() => setLang("bn")}
        >
          বাংলা
        </Button>
        <Button
          variant={lang === "en" ? "secondary" : "ghost"}
          onClick={() => setLang("en")}
        >
          English
        </Button>
      </div>
    </main>
  );
}
