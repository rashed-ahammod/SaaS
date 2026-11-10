/**
 *   POST /api/session/mfa   { mfaToken, code }  second login step when 2FA is on
 */
import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_HEADER } from "@/lib/server/backend";
import { signIn } from "@/lib/server/sign-in";

// POST /api/session/mfa
export async function POST(request: NextRequest) {
  if (request.headers.get(CLIENT_HEADER) !== "pwa")
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  return signIn(request, "/auth/mfa/verify");
}

/**
 * The API may be asleep: a free Render web service spins down after 15 minutes
 * without traffic and takes about a minute to answer the first request again.
 * Without this the function would be cut off before the API wakes up, and the
 * user would see a login failure that is really a cold start.
 */
export const maxDuration = 60;
