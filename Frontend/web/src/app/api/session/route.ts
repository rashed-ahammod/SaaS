/**
 * The login session.
 *
 *   GET    /api/session   the signed-in user (ERP API /auth/me), 401 when signed out
 *   POST   /api/session   { workspace, login, password }  -> sets the session cookie
 *                         or { mfaRequired: true, mfaToken } when 2FA is on
 *                         (a remembered device skips that second step)
 *   DELETE /api/session   sign out: clears the cookie AND ends the session in
 *                         the ERP API, so the token cannot be used again
 */
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  backendDown,
  backendUrl,
  CLIENT_HEADER,
  forwardRequestHeaders,
  SESSION_COOKIE,
} from "@/lib/server/backend";
import { signIn } from "@/lib/server/sign-in";

// GET /api/session
export async function GET(request: NextRequest) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token)
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });

  let res: Response;
  try {
    res = await fetch(backendUrl("/auth/me"), {
      headers: forwardRequestHeaders(request.headers, token),
      cache: "no-store",
    });
  } catch {
    return backendDown();
  }
  const body = await res.json().catch(() => ({}));
  const response = NextResponse.json(body, { status: res.status });
  if (res.status === 401) response.cookies.delete(SESSION_COOKIE);
  return response;
}

// POST /api/session
export async function POST(request: NextRequest) {
  if (request.headers.get(CLIENT_HEADER) !== "pwa")
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  // sendDeviceToken: a device the user asked us to remember skips the 2FA step
  return signIn(request, "/auth/login", { sendDeviceToken: true });
}

// DELETE /api/session
export async function DELETE(request: NextRequest) {
  if (request.headers.get(CLIENT_HEADER) !== "pwa")
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });

  // Tell the API to end the session, not just drop the cookie: the token is a
  // signed JWT good for half an hour, so a copy of it taken from a shared
  // machine or a proxy log would otherwise keep working after the person
  // believed they had signed out (backend migration 0049).
  //
  // Best effort, and deliberately so. The cookie is cleared whatever happens
  // here, because signing out of this browser must never fail just because the
  // API is asleep on a free instance or briefly down.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    const headers = forwardRequestHeaders(request.headers, token);
    // every authenticated write to the API carries one
    headers.set("idempotency-key", randomUUID());
    try {
      await fetch(backendUrl("/auth/sign-out"), {
        method: "POST",
        headers,
        cache: "no-store",
      });
    } catch {
      // unreachable: the cookie still goes, and the token expires on its own
    }
  }

  const response = new NextResponse(null, { status: 204 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

/**
 * The API may be asleep: a free Render web service spins down after 15 minutes
 * without traffic and takes about a minute to answer the first request again.
 * Without this the function would be cut off before the API wakes up, and the
 * user would see a login failure that is really a cold start.
 */
export const maxDuration = 60;
