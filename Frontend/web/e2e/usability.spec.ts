/**
 * The WP9 usability tasks (docs/usability-test-wp9.md), done by a script on a
 * phone-sized browser with the demo data (Demo Trading Ltd, password Demo-Pass-123).
 * Pilot employees do the same tasks on their own phones for the acceptance test.
 */
import { expect, test, type Page } from "@playwright/test";
import { USERS } from "./users";

/** Open the app as an already signed-in user, in the given language. */
async function open(page: Page, path = "/home", lang: "bn" | "en" = "en") {
  await page.addInitScript((l) => localStorage.setItem("erp-lang", l), lang);
  await page.goto(path);
}

test.describe("employee (Rafi)", () => {
  test.use({ storageState: USERS.rafi.state });

  test("task 1: see today, balances and the latest payslip, in Bangla", async ({
    page,
  }) => {
    await open(page, "/home", "bn");
    await expect(
      page.getByRole("heading", { name: /আসসালামু আলাইকুম/ }),
    ).toBeVisible();
    await expect(page.getByText("ছুটির ব্যালান্স")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "পাঞ্চ ইন / আউট" }),
    ).toBeVisible();
  });

  test("task 2: register the phone once (HR approves), then punch in at the office", async ({
    page,
    playwright,
    baseURL,
  }) => {
    await open(page);
    await page.getByRole("link", { name: "Punch in / out" }).click();
    await page
      .getByLabel("Phone name, e.g. Samsung A15")
      .fill("Rafi test phone");
    await page.getByRole("button", { name: "Register this phone" }).click();
    await expect(page.getByText(/waiting for HR approval/)).toBeVisible();

    // HR (Farzana) approves the phone
    const hr = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { "x-erp-client": "pwa" },
    });
    const signedIn = await hr.post("/api/session", {
      data: {
        workspace: "demo",
        login: "farzana.akter@demo.test",
        password: "Demo-Pass-123",
      },
    });
    expect(signedIn.ok()).toBe(true);
    const pending = await (
      await hr.get("/api/erp/attendance/devices?status=pending")
    ).json();
    // only this browser's phone (approving another one would revoke this one: one active phone per person)
    const myDeviceId = await page.evaluate(() =>
      localStorage.getItem("erp-device-id"),
    );
    for (const d of pending.filter(
      (x: { deviceId: string }) => x.deviceId === myDeviceId,
    )) {
      const res = await hr.post(`/api/erp/attendance/devices/${d.id}/approve`, {
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      expect(res.status()).toBe(200);
    }
    // stand where Rafi's office (Chattogram) is set today: HR may have moved the geo-fence
    const companies = await (await hr.get("/api/erp/companies")).json();
    const branches = await (
      await hr.get(`/api/erp/companies/${companies[0].id}/branches`)
    ).json();
    const ctg = branches.find((b: { code: string }) => b.code === "CTG");
    if (ctg?.geoFence)
      await page
        .context()
        .setGeolocation({
          latitude: ctg.geoFence.lat,
          longitude: ctg.geoFence.lng,
          accuracy: 10,
        });
    await hr.dispose();

    await page.reload();
    await page.getByRole("button", { name: "Punch now" }).click();
    await expect(page.getByText(/Punched at \d\d:\d\d\./)).toBeVisible();
  });

  test("task 3: check the leave balance, apply for casual leave, then cancel it", async ({
    page,
  }) => {
    await open(page, "/leave");
    await expect(page.getByRole("heading", { name: "Leave" })).toBeVisible();
    await page.getByRole("link", { name: "Apply for leave" }).click();

    const casual = await page
      .locator("option", { hasText: "Casual leave" })
      .getAttribute("value");
    await page.getByLabel("Leave type").selectOption(casual!);
    await page.getByLabel("From").fill("2026-12-09");
    await page.getByLabel("To").fill("2026-12-10");
    await page.getByRole("button", { name: "Check days" }).click();
    await expect(page.getByText("2 day(s) will be counted.")).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();

    await page.waitForURL("**/leave");
    const request = page
      .locator("li", { hasText: "9 Dec" })
      .filter({ hasText: "Waiting" })
      .first();
    await expect(request).toBeVisible();
    await request.getByRole("button", { name: "Cancel request" }).click();
    await request
      .getByLabel("Why do you cancel it?")
      .fill("Plans changed (test)");
    await request.getByRole("button", { name: "Cancel request" }).click();
    await expect(page.getByText("Request cancelled.")).toBeVisible();
  });

  test("task 4: open payslips", async ({ page }) => {
    await open(page);
    await page.getByRole("link", { name: "Payslips" }).click();
    await expect(page.getByRole("heading", { name: "Payslips" })).toBeVisible();
  });

  test("task 5: update my emergency contact and switch the language", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("link", { name: "Me", exact: true }).click();
    await page.getByLabel("Emergency contact mobile").fill("01812345678");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.getByRole("button", { name: "বাংলা" }).click();
    await expect(
      page.getByRole("heading", { name: "আমার প্রোফাইল" }),
    ).toBeVisible();
  });

  // WP11: needs the API with an AI provider (AI_PROVIDER=fake or anthropic); skipped when AI is off
  test("task 7: ask the assistant a policy question in Bangla, and rate the answer", async ({
    page,
  }) => {
    await open(page, "/home", "bn");
    await expect(
      page.getByRole("heading", { name: /আসসালামু আলাইকুম/ }),
    ).toBeVisible();
    const card = page.getByRole("link", { name: /সহকারীকে জিজ্ঞেস করুন/ });
    const aiOn = await card.waitFor({ timeout: 5000 }).then(
      () => true,
      () => false,
    );
    test.skip(!aiOn, "AI is switched off on this API");
    await card.click();
    await page
      .getByLabel("আপনার প্রশ্ন লিখুন")
      .fill("নৈমিত্তিক ছুটি বছরে কত দিন পাওয়া যায়?");
    await page.getByRole("button", { name: "জিজ্ঞেস করুন" }).click();
    await expect(page.getByText(/১০ দিন নৈমিত্তিক ছুটি/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/^সূত্র: কর্মী হ্যান্ডবুক/)).toBeVisible();
    await page.getByRole("button", { name: /কাজে লেগেছে/ }).click();
    await expect(page.getByText("মতামতের জন্য ধন্যবাদ।")).toBeVisible();
  });

  // WP12: consent for attendance data (the photo-punch notice, so the punch tasks are not affected)
  test("task 8: read a consent notice in Bangla, agree, then withdraw", async ({
    page,
  }) => {
    await open(page, "/profile", "bn");
    await expect(page.getByRole("heading", { name: "সম্মতি" })).toBeVisible();
    const item = page.getByRole("region", { name: "পাঞ্চের সময় ছবি" });
    await item.getByText("নোটিশ পড়ুন").click();
    await expect(item.getByText(/৯০ দিন পর মুছে ফেলা হয়/)).toBeVisible();
    if (await item.getByRole("button", { name: "প্রত্যাহার করুন" }).isVisible())
      await item.getByRole("button", { name: "প্রত্যাহার করুন" }).click();
    await item.getByRole("button", { name: "আমি সম্মত" }).click();
    await expect(item.getByText("আপনি সম্মতি দিয়েছেন")).toBeVisible();
    await item.getByRole("button", { name: "প্রত্যাহার করুন" }).click();
    await expect(item.getByText("প্রত্যাহার করা হয়েছে")).toBeVisible();
  });

  test("offline: the app says so", async ({ page, context }) => {
    await open(page);
    await expect(page.getByRole("heading", { name: /Hello/ })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText(/You are offline/)).toBeVisible();
    await context.setOffline(false);
  });
});

