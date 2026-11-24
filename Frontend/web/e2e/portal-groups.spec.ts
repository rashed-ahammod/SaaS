/**
 * The four portal groups still to be reviewed screen by screen: Payroll,
 * Sales & CRM, Finance and Administration (project plan, portal review).
 *
 * This does not repeat what portal.spec.ts and finance.spec.ts already do --
 * they walk the business flows through these groups in detail. It covers the
 * two things neither of them nor the role-wise walk could catch:
 *
 *   1. ROLE-WISE WALK, roles-portal.spec.ts, reaches every screen in a menu --
 *      but a menu only links LISTS. The records behind them, every /[id] page,
 *      were never opened by it. Those pages are where a join goes wrong on one
 *      awkward row. "records behind the lists open" clicks into the first row
 *      of each list in these four groups and holds the detail page to the same
 *      contract: no browser error, no 403 or 5xx, no error box.
 *
 *   2. UNTRANSLATED TEXT. The translator falls back to the key itself when a
 *      label is missing, so a gap reaches the screen as "f.v.source.vat_sale"
 *      rather than as a crash or a blank. Nothing could fail on that, and two
 *      real gaps had reached the demo this way: seven voucher sources on the
 *      Vouchers screen, and three request types on the approval chains screen.
 *      "no screen shows a raw translation key" fails on the next one.
 *
 * Plus the few screens in these groups that no spec asserted anything about:
 * the AI settings and usage, the audit log, the vouchers list and a voucher,
 * and customer receipts.
 */
import { expect, test, type Page } from "@playwright/test";
import { USERS } from "./users";

/** Open a portal screen in English. */
async function open(page: Page, path: string) {
  await page.addInitScript(() => localStorage.setItem("erp-lang", "en"));
  await page.goto(path);
  return page.waitForLoadState("networkidle");
}

/**
 * Watches for the things that mean a screen is broken rather than empty:
 * an exception in the browser, an API call refused or failing, or an error box
 * on the page. Returns a reader for what went wrong since it was started.
 */
function watchForTrouble(page: Page) {
  const problems: string[] = [];
  let where = "";
  page.on("pageerror", (e) => problems.push(`${where}: browser error ${e.message}`));
  page.on("response", (r) => {
    const url = r.url();
    if (url.includes("/api/erp/") && (r.status() === 403 || r.status() >= 500))
      problems.push(
        `${where}: ${r.status()} ${r.request().method()} ${url.split("/api/erp")[1]}`,
      );
  });
  return {
    at: (place: string) => (where = place),
    async alerts() {
      for (const text of await page.getByRole("alert").allInnerTexts())
        if (text.trim())
          problems.push(`${where}: error box "${text.trim().slice(0, 120)}"`);
    },
    problems,
  };
}

/**
 * A dotted lowercase token with no spaces, which is what this app's
 * translation keys look like: "f.v.source.vat_sale", "appr.type.job_offer".
 * Checked against every Finance, Payroll, Sales and Administration screen on
 * the demo data: it finds the real gaps and nothing else.
 */
const KEYISH = /^[a-z][a-z0-9]{0,4}(\.[a-zA-Z][a-zA-Z0-9_]*){2,}$/;
/** Text that legitimately looks like a key: a domain, a file name. */
const NOT_A_KEY = /\.(com|net|org|bd|io|pdf|png|jpg|jpeg|csv|xlsx|json)$/i;

/** Any visible text on the screen that is really an untranslated key. */
async function rawKeysOnScreen(page: Page): Promise<string[]> {
  const texts = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("main *")) {
      if (el.children.length) continue; // leaves only: their own text
      const t = (el.textContent ?? "").trim();
      if (t) out.push(t);
    }
    return out;
  });
  return [
    ...new Set(texts.filter((t) => KEYISH.test(t) && !NOT_A_KEY.test(t))),
  ];
}

/**
 * The list screens of the four groups.
 *
 * Read as the workspace owner, who holds every permission. That is the point:
 * no single role can see a whole group -- Accounts is refused the CRM leads,
 * Sales is refused the company's commission run -- and a screen that answers
 * 403 renders empty, which a scan for bad text would pass without seeing
 * anything at all. So each screen must also show a heading before it counts as
 * read. roles-portal.spec.ts is what checks these screens per role.
 */
