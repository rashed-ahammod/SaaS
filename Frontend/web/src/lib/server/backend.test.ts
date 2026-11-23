import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backendDown,
  backendUrl,
  deviceCookieOptions,
  forwardRequestHeaders,
  forwardResponseHeaders,
  sessionCookieOptions,
} from "./backend";

describe("API pass-through", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("forwards only the allowed request headers, and the token as Authorization", () => {
    const incoming = new Headers({
      "content-type": "application/json",
      "idempotency-key": "k1",
      "x-language": "bn",
      cookie: "erp_session=secret; other=1", // never sent on
      authorization: "Bearer forged", // a page cannot choose the token
      "x-forwarded-for": "103.12.4.5",
    });
    const out = forwardRequestHeaders(incoming, "real-token");
    expect(out.get("authorization")).toBe("Bearer real-token");
    expect(out.get("cookie")).toBeNull();
    expect(out.get("x-language")).toBe("bn");
    expect(out.get("idempotency-key")).toBe("k1");
    expect(out.get("x-forwarded-for")).toBe("103.12.4.5");
  });

  it("responses: files and the payslip password hint pass, nothing is cached", () => {
    const out = forwardResponseHeaders(
      new Headers({
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="p.pdf"',
        "x-payslip-password": "employee code",
        "set-cookie": "x=1",
      }),
    );
    expect(out.get("content-type")).toBe("application/pdf");
    expect(out.get("x-payslip-password")).toBe("employee code");
    expect(out.get("set-cookie")).toBeNull();
    expect(out.get("cache-control")).toBe("no-store");
  });

  it("session cookie: httpOnly, same-site strict, HTTPS-only in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions(1800)).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      maxAge: 1800,
    });
    vi.stubEnv("SESSION_COOKIE_SECURE", "false");
    expect(sessionCookieOptions(1800).secure).toBe(false);
  });

  it("backend URL from BACKEND_URL", () => {
    vi.stubEnv("BACKEND_URL", "http://api.internal:3000/");
    expect(backendUrl("/me/profile")).toBe(
      "http://api.internal:3000/me/profile",
    );
  });

  it("outside production the cookie may travel over plain http", () => {
    // SESSION_COOKIE_SECURE=false exists for a pilot on the office LAN; it must
    // never be what happens by accident in production
    vi.stubEnv("NODE_ENV", "development");
    expect(sessionCookieOptions(1800).secure).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(sessionCookieOptions(1800).secure).toBe(true);
  });

  it("the remembered-device cookie is as locked down as the session one", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(deviceCookieOptions(2_592_000)).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      maxAge: 2_592_000,
    });
  });

  it("a path without a leading slash still lands on the API", () => {
    vi.stubEnv("BACKEND_URL", "http://api.internal:3000");
    expect(backendUrl("auth/me")).toBe("http://api.internal:3000/auth/me");
  });

  it("the API being unreachable is 503, and says so in a way a person can read", async () => {
    const res = backendDown();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
    });
  });

  it("no token: no Authorization header invented", () => {
    const out = forwardRequestHeaders(new Headers({ "x-language": "en" }));
    expect(out.get("authorization")).toBeNull();
  });
});

/**
 * The address the API audits and counts rate limits against. It must be one
 * value we resolved, not the chain the browser sent: the API sits behind a
 * proxy and counts hops from the right, so extra entries would let a caller
 * choose which one was recorded as theirs.
 */
describe("the client address we forward", () => {
  it("is a single value, even when the header holds a chain", () => {
    const out = forwardRequestHeaders(
      new Headers({ "x-forwarded-for": "103.12.4.5, 10.0.0.1, 10.0.0.2" }),
    );
    expect(out.get("x-forwarded-for")).toBe("103.12.4.5");
  });

  it("falls back to x-real-ip", () => {
    const out = forwardRequestHeaders(new Headers({ "x-real-ip": "103.12.4.5" }));
    expect(out.get("x-forwarded-for")).toBe("103.12.4.5");
  });

  it("is left off entirely rather than forwarding something that is not an address", () => {
    for (const forged of ["not-an-ip", "999.1.1.1", "' OR 1=1", "localhost"]) {
      const out = forwardRequestHeaders(
        new Headers({ "x-forwarded-for": forged }),
      );
      expect(out.get("x-forwarded-for")).toBeNull();
    }
  });
});
