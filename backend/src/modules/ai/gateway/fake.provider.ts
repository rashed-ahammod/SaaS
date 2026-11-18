/**
 * A deterministic stand-in for a model (AI_PROVIDER=fake): for automated tests,
 * the CI run of the test set, and demos without a provider account. Never in
 * production (config refuses it).
 *
 * It behaves like a careful, unimaginative assistant:
 *   - picks ONE tool from keywords in the question (balance, payslip,
 *     attendance, otherwise the policy search);
 *   - answers from the tool result only: the best-matching policy sentence with
 *     its source, or the numbers the tool returned;
 *   - explains a payroll flag from the facts it was given.
 * So with this provider the test set measures the plumbing (retrieval, tools,
 * access, masking), not language quality; run it with the real provider for that.
 */
import { normalizeForMatch, sentences, words } from '../policies/text.js';
import type {
  AiCallRequest,
  AiCallResult,
  AiMessage,
  AiProvider,
  AiToolCall,
} from './provider.js';

const ROUTES: Array<{
  tool: string;
  input: Record<string, unknown>;
  match: RegExp;
}> = [
  {
    tool: 'get_my_leave_balances',
    input: {},
    match: /\b(my (leave )?balances?|left|remaining)\b|বাকি|অবশিষ্ট|ব্যালেন্স/i,
  },
  {
    tool: 'get_my_payslips',
    input: {},
    match:
      /\b(my (last |latest )?(salary|payslip|net pay|pay)|payslip)\b|আমার .{0,12}বেতন|পে-?স্লিপ|পেস্লিপ/i,
  },
  {
    tool: 'get_my_attendance',
    input: { month: 'current' },
    match:
      /\b(my attendance|was i late|days? (was i )?(late|absent))\b|আমার হাজিরা|কয়দিন দেরি|কতদিন দেরি|কয়দিন অনুপস্থিত/i,
  },
];

export class FakeProvider implements AiProvider {
  readonly name = 'fake';
  readonly model = 'fake-1';

  async call(request: AiCallRequest): Promise<AiCallResult> {
    if (request.signal.aborted) throw new Error('aborted');
    const last = request.messages[request.messages.length - 1];
    const question = lastUserText(request.messages);
    const bn = request.language === 'bn';

    // a document to read (bill / receipt photo)
    if (last.role === 'user' && last.files?.length)
      return answer(readDocument(last.files[0].data));

    // no tools: an explanation of facts given in the prompt. The RAW text is used, because
    // the sales assistant puts outside content in <said> and <note> tags that
    // lastUserText() strips for the policy-search path.
    if (!request.tools.length)
      return answer(explainFacts(lastUserRaw(request.messages), bn));

    // a new question: choose a tool
    if (last.role === 'user') {
      const route = ROUTES.find(
        (r) =>
          r.match.test(question) &&
          request.tools.some((t) => t.name === r.tool),
      );
      const call: AiToolCall = route
        ? { id: 'call_1', name: route.tool, input: route.input }
        : { id: 'call_1', name: 'search_policy', input: { query: question } };
      return {
        stop: 'tool_calls',
        text: '',
        toolCalls: [call],
        raw: { toolCalls: [call] },
        model: this.model,
        usage: usage(question, ''),
      };
    }

    // tool results: answer from them
    if (last.role === 'tool_results') {
      const previous = request.messages[request.messages.length - 2];
      const calls =
        previous?.role === 'assistant'
          ? ((previous.raw as { toolCalls?: AiToolCall[] })?.toolCalls ?? [])
          : [];
      const parts = last.results.map((r) => {
        const call = calls.find((c) => c.id === r.callId);
        if (r.isError)
          return bn
            ? 'দুঃখিত, এই তথ্য এখন দেখাতে পারছি না।'
            : 'Sorry, I cannot show this information right now.';
        return fromTool(call?.name ?? '', JSON.parse(r.content), question, bn);
      });
      return answer(parts.join('\n'), question);
    }
    return answer(
      bn ? 'দুঃখিত, বুঝতে পারিনি।' : 'Sorry, I did not understand.',
    );

    function answer(text: string, input = question): AiCallResult {
      return {
        stop: 'answer',
        text,
        toolCalls: [],
        raw: undefined,
        model: 'fake-1',
        usage: usage(input, text),
      };
    }
  }
}

