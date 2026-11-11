/**
 * The one API error the session bootstrap must survive: a privileged user who
 * has not set up two-step verification yet is refused /me/profile, and the
 * only page that can fix that is the one being loaded. Treating it as a
 * failure used to show "The server cannot be reached" with no way forward.
 */
import { describe, expect, it } from "vitest";
import { ApiError, isMfaSetupRequired } from "./api";

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
