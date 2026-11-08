/**
 * Every screen of the HR & Admin portal, in one list: the label it shows, the
 * permissions that open it, its icon, and the plain-language guide the screen
 * explains itself with ("what is this for", "how it works", "where to next").
 *
 * One list feeds four things, so they can never drift apart:
 *   - the sidebar (groups, order, what a role may see)
 *   - the search box (Ctrl+K) over screen names and purposes
 *   - the breadcrumb and page guide on every screen
 *   - "where to next" links between related screens
 *
 * Text keys: 'g.<id>.purpose' (one sentence), 'g.<id>.s1'…'s4' (the steps the
 * screen's work takes). Both live in lib/portal-text/guide.ts in Bangla and
 * English. A screen with no steps shows its purpose alone.
 */

export interface Screen {
  /** Short id, used for the text keys ('g.<id>.purpose'). */
  id: string;
  href: string;
  /** Label key, the same one the sidebar shows (e.g. 'p.nav.employees'). */
  key: string;
  /** The user needs at least one of these permissions. */
  needs: string[];
  icon: IconName;
  /** How many 'g.<id>.sN' steps this screen's guide has (0 = purpose only). */
  steps?: number;
  /** Ids of screens this work continues on, shown as "where to next". */
  next?: string[];
}

export interface ScreenGroup {
  /** Group heading key ('' for the dashboard, which stands alone). */
  key: string;
  /** One line under the heading, in the menu and on the dashboard. */
  hint?: string;
  screens: Screen[];
}

export type IconName =
  | "home"
  | "people"
  | "person"
  | "sitemap"
  | "key"
  | "clock"
  | "calendar"
  | "check"
  | "money"
  | "list"
  | "settings"
  | "compare"
  | "handshake"
  | "chart"
  | "doc"
  | "book"
  | "bank"
  | "cart"
  | "box"
  | "truck"
  | "receipt"
  | "percent"
  | "upload"
  | "robot"
  | "history"
  | "plug"
  | "wallet"
  | "shield"
  | "target"
  | "tag";

