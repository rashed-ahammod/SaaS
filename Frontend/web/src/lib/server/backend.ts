/**
 * Server-side only: talking to the ERP API (backend) and the session cookie.
 *
 * The browser never sees the access token. After login it lives in an httpOnly,
 * SameSite=Strict cookie; the route handlers in src/app/api read it and add
 * "Authorization: Bearer <token>" when they forward a request to the API.
 */
export const SESSION_COOKIE = "erp_session";

/** Requests from our own pages carry this header; a cross-site form cannot set it (CSRF guard). */
export const CLIENT_HEADER = "x-erp-client";

export function backendUrl(path: string): string {
  const base = (process.env.BACKEND_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
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
  // the API audits the client's IP and device
  const ip = from.get("x-forwarded-for");
  if (ip) headers.set("x-forwarded-for", ip);
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
