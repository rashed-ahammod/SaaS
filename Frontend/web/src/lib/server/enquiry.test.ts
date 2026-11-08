import { describe, expect, it, vi } from "vitest";
import {
  capturePayload,
  clientIp,
  enquiryForms,
  enquiryProblems,
  looksLikeSpam,
  MIN_FILL_MS,
  publicForm,
  RateLimiter,
} from "./enquiry";

const COMPANY = "0b8f3c2e-5d1a-4c7e-9f00-1a2b3c4d5e6f";

describe("enquiry forms", () => {
  it("reads ENQUIRY_FORMS and leaves out broken entries", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const forms = enquiryForms(
      JSON.stringify({
        demo: {
          companyId: COMPANY,
          serviceKey: "ServiceKey abc.secret",
          nameEn: "Meghna Edible Oils Ltd",
          nameBn: "মেঘনা এডিবল অয়েলস লিমিটেড",
        },
        "Bad Slug": { companyId: COMPANY, serviceKey: "ServiceKey abc.secret" },
        nokey: { companyId: COMPANY, serviceKey: "Bearer x" },
      }),
    );
    expect([...forms.keys()]).toEqual(["demo"]);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("no setting or broken JSON: no form is open", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(enquiryForms(undefined).size).toBe(0);
    expect(enquiryForms("{not json").size).toBe(0);
    error.mockRestore();
  });

  it("the page gets the names, never the key or the company id", () => {
    const form = enquiryForms(
      JSON.stringify({
        demo: {
          companyId: COMPANY,
          serviceKey: "ServiceKey abc.secret",
          nameEn: "Meghna",
        },
      }),
    ).get("demo")!;
    expect(publicForm(form)).toEqual({
      slug: "demo",
      nameEn: "Meghna",
      nameBn: "Meghna",
    });
  });
});

describe("enquiry checks", () => {
  const person = {
    name: "Abdul Karim",
    phone: "01711-223344",
    elapsedMs: 20_000,
    website: "",
  };

  it("a person: no spam, no problems", () => {
    expect(looksLikeSpam(person)).toBe(false);
    expect(enquiryProblems(person)).toEqual([]);
  });

  it("the hidden field filled, or sent too fast: spam", () => {
    expect(looksLikeSpam({ ...person, website: "http://spam.example" })).toBe(
      true,
    );
    expect(looksLikeSpam({ ...person, elapsedMs: MIN_FILL_MS - 1 })).toBe(true);
    expect(looksLikeSpam({ ...person, elapsedMs: undefined })).toBe(true);
  });

  it("a name and a phone or e-mail are needed", () => {
    expect(enquiryProblems({ name: "  ", email: "karim@example.com" })).toEqual(
      ["name"],
    );
    expect(enquiryProblems({ name: "Karim" })).toEqual(["contact"]);
    expect(
      enquiryProblems({ name: "Karim", email: "karim.stores@gmail.com" }),
    ).toEqual([]);
  });

  it("payload: trimmed, one lead per opened form, the shared link as campaign", () => {
    const body = capturePayload({
      name: " Abdul Karim ",
      organisation: "",
      phone: "01711-223344",
      district: "Dhaka",
      message: "200 cans a month",
      formId: "f1a2-b3c4<script>",
      ref: "facebook-page",
    });
    expect(body).toEqual({
      source: "web_form",
      externalRef: "enquiry:f1a2-b3c4script",
      name: "Abdul Karim",
      organisation: undefined,
      phone: "01711-223344",
      email: undefined,
      district: "Dhaka",
      sourceDetail: "Enquiry form (ref: facebook-page)",
      message: "200 cans a month",
    });
    expect(capturePayload({ name: "Karim" }).sourceDetail).toBe("Enquiry form");
    expect(capturePayload({ name: "Karim" }).externalRef).toBeUndefined();
  });
});

describe("rate limit", () => {
  it("allows the limit in the window, then again after it", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.allow("ip", 0)).toBe(true);
    expect(limiter.allow("ip", 10)).toBe(true);
    expect(limiter.allow("ip", 20)).toBe(false);
    expect(limiter.allow("other", 20)).toBe(true);
    expect(limiter.allow("ip", 1001)).toBe(true);
  });

  it("client address: first hop of x-forwarded-for", () => {
    expect(
      clientIp(new Headers({ "x-forwarded-for": "103.12.4.5, 10.0.0.1" })),
    ).toBe("103.12.4.5");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
