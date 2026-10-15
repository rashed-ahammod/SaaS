'use client';
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
import { useCallback, useEffect, useState } from 'react';
import { currentLang } from './i18n';

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

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function call<T>(method: Method, path: string, body?: unknown, o: { idempotencyKey?: string; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-erp-client': 'pwa', 'x-language': currentLang() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['idempotency-key'] = o.idempotencyKey ?? crypto.randomUUID();

  let res: Response;
  try {
    res = await fetch(`/api/erp${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'OFFLINE', currentLang() === 'bn' ? 'ইন্টারনেট সংযোগ নেই।' : 'No internet connection.');
  }

  if (res.status === 401) {
    const next = encodeURIComponent(window.location.pathname);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload on purpose: clears personal data held in memory
    window.location.assign(`/login?next=${next}`);
    throw new ApiError(401, 'AUTH_REQUIRED', 'Signed out');
  }
  if (!res.ok) throw await toError(res);
  if (o.raw) return res as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function toError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}));
  const message = Array.isArray(body.message) ? body.message.join(' ') : (body.message ?? res.statusText);
  return new ApiError(res.status, body.code ?? 'ERROR', message, body.details);
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown, idempotencyKey?: string) => call<T>('POST', path, body ?? {}, { idempotencyKey }),
  patch: <T>(path: string, body: unknown) => call<T>('PATCH', path, body),
  /** A file (e.g. payslip PDF): the raw response, to read as a blob. */
  file: (path: string) => call<Response>('GET', path, undefined, { raw: true }),
};

/**
 * Load data for a page. `path` null = not yet (e.g. waiting for another value).
 *   const { data, error, loading, reload } = useApi<Profile>('/me/profile');
 */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: path !== null });
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
export async function saveDownload(res: Response, fallbackName: string): Promise<void> {
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