/** The last user message as it was written, tags and all. */
function lastUserRaw(messages: AiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return m.text;
  }
  return '';
}

function lastUserText(messages: AiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return m.text.replace(/<[^>]+>/g, ' ');
  }
  return '';
}

function usage(input: string, output: string) {
  return {
    inputTokens: Math.ceil(input.length / 4) + 200,
    outputTokens: Math.ceil(output.length / 4),
  };
}

function fromTool(
  name: string,
  data: any,
  question: string,
  bn: boolean,
): string {
  switch (name) {
    case 'search_policy':
      return policyAnswer(data, question, bn);
    case 'get_my_leave_balances': {
      if (!data.balances?.length)
        return bn
          ? 'আপনার কোনো ছুটির হিসাব পাওয়া যায়নি।'
          : 'No leave balances were found for you.';
      const lines = data.balances.map((b: any) =>
        bn
          ? `${b.nameBn ?? b.name}: ${b.available} দিন বাকি`
          : `${b.name}: ${b.available} days left`,
      );
      return (
        (bn ? 'আপনার ছুটির হিসাব:\n' : 'Your leave balances:\n') +
        lines.join('\n')
      );
    }
    case 'get_my_payslips': {
      const p = data.latest;
      if (!p)
        return bn
          ? 'আপনার কোনো পে-স্লিপ এখনো নেই।'
          : 'You have no payslips yet.';
      return bn
        ? `${p.period} মাসের বেতন: মোট ${p.gross} টাকা, কর্তন ${p.totalDeductions} টাকা, হাতে পাবেন ${p.net} টাকা।`
        : `Your ${p.period} pay: gross BDT ${p.gross}, deductions BDT ${p.totalDeductions}, net pay BDT ${p.net}.`;
    }
    case 'get_my_attendance': {
      const t = data.totals ?? {};
      return bn
        ? `${data.month} মাসে: উপস্থিত ${t.present ?? 0} দিন, দেরিতে ${t.late ?? 0} দিন, অনুপস্থিত ${t.absent ?? 0} দিন।`
        : `In ${data.month}: present ${t.present ?? 0} days, late ${t.late ?? 0} days, absent ${t.absent ?? 0} days.`;
    }
    default:
      return bn
        ? 'দুঃখিত, এই তথ্য এখন দেখাতে পারছি না।'
        : 'Sorry, I cannot show this information right now.';
  }
}

function policyAnswer(
  data: {
    results?: Array<{ title: string; heading: string; excerpt: string }>;
  },
  question: string,
  bn: boolean,
): string {
  const notFound = bn
    ? 'কোম্পানির নীতিমালায় এ বিষয়ে কিছু পাইনি। অনুগ্রহ করে HR-এর সাথে যোগাযোগ করুন।'
    : 'I could not find this in the company policy documents. Please ask HR.';
  const asked = new Set(words(question).map(normalizeForMatch));
  // "how many / কত": a sentence with a number in it is more likely the answer
  const numberBonus =
    /\b(how (many|much|long)|what rate|which day)\b|কত|কয়/i.test(question)
      ? 0.5
      : 0.1;
  const candidates = (data.results ?? []).flatMap((r) =>
    sentences(r.excerpt).map((s) => ({
      sentence: s,
      source: r,
      shared: new Set(
        words(s)
          .map(normalizeForMatch)
          .filter((w) => asked.has(w)),
      ),
    })),
  );
  // a shared word counts more the fewer sentences contain it ("maternity" beats "leave")
  const df = new Map<string, number>();
  for (const c of candidates)
    for (const w of c.shared) df.set(w, (df.get(w) ?? 0) + 1);
  const scored = candidates
    // fewer than two shared words: the documents do not really cover the question
    .filter((c) => c.shared.size >= 2)
    .map((c) => ({
      ...c,
      score:
        [...c.shared].reduce((n, w) => n + 1 / df.get(w)!, 0) +
        (/\d|[০-৯]/.test(c.sentence) ? numberBonus : 0),
    }));
  if (!scored.length) return notFound;
  const top = Math.max(...scored.map((x) => x.score));
  const best = scored.filter((x) => x.score >= top - 1e-9).slice(0, 2);
  const source = [best[0].source.title, best[0].source.heading]
    .filter(Boolean)
    .join(' — ');
  return `${best.map((x) => x.sentence).join(' ')} (${bn ? 'সূত্র' : 'Source'}: ${source})`;
}

