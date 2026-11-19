/**
 * The one API error the session bootstrap must survive: a privileged user who
 * has not set up two-step verification yet is refused /me/profile, and the
 * only page that can fix that is the one being loaded. Treating it as a
 * failure used to show "The server cannot be reached" with no way forward.
 */
import { describe, expect, it } from "vitest";
import { ApiError, apiState, isMfaSetupRequired } from "./api";

describe("isMfaSetupRequired", () => {
  it("recognises the refusal that only 2FA setup can clear", () => {
    expect(
      isMfaSetupRequired(
        new ApiError(403, "AUTH_MFA_REQUIRED", "Set it up and sign in again."),
      ),
    ).toBe(true);
  });

  it("leaves every other failure to be reported", () => {
    const others = [
      new ApiError(403, "FORBIDDEN", "Not allowed"),
      new ApiError(401, "AUTH_REQUIRED", "Sign in"),
      new ApiError(500, "INTERNAL", "Boom"),
      // a step-up code for one high-risk action is a different thing: the page
      // asks for the code, so it must not be swallowed here
      new ApiError(403, "AUTH_OTP_REQUIRED", "Enter the code"),
      new Error("network down"),
      "AUTH_MFA_REQUIRED",
      null,
      undefined,
    ];
    for (const e of others) expect(isMfaSetupRequired(e)).toBe(false);
  });
});

/**
 * The render between "no path yet" and the request starting. A page that waits
 * for the company asks for null first; the effect that starts the request runs
 * after the render in which the path appears, so for that one render the state
 * still belongs to the old path. It must read as loading — reporting "loaded,
 * no data, no error" is what crashed the Gate 3 and manpower-plan screens on
 * `data!`.
 */
describe("apiState", () => {
  const loaded = (from: string | null) => ({
    data: { id: from },
    loading: false,
    from,
  });

  it("is loading in the render where the path has just appeared", () => {
    const s = apiState("/companies/c1/gate-3", { loading: false, from: null });
    expect(s.loading).toBe(true);
    expect(s.data).toBeUndefined();
    expect(s.error).toBeUndefined();
  });

  it("does not answer one path with another path's data", () => {
    const s = apiState("/companies/c2/gate-3", loaded("/companies/c1/gate-3"));
    expect(s.data).toBeUndefined();
    expect(s.loading).toBe(true);
  });

  it("does not carry one path's error to the next", () => {
    const s = apiState("/companies/c2/gate-3", {
      error: new ApiError(403, "FORBIDDEN", "Not allowed"),
      loading: false,
      from: "/companies/c1/gate-3",
    });
    expect(s.error).toBeUndefined();
    expect(s.loading).toBe(true);
  });

  it("hands over the data loaded for this path", () => {
    const s = apiState("/companies/c1/gate-3", loaded("/companies/c1/gate-3"));
    expect(s.data).toEqual({ id: "/companies/c1/gate-3" });
    expect(s.loading).toBe(false);
  });

  it("reports a refusal of this path, and is no longer loading", () => {
    const error = new ApiError(403, "FORBIDDEN", "Not allowed");
    const s = apiState("/x", { error, loading: false, from: "/x" });
    expect(s.error).toBe(error);
    expect(s.loading).toBe(false);
  });

  it("asks for nothing, and so is not loading, while the path is null", () => {
    const s = apiState(null, { loading: false, from: null });
    expect(s.loading).toBe(false);
    expect(s.data).toBeUndefined();
  });
});
