"use client";
/**
 * Calling the ERP API from the pages (through /api/erp, see src/app/api/erp).
 *
 *   const balances = await api.get<Balances>('/me/leave-balances');
 *   await api.post('/me/punches/mobile', { deviceId, latitude, longitude });
 *
 * Every write gets a fresh Idempotency-Key (the API requires one), so a double
 * tap or a retry after a lost answer never does the same thing twice.
 * A 401 means the session ended: go to the login page.
 */
import { useCallback, useEffect, useState } from "react";
import { currentLang } from "./i18n";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * "Your role requires two-factor authentication. Set it up and sign in again."
 *
 * A privileged role that has not set 2FA up yet is refused every business
 * route with this, and the only way out is the 2FA card on /profile. So the
 * pages that load data while signing in must treat it as "no data yet", never
 * as a dead end, or the user is locked out of the one page that unlocks them.
 */
export function isMfaSetupRequired(error: unknown): boolean {
  return error instanceof ApiError && error.code === "AUTH_MFA_REQUIRED";
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * High-risk actions (bank account change, bank file, role grants) need a fresh 2FA
 * code (step-up). The HR portal registers a handler that asks for the code; the
 * request is then sent again with X-OTP-Code. Without a handler the error is shown.
 */
let stepUpHandler: (() => Promise<string | null>) | null = null;
export function setStepUpHandler(
  handler: (() => Promise<string | null>) | null,
) {
  stepUpHandler = handler;
}

interface CallOptions {
  idempotencyKey?: string;
  raw?: boolean;
  otpCode?: string;
}

async function call<T>(
  method: Method,
  path: string,
  body?: unknown,
  o: CallOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "x-erp-client": "pwa",
    "x-language": currentLang(),
  };
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm)
    headers["content-type"] = "application/json";
  // the same key on a retry (e.g. after the step-up code), so the action can never happen twice
  const idempotencyKey = o.idempotencyKey ?? crypto.randomUUID();
  if (method !== "GET") headers["idempotency-key"] = idempotencyKey;
  if (o.otpCode) headers["x-otp-code"] = o.otpCode;

  let res: Response;
  try {
    res = await fetch(`/api/erp${path}`, {
      method,
      headers,
      body:
        body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      "OFFLINE",
      currentLang() === "bn"
        ? "ইন্টারনেট সংযোগ নেই।"
        : "No internet connection.",
    );
  }

  if (res.status === 401) {
    const next = encodeURIComponent(window.location.pathname);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload on purpose: clears personal data held in memory
    window.location.assign(`/login?next=${next}`);
    throw new ApiError(401, "AUTH_REQUIRED", "Signed out");
  }
  if (!res.ok) {
    const error = await toError(res);
    if (error.code === "AUTH_STEP_UP_REQUIRED" && stepUpHandler && !o.otpCode) {
      const code = await stepUpHandler();
      if (code)
        return call<T>(method, path, body, {
          ...o,
          idempotencyKey,
          otpCode: code,
        });
    }
    throw error;
  }
  if (o.raw) return res as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function toError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}));
  const message = Array.isArray(body.message)
    ? body.message.join(" ")
    : (body.message ?? res.statusText);
  return new ApiError(res.status, body.code ?? "ERROR", message, body.details);
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path),
  /** `otpCode`: a step-up code the screen asked for itself (the app has no step-up handler) */
  post: <T>(
    path: string,
    body?: unknown,
    idempotencyKey?: string,
    otpCode?: string,
  ) => call<T>("POST", path, body ?? {}, { idempotencyKey, otpCode }),
  patch: <T>(path: string, body: unknown) => call<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => call<T>("PUT", path, body),
  delete: <T>(path: string) => call<T>("DELETE", path),
  /** multipart/form-data upload (spreadsheets, documents) */
  upload: <T>(path: string, form: FormData) => call<T>("POST", path, form),
  /** a file produced by a write (e.g. a bank file): the raw response */
  postFile: (path: string, body?: unknown) =>
    call<Response>("POST", path, body ?? {}, { raw: true }),
  /** A file (e.g. payslip PDF): the raw response, to read as a blob. */
  file: (path: string) => call<Response>("GET", path, undefined, { raw: true }),
};

/**
 * Load data for a page. `path` null = not yet (e.g. waiting for another value).
 *   const { data, error, loading, reload } = useApi<Profile>('/me/profile');
 */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{
    data?: T;
    error?: ApiError;
    loading: boolean;
  }>({ loading: path !== null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the loading state while the request runs
    setState((s) => ({ ...s, loading: true, error: undefined }));
    api
      .get<T>(path)
      .then((data) => alive && setState({ data, loading: false }))
      .catch((error: ApiError) => alive && setState({ error, loading: false }));
    return () => {
      alive = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}

/** Save a downloaded file (blob) on the phone. */
export async function saveDownload(
  res: Response,
  fallbackName: string,
): Promise<void> {
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition") ?? "";
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
