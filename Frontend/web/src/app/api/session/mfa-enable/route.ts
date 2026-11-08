/**
 *   POST /api/session/mfa-enable   { code }
 *
 * Last step of turning on 2FA (privileged roles must have it). The API answers
 * with a new token that counts as 2FA-verified; it replaces the session cookie.
 * (Step 1, POST /api/erp/auth/mfa/setup, returns the secret to type into the app.)
 */
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  backendDown,
  backendUrl,
  CLIENT_HEADER,
  forwardRequestHeaders,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/server/backend";

// POST /api/session/mfa-enable
export async function POST(request: NextRequest) {
  if (request.headers.get(CLIENT_HEADER) !== "pwa")
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token)
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });

  let res: Response;
  try {
    res = await fetch(backendUrl("/auth/mfa/enable"), {
      method: "POST",
      headers: forwardRequestHeaders(request.headers, token),
      body: await request.text(),
      cache: "no-store",
    });
  } catch {
    return backendDown();
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.accessToken)
    return NextResponse.json(body, { status: res.status });

  const response = NextResponse.json({ mfaEnabled: true });
  response.cookies.set(
    SESSION_COOKIE,
    body.accessToken,
    sessionCookieOptions(body.expiresIn ?? 1800),
  );
  return response;
}
