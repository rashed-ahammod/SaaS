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
