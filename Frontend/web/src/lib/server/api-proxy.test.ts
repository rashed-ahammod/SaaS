/**
 * The pass-through at app/api/erp/[...path]/route.ts, which every signed-in
 * page goes through to reach the ERP API.
 *
 * Kept here rather than beside the route so that nothing inside app/ imports
 * vitest, which is a devDependency and must never be reachable from a build.
 *
 * What these tests guard:
 *   - only our own pages can use it (the CSRF header), because the session is a
 *     cookie and a cross-site form would otherwise act as the signed-in user;
 *   - the token comes from the cookie and only from the cookie;
 *   - a path from the URL cannot reach somewhere else on the API;
 *   - the API's answer, including a payslip download, arrives unchanged.
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

const { GET, POST, DELETE } = await import("@/app/api/erp/[...path]/route");

/**
 * The handlers answer with a NextResponse everywhere except "the API could not
 * be reached", which is a plain Response. Reading cookies off a response goes
 * through this, so the cast is sound and `.cookies` stays reachable.
 */
const withCookies = (r: Response) => r as NextResponse;

type Ctx = Parameters<typeof GET>[1];

/** The context Next hands the handler for /api/erp/<path...>. */
const ctxFor = (...path: string[]) =>
  ({ params: Promise.resolve({ path }) }) as unknown as Ctx;

