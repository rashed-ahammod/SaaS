/**
 * Pass-through to the ERP API for the signed-in user:
 *
 *   /api/erp/me/leave-balances  ->  {BACKEND_URL}/me/leave-balances   (+ Authorization from the cookie)
 *
 * Only our own pages can call it (they send header x-erp-client: pwa), so
 * another site cannot make a signed-in browser act (CSRF). Status, JSON errors
 * and file downloads (payslip PDF) come back unchanged.
 */
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  backendDown,
  backendUrl,
  CLIENT_HEADER,
  forwardRequestHeaders,
  forwardResponseHeaders,
  SESSION_COOKIE,
} from "@/lib/server/backend";

async function forward(
  request: NextRequest,
  ctx: RouteContext<"/api/erp/[...path]">,
) {
  if (request.headers.get(CLIENT_HEADER) !== "pwa")
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token)
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });

  const { path } = await ctx.params;
  // encodeURIComponent does not touch dots, so "." and ".." survive it and are
  // then resolved away when the URL is parsed: /me/.. becomes /. Nothing is
  // reachable that way today -- BACKEND_URL has no path of its own and the API
  // authorizes every request regardless of how it was addressed -- but give
  // BACKEND_URL a prefix one day and these segments would climb out of it.
  // No real route has such a segment, so refuse them rather than rely on that.
  if (path.some((segment) => segment === "." || segment === ".."))
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  const target = backendUrl(
    `/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
  );
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let res: Response;
  try {
    res = await fetch(target, {
      method: request.method,
      headers: forwardRequestHeaders(request.headers, token),
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    return backendDown();
  }

  const response = new NextResponse(res.body, {
    status: res.status,
    headers: forwardResponseHeaders(res.headers),
  });
  // the session ended on the server (expired): drop the cookie too
  if (res.status === 401) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;

/**
 * The API may be asleep: a free Render web service spins down after 15 minutes
 * without traffic and takes about a minute to answer the first request again.
 * Without this the function would be cut off before the API wakes up, and the
 * user would see a login failure that is really a cold start.
 */
export const maxDuration = 60;
