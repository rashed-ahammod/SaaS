import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backendUrl,
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
});