function pageRequest(
  method: string,
  {
    search = "",
    headers = { "x-erp-client": "pwa" },
    body,
  }: {
    search?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
) {
  return {
    method,
    headers: new Headers(headers),
    nextUrl: { search },
    arrayBuffer: () =>
      Promise.resolve(new TextEncoder().encode(body ?? "").buffer),
  } as unknown as NextRequest;
}

/** What the ERP API answers. */
function apiAnswers(
  status: number,
  body: string,
  headers: Record<string, string> = { "content-type": "application/json" },
) {
  const fetchMock = vi.fn<
    (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >(() =>
    Promise.resolve(new Response(body, { status, headers })),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The URL the API was asked for. */
const calledUrl = (m: ReturnType<typeof apiAnswers>) =>
  String(m.mock.calls[0][0]);

beforeEach(() => {
  jar.clear();
  jar.set("erp_session", "token-abc");
  vi.stubEnv("BACKEND_URL", "http://api.internal:3000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ERP pass-through: who may use it", () => {
  // The session is a cookie, so without this a form on any other site could
  // make a signed-in browser post into the ERP. A cross-site request cannot
  // set a custom header without a CORS preflight, which this app never allows.
  it("refuses a request that does not carry the client header", async () => {
    const fetchMock = apiAnswers(200, "{}");
    const res = await GET(pageRequest("GET", { headers: {} }), ctxFor("me"));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ code: "FORBIDDEN" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a wrong client header, including the enquiry form's", async () => {
    const fetchMock = apiAnswers(200, "{}");
    // "pwa " is not in this list on purpose: a header value's surrounding
    // whitespace is not part of it, so Headers hands back "pwa" and the request
    // is the same one our own pages make.
    for (const value of ["", "enquiry", "PWA", "pwa,pwa", "xpwa"]) {
      const res = await GET(
        pageRequest("GET", { headers: { "x-erp-client": value } }),
        ctxFor("me"),
      );
      expect(res.status).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no session cookie: 401, and the API is never called", async () => {
    jar.clear();
    const fetchMock = apiAnswers(200, "{}");

    const res = await GET(pageRequest("GET"), ctxFor("me"));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ code: "AUTH_REQUIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ERP pass-through: the token", () => {
  it("is taken from the cookie", async () => {
    const fetchMock = apiAnswers(200, "{}");
    await GET(pageRequest("GET"), ctxFor("me", "leave-balances"));

    const headers = new Headers(
      fetchMock.mock.calls[0][1]?.headers,
    );
    expect(headers.get("authorization")).toBe("Bearer token-abc");
  });

  it("and only from the cookie: the page cannot supply its own", async () => {
    const fetchMock = apiAnswers(200, "{}");
    await GET(
      pageRequest("GET", {
        headers: { "x-erp-client": "pwa", authorization: "Bearer forged" },
      }),
      ctxFor("me"),
    );

    const headers = new Headers(
      fetchMock.mock.calls[0][1]?.headers,
    );
    expect(headers.get("authorization")).toBe("Bearer token-abc");
  });

  it("the cookie is dropped when the API says the session has ended", async () => {
    apiAnswers(401, JSON.stringify({ code: "AUTH_REQUIRED" }));
    const res = await GET(pageRequest("GET"), ctxFor("me"));

    expect(res.status).toBe(401);
    // Next records a deletion as an empty value with maxAge 0
    expect(withCookies(res).cookies.get("erp_session")?.value).toBe("");
  });

  it("a 403 is not a dead session, so the cookie stays", async () => {
    apiAnswers(403, JSON.stringify({ code: "FORBIDDEN" }));
    const res = await GET(pageRequest("GET"), ctxFor("payroll-runs"));

    expect(res.status).toBe(403);
    expect(withCookies(res).cookies.get("erp_session")).toBeUndefined();
  });
});

describe("ERP pass-through: the path", () => {
  it("joins the segments and keeps the query string", async () => {
    const fetchMock = apiAnswers(200, "{}");
    await GET(
      pageRequest("GET", { search: "?from=2026-10-01&to=2026-10-31" }),
      ctxFor("companies", "abc", "attendance"),
    );

    expect(calledUrl(fetchMock)).toBe(
      "http://api.internal:3000/companies/abc/attendance?from=2026-10-01&to=2026-10-31",
    );
  });

  // Every segment is encoded, so one can never introduce a path separator, a
  // query or a fragment and address something other than what it looks like.
  it("a segment cannot escape the path it was given", async () => {
    for (const segment of ["a/../../admin", "a?x=1", "a#f", "a b", "../x"]) {
      const fetchMock = apiAnswers(200, "{}");
      await GET(pageRequest("GET"), ctxFor("me", segment));

      const url = new URL(calledUrl(fetchMock));
      expect(url.origin).toBe("http://api.internal:3000");
      expect(url.pathname.startsWith("/me/")).toBe(true);
      // exactly "", "me" and the one encoded segment: nothing smuggled in
      expect(url.pathname.split("/")).toHaveLength(3);
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      vi.unstubAllGlobals();
    }
  });

  // encodeURIComponent leaves dots alone, so these two would survive it and
  // then be resolved away by the URL parser: /me/.. is /.
  it("a dot segment is refused outright, not encoded and sent", async () => {
    for (const segment of [".", ".."]) {
      const fetchMock = apiAnswers(200, "{}");

      const res = await GET(pageRequest("GET"), ctxFor("me", segment));

      expect(res.status).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    }
  });
});

describe("ERP pass-through: the answer", () => {
  it("status and body arrive unchanged", async () => {
    apiAnswers(422, JSON.stringify({ code: "VALIDATION_FAILED", details: [1] }));
    const res = await POST(pageRequest("POST", { body: "{}" }), ctxFor("leads"));

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({
      code: "VALIDATION_FAILED",
      details: [1],
    });
  });

  it("a payslip download keeps its type and filename, and is never cached", async () => {
    apiAnswers(200, "%PDF-1.7", {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="payslip.pdf"',
      "x-payslip-password": "employee code",
      "set-cookie": "injected=1",
    });

    const res = await GET(pageRequest("GET"), ctxFor("me", "payslip"));

    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain("payslip.pdf");
    expect(res.headers.get("x-payslip-password")).toBe("employee code");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // the API must not be able to set cookies in this browser through us
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("a write sends its body; a read sends none", async () => {
    const post = apiAnswers(200, "{}");
    await POST(pageRequest("POST", { body: '{"name":"x"}' }), ctxFor("leads"));
    expect(post.mock.calls[0][1]?.body).toBeDefined();
    vi.unstubAllGlobals();

    const get = apiAnswers(200, "{}");
    await GET(pageRequest("GET"), ctxFor("leads"));
    expect(get.mock.calls[0][1]?.body).toBeUndefined();
  });

  it("a redirect from the API is not followed", async () => {
    const fetchMock = apiAnswers(200, "{}");
    await DELETE(pageRequest("DELETE"), ctxFor("devices"));

    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("the API cannot be reached: 503, not a crash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );

    const res = await GET(pageRequest("GET"), ctxFor("me"));

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
    });
  });
});