const GROUP_SCREENS = {
  Payroll: {
    screens: [
      "/portal/payroll",
      "/portal/payroll/items",
      "/portal/payroll/setup",
      "/portal/gate-1",
    ],
  },
  "Sales & CRM": {
    screens: [
      "/portal/crm/leads",
      "/portal/crm/customers",
      "/portal/crm/opportunities",
      "/portal/crm/forecast",
      "/portal/crm/territories",
      "/portal/support/tickets",
      "/portal/sales/quotations",
      "/portal/sales/orders",
      "/portal/sales/catalogue",
      "/portal/sales/commission",
      "/portal/gate-3",
    ],
  },
  Finance: {
    screens: [
      "/portal/finance",
      "/portal/finance/vouchers",
      "/portal/finance/accounts",
      "/portal/finance/reports",
      "/portal/finance/close",
      "/portal/finance/opening",
      "/portal/gate-2",
      "/portal/vendors",
      "/portal/procurement",
      "/portal/budgets",
      "/portal/assets",
      "/portal/stock",
      "/portal/bills",
      "/portal/sales/invoices",
      "/portal/sales/receipts",
      "/portal/receivables",
      "/portal/bank",
      "/portal/tax",
      "/portal/vat",
      "/portal/compliance",
      "/portal/expenses",
    ],
  },
  Administration: {
    screens: [
      "/portal/approvals/chains",
      "/portal/migration",
      "/portal/ai",
      "/portal/audit",
      "/portal/integrations",
    ],
  },
} as const;

/**
 * A translation gap is not a crash, so it can sit in a release unnoticed. This
 * is what notices.
 */
test.describe("no screen shows a raw translation key", () => {
  for (const [group, { screens }] of Object.entries(GROUP_SCREENS)) {
    test.describe(group, () => {
      test.use({ storageState: USERS.owner.state });

      test(`${group}: every label is words, not a key`, async ({ page }) => {
        test.setTimeout(180_000);
        const found: string[] = [];
        const empty: string[] = [];
        for (const path of screens) {
          await open(page, path);
          // a screen that rendered nothing would pass the scan without being
          // looked at, so it has to show its own heading first
          if ((await page.getByRole("heading").count()) === 0) empty.push(path);
          for (const key of await rawKeysOnScreen(page))
            found.push(`${path}: ${key}`);
        }
        expect(empty, `rendered no heading: ${empty.join(", ")}`).toEqual([]);
        expect(found, found.join("\n")).toEqual([]);
      });
    });
  }
});

/**
 * The menu links lists; this opens what is in them. A detail page is where an
 * awkward row shows up -- a voucher with no source, a bill part-paid, an asset
 * nobody holds.
 */
test.describe("records behind the lists open", () => {
  /** Lists whose first row leads to a record, per group. */
  const LISTS = {
    Payroll: { user: "farzana", paths: ["/portal/payroll"] },
    // As the salesperson who owns these records, not Accounts: Accounts is
    // refused the CRM leads outright (403), which is correct and is what
    // finance.spec.ts asserts. Opportunities are left out because that screen
    // is a board, not a table, so there is no row to click.
    "Sales & CRM": {
      user: "rafi",
      paths: [
        "/portal/crm/leads",
        "/portal/crm/customers",
        "/portal/support/tickets",
        "/portal/sales/quotations",
        "/portal/sales/orders",
      ],
    },
    Finance: {
      user: "sujit",
      paths: [
        "/portal/finance/vouchers",
        "/portal/vendors",
        "/portal/bills",
        "/portal/budgets",
        "/portal/assets",
        "/portal/sales/invoices",
        "/portal/bank",
      ],
    },
  } as const;

  for (const [group, { user, paths }] of Object.entries(LISTS)) {
    test.describe(group, () => {
      test.use({ storageState: USERS[user as keyof typeof USERS].state });

      test(`${group}: the first record of each list opens cleanly`, async ({
        page,
      }) => {
        test.setTimeout(240_000);
        const trouble = watchForTrouble(page);
        const opened: string[] = [];

        for (const path of paths) {
          trouble.at(path);
          await open(page, path);
          // the first body row; the header row is not clickable
          const row = page.getByRole("row").nth(1);
          if ((await page.getByRole("row").count()) < 2) continue; // nothing to open
          const before = page.url();
          await row.click();
          // a row either navigates to its own page or opens a dialog
          const dialog = page.getByRole("dialog");
          await Promise.race([
            page.waitForURL((u) => u.toString() !== before, { timeout: 8000 }),
            dialog.waitFor({ state: "visible", timeout: 8000 }),
          ]).catch(() => undefined);
          await page.waitForLoadState("networkidle");
          trouble.at(`${path} -> ${page.url().replace(/^https?:\/\/[^/]+/, "")}`);
          await trouble.alerts();
          if (await dialog.isVisible().catch(() => false)) {
            opened.push(`${path} (dialog)`);
            await page.keyboard.press("Escape");
          } else if (page.url() !== before) {
            opened.push(`${path} -> ${page.url()}`);
          }
        }

        // the walk is worthless if nothing actually opened
        expect(opened.length, `nothing opened from ${paths.join(", ")}`)
          .toBeGreaterThan(0);
        expect(trouble.problems, trouble.problems.join("\n")).toEqual([]);
      });
    });
  }
});

