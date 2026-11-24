/**
 * Server-side only: talking to the ERP API (backend) and the session cookie.
 *
 * The browser never sees the access token. After login it lives in an httpOnly,
 * SameSite=Strict cookie; the route handlers in src/app/api read it and add
 * "Authorization: Bearer <token>" when they forward a request to the API.
 */
export const SESSION_COOKIE = "erp_session";

/**
 * "Remember this device": set after someone ticks the box at the 2FA step, and
 * sent back to the API on the next sign-in so the code step can be skipped.
 * It outlives sign-out on purpose — that is what makes the device remembered.
 * httpOnly, so the page itself can never read or copy it.
 */
export const DEVICE_COOKIE = "erp_device";

/** Requests from our own pages carry this header; a cross-site form cannot set it (CSRF guard). */
export const CLIENT_HEADER = "x-erp-client";

export function backendUrl(path: string): string {
  const base = (process.env.BACKEND_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function deviceCookieOptions(maxAgeSeconds: number) {
  return { ...sessionCookieOptions(maxAgeSeconds) };
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    // HTTPS only in production; SESSION_COOKIE_SECURE=false allows a pilot test over plain http on the office LAN
    secure:
      process.env.NODE_ENV === "production" &&
      process.env.SESSION_COOKIE_SECURE !== "false",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * The caller's IP address, for the API's audit entries and rate-limit keys, or
 * "unknown".
 *
 * Vercel documents `x-forwarded-for` as "the public IP address of the client"
 * and says it overwrites the header rather than forwarding an external one, to
 * prevent spoofing — but it does not promise that for a request sent straight
 * to the app, and it does not document the format. So nothing here trusts the
 * shape of the value: we take the first entry and hand back only a well-formed
 * IP literal. Anything else (a forged word, a header-injection attempt, an
 * empty hop) becomes "unknown", which is honest, rather than being written into
 * the audit log as though it were an address.
 */
export function clientIp(headers: Headers): string {
  const candidate =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "";
  if (IPV4.test(candidate))
    return candidate.split(".").every((o) => Number(o) <= 255)
      ? candidate
      : "unknown";
  // IPv6: hex groups and colons only, which is enough to keep anything that is
  // not an address out without reimplementing the grammar.
  if (/^[0-9a-f:]{2,45}$/i.test(candidate) && candidate.includes(":"))
    return candidate;
  return "unknown";
}

/** Headers copied from the browser request to the API request. */
const FORWARDED_REQUEST_HEADERS = [
  "content-type",
  "idempotency-key",
  "x-otp-code",
  "x-language",
  "accept-language",
];
/** Headers copied from the API response back to the browser. */
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "idempotent-replayed",
  "x-payslip-password",
];

export function forwardRequestHeaders(from: Headers, token?: string): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = from.get(name);
    if (value) headers.set(name, value);
  }
  // The API audits the client's IP and device. ONE resolved address, never the
  // browser's header passed through: the API runs behind Render's proxy with
  // Express `trust proxy: 1`, which counts hops from the right of the chain, so
  // a caller who sent extra entries of their own could otherwise shift that
  // count and decide which value was recorded as their IP.
  const ip = clientIp(from);
  if (ip !== "unknown") headers.set("x-forwarded-for", ip);
  const agent = from.get("user-agent");
  if (agent) headers.set("user-agent", agent);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return headers;
}

export function forwardResponseHeaders(from: Headers): Headers {
  const headers = new Headers({ "cache-control": "no-store" });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = from.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

/** The API could not be reached at all. */
export function backendDown(): Response {
  return Response.json(
    {
      code: "BACKEND_UNAVAILABLE",
      message: "The server cannot be reached. Please try again.",
    },
    { status: 503 },
  );
}
