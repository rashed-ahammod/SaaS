/**
 * Every word on the landing page (/), kept apart from the markup so the copy
 * can be read and corrected without going through JSX. All of it comes from
 * BUSINESS_LOGIC_SPEC_v0.2.md; nothing here is a claim the spec does not make.
 */

export interface Finding {
  tag: string;
  title: string;
  body: string;
}

/** Section 1: what a head office lives with today. */
export const PROBLEMS: Finding[] = [
  {
    tag: "Payroll",
    title: "Salary runs on a spreadsheet",
    body: "One unlocked formula and 400 net-pay figures are wrong. Nobody can say who changed the sheet, and the bank file is typed again by hand.",
  },
  {
    tag: "Law",
    title: "The law moved under the office",
    body: "The 2025 Labour Ordinance brought officers and managers inside the definition of worker. Offices that ran on company policy now owe statutory leave, benefits and a complaint process.",
  },
  {
    tag: "Tax",
    title: "Withholding guessed every month",
    body: "Income tax at source needs an annual projection spread over the months left in a July–June year. Slabs move with every June budget, so last year's sheet is already wrong.",
  },
  {
    tag: "Approvals",
    title: "Approvals live on WhatsApp",
    body: "A leave request is a phone call, a purchase is a verbal yes. No trail, no deadline, and nothing moves while the approver is on leave.",
  },
  {
    tag: "Data",
    title: "Five systems, five versions of the truth",
    body: "A punch machine, an HR workbook, desktop accounting software and a sales notebook. Head count never agrees, and the salary journal is retyped into the ledger.",
  },
  {
    tag: "People",
    title: "English-only tools in a Bangla office",
    body: "Staff need a payslip they can read on a phone, amounts in lakh–crore grouping and in words — and an Eid date that can move after attendance was already locked.",
  },
];

/** Section 2: the same six habits, answered. */
export const SWAPS: { before: string; after: string }[] = [
  {
    before: "Salary sheet emailed around, then retyped into the bank portal",
    after:
      "A monthly run over locked attendance: maker–checker approval, then a BEFTN/NPSB file, cash list or bKash/Nagad list",
  },
  {
    before: "Leave and overtime rules kept in a senior officer's head",
    after:
      "Every rule an effective-dated company setting in a versioned Bangladesh rule pack — a law change is a settings change",
  },
  {
    before: "Back-dated increments recalculated by hand, arrears argued over",
    after:
      "Effective-dated history computes the arrears and splits the tax across both fiscal years on its own",
  },
  {
    before: "“Who approved this?” answered by scrolling a chat thread",
    after:
      "Named approval chains with deadlines and escalation; posted vouchers and finalized payroll can never be edited, only reversed with a reason",
  },
  {
    before: "AI bolted on as a chatbot beside the real work",
    after:
      "AI inside the screen you already use: it drafts, scores and explains, and a person always clicks",
  },
];

export const MODULES: { title: string; bn: string; body: string }[] = [
  {
    title: "People",
    bn: "কর্মী",
    body: "Hire to final settlement, each change effective-dated with full history. Probation, confirmation, transfer, separation, clearance.",
  },
  {
    title: "Attendance",
    bn: "হাজিরা",
    body: "Phone punch inside a branch geo-fence, biometric import, shift rosters, weekend per branch, overtime at the statutory rate.",
  },
  {
    title: "Leave",
    bn: "ছুটি",
    body: "Casual, sick, earned, maternity and unpaid, with accrual, carry-forward caps and balances the employee can see before asking.",
  },
  {
    title: "Payroll",
    bn: "বেতন",
    body: "Heads tagged taxable or exempt, proration for joiners and leavers, PF, loan instalments, festival bonuses, tax certificate.",
  },
  {
    title: "Performance",
    bn: "মূল্যায়ন",
    body: "Goals per designation, self review, department rating, HR calibration, then an effective-dated increment with arrears.",
  },
  {
    title: "Finance",
    bn: "হিসাব",
    body: "Chart of accounts, cost centres, vouchers, VAT and VDS, bank reconciliation, budgets and a period close that actually closes.",
  },
  {
    title: "Procurement",
    bn: "ক্রয়",
    body: "Requisition to purchase order to goods receipt to bill, store issues, asset register with custody and depreciation.",
  },
  {
    title: "Sales & CRM",
    bn: "বিক্রয়",
    body: "Leads from a Facebook form or a counter QR code, pipeline, quotations, invoices, collections — commission lands in payroll.",
  },
];

