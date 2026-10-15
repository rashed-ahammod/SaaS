/**
 * Forward a sign-in step (login, or the 2FA code) to the ERP API. On success the
 * token goes into the httpOnly session cookie; the page only learns "signed in".
 */
import { NextResponse, type NextRequest } from 'next/server';
import { backendDown, backendUrl, forwardRequestHeaders, SESSION_COOKIE, sessionCookieOptions } from './backend';

export async function signIn(request: NextRequest, apiPath: string) {
  let res: Response;
  try {
    res = await fetch(backendUrl(apiPath), {
      method: 'POST',
      headers: forwardRequestHeaders(request.headers),
      body: await request.text(),
      cache: 'no-store',
    });
  } catch {
    return backendDown();
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.accessToken) return NextResponse.json(body, { status: res.status });

  const response = NextResponse.json({ signedIn: true, mfaSetupRequired: body.mfaSetupRequired ?? false });
  response.cookies.set(SESSION_COOKIE, body.accessToken, sessionCookieOptions(body.expiresIn ?? 1800));
  return response;
}