function explainFacts(prompt: string, bn: boolean): string {
  if (prompt.includes('TASK: bank_match')) return chooseBankMatch(prompt, bn);
  if (prompt.includes('TASK: cv_screening')) return screenCv(prompt, bn);
  if (prompt.includes('TASK: review_draft')) return draftReview(prompt, bn);
  if (prompt.includes('TASK: sales_assist')) return assistSales(prompt, bn);
  const match = /FACTS:\s*(\{[\s\S]*\})/.exec(prompt);
  const facts = match ? JSON.parse(match[1]) : {};
  const code = facts.flag?.code ?? 'UNKNOWN';
  const message = facts.flag?.message ?? facts.rule ?? '';
  return bn
    ? `এই সতর্কতা (${code}) উঠেছে কারণ: ${message || 'নিয়মভিত্তিক যাচাইয়ে অস্বাভাবিকতা পাওয়া গেছে'}। কর্মীর ইনপুট যাচাই করুন; ঠিক থাকলে কারণ লিখে সতর্কতা মুছুন, ভুল হলে তথ্য ঠিক করে আবার হিসাব করুন।`
    : `This flag (${code}) was raised because: ${message || 'a rule-based check found something unusual'}. Check the employee's inputs; if they are right, clear the flag with a reason, otherwise fix the data and recalculate.`;
}

/** Bank match: the option sharing the most words / numbers with the bank line; a tie or nothing in common -> none. */
function chooseBankMatch(prompt: string, bn: boolean): string {
  const match = /FACTS:\s*(\{[\s\S]*\})/.exec(prompt);
  const facts = match ? JSON.parse(match[1]) : { bankLine: {}, options: [] };
  const wordsOf = (text: string) =>
    new Set(
      text
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter(
          (w) =>
            (w.length >= 4 && /\d/.test(w)) ||
            (w.length >= 4 && /^[A-Z]+$/.test(w) && !STOP.has(w)),
        ),
    );
  const bank = wordsOf(
    `${facts.bankLine.description ?? ''} ${facts.bankLine.reference ?? ''}`,
  );
  const scored = (
    facts.options as Array<{
      key: string;
      lines: Array<{
        narration: string;
        reference: string | null;
        voucherNumber: string;
      }>;
    }>
  )
    .map((o) => {
      const own = wordsOf(
        o.lines
          .map((l) => `${l.narration} ${l.reference ?? ''} ${l.voucherNumber}`)
          .join(' '),
      );
      return { key: o.key, common: [...bank].filter((w) => own.has(w)) };
    })
    .sort((a, b) => b.common.length - a.common.length);
  const best = scored[0];
  if (
    !best ||
    !best.common.length ||
    (scored[1] && scored[1].common.length === best.common.length)
  ) {
    return JSON.stringify({
      choice: null,
      reason: bn
        ? 'কোনো বিকল্প স্পষ্টভাবে একই লেনদেন নয়।'
        : 'No option is clearly the same transaction.',
    });
  }
  const shared = best.common.slice(0, 3).join(', ');
  return JSON.stringify({
    choice: best.key,
    reason: bn
      ? `ব্যাংকের বিবরণ ও এই এন্ট্রিতে মিল: ${shared}।`
      : `The bank description and this entry share: ${shared}.`,
  });
}

/**
 * The sales assistant (WP31): built from the facts it was given and nothing else. It never
 * mentions a name, a phone number or an e-mail address, because it is never given any - which
 * is what the test set checks.
 */