export const PAYROLL_STEPS: { title: string; body: string }[] = [
  {
    title: "Lock the month",
    body: "Attendance and leave for the month are frozen, so the figures cannot move under the run.",
  },
  {
    title: "Pull the variables",
    body: "Overtime, arrears, bonuses, CRM commission, loan and advance instalments, other deductions.",
  },
  {
    title: "Compute earnings",
    body: "Heads by rule, prorated for joiners and leavers, unpaid days deducted.",
  },
  {
    title: "Compute deductions",
    body: "Tax at source from the annual projection, employee PF, loan instalments, others.",
  },
  {
    title: "Net pay and employer cost",
    body: "Employer PF and gratuity provision counted in the same run.",
  },
  {
    title: "Pre-check the outliers",
    body: "Rules and AI flag a net pay that jumped, a brand-new bank account, zero tax on a taxable salary.",
  },
  {
    title: "Approve, then lock",
    body: "The approval chain signs; whoever prepared the run cannot approve it.",
  },
  {
    title: "Pay",
    body: "Bank file per bank (BEFTN/NPSB), cash list, or mobile-wallet list.",
  },
  {
    title: "Publish payslips",
    body: "On the portal and by e-mail, in Bangla or English, optionally password-protected.",
  },
  {
    title: "Post the journal",
    body: "The salary journal reaches accounts by itself, agreeing to the taka.",
  },
];

export const PAYROLL_NOTES: { title: string; body: string }[] = [
  {
    title: "The hard cases are the test suite",
    body: "A joiner and a leaver in the same month. A back-dated increment spanning the fiscal-year boundary. Maternity leave at wage ÷ 26 per day crossing two months. A final settlement where deductions exceed dues. An Eid holiday moved after attendance was locked. Each is a worked example that must pass before a release ships.",
  },
  {
    title: "It agrees to the taka",
    body: "Payslip totals, the bank disbursement file and the salary journal are reconciled to the taka under your own rounding rule — not close enough, equal.",
  },
  {
    title: "Nobody signs their own run",
    body: "Maker–checker is enforced by the engine, not by office habit, and once finalized the run is locked. A correction is a reversal with a reason, so the history stays readable a year later.",
  },
];

export const AI_FEATURES: { name: string; who: string; what: string }[] = [
  {
    name: "Self-service assistant",
    who: "Everyone",
    what: "Answers policy questions, drafts the leave request",
  },
  {
    name: "Ask-your-data reports",
    who: "Admin · HR · Accounts",
    what: "A question becomes a report inside your own scope",
  },
  {
    name: "CV screening",
    who: "HR",
    what: "Ranks applicants with reasons; name, gender, age and photo stripped first",
  },
  {
    name: "Receipt reader",
    who: "Employee · Accounts",
    what: "Amount, date, vendor and VAT off a photo; duplicates flagged",
  },
  {
    name: "Payroll pre-check",
    who: "HR · Accounts",
    what: "Explains each outlier before anyone approves",
  },
  {
    name: "Spend anomaly watch",
    who: "Accounts · Admin",
    what: "Split purchases under a limit, duplicate vendor bills",
  },
  {
    name: "Cash-flow forecast",
    who: "Accounts · Admin",
    what: "90 days out of receivables, payables and payroll",
  },
  {
    name: "Sales assistant",
    who: "Sales · Dept Head",
    what: "Lead score with reasons, next action, draft follow-up",
  },
  {
    name: "Review drafting",
    who: "Dept Head",
    what: "A year of feedback notes into a first draft",
  },
  {
    name: "Letter drafting",
    who: "HR",
    what: "Non-standard letters only; standard ones stay templates",
  },
  {
    name: "Bank reconciliation",
    who: "Accounts",
    what: "Suggests a match for every unmatched bank line",
  },
  {
    name: "Team health trends",
    who: "HR · Admin",
    what: "Department-level trends; never an individual risk score",
  },
];

