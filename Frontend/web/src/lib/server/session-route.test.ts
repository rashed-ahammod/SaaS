/**
 * The login session at app/api/session/route.ts.
 *
 * Kept out of app/ so nothing there imports vitest. POST is the sign-in step
 * and is covered by sign-in.test.ts; this covers reading the session and,
 * above all, ending it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest, NextResponse } from "next/server";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        jar.has(name) ? { name, value: jar.get(name) } : undefined,
    }),
}));

const { GET, DELETE } = await import("@/app/api/session/route");

/**
 * The handlers answer with a NextResponse everywhere except "the API could not
 * be reached", which is a plain Response. Reading cookies off a response goes
 * through this, so the cast is sound and `.cookies` stays reachable.
 */
const withCookies = (r: Response) => r as NextResponse;

function pageRequest(headers: Record<string, string> = { "x-erp-client": "pwa" }) {
  return { headers: new Headers(headers) } as unknown as NextRequest;
}

function apiAnswers(status: number, body: unknown) {
  const fetchMock = vi.fn<
    (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  jar.clear();
  jar.set("erp_session", "token-abc");
  vi.stubEnv("BACKEND_URL", "http://api.internal:3000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("reading the session", () => {
  it("signed out: 401 without asking the API", async () => {
    jar.clear();
    const fetchMock = apiAnswers(200, {});

    const res = await GET(pageRequest());

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signed in: the user comes back from /auth/me", async () => {
    const fetchMock = apiAnswers(200, { email: "admin@x.test", roles: [] });

    const res = await GET(pageRequest());

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://api.internal:3000/auth/me",
    );
    await expect(res.json()).resolves.toMatchObject({ email: "admin@x.test" });
  });

  it("a session the API no longer accepts takes the cookie with it", async () => {
    apiAnswers(401, { code: "AUTH_REQUIRED" });

    const res = await GET(pageRequest());

    expect(res.status).toBe(401);
    expect(withCookies(res).cookies.get("erp_session")?.value).toBe("");
  });
});

describe("signing out", () => {
  it("tells the API to end the session, then clears the cookie", async () => {
    const fetchMock = apiAnswers(200, { signedOut: true });

    const res = await DELETE(pageRequest());

    expect(res.status).toBe(204);
    expect(res.cookies.get("erp_session")?.value).toBe("");

    // the API call that makes a copied token useless (backend 0050)
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://api.internal:3000/auth/sign-out");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer token-abc");
    // every authenticated write to the API carries one
    expect(headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
  });

  // This is the point of doing it best effort. A free Render instance sleeps
  // after 15 minutes, and someone signing out on a borrowed phone must not be
  // left signed in because the API happened to be waking up.
  it("the API being unreachable still signs this browser out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );

    const res = await DELETE(pageRequest());

    expect(res.status).toBe(204);
    expect(res.cookies.get("erp_session")?.value).toBe("");
  });

  it("an error from the API still signs this browser out", async () => {
    apiAnswers(500, { code: "INTERNAL_ERROR" });

    const res = await DELETE(pageRequest());

    expect(res.status).toBe(204);
    expect(res.cookies.get("erp_session")?.value).toBe("");
  });

  it("no session to end: nothing is asked of the API", async () => {
    jar.clear();
    const fetchMock = apiAnswers(200, {});

    const res = await DELETE(pageRequest());

    expect(res.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Without this, a form on another site could sign a reader out of the ERP.
  it("only our own pages may sign out", async () => {
    const fetchMock = apiAnswers(200, {});

    const res = await DELETE(pageRequest({}));

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The remembered device outlives sign-out on purpose: that is what makes it
  // remembered, and it only ever skips the 2FA step, never the password.
  it("leaves the remembered-device cookie alone", async () => {
    jar.set("erp_device", "device-xyz");
    apiAnswers(200, { signedOut: true });

    const res = await DELETE(pageRequest());

    expect(res.cookies.get("erp_device")).toBeUndefined();
  });
});