function assistSales(prompt: string, bn: boolean): string {
  // anchored to the start of a line: "TASK: sales_assist" also contains "ASK:"
  const ask = /(?:^|\n)ASK:\s*(\w+)/.exec(prompt)?.[1] ?? 'next_step';
  const json = jsonAfter(prompt, 'FACTS:');
  const said = /<said>([\s\S]*?)<\/said>/.exec(prompt)?.[1] ?? '';
  const note = /<note>([\s\S]*?)<\/note>/.exec(prompt)?.[1] ?? '';
  const facts = json
    ? (JSON.parse(json) as {
        about?: {
          organisation?: string | null;
          district?: string | null;
          daysOld?: number | null;
        };
        activities?: Array<{ kind: string; subject: string; daysAgo: number }>;
        opportunities?: Array<{
          title: string;
          value: string;
          probability: number;
          stage: string | null;
        }>;
        dues?: { owed: string; overdue: string } | null;
      })
    : {};
  const org = facts.about?.organisation ?? (bn ? 'এই প্রতিষ্ঠান' : 'this organisation');
  const activities = facts.activities ?? [];
  const opportunities = facts.opportunities ?? [];
  const biggest = [...opportunities].sort(
    (a, b) => Number(b.value) - Number(a.value),
  )[0];

  if (ask === 'score') {
    // evidence of interest: activities logged, an opportunity open, something they said
    let score = 10;
    const reasons: string[] = [];
    if (activities.length) {
      score += Math.min(30, activities.length * 10);
      reasons.push(
        bn
          ? `${activities.length}টি কার্যক্রম লিপিবদ্ধ আছে, শেষটি ${activities[0].daysAgo} দিন আগে।`
          : `${activities.length} activity/activities logged, the latest ${activities[0].daysAgo} day(s) ago.`,
      );
    }
    if (biggest) {
      score += 35;
      reasons.push(
        bn
          ? `খোলা সম্ভাব্য বিক্রয় আছে: ${biggest.title} (${biggest.value})।`
          : `An open opportunity exists: ${biggest.title} (${biggest.value}).`,
      );
    }
    if (said.trim()) {
      score += 15;
      reasons.push(
        bn
          ? 'তারা নিজেরাই কী চান তা লিখেছেন, যা আগ্রহের প্রমাণ।'
          : 'They wrote what they want, which is evidence of real interest.',
      );
    }
    if (!activities.length && !biggest && !said.trim())
      reasons.push(
        bn
          ? 'এই লিডে প্রমাণ কম: কোনো কার্যক্রম, সম্ভাব্য বিক্রয় বা বার্তা নেই।'
          : 'The evidence here is thin: no activity, no opportunity and no message.',
      );
    return JSON.stringify({ score: Math.min(95, score), reasons });
  }

  if (ask === 'call_note') {
    const lines = note
      .split(/[.\n;]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 3)
      .slice(0, 5);
    if (!lines.length)
      return bn ? 'কলের নোটে কিছু লেখা নেই।' : 'The call note is empty.';
    return lines.map((l) => `- ${l}`).join('\n');
  }

  if (ask === 'follow_up')
    return bn
      ? [
          `${org}-এর সাথে আলোচনার সূত্রে লিখছি।`,
          biggest
            ? `${biggest.title} নিয়ে আমাদের প্রস্তাব এখনো খোলা আছে।`
            : 'আপনার প্রয়োজন অনুযায়ী আমরা দাম ও সরবরাহের সময় জানাতে পারি।',
          facts.dues && Number(facts.dues.overdue) > 0
            ? 'পাশাপাশি পুরোনো বকেয়াটি নিয়েও একবার কথা বলতে চাই।'
            : '',
          'আগামী দুই কর্মদিবসের মধ্যে একবার ফোন করলে সুবিধা হবে কি?',
        ]
          .filter(Boolean)
          .join(' ')
      : [
          `I am writing to follow up on our discussion with ${org}.`,
          biggest
            ? `Our proposal for ${biggest.title} is still open.`
            : 'We can confirm prices and delivery dates against your requirement.',
          facts.dues && Number(facts.dues.overdue) > 0
            ? 'I would also like to settle the older outstanding amount.'
            : '',
          'Would a short call in the next two working days suit you?',
        ]
          .filter(Boolean)
          .join(' ');

  if (ask === 'quotation_text')
    return bn
      ? `${org}-এর জন্য এই কোটেশন। ${biggest ? `${biggest.title} বাবদ প্রস্তাবিত মূল্য সংযুক্ত তালিকায় দেওয়া আছে। ` : ''}সরবরাহ ও পরিশোধের শর্ত আলোচনা অনুযায়ী। সম্মত থাকলে কোটেশনটি স্বাক্ষর করে ফেরত দিন।`
      : `This quotation is for ${org}. ${biggest ? `The prices for ${biggest.title} are in the lines below. ` : ''}Delivery and payment terms are as discussed. If you accept, please sign and return the quotation.`;

  // next_step
  const stale = activities.length ? activities[0].daysAgo : (facts.about?.daysOld ?? 0);
  return bn
    ? `পরের ধাপ: ${stale > 7 ? 'আজই একবার ফোন করুন' : 'আলোচনা অনুযায়ী পরের কাজটি সারুন'} — ${biggest ? `${biggest.title} নিয়ে নির্দিষ্ট পরিমাণে কোটেশন পাঠান।` : 'তাদের প্রয়োজন ও পরিমাণ জেনে নিন।'} শেষ যোগাযোগ ${stale} দিন আগে, তাই দেরি হলে আগ্রহ কমে যেতে পারে।`
    : `Next step: ${stale > 7 ? 'call them today' : 'carry on with what was agreed'} — ${biggest ? `send a quotation for a named quantity of ${biggest.title}.` : 'find out what they need and in what quantity.'} The last contact was ${stale} day(s) ago, so waiting longer will cost interest.`;
}