export const GUARDRAILS: { title: string; body: string }[] = [
  {
    title: "The same permissions as you",
    body: "AI reads only through the core API, with your role and your scope. A Department Head's question can never return another department's salaries.",
  },
  {
    title: "Draft, then confirm",
    body: "AI can prepare a request, a report or a message. Only your click submits, sends or approves it.",
  },
  {
    title: "Every score explained",
    body: "A flag or a score always arrives with the reasons behind it, and the whole exchange is logged with model and prompt version.",
  },
  {
    title: "It works without AI",
    body: "Switch any feature off, or let the provider go down: every process still runs on the normal screens.",
  },
];

/** The automation ticker: a plausible morning in one tenant. */
export const EVENTS: { at: string; event: string; what: string }[] = [
  {
    at: "06:00",
    event: "attendance.daily_closed",
    what: "Absent and late list sent to 9 department heads",
  },
  {
    at: "08:41",
    event: "employee.created",
    what: "Onboarding kit — mail account, laptop task, day-1 orientation",
  },
  {
    at: "09:05",
    event: "lead.captured",
    what: "Facebook lead ad → lead assigned to Chattogram sales",
  },
  {
    at: "10:12",
    event: "approval.pending",
    what: "Purchase requisition nudged; escalates at 14:00",
  },
  {
    at: "11:30",
    event: "invoice.overdue",
    what: "Collection reminder to 4 customers, then the account manager",
  },
  {
    at: "12:00",
    event: "probation.ending",
    what: "Expiry alerts — probation, contracts, trade licence, insurance",
  },
  {
    at: "15:20",
    event: "payroll.disbursed",
    what: "Payslip PDFs mailed, “salary credited” SMS sent",
  },
  {
    at: "17:45",
    event: "employee.separated",
    what: "Access revoked at last day, asset return and clearance opened",
  },
  {
    at: "22:00",
    event: "schedule.daily",
    what: "Bank statements fetched and loaded into reconciliation",
  },
  {
    at: "23:10",
    event: "schedule.monthly",
    what: "Compliance calendar — tax, VAT and statutory filing dates",
  },
];

export const AUTOMATION_NOTES: { title: string; body: string }[] = [
  {
    title: "Reminders that escalate",
    body: "An approval that sits past its deadline nudges by e-mail, SMS or WhatsApp with a one-click link, then escalates to the approver's own manager.",
  },
  {
    title: "Replay, don't guess",
    body: "Every event delivery is recorded with its outcome. A workflow that failed at 2 a.m. is retried, not reconstructed from memory.",
  },
  {
    title: "Your own process, too",
    body: "On the Intelligent tier a workflow can be built for how your office actually works, inside your tenant's data only.",
  },
];

export const RULES: { rule: string; value: string; state: string }[] = [
  {
    rule: "Maternity leave",
    value: "120 days paid, monthly wage ÷ 26 per day",
    state: "Amended 2025",
  },
  {
    rule: "Festival holidays",
    value: "13 paid days a year, dates set by the employer",
    state: "Amended 2025",
  },
  {
    rule: "Resignation benefit",
    value: "7 / 15 / 30 days' wages per year by length of service",
    state: "Amended 2025",
  },
  {
    rule: "Provident fund",
    value: "Mandatory at 100+ permanent staff, or an approved pension scheme",
    state: "New",
  },
  {
    rule: "Complaint committee",
    value: "Required for harassment and discrimination complaints",
    state: "New",
  },
  {
    rule: "Income tax at source",
    value: "Slabs and rebates stored per fiscal year, July–June",
    state: "Act 2023",
  },
];

export const COMPLIANCE_NOTES: { title: string; body: string }[] = [
  {
    title: "Sourced, then signed off",
    body: "Each value links to its gazetted text or NBR circular, and a named compliance owner reviews the pack after every June budget and every amendment. A rule still marked “verify” cannot be switched on for a live customer.",
  },
  {
    title: "Written in taka and Bangla",
    body: "Lakh–crore grouping (12,34,567.00), amounts in words in both languages on payslips and cheques, Bangla digits optional, weekend per branch, and a holiday calendar you can move the night Eid is announced.",
  },
  {
    title: "What the law forbids, the software forbids",
    body: "There is no “do not rehire” flag to tick: separation records keep factual reasons only. Harassment complaints route to the complaint committee down a channel hidden from the accused's management chain.",
  },
];

