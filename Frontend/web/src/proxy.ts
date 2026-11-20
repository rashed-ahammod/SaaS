/**
 * Before any app page renders: without a session cookie, go to the login page
 * (and come back afterwards). Expired sessions are caught by the API (401).
 */
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "erp_session";

export function proxy(request: NextRequest) {
  if (request.cookies.get(SESSION_COOKIE)) return NextResponse.next();
  const login = new URL("/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export const config = {
  // every page except the landing, login, offline and public enquiry pages, the API, Next.js files and public assets
  matcher: [
    "/((?!landing|login|offline|enquiry|api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons|fonts).*)",
  ],
};
