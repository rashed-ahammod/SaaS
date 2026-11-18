/**
 * The release-gate test sets (guide §16, spec §8 guardrail 10): loading, grading
 * and the pass rate. Used by `npm run ai:eval` (which records the result in
 * ai_release_gates and so opens or closes the gate) and by the integration test.
 *
 * Grading is deliberately simple and visible: facts that must, may or must not
 * appear in the answer, after Bangla digits become ASCII and case is ignored.
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import type { BankMatchFacts } from '../../bank/bank-ai.service.js';
import { normalizeForMatch } from '../policies/text.js';

/**
 * What an answer must (or must not) contain: a literal, or a reference to a value the
 * system computes now ({data: ...}). A number written plainly in YAML (`anyOf: [500]`)
 * arrives here as a number, so it is matched as its own text rather than mistaken for a
 * reference.
 */
export type Expected = string | number | { data: string };

export interface EvalCase {
  id: string;
  language: 'bn' | 'en';
  /** assistant cases */
  question?: string;
  tool?: string;
  /** payroll flag cases */
  facts?: {
    flag: { code: string; message: string | null };
    seesSalary: boolean;
  };
  /** bank match cases (graded on "choice: <key or none>") */
  bankFacts?: BankMatchFacts;
  /** document reader cases: a sample file and what it is (graded on the fields read, as JSON) */
  document?: string;
  kind?: 'bill' | 'receipt';
  /** CV screening cases (WP29): the post, and the CV text AS THE MODEL GETS IT (already blind) */
  post?: { title: string; requirements: string[] };
  cv?: string;
  /** Sales assistant cases (WP31): the ask and the facts, with no name or contact detail */
  assist?: {
    ask: 'score' | 'next_step' | 'follow_up' | 'quotation_text' | 'call_note';
    subject: 'lead' | 'customer';
    about: {
      organisation: string | null;
      district: string | null;
      customerType?: string | null;
      source?: string | null;
      daysOld?: number | null;
      state?: string | null;
    };
    said: string | null;
    activities: Array<{ kind: string; subject: string; daysAgo: number }>;
    opportunities: Array<{
      title: string;
      value: string;
      probability: number;
      stage: string | null;
      state: string;
      expectedCloseOn: string;
    }>;
    dues?: { owed: string; overdue: string } | null;
    note?: string | null;
  };
  /** Review drafting cases (WP30): the goals and the year's feedback, with no name in them */
  review?: {
    period: { from: string; to: string; kind: string };
    goals: Array<{
      title: string;
      target: string | null;
      weight: number;
      selfScore: number | null;
      managerScore: number | null;
    }>;
    feedback: Array<{ kind: string; body: string }>;
    selfReview: string | null;
    weightedScore: number | null;
  };
  allOf?: Expected[];
  anyOf?: Expected[];
  noneOf?: Expected[];
}

export interface CaseOutcome {
  id: string;
  language: 'bn' | 'en';
  passed: boolean;
  failures: string[];
  answer: string;
  toolsUsed: string[];
}

export interface EvalReport {
  cases: number;
  passed: number;
  passRate: number;
  requiredRate: number;
  gatePassed: boolean;
  outcomes: CaseOutcome[];
}

export function loadCases(file: string): EvalCase[] {
  const cases = parse(readFileSync(file, 'utf8')) as EvalCase[];
  const ids = new Set<string>();
  for (const c of cases) {
    if (!c.id || ids.has(c.id))
      throw new Error(`Test case without a unique id in ${file}: ${c.id}`);
    if (
      !c.question &&
      !c.facts &&
      !c.bankFacts &&
      !c.document &&
      !c.cv &&
      !c.review &&
      !c.assist
    )
      throw new Error(`Test case ${c.id} has neither a question nor facts`);
    if (c.cv && !c.post)
      throw new Error(`CV screening case ${c.id} has no post to match against`);
    ids.add(c.id);
  }
  return cases;
}

/** Failure reasons; empty = passed. resolve() turns {data: ...} into the value expected now. */
export function grade(
  c: EvalCase,
  answer: string,
  toolsUsed: string[],
  resolve: (ref: string) => string,
): string[] {
  const text = normalizeForMatch(answer);
  const value = (e: Expected) =>
    normalizeForMatch(typeof e === 'object' ? resolve(e.data) : String(e));
  const failures: string[] = [];
  if (!answer.trim()) failures.push('empty answer');
  if (c.tool && !toolsUsed.includes(c.tool))
    failures.push(
      `did not use ${c.tool} (used: ${toolsUsed.join(', ') || 'none'})`,
    );
  for (const e of c.allOf ?? [])
    if (!text.includes(value(e))) failures.push(`missing "${value(e)}"`);
  if (c.anyOf?.length && !c.anyOf.some((e) => text.includes(value(e))))
    failures.push(`none of ${c.anyOf.map((e) => `"${value(e)}"`).join(', ')}`);
  for (const e of c.noneOf ?? [])
    if (text.includes(value(e)))
      failures.push(`must not contain "${value(e)}"`);
  return failures;
}

/** Runs every case one after the other (a quota-friendly pace) and computes the pass rate. */
export async function runCases(
  cases: EvalCase[],
  requiredRate: number,
  ask: (c: EvalCase) => Promise<{ answer: string; toolsUsed: string[] }>,
  resolve: (ref: string) => string,
): Promise<EvalReport> {
  const outcomes: CaseOutcome[] = [];
  for (const c of cases) {
    try {
      const { answer, toolsUsed } = await ask(c);
      const failures = grade(c, answer, toolsUsed, resolve);
      outcomes.push({
        id: c.id,
        language: c.language,
        passed: !failures.length,
        failures,
        answer,
        toolsUsed,
      });
    } catch (err) {
      outcomes.push({
        id: c.id,
        language: c.language,
        passed: false,
        failures: [`error: ${(err as Error).message}`],
        answer: '',
        toolsUsed: [],
      });
    }
  }
  const passed = outcomes.filter((o) => o.passed).length;
  const passRate = cases.length ? passed / cases.length : 0;
  return {
    cases: cases.length,
    passed,
    passRate,
    requiredRate,
    gatePassed: passRate >= requiredRate,
    outcomes,
  };
}