export const PRINCIPLES: { title: string; body: string }[] = [
  {
    title: "Strict tenant isolation",
    body: "One company never sees another's data — not through a report, not through a shared workflow, not through an AI answer.",
  },
  {
    title: "Maker–checker on money",
    body: "Whoever creates a payment, a voucher or a payroll run cannot approve it. Every approval carries a name and a time.",
  },
  {
    title: "Posted means permanent",
    body: "Approved vouchers, finalized payroll and closed periods cannot be edited. A correction is a reversal with a reason.",
  },
  {
    title: "Effective-dated history",
    body: "Salary, designation, department and reporting line keep their full history, so a back-dated change produces correct arrears.",
  },
  {
    title: "Bangla and English, on a phone",
    body: "Attendance, leave, payslips and claims work fully on the phone an employee already owns, in the language they choose.",
  },
  {
    title: "The core holds the truth",
    body: "Automation only reacts to events and calls back through the API. Balances and approval states live in one place.",
  },
];

export const TIERS: {
  name: string;
  bn: string;
  line: string;
  featured?: boolean;
  items: string[];
}[] = [
  {
    name: "Core",
    bn: "কোর",
    line: "Get the month right",
    items: [
      "Employee records and lifecycle",
      "Attendance, shifts and overtime",
      "Leave with balances and accrual",
      "Payroll, payslips and bank files",
      "Self-service and approval chains",
    ],
  },
  {
    name: "Business",
    bn: "বিজনেস",
    line: "Run the whole office",
    featured: true,
    items: [
      "Everything in Core",
      "Accounts, vouchers, VAT and VDS",
      "Expense claims and advances",
      "Procurement, inventory and assets",
      "Sales pipeline, invoices and CRM",
    ],
  },
  {
    name: "Intelligent",
    bn: "ইন্টেলিজেন্ট",
    line: "Let the dull half run itself",
    items: [
      "Everything in Business",
      "The twelve AI features, with quota",
      "Ask-your-data reports",
      "Prebuilt automation library",
      "Custom workflows for your process",
    ],
  },
];

export const COMMERCIAL: { title: string; body: string }[] = [
  {
    title: "Implementation",
    body: "A one-time fee covers setup, data migration from your sheets, and training your HR and accounts staff.",
  },
  {
    title: "On your own servers",
    body: "Groups and banks that must keep data in-house can take an annual licence with maintenance, hosted in Bangladesh.",
  },
  {
    title: "Add-ons",
    body: "SMS bundles, biometric device integration, and custom workflows for a process that is genuinely yours.",
  },
];

/** The specimen payroll run in the hero (demo figures, Bangladeshi scale). */
export const SPECIMEN = {
  company: "Meghna Edible Oils Ltd",
  month: "November 2026 · নভেম্বর ২০২৬",
  ref: "PR-2026-11-0412",
  lines: [
    { label: "Employees on run", value: "412" },
    { label: "Gross earnings", value: "৳ 2,84,16,500" },
    { label: "Tax deducted at source", value: "৳ 11,92,340" },
    { label: "Employee PF", value: "৳ 9,47,220" },
    { label: "Net payable", value: "৳ 2,41,08,160" },
  ],
  flags: [
    {
      mark: "!",
      tone: "warn" as const,
      text: "Rumana Haque — net pay up 38%, increment effective 1 Oct, arrears ৳ 46,200",
    },
    {
      mark: "×",
      tone: "flag" as const,
      text: "Shafiqul Islam — bank account changed 4 days ago, not yet verified",
    },
    {
      mark: "✓",
      tone: "accent" as const,
      text: "Chattogram branch — Eid holiday moved, 94 attendance days recomputed",
    },
  ],
  foot: "Prepared by HR · checks with Accounts, then the Director. The preparer cannot approve.",
};