/**
 * Review drafting (WP30): a first draft built from the goals and the feedback notes it was
 * given, and nothing else. It rates nobody and recommends nothing, because the prompt
 * forbids both and the test set checks it.
 */
function draftReview(prompt: string, bn: boolean): string {
  const match = /FACTS:\s*(\{[\s\S]*\})/.exec(prompt);
  const facts = match
    ? (JSON.parse(match[1]) as {
        period: { from: string; to: string };
        goals: Array<{
          title: string;
          weight: number;
          selfScore: number | null;
          managerScore: number | null;
        }>;
        feedback: Array<{ kind: string; body: string }>;
        weightedScore: number | null;
      })
    : { period: { from: '', to: '' }, goals: [], feedback: [], weightedScore: null };
  const score = (g: { selfScore: number | null; managerScore: number | null }) =>
    g.managerScore ?? g.selfScore;
  const strong = facts.goals.filter((g) => (score(g) ?? 0) >= 4);
  const weak = facts.goals.filter((g) => (score(g) ?? 5) <= 2);
  const praise = facts.feedback.filter((f) => f.kind === 'praise');
  const concern = facts.feedback.filter((f) => f.kind === 'concern');
  const thin = facts.feedback.length < 2;
  const lines = bn
    ? [
        `পর্যালোচনার সময়কাল ${facts.period.from} থেকে ${facts.period.to}।`,
        strong.length
          ? `যেখানে ভালো করেছেন: ${strong.map((g) => g.title).join('; ')}।`
          : 'লক্ষ্যের নম্বরে স্পষ্টভাবে এগিয়ে থাকার প্রমাণ কম।',
        praise.length
          ? `বছরজুড়ে লেখা মতামতে প্রশংসা আছে: ${praise[0].body}`
          : 'প্রশংসার আলাদা কোনো মতামত লেখা হয়নি।',
        weak.length
          ? `যেখানে উন্নতি দরকার: ${weak.map((g) => g.title).join('; ')}।`
          : 'কোনো লক্ষ্যে দুর্বল নম্বর নেই।',
        concern.length
          ? `উদ্বেগ হিসেবে লেখা হয়েছে: ${concern[0].body}`
          : '',
        thin
          ? 'এই সময়ের মতামত কম, তাই প্রমাণ সীমিত — ব্যবস্থাপক নিজের পর্যবেক্ষণ যোগ করুন।'
          : 'পরের সময়কালে এই জায়গাগুলোতে মনোযোগ দেওয়া যেতে পারে।',
      ]
    : [
        `The review covers ${facts.period.from} to ${facts.period.to}.`,
        strong.length
          ? `Went well: ${strong.map((g) => g.title).join('; ')}.`
          : 'The goal scores show no clear area of strength.',
        praise.length
          ? `The feedback written during the year includes praise: ${praise[0].body}`
          : 'No praise was written as feedback during the period.',
        weak.length
          ? `Needs work: ${weak.map((g) => g.title).join('; ')}.`
          : 'No goal was scored poorly.',
        concern.length ? `A concern was recorded: ${concern[0].body}` : '',
        thin
          ? 'The feedback for this period is thin, so the evidence here is limited; the manager should add their own observations.'
          : 'Next period could focus on the areas above.',
      ];
  return lines.filter(Boolean).join('\n\n');
}