export const GROUPS: ScreenGroup[] = [
  {
    key: "",
    screens: [
      {
        id: "dashboard",
        href: "/portal",
        key: "p.nav.dashboard",
        needs: [],
        icon: "home",
        steps: 3,
        next: ["approvals", "employees"],
      },
    ],
  },
  {
    key: "p.nav.people",
    hint: "g.group.people",
    screens: [
      {
        id: "employees",
        href: "/portal/employees",
        key: "p.nav.employees",
        needs: ["employee.manage", "employee.view"],
        icon: "people",
        steps: 4,
        next: ["organization", "payrollSetup"],
      },
      {
        id: "lifecycle",
        href: "/portal/lifecycle",
        key: "lc.nav",
        needs: [
          "employee.manage",
          "employee.lifecycle.review",
          "users.manage",
          "org.structure.manage",
          "payroll.disburse",
        ],
        icon: "person",
        steps: 4,
        next: ["employees", "approvals"],
      },
      {
        id: "organization",
        href: "/portal/organization",
        key: "p.nav.organization",
        needs: ["org.structure.manage", "org.jobs.manage"],
        icon: "sitemap",
        steps: 4,
        next: ["employees", "attendance"],
      },
      {
        id: "users",
        href: "/portal/users",
        key: "p.nav.users",
        needs: ["users.manage"],
        icon: "key",
        steps: 4,
        next: ["approvalChains", "audit"],
      },
    ],
  },
  {
    key: "p.nav.time",
    hint: "g.group.time",
    screens: [
      {
        id: "attendance",
        href: "/portal/attendance",
        key: "p.nav.attendance",
        needs: ["attendance.manage", "attendance.view"],
        icon: "clock",
        steps: 4,
        next: ["runs", "organization"],
      },
      {
        id: "leave",
        href: "/portal/leave",
        key: "p.nav.leave",
        needs: ["leave.manage", "leave.view"],
        icon: "calendar",
        steps: 4,
        next: ["attendance", "approvals"],
      },
      {
        id: "approvals",
        href: "/portal/approvals",
        key: "p.nav.approvals",
        needs: [],
        icon: "check",
        steps: 4,
        next: ["approvalChains"],
      },
    ],
  },
  {
    key: "p.nav.payroll",
    hint: "g.group.payroll",
    screens: [
      {
        id: "runs",
        href: "/portal/payroll",
        key: "p.nav.runs",
        needs: [
          "payroll.prepare",
          "payroll.verify",
          "payroll.approve",
          "payroll.disburse",
        ],
        icon: "money",
        steps: 4,
        next: ["items", "gate1"],
      },
      {
        id: "items",
        href: "/portal/payroll/items",
        key: "p.nav.items",
        needs: ["payroll.prepare"],
        icon: "list",
        steps: 3,
        next: ["runs"],
      },
      {
        id: "payrollSetup",
        href: "/portal/payroll/setup",
        key: "p.nav.payrollSetup",
        needs: ["payroll.prepare"],
        icon: "settings",
        steps: 4,
        next: ["runs", "employees"],
      },
      {
        id: "gate1",
        href: "/portal/gate-1",
        key: "p.nav.gate1",
        needs: ["payroll.prepare", "payroll.verify", "payroll.approve"],
        icon: "compare",
        steps: 4,
        next: ["runs"],
      },
    ],
  },
  {
    key: "cr.nav.group",
    hint: "g.group.crm",
    screens: [
      {
        id: "leads",
        href: "/portal/crm/leads",
        key: "cr.nav.leads",
        needs: ["crm.own", "crm.view", "crm.assign", "crm.manage"],
        icon: "handshake",
        steps: 3,
        next: ["customers", "opportunities"],
      },
      {
        id: "customers",
        href: "/portal/crm/customers",
        key: "cr.nav.customers",
        needs: [
          "crm.own",
          "crm.view",
          "crm.assign",
          "crm.manage",
          "crm.credit",
        ],
        icon: "person",
        steps: 3,
        next: ["opportunities", "invoices"],
      },
      {
        id: "opportunities",
        href: "/portal/crm/opportunities",
        key: "cr.nav.opportunities",
        needs: ["crm.own", "crm.view", "crm.assign", "crm.manage"],
        icon: "target",
        steps: 3,
        next: ["quotations", "forecast"],
      },
      {
        id: "forecast",
        href: "/portal/crm/forecast",
        key: "cr.nav.forecast",
        needs: ["crm.own", "crm.view", "crm.assign", "crm.manage"],
        icon: "chart",
        next: ["opportunities", "territories"],
      },
      {
        id: "quotations",
        href: "/portal/sales/quotations",
        key: "sa.nav.quotations",
        needs: [
          "crm.own",
          "crm.view",
          "crm.assign",
          "crm.manage",
          "receivables.view",
        ],
        icon: "doc",
        steps: 3,
        next: ["orders"],
      },
      {
        id: "orders",
        href: "/portal/sales/orders",
        key: "sa.nav.orders",
        needs: [
          "crm.own",
          "crm.view",
          "crm.assign",
          "crm.manage",
          "receivables.view",
        ],
        icon: "cart",
        steps: 3,
        next: ["invoices", "stock"],
      },
      {
        id: "catalogue",
        href: "/portal/sales/catalogue",
        key: "sa.nav.catalogue",
        needs: [
          "sales.catalogue",
          "crm.own",
          "crm.view",
          "crm.assign",
          "crm.manage",
        ],
        icon: "tag",
        next: ["quotations"],
      },
      {
        id: "territories",
        href: "/portal/crm/territories",
        key: "cr.nav.territories",
        needs: ["crm.manage", "crm.view"],
        icon: "sitemap",
        next: ["forecast"],
      },
    ],
  },
  {
    key: "p.nav.finance",
    hint: "g.group.finance",
    screens: [
      {
        id: "financeHome",
        href: "/portal/finance",
        key: "p.nav.financeHome",
        needs: ["ledger.view"],
        icon: "book",
        steps: 3,
        next: ["vouchers", "reports"],
      },
      {
        id: "vouchers",
        href: "/portal/finance/vouchers",
        key: "p.nav.vouchers",
        needs: ["ledger.view"],
        icon: "doc",
        steps: 3,
        next: ["accounts", "reports"],
      },
      {
        id: "accounts",
        href: "/portal/finance/accounts",
        key: "p.nav.accounts",
        needs: ["ledger.view"],
        icon: "sitemap",
        next: ["vouchers", "opening"],
      },
      {
        id: "reports",
        href: "/portal/finance/reports",
        key: "p.nav.reports",
        needs: ["ledger.view"],
        icon: "chart",
        next: ["close", "vouchers"],
      },
      {
        id: "close",
        href: "/portal/finance/close",
        key: "cl.nav.close",
        needs: ["ledger.view"],
        icon: "check",
        steps: 3,
        next: ["reports", "bank"],
      },
      {
        id: "opening",
        href: "/portal/finance/opening",
        key: "cl.nav.migration",
        needs: ["ledger.setup"],
        icon: "upload",
        next: ["accounts"],
      },
      {
        id: "vendors",
        href: "/portal/vendors",
        key: "p.nav.vendors",
        needs: ["payables.view"],
        icon: "truck",
        next: ["bills", "procurement"],
      },
      {
        id: "procurement",
        href: "/portal/procurement",
        key: "pr.p.nav",
        needs: ["procurement.view", "procurement.manage"],
        icon: "cart",
        steps: 3,
        next: ["bills", "stock"],
      },
      {
        id: "budgets",
        href: "/portal/budgets",
        key: "bg.nav",
        needs: ["budgets.view", "budgets.manage"],
        icon: "chart",
        next: ["procurement", "reports"],
      },
      {
        id: "assets",
        href: "/portal/assets",
        key: "as.nav",
        needs: ["assets.view", "assets.manage", "assets.depreciate"],
        icon: "box",
        next: ["stock", "reports"],
      },
      {
        id: "stock",
        href: "/portal/stock",
        key: "st.nav",
        needs: ["stock.view", "stock.manage"],
        icon: "box",
        next: ["procurement", "orders"],
      },
      {
        id: "bills",
        href: "/portal/bills",
        key: "p.nav.bills",
        needs: ["payables.view"],
        icon: "receipt",
        steps: 3,
        next: ["vendors", "tax"],
      },
      {
        id: "invoices",
        href: "/portal/sales/invoices",
        key: "sa.nav.invoices",
        needs: ["receivables.view"],
        icon: "receipt",
        steps: 3,
        next: ["receipts", "receivables"],
      },
      {
        id: "receipts",
        href: "/portal/sales/receipts",
        key: "sa.nav.receipts",
        needs: ["receivables.view"],
        icon: "wallet",
        next: ["receivables", "bank"],
      },
      {
        id: "receivables",
        href: "/portal/receivables",
        key: "cl.nav.receivables",
        needs: ["receivables.view"],
        icon: "chart",
        next: ["invoices", "customers"],
      },
      {
        id: "bank",
        href: "/portal/bank",
        key: "bk.nav",
        needs: ["bank.view"],
        icon: "bank",
        steps: 3,
        next: ["close", "receipts"],
      },
      {
        id: "tax",
        href: "/portal/tax",
        key: "p.nav.tax",
        needs: ["payables.view"],
        icon: "percent",
        next: ["bills", "vat"],
      },
      {
        id: "vat",
        href: "/portal/vat",
        key: "vt.nav",
        needs: ["vat.view", "vat.manage"],
        icon: "percent",
        steps: 3,
        next: ["invoices", "compliance"],
      },
      {
        id: "compliance",
        href: "/portal/compliance",
        key: "cp.nav",
        needs: ["compliance.view", "compliance.manage"],
        icon: "shield",
        next: ["vat", "tax"],
      },
      {
        id: "expenses",
        href: "/portal/expenses",
        key: "p.nav.expenses",
        needs: ["expenses.view"],
        icon: "wallet",
        steps: 3,
        next: ["approvals", "bills"],
      },
    ],
  },
  {
    key: "p.nav.admin",
    hint: "g.group.admin",
    screens: [
      {
        id: "approvalChains",
        href: "/portal/approvals/chains",
        key: "p.nav.chains",
        needs: ["approvals.configure"],
        icon: "check",
        steps: 4,
        next: ["approvals", "users"],
      },
      {
        id: "migration",
        href: "/portal/migration",
        key: "p.nav.migration",
        needs: ["data.import", "data.import.sign_off"],
        icon: "upload",
        steps: 4,
        next: ["employees", "gate1"],
      },
      {
        id: "ai",
        href: "/portal/ai",
        key: "p.nav.ai",
        needs: ["ai.manage", "ai.policies.manage"],
        icon: "robot",
        steps: 3,
        next: ["audit"],
      },
      {
        id: "audit",
        href: "/portal/audit",
        key: "p.nav.audit",
        needs: ["audit.view"],
        icon: "history",
        steps: 3,
        next: ["users"],
      },
      {
        id: "integrations",
        href: "/portal/integrations",
        key: "p.nav.integrations",
        needs: ["integrations.manage"],
        icon: "plug",
        steps: 3,
        next: ["audit"],
      },
    ],
  },
];