test.describe("resignation from the app (Rafi)", () => {
  test.use({ storageState: USERS.rafi.state });

  test("the form shows the notice period and warns when short (not sent)", async ({
    page,
  }) => {
    await open(page, "/profile");
    await page.getByRole("button", { name: "Hand in my resignation" }).click();
    await expect(
      page.getByText(/Your notice period is \d+ days/),
    ).toBeVisible();
    const soon = new Date(Date.now() + 5 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await page.getByLabel("Last working day").fill(soon);
    await expect(page.getByText(/short of the notice period/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});

test.describe("manager (Tanvir)", () => {
  test.use({ storageState: USERS.tanvir.state });

  test("task 6: open the approvals inbox; reject needs a comment", async ({
    page,
  }) => {
    await open(page);
    await page.getByRole("link", { name: /Approvals/ }).click();
    // whatever waits first: earlier runs leave claims and withdraw leave, so no item is guaranteed
    const item = page.locator('a[href^="/approvals/"]').first();
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await page.getByRole("button", { name: "Reject" }).click();
    await expect(
      page.getByText("A comment is needed to reject or return."),
    ).toBeVisible();
  });
});

test.describe("signed out", () => {
  test("sign in from the login page (Bangla)", async ({ page }) => {
    await open(page, "/leave", "bn");
    await expect(page).toHaveURL(/\/login\?next=%2Fleave/);
    await page.getByLabel("কোম্পানি কোড").fill("demo");
    await page.getByLabel("ই-মেইল বা মোবাইল নম্বর").fill("rafi@demo.test");
    await page.getByLabel("পাসওয়ার্ড").fill("Demo-Pass-123");
    await page.getByRole("button", { name: "সাইন ইন" }).click();
    await expect(page).toHaveURL(/\/leave$/);
    await expect(page.getByRole("heading", { name: "ছুটি" })).toBeVisible();
  });
});

test.describe("employee (Rafi): expense claim (WP16)", () => {
  test.use({ storageState: USERS.rafi.state });

  test("task 8: claim a CNG fare and a lunch with a photo of the receipt, send it for approval", async ({
    page,
  }) => {
    await open(page);
    await page
      .getByRole("link", { name: /Expense claims and advances/ })
      .click();
    await page.getByRole("button", { name: "New claim" }).click();
    await page
      .getByLabel("What was it for?")
      .fill(`Dealer meeting, Mirpur ${Date.now().toString().slice(-5)}`);
    await page.getByRole("button", { name: "New claim" }).last().click();

    // first expense: lunch over Tk 300 needs a receipt
    await expect(page.getByText("Draft")).toBeVisible();
    await page.getByRole("button", { name: "+ Add an expense" }).click();
    await page
      .locator("#line-category-0")
      .selectOption({ label: "Meals and entertainment" });
    await page.locator("#line-desc-0").fill("Lunch with 2 dealers, Mirpur 10");
    await page.locator("#line-amount-0").fill("650");
    await expect(page.getByText("Receipt needed")).toBeVisible();
    await page
      .locator("#line-receipt-0")
      .setInputFiles({
        name: "receipt.png",
        mimeType: "image/png",
        buffer: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.from(`lunch ${Date.now()}`),
        ]),
      });
    await expect(page.getByText("Receipt added")).toBeVisible();
    await page.getByRole("button", { name: "+ Add an expense" }).click();
    await page
      .locator("#line-category-1")
      .selectOption({
        label: "Local conveyance (rickshaw, CNG, ride-sharing)",
      });
    await page.locator("#line-desc-1").fill("CNG Mirpur 10 - Gulshan 1");
    await page.locator("#line-amount-1").fill("320");
    await expect(
      page.getByText("Receipt not needed for this amount"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(
      page.getByText(/Sent: your Dept Head, then Accounts/),
    ).toBeVisible();
    await expect(page.getByText("Waiting for approval")).toBeVisible();
    // and takes it back (the demo inbox stays clean run after run)
    page.once("dialog", (d) => d.accept("Sent by mistake"));
    await page.getByRole("button", { name: "Withdraw" }).click();
    await expect(page.getByText("Waiting for approval")).toHaveCount(0);
  });
});

// a different out time every run, so this run's request is easy to find
const correctionOut = `18:${String(10 + (Date.now() % 49)).padStart(2, "0")}`;

test.describe("attendance correction (fixes): Rafi asks", () => {
  test.use({ storageState: USERS.rafi.state });

  test("task 9: Rafi forgot to punch out: he asks for a correction from the day list", async ({
    page,
  }) => {
    await open(page, "/attendance");
    await page
      .getByRole("button", { name: /^Fix this day/ })
      .first()
      .click();
    await page.getByRole("button", { name: "Request a correction" }).click();
    await page.getByLabel("Out time").fill(correctionOut);
    await page
      .getByLabel("Why?")
      .fill("Forgot to punch out after the dealer meeting");
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(
      page.getByText("Correction sent to your Dept Head."),
    ).toBeVisible();
    await expect(page.getByText("Waiting for approval").first()).toBeVisible();
  });
});

test.describe("attendance correction (fixes): Tanvir decides", () => {
  test.use({ storageState: USERS.tanvir.state });

  test("task 10: Tanvir sees it in his inbox and rejects it with a comment", async ({
    page,
  }) => {
    await open(page, "/approvals");
    await page
      .getByText(
        new RegExp(
          `Attendance correction: Mahmudul Hasan Rafi .* out ${correctionOut}`,
        ),
      )
      .first()
      .click();
    await page
      .getByLabel("Comment")
      .fill("The guard register shows you left at 17:30");
    await page.getByRole("button", { name: "Reject" }).click();
    await expect(page).toHaveURL(/\/approvals$/);
  });
});

test.describe("leave fixes: Rafi", () => {
  test.use({ storageState: USERS.rafi.state });

  test("task 11: three days of sick leave with a photo of the certificate, then withdraw it", async ({
    page,
  }) => {
    // a different week every run, far ahead, so runs never overlap
    const day = 1 + (Math.floor(Date.now() / 60_000) % 20);
    const from = `2027-03-${String(day).padStart(2, "0")}`;
    const to = `2027-03-${String(day + 2).padStart(2, "0")}`;
    await open(page, "/leave/apply");
    const sick = await page
      .locator("#leave-type option", { hasText: "Sick" })
      .first()
      .getAttribute("value");
    await page.locator("#leave-type").selectOption(sick!);
    await page.locator("#leave-from").fill(from);
    await page.locator("#leave-to").fill(to);
    await page.locator("#leave-reason").fill("Fever and throat infection");
    await expect(page.getByText(/needed for more than 2 day/)).toBeVisible();
    await page
      .locator("#leave-document")
      .setInputFiles({
        name: "certificate.png",
        mimeType: "image/png",
        buffer: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.from(`certificate ${Date.now()}`),
        ]),
      });
    await expect(page.getByText("✓ Document attached.")).toBeVisible();
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page).toHaveURL(/\/leave$/);

    // withdraw it again (keeps the demo balance as it was)
    const item = page
      .getByRole("listitem")
      .filter({ hasText: /Sick/ })
      .filter({ hasText: "Waiting" })
      .first();
    await item.getByRole("button", { name: "Cancel request" }).click();
    await item.locator("textarea").fill("Recovered early");
    await item.getByRole("button", { name: "Cancel request" }).click();
    await expect(page.getByText(/cancelled/i).first()).toBeVisible();
  });
});

test.describe("payroll fixes: Rafi", () => {
  test.use({ storageState: USERS.rafi.state });

  test("task 12: his salary advance, PF and tax certificate from the payslips page", async ({
    page,
  }) => {
    await open(page, "/payslips");
    await page.getByRole("link", { name: "Salary advances" }).click();
    await expect(
      page.getByRole("button", { name: "Ask for a salary advance" }),
    ).toBeVisible();
    // the seeded one he asked for himself, waiting for Tanvir
    await expect(page.getByText("Viqarunnisa Noon School")).toBeVisible();
    await page
      .getByRole("button", { name: "Ask for a salary advance" })
      .click();
    await page.locator("#ask-principal").fill("9000");
    await page.locator("#ask-installment").fill("3000");
    await expect(page.getByText(/for about 3 months/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await open(page, "/payslips/pf");
    await expect(
      page.getByRole("heading", { name: "Provident fund" }),
    ).toBeVisible();
    await open(page, "/payslips/tax");
    await expect(
      page.getByRole("button", { name: "Download PDF" }),
    ).toBeVisible();
    await expect(
      page.getByText("Total tax deducted in the year"),
    ).toBeVisible();
  });

  test("task 13: he sees where his salary goes; a change waits for HR (no second request meanwhile)", async ({
    page,
  }) => {
    await open(page, "/profile");
    await expect(
      page.getByRole("heading", { name: "Salary account" }),
    ).toBeVisible();
    // the seeded bKash request is still with HR
    await expect(page.getByText("Waiting for HR")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Change salary account|Request a new salary account/,
      }),
    ).toHaveCount(0);
  });
});

test.describe("employee lifecycle: Rafi", () => {
  test.use({ storageState: USERS.rafi.state });

  test("task 14: he sees his job, his probation and his documents", async ({
    page,
  }) => {
    await open(page, "/profile");
    await expect(page.getByRole("heading", { name: "My job" })).toBeVisible();
    await expect(page.getByText("Tanvir Hossain")).toBeVisible();
    await expect(page.getByText(/On probation until/)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "My documents" }),
    ).toBeVisible();
  });
});

