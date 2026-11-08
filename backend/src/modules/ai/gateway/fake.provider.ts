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

    // no tools: an explanation of facts given in the prompt
    if (!request.tools.length) return answer(explainFacts(question, bn));

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