export const SCREENS: Screen[] = GROUPS.flatMap((g) => g.screens);

const BY_ID = new Map(SCREENS.map((s) => [s.id, s]));

export function screenById(id: string): Screen | undefined {
  return BY_ID.get(id);
}

/**
 * The screen a path belongs to: the longest href the path starts with, so a
 * detail screen (/portal/employees/<id>) keeps its list screen's guide.
 * '/portal' only matches exactly, otherwise it would swallow every path.
 */
export function screenOf(pathname: string): Screen | undefined {
  let best: Screen | undefined;
  for (const screen of SCREENS) {
    if (screen.href === "/portal") {
      if (pathname === "/portal") best = screen;
      continue;
    }
    if (
      (pathname === screen.href || pathname.startsWith(`${screen.href}/`)) &&
      (!best || screen.href.length > best.href.length)
    )
      best = screen;
  }
  return best;
}

/** The group heading a screen sits under, for the breadcrumb. */
export function groupOf(screen: Screen): ScreenGroup | undefined {
  return GROUPS.find((g) => g.screens.includes(screen));
}

/** The text keys of a screen's guide steps, in order. */
export function stepKeys(screen: Screen): string[] {
  return Array.from(
    { length: screen.steps ?? 0 },
    (_, i) => `g.${screen.id}.s${i + 1}`,
  );
}
