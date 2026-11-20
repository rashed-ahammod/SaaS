/**
 * Public landing page, the front door at /: what the product is for, the
 * problem a Bangladeshi head office has today, and how this portal answers
 * it. No sign-in — src/proxy.ts lets this one path through; the employee app
 * starts at /home.
 *
 * It is laid out as a ledger (see src/components/landing/kit.tsx): one
 * 12-column measure, hairline rules instead of boxes, register labels in the
 * mono face, figures in tabular numerals. Copy lives in content.ts, movement
 * in motion.tsx, tokens in the landing block of globals.css.
 */
import type { Metadata } from "next";
import Link from "next/link";
import {
  AI_FEATURES,
  AUTOMATION_NOTES,
  COMMERCIAL,
  COMPLIANCE_NOTES,
  DAY,
  GUARDRAILS,
  MODULES,
  PAYROLL_NOTES,
  PAYROLL_STEPS,
  PRINCIPLES,
  PROBLEMS,
  RULES,
  SPECIMEN,
  SWAPS,
  TIERS,
} from "@/components/landing/content";
import {
  Band,
  bangla,
  Cell,
  Chip,
  Figure,
  Head,
  Label,
  Measure,
  Note,
  Primary,
  Quiet,
  Row,
  Rows,
} from "@/components/landing/kit";
import { Counter, Nav, Progress, Rail, Reveal } from "@/components/landing/motion";

export const metadata: Metadata = {
  title: "Amar Office · HR, payroll, accounts and CRM for a Bangladeshi office",
  description:
    "One system of record for people, attendance, leave, payroll, accounts, procurement and CRM — built around the Bangladesh Labour Act, the Income Tax Act 2023 and BDT, with AI that drafts and flags but never decides.",
};

const STATS = [
  { to: 8, caption: "modules on one system of record" },
  { to: 16, caption: "statutory values set up and ready" },
  { to: 12, caption: "AI features, each inside a screen" },
  { to: 10, caption: "routine jobs that run themselves" },
];

