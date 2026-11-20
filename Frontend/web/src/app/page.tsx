/**
 * Public landing page, the front door at /: what the product is for, the
 * problem a Bangladeshi head office has today, and how this portal answers
 * it. No sign-in — src/proxy.ts lets this one path through; the employee
 * app starts at /home.
 *
 * Dark theme, laid out mobile-first. The movement lives in
 * src/components/landing/motion.tsx and in the landing block of globals.css;
 * every claim here comes from BUSINESS_LOGIC_SPEC_v0.2.md.
 */
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  Counter,
  LandingNav,
  Reveal,
  ScrollProgress,
} from "@/components/landing/motion";

export const metadata: Metadata = {
  title: "Amar Office · HR, payroll, accounts and CRM for a Bangladeshi office",
  description:
    "One system of record for people, attendance, leave, payroll, accounts, procurement and CRM — built around the Bangladesh Labour Act, the Income Tax Act 2023 and BDT, with AI that drafts and flags but never decides.",
};

/* ---------------------------------------------------------------- pieces */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3.5 py-1.5 text-xs font-semibold tracking-[0.14em] text-emerald-300 uppercase">
      <span className="landing-blink size-1.5 rounded-full bg-emerald-400" />
      {children}
    </span>
  );
}

function SectionHead({
  eyebrow,
  title,
  bn,
  lead,
}: {
  eyebrow: string;
  title: ReactNode;
  bn?: string;
  lead?: string;
}) {
  return (
    <Reveal className="mx-auto max-w-3xl text-center">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-5 text-3xl font-bold tracking-tight text-white text-balance sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {bn ? <p className="mt-3 text-base text-emerald-300/80">{bn}</p> : null}
      {lead ? (
        <p className="mt-5 text-base leading-relaxed text-slate-400 sm:text-lg">
          {lead}
        </p>
      ) : null}
    </Reveal>
  );
}

