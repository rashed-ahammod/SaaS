/**
 * Forward a sign-in step (login, or the 2FA code) to the ERP API. On success the
 * token goes into the httpOnly session cookie; the page only learns "signed in".
 *
 * Two cookies are involved:
 *   erp_session  the access token, for this session only
 *   erp_device   "remember this device": set when the API answers the 2FA step
 *                with a device token, and sent back on the next sign-in so the
 *                code step can be skipped. Neither is readable by the page.
 */
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  backendDown,
  backendUrl,
  DEVICE_COOKIE,
  deviceCookieOptions,
  forwardRequestHeaders,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "./backend";

interface Options {
  /**
   * Send the remembered-device token with this request. Only the password step
   * accepts it; the API rejects unknown fields, so it must not be added to the
   * 2FA step.
   */
  sendDeviceToken?: boolean;
}

export async function signIn(
  request: NextRequest,
  apiPath: string,
  options: Options = {},
) {
  const jar = await cookies();
  const deviceToken = jar.get(DEVICE_COOKIE)?.value;

  let payload = await request.text();
  if (options.sendDeviceToken && deviceToken) {
    try {
      payload = JSON.stringify({
        ...(JSON.parse(payload) as Record<string, unknown>),
        deviceToken,
      });
    } catch {
      // not JSON: let the API reject it as it would have anyway
    }
  }

  let res: Response;
  try {
    res = await fetch(backendUrl(apiPath), {
      method: "POST",
      headers: forwardRequestHeaders(request.headers),
      body: payload,
      cache: "no-store",
    });
  } catch {
    return backendDown();
  }
  const body = (await res.json().catch(() => ({}))) as {
    accessToken?: string;
    expiresIn?: number;
    mfaSetupRequired?: boolean;
    deviceToken?: string;
    deviceTokenExpiresIn?: number;
  };
  if (!res.ok || !body.accessToken)
    return NextResponse.json(body, { status: res.status });

  const response = NextResponse.json({
    signedIn: true,
    mfaSetupRequired: body.mfaSetupRequired ?? false,
    // so the page can say "this device is remembered", never the token itself
    deviceRemembered: Boolean(body.deviceToken),
  });
  response.cookies.set(
    SESSION_COOKIE,
    body.accessToken,
    sessionCookieOptions(body.expiresIn ?? 1800),
  );
  if (body.deviceToken)
    response.cookies.set(
      DEVICE_COOKIE,
      body.deviceToken,
      deviceCookieOptions(body.deviceTokenExpiresIn ?? 30 * 24 * 60 * 60),
    );
  return response;
}