/**
 * CV screening (WP29): score by how many of the post's requirements the blind CV shows
 * evidence for, and say which. The fake never sees who the person is, because the text it
 * is given has already had that removed - which is exactly what the test set checks.
 */
function screenCv(prompt: string, bn: boolean): string {
  const match = /FACTS:\s*(\{[\s\S]*\})/.exec(prompt);
  const facts = match
    ? (JSON.parse(match[1]) as {
        post: { title: string; requirements: string[] };
        cv: string;
      })
    : { post: { title: '', requirements: [] }, cv: '' };
  const cv = facts.cv.toLowerCase();
  const keywords = (text: string) =>
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}+#.]+/u)
      .filter((w) => w.length >= 3 && !REQUIREMENT_STOP.has(w));
  const met: string[] = [];
  const missing: string[] = [];
  for (const requirement of facts.post.requirements) {
    const words = keywords(requirement);
    const hits = words.filter((w) => cv.includes(w)).length;
    if (words.length && hits / words.length >= 0.5) met.push(requirement);
    else missing.push(requirement);
  }
  const total = facts.post.requirements.length || 1;
  const score = Math.round((met.length / total) * 100);
  const reasons = [
    ...met.slice(0, 3).map((r) =>
      bn
        ? `শর্ত পূরণের প্রমাণ আছে: ${r}।`
        : `The CV shows evidence for: ${r}.`,
    ),
    ...missing.slice(0, 3).map((r) =>
      bn
        ? `এই শর্তের কোনো প্রমাণ পাওয়া যায়নি: ${r}।`
        : `No evidence for: ${r}.`,
    ),
  ];
  return JSON.stringify({ score, reasons });
}

/** The JSON object that follows a label, taken by balancing braces (it has nested objects). */
function jsonAfter(text: string, label: string): string | null {
  const at = text.indexOf(label);
  if (at < 0) return null;
  const start = text.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const REQUIREMENT_STOP = new Set([
  'and',
  'the',
  'with',
  'for',
  'min',
  'minimum',
  'least',
  'years',
  'year',
  'experience',
  'knowledge',
  'good',
  'strong',
  'able',
  'must',
  'should',
  'have',
  'has',
  'any',
  'degree',
]);

const STOP = new Set([
  'BANK',
  'PAID',
  'CREDIT',
  'DEBIT',
  'TRANSFER',
  'FROM',
  'CASH',
  'DEPOSIT',
  'CHARGE',
  'PAYMENT',
  'RECEIPT',
  'LIMITED',
  'WITH',
]);

/**
 * Document reader: the fake cannot see pixels. Test and demo files carry what is printed on
 * them as text: a PNG tEXt chunk with the keyword "erp:document", or "ERP-DOCUMENT:{...}" in
 * a PDF. Anything else is unreadable.
 */
function readDocument(data: Buffer): string {
  if (
    data
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    for (let at = 8; at + 8 <= data.length;) {
      const length = data.readUInt32BE(at);
      const type = data.subarray(at + 4, at + 8).toString('latin1');
      if (type === 'tEXt') {
        const body = data.subarray(at + 8, at + 8 + length).toString('latin1');
        const [keyword, text] = [
          body.slice(0, body.indexOf('\0')),
          body.slice(body.indexOf('\0') + 1),
        ];
        if (keyword === 'erp:document')
          return Buffer.from(text, 'latin1').toString('utf8');
      }
      at += 12 + length;
    }
  }
  const marker = /ERP-DOCUMENT:(\{[^\n]*\})/.exec(data.toString('latin1'));
  return marker
    ? Buffer.from(marker[1], 'latin1').toString('utf8')
    : '{"unreadable": true}';
}
