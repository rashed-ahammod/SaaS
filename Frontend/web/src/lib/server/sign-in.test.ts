/**
 * The sign-in step, which is the only place the access token is ever handled.
 *
 * What these tests are really guarding: the token must reach the httpOnly
 * cookie and NOTHING else. If it ever appears in the JSON body, every script on
 * the page can read it, and the whole reason the employee app talks to the API
 * through its own server disappears.
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

const { signIn } = await import("./sign-in");

/**
 * signIn answers with a NextResponse on every path except "the API could not be
 * reached", which is a plain Response. Only the cookie-carrying paths are read
 * through this, so the cast is sound and keeps `.cookies` reachable.
 */
const signInAs = async (...args: Parameters<typeof signIn>) =>
  (await signIn(...args)) as NextResponse;

/** A POST the login page would make. */
function loginRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    headers: new Headers({ "content-type": "application/json", ...headers }),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as NextRequest;
}

/** What the ERP API answers. The parameters are declared so that the recorded
 *  call can be read back as (url, init) rather than as an empty tuple. */
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

/** The JSON body the API was sent. */
const sentBody = (m: ReturnType<typeof apiAnswers>) =>
  JSON.parse(String(m.mock.calls[0][1]?.body)) as Record<string, unknown>;

/** The headers the API was sent. */
const sentHeaders = (m: ReturnType<typeof apiAnswers>) =>
  new Headers(m.mock.calls[0][1]?.headers);

const credentials = { workspace: "meghna", login: "admin@x.test", password: "s" };

beforeEach(() => {
  jar.clear();
  vi.stubEnv("BACKEND_URL", "http://api.internal:3000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sign-in", () => {
  it("puts the token in the cookie and never in the body", async () => {
    apiAnswers(200, { accessToken: "token-abc", expiresIn: 1800 });

    const res = await signInAs(loginRequest(credentials), "/auth/login");

    expect(res.status).toBe(200);
    // read once: a Response body cannot be consumed twice
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({
      signedIn: true,
      mfaSetupRequired: false,
      deviceRemembered: false,
    });
    // the one place it belongs
    expect(res.cookies.get("erp_session")?.value).toBe("token-abc");
    // and nowhere else
    expect(body).not.toContain("token-abc");
  });

  it("the session cookie is httpOnly and same-site strict", async () => {
    apiAnswers(200, { accessToken: "t", expiresIn: 900 });
    const res = await signInAs(loginRequest(credentials), "/auth/login");
    expect(res.cookies.get("erp_session")).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      maxAge: 900,
      path: "/",
    });
  });

  it("2FA still owed: the API's answer passes through and no cookie is set", async () => {
    apiAnswers(200, { mfaRequired: true, mfaToken: "mfa-1" });

    const res = await signInAs(loginRequest(credentials), "/auth/login");

    await expect(res.json()).resolves.toEqual({
      mfaRequired: true,
      mfaToken: "mfa-1",
    });
    expect(res.cookies.get("erp_session")).toBeUndefined();
  });

  it("wrong password: the API's status and code reach the page, no cookie", async () => {
    apiAnswers(401, {
      code: "AUTH_INVALID_CREDENTIALS",
      message: "Wrong login or password.",
    });

    const res = await signInAs(loginRequest(credentials), "/auth/login");

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });
    expect(res.cookies.get("erp_session")).toBeUndefined();
  });

  it("a remembered device: the token is stored, and only the fact is told", async () => {
    apiAnswers(200, {
      accessToken: "t",
      deviceToken: "device-xyz",
      deviceTokenExpiresIn: 60,
    });

    const res = await signInAs(loginRequest(credentials), "/auth/mfa/verify");

    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ deviceRemembered: true });
    expect(res.cookies.get("erp_device")).toMatchObject({
      value: "device-xyz",
      httpOnly: true,
      maxAge: 60,
    });
    expect(body).not.toContain("device-xyz");
  });

  it("sends the remembered-device token with the password step, when asked", async () => {
    jar.set("erp_device", "device-xyz");
    const fetchMock = apiAnswers(200, { accessToken: "t" });

    await signIn(loginRequest(credentials), "/auth/login", {
      sendDeviceToken: true,
    });

    expect(sentBody(fetchMock)).toMatchObject({
      ...credentials,
      deviceToken: "device-xyz",
    });
  });

  it("never sends it to the 2FA step, which refuses unknown fields", async () => {
    jar.set("erp_device", "device-xyz");
    const fetchMock = apiAnswers(200, { accessToken: "t" });

    await signIn(loginRequest({ mfaToken: "m", code: "123456" }), "/auth/mfa/verify");

    expect(sentBody(fetchMock)).toEqual({ mfaToken: "m", code: "123456" });
  });

  it("the browser cannot choose the token it is signed in with", async () => {
    const fetchMock = apiAnswers(200, { accessToken: "t" });

    await signIn(
      loginRequest(credentials, { authorization: "Bearer forged" }),
      "/auth/login",
    );

    expect(sentHeaders(fetchMock).get("authorization")).toBeNull();
  });

  it("the API cannot be reached: 503, not a login failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );

    const res = await signInAs(loginRequest(credentials), "/auth/login");

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
    });
  });
});
