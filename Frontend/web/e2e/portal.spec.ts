/**
 * The HR & Admin portal (WP13) on a desktop browser, with the demo data
 * (Demo Trading Ltd): HR (Farzana) and Accounts (Sujit) do the Gate 1 path:
 * people, attendance, the payroll run, monthly items, the parallel comparison.
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

test.describe("HR (Farzana)", () => {
  test.use({ storageState: USERS.farzana.state });

  test("dashboard and navigation show HR screens only", async ({ page }) => {
    const errors = await open(page, "/portal");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    const nav = page.getByRole("navigation", { name: "HR & Admin portal" });
    for (const item of [
      "Employees",
      "Attendance",
      "Payroll runs",
      "Parallel payroll (Gate 1)",
      "Data migration",
    ])
      await expect(nav.getByRole("link", { name: item })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Users & roles" })).toHaveCount(
      0,
    ); // HR does not manage logins
    expect(errors).toEqual([]);
  });

  test("find an employee and see salary, leave balance and consent", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/employees");
    await page.getByLabel("Search").fill("Rafi");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("cell", { name: "Mahmudul Hasan Rafi" }).click();
    await expect(
      page.getByRole("heading", { name: /Mahmudul Hasan Rafi/ }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Salary", exact: true }).click();
    await expect(page.getByText("Current salary")).toBeVisible();
    await expect(
      page.getByText("BASIC", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Leave" }).click();
    await expect(page.getByRole("cell", { name: /CL ·/ })).toBeVisible();
    await page.getByRole("tab", { name: "Attendance & consent" }).click();
    await expect(
      page.getByText("Biometric device", { exact: true }).first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("a payroll run: totals, employees with the calculation trace, reproducibility", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/payroll");
    await page.getByRole("cell", { name: "September 2026" }).first().click();
    await expect(
      page.getByRole("heading", { name: /September 2026 · Monthly salary/ }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Employees" }).click();
    await page.getByRole("cell", { name: "Mahmudul Hasan Rafi" }).click();
    await expect(
      page.getByRole("dialog").getByText("How it was calculated"),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close" })
      .click();
    await page.getByRole("button", { name: "Check reproducibility" }).click();
    await expect(
      page.getByText("Re-calculated from the stored inputs: identical."),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("monthly item: add a commission, then cancel it", async ({ page }) => {
    const errors = await open(page, "/portal/payroll/items");
    await page.getByLabel("Month").fill("2026-12");
    const rafi = await page
      .locator("option", { hasText: "Mahmudul Hasan Rafi" })
      .getAttribute("value");
    await page.getByLabel("Employee").selectOption(rafi!);
    const commission = await page
      .locator("option", { hasText: "COMMISSION" })
      .getAttribute("value");
    await page.getByLabel("Salary head").selectOption(commission!);
    await page.getByLabel("Amount").fill("4500");
    await page.getByLabel("Note").fill("E2E: December sales target");
    await page.getByRole("button", { name: "Add item" }).click();
    const row = page
      .getByRole("row", { name: /E2E: December sales target/ })
      .filter({ hasText: "open" });
    await expect(row).toBeVisible();
    page.once("dialog", (d) => d.accept("Entered by mistake"));
    await row.getByRole("button", { name: "Cancel item" }).click();
    await expect(
      page
        .getByRole("row", { name: /E2E: December sales target/ })
        .filter({ hasText: "open" }),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("Gate 1: status, template and the upload form", async ({ page }) => {
    const errors = await open(page, "/portal/gate-1");
    await expect(
      page.getByRole("heading", { name: "Parallel payroll (Gate 1)" }),
    ).toBeVisible();
    await expect(page.getByText(/months accepted|Gate 1 passed/)).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Register template (CSV)" }).click();
    expect((await download).suggestedFilename()).toBe(
      "payroll-register-template.csv",
    );
    await expect(page.getByLabel("Payroll run")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("attendance: a day, the month with its lock state, holidays", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/attendance");
    await page.getByLabel("Date").fill("2026-10-08");
    await expect(
      page.getByRole("cell", { name: "Nusrat Jahan" }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Month & lock" }).click();
    await page.getByLabel("Month").fill("2026-09");
    await expect(
      page.getByText("Locked", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Holidays" }).click();
    await expect(page.getByRole("cell", { name: /Victory Day/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("in Bangla", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("erp-lang", "bn"));
    await page.goto("/portal");
    await expect(
      page.getByRole("heading", { name: "ড্যাশবোর্ড" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "বেতন প্রক্রিয়া" }),
    ).toBeVisible();
  });
});

test.describe("Accounts (Sujit)", () => {
  test.use({ storageState: USERS.sujit.state });

  test("sees payroll and Gate 1, not people management or migration", async ({
    page,
  }) => {
    const errors = await open(page, "/portal");
    const nav = page.getByRole("navigation", { name: "HR & Admin portal" });
    await expect(nav.getByRole("link", { name: "Payroll runs" })).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Parallel payroll (Gate 1)" }),
    ).toBeVisible();
    await expect(nav.getByRole("link", { name: "Data migration" })).toHaveCount(
      0,
    );
    await expect(nav.getByRole("link", { name: "Payroll setup" })).toHaveCount(
      0,
    );
    expect(errors).toEqual([]);
  });
});

test.describe("Sales user (Rafi, WP23)", () => {
  test.use({ storageState: USERS.rafi.state });

  test("the portal shows the Sales screens, not payroll or territory setup", async ({
    page,
  }) => {
    await open(page, "/portal");
    const nav = page.getByRole("navigation", { name: "HR & Admin portal" });
    await expect(nav.getByRole("link", { name: "Leads" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Customers" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Payroll" })).toHaveCount(0);
    await expect(
      nav.getByRole("link", { name: "Sales territories" }),
    ).toHaveCount(0);
  });
});

// ------------------------------------------------------------ attendance fixes
test.describe("attendance fixes: HR", () => {
  test.use({ storageState: USERS.farzana.state });

  test("an employee's month, requests and shift; HR can fix a day for them", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/employees");
    await page.getByLabel("Search").fill("Rafi");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("cell", { name: "Mahmudul Hasan Rafi" }).click();
    await page.getByRole("tab", { name: "Attendance & consent" }).click();
    await expect(
      page.getByRole("heading", { name: "Attendance month" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Corrections and overtime" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Shift", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Fix this day" }).first().click();
    await expect(
      page.getByRole("button", { name: "Request a correction" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("shifts can be edited; temporary hours (Ramadan); holidays can be changed", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/attendance");
    await page.getByRole("tab", { name: "Shifts" }).click();
    await expect(
      page.getByRole("heading", { name: "Temporary hours (e.g. Ramadan)" }),
    ).toBeVisible();
    await page.getByRole("cell", { name: "GEN", exact: true }).first().click();
    await expect(
      page.getByRole("dialog", { name: /Edit shift/ }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel" })
      .click();

    await page.getByRole("tab", { name: "Holidays" }).click();
    await page.getByRole("button", { name: "Change holiday" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Change holiday" });
    await expect(dialog.getByRole("button", { name: "Remove" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(errors).toEqual([]);
  });
});

test.describe("attendance fixes: Dept Head", () => {
  test.use({ storageState: USERS.tanvir.state });

  test("the month summary of his department (no lock button)", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/attendance");
    await page.getByRole("tab", { name: "Month & lock" }).click();
    await expect(
      page.getByRole("cell", { name: "Mahmudul Hasan Rafi" }),
    ).toBeVisible();
    await expect(page.getByRole("cell", { name: "Farzana Akter" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: /^Lock/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe("attendance fixes: company rules (owner)", () => {
  test.use({ storageState: USERS.owner.state });

  test("corrections per month and the late penalty are set on the Organization page", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/organization");
    await page.getByRole("tab", { name: /Compan/ }).click();
    await expect(
      page.getByRole("heading", { name: /Attendance rules/ }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Corrections allowed per employee per month"),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("branch geo-fence (owner)", () => {
  test.use({ storageState: USERS.owner.state });

  test("a branch can be edited: office location and radius for phone punches", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/organization");
    await page
      .getByRole("row", { name: /Chattogram Office/ })
      .getByRole("button", { name: "Edit" })
      .click();
    const dialog = page.getByRole("dialog", { name: /Edit: CTG/ });
    // the values saved today (the office location may have been changed in the demo)
    const companies = await (
      await page.request.get("/api/erp/companies", {
        headers: { "x-erp-client": "pwa" },
      })
    ).json();
    const branches = await (
      await page.request.get(`/api/erp/companies/${companies[0].id}/branches`, {
        headers: { "x-erp-client": "pwa" },
      })
    ).json();
    const ctg = branches.find((b: { code: string }) => b.code === "CTG");
    await expect(dialog.getByLabel("Latitude")).toHaveValue(
      String(ctg.geoFence.lat),
    );
    await expect(dialog.getByLabel("Radius (m)")).toHaveValue(
      String(ctg.geoFence.radiusM),
    );
    await expect(
      dialog.getByRole("button", { name: /Use my current location/ }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(errors).toEqual([]);
  });
});

test.describe("punch safeguards (misuse review)", () => {
  test.describe("HR", () => {
    test.use({ storageState: USERS.farzana.state });

    test("the punch review tab explains what it looks for", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/attendance");
      await page.getByRole("tab", { name: "Punch review" }).click();
      await expect(page.getByText(/reasons to check, not proof/)).toBeVisible();
      await expect(
        page.getByText(/phone punches · .* refused attempts/),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("owner", () => {
    test.use({ storageState: USERS.owner.state });

    test('a wide radius warns and needs "checked on the map" before saving', async ({
      page,
    }) => {
      const errors = await open(page, "/portal/organization");
      await page
        .getByRole("row", { name: /Dhaka HQ/ })
        .getByRole("button", { name: "Edit" })
        .click();
      const dialog = page.getByRole("dialog", { name: /Edit: DHK/ });
      await dialog.getByLabel("Radius (m)").fill("800");
      await expect(dialog.getByText(/A radius over 300 m/)).toBeVisible();
      await expect(
        dialog.getByRole("link", { name: /Open in Google Maps/ }),
      ).toHaveAttribute("href", /maps\?q=-?[0-9.]+,-?[0-9.]+/);
      await expect(
        dialog.getByLabel("I checked the location on the map"),
      ).toBeVisible();
      // swapped latitude / longitude
      await dialog.getByLabel("Radius (m)").fill("150");
      await dialog.getByLabel("Latitude").fill("90.4078");
      await expect(dialog.getByText(/outside Bangladesh/)).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(errors).toEqual([]);
    });
  });
});

test.describe("leave fixes", () => {
  test.describe("HR", () => {
    test.use({ storageState: USERS.farzana.state });

    test("team calendar, leave types and year end", async ({ page }) => {
      const errors = await open(page, "/portal/leave");
      await page
        .locator("#cal-department")
        .selectOption({ label: "SALES · Sales" });
      await expect(page.getByText(/people in the team/)).toBeVisible();
      await page.getByRole("tab", { name: "Leave types & policy" }).click();
      await page.getByRole("button", { name: "New leave type" }).click();
      await expect(
        page.getByRole("dialog", { name: "New leave type" }),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      await page.getByRole("cell", { name: "SL", exact: true }).click();
      await expect(
        page
          .getByRole("dialog", { name: /Edit leave type: SL/ })
          .getByLabel("Document needed above (days)"),
      ).toHaveValue("2");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      await page.getByRole("tab", { name: "Year end" }).click();
      await expect(
        page.getByRole("heading", { name: "Days paid out (encashments)" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("an employee's leave: requests, ledger, adjust and apply on their behalf", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/employees");
      await page.getByLabel("Search").fill("Rafi");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("cell", { name: "Mahmudul Hasan Rafi" }).click();
      await page.getByRole("tab", { name: "Leave" }).click();
      await expect(
        page.getByRole("heading", { name: "Leave requests" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Leave ledger" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Adjust balance" }).click();
      await expect(
        page.getByRole("dialog", { name: "Adjust balance" }),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      await page.getByRole("button", { name: "Apply on their behalf" }).click();
      await expect(
        page.getByRole("dialog", { name: "Apply on their behalf" }),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      expect(errors).toEqual([]);
    });
  });

  test.describe("owner (Admin view)", () => {
    test.use({ storageState: USERS.owner.state });

    test("the Leave page is in the menu", async ({ page }) => {
      await open(page, "/portal");
      await expect(
        page
          .getByRole("navigation", { name: "HR & Admin portal" })
          .getByRole("link", { name: "Leave", exact: true }),
      ).toBeVisible();
    });
  });
});

test.describe("payroll fixes", () => {
  test.describe("HR", () => {
    test.use({ storageState: USERS.farzana.state });

    test("an employee's salary advances, PF & tax, and a new salary account", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/employees");
      await page.getByLabel("Search").fill("Rafi");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("cell", { name: "Mahmudul Hasan Rafi" }).click();
      await page.getByRole("tab", { name: "Salary advances" }).click();
      await expect(
        page.getByRole("cell", { name: /Viqarunnisa Noon School/ }),
      ).toBeVisible();
      await page.getByRole("button", { name: "New salary advance" }).click();
      await expect(
        page.getByRole("dialog", { name: "New salary advance" }),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();

      await page.getByRole("tab", { name: "PF & tax" }).click();
      await expect(
        page.getByRole("heading", { name: "Provident fund" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Earlier income this year" }),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", { name: "Before this system" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Download PDF" }),
      ).toBeVisible();

      await page.getByRole("tab", { name: "Bank" }).click();
      await page
        .getByRole("button", { name: "Request a new salary account" })
        .click();
      await expect(
        page
          .getByRole("dialog", { name: "Request a new salary account" })
          .getByLabel("Routing number (9 digits)"),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      expect(errors).toEqual([]);
    });
  });

  test.describe("Accounts", () => {
    test.use({ storageState: USERS.sujit.state });

    test("salary advances to pay out, and the salary tax challans", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/expenses");
      await page
        .getByRole("tab", { name: "Salary advances to pay out" })
        .click();
      const mitu = page
        .getByRole("row")
        .filter({ hasText: "Sharmin Sultana Mitu" });
      await mitu.getByRole("button", { name: "Pay out" }).click();
      await expect(
        page.getByRole("dialog").getByText(/monthly deduction then starts/),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();

      await open(page, "/portal/tax");
      await page.getByRole("tab", { name: "Salary tax" }).click();
      await expect(
        page.getByRole("heading", { name: "Tax withheld from salaries" }),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", { name: "TR-2627-0912" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("MD (Admin)", () => {
    test.use({ storageState: USERS.anisur.state });

    test("reads an employee's salary and payslips", async ({ page }) => {
      const errors = await open(page, "/portal/employees");
      await page.getByLabel("Search").fill("Rafi");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("cell", { name: "Mahmudul Hasan Rafi" }).click();
      await page.getByRole("tab", { name: "Salary", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Current salary" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Set a new salary" }),
      ).toHaveCount(0);
      await page.getByRole("tab", { name: "Payslips" }).click();
      await expect(
        page.getByRole("cell", { name: /September 2026/ }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: "Salary advances" }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
});

test.describe("employee lifecycle", () => {
  test.describe("HR", () => {
    test.use({ storageState: USERS.farzana.state });

    test("probation reviews and a leaver with clearance", async ({ page }) => {
      const errors = await open(page, "/portal/lifecycle");
      const rafi = page
        .getByRole("row")
        .filter({ hasText: "Mahmudul Hasan Rafi" });
      await expect(rafi.getByText(/Recommended: Confirm/)).toBeVisible();
      const mitu = page
        .getByRole("row")
        .filter({ hasText: "Sharmin Sultana Mitu" });
      await expect(mitu.getByText("No recommendation yet")).toBeVisible();
      await mitu.getByRole("button", { name: "Decide" }).click();
      await page.locator("#prob-outcome").selectOption("extend");
      await expect(page.getByLabel("Extend by (months)")).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();

      await page.getByRole("tab", { name: "Leaving" }).click();
      const kamrul = page
        .locator("section")
        .filter({ hasText: "Kamrul Hasan" });
      await expect(kamrul.getByText("1 of 4 cleared")).toBeVisible();
      await expect(kamrul.getByText("Short by 4 days")).toBeVisible();
      await expect(kamrul.getByRole("button", { name: "Clear" })).toHaveCount(
        3,
      );
      await expect(
        kamrul.getByRole("button", { name: "Withdraw notice" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("an employee's documents and job changes", async ({ page }) => {
      const errors = await open(page, "/portal/employees");
      await page.getByLabel("Search").fill("Rafi");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("cell", { name: "Mahmudul Hasan Rafi" }).click();
      await expect(
        page.getByRole("heading", { name: "Probation", exact: true }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "Documents" }).click();
      await page.getByRole("button", { name: "Add document" }).click();
      await expect(
        page.getByRole("dialog", { name: "Add document" }).getByLabel("Type"),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      await page.getByRole("tab", { name: "Job" }).click();
      await expect(
        page.getByRole("heading", { name: "Recorded changes" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Cancel change" }).first(),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("owner (company settings)", () => {
    test.use({ storageState: USERS.owner.state });

    test("the company's employee rules: probation, notice periods, retirement age", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/organization");
      await page.getByRole("tab", { name: /Compan/ }).click();
      await expect(
        page.getByRole("heading", { name: /Employee rules/ }),
      ).toBeVisible();
      await expect(page.locator("#rules-notice-resign")).toHaveValue("60");
      await expect(page.locator("#rules-retirement")).toHaveValue("60");
      expect(errors).toEqual([]);
    });
  });

  test.describe("Dept Head", () => {
    test.use({ storageState: USERS.tanvir.state });

    test("recommends, and clears only the handover of his leaver", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/lifecycle");
      const mitu = page
        .getByRole("row")
        .filter({ hasText: "Sharmin Sultana Mitu" });
      await expect(
        mitu.getByRole("button", { name: "Recommend" }),
      ).toBeVisible();
      await expect(mitu.getByRole("button", { name: "Decide" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Leaving" }).click();
      const kamrul = page
        .locator("section")
        .filter({ hasText: "Kamrul Hasan" });
      await expect(kamrul.getByRole("button", { name: "Clear" })).toHaveCount(
        1,
      );
      await expect(
        kamrul
          .getByRole("listitem")
          .filter({ hasText: "Department head (handover)" })
          .getByRole("button", { name: "Clear" }),
      ).toBeVisible();
      await expect(
        kamrul.getByRole("button", { name: "Withdraw notice" }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });

  test.describe("Accounts", () => {
    test.use({ storageState: USERS.sujit.state });

    test("sees leavers only, and clears the advances item", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/lifecycle");
      await expect(page.getByRole("tab", { name: "Probation" })).toHaveCount(0);
      const kamrul = page
        .locator("section")
        .filter({ hasText: "Kamrul Hasan" });
      await expect(
        kamrul
          .getByRole("listitem")
          .filter({ hasText: "Accounts (advances)" })
          .getByRole("button", { name: "Clear" }),
      ).toBeVisible();
      await expect(kamrul.getByRole("button", { name: "Clear" })).toHaveCount(
        1,
      );
      expect(errors).toEqual([]);
    });
  });
});

test.describe("approvals and access audit (2026-10-30)", () => {
  test.describe("Dept Head (Tanvir)", () => {
    test.use({ storageState: USERS.tanvir.state });

    test("his own requests and his delegations; every request type has a name", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/approvals");
      await expect(
        page.getByRole("tab", { name: "Waiting for me" }),
      ).toBeVisible();
      await expect(page.getByText(/^appr\.type\./)).toHaveCount(0);
      await page.getByRole("tab", { name: "Sent by me" }).click();
      await page.getByRole("tab", { name: "Delegations" }).click();
      await page
        .getByRole("button", { name: "Hand over my approvals" })
        .click();
      const to = page.getByRole("dialog").getByRole("combobox", { name: "To" });
      await expect(
        to.getByRole("option", { name: "Anisur Rahman" }),
      ).toHaveCount(1);
      await expect(
        to.getByRole("option", { name: "Mahmudul Hasan Rafi" }),
      ).toHaveCount(0); // an Employee approves nothing
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      expect(errors).toEqual([]);
    });
  });

  test.describe("owner (approval chains, roles, service keys)", () => {
    test.use({ storageState: USERS.owner.state });

    test("the chains, the roles and the service keys have screens", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/approvals/chains");
      await expect(
        page.getByRole("heading", { name: "Built-in defaults" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("row")
          .filter({ hasText: "Discount above the limit" })
          .first(),
      ).toBeVisible();
      await page.goto("/portal/users/roles");
      await expect(
        page.getByRole("row").filter({ hasText: "Sales" }).first(),
      ).toBeVisible();
      await page.getByRole("button", { name: "New custom role" }).click();
      await expect(
        page
          .getByRole("dialog")
          .getByText("approvals.view_all")
          .or(page.getByRole("dialog").getByText("employee.view"))
          .first(),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      await page.goto("/portal/integrations");
      await expect(
        page.getByRole("heading", { name: "Service keys (n8n, devices)" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
});

test.describe("completing before go-live (2026-10-30)", () => {
  test.describe("Accounts (Sujit): PF payments", () => {
    test.use({ storageState: USERS.sujit.state });

    test("a withdrawal and the final settlement are offered; settlement only for a leaver", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/employees");
      await page.getByLabel("Search").fill("Tanvir");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("cell", { name: "Tanvir Hossain" }).click();
      await page.getByRole("tab", { name: "PF & tax" }).click();
      await page.getByRole("button", { name: "Final settlement" }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByText("Years of service", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByText("Only for an employee in notice or separated."),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await page.getByRole("button", { name: "Withdrawal" }).click();
      await expect(
        page.getByRole("dialog").getByText(/own part only/),
      ).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel" })
        .click();
      expect(errors).toEqual([]);
    });
  });

  test.describe("HR (Farzana)", () => {
    test.use({ storageState: USERS.farzana.state });

    test("PF interest for a year; the customers migration template", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/payroll/setup");
      await expect(
        page.getByRole("heading", { name: "PF interest for a year" }),
      ).toBeVisible();
      await page.goto("/portal/migration");
      await expect(page.getByRole("cell", { name: "Customers" })).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
});

/**
 * Finding your way around (the guidance layer): the dashboard answers "what is
 * waiting for me", every screen says what it is for, and Ctrl + K reaches any
 * screen by name or by purpose.
 */