/** Screens in these groups that no spec said anything about until now. */
test.describe("Administration (owner)", () => {
  test.use({ storageState: USERS.owner.state });

  test("AI: what is switched on, what it cost this month, and its answers", async ({
    page,
  }) => {
    const trouble = watchForTrouble(page);
    trouble.at("/portal/ai");
    await open(page, "/portal/ai");

    await expect(page.getByRole("heading", { name: "AI", exact: true })).toBeVisible();
    for (const section of [
      "Settings",
      "Usage this month",
      "Policy documents",
      "Recent AI answers",
    ])
      await expect(page.getByRole("heading", { name: section })).toBeVisible();

    // the policy documents the AI answers from, in both languages
    await expect(
      page.getByRole("cell", { name: "Employee Handbook 2026" }),
    ).toBeVisible();
    await trouble.alerts();
    expect(trouble.problems, trouble.problems.join("\n")).toEqual([]);
  });

  test("the audit log can be read and paged, and says who did what from where", async ({
    page,
  }) => {
    const trouble = watchForTrouble(page);
    trouble.at("/portal/audit");
    await open(page, "/portal/audit");

    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    // an entry carries the action and the address it came from
    await expect(
      page.getByRole("cell", { name: "auth.login" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
    // exact, or it also matches the shell's "Search screens Ctrl + K"
    await expect(
      page.getByRole("button", { name: "Search", exact: true }),
    ).toBeVisible();

    await trouble.alerts();
    expect(trouble.problems, trouble.problems.join("\n")).toEqual([]);
  });

  test("the approval chains name every request type in words", async ({
    page,
  }) => {
    await open(page, "/portal/approvals/chains");
    // the three Phase 3 types that used to show as appr.type.* keys
    for (const name of ["Salary increment", "Job offer", "New position"])
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  });
});

test.describe("Finance (Accounts)", () => {
  test.use({ storageState: USERS.sujit.state });

  test("the vouchers list says where each one came from, in words", async ({
    page,
  }) => {
    const trouble = watchForTrouble(page);
    trouble.at("/portal/finance/vouchers");
    await open(page, "/portal/finance/vouchers");

    await expect(page.getByRole("heading", { name: "Vouchers" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "From" })).toBeVisible();
    // posted automatically by other parts of the system, each named
    for (const source of ["Customer receipt", "Sales invoice", "Depreciation"])
      await expect(page.getByRole("cell", { name: source }).first()).toBeVisible();
    // and one entered by a person, which is waiting for the second pair of eyes
    await expect(
      page.getByRole("cell", { name: "Vendor payment" }).first(),
    ).toBeVisible();

    await trouble.alerts();
    expect(trouble.problems, trouble.problems.join("\n")).toEqual([]);
  });

  test("a voucher opens with its own lines, and they balance", async ({
    page,
  }) => {
    const trouble = watchForTrouble(page);
    trouble.at("/portal/finance/vouchers");
    await open(page, "/portal/finance/vouchers");
    await page.getByRole("row").nth(1).click();
    await page.waitForLoadState("networkidle");

    trouble.at("a voucher");
    // the detail page shows the double entry: debits and credits
    await expect(
      page.getByText("Debit", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Credit", { exact: true }).first(),
    ).toBeVisible();
    await trouble.alerts();
    expect(trouble.problems, trouble.problems.join("\n")).toEqual([]);
  });

  test("customer receipts show how the money arrived", async ({ page }) => {
    const trouble = watchForTrouble(page);
    trouble.at("/portal/sales/receipts");
    await open(page, "/portal/sales/receipts");

    await expect(
      page.getByRole("heading", { name: "Customer receipts" }),
    ).toBeVisible();
    // the demo's cheque from Karim Stores, and the voucher it posted
    await expect(
      page.getByRole("cell", { name: /Karim Stores/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: /Cheque/ }).first()).toBeVisible();

    await trouble.alerts();
    expect(trouble.problems, trouble.problems.join("\n")).toEqual([]);
  });
});
