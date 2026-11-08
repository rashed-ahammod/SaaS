/**
 * The public enquiry form's send (no sign-in): the details go to the ERP as a lead with the
 * form's service key (src/lib/server/enquiry.ts).
 *
 *   POST /api/enquiry/demo   { name, phone?, email?, organisation?, district?, message?, formId, ref?, elapsedMs, website }
 *     200 { sent: true }                              also for a send that looks like a bot, or a known phone / e-mail
 *     400 { code: "INVALID", problems: [...] }        name | contact | phone | email | district
 *     404 FORM_NOT_FOUND, 429 TOO_MANY, 503 FORM_UNAVAILABLE / BACKEND_UNAVAILABLE
 *
 * Only our own page sends it (header x-erp-client: enquiry), so another site cannot post
 * into it from a visitor's browser.
 */
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { backendDown, backendUrl, CLIENT_HEADER } from "@/lib/server/backend";
import {
  capturePayload,
  clientIp,
  enquiryForms,
  enquiryProblems,
  looksLikeSpam,
  RateLimiter,
  type EnquiryInput,
} from "@/lib/server/enquiry";

// 5 sends per address per form in 10 minutes
const limiter = new RateLimiter(5, 10 * 60 * 1000);

const SENT = { sent: true };

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/enquiry/[form]">,
) {
  if (request.headers.get(CLIENT_HEADER) !== "enquiry")
    return NextResponse.json({ code: "FORBIDDEN" }, { status: 403 });
  const { form: slug } = await ctx.params;
  const form = enquiryForms().get(slug);
  if (!form)
    return NextResponse.json({ code: "FORM_NOT_FOUND" }, { status: 404 });

  const input = (await request.json().catch(() => null)) as EnquiryInput | null;
  if (!input || typeof input !== "object")
    return NextResponse.json(
      { code: "INVALID", problems: ["name"] },
      { status: 400 },
    );

  const ip = clientIp(request.headers);
  if (!limiter.allow(`${slug}:${ip}`))
    return NextResponse.json({ code: "TOO_MANY" }, { status: 429 });
  if (looksLikeSpam(input)) return NextResponse.json(SENT);
  const problems = enquiryProblems(input);
  if (problems.length)
    return NextResponse.json({ code: "INVALID", problems }, { status: 400 });

  const payload = capturePayload(input);
  let res: Response;
  try {
    // the API wants an Idempotency-Key on every write: the opened form's id, so a second press is one lead
    const headers = new Headers({
      "content-type": "application/json",
      authorization: form.serviceKey,
      "idempotency-key": payload.externalRef ?? randomUUID(),
      "x-forwarded-for": ip,
    });
    const agent = request.headers.get("user-agent");
    if (agent) headers.set("user-agent", agent);
    res = await fetch(
      backendUrl(`/companies/${form.companyId}/leads/capture`),
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
      },
    );
  } catch {
    return backendDown();
  }

  // a new lead, or a note on the person already known: the visitor sees the same thanks
  if (res.ok) return NextResponse.json(SENT);
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    details?: { problems?: string[] };
  };
  if (res.status === 400 && body.code === "CRM_CONTACT_INVALID") {
    return NextResponse.json(
      {
        code: "INVALID",
        problems: backendProblems(body.details?.problems ?? []),
      },
      { status: 400 },
    );
  }
  // wrong / revoked key, wrong company, a request the API does not accept: the company must fix it, the visitor cannot
  console.error(
    `Enquiry form "${slug}": the ERP refused the lead (${res.status} ${body.code ?? ""}). Check ENQUIRY_FORMS (service key with crm.capture, companyId).`,
  );
  return NextResponse.json({ code: "FORM_UNAVAILABLE" }, { status: 503 });
}

/** The ERP's checks (phone, e-mail, district), as keys the page can translate. */
function backendProblems(problems: string[]): string[] {
  const keys = new Set<string>();
  for (const p of problems) {
    if (/phone/i.test(p)) keys.add("phone");
    else if (/e-?mail/i.test(p)) keys.add("email");
    else if (/district/i.test(p)) keys.add("district");
  }
  return keys.size ? [...keys] : ["contact"];
}
