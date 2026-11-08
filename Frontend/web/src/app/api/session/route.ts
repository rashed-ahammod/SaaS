/**
 * The login session.
 *
 *   GET    /api/session   the signed-in user (ERP API /auth/me), 401 when signed out
 *   POST   /api/session   { workspace, login, password }  -> sets the session cookie
 *                         or { mfaRequired: true, mfaToken } when 2FA is on
 *   DELETE /api/session   sign out (clears the cookie)
 */
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
  return signIn(request, "/auth/login");
}

// DELETE /api/session
export async function DELETE(request: NextRequest) {
  if (request.headers.get(CLIENT_HEADER) !== "pwa")
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  const response = new NextResponse(null, { status: 204 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