/** Small stroke icon; `d` is one or more path commands. */
function Icon({ d, className = "" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ICONS = {
  people:
    "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 5.2a3 3 0 0 1 0 5.6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2",
  leave:
    "M8 3v3M16 3v3M3.5 9.5h17M5 6h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 21H5a1.5 1.5 0 0 1-1.5-1.5v-12A1.5 1.5 0 0 1 5 6ZM9 14l1.8 1.8L15 12",
  money:
    "M3.5 7.5h17v10h-17v-10ZM12 15a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6.5 10.5h.01M17.5 14.5h.01",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  ledger:
    "M6 3h12a1 1 0 0 1 1 1v16l-3.5-2-3.5 2-3.5-2L5 20V4a1 1 0 0 1 1-1ZM9 8h6M9 12h6",
  cart: "M3 4h2l2.4 10.4A2 2 0 0 0 9.35 16h8.4a2 2 0 0 0 1.95-1.55L21 8H6.5M10 20.5h.01M17 20.5h.01",
  handshake:
    "M7 13l-3-3 4.5-4.5L11 8h2l2.5-2.5L20 10l-3 3M7 13l3.5 3.5a1.5 1.5 0 0 0 2.1 0L17 13",
  spark:
    "M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3ZM18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z",
  shield: "M12 21s7-3.2 7-9V5.8L12 3 5 5.8V12c0 5.8 7 9 7 9ZM9.3 12l2 2 3.4-3.6",
  bolt: "M13.5 3 6 13.5h4.5L10 21l7.5-10.5H13l.5-7.5Z",
  scale:
    "M12 4v16M7 20h10M12 6 5 9l2.5 4A3.2 3.2 0 0 0 12.5 9M12 6l7 3-2.5 4A3.2 3.2 0 0 1 11.5 9",
  phone:
    "M8.5 3.5h7a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19V5a1.5 1.5 0 0 1 1.5-1.5ZM11 17.5h2",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13V20h-13V11ZM12 14.5v2.5",
  replay: "M20.5 12a8.5 8.5 0 1 1-2.8-6.3M20.5 3.5v4.2h-4.2",
  core: "M12 7.6c3.9 0 7-1 7-2.3S15.9 3 12 3 5 4 5 5.3s3.1 2.3 7 2.3ZM5 5.3v13.4C5 20 8.1 21 12 21s7-1 7-2.3V5.3M5 12c0 1.3 3.1 2.3 7 2.3s7-1 7-2.3",
};

/** Glass panel used by most cards. */
function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`landing-panel relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-6 ${className}`}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- content */

const PROBLEMS = [
  {
    icon: ICONS.money,
    tag: "Payroll",
    title: "Salary runs on a spreadsheet",
    body: "One unlocked formula and 400 net-pay figures are wrong. Nobody can say who changed the sheet, and the bank file is typed again by hand.",
  },
  {
    icon: ICONS.scale,
    tag: "Law",
    title: "The law moved under the office",
    body: "The 2025 Labour Ordinance brought officers and managers inside the definition of worker. Offices that ran on company policy now owe statutory leave, benefits and a complaint process.",
  },
  {
    icon: ICONS.chart,
    tag: "Tax",
    title: "Withholding guessed every month",
    body: "Income tax at source needs an annual projection spread over the months left in a July–June year. Slabs move with every June budget, so last year's sheet is already wrong.",
  },
  {
    icon: ICONS.phone,
    tag: "Approvals",
    title: "Approvals live on WhatsApp",
    body: "A leave request is a phone call, a purchase is a verbal yes. No trail, no deadline, and nothing moves while the approver is on leave.",
  },
  {
    icon: ICONS.ledger,
    tag: "Data",
    title: "Five systems, five versions of the truth",
    body: "A punch machine, an HR workbook, desktop accounting software and a sales notebook. Head count never agrees, and the salary journal is retyped into the ledger.",
  },
  {
    icon: ICONS.people,
    tag: "People",
    title: "English-only tools in a Bangla office",
    body: "Staff need a payslip they can read on a phone, amounts in lakh–crore grouping and in words — and an Eid date that can move after attendance was already locked.",
  },
];

const SWAPS = [
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

const MODULES = [
  {
    icon: ICONS.people,
    title: "People",
    bn: "কর্মী",
    body: "Hire to final settlement, each change effective-dated with full history. Probation, confirmation, transfer, separation and clearance.",
  },
  {
    icon: ICONS.clock,
    title: "Attendance & shifts",
    bn: "হাজিরা",
    body: "Phone punch inside a branch geo-fence, biometric import, shift rosters, weekend per branch, overtime at the statutory rate.",
  },
  {
    icon: ICONS.leave,
    title: "Leave",
    bn: "ছুটি",
    body: "Casual, sick, earned, maternity and unpaid, with accrual, carry-forward caps and balances the employee can see before asking.",
  },
  {
    icon: ICONS.money,
    title: "Payroll",
    bn: "বেতন",
    body: "Heads tagged taxable or exempt, proration for joiners and leavers, PF, loan instalments, two festival bonuses, annual tax certificate.",
  },
  {
    icon: ICONS.chart,
    title: "Performance",
    bn: "মূল্যায়ন",
    body: "Goals from a library per designation, self review, department rating, HR calibration, then an effective-dated increment with arrears.",
  },
  {
    icon: ICONS.ledger,
    title: "Accounts & finance",
    bn: "হিসাব",
    body: "Chart of accounts, cost centres, vouchers, VAT and VDS, bank reconciliation, budgets and a period close that actually closes.",
  },
  {
    icon: ICONS.cart,
    title: "Procurement & assets",
    bn: "ক্রয়",
    body: "Requisition to purchase order to goods receipt to bill, store issues, asset register with custody and depreciation.",
  },
  {
    icon: ICONS.handshake,
    title: "Sales & CRM",
    bn: "বিক্রয়",
    body: "Leads from a Facebook form or a counter QR code, pipeline, quotations, invoices, collections — and sales commission that lands in payroll.",
  },
];

const PAYROLL_STEPS = [
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

const AI_FEATURES = [
  ["Self-service assistant", "Everyone", "Answers policy questions, drafts the leave request"],
  ["Ask-your-data reports", "Admin · HR · Accounts", "A question becomes a report inside your own scope"],
  ["CV screening", "HR", "Ranks applicants with reasons; name, gender, age and photo stripped first"],
  ["Receipt reader", "Employee · Accounts", "Amount, date, vendor and VAT off a photo; duplicates flagged"],
  ["Payroll pre-check", "HR · Accounts", "Explains each outlier before anyone approves"],
  ["Spend anomaly watch", "Accounts · Admin", "Split purchases under a limit, duplicate vendor bills"],
  ["Cash-flow forecast", "Accounts · Admin", "90 days out of receivables, payables and payroll"],
  ["Sales assistant", "Sales · Dept Head", "Lead score with reasons, next action, draft follow-up"],
  ["Review drafting", "Dept Head", "A year of feedback notes into a first draft"],
  ["Letter drafting", "HR", "Non-standard letters only; standard ones stay templates"],
  ["Bank reconciliation", "Accounts", "Suggests a match for every unmatched bank line"],
  ["Team health trends", "HR · Admin", "Department-level trends; never an individual risk score"],
];

const GUARDRAILS = [
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

const WORKFLOWS = [
  ["employee.created", "Onboarding kit — accounts, laptop task, welcome pack, day-1 orientation"],
  ["employee.separated", "Offboarding — access revoked on the last day, asset return and clearance"],
  ["approval.pending", "Approval nudges by e-mail, SMS or WhatsApp, escalation on breach"],
  ["payroll.disbursed", "Payslip PDF by e-mail and a “salary credited” SMS"],
  ["attendance.daily_closed", "Every Dept Head gets the absent and late list each morning"],
  ["lead.captured", "Facebook lead ad or website form becomes a lead, auto-assigned"],
  ["invoice.overdue", "Collection reminders, then escalation to the account manager"],
  ["probation.ending", "Expiry alerts — probation, contracts, trade licence, insurance"],
  ["schedule.daily", "Bank statements fetched and loaded into reconciliation"],
  ["schedule.monthly", "Compliance calendar — tax, VAT and statutory filing dates"],
];

const RULES = [
  { rule: "Maternity leave", value: "120 days paid, monthly wage ÷ 26 per day", state: "Amended 2025" },
  { rule: "Festival holidays", value: "13 paid days a year, dates set by the employer", state: "Amended 2025" },
  { rule: "Resignation benefit", value: "7 / 15 / 30 days' wages per year by length of service", state: "Amended 2025" },
  { rule: "Provident fund", value: "Mandatory at 100+ permanent staff, or an approved pension scheme", state: "New" },
  { rule: "Complaint committee", value: "Required for harassment and discrimination complaints", state: "New" },
  { rule: "Income tax at source", value: "Slabs and rebates stored per fiscal year, July–June", state: "Act 2023" },
];

const TRUST = [
  {
    icon: ICONS.lock,
    title: "Strict tenant isolation",
    body: "One company never sees another's data — not through a report, not through a shared workflow, not through an AI answer.",
  },
  {
    icon: ICONS.shield,
    title: "Maker–checker on money",
    body: "Whoever creates a payment, a voucher or a payroll run cannot approve it. Every approval carries a name and a time.",
  },
  {
    icon: ICONS.ledger,
    title: "Posted means permanent",
    body: "Approved vouchers, finalized payroll and closed periods cannot be edited. A correction is a reversal with a reason.",
  },
  {
    icon: ICONS.clock,
    title: "Effective-dated history",
    body: "Salary, designation, department and reporting line keep their full history, so a back-dated change produces correct arrears.",
  },
  {
    icon: ICONS.phone,
    title: "Bangla and English, on a phone",
    body: "Attendance, leave, payslips and claims work fully on the phone an employee already owns, in the language they choose.",
  },
  {
    icon: ICONS.core,
    title: "The core holds the truth",
    body: "Automation only reacts to events and calls back through the API. Balances and approval states live in one place.",
  },
];

const TIERS = [
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

/* ------------------------------------------------------------------- page */

export default function LandingPage() {
  return (
    <div className="landing min-h-screen bg-[#070b14] text-slate-300 selection:bg-emerald-400/30 selection:text-white">
      <ScrollProgress />
      <LandingNav />

      <a
        href="#problem"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:text-black"
      >
        Skip to the content
      </a>

      {/* ------------------------------------------------------------ hero */}
      <section id="top" className="relative isolate overflow-hidden">
        <div className="landing-aurora pointer-events-none absolute inset-0 -z-10" />
        <div className="landing-grid pointer-events-none absolute inset-0 -z-10" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-b from-transparent to-[#070b14]" />

        <div className="mx-auto grid max-w-7xl gap-14 px-5 pt-28 pb-20 sm:px-8 sm:pt-36 sm:pb-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-10 lg:pt-44 lg:pb-32">
          <div>
            <Reveal>
              <Eyebrow>Built for Bangladesh · বাংলাদেশের জন্য</Eyebrow>
            </Reveal>

            <Reveal delay={80}>
              <h1 className="mt-6 text-4xl leading-[1.08] font-bold tracking-tight text-white text-balance sm:text-5xl lg:text-6xl">
                Your office runs on{" "}
                <span className="landing-strike relative whitespace-nowrap text-slate-500">
                  nine spreadsheets
                </span>{" "}
                <span className="landing-gradient-text">and one brave person</span>
              </h1>
            </Reveal>

            <Reveal delay={160}>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-400 sm:text-lg">
                Amar Office puts people, attendance, leave, payroll, accounts,
                procurement and CRM in one system of record — with the
                Bangladesh Labour Act, the Income Tax Act 2023, BDT and Bangla
                built into the rules rather than bolted on afterwards.
              </p>
            </Reveal>

            <Reveal delay={240}>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link
                  href="/login"
                  className="landing-cta group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 px-6 py-3.5 text-sm font-semibold text-[#04130f] transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-500/25"
                >
                  Sign in to the portal
                  <span className="transition group-hover:translate-x-0.5">
                    &rarr;
                  </span>
                </Link>
                <a
                  href="#payroll"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-6 py-3.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/5"
                >
                  See a month of payroll
                </a>
              </div>
            </Reveal>

            <Reveal delay={320}>
              <dl className="mt-12 grid max-w-xl grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4">
                {[
                  { n: 8, s: "", label: "modules, one truth" },
                  { n: 16, s: "", label: "statutory rules shipped" },
                  { n: 12, s: "", label: "AI features in-flow" },
                  { n: 10, s: "", label: "prebuilt automations" },
                ].map((stat) => (
                  <div key={stat.label}>
                    <dt className="landing-gradient-text text-3xl font-bold tracking-tight sm:text-4xl">
                      <Counter to={stat.n} suffix={stat.s} />
                    </dt>
                    <dd className="mt-1 text-xs leading-snug text-slate-500">
                      {stat.label}
                    </dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>

          {/* mock payroll card, floating */}
          <Reveal delay={200} className="relative">
            <div className="landing-float relative mx-auto max-w-md">
              <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-sky-500/20 blur-2xl" />
              <div className="rounded-2xl border border-white/10 bg-[#0b1220]/90 p-5 shadow-2xl shadow-black/50 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs tracking-wide text-slate-500 uppercase">
                      Payroll run · নভেম্বর ২০২৬
                    </p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      Meghna Edible Oils Ltd
                    </p>
                  </div>
                  <span className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300">
                    Awaiting check
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  {[
                    { k: "Employees", v: "412" },
                    { k: "Gross", v: "৳ 2,84,16,500" },
                    { k: "Tax at source", v: "৳ 11,92,340" },
                    { k: "Net payable", v: "৳ 2,41,08,160" },
                  ].map((cell) => (
                    <div
                      key={cell.k}
                      className="rounded-xl border border-white/5 bg-white/[0.04] p-3"
                    >
                      <p className="text-[11px] text-slate-500">{cell.k}</p>
                      <p className="mt-0.5 text-sm font-semibold text-white">
                        {cell.v}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 space-y-2.5">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
                    AI pre-check · 3 flags
                  </p>
                  {[
                    {
                      tone: "amber",
                      text: "Rumana Haque — net pay up 38% (increment effective 1 Oct, arrears ৳ 46,200)",
                    },
                    {
                      tone: "rose",
                      text: "Shafiqul Islam — bank account changed 4 days ago, not yet verified",
                    },
                    {
                      tone: "emerald",
                      text: "Chattogram branch — Eid holiday moved, 94 attendance days recomputed",
                    },
                  ].map((flag) => (
                    <div
                      key={flag.text}
                      className="flex gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] p-3"
                    >
                      <span
                        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                          flag.tone === "amber"
                            ? "bg-amber-400"
                            : flag.tone === "rose"
                              ? "bg-rose-400"
                              : "bg-emerald-400"
                        }`}
                      />
                      <p className="text-xs leading-relaxed text-slate-400">
                        {flag.text}
                      </p>
                    </div>
                  ))}
                </div>

                <p className="mt-5 border-t border-white/5 pt-4 text-[11px] text-slate-500">
                  Prepared by HR · approval goes to Accounts, then the Director.
                  The preparer cannot approve.
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* --------------------------------------------------------- problem */}
      <section id="problem" className="relative scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead
            eyebrow="The problem"
            title={
              <>
                Nothing here is broken software.
                <br className="hidden sm:block" /> It is{" "}
                <span className="text-rose-300">no software at all.</span>
              </>
            }
            bn="সমস্যা কোথায়"
            lead="A 50–1,000 person head office in Dhaka already has the processes. What it does not have is one place where they are true at the same time."
          />

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PROBLEMS.map((item, i) => (
              <Reveal key={item.title} delay={i * 70}>
                <Panel className="landing-lift h-full border-rose-400/10 hover:border-rose-400/25">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-rose-400/20 bg-rose-400/10 text-rose-300">
                      <Icon d={item.icon} className="size-5" />
                    </span>
                    <span className="text-[11px] font-semibold tracking-[0.16em] text-rose-300/70 uppercase">
                      {item.tag}
                    </span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
                    {item.body}
                  </p>
                </Panel>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <p className="mx-auto mt-12 max-w-3xl rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-base leading-relaxed text-slate-300 sm:text-lg">
              The cost is not the licence nobody bought. It is the week every
              month that senior staff spend reconciling, and the single
              back-dated increment that quietly makes two fiscal years of tax
              wrong.
            </p>
          </Reveal>
        </div>
      </section>

      {/* -------------------------------------------------------- solution */}
      <section
        id="solution"
        className="relative scroll-mt-20 border-y border-white/5 bg-white/[0.015] py-20 sm:py-28"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead
            eyebrow="The answer"
            title={
              <>
                One system of record,{" "}
                <span className="landing-gradient-text">
                  and every rule a setting
                </span>
              </>
            }
            bn="একটি সিস্টেম, সব নিয়ম কনফিগারেবল"
            lead="All money, balances and approval states live in the core. Leave rules, salary heads, tax slabs, holidays, approval chains and numbering formats are company settings with sensible defaults — so a law change is a configuration change, not a code release."
          />

          {/* before / after */}
          <div className="mt-14 space-y-3">
            <Reveal className="hidden gap-4 px-2 sm:grid sm:grid-cols-2">
              <p className="text-xs font-semibold tracking-[0.16em] text-rose-300/70 uppercase">
                Today
              </p>
              <p className="text-xs font-semibold tracking-[0.16em] text-emerald-300/70 uppercase">
                With Amar Office
              </p>
            </Reveal>

            {SWAPS.map((swap, i) => (
              <Reveal key={swap.before} delay={i * 60}>
                <div className="grid overflow-hidden rounded-2xl border border-white/10 sm:grid-cols-2">
                  <div className="flex gap-3 bg-rose-500/[0.06] p-5">
                    <span className="mt-0.5 text-rose-400/70">&times;</span>
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-rose-300/70 uppercase sm:hidden">
                        Today
                      </p>
                      <p className="text-sm leading-relaxed text-slate-400">
                        {swap.before}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3 border-t border-white/10 bg-emerald-500/[0.06] p-5 sm:border-t-0 sm:border-l">
                    <span className="mt-0.5 text-emerald-400">&#10003;</span>
                    <div>
                      <p className="mb-1.5 text-[10px] font-semibold tracking-[0.16em] text-emerald-300/70 uppercase sm:hidden">
                        With Amar Office
                      </p>
                      <p className="text-sm leading-relaxed text-slate-200">
                        {swap.after}
                      </p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* modules */}
          <Reveal className="mt-20 text-center">
            <h3 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Eight modules that already know about each other
            </h3>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-400 sm:text-base">
              Sales commission reaches payroll. Payroll posts its own journal.
              An asset follows the employee who signed for it.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((mod, i) => (
              <Reveal key={mod.title} delay={i * 60}>
                <Panel className="landing-lift group h-full">
                  <span className="grid size-11 place-items-center rounded-xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/20 to-teal-500/10 text-emerald-300 transition group-hover:scale-105">
                    <Icon d={mod.icon} className="size-5.5" />
                  </span>
                  <h4 className="mt-4 flex flex-wrap items-baseline gap-2 text-base font-semibold text-white">
                    {mod.title}
                    <span className="text-xs font-normal text-emerald-300/60">
                      {mod.bn}
                    </span>
                  </h4>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    {mod.body}
                  </p>
                </Panel>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- payroll */}
      <section id="payroll" className="relative scroll-mt-20 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead
            eyebrow="A month of payroll"
            title={
              <>
                Ten steps, in order,{" "}
                <span className="landing-gradient-text">every month</span>
              </>
            }
            bn="প্রতি মাসের বেতন প্রক্রিয়া"
            lead="Payroll is the anchor: used every month, painful to get wrong. The run is the same ten steps whether you pay 60 people or 900, and it ends with the journal already in accounts."
          />

          <ol className="relative mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {PAYROLL_STEPS.map((step, i) => (
              <Reveal key={step.title} delay={i * 55} className="h-full">
                <li className="relative flex h-full gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5 lg:flex-col lg:gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full border border-emerald-400/30 bg-[#0b1220] text-sm font-bold text-emerald-300">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                      {step.body}
                    </p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {[
              {
                title: "The hard cases are the test suite",
                body: "A joiner and a leaver in the same month. A back-dated increment spanning the fiscal-year boundary. Maternity leave at wage ÷ 26 per day crossing two months. A final settlement where deductions exceed dues. An Eid holiday moved after attendance was locked. Each one is a worked example that must pass before a release ships.",
              },
              {
                title: "It agrees to the taka",
                body: "Payslip totals, the bank disbursement file and the salary journal are reconciled to the taka under your own rounding rule — not close enough, equal.",
              },
              {
                title: "Nobody signs their own run",
                body: "Maker–checker is enforced by the engine, not by office habit, and once finalized the run is locked. A correction is a reversal with a reason, so the history stays readable a year later.",
              },
            ].map((card, i) => (
              <Reveal key={card.title} delay={i * 80}>
                <Panel className="h-full">
                  <h3 className="text-base font-semibold text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
                    {card.body}
                  </p>
                </Panel>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- AI */}
      <section
        id="ai"
        className="relative isolate scroll-mt-20 overflow-hidden border-y border-white/5 bg-white/[0.015] py-20 sm:py-28"
      >
        <div className="landing-orb pointer-events-none absolute top-1/4 left-1/2 -z-10 size-[36rem] -translate-x-1/2 rounded-full" />
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead
            eyebrow="The AI layer"
            title={
              <>
                AI advises.{" "}
                <span className="landing-gradient-text">Humans decide.</span>
              </>
            }
            bn="এআই পরামর্শ দেয়, সিদ্ধান্ত মানুষের"
            lead="Not a chatbot in the corner. Twelve features that each sit where someone already works, save one specific chore, and end in a human decision — nothing is approved, posted, hired or rejected by a model."
          />

          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AI_FEATURES.map(([name, who, what], i) => (
              <Reveal key={name} delay={i * 45}>
                <div className="landing-lift group flex h-full gap-3.5 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-sky-400/20 bg-sky-400/10 text-sky-300">
                    <Icon d={ICONS.spark} className="size-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{name}</h3>
                    <p className="mt-1 text-[11px] font-medium tracking-wide text-sky-300/70 uppercase">
                      {who}
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                      {what}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-16 text-center">
            <h3 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Four guardrails we do not trade away
            </h3>
          </Reveal>

          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {GUARDRAILS.map((rail, i) => (
              <Reveal key={rail.title} delay={i * 70}>
                <Panel className="h-full border-sky-400/10">
                  <span className="grid size-10 place-items-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-300">
                    <Icon d={ICONS.shield} className="size-5" />
                  </span>
                  <h4 className="mt-4 text-base font-semibold text-white">
                    {rail.title}
                  </h4>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    {rail.body}
                  </p>
                </Panel>
              </Reveal>
            ))}
          </div>

          <Reveal delay={100}>
            <p className="mx-auto mt-10 max-w-3xl text-center text-sm leading-relaxed text-slate-500">
              A CV, a receipt or a lead e-mail can carry hidden instructions, so
              outside content is treated as data and can never trigger an
              action. Protected characteristics are stripped before any scoring
              of people, and a feature that falls below its measured bar in
              production is switched off until it is fixed.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------ automation */}
      <section
        id="automation"
        className="relative scroll-mt-20 overflow-hidden py-20 sm:py-28"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead
            eyebrow="Automation"
            title={
              <>
                The dull half of the month{" "}
                <span className="landing-gradient-text">runs itself</span>
              </>
            }
            bn="অটোমেশন"
            lead="The core emits an event; workflows react and call back through the API. They never hold the truth, so a failed workflow can be replayed without corrupting a balance."
          />
        </div>

        <div className="landing-fade-x mt-14">
          {[0, 1].map((row) => (
            <div
              key={row}
              className="landing-marquee flex w-max gap-4 py-2"
              data-reverse={row === 1 ? "yes" : "no"}
            >
              {[0, 1].map((copy) => (
                <div key={copy} className="flex gap-4" aria-hidden={copy === 1}>
                  {WORKFLOWS.slice(row * 5, row * 5 + 5).map((flow) => (
                    <div
                      key={flow[0]}
                      className="w-64 shrink-0 rounded-2xl border border-white/10 bg-white/[0.035] p-5 sm:w-[19rem]"
                    >
                      <code className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">
                        {flow[0]}
                      </code>
                      <p className="mt-3 text-sm leading-relaxed text-slate-300">
                        {flow[1]}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="mx-auto mt-14 max-w-7xl px-5 sm:px-8">
          <div className="grid gap-5 sm:grid-cols-3">
            {[
              {
                icon: ICONS.bolt,
                title: "Reminders that escalate",
                body: "An approval that sits past its deadline nudges by e-mail, SMS or WhatsApp with a one-click link, then escalates to the approver's own manager.",
              },
              {
                icon: ICONS.replay,
                title: "Replay, don't guess",
                body: "Every event delivery is recorded with its outcome. A workflow that failed at 2 a.m. is retried, not reconstructed from memory.",
              },
              {
                icon: ICONS.spark,
                title: "Your own process, too",
                body: "On the Intelligent tier a workflow can be built for how your office actually works, inside your tenant's data only.",
              },
            ].map((card, i) => (
              <Reveal key={card.title} delay={i * 80}>
                <Panel className="h-full">
                  <span className="grid size-10 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                    <Icon d={card.icon} className="size-5" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    {card.body}
                  </p>
                </Panel>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ compliance */}
      <section
        id="compliance"
        className="relative scroll-mt-20 border-y border-white/5 bg-white/[0.015] py-20 sm:py-28"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead
            eyebrow="Bangladesh compliance"
            title={
              <>
                The amendment ships as a{" "}
                <span className="landing-gradient-text">rule pack</span>, not a
                support ticket
              </>
            }
            bn="বাংলাদেশ শ্রম আইন ও কর"
            lead="Statutory values are effective-dated settings, published as a versioned Bangladesh rule pack that each company accepts from a date of its own. The 2025 Ordinance already changed six of them."
          />

          <div className="mt-14 grid gap-4 lg:grid-cols-2">
            {RULES.map((row, i) => (
              <Reveal key={row.rule} delay={i * 60}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                    <Icon d={ICONS.scale} className="size-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">
                      {row.rule}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-400">{row.value}</p>
                  </div>
                  <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
                    {row.state}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {[
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
            ].map((card, i) => (
              <Reveal key={card.title} delay={i * 80}>
                <Panel className="h-full">
                  <h3 className="text-base font-semibold text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-400">
                    {card.body}
                  </p>
                </Panel>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- trust */}
      <section className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead
            eyebrow="How it holds up"
            title={
              <>
                Six rules that settle{" "}
                <span className="landing-gradient-text">every argument</span>
              </>
            }
            lead="These are not features on a checklist; they are the constraints the whole system was designed around, and they are why the numbers can be trusted a year later."
          />

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.map((card, i) => (
              <Reveal key={card.title} delay={i * 70}>
                <Panel className="landing-lift h-full">
                  <span className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-emerald-300">
                    <Icon d={card.icon} className="size-5" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    {card.body}
                  </p>
                </Panel>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- pricing */}
      <section
        id="pricing"
        className="scroll-mt-20 border-y border-white/5 bg-white/[0.015] py-20 sm:py-28"
      >
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <SectionHead
            eyebrow="Plans"
            title={
              <>
                Priced per active employee,{" "}
                <span className="landing-gradient-text">per month</span>
              </>
            }
            bn="তিনটি প্ল্যান"
            lead="Three tiers, each a superset of the one before. Taka price points are being validated with prospects before they are fixed, so the plans below show what you get rather than a number we would have to change."
          />

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {TIERS.map((tier, i) => (
              <Reveal key={tier.name} delay={i * 90} className="h-full">
                <div
                  className={`landing-lift relative flex h-full flex-col overflow-hidden rounded-2xl border p-7 ${
                    tier.featured
                      ? "border-emerald-400/40 bg-gradient-to-b from-emerald-400/10 to-white/[0.02]"
                      : "border-white/10 bg-white/[0.035]"
                  }`}
                >
                  {tier.featured ? (
                    <span className="absolute top-5 right-5 rounded-full bg-emerald-400 px-2.5 py-1 text-[10px] font-bold tracking-wide text-[#04130f] uppercase">
                      Most offices
                    </span>
                  ) : null}
                  <h3 className="flex items-baseline gap-2 text-xl font-bold text-white">
                    {tier.name}
                    <span className="text-xs font-normal text-emerald-300/60">
                      {tier.bn}
                    </span>
                  </h3>
                  <p className="mt-1.5 text-sm text-slate-400">{tier.line}</p>
                  <ul className="mt-6 space-y-3">
                    {tier.items.map((item) => (
                      <li key={item} className="flex gap-2.5 text-sm">
                        <span className="mt-0.5 text-emerald-400">
                          &#10003;
                        </span>
                        <span className="text-slate-300">{item}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-8 flex-1" />
                  <Link
                    href="/enquiry/demo"
                    className={`rounded-xl px-5 py-3 text-center text-sm font-semibold transition hover:-translate-y-0.5 ${
                      tier.featured
                        ? "bg-gradient-to-r from-emerald-400 to-teal-500 text-[#04130f] hover:shadow-lg hover:shadow-emerald-500/25"
                        : "border border-white/15 text-white hover:border-white/30 hover:bg-white/5"
                    }`}
                  >
                    Talk to us about {tier.name}
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={120}>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                [
                  "Implementation",
                  "A one-time fee covers setup, data migration from your sheets, and training your HR and accounts staff.",
                ],
                [
                  "On your own servers",
                  "Groups and banks that must keep data in-house can take an annual licence with maintenance, hosted in Bangladesh.",
                ],
                [
                  "Add-ons",
                  "SMS bundles, biometric device integration, and custom workflows for a process that is genuinely yours.",
                ],
              ].map(([title, body]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"
                >
                  <h4 className="text-sm font-semibold text-white">{title}</h4>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------------------- CTA */}
      <section className="relative isolate overflow-hidden py-24 sm:py-32">
        <div className="landing-aurora landing-aurora-soft pointer-events-none absolute inset-0 -z-10" />
        <div className="mx-auto max-w-3xl px-5 text-center sm:px-8">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight text-white text-balance sm:text-4xl lg:text-5xl">
              Start with the month you dread
            </h2>
            <p className="mt-5 text-base leading-relaxed text-slate-400 sm:text-lg">
              Bring one real payroll month — joiners, leavers, a back-dated
              increment, the bonus nobody agrees on. If the run reconciles to
              the taka, the rest of the office is the easy part.
            </p>
            <p className="mt-3 text-sm text-emerald-300/80">
              একটি মাসের বেতন দিয়েই শুরু করুন
            </p>
          </Reveal>
          <Reveal delay={120}>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link
                href="/enquiry/demo"
                className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 px-7 py-4 text-sm font-semibold text-[#04130f] transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-500/25"
              >
                Request a walkthrough
                <span className="transition group-hover:translate-x-0.5">
                  &rarr;
                </span>
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-7 py-4 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/5"
              >
                I already have an account
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------------- footer */}
      <footer className="border-t border-white/10 py-12">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 sm:px-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-base font-bold text-[#04130f]">
                অ
              </span>
              <span className="text-sm font-bold text-white">Amar Office</span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-slate-500">
              A multi-tenant ERP and CRM portal for Bangladeshi corporate head
              offices of 50–1,000 staff. Factory wage-board payroll is a
              separate compliance package and out of scope.
            </p>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
            {[
              {
                head: "Product",
                links: [
                  ["The problem", "#problem"],
                  ["The answer", "#solution"],
                  ["Payroll", "#payroll"],
                  ["Plans", "#pricing"],
                ],
              },
              {
                head: "Built on",
                links: [
                  ["AI guardrails", "#ai"],
                  ["Automation", "#automation"],
                  ["Compliance", "#compliance"],
                ],
              },
              {
                head: "Account",
                links: [
                  ["Sign in", "/login"],
                  ["Request a walkthrough", "/enquiry/demo"],
                ],
              },
            ].map((group) => (
              <div key={group.head}>
                <p className="text-[11px] font-semibold tracking-[0.16em] text-slate-400 uppercase">
                  {group.head}
                </p>
                <ul className="mt-3 space-y-2">
                  {group.links.map(([label, href]) => (
                    <li key={label}>
                      <a
                        href={href}
                        className="text-sm text-slate-500 transition hover:text-white"
                      >
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mx-auto mt-10 max-w-7xl border-t border-white/5 px-5 pt-6 sm:px-8">
          <p className="text-xs text-slate-600">
            Statutory values shown on this page are the shipped defaults and are
            configurable per company; they are not legal advice. Confirm the
            final Act and Rules text with your own adviser before go-live.
          </p>
        </div>
      </footer>
    </div>
  );
}
