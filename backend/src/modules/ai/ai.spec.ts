import { chunkPolicy } from './policies/chunking.js';
import { normalizeForMatch, sentences, words } from './policies/text.js';
import { FakeProvider } from './gateway/fake.provider.js';
import { HIDDEN, maskData, maskText } from './gateway/masking.js';
import { ASSISTANT_TOOLS } from './assistant/prompts.js';
import type { AiCallRequest } from './gateway/provider.js';

describe('masking (spec §8 guardrail 3)', () => {
  it.each([
    ['NID (10 digits)', 'My NID is 1990123456', `My NID is ${HIDDEN}`],
    ['NID (17 digits, spaced)', 'NID 1990 2694 5123 45678', `NID ${HIDDEN}`],
    ['TIN (12 digits)', 'e-TIN: 123456789012', `e-TIN: ${HIDDEN}`],
    ['short TIN after a label', 'TIN no. 5566', `TIN no. ${HIDDEN}`],
    [
      'bank account',
      'DBBL account 1051100012345 please',
      `DBBL account ${HIDDEN} please`,
    ],
    ['bKash / mobile number', 'bKash 01711-234567', `bKash ${HIDDEN}`],
    ['Bangla digits', 'আমার এনআইডি ১৯৯০১২৩৪৫৬', `আমার এনআইডি ${HIDDEN}`],
  ])('hides %s', (_name, input, expected) => {
    expect(maskText(input)).toBe(expected);
  });

  it.each([
    'Net pay 45,250.00',
    'Gross BDT 85000.00',
    '10 days of casual leave',
    'on 2026-10-16',
    'Basic 12,34,567.00',
  ])('keeps amounts and dates: %s', (text) => {
    expect(maskText(text)).toBe(text);
  });

  it('drops fields whose name says they hold an identity, bank, tax or phone number', () => {
    const masked = maskData({
      name: 'Rafi',
      nid: '1990123456',
      accountNumber: '1051100012345',
      walletNumber: '01711234567',
      tin: '123',
      net: '45000.00',
      nested: [{ bank_account: 'x', note: 'call 01811234567' }],
    });
    expect(masked).toEqual({
      name: 'Rafi',
      net: '45000.00',
      nested: [{ note: `call ${HIDDEN}` }],
    });
  });
});

describe('policy chunking', () => {
  it('cuts at headings and keeps the heading with each piece', () => {
    const chunks = chunkPolicy(
      '# Handbook\n\nIntro text.\n\n## Casual leave\n\n10 days a year.\n\nNo carry forward.\n\n## Sick leave\n14 days.',
    );
    expect(chunks).toEqual([
      { heading: 'Handbook', content: 'Intro text.' },
      {
        heading: 'Casual leave',
        content: '10 days a year.\n\nNo carry forward.',
      },
      { heading: 'Sick leave', content: '14 days.' },
    ]);
  });

  it('splits a long section into pieces of at most about 1200 characters', () => {
    const para = 'Lorem ipsum dolor sit amet. '.repeat(30);
    const chunks = chunkPolicy(`## Long\n\n${para}\n\n${para}\n\n${para}`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.heading).toBe('Long');
      expect(c.content.length).toBeLessThanOrEqual(1200);
    }
  });
});

describe('search words', () => {
  it('keeps Bangla words whole, drops stop words and punctuation', () => {
    expect(words('আমার নৈমিত্তিক ছুটি কত দিন বাকি?')).toEqual([
      'নৈমিত্তিক',
      'ছুটি',
      'দিন',
      'বাকি',
    ]);
    expect(
      words("How many days of casual leave do I get? (it's 'urgent' | & !)"),
    ).toEqual(['days', 'casual', 'leave', 'urgent']);
  });

  it('compares Bangla and ASCII digits alike', () => {
    expect(normalizeForMatch('১০ দিন')).toBe('10 দিন');
  });

  it('splits sentences at full stops and the Bangla danda', () => {
    expect(sentences('এক দিন। দুই দিন। Three days. Four')).toEqual([
      'এক দিন।',
      'দুই দিন।',
      'Three days.',
      'Four',
    ]);
  });
});

describe('fake provider', () => {
  const provider = new FakeProvider();
  const ask = (text: string, language: 'bn' | 'en' = 'en'): AiCallRequest => ({
    system: '',
    messages: [{ role: 'user', text }],
    tools: ASSISTANT_TOOLS,
    maxTokens: 1000,
    language,
    signal: new AbortController().signal,
  });

  it.each([
    ['How many casual leave days do I have left?', 'get_my_leave_balances'],
    ['আমার নৈমিত্তিক ছুটি কত দিন বাকি আছে?', 'get_my_leave_balances'],
    ['What was my net pay last month?', 'get_my_payslips'],
    ['আমার গত মাসের বেতন কত?', 'get_my_payslips'],
    ['How many days was I late this month?', 'get_my_attendance'],
    ['When is salary paid?', 'search_policy'],
    ['What happens if I come late three times?', 'search_policy'],
  ])('routes "%s" to %s', async (question, tool) => {
    const result = await provider.call(ask(question));
    expect(result.stop).toBe('tool_calls');
    expect(result.toolCalls[0].name).toBe(tool);
  });

  it('answers a policy question with the best-matching sentence and its source', async () => {
    const first = await provider.call(
      ask('How many days of sick leave do I get per year?'),
    );
    const results = {
      results: [
        {
          title: 'Handbook',
          heading: 'Sick leave',
          excerpt:
            'Employees get 14 days of sick leave per year on full pay. A certificate is needed after 2 days.',
        },
      ],
    };
    const second = await provider.call({
      ...ask(''),
      messages: [
        {
          role: 'user',
          text: 'How many days of sick leave do I get per year?',
        },
        { role: 'assistant', text: '', raw: first.raw },
        {
          role: 'tool_results',
          results: [
            { callId: first.toolCalls[0].id, content: JSON.stringify(results) },
          ],
        },
      ],
    });
    expect(second.stop).toBe('answer');
    expect(second.text).toBe(
      'Employees get 14 days of sick leave per year on full pay. (Source: Handbook — Sick leave)',
    );
  });

  it('stops when the time limit has passed', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      provider.call({ ...ask('hi'), signal: abort.signal }),
    ).rejects.toThrow();
  });
});
