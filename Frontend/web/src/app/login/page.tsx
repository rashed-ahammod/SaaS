"use client";
/**
 * Sign in: company code (workspace), e-mail or mobile, password; then the
 * 6-digit code when two-step verification is on.
 */
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { toError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const WORKSPACE_KEY = "erp-workspace";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [workspace, setWorkspace] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill the company code used last time on this phone
    setWorkspace(localStorage.getItem(WORKSPACE_KEY) ?? "");
  }, []);

  /** Only paths inside this app (never another site) after login. */
  const goNext = () =>
    router.replace(
      next && next.startsWith("/") && !next.startsWith("//") ? next : "/",
    );

  async function send(url: string, body: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-erp-client": "pwa",
          "x-language": lang,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await toError(res);
      return (await res.json()) as {
        signedIn?: boolean;
        mfaRequired?: boolean;
        mfaToken?: string;
        mfaSetupRequired?: boolean;
      };
    } catch (e) {
      setError((e as Error).message || t("common.error"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    const result = await send("/api/session", {
      workspace: workspace.trim().toLowerCase(),
      login: login.trim(),
      password,
    });
    if (!result) return;
    localStorage.setItem(WORKSPACE_KEY, workspace.trim().toLowerCase());
    if (result.mfaRequired && result.mfaToken) setMfaToken(result.mfaToken);
    else if (result.mfaSetupRequired) router.replace("/profile?setup2fa=1");
    else goNext();
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    const result = await send("/api/session/mfa", {
      mfaToken,
      code: code.trim(),
      rememberDevice,
    });
    if (result?.signedIn) goNext();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8">
      <div className="mb-6 text-center">
        <Image
          src="/icons/icon-192.png"
          alt=""
          width={64}
          height={64}
          priority
          className="mx-auto mb-3 rounded-2xl"
        />
        <h1 className="text-2xl font-bold">{t("app.name")}</h1>
      </div>

      <Card>
        {error && <Alert kind="error">{error}</Alert>}
        {mfaToken ? (
          <form onSubmit={onVerify}>
            <h2 className="mb-3 text-lg font-semibold">
              {t("login.mfaTitle")}
            </h2>
            <Field label={t("login.code")}>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
              />
            </Field>
            <label className="mb-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 accent-green-800"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
              />
              <span>
                {t("login.rememberDevice")}
                <span className="mt-0.5 block text-xs text-slate-500">
                  {t("login.rememberDeviceHint")}
                </span>
              </span>
            </label>
            <Button type="submit" busy={busy} className="w-full">
              {t("login.verify")}
            </Button>
          </form>
        ) : (
          <form onSubmit={onLogin}>
            <h2 className="mb-3 text-lg font-semibold">{t("login.title")}</h2>
            <Field label={t("login.workspace")} hint={t("login.workspaceHint")}>
              <Input
                name="workspace"
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                autoComplete="organization"
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
            </Field>
            <Field label={t("login.login")}>
              <Input
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                inputMode="email"
                required
              />
            </Field>
            <Field label={t("login.password")}>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <Button type="submit" busy={busy} className="w-full">
              {t("login.submit")}
            </Button>
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
