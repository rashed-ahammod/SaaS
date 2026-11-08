/**
 * Role-wise walk (audit 2026-10-30): each demo role opens every screen its own menu offers.
 * A screen in someone's menu must load for them: no browser error, no error box, no API call
 * refused (403) or failing (5xx). This finds a menu entry whose page needs a permission the
 * role does not have, or a page that breaks on real data.
 */
import { expect, test } from "@playwright/test";
import { USERS } from "./users";

const ROLES = [
  ["rafi", "Sales user + Employee"],
  ["tanvir", "Dept Head (Sales)"],
  ["farzana", "HR"],
  ["sujit", "Accounts"],
  ["anisur", "Admin (MD)"],
  ["owner", "workspace owner"],
] as const;

for (const [user, label] of ROLES) {
  test.describe(`${label} (${user})`, () => {
    test.use({ storageState: USERS[user].state });

    test("every screen in the menu loads", async ({ page }) => {
      test.setTimeout(240_000);
      await page.addInitScript(() => localStorage.setItem("erp-lang", "en"));
      await page.goto("/portal");
      const nav = page.getByRole("navigation", { name: "HR & Admin portal" });
      await expect(nav).toBeVisible();
      const hrefs = [
        ...new Set(
          await nav
            .getByRole("link")
            .evaluateAll((links) =>
              links.map((a) => a.getAttribute("href") ?? ""),
            ),
        ),
      ].filter((h) => h.startsWith("/portal"));
      expect(hrefs.length).toBeGreaterThan(0);

      const problems: string[] = [];
      let current = "";
      page.on("pageerror", (e) =>
        problems.push(`${current}: browser error ${e.message}`),
      );
      page.on("response", (r) => {
        const url = r.url();
        if (
          url.includes("/api/erp/") &&
          (r.status() === 403 || r.status() >= 500)
        )
          problems.push(
            `${current}: ${r.status()} ${r.request().method()} ${url.split("/api/erp")[1]}`,
          );
      });
      for (const href of hrefs) {
        current = href;
        await page.goto(href);
        await page.waitForLoadState("networkidle");
        const alerts = await page.getByRole("alert").allInnerTexts();
        for (const a of alerts)
          if (a.trim())
            problems.push(`${href}: error box "${a.trim().slice(0, 120)}"`);
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });
  });
}

/** The employee app (PWA) screens, for the people who use it most. */
const APP_SCREENS = [
  "/",
  "/attendance",
  "/leave",
  "/leave/apply",
  "/payslips",
  "/payslips/advances",
  "/payslips/pf",
  "/payslips/tax",
  "/claims",
  "/requisitions",
  "/store-requests",
  "/approvals",
  "/notifications",
  "/profile",
];

for (const user of ["rafi", "tanvir", "sujit"] as const) {
  test.describe(`employee app (${user})`, () => {
    test.use({ storageState: USERS[user].state });

    test("every app screen loads", async ({ page }) => {
      test.setTimeout(180_000);
      await page.addInitScript(() => localStorage.setItem("erp-lang", "en"));
      const problems: string[] = [];
      let current = "";
      page.on("pageerror", (e) =>
        problems.push(`${current}: browser error ${e.message}`),
      );
      page.on("response", (r) => {
        if (
          r.url().includes("/api/erp/") &&
          (r.status() === 403 || r.status() >= 500)
        )
          problems.push(
            `${current}: ${r.status()} ${r.request().method()} ${r.url().split("/api/erp")[1]}`,
          );
      });
      for (const href of APP_SCREENS) {
        current = href;
        await page.goto(href);
        await page.waitForLoadState("networkidle");
        for (const a of await page.getByRole("alert").allInnerTexts())
          if (a.trim())
            problems.push(`${href}: error box "${a.trim().slice(0, 120)}"`);
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });
  });
}