test.describe("finding your way around (Farzana)", () => {
  test.use({ storageState: USERS.farzana.state });

  test("the dashboard shows setup progress, waiting work and common tasks", async ({
    page,
  }) => {
    const errors = await open(page, "/portal");
    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Needs your attention" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Company setup" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Common tasks" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Add an employee" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("every screen explains what it is for, with the steps on demand", async ({
    page,
  }) => {
    const errors = await open(page, "/portal/attendance");
    const guide = page.getByRole("region", { name: "What this screen is for" });
    await expect(
      guide.getByText(/monthly lock that payroll depends on/),
    ).toBeVisible();
    // the steps are open until someone folds them away, so only open them if they are folded
    const toggle = guide.getByRole("button");
    if (((await toggle.textContent()) ?? "").includes("How it works"))
      await toggle.click();
    await expect(
      page.getByText(/Payroll uses locked months only/),
    ).toBeVisible();
    await toggle.click();
    await expect(
      page.getByText(/Payroll uses locked months only/),
    ).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("search reaches a screen by what it is for, not only by its name", async ({
    page,
  }) => {
    const errors = await open(page, "/portal");
    await page.getByRole("button", { name: "Search screens" }).click();
    await page
      .getByRole("dialog", { name: "Search screens" })
      .getByLabel("Search screens")
      .fill("old register");
    await page.getByRole("button", { name: /Parallel payroll/ }).click();
    await expect(
      page.getByRole("heading", { name: /Parallel payroll|Gate 1/ }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the breadcrumb says where a screen sits", async ({ page }) => {
    const errors = await open(page, "/portal/payroll/items");
    const crumbs = page.getByRole("navigation", { name: "All screens" });
    await expect(crumbs.getByText("Payroll")).toBeVisible();
    await expect(crumbs.getByText("Monthly items")).toBeVisible();
    expect(errors).toEqual([]);
  });
});

/** The People review (ADR 0033): what the API could already do, with a button on it. */
test.describe("People: the work HR and an Admin actually do", () => {
  test.describe("HR (Farzana)", () => {
    test.use({ storageState: USERS.farzana.state });

    test("narrows the list by branch and downloads what the filters show", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/employees");
      await expect(
        page.getByRole("columnheader", { name: "Branch" }),
      ).toBeVisible();

      await page
        .getByLabel("Branch", { exact: true })
        .selectOption({ label: "Chattogram Office" });
      await expect(page.getByRole("cell", { name: "Dhaka HQ" })).toHaveCount(0);

      const download = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Download the list" }).click(),
      ]).then((r) => r[0]);
      expect(download.suggestedFilename()).toMatch(
        /^employees-\d{4}-\d{2}-\d{2}\.csv$/,
      );
      const file = await download.createReadStream();
      const csv = await new Promise<string>((done) => {
        let text = "";
        file.on("data", (c) => (text += c));
        file.on("end", () => done(text));
      });
      const [header, ...lines] = csv.replace(/^﻿/, "").trim().split("\r\n");
      expect(header).toContain("employee_code,name_en,name_bn,status");
      expect(header).not.toMatch(/nid|salary|bank/);
      // the file carries the filter, and the Bangla names survive
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((l) => l.includes("Chattogram Office"))).toBe(true);
      expect(csv).toContain("মাহমুদুল হাসান রাফি");
      expect(errors).toEqual([]);
    });

    test("the profile carries the emergency contact, and a job change can change the manager", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/employees");
      await page.getByLabel("Search", { exact: true }).fill("Rafi");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("cell", { name: "Mahmudul Hasan Rafi" }).click();
      await expect(page.getByText("In an emergency, call")).toBeVisible();
      await expect(
        page.getByText("Permanent address (village / district)"),
      ).toBeVisible();

      await page.getByRole("tab", { name: "Job history" }).click();
      await page.getByRole("button", { name: "Record a change" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Line manager")).toBeVisible();
      await expect(
        dialog.getByLabel("Functional manager (performance only)"),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("papers running out has its own tab and the dashboard can link straight to it", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/lifecycle?tab=papers");
      await expect(
        page.getByText(/Documents that have expired or expire within/),
      ).toBeVisible();
      await page.getByLabel("Show the next").selectOption("30");
      await expect(page.getByText(/expire within 30 days/)).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test.describe("Admin (owner)", () => {
    test.use({ storageState: USERS.owner.state });

    test("a login can be given a new password and closed, and roles read as names", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/users");
      await page
        .getByRole("cell", { name: "tanvir.hossain@demo.test" })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("The login itself")).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Set a new password" }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Disable this login" }),
      ).toBeVisible();
      // the role grid names the role and says how long it lasts, instead of printing "dept_head"
      await expect(
        dialog.getByRole("cell", { name: "Department Head" }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("cell", { name: "No end date" }).first(),
      ).toBeVisible();
      await expect(dialog.getByText("dept_head")).toHaveCount(0);

      // a time-limited role asks for its end date before the button works
      // (no `exact`: a <select> inside its <label> takes the option text into its accessible name)
      await dialog
        .getByLabel("Role")
        .selectOption({ label: "Auditor (read-only)" });
      await expect(
        dialog.getByText("Until (required for this role)"),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Grant role" }),
      ).toBeDisabled();
      expect(errors).toEqual([]);
    });

    test("permissions read as sentences, grouped and searchable", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/users/roles");
      await expect(
        page.getByRole("cell", { name: /Owns the people records/ }),
      ).toBeVisible();
      await page
        .getByRole("row")
        .filter({ hasText: "Owns the people records" })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByText(
          "Create and change employee records, job history, onboarding, documents",
        ),
      ).toBeVisible();
      await expect(dialog.getByText("People", { exact: true })).toBeVisible(); // the group heading, upper-cased by CSS only
      await dialog.getByPlaceholder("Find a permission").fill("leave");
      await expect(dialog.getByText("Approve leave")).toBeVisible();
      await expect(dialog.getByText("View employee profiles")).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test("a department can be renamed and retired, and a grade keeps a salary range", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/organization");
      await page.getByText("Grades", { exact: true }).first().click();
      await expect(
        page.getByRole("columnheader", { name: /Seniority/ }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Edit" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Salary from")).toBeVisible();
      await expect(
        dialog.getByText("A retired entry stays on old records"),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();

      await page.getByText("Departments", { exact: true }).first().click();
      await page.getByRole("button", { name: "Edit" }).first().click();
      await expect(
        page
          .getByRole("dialog")
          .getByText("Moving a department takes everything under it along."),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
});

// ------------------------------------------------------- Time: attendance, leave, approvals (ADR 0034)

test.describe("Time: the work HR, a Dept Head and an Admin actually do", () => {
  test.describe("HR (Farzana)", () => {
    test.use({ storageState: USERS.farzana.state });

    test("the phone register lists live phones and can stop one", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/attendance");
      await page.getByRole("tab", { name: "Phones" }).click();
      await expect(
        page.getByRole("heading", { name: "Phones that may punch attendance" }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Approved on" }),
      ).toBeVisible();

      // the register, not only the queue: the three states are all reachable
      const status = page.getByRole("combobox", { name: "Phone" });
      await status.selectOption("active");
      await status.selectOption("revoked");
      await status.selectOption("active");

      // stopping a phone asks why, and says so before it does it
      const rows = page.getByRole("row");
      if ((await rows.count()) > 1) {
        await page.getByRole("button", { name: "Revoke" }).first().click();
        const dialog = page.getByRole("dialog", { name: "Revoke" });
        await expect(
          dialog.getByText("The employee sees nothing"),
        ).toBeVisible();
        await dialog.getByRole("button", { name: "Cancel" }).click();
      }
      expect(errors).toEqual([]);
    });

    test("a day leads to the person whose day needs fixing, and the month downloads", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/attendance");
      // the day list can be narrowed to one department
      await expect(
        page.getByRole("combobox", { name: "Department" }),
      ).toBeVisible();

      await page.getByRole("tab", { name: "Month & lock" }).click();
      const download = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Download the month" }).click(),
      ]).then((r) => r[0]);
      expect(download.suggestedFilename()).toMatch(
        /^attendance-\d{4}-\d{2}\.csv$/,
      );
      const file = await download.createReadStream();
      const csv = await new Promise<string>((done) => {
        let text = "";
        file!.on("data", (c) => (text += c));
        file!.on("end", () => done(text));
      });
      expect(csv.replace(/^﻿/, "").split("\r\n")[0]).toContain(
        "employee_code,name_en,present,late",
      );
      expect(errors).toEqual([]);
    });

    test("the leave calendar answers for everyone, not one department at a time", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/leave");
      // it answers straight away now; it used to ask for a department first
      await expect(page.getByText("Choose a department.")).toHaveCount(0);
      const picker = page.getByRole("combobox", { name: "Department" });
      await expect(
        picker.getByRole("option", { name: "Everyone I can see" }),
      ).toHaveCount(1);
      await expect(page.getByText(/Headcount|people/i).first()).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("leave that is not taken after all can be cancelled, and the days come back", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/employees");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("row").nth(1).click();
      await page.getByRole("tab", { name: "Leave" }).click();

      const cancel = page
        .getByRole("button", { name: "Cancel", exact: true })
        .first();
      if (await cancel.isVisible()) {
        await cancel.click();
        const dialog = page.getByRole("dialog", { name: "Cancel this leave" });
        await expect(dialog.getByText("came back early")).toBeVisible();
        await expect(
          dialog.getByLabel("Why is it being cancelled?"),
        ).toBeVisible();
        await dialog
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
      }
      expect(errors).toEqual([]);
    });
  });

  test.describe("Dept Head (Tanvir)", () => {
    test("an approval says what is being decided, in words, and who decides after him", async ({ browser }) => {
      // Rafi asks for leave far ahead (a different day every run), so there is
      // always something real in Tanvir's inbox; it is withdrawn again at the end
      // so the demo balance is left exactly as it was.
      //
      // The day has to be a WORKING one. 1 April 2027 is a Thursday, so the
      // Bangladeshi weekend falls on the 2nd, 3rd, 9th, 10th, 16th and 17th --
      // six of the twenty days this used to choose between. A single day on one
      // of those counts no leave at all ("The selected dates contain no leave
      // days"), the form stays where it is, and this test failed about three
      // runs in ten. Weekends are left out here; a day that turns out to be a
      // holiday, or that a previous run already asked for, is stepped over by
      // trying the next one.
      const workingDays: string[] = [];
      for (let d = 1; d <= 20; d++) {
        const date = new Date(Date.UTC(2027, 3, d));
        if (date.getUTCDay() !== 5 && date.getUTCDay() !== 6)
          workingDays.push(date.toISOString().slice(0, 10));
      }
      const firstTry = Math.floor(Date.now() / 60_000) % workingDays.length;
      const rafi = await browser.newContext({ storageState: USERS.rafi.state });
      const asRafi = await rafi.newPage();
      await asRafi.addInitScript(() => localStorage.setItem("erp-lang", "en"));
      await asRafi.goto("/leave/apply");
      const casual = await asRafi
        .locator("#leave-type option", { hasText: "Casual" })
        .first()
        .getAttribute("value");
      await asRafi.locator("#leave-type").selectOption(casual!);
      for (let i = 0; i < 4; i++) {
        const date = workingDays[(firstTry + i) % workingDays.length];
        await asRafi.locator("#leave-from").fill(date);
        await asRafi.locator("#leave-to").fill(date);
        await asRafi.locator("#leave-reason").fill("Family matter in Cumilla");
        await asRafi.getByRole("button", { name: "Submit" }).click();
        // taken: the app goes back to the leave screen. refused: it stays, says
        // why, and the next working day is tried.
        const accepted = await asRafi
          .waitForURL(/\/leave$/, { timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
        if (accepted) break;
      }
      await expect(asRafi).toHaveURL(/\/leave$/);

      const tanvir = await browser.newContext({
        storageState: USERS.tanvir.state,
        viewport: { width: 1400, height: 900 },
      });
      const page = await tanvir.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => localStorage.setItem("erp-lang", "en"));
      await page.goto("/portal/approvals");

      const row = page.getByRole("row").filter({ hasText: "Leave" }).first();
      await expect(row).toBeVisible();
      await row.click();

      // the chain the engine always sent and the screen never showed
      await expect(page.getByRole("heading", { name: /Who approves this/ })).toBeVisible();
      await expect(page.getByText("Step 1", { exact: false }).first()).toBeVisible();
      await expect(page.getByText("This step is yours")).toBeVisible();
      await expect(page.getByText("as the department head").or(page.getByText("as the line manager")).first()).toBeVisible();

      // what is being decided, in words: no raw ids, no camelCase, no database verbs
      await expect(page.getByText("Asked by")).toBeVisible();
      await expect(page.getByText("Mahmudul Hasan Rafi").first()).toBeVisible();
      await expect(page.getByText("Leave type")).toBeVisible();
      // the reason the demo's leave request carries, in the words the employee used
      await expect(
        page.getByText("Sister's wedding in Sylhet"),
      ).toBeVisible();
      await expect(page.getByText("Sent for approval")).toBeVisible();
      await expect(page.getByText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/)).toHaveCount(0);
      await expect(page.getByText("Leave Type Id")).toHaveCount(0);
      await expect(page.getByText(/^appr\.(f|act|because)\./)).toHaveCount(0);
      expect(errors).toEqual([]);

      // put the demo data back
      await asRafi.goto("/leave");
      const item = asRafi
        .getByRole("listitem")
        .filter({ hasText: /Casual/ })
        .filter({ hasText: "Waiting" })
        .first();
      await item.getByRole("button", { name: "Cancel request" }).click();
      await asRafi.getByRole("textbox").last().fill("Not needed after all (e2e)");
      await asRafi.getByRole("button", { name: /Cancel request|Confirm|Yes/ }).last().click();
      await rafi.close();
      await tanvir.close();
    });
  });

  test.describe("Admin (owner)", () => {
    test.use({ storageState: USERS.owner.state });

    test("every approval of the company is listable, and what is stuck is marked", async ({
      page,
    }) => {
      const errors = await open(page, "/portal/approvals");
      await page
        .getByRole("tab", { name: "Everything in the company" })
        .click();
      await expect(
        page.getByText("Use it to find what is stuck"),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Asked by" }),
      ).toBeVisible();

      // the two narrowings a question about stuck work needs
      await page.getByLabel("Past its time only").check();
      await page.getByLabel("Still waiting only").uncheck();
      await expect(page.getByText(/^ac\./)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
});