export default function LandingPage() {
  return (
    <div className="landing min-h-screen bg-ink text-paper selection:bg-accent/25 selection:text-paper">
      <Progress />
      <Nav />

      <a
        href="#problem"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-paper focus:px-4 focus:py-2 focus:text-sm focus:text-ink"
      >
        Skip to the content
      </a>

      {/* ------------------------------------------------------------ hero */}
      <section id="top" className="pt-24 sm:pt-30">
        <Measure>
          <div className="grid gap-14 lg:grid-cols-12 lg:gap-8">
            <div className="lg:col-span-7">
              <Reveal>
                <div className="flex items-center gap-4">
                  <Label tone="accent">Built for Bangladesh</Label>
                  <span className="rule-draw h-px flex-1 bg-line" />
                  <span className="text-xs text-faint">বাংলাদেশের জন্য</span>
                </div>
              </Reveal>

              <Reveal delay={60}>
                <h1 className="mt-10 text-[clamp(2.3rem,6vw,4.1rem)] leading-[1.03] font-bold tracking-[-0.038em] text-paper">
                  Your office runs on{" "}
                  <span className="strike relative whitespace-nowrap text-faint">
                    nine spreadsheets
                  </span>{" "}
                  and one brave person
                </h1>
              </Reveal>

              <Reveal delay={120}>
                <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted">
                  Amar Office puts people, attendance, leave, payroll,
                  accounts, procurement and CRM on one system of record — with
                  the Bangladesh Labour Act, the Income Tax Act 2023, BDT and
                  Bangla written into the rules rather than bolted on
                  afterwards.
                </p>
              </Reveal>

              <Reveal delay={180}>
                <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3">
                  <Primary href="/login">Sign in to the portal</Primary>
                  <Quiet href="#payroll">See a month of payroll</Quiet>
                </div>
              </Reveal>
            </div>

            {/* the specimen run: a payslip, not a glass card */}
            <Reveal delay={160} className="lg:col-span-5">
              <figure className="relative border border-line bg-ink-2">
                <figcaption className="border-b border-line px-5 py-3">
                  <Label>Payroll run</Label>
                </figcaption>

                <div className="px-5 py-5">
                  <p className="text-base font-semibold text-paper">
                    {SPECIMEN.company}
                  </p>
                  <p className="mt-1 text-xs text-faint">{SPECIMEN.month}</p>

                  <dl className="mt-5 border-t border-line">
                    {SPECIMEN.lines.map((line, i) => (
                      <div
                        key={line.label}
                        className={`flex items-baseline justify-between gap-4 border-b border-line py-2.5 ${
                          i === SPECIMEN.lines.length - 1
                            ? "border-b-0 pt-3"
                            : ""
                        }`}
                      >
                        <dt
                          className={`text-xs ${
                            i === SPECIMEN.lines.length - 1
                              ? "font-semibold text-paper"
                              : "text-muted"
                          }`}
                        >
                          {line.label}
                        </dt>
                        <dd
                          className={`font-ledger text-sm tabular-nums ${
                            i === SPECIMEN.lines.length - 1
                              ? "font-semibold text-accent"
                              : "text-paper"
                          }`}
                        >
                          {line.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="border-t border-line px-5 py-4">
                  <Label>AI pre-check · 3 flags</Label>
                  <ul className="mt-3 space-y-2.5">
                    {SPECIMEN.flags.map((flag) => (
                      <li key={flag.text} className="flex gap-3">
                        <span
                          className={`font-ledger text-xs ${
                            flag.tone === "warn"
                              ? "text-warn"
                              : flag.tone === "flag"
                                ? "text-flag"
                                : "text-accent"
                          }`}
                          aria-hidden="true"
                        >
                          [{flag.mark}]
                        </span>
                        <p className="text-xs leading-relaxed text-muted">
                          {flag.text}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>

                <p className="border-t border-line px-5 py-3 text-[11px] leading-relaxed text-faint">
                  <span className="font-ledger">{SPECIMEN.ref}</span> ·{" "}
                  {SPECIMEN.foot}
                </p>

                <span className="stamp absolute -top-3 -right-3 border-2 border-warn/70 px-3 py-1.5 font-ledger text-[10px] tracking-[0.2em] text-warn uppercase">
                  Awaiting check
                </span>
              </figure>
            </Reveal>
          </div>

          {/* the figures, ruled into the same measure */}
          <Reveal delay={220}>
            <dl className="mt-20 grid grid-cols-2 border-t border-l border-line lg:grid-cols-4">
              {STATS.map((stat) => (
                <div
                  key={stat.caption}
                  className="border-r border-b border-line"
                >
                  <Figure
                    value={<Counter to={stat.to} />}
                    caption={stat.caption}
                  />
                </div>
              ))}
            </dl>
          </Reveal>
        </Measure>
      </section>

      {/* --------------------------------------------------------- problem */}
      <Band id="problem" className="mt-20 sm:mt-28">
        <Head
          index={1}
          mark="The problem"
          bn="সমস্যা"
          title={
            <>
              Nothing here is broken software. It is{" "}
              <span className="text-flag">no software at all.</span>
            </>
          }
          lead="A 50–1,000 person head office in Dhaka already has the processes. What it does not have is one place where they are all true at the same time."
        />

        <Rows className="mt-14">
          {PROBLEMS.map((item, i) => (
            <Reveal key={item.title} delay={i * 50}>
              <Row>
                <div className="grid items-baseline gap-x-8 gap-y-2 py-6 lg:grid-cols-12">
                  <div className="flex items-center gap-3 lg:col-span-2">
                    <span className="font-ledger text-[10px] tabular-nums text-faint">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <Label tone="flag">{item.tag}</Label>
                  </div>
                  <h3 className="text-lg leading-snug font-semibold text-paper lg:col-span-4">
                    {item.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted lg:col-span-6">
                    {item.body}
                  </p>
                </div>
              </Row>
            </Reveal>
          ))}
        </Rows>

        <Reveal delay={100}>
          <p className="mt-12 max-w-3xl border-l-2 border-flag/50 pl-6 text-lg leading-relaxed text-paper">
            The cost is not the licence nobody bought. It is the week every
            month that senior staff spend reconciling, and the single
            back-dated increment that quietly makes two fiscal years of tax
            wrong.
          </p>
        </Reveal>
      </Band>

      {/* ---------------------------------------------------------- answer */}
      <Band id="answer">
        <Head
          index={2}
          mark="The answer"
          bn="সমাধান"
          title="One system of record, and every rule a setting"
          lead="Money, balances and approval states live in one place. Leave rules, salary heads, tax slabs, holidays, approval chains and document numbering are settings your own staff can change — so an amendment is an afternoon’s work, not a new version of the software."
        />

        {/* the ledger: today on the left, the answer on the right */}
        <Reveal className="mt-14">
          <div className="hidden border-t border-line sm:grid sm:grid-cols-2">
            <div className="border-r border-line px-5 py-3">
              <Label tone="flag">Today</Label>
            </div>
            <div className="px-5 py-3">
              <Label tone="accent">With Amar Office</Label>
            </div>
          </div>
        </Reveal>

        <Rows className="sm:border-t-0">
          {SWAPS.map((swap, i) => (
            <Reveal key={swap.before} delay={i * 50}>
              <Row interactive={false}>
                <div className="grid sm:grid-cols-2">
                  <div className="flex gap-3 border-b border-line px-5 py-5 sm:border-r sm:border-b-0">
                    <span
                      className="font-ledger text-xs text-flag/70"
                      aria-hidden="true"
                    >
                      ×
                    </span>
                    <div>
                      <Label tone="flag" className="mb-2 block sm:hidden">
                        Today
                      </Label>
                      <p className="text-sm leading-relaxed text-muted">
                        {swap.before}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3 px-5 py-5">
                    <span
                      className="font-ledger text-xs text-accent"
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    <div>
                      <Label tone="accent" className="mb-2 block sm:hidden">
                        With Amar Office
                      </Label>
                      <p className="text-sm leading-relaxed text-paper">
                        {swap.after}
                      </p>
                    </div>
                  </div>
                </div>
              </Row>
            </Reveal>
          ))}
        </Rows>

        {/* the eight modules, as a ruled matrix */}
        <Reveal className="mt-20">
          <div className="flex items-baseline gap-4">
            <h3 className="text-xl font-semibold text-paper">
              Eight modules that already know about each other
            </h3>
            <span className="rule-draw hidden h-px flex-1 bg-line sm:block" />
          </div>
          <p className="mt-3 max-w-2xl text-sm text-muted">
            Sales commission reaches payroll. Payroll posts its own journal. An
            asset follows the employee who signed for it.
          </p>
        </Reveal>

        <div className="mt-8 grid border-t border-l border-line sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((mod, i) => (
            <Reveal key={mod.title} delay={i * 40}>
              <Cell className="group h-full transition-colors hover:bg-paper/[0.025]">
                <div className="flex items-baseline justify-between">
                  <span className="font-ledger text-[10px] tabular-nums text-faint">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[11px] text-faint">{mod.bn}</span>
                </div>
                <h4 className="mt-5 text-base font-semibold text-paper transition-colors group-hover:text-accent">
                  {mod.title}
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {mod.body}
                </p>
              </Cell>
            </Reveal>
          ))}
        </div>
      </Band>

      {/* --------------------------------------------------------- payroll */}
      <Band id="payroll">
        <Head
          index={3}
          mark="A month of payroll"
          bn="প্রতি মাসের বেতন"
          title="Ten steps, in order, every month"
          lead="Payroll is the anchor: used every month, painful to get wrong. The run is the same ten steps whether you pay 60 people or 900, and it ends with the journal already in accounts."
        />

        <div className="mt-14">
          <Rail>
            <ol>
              {PAYROLL_STEPS.map((step, i) => (
                <Reveal key={step.title} delay={i * 40}>
                  <li className="group relative grid gap-x-8 gap-y-2 border-b border-line py-5 pl-14 sm:pl-20 lg:grid-cols-12 lg:pl-0">
                    <span className="absolute top-5 left-0 z-10 grid size-9 place-items-center border border-line bg-ink font-ledger text-xs tabular-nums text-muted transition-colors group-hover:border-accent group-hover:text-accent sm:size-10">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-base font-semibold text-paper lg:col-span-4 lg:col-start-3">
                      {step.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted lg:col-span-6 lg:col-start-7">
                      {step.body}
                    </p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </Rail>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-3">
          {PAYROLL_NOTES.map((note, i) => (
            <Reveal key={note.title} delay={i * 60}>
              <Note {...note} />
            </Reveal>
          ))}
        </div>
      </Band>

      {/* -------------------------------------------------------------- AI */}
      <Band id="ai">
        <Head
          index={4}
          mark="The AI layer"
          bn="এআই"
          title={
            <>
              AI advises. <span className="text-accent">Humans decide.</span>
            </>
          }
          lead="Not a chatbot in the corner. Twelve features that each sit where someone already works, save one specific chore, and end in a human decision — nothing is approved, posted, hired or rejected by a model."
        />

        <Rows className="mt-14">
          <Row interactive={false}>
            <div className="hidden gap-x-8 py-3 lg:grid lg:grid-cols-12">
              <Label className="lg:col-span-4">Feature</Label>
              <Label className="lg:col-span-3">Who uses it</Label>
              <Label className="lg:col-span-5">What it does</Label>
            </div>
          </Row>
          {AI_FEATURES.map((feature, i) => (
            <Reveal key={feature.name} delay={i * 30}>
              <Row>
                <div className="grid items-baseline gap-x-8 gap-y-1.5 py-4 lg:grid-cols-12">
                  <h3 className="flex gap-3 text-sm font-semibold text-paper lg:col-span-4">
                    <span className="font-ledger text-[10px] tabular-nums text-faint">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {feature.name}
                  </h3>
                  <p className="font-ledger text-[10px] tracking-[0.14em] text-accent/80 uppercase lg:col-span-3">
                    {feature.who}
                  </p>
                  <p className="text-sm leading-relaxed text-muted lg:col-span-5">
                    {feature.what}
                  </p>
                </div>
              </Row>
            </Reveal>
          ))}
        </Rows>

        <Reveal className="mt-16">
          <div className="flex items-baseline gap-4">
            <h3 className="text-xl font-semibold text-paper">
              Four guardrails we do not trade away
            </h3>
            <span className="rule-draw hidden h-px flex-1 bg-line sm:block" />
          </div>
        </Reveal>

        <div className="mt-8 grid border-t border-l border-line sm:grid-cols-2">
          {GUARDRAILS.map((rail, i) => (
            <Reveal key={rail.title} delay={i * 60}>
              <Cell className="h-full">
                <span className="font-ledger text-[10px] tabular-nums text-accent">
                  {String(i + 1).padStart(2, "0")} / {bangla(i + 1)}
                </span>
                <h4 className="mt-4 text-base font-semibold text-paper">
                  {rail.title}
                </h4>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {rail.body}
                </p>
              </Cell>
            </Reveal>
          ))}
        </div>

        <Reveal delay={80}>
          <p className="mt-10 max-w-3xl text-sm leading-relaxed text-faint">
            A CV, a receipt or an e-mail from outside can carry hidden
            instructions, so anything that arrives from outside is read as
            information and can never set an action going on its own.
            Protected characteristics are removed before any scoring of
            people, and every one of these features can be switched off by
            you.
          </p>
        </Reveal>
      </Band>

      {/* ------------------------------------------------------ automation */}
      <Band id="automation">
        <Head
          index={5}
          mark="Automation"
          bn="অটোমেশন"
          title="The dull half of the month runs itself"
          lead="Work that always follows the same rule does not need a person to carry it. The chasing, the filing and the reminding happen on their own, and the office is told only when something needs a decision."
        />

        <Reveal className="mt-14">
          <div className="border border-line bg-ink-2">
            <div className="flex items-center gap-3 border-b border-line px-5 py-3">
              <span className="blink size-1.5 rounded-full bg-accent" />
              <Label>An ordinary day, start to finish</Label>
            </div>
            <div className="ticker-frame h-[21rem] overflow-hidden sm:h-[24rem]">
              <div className="ticker">
                {[0, 1].map((copy) => (
                  <ul key={copy} aria-hidden={copy === 1}>
                    {DAY.map((entry) => (
                      <li
                        key={entry.when + entry.at}
                        className="grid grid-cols-[3.2rem_1fr] items-baseline gap-x-4 gap-y-1 border-b border-line px-5 py-3.5 sm:grid-cols-[3.5rem_15rem_1fr]"
                      >
                        <span className="font-ledger text-[11px] tabular-nums text-faint">
                          {entry.at}
                        </span>
                        <span className="text-sm font-semibold text-paper">
                          {entry.when}
                        </span>
                        <span className="col-span-2 text-sm text-muted sm:col-span-1">
                          {entry.what}
                        </span>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-8 lg:grid-cols-3">
          {AUTOMATION_NOTES.map((note, i) => (
            <Reveal key={note.title} delay={i * 60}>
              <Note {...note} />
            </Reveal>
          ))}
        </div>
      </Band>

      {/* ------------------------------------------------------ compliance */}
      <Band id="compliance">
        <Head
          index={6}
          mark="Bangladesh compliance"
          bn="শ্রম আইন ও কর"
          title="An amendment is an afternoon’s settings work, not a support ticket"
          lead="Every statutory value is a setting with a date it takes effect from, and each company adopts a change from the date that applies to it. The 2025 Ordinance already moved six of the values below."
        />

        <Reveal className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border border-b-0 border-line px-5 py-3">
            <Label tone="paper">Bangladesh statutory defaults</Label>
            <Label>Each value carries its own effective date</Label>
          </div>
        </Reveal>

        <Rows className="border-x border-line">
          {RULES.map((row, i) => (
            <Reveal key={row.rule} delay={i * 45}>
              <Row>
                <div className="grid items-baseline gap-x-8 gap-y-1.5 px-5 py-4 lg:grid-cols-12">
                  <h3 className="text-sm font-semibold text-paper lg:col-span-3">
                    {row.rule}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted lg:col-span-7">
                    {row.value}
                  </p>
                  <div className="lg:col-span-2 lg:text-right">
                    <Chip tone={row.state === "New" ? "accent" : "muted"}>
                      {row.state}
                    </Chip>
                  </div>
                </div>
              </Row>
            </Reveal>
          ))}
        </Rows>

        <div className="mt-14 grid gap-8 lg:grid-cols-3">
          {COMPLIANCE_NOTES.map((note, i) => (
            <Reveal key={note.title} delay={i * 60}>
              <Note {...note} />
            </Reveal>
          ))}
        </div>
      </Band>

      {/* ------------------------------------------------------ principles */}
      <Band>
        <Head
          index={7}
          mark="How it holds up"
          title="Six rules that settle every argument"
          lead="Not features on a checklist: these are the constraints the whole system was designed around, and they are why the numbers can still be trusted a year later."
        />

        <div className="mt-14 grid border-t border-l border-line sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((rule, i) => (
            <Reveal key={rule.title} delay={i * 50}>
              <Cell className="h-full transition-colors hover:bg-paper/[0.025]">
                <span className="font-ledger text-2xl tabular-nums text-line-2">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-4 text-base font-semibold text-paper">
                  {rule.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {rule.body}
                </p>
              </Cell>
            </Reveal>
          ))}
        </div>
      </Band>

      {/* ----------------------------------------------------------- plans */}
      <Band id="plans">
        <Head
          index={8}
          mark="Plans"
          bn="প্ল্যান"
          title="Priced per active employee, per month"
          lead="Three plans, each one everything in the plan before it. What you pay follows your active headcount and the plan you need, so the price comes with a conversation rather than off a chart."
        />

        <div className="mt-14 grid border-t border-l border-line lg:grid-cols-3">
          {TIERS.map((tier, i) => (
            <Reveal key={tier.name} delay={i * 70} className="h-full">
              <Cell
                className={`relative flex h-full flex-col ${
                  tier.featured ? "bg-accent/[0.05]" : ""
                }`}
              >
                {tier.featured ? (
                  <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />
                ) : null}
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-lg font-semibold text-paper">
                    {tier.name}
                    <span className="ml-2 text-xs font-normal text-faint">
                      {tier.bn}
                    </span>
                  </h3>
                  {tier.featured ? <Chip tone="accent">Most offices</Chip> : null}
                </div>
                <p className="mt-1.5 text-sm text-muted">{tier.line}</p>

                <ul className="mt-6 border-t border-line">
                  {tier.items.map((item) => (
                    <li
                      key={item}
                      className="flex gap-3 border-b border-line py-2.5 text-sm text-paper"
                    >
                      <span className="text-accent" aria-hidden="true">
                        ✓
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>

                <div className="mt-8 flex-1" />
                <div>
                  {tier.featured ? (
                    <Primary href="/enquiry/demo">Talk to us</Primary>
                  ) : (
                    <Quiet href="/enquiry/demo">Talk to us</Quiet>
                  )}
                </div>
              </Cell>
            </Reveal>
          ))}
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-3">
          {COMMERCIAL.map((note, i) => (
            <Reveal key={note.title} delay={i * 60}>
              <Note {...note} />
            </Reveal>
          ))}
        </div>
      </Band>

      {/* ------------------------------------------------------------- CTA */}
      <section className="border-t border-line py-24 sm:py-32">
        <Measure>
          <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
            <Reveal className="lg:col-span-7">
              <Label tone="accent">Start here</Label>
              <h2 className="mt-7 text-[clamp(2rem,4.4vw,3.3rem)] leading-[1.06] font-bold tracking-[-0.035em] text-paper">
                Start with the month you dread
              </h2>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
                Bring one real payroll month — joiners, leavers, a back-dated
                increment, the bonus nobody agrees on. If the run reconciles to
                the taka, the rest of the office is the easy part.
              </p>
              <p className="mt-3 text-sm text-faint">
                একটি মাসের বেতন দিয়েই শুরু করুন
              </p>
            </Reveal>
            <Reveal delay={80} className="lg:col-span-5">
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3 lg:justify-end">
                <Primary href="/enquiry/demo">Request a walkthrough</Primary>
                <Quiet href="/login">I already have an account</Quiet>
              </div>
            </Reveal>
          </div>
        </Measure>
      </section>

      {/* ---------------------------------------------------------- footer */}
      <footer className="border-t border-line py-12">
        <Measure>
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="flex items-center gap-3">
                <span className="grid size-8 place-items-center border border-line text-sm font-bold text-accent">
                  অ
                </span>
                <span className="font-ledger text-[11px] tracking-[0.22em] text-paper uppercase">
                  Amar Office
                </span>
              </div>
              <p className="mt-5 max-w-sm text-sm leading-relaxed text-faint">
                HR, payroll, accounts and CRM for Bangladeshi corporate head
                offices of 50–1,000 staff. Factory-floor wage-board payroll
                needs a different system; this one is built for the head
                office.
              </p>
            </div>
            <div className="grid gap-8 sm:grid-cols-3 lg:col-span-7">
              {[
                {
                  head: "Product",
                  links: [
                    ["The problem", "#problem"],
                    ["The answer", "#answer"],
                    ["Payroll", "#payroll"],
                    ["Plans", "#plans"],
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
                  <Label>{group.head}</Label>
                  <ul className="mt-4 space-y-2.5">
                    {group.links.map(([label, href]) => (
                      <li key={label}>
                        <Link
                          href={href}
                          className="text-sm text-muted transition-colors hover:text-paper"
                        >
                          {label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-12 border-t border-line pt-6 text-xs leading-relaxed text-faint">
            Statutory values shown on this page are the shipped defaults and
            are configurable per company; they are not legal advice. Confirm
            the final Act and Rules text with your own adviser before go-live.
          </p>
        </Measure>
      </footer>
    </div>
  );
}