test.describe("procurement: Rafi", () => {
  test.use({ storageState: USERS.rafi.state });

  test("task 15: he follows his purchase requests and starts one (then cancels it)", async ({
    page,
  }) => {
    await open(page, "/home");
    await page.getByRole("link", { name: /Purchase requests/ }).click();
    await expect(
      page.getByText("Furniture for the new sales officers"),
    ).toBeVisible();
    await page.getByRole("button", { name: "New purchase request" }).click();
    await page.locator("#pr-title").fill(`Extension cords ${Date.now()}`);
    await page.locator("#pr-why").fill("The new desks have no sockets nearby");
    await page.locator("#pr-item-0").fill("Extension cord, 5 sockets");
    await page.locator("#pr-qty-0").fill("4");
    await page.locator("#pr-price-0").fill("650");
    await expect(page.getByText(/Estimated total:.*2,600/)).toBeVisible();
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(
      page.getByRole("button", { name: "Send for approval" }),
    ).toBeVisible();
    // keep the demo tidy
    await page.getByRole("button", { name: "Cancel request" }).click();
    await page
      .locator("#pr-cancel-reason")
      .fill("Facilities already has spare cords");
    await page.getByRole("button", { name: "Cancel request" }).click();
    await expect(page).toHaveURL(/\/requisitions$/);
  });
});
