/**
 *   POST /api/session/mfa   { mfaToken, code }  second login step when 2FA is on
 */
import { NextResponse, type NextRequest } from 'next/server';
import { CLIENT_HEADER } from '@/lib/server/backend';
import { signIn } from '@/lib/server/sign-in';

// POST /api/session/mfa
export async function POST(request: NextRequest) {
  if (request.headers.get(CLIENT_HEADER) !== 'pwa') return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 });
  return signIn(request, '/auth/mfa/verify');
}
