/**
 * The public enquiry form (/enquiry/demo), on a phone, without signing in: a customer sends
 * an enquiry and it lands in the CRM as a lead of the territory's salesperson.
 *
 * Needs ENQUIRY_FORMS with a "demo" form in Frontend/web/.env.local (README: "Public enquiry
 * form"); without it the test is skipped.
 */
import { expect, test } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:3000";

test("a customer sends an enquiry; it becomes Rafi’s lead (Feni is in the CTG territory)", async ({
  page,
  request,
}) => {
  const probe = await request.get("/enquiry/demo");
  test.skip(probe.status() === 404, 'no "demo" form in ENQUIRY_FORMS');

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const phone = `0191${String(Date.now()).slice(-7)}`;

  await page.goto("/enquiry/demo?ref=e2e-qr-code");
  await expect(
    page.getByRole("heading", { name: "আপনার চাহিদা জানান" }),
  ).toBeVisible();
  await page.getByLabel("আপনার নাম").fill("শাহানা পারভীন");
  await page
    .getByLabel("দোকান / প্রতিষ্ঠান (যদি থাকে)")
    .fill("পারভীন স্টোর, ফেনী");
  await page.locator("#eq-phone").fill(phone); // the e-mail hint also says "মোবাইল নম্বর"
  await page.getByLabel("জেলা").selectOption("Feni");
  await page
    .getByLabel("আপনার কী দরকার?")
    .fill("দোকানের জন্য মাসে ১০০ লিটার সয়াবিন তেল");
  await page.waitForTimeout(3100); // a person takes at least 3 seconds; faster is treated as a bot
  await page.getByRole("button", { name: "পাঠিয়ে দিন" }).click();
  await expect(page.getByRole("heading", { name: "ধন্যবাদ!" })).toBeVisible();

  // the Sales head sees it, owned by Rafi, with the shared link as campaign
  const login = await request.post(`${API}/auth/login`, {
    data: {
      workspace: "demo",
      login: "tanvir.hossain@demo.test",
      password: "Demo-Pass-123",
    },
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const companies = (await (
    await request.get(`${API}/companies`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
  ).json()) as Array<{ id: string; shortName: string }>;
  const dtl = companies.find((c) => c.shortName === "DTL")!;
  const leads = (await (
    await request.get(`${API}/companies/${dtl.id}/leads`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
  ).json()) as Array<{
    phone: string;
    ownerName?: string;
    source: string;
    sourceDetail: string;
    state: string;
  }>;
  const lead = leads.find((l) => l.phone === `+88${phone}`);
  expect(lead).toMatchObject({
    source: "web_form",
    sourceDetail: "Enquiry form (ref: e2e-qr-code)",
    state: "new",
    ownerName: "Mahmudul Hasan Rafi",
  });
  expect(errors).toEqual([]);
});
