/**
 * The finance screens (Phase 2: WP14 ledger, WP15 vendors, bills and tax at source)
 * on a desktop browser, with the demo data (Demo Trading Ltd, `npm run db:seed`):
 * Sujit (Accounts) enters a vendor bill and pays it; the workspace owner, the
 * second Accounts user, approves both (maker-checker).
 */
import { expect, test, type Page } from "@playwright/test";
import { USERS } from "./users";

/** Open a portal screen in English and fail on any browser error. */
async function open(page: Page, path: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("erp-lang", "en"));
  await page.goto(path);
  return errors;
}

// a new invoice number every run (the database refuses the same one twice)
const billNo = `KT-E2E-${Date.now().toString().slice(-6)}`;

test.describe("Accounts (Sujit): books and a vendor bill", () => {
  test.use({ storageState: USERS.sujit.state });

  test("the books: fiscal year, nightly checks; finance in the menu", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/finance");
    await expect(page.getByRole("heading", { name: "Books" })).toBeVisible();
    await expect(page.getByText("2026-27", { exact: true })).toBeVisible();
    await expect(page.getByText(/All checks passed/)).toBeVisible();
    const nav = page.getByRole("navigation", { name: "HR & Admin portal" });
    for (const item of [
      "Vouchers",
      "Chart of accounts",
      "Financial reports",
      "Vendors",
      "Vendor bills",
      "VAT & tax at source",
    ])
      await expect(nav.getByRole("link", { name: item })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("chart of accounts and the trial balance", async ({ page }) => {
    const errors = await open(page, "/portal/finance/accounts");
    await expect(
      page.getByRole("cell", {
        name: "Cleaning, security and outsourced services",
      }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Months" }).click();
    await expect(
      page.getByRole("cell", { name: "October 2026" }),
    ).toBeVisible();
    await page.goto("/portal/finance/reports");
    await expect(page.getByText("Balanced", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Balance sheet" }).click();
    await expect(page.getByText("Balanced", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a vendor: tax details and bills", async ({ page }) => {
    const errors = await open(page, "/portal/vendors");
    await page.getByRole("cell", { name: /Clean & Care Services Ltd/ }).click();
    await expect(
      page.getByRole("heading", { name: "Clean & Care Services Ltd" }),
    ).toBeVisible();
    await expect(page.getByText("123456789012")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "CCS/2026/1043" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("enter a bill: VAT and tax at source are worked out; submit", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/bills");
    await page.getByRole("button", { name: "New bill" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .locator("#bill-vendor")
      .selectOption({ label: "V-0003 · Karim Traders" });
    await dialog.locator("#bill-no").fill(billNo);
    await dialog.locator("#bill-date").fill("2026-10-14");
    await dialog
      .locator("#bill-narration")
      .fill("Toner cartridges for the Gulshan office");
    await dialog
      .locator("#bline-account-0")
      .selectOption({ label: "5240 · Printing and stationery" });
    await dialog.locator("#bline-desc-0").fill("HP 85A toner, 10 pcs");
    await dialog.locator("#bline-amount-0").fill("10000");
    await dialog.locator("#bline-vat-0").selectOption("7.5");
    await dialog.getByRole("button", { name: "Create" }).click();

    // SUPPLY 1 %: Tk 100 income tax; the company withholds the VAT (Tk 750); the vendor gets Tk 9,900
    await expect(
      page.getByRole("heading", { name: `Karim Traders: ${billNo}` }),
    ).toBeVisible();
    await expect(page.getByText("Income tax at source (1%)")).toBeVisible();
    await expect(page.getByText("৳ 9,900.00")).toBeVisible();
    await page.getByRole("button", { name: "Submit for approval" }).click();
    await expect(
      page.getByText(/Submitted: another Accounts user approves it/),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("Second Accounts user (owner): approves", () => {
  test.use({ storageState: USERS.owner.state });

  test("approve the bill from the inbox", async ({ page }) => {
    const errors = await open(page, "/portal/approvals");
    const row = page.getByRole("cell", {
      name: new RegExp(`Vendor bill ${billNo}`),
    });
    await row.click();
    await expect(page.getByText("Tk 10750.00").first()).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    // back in the inbox: the bill has left it
    await expect(page).toHaveURL(/\/portal\/approvals$/);
    await expect(row).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe("Accounts (Sujit): pays the bill", () => {
  test.use({ storageState: USERS.sujit.state });

  test("pay by cheque: the payment voucher goes to the checker", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/bills");
    await page.getByRole("cell", { name: billNo, exact: true }).click();
    await expect(
      page.getByText("Unpaid", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Pay", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#pay-method").selectOption("cheque");
    await dialog
      .locator("#pay-from")
      .selectOption({ label: "1130 · Bank - current account" });
    await dialog.locator("#pay-reference").fill("CHQ 0045600");
    await dialog.getByRole("button", { name: "Pay", exact: true }).click();
    await expect(
      page.getByText("Payment voucher sent for approval."),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("tax at source: withheld tax waits to be deposited; rates from the rule pack", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/tax");
    await expect(
      page.getByRole("cell", { name: "October 2026" }).first(),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(
      page.getByLabel(
        "The company is a VAT withholding entity (deducts VAT at source)",
      ),
    ).toBeChecked();
    await expect(page.getByText(/BD-LABOUR 2026\.3/)).toBeVisible();
    expect(errors).toEqual([]);
  });
});

// ------------------------------------------------------------------ WP16
const claimTitle = `Market visit, Uttara ${Date.now().toString().slice(-6)}`;

test.describe("expense claim (WP16): Rafi claims, Tanvir and Sujit approve, Sujit pays, the owner checks", () => {
  test("Rafi files a mobile bill claim with a receipt", async ({ browser }) => {
    const page = await (
      await browser.newContext({ storageState: USERS.rafi.state })
    ).newPage();
    const errors = await open(page, "/claims");
    await page.getByRole("button", { name: "New claim" }).click();
    await page.getByLabel("What was it for?").fill(claimTitle);
    await page.getByRole("button", { name: "New claim" }).last().click();
    await page.getByRole("button", { name: "+ Add an expense" }).click();
    await page
      .locator("#line-category-0")
      .selectOption({ label: "Mobile and internet" });
    await page.locator("#line-desc-0").fill("Robi top-up for dealer calls");
    await page.locator("#line-amount-0").fill("500");
    await page
      .locator("#line-receipt-0")
      .setInputFiles({
        name: "robi.png",
        mimeType: "image/png",
        buffer: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.from(claimTitle),
        ]),
      });
    await expect(page.getByText("Receipt added")).toBeVisible();
    await page.getByRole("button", { name: "Send for approval" }).click();
    await expect(page.getByText(/Sent: your Dept Head/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Tanvir (Dept Head) approves in the app", async ({ browser }) => {
    const page = await (
      await browser.newContext({ storageState: USERS.tanvir.state })
    ).newPage();
    await open(page, "/approvals");
    await page.getByText(new RegExp(claimTitle)).click();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page).toHaveURL(/\/approvals$/);
  });

  test("Sujit verifies the receipt and approves, then pays in cash", async ({
    browser,
  }) => {
    const page = await (
      await browser.newContext({ storageState: USERS.sujit.state })
    ).newPage();
    const errors = await open(page, "/portal/approvals");
    await page.getByRole("cell", { name: new RegExp(claimTitle) }).click();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page).toHaveURL(/\/portal\/approvals$/);

    await page.goto("/portal/expenses");
    await page.getByRole("cell", { name: claimTitle }).click();
    await expect(page.getByRole("img", { name: "Receipt" })).toBeVisible();
    await page.getByRole("button", { name: "Pay", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .locator("#claim-pay-from")
      .selectOption({ label: "1110 · Cash in hand" });
    await dialog.getByRole("button", { name: "Pay", exact: true }).click();
    await expect(page.getByText("Voucher sent to the checker.")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the owner (second Accounts user) checks the payment voucher: the claim is paid", async ({
    browser,
  }) => {
    const page = await (
      await browser.newContext({ storageState: USERS.owner.state })
    ).newPage();
    await open(page, "/portal/approvals");
    await page
      .getByRole("cell", {
        name: new RegExp(`Expense claim .*${claimTitle}|${claimTitle}`),
      })
      .first()
      .click();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page).toHaveURL(/\/portal\/approvals$/);
    await page.goto("/portal/expenses");
    await page.getByRole("tab", { name: "All claims" }).click();
    await expect(
      page.getByRole("row", { name: new RegExp(claimTitle) }).getByText("Paid"),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Advances sub-ledger" }).click();
    await expect(page.getByText("Balanced", { exact: true })).toBeVisible();
  });
});

test.describe("procurement (WP17)", () => {
  test.describe("Accounts (Sujit)", () => {
    test.use({ storageState: USERS.sujit.state });

    test("what to buy, the quotations side by side, the order and the unmatched bill", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/procurement");
      await expect(
        page.getByRole("cell", { name: "Whiteboard for the sales room" }),
      ).toBeVisible(); // to buy
      await page.getByRole("tab", { name: "Requisitions" }).click();
      await page
        .getByRole("cell", { name: "Furniture for the new sales officers" })
        .click();
      await expect(
        page.getByRole("columnheader", {
          name: "Partex Furniture Industries Ltd",
        }),
      ).toBeVisible();
      const quotes = page.locator("section").filter({ hasText: "Quotations" });
      await expect(
        quotes
          .getByRole("row")
          .filter({ hasText: "Otobi" })
          .getByText("Lowest"),
      ).toBeVisible();
      await expect(
        quotes
          .getByRole("row")
          .filter({ hasText: "Partex" })
          .getByText("Chosen"),
      ).toBeVisible();
      await expect(
        page.getByText(/Comparative statement:\s*Approved/),
      ).toBeVisible();

      await page.getByRole("link", { name: /^PO\// }).click();
      await expect(
        page.getByRole("heading", { name: /PO\/2026-27/ }),
      ).toBeVisible();
      await expect(page.getByText("Partly received")).toBeVisible();
      await page.getByRole("button", { name: "Record goods received" }).click();
      await expect(
        page.getByRole("dialog").getByLabel("Received on"),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();

      // the draft bill charges 6 chairs, only 4 arrived: it cannot be paid
      await page.getByRole("row").filter({ hasText: "PFIL/INV/7781" }).click();
      await expect(
        page.getByText("Does not match: cannot be paid"),
      ).toBeVisible();
      await expect(page.getByText("billed more than received")).toBeVisible();
      await expect(page.getByRole("button", { name: "Pay" })).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });

  test.describe("Dept Head (Tanvir)", () => {
    test.use({ storageState: USERS.tanvir.state });

    test("sees his department's requisitions and records goods received", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/procurement");
      await expect(page.getByRole("tab", { name: "To buy" })).toHaveCount(0);
      await expect(
        page.getByRole("cell", { name: "Printer toner, Chattogram office" }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Purchase orders" }).click();
      await page.getByRole("row").filter({ hasText: "Partex" }).click();
      await expect(
        page.getByRole("button", { name: "Record goods received" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Issue to vendor" }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
});

test.describe("budgets (WP18)", () => {
  test.describe("Accounts (Sujit)", () => {
    test.use({ storageState: USERS.sujit.state });

    test("budget vs actual, a budget with its commitment, the draft and the waiting change", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/budgets");
      await expect(
        page.getByText(/Committed: issued purchase orders/),
      ).toBeVisible();
      const sales = page
        .locator("section")
        .filter({ has: page.getByRole("cell", { name: /1210 · Furniture/ }) })
        .first();
      await expect(
        sales.getByRole("cell", { name: /73,400/ }).first(),
      ).toBeVisible(); // the Partex order, committed
      await expect(
        page.locator("section").filter({ hasText: "Head Office" }).first(),
      ).toBeVisible();

      await page.getByRole("tab", { name: "Budgets" }).click();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Human Resources" })
          .getByText("Draft"),
      ).toBeVisible();
      await page.getByRole("button", { name: "New budget" }).click();
      await expect(
        page
          .getByRole("dialog", { name: "New budget" })
          .getByLabel("Fiscal year"),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();

      await page
        .getByRole("row")
        .filter({ hasText: /Sales/ })
        .filter({ hasText: "Approved" })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Changes" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Waiting for the Admin" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Ask for a change" }),
      ).toHaveCount(0); // one open change at a time
      expect(errors).toEqual([]);
    });
  });

  test.describe("Dept Head (Tanvir)", () => {
    test.use({ storageState: USERS.tanvir.state });

    test("sees only his department; cannot prepare budgets", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/budgets");
      await expect(
        page.getByRole("cell", { name: /1210 · Furniture/ }).first(),
      ).toBeVisible();
      await expect(
        page.locator("section").filter({ hasText: "Head Office" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "New budget" }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
});

test.describe("assets and stock (WP19)", () => {
  test.describe("Admin (Anisur)", () => {
    test.use({ storageState: USERS.anisur.state });

    test("the register: who has what; the microbus with its label, service and schedule", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/assets");
      await expect(
        page.getByRole("heading", { name: "Fixed assets" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Lenovo ThinkPad" })
          .getByText("Mahmudul Hasan Rafi"),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "HP ProBook" })
          .getByText("Tanvir Hossain"),
      ).toBeVisible();

      await page.getByRole("row").filter({ hasText: "Toyota Hiace" }).click();
      await expect(
        page.getByTestId("asset-label").getByRole("img"),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", { name: /Navana Toyota/ }),
      ).toBeVisible();
      await expect(page.getByRole("cell", { name: "Posted" })).toHaveCount(3); // July-September
      await page
        .getByRole("button", { name: "Show the whole schedule" })
        .click();
      await expect(
        page.getByRole("cell", { name: "October 2026" }),
      ).toBeVisible(); // the months still to come
      await expect(page.getByRole("cell", { name: "Posted" })).toHaveCount(3);
      await expect(
        page
          .getByRole("button", { name: "Take back" })
          .or(page.getByRole("button", { name: "Give to an employee" })),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("Accounts (Sujit)", () => {
    test.use({ storageState: USERS.sujit.state });

    test("depreciation runs; stock running low; the store requests", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/assets");
      await page.getByRole("tab", { name: "Depreciation" }).click();
      await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
      await expect(
        page.getByRole("row").filter({ hasText: /September 2026/ }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Preview" })).toBeVisible();

      await page.goto("/portal/stock");
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "HP 85A toner" })
          .getByText("Low"),
      ).toBeVisible();
      await page
        .getByLabel("Store")
        .selectOption({ label: "HO · Head office store, Tejgaon" });
      await expect(
        page.getByRole("cell", { name: /Karim Traders/ }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Receive stock" }),
      ).toBeVisible();

      await page.getByRole("tab", { name: "Requests" }).click();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Sharmin Sultana Mitu" })
          .getByText("Waiting for the Dept Head"),
      ).toBeVisible();
      const rafi = page
        .getByRole("row")
        .filter({ hasText: "Mahmudul Hasan Rafi" })
        .first();
      await expect(rafi.getByText("Partly issued")).toBeVisible();
      await rafi.getByRole("button", { name: "Issue" }).click();
      await expect(
        page
          .getByRole("dialog")
          .getByRole("cell", { name: "HP 85A toner cartridge" }),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      expect(errors).toEqual([]);
    });
  });

  test.describe("Employee (Rafi)", () => {
    test.use({ storageState: USERS.rafi.state });

    test("confirms the laptop he was given; sees his store request", async ({
      page,
    }) => {
      const errors = await open(page, "/profile");
      const card = page
        .locator("section")
        .filter({ hasText: "My company assets" });
      await expect(
        card.getByText("Lenovo ThinkPad E14 Gen 5 laptop"),
      ).toBeVisible();
      const confirm = card.getByRole("button", { name: "I have received it" });
      if (await confirm.count()) await confirm.click();
      await expect(card.getByText(/^Received /)).toBeVisible();

      await page.goto("/store-requests");
      await expect(
        page.getByText(/Box file \(Matador\): 10 pcs · Issued 10/),
      ).toBeVisible();
      await page.getByRole("button", { name: "Ask the store" }).click();
      // two stores now (the head office store, the finished-goods depot): he picks the office one
      await page
        .getByLabel("Store")
        .selectOption({ label: "Head office store, Tejgaon" });
      await expect(page.getByLabel("Store")).toHaveValue(/.+/);
      expect(errors).toEqual([]);
    });
  });
});

test.describe("bank reconciliation (WP20)", () => {
  test.describe("Accounts (Sujit)", () => {
    test.use({ storageState: USERS.sujit.state });

    test("match by hand, an AI suggestion, and the reconciliation that equals the books", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/bank");
      await expect(
        page.getByRole("heading", { name: "Bank reconciliation" }),
      ).toBeVisible();
      await page
        .getByRole("row")
        .filter({ hasText: "Dutch-Bangla Bank PLC" })
        .click();
      await expect(
        page.getByRole("heading", {
          name: /Dutch-Bangla Bank PLC · 1101100023456/,
        }),
      ).toBeVisible();

      const bank = page.getByRole("region", { name: "Bank statement" });
      const books = page.getByRole("region", { name: "Books" });
      // one cash deposit for two dealers: picked on both sides, matched when the totals agree
      const deposit = bank
        .getByRole("row")
        .filter({ hasText: "CASH DEPOSIT GULSHAN" });
      if (await deposit.getByRole("checkbox").count()) {
        await deposit.getByRole("checkbox").check();
        await books
          .getByRole("row")
          .filter({ hasText: "Sylhet Agro" })
          .getByRole("checkbox")
          .check();
        await expect(
          page.getByRole("button", { name: "Match the selected lines" }),
        ).toBeDisabled();
        await books
          .getByRole("row")
          .filter({ hasText: "Bogura Traders" })
          .getByRole("checkbox")
          .check();
        await page
          .getByRole("button", { name: "Match the selected lines" })
          .click();
        await expect(deposit).toHaveCount(0);
      }

      // two Tk 5,000 receipts on one day: the AI tells which one the bank credited
      const karim = bank.getByRole("row").filter({ hasText: "KARIM STORES" });
      if (await karim.count()) {
        await karim.getByRole("button", { name: "What could it be?" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByText("Rahim Traders, Mirpur")).toBeVisible();
        await dialog.getByRole("button", { name: "Ask AI" }).click();
        await expect(dialog.getByText("AI suggests")).toBeVisible();
        await expect(dialog.getByText(/KARIM/).last()).toBeVisible();
        await dialog.getByRole("button", { name: "Accept" }).last().click();
        await expect(karim).toHaveCount(0);
      }

      // the SMS charge is not in the books yet: a draft voucher from the line
      const sms = bank.getByRole("row").filter({ hasText: "SMS ALERT CHARGE" });
      await sms.getByRole("button", { name: "Record in the books" }).click();
      await expect(
        page.getByRole("dialog").getByLabel("Narration"),
      ).toHaveValue(/SMS ALERT CHARGE/);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();

      await page.getByRole("tab", { name: "Statements" }).click();
      await expect(
        page.getByRole("cell", { name: "DBBL-1101100023456-OCT-2026.csv" }),
      ).toBeVisible();

      await page.getByRole("tab", { name: "Reconciliation" }).click();
      await page.getByLabel("As of").fill("2026-10-25");
      await expect(
        page.getByText("Balance as per bank statement"),
      ).toBeVisible();
      await expect(page.getByRole("status")).toHaveText(
        "Reconciled: the adjusted bank balance equals the books",
      );
      await expect(
        page.getByRole("cell", { name: /Rahim Traders/ }),
      ).toBeVisible(); // still on its way to the bank
      expect(errors).toEqual([]);
    });
  });

  test.describe("MD (Admin)", () => {
    test.use({ storageState: USERS.anisur.state });

    test("sees the reconciliation, cannot match or import", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/bank");
      await page
        .getByRole("row")
        .filter({ hasText: "Dutch-Bangla Bank PLC" })
        .click();
      await expect(
        page.getByRole("button", { name: "Match automatically" }),
      ).toHaveCount(0);
      await page.getByRole("tab", { name: "Statements" }).click();
      await expect(
        page.getByRole("button", { name: "Import a statement" }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
});

test.describe("VAT and compliance (WP21)", () => {
  test.describe("Accounts (Sujit)", () => {
    test.use({ storageState: USERS.sujit.state });

    test("the October return ties to the ledger; registers; items and rates", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/vat");
      await expect(
        page.getByRole("heading", { name: "VAT (Mushak)" }),
      ).toBeVisible();
      await page.getByLabel("Month").first().fill("2026-10");
      await expect(page.getByRole("status")).toHaveText(
        "The return agrees with the ledger.",
      );
      await expect(
        page.getByText("Output tax (VAT + SD)", { exact: true }).first(),
      ).toBeVisible();
      // October has not ended: nothing to file yet; September is in the filed returns
      await expect(
        page.getByRole("button", { name: "File the return" }),
      ).toHaveCount(0);
      await expect(page.getByRole("cell", { name: "2026-09" })).toBeVisible();

      await page.getByRole("tab", { name: "Sales register" }).click();
      await page.getByLabel("Month").fill("2026-10");
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Sylhet Agro Ltd" })
          .getByText("Posted"),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Bogura Traders" })
          .getByText("Waiting for the checker"),
      ).toBeVisible();
      await page.getByRole("button", { name: "New VAT invoice" }).click();
      await expect(
        page.getByRole("dialog").getByLabel("Item").first(),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();

      await page.getByRole("tab", { name: "Purchase register" }).click();
      await page.getByLabel("Month").fill("2026-10");
      await expect(
        page
          .getByRole("cell")
          .filter({ hasText: /KT-|CCS|RENT|Rent|rent/ })
          .first(),
      ).toBeVisible();

      await page.getByRole("tab", { name: "Items and rates" }).click();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "S-ISP" })
          .getByText("Reduced · 5%"),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("the compliance calendar: open items with days left; the fire licence", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/compliance");
      await expect(
        page.getByRole("heading", { name: "Compliance calendar" }),
      ).toBeVisible();
      await expect(
        page.getByRole("row").filter({ hasText: "Fire licence renewal" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "VAT return (Mushak 9.1): 2026-10" })
          .getByText(/days left/),
      ).toBeVisible();
      await page.getByLabel("Show closed").check();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "VAT return (Mushak 9.1): 2026-09" })
          .getByText(/auto: filed/),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Trade licence renewal" })
          .getByText("Done"),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("MD (Admin)", () => {
    test.use({ storageState: USERS.anisur.state });

    test("sees VAT, cannot file or record invoices", async ({ page }) => {
      const errors = await open(page, "/portal/vat");
      await page.getByRole("tab", { name: "Sales register" }).click();
      await expect(
        page.getByRole("button", { name: "New VAT invoice" }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
});

test.describe("finance close and Gate 2 (WP22)", () => {
  test.describe("Accounts (Sujit)", () => {
    test.use({ storageState: USERS.sujit.state });

    test("new reports: cash flow and department cost", async ({ page }) => {
      const errors = await open(page, "/portal/finance/reports");
      await page.getByRole("tab", { name: "Cash flow" }).click();
      await expect(page.getByText("Cash and bank at the start")).toBeVisible();
      await expect(page.getByRole("status")).toBeVisible();
      await page.getByRole("tab", { name: "Department cost" }).click();
      await expect(
        page.getByRole("columnheader", { name: "Total" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("the pilot company: October closed, Tally agrees, Gate 2 passed", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/finance/close");
      await page
        .getByRole("combobox", { name: "Company" })
        .selectOption({ label: "MAIL" });
      await page.getByLabel("Month").fill("2026-10");
      await expect(
        page.getByRole("heading", { name: /October 2026 · Closed/ }),
      ).toBeVisible();
      await expect(
        page.getByText("Petty cash counted and agreed"),
      ).toBeVisible();
      await expect(page.getByRole("status")).toHaveText(
        "Gate 2 passed for October 2026.",
      );

      await page.goto("/portal/finance/opening");
      await expect(page.getByText("Posted", { exact: true })).toBeVisible();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "meghna-agro-tally-tb-2026-10-31-v2.csv" })
          .getByText("Matches"),
      ).toBeVisible();
      await page
        .getByRole("row")
        .filter({ hasText: "meghna-agro-tally-tb-2026-10-31-v1.csv" })
        .click();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "5210" })
          .getByRole("cell", { name: /500/ })
          .last(),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", { name: "EXP-RENT" }).first(),
      ).toBeVisible();

      await page.goto("/portal/receivables");
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Sylhet Agro Ltd" })
          .getByRole("cell", { name: "SA-0912" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Money received" }),
      ).toBeVisible();
      // back to the main company for the other tests
      await page
        .getByRole("combobox", { name: "Company" })
        .selectOption({ label: "DTL" });
      expect(errors).toEqual([]);
    });

    test("a new bill filled from a scanned bill by the AI reader", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/bills");
      await page.getByRole("button", { name: "New bill" }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Read a scan")
        .setInputFiles(
          "../../backend/samples/documents/bill-karim-traders-kt5590.png",
        );
      await expect(dialog.locator("#bill-no")).toHaveValue("KT-5590");
      await expect(dialog.locator("#bill-date")).toHaveValue("2026-10-24");
      await expect(dialog.locator("#bline-amount-1")).toHaveValue("7500");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(errors).toEqual([]);
    });
  });
});

test.describe("CRM: customers and leads (WP23)", () => {
  test.describe("Sales user (Rafi)", () => {
    test.use({ storageState: USERS.rafi.state });

    test("his own leads, a known number refused, a call logged", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/crm/leads");
      await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
      await expect(
        page.getByRole("row").filter({ hasText: "Nasrin Akter" }),
      ).toBeVisible();
      // the leads given to Mitu are not his
      const owners = await page
        .getByRole("row")
        .filter({ hasText: /L\/2026-27/ })
        .allInnerTexts();
      expect(owners.every((r) => r.includes("Mahmudul Hasan Rafi"))).toBe(true);
      await expect(
        page.getByRole("heading", { name: "My tasks" }),
      ).toBeVisible();

      await page.getByRole("button", { name: "New lead" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name", { exact: true }).fill("Nasrin");
      await dialog
        .getByRole("textbox", { name: "Phone", exact: true })
        .fill("+880 1819 445566");
      await dialog.getByRole("button", { name: "New lead" }).click();
      await expect(dialog.getByRole("alert")).toContainText(
        "Already known as Leads L/2026-27/",
      );
      await dialog.getByRole("button", { name: "Cancel" }).click();

      await page.getByRole("row").filter({ hasText: "Nasrin Akter" }).click();
      await expect(page.getByText("What they wrote")).toBeVisible();
      const subject = `Sent the price list on WhatsApp (${Date.now() % 100000})`; // runs repeat on the same lead
      await page.getByLabel("Subject").fill(subject);
      await page.getByRole("button", { name: "Log" }).click();
      await expect(page.getByText(subject)).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("Sales head (Tanvir)", () => {
    test.use({ storageState: USERS.tanvir.state });

    test("sees the whole team and its customers", async ({ page }) => {
      const errors = await open(page, "/portal/crm/leads");
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Sharmin Sultana Mitu" })
          .first(),
      ).toBeVisible();
      await page.goto("/portal/crm/customers");
      await expect(
        page.getByRole("row").filter({ hasText: "Karim Stores" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("Accounts (Sujit)", () => {
    test.use({ storageState: USERS.sujit.state });

    test("sets credit terms; does not see sales conversations", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/crm/customers");
      await page.getByRole("row").filter({ hasText: "Meghna Dealers" }).click();
      await expect(
        page.getByText(/5,00,000\.00 · Payment terms \(days\): 30/),
      ).toBeVisible();
      await page.getByRole("button", { name: "Credit terms" }).click();
      await expect(
        page.getByRole("dialog").getByLabel("Credit limit"),
      ).toHaveValue("500000");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Activities" }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
});

test.describe("Commission and Gate 3 (WP31)", () => {
  test.describe("HR (Farzana)", () => {
    test.use({ storageState: USERS.farzana.state });

    test("the scheme, October's run, and what each salesperson earned", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/sales/commission");
      await expect(
        page.getByRole("heading", { name: "Commission scheme" }),
      ).toBeVisible();
      // the demo scheme: 2% of collection, 3% above target
      await expect(page.getByText("SALES-2026")).toBeVisible();
      await expect(page.getByText("Money collected")).toBeVisible();

      // October was calculated and posted by the seed
      const row = page.getByRole("row").filter({ hasText: "2026-10" });
      await expect(row).toBeVisible();
      await expect(row.getByText("Posted to payroll")).toBeVisible();
      await row.first().click();

      // each line keeps the receipts it came from, and says it reached payroll
      await expect(
        page.getByRole("heading", { name: /What each salesperson earned/ }),
      ).toBeVisible();
      await expect(page.getByText(/Receipts: \d/).first()).toBeVisible();
      await expect(page.getByText("In payroll").first()).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("the Gate 3 report counts what the pilot has run, and says what it has not", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/gate-3");
      await expect(
        page.getByRole("heading", { name: "Gate 3 report" }),
      ).toBeVisible();
      // the demo company has sold, collected, run an appraisal cycle and posted commission
      await expect(
        page.getByRole("row").filter({ hasText: "appraisal cycle" }),
      ).toBeVisible();
      await expect(page.getByText("Met").first()).toBeVisible();
      // and the page never rounds up: it shows how many checks are met
      await expect(page.getByText(/checks met|Every check is met/)).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("Sales user (Rafi)", () => {
    test.use({ storageState: USERS.rafi.state });

    test("sees his own commission months, not the company's run", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/sales/commission");
      await expect(
        page.getByRole("heading", { name: "My commission" }),
      ).toBeVisible();
      await expect(
        page.getByRole("row").filter({ hasText: "2026-10" }),
      ).toBeVisible();
      // the scheme and the run belong to HR's screen, not his
      await expect(
        page.getByRole("heading", { name: "Commission scheme" }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test("the sales assistant scores his lead and drafts a message he sends himself", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/crm/leads");
      await page.getByRole("row").filter({ hasText: "Nasrin Akter" }).click();
      await expect(
        page.getByRole("heading", { name: "Sales assistant" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Score this lead" }).click();
      await expect(page.getByText(/Score: \d+/)).toBeVisible();

      await page.getByLabel("Sales assistant").selectOption("follow_up");
      await page
        .getByRole("button", { name: "Draft a follow-up message" })
        .click();
      await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
});

test.describe("Performance (WP30)", () => {
  test.describe("HR (Farzana)", () => {
    test.use({ storageState: USERS.farzana.state });

    test("the cycle in calibration, the spread per department, and the proposal it led to", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/performance/cycles");
      await expect(
        page.getByRole("heading", { name: "Appraisal cycles" }),
      ).toBeVisible();
      await page.getByRole("row").filter({ hasText: "2025-26 annual" }).click();

      // calibration is HR's own screen: the spread of ratings per department
      await expect(
        page.getByRole("heading", { name: "Calibration across departments" }),
      ).toBeVisible();
      await expect(
        page.getByRole("row").filter({ hasText: "Sales Dhaka" }),
      ).toBeVisible();

      // Rafi's appraisal carries both numbers: the manager's 4 and HR's calibrated 3
      await page.getByRole("link", { name: /Rafi/ }).first().click();
      await expect(page.getByText("Weighted score")).toBeVisible();
      await expect(page.getByText("Calibrated", { exact: false }).first()).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Increments & promotions" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("the proposals list shows the increment waiting for the MD", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/performance/proposals");
      const row = page
        .getByRole("row")
        .filter({ hasText: "Mahmudul Hasan Rafi" });
      await expect(row).toBeVisible();
      await expect(row.getByText("Waiting for the Admin")).toBeVisible();
      // it cannot be applied until the Admin approves: no Apply button yet
      await expect(row.getByRole("button", { name: "Apply it" })).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });

  test.describe("Dept Head (Tanvir)", () => {
    test.use({ storageState: USERS.tanvir.state });

    test("his team's appraisals, and the rating he gave with its goals", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/performance/team");
      await expect(
        page.getByRole("heading", { name: "My team’s appraisals" }),
      ).toBeVisible();
      const row = page.getByRole("row").filter({ hasText: "Rafi" });
      await expect(row).toBeVisible();
      await row.first().click();
      await expect(page.getByText("Collection of dues within 45 days")).toBeVisible();
      await expect(page.getByText("Weights")).toBeVisible();
      // the feedback he wrote during the year is on the same page
      await expect(page.getByText(/Khatunganj/)).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("Employee (Rafi)", () => {
    test.use({ storageState: USERS.rafi.state });

    test("sees his own self-review and only the feedback shared with him", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/performance/cycles");
      await page.getByRole("row").filter({ hasText: "2025-26 annual" }).click();
      await page.getByRole("link", { name: /Rafi/ }).first().click();
      await expect(page.getByRole("heading", { name: "Self-review" })).toBeVisible();
      await expect(page.getByText(/আদায় ভালো হয়েছে|Collection/)).toBeVisible();
      // the concern note was not shared with him
      await expect(page.getByText(/Route reports were missing/)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
});

test.describe("Hiring (WP29)", () => {
  test.describe("HR (Farzana)", () => {
    test.use({ storageState: USERS.farzana.state });

    test("the opening, its applicants, and a blind CV screening with reasons", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/hiring/openings");
      await expect(
        page.getByRole("heading", { name: "Job openings" }),
      ).toBeVisible();
      const row = page
        .getByRole("row")
        .filter({ hasText: "Sales Executive (Dhaka north)" });
      await expect(row).toBeVisible();
      await row.first().click();

      // the post as advertised, and the three applicants
      await expect(page.getByText("Retail sales experience")).toBeVisible();
      await expect(
        page.getByRole("row").filter({ hasText: "Rakib Hasan" }),
      ).toBeVisible();

      // screen the applicant who has not been screened yet
      await page.getByRole("row").filter({ hasText: "Rakib Hasan" }).click();
      await expect(
        page.getByRole("heading", { name: "CV screening" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Screen the CV" }).click();
      await expect(page.getByText("Removed before the model saw the CV")).toBeVisible();
      // the reasons are shown next to the score, which is the point of the feature
      await expect(page.getByText(/No evidence for|evidence for/)).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("the manpower plan is approved and cannot be edited", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/hiring/plan");
      await expect(
        page.getByRole("heading", { name: "Manpower plan" }),
      ).toBeVisible();
      await expect(page.getByText("Approved").first()).toBeVisible();
      // HR may read the plan but not change it: no save form for them
      await expect(
        page.getByRole("button", { name: "Save the plan" }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });

  test.describe("Dept Head (Tanvir)", () => {
    test.use({ storageState: USERS.tanvir.state });

    test("his own post request, and the interview he is on the panel of", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/hiring/positions");
      await expect(
        page.getByRole("row").filter({ hasText: /NP\/2026-27/ }).first(),
      ).toBeVisible();
      await page
        .getByRole("row")
        .filter({ hasText: /NP\/2026-27/ })
        .first()
        .click();
      await expect(page.getByText("In the plan")).toBeVisible();
      await expect(page.getByText("What the plan says")).toBeVisible();

      await page.goto("/portal/hiring/interviews");
      await expect(
        page.getByRole("heading", { name: "My interviews" }),
      ).toBeVisible();
      await expect(page.getByText("Given").first()).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
});

test.describe("Support tickets and Customer 360 (WP28)", () => {
  test.describe("Sales user (Rafi)", () => {
    test.use({ storageState: USERS.rafi.state });

    test("his ticket, the customer's answer recorded, the SLA clock shown", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/support/tickets");
      await expect(
        page.getByRole("heading", { name: "Customer tickets" }),
      ).toBeVisible();
      const row = page.getByRole("row").filter({ hasText: "Meghna Dealers" });
      await expect(row).toBeVisible();
      // Mitu's tickets are not his
      await expect(
        page.getByRole("row").filter({ hasText: "Sylhet Agro" }),
      ).toHaveCount(0);

      await row.first().click();
      await expect(page.getByText("Two cans leaked")).toBeVisible();
      await expect(page.getByRole("heading", { name: "SLA" })).toBeVisible();
      await expect(page.getByText("First response")).toBeVisible();

      // it is waiting for the customer: record what they answered
      const answer = `Photo sent on WhatsApp (${Date.now() % 100000})`; // runs repeat on the demo data
      await page
        .getByRole("button", { name: "Record the customer’s answer" })
        .click();
      await page.getByLabel("From the customer").fill(answer);
      await page
        .getByRole("button", { name: "Record the customer’s answer" })
        .last()
        .click();
      await expect(page.getByText(answer)).toBeVisible();
      await expect(page.getByText("Being worked").first()).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("Accounts (Sujit)", () => {
    test.use({ storageState: USERS.sujit.state });

    test("Customer 360 shows the money, and says plainly what it may not show", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/crm/customers");
      await page.getByRole("row").filter({ hasText: "Meghna Dealers" }).click();
      await page.getByRole("link", { name: "Customer 360" }).click();
      await expect(
        page.getByRole("heading", { name: "What they owe" }),
      ).toBeVisible();
      // Accounts holds no support permission: the tickets block is absent, not empty
      await expect(
        page.getByText("You do not have access to this part."),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
});

test.describe("CRM: opportunities, pipeline and targets (WP24)", () => {
  test.describe("Sales user (Rafi)", () => {
    test.use({ storageState: USERS.rafi.state });

    test("his board, a new opportunity moved on and closed, with its history", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/crm/opportunities");
      const board = page.getByRole("list", { name: "Pipeline board" });
      await expect(
        board
          .getByRole("listitem", { name: "Negotiation" })
          .getByText("Soybean oil 1 L, Eid stock"),
      ).toBeVisible();
      await expect(
        board.getByText("Kitchen oil, 12-month canteen contract"),
      ).toHaveCount(0); // Mitu's

      const title = `Rice bran oil 1 L trial ${Date.now() % 100000}`; // runs repeat on the demo data
      await page.getByRole("button", { name: "New opportunity" }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("combobox", { name: "Customers" })
        .selectOption({ label: "C-00001 · Karim Stores" });
      await dialog.getByLabel("What they may buy").fill(title);
      await dialog.getByLabel("Value (Tk)").fill("150000");
      await dialog.getByLabel("Expected close").fill("2026-12-15");
      await dialog.getByRole("button", { name: "New opportunity" }).click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();

      await page.getByRole("button", { name: "Move stage" }).click();
      await page
        .getByRole("dialog")
        .getByRole("combobox", { name: "Stage" })
        .selectOption({ label: "Quotation sent · 50%" });
      await page
        .getByRole("dialog")
        .getByLabel("Note")
        .fill("Price list sent on WhatsApp");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Move stage" })
        .click();
      await expect(
        page.getByText("Prospecting → Quotation sent"),
      ).toBeVisible();
      await expect(page.getByText("Price list sent on WhatsApp")).toBeVisible();

      // closed again, so the demo pipeline stays as it was
      await page.getByRole("button", { name: "Mark lost" }).click();
      await page
        .getByRole("dialog")
        .getByRole("combobox", { name: "Why lost?" })
        .selectOption("no_response");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Mark lost" })
        .click();
      await expect(
        page.getByRole("button", { name: "Open again" }),
      ).toBeVisible();
      await expect(page.getByText("No response")).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("Sales head (Tanvir)", () => {
    test.use({ storageState: USERS.tanvir.state });

    test("the weighted forecast and his team's targets", async ({ page }) => {
      const errors = await open(page, "/portal/crm/forecast");
      await expect(
        page.getByRole("heading", { name: "Weighted forecast" }),
      ).toBeVisible();
      await page.getByLabel("Month").fill("2026-11");
      const targets = page.getByRole("row");
      await expect(
        targets
          .filter({ hasText: "Mahmudul Hasan Rafi" })
          .filter({ hasText: "15,00,000.00" }),
      ).toBeVisible();
      await expect(
        targets
          .filter({ hasText: "Sharmin Sultana Mitu" })
          .filter({ hasText: "12,00,000.00" }),
      ).toBeVisible();
      await expect(
        targets
          .filter({ hasText: "Department" })
          .filter({ hasText: "40,00,000.00" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Department target" }),
      ).toHaveCount(0); // the Admin's
      expect(errors).toEqual([]);
    });
  });

  test.describe("Admin (Anisur)", () => {
    test.use({ storageState: USERS.anisur.state });

    test("the pipeline stages, with what sits in each", async ({ page }) => {
      const errors = await open(page, "/portal/crm/territories");
      await expect(
        page.getByRole("heading", { name: "Pipeline stages" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Negotiation" })
          .filter({ hasText: "70%" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "New stage" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
});

test.describe("Sales: quotations, orders, invoices, receipts (WP25-WP27)", () => {
  test.describe("Sales user (Rafi)", () => {
    test.use({ storageState: USERS.rafi.state });

    test("a quotation priced from the dealer list; one above his limit waits for approval", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/sales/quotations?state=");
      await page.getByRole("combobox", { name: "Status" }).selectOption("");
      await page
        .getByRole("row")
        .filter({ hasText: "Meghna Dealers" })
        .first()
        .click();
      await expect(page.getByText("Above the limit")).toBeVisible();
      await expect(page.getByRole("status")).toContainText(
        "the Sales head and the Admin approve",
      );

      await open(page, "/portal/sales/quotations");
      await page.getByRole("button", { name: "New quotation" }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("combobox", { name: "Customer" })
        .selectOption({ label: "C-00002 · Meghna Dealers" });
      await dialog.getByLabel("Valid until").fill("2026-12-31");
      await dialog
        .getByRole("combobox", { name: "Product 1" })
        .selectOption({ label: "MUS-500 · Mustard oil 500 ml bottle" });
      await dialog.getByRole("textbox", { name: "Quantity 1" }).fill("100");
      await dialog.getByRole("textbox", { name: "Discount % 1" }).fill("2");
      await dialog.getByRole("button", { name: "New quotation" }).click();
      // dealer price Tk 118 less 2%: 11,564 + 15% VAT
      await expect(page.getByText("13,298.60").first()).toBeVisible();
      await page.getByRole("button", { name: "Submit" }).click();
      await expect(page.getByText("Approved", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click(); // the demo keeps its pipeline
      await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("Sales head (Tanvir)", () => {
    test.use({ storageState: USERS.tanvir.state });

    test("the discount above Rafi's limit is in his approvals", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/approvals");
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Discount above the limit" })
          .filter({ hasText: "Meghna Dealers" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("Accounts (Sujit)", () => {
    test.use({ storageState: USERS.sujit.state });

    test("invoices, what is still owed, the order over its credit limit, aging by account manager", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/sales/invoices");
      await page
        .getByRole("row")
        .filter({ hasText: "Karim Stores" })
        .first()
        .click();
      await expect(page.getByText("2,08,480.00").first()).toBeVisible(); // 4,08,480 less the 2 lakh cheque
      await expect(
        page.getByRole("button", { name: "Credit note" }),
      ).toBeVisible();
      await page.goto("/portal/sales/orders");
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Sylhet Agro Ltd" })
          .filter({ hasText: "Credit approval" }),
      ).toBeVisible();
      await page.goto("/portal/receivables");
      await page
        .getByRole("combobox", { name: "By customer" })
        .selectOption("manager");
      await expect(
        page.getByText("Sharmin Sultana Mitu").first(),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
});

test.describe("Sales stock (2026-10-31)", () => {
  test.use({ storageState: USERS.sujit.state });

  test("products show the stock item they are kept as; the depot holds the oils", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/sales/catalogue");
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: "RBO-5L" })
        .getByText("FG-RBO-5L"),
    ).toBeVisible();
    await page
      .getByRole("row")
      .filter({ hasText: "Rice bran oil 5 L can" })
      .first()
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("combobox", { name: "Kept in store as" }),
    ).toHaveValue(/.+/);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .click();
    expect(errors).toEqual([]);
  });
});
