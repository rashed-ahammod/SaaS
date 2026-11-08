/**
 * The public enquiry form (/enquiry/<form>): a customer who is not signed in leaves their
 * details, and the server sends them to the ERP as a lead (POST /companies/:id/leads/capture).
 *
 * Server-side only. The service key (permission crm.capture) never reaches the browser:
 *
 *   ENQUIRY_FORMS={"demo": {"companyId": "<uuid>", "serviceKey": "ServiceKey <id>.<secret>",
 *                           "nameEn": "Meghna Edible Oils Ltd", "nameBn": "মেঘনা এডিবল অয়েলস লিমিটেড"}}
 *
 * Spam: a hidden field people never fill, a minimum time on the page, and a limit per IP
 * address. All three answer "sent" so a bot learns nothing; nothing reaches the ERP.
 * A public site also needs a captcha before a pilot (see README).
 */

export interface EnquiryForm {
  slug: string;
  companyId: string;
  serviceKey: string;
  nameEn: string;
  nameBn: string;
}

/** What the page may show: the company's name, never the key. */
export type PublicEnquiryForm = Pick<EnquiryForm, "slug" | "nameEn" | "nameBn">;

const SLUG = /^[a-z0-9-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The configured forms; a broken entry is left out (and logged) instead of failing every form. */
export function enquiryForms(
  raw = process.env.ENQUIRY_FORMS,
): Map<string, EnquiryForm> {
  const forms = new Map<string, EnquiryForm>();
  if (!raw) return forms;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("ENQUIRY_FORMS is not valid JSON: no enquiry form is open");
    return forms;
  }
  if (!parsed || typeof parsed !== "object") return forms;
  for (const [slug, value] of Object.entries(
    parsed as Record<string, Record<string, unknown>>,
  )) {
    const v = value ?? {};
    const ok =
      SLUG.test(slug) &&
      typeof v.companyId === "string" &&
      UUID.test(v.companyId) &&
      typeof v.serviceKey === "string" &&
      v.serviceKey.startsWith("ServiceKey ");
    if (!ok) {
      console.error(
        `ENQUIRY_FORMS: form "${slug}" needs a lower-case slug, companyId (uuid) and serviceKey ("ServiceKey <id>.<secret>")`,
      );
      continue;
    }
    const nameEn =
      typeof v.nameEn === "string" && v.nameEn.trim() ? v.nameEn.trim() : slug;
    const nameBn =
      typeof v.nameBn === "string" && v.nameBn.trim()
        ? v.nameBn.trim()
        : nameEn;
    forms.set(slug, {
      slug,
      companyId: v.companyId as string,
      serviceKey: v.serviceKey as string,
      nameEn,
      nameBn,
    });
  }
  return forms;
}

export function publicForm(form: EnquiryForm): PublicEnquiryForm {
  return { slug: form.slug, nameEn: form.nameEn, nameBn: form.nameBn };
}

/** What the page sends. */
export interface EnquiryInput {
  name?: unknown;
  organisation?: unknown;
  phone?: unknown;
  email?: unknown;
  district?: unknown;
  message?: unknown;
  /** one id per opened form, so pressing Send twice makes one lead */
  formId?: unknown;
  /** where the link was shared, from ?ref= (e.g. "facebook-page") */
  ref?: unknown;
  /** milliseconds between opening the form and sending it */
  elapsedMs?: unknown;
  /** the hidden field; a person leaves it empty */
  website?: unknown;
}

/** Below this, nobody typed the form by hand. */
export const MIN_FILL_MS = 3000;

const text = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** True when the request looks like a bot: answer "sent" and drop it. */
export function looksLikeSpam(input: EnquiryInput): boolean {
  if (text(input.website, 200)) return true;
  const elapsed = typeof input.elapsedMs === "number" ? input.elapsedMs : 0;
  return elapsed < MIN_FILL_MS;
}

/** Problems the person can fix (the ERP checks the phone, e-mail and district again). */
export function enquiryProblems(
  input: EnquiryInput,
): Array<"name" | "contact"> {
  const problems: Array<"name" | "contact"> = [];
  if (!text(input.name, 200)) problems.push("name");
  if (!text(input.phone, 40) && !text(input.email, 200))
    problems.push("contact");
  return problems;
}

/** The body of POST /companies/:companyId/leads/capture. */
export function capturePayload(input: EnquiryInput) {
  const formId = text(input.formId, 80).replace(/[^A-Za-z0-9-]/g, "");
  const ref = text(input.ref, 60).replace(/[^\p{L}\p{N} _.-]/gu, "");
  const optional = (v: string) => v || undefined;
  return {
    source: "web_form" as const,
    externalRef: formId ? `enquiry:${formId}` : undefined,
    name: text(input.name, 200),
    organisation: optional(text(input.organisation, 200)),
    phone: optional(text(input.phone, 40)),
    email: optional(text(input.email, 200)),
    district: optional(text(input.district, 60)),
    sourceDetail: ref ? `Enquiry form (ref: ${ref})` : "Enquiry form",
    message: optional(text(input.message, 4000)),
  };
}

/**
 * Sends per IP address in a sliding window, kept in this server's memory (enough for one
 * Next.js server; several servers behind a balancer need a shared store).
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a send and says whether it is allowed. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter(
      (t) => now - t < this.windowMs,
    );
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // keep the map small: forget addresses with nothing recent
    if (this.hits.size > 10_000)
      for (const [k, times] of this.hits)
        if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
    return true;
  }
}

/** The caller's address, as the reverse proxy reports it (first hop). */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
