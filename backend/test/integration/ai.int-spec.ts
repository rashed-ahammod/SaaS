/**
 * WP11 AI gateway, assistant and payroll flag explanations (Meghna Foods).
 * Acceptance (guide §24): the test set's pass rate is met, and the app works with
 * AI switched off.
 *
 * A recording stand-in wraps the deterministic fake model, so the test can see
 * exactly what would have left the system, and can make the "model" hang or fail.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AssistantService } from '../../src/modules/ai/assistant/assistant.service.js';
import {
  ASSISTANT_PROMPT_VERSION,
  FLAG_PROMPT_VERSION,
} from '../../src/modules/ai/assistant/prompts.js';
import { loadCases, runCases } from '../../src/modules/ai/eval/evaluation.js';
import { FlagExplanationsService } from '../../src/modules/ai/explanations/flag-explanations.service.js';
import { FakeProvider } from '../../src/modules/ai/gateway/fake.provider.js';
import type {
  AiCallRequest,
  AiProvider,
} from '../../src/modules/ai/gateway/provider.js';
import { AccessService } from '../../src/modules/identity/access/access.service.js';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { requestContext } from '../../src/platform/tenancy/request-context.js';
import { readFileSync } from 'node:fs';
import { apiFor, startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb, createTenant, ownerDb } from './helpers.js';

// this file runs with the release gate switched on and a short time limit
process.env.AI_REQUIRE_RELEASE_GATE = 'true';
process.env.AI_TIMEOUT_MS = '1500';

class RecordingProvider implements AiProvider {
  readonly name = 'fake';
  readonly model = 'fake-1';
  mode: 'normal' | 'hang' | 'fail' = 'normal';
  /** Everything sent to the "model", as JSON text. */
  sent: string[] = [];
  private readonly inner = new FakeProvider();

  async call(request: AiCallRequest) {
    this.sent.push(
      JSON.stringify({ system: request.system, messages: request.messages }),
    );
    if (this.mode === 'fail') throw new Error('provider down');
    if (this.mode === 'hang') {
      await new Promise((_, reject) =>
        request.signal.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      );
    }
    return this.inner.call(request);
  }
}

const db = appDb();
const owner = ownerDb();
const model = new RecordingProvider();
let app: INestApplication;
let appOff: INestApplication;
let co: BdCompany;
let flagId: string;

const policies = [
  {
    title: 'Employee Handbook 2026',
    language: 'en',
    body: readFileSync('samples/policies/demo-hr-policy.en.md', 'utf8'),
  },
  {
    title: 'কর্মী হ্যান্ডবুক ২০২৬',
    language: 'bn',
    body: readFileSync('samples/policies/demo-hr-policy.bn.md', 'utf8'),
  },
];
const ask = (
  who: BdCompany['rafi'],
  question: string,
  language: 'bn' | 'en' = 'en',
) => who.api.post('/ai/assistant', { question }, { 'X-Language': language });
const status = async (who: BdCompany['rafi']) =>
  (await who.api.get('/ai/status').expect(200)).body;
const asTenant = <T>(work: () => Promise<T>) =>
  db.withTenant(
    { tenantId: co.tenant.id, access: AccessGrants.system() },
    work,
  );
const setQuota = (quota: number | null) =>
  owner.withTenant({ tenantId: co.tenant.id }, () =>
    owner.tx.updateTable('ai_settings').set({ monthly_quota: quota }).execute(),
  );
const casualAvailable = async () =>
  (await co.rafi.api.get('/me/leave-balances').expect(200)).body.balances.find(
    (b: { code: string }) => b.code === 'CL',
  ).available;

beforeAll(async () => {
  app = await startApp({ aiProvider: model });
  appOff = await startApp({ aiProvider: null });
  co = await createBdCompany(app, db);
  const c = `/companies/${co.companyId}`;

  // leave: rule pack, Bangladesh default leave types, 2026 grant
  const packs = (await co.owner.get('/rule-packs').expect(200)).body.packs;
  await co.owner
    .post(
      `/rule-packs/${packs.find((p: { code: string }) => p.code === 'BD-LABOUR').id}/accept`,
      { effectiveFrom: '2025-01-01' },
    )
    .expect(201);
  await co.hr.api.post(`${c}/leave-types/defaults`).expect(201);
  await co.hr.api
    .post('/leave/accruals/run', {
      companyId: co.companyId,
      asOf: '2026-10-15',
    })
    .expect(201);

  // HR loads the handbook in both languages
  for (const p of policies)
    await co.hr.api.post('/ai/policy-documents', p).expect(201);

  // a calculated September run with one flag on Rafi
  flagId = await asTenant(async () => {
    const run = await db.tx
      .insertInto('payroll_runs')
      .values({
        company_id: co.companyId,
        period: '2026-09',
        run_type: 'regular',
        state: 'calculated',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const flag = await db.tx
      .insertInto('payroll_flags')
      .values({
        run_id: run.id,
        employee_id: co.rafi.employeeId,
        code: 'NET_CHANGE',
        message: 'Net pay changed 38% (from 52000.00 to 71760.00)',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return flag.id;
  });

  // the latest test-set result for this model and prompt version: failed
  for (const [feature, version] of [
    ['assistant', ASSISTANT_PROMPT_VERSION],
    ['payroll_flag_explanation', FLAG_PROMPT_VERSION],
  ]) {
    await owner.kysely
      .insertInto('ai_release_gates')
      .values({
        feature,
        provider: 'fake',
        model: 'fake-1',
        prompt_version: version,
        cases: 1,
        passed_cases: 0,
        pass_rate: '0',
        required_rate: '0.9',
        passed: false,
      })
      .execute();
  }
}, 180_000);

afterAll(async () => {
  await app.close();
  await appOff.close();
  await db.close();
  await owner.close();
});

describe('AI switched off (AI_PROVIDER=off)', () => {
  it('the app reports AI unavailable and every normal screen still works', async () => {
    const rafi = await apiFor(appOff, {
      slug: co.tenant.slug,
      email: co.rafi.email,
      password: 'Dhaka-Pass-2026',
    });
    const off = (await rafi.get('/ai/status').expect(200)).body;
    expect(off.assistant).toEqual({ available: false, reason: 'provider_off' });
    expect(off.payrollFlagExplanations).toEqual({
      available: false,
      reason: 'provider_off',
    });

    const res = await rafi
      .post('/ai/assistant', {
        question: 'How many casual leave days do I get?',
      })
      .expect(403);
    expect(res.body.message).toMatch(/switched off/);

    // the screens the assistant would have answered from
    await rafi.get('/me/leave-balances').expect(200);
    await rafi.get('/me/payslips').expect(200);
    await rafi.get('/me/attendance?from=2026-10-01&to=2026-10-15').expect(200);
    await rafi.get('/me/notifications').expect(200);
  });
});

describe('who gets AI', () => {
  it('not on the Intelligent plan: not offered', async () => {
    expect((await status(co.rafi)).assistant).toEqual({
      available: false,
      reason: 'not_in_plan',
    });
    await ask(co.rafi, 'What are the office hours?').expect(403);
  });

  it('Intelligent plan, but the Admin has not switched AI on: not offered', async () => {
    await asTenant(() =>
      db.tx.updateTable('tenants').set({ plan_tier: 'intelligent' }).execute(),
    );
    expect((await status(co.rafi)).assistant).toEqual({
      available: false,
      reason: 'switched_off',
    });
  });

  it('only the Admin switches AI on', async () => {
    await co.hr.api.put('/ai/settings', { enabled: true }).expect(403);
    const settings = (
      await co.md.api.put('/ai/settings', { enabled: true }).expect(200)
    ).body;
    expect(settings).toMatchObject({
      enabled: true,
      assistantEnabled: true,
      payrollExplanationsEnabled: true,
      planTier: 'intelligent',
      monthlyQuota: 3000,
      provider: 'fake',
    });
  });

  it('switched on, but the test set has not passed for this model and prompt: not offered', async () => {
    expect((await status(co.rafi)).assistant).toEqual({
      available: false,
      reason: 'not_released',
    });
    await ask(co.rafi, 'What are the office hours?').expect(403);
  });
});

describe('release gate: the fixed test sets (guide §16)', () => {
  it('both test sets meet the 90% pass rate, which opens the gate', async () => {
    const access = (userId: string) =>
      db.withTenant({ tenantId: co.tenant.id }, () =>
        app.get(AccessService, { strict: false }).load(userId),
      );
    const rafi = {
      userId: co.rafi.userId,
      access: await access(co.rafi.userId),
    };
    const reviewer = {
      userId: co.accounts.userId,
      access: await access(co.accounts.userId),
    };
    const as = <T>(
      who: typeof rafi,
      language: 'bn' | 'en',
      work: () => Promise<T>,
    ) =>
      requestContext.run(
        {
          tenantId: co.tenant.id,
          userId: who.userId,
          access: who.access,
          language,
        },
        work,
      );
    const cl = String(await casualAvailable());
    const resolve = (ref: string) =>
      ref === 'myLeaveAvailable:CL' ? cl : 'n/a';

    const assistant = app.get(AssistantService, { strict: false });
    const policyReport = await runCases(
      loadCases('test/ai-eval/assistant.yaml'),
      0.9,
      (c) =>
        as(rafi, c.language, () =>
          assistant.ask({ question: c.question! }, c.id),
        ),
      resolve,
    );
    const flags = app.get(FlagExplanationsService, { strict: false });
    const flagReport = await runCases(
      loadCases('test/ai-eval/payroll-flags.yaml'),
      0.9,
      async (c) => {
        const facts = {
          seesSalary: c.facts!.seesSalary,
          flag: { ...c.facts!.flag, cleared: false, clearReason: null },
          run: {
            period: '2026-09',
            runType: 'regular',
            bonusName: null,
            state: 'calculated',
          },
          employee: { code: 'EVAL-0001', status: 'active' },
        };
        const r = await as(reviewer, c.language, () =>
          flags.explainFacts(facts as never, `eval:${c.id}`, true),
        );
        return { answer: r.answer, toolsUsed: [] };
      },
      resolve,
    );

    expect(policyReport.cases).toBeGreaterThanOrEqual(25);
    expect(
      policyReport.outcomes.filter((o) => o.language === 'bn').length,
    ).toBeGreaterThanOrEqual(10);
    expect(policyReport.outcomes.filter((o) => !o.passed)).toEqual([]);
    expect(flagReport.gatePassed).toBe(true);

    // what npm run ai:eval records
    for (const [feature, version, report] of [
      ['assistant', ASSISTANT_PROMPT_VERSION, policyReport],
      ['payroll_flag_explanation', FLAG_PROMPT_VERSION, flagReport],
    ] as const) {
      await owner.kysely
        .insertInto('ai_release_gates')
        .values({
          feature,
          provider: 'fake',
          model: 'fake-1',
          prompt_version: version,
          cases: report.cases,
          passed_cases: report.passed,
          pass_rate: report.passRate.toFixed(4),
          required_rate: '0.9',
          passed: report.gatePassed,
        })
        .execute();
    }
    // the bill and receipt reader (WP22) has its own test set, not run here: not released yet
    expect(await status(co.rafi)).toEqual({
      assistant: { available: true },
      payrollFlagExplanations: { available: true },
      documentReader: { available: false, reason: 'not_released' },
    });
  });
});

describe('the assistant', () => {
  it('answers a policy question from the company handbook, naming the source', async () => {
    const res = (
      await ask(
        co.rafi,
        'How many days of casual leave do I get in a year?',
      ).expect(200)
    ).body;
    expect(res.answer).toContain('10 days of casual leave');
    expect(res.sources).toContainEqual({
      title: 'Employee Handbook 2026',
      heading: 'Casual leave',
    });
    expect(res.toolsUsed).toEqual(['search_policy']);
    expect(res.interactionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers in Bangla from the Bangla handbook', async () => {
    const res = (
      await ask(co.rafi, 'অসুস্থতাজনিত ছুটি বছরে কত দিন?', 'bn').expect(200)
    ).body;
    expect(res.answer).toContain('১৪ দিন');
    expect(res.sources[0].title).toBe('কর্মী হ্যান্ডবুক ২০২৬');
    expect(res.language).toBe('bn');
  });

  it("answers balance questions with the user's own figures only", async () => {
    const rafi = (
      await ask(co.rafi, 'How many casual leave days do I have left?').expect(
        200,
      )
    ).body;
    expect(rafi.toolsUsed).toEqual(['get_my_leave_balances']);
    expect(rafi.answer).toContain(
      `Casual leave: ${await casualAvailable()} days left`,
    );

    // the workspace owner has no employee record: the tool refuses, the answer says so
    const ownerAnswer = (
      await co.owner
        .post('/ai/assistant', {
          question: 'How many casual leave days do I have left?',
        })
        .expect(200)
    ).body;
    expect(ownerAnswer.answer).toBe(
      'Sorry, I cannot show this information right now.',
    );
  });

  it('masks NID, phone and account numbers before anything reaches the model, and logs the masked text', async () => {
    model.sent = [];
    const res = (
      await ask(
        co.rafi,
        'My NID is 1998123456786 and my bKash is 01711-234567. How many days of sick leave do I get per year?',
      ).expect(200)
    ).body;
    const everything = model.sent.join('\n');
    expect(everything).not.toContain('1998123456786');
    expect(everything).not.toContain('234567');
    expect(everything).toContain('[number hidden]');

    const log = (
      await co.md.api
        .get('/ai/interactions?feature=assistant&limit=1')
        .expect(200)
    ).body[0];
    expect(log).toMatchObject({
      id: res.interactionId,
      userEmail: co.rafi.email,
      provider: 'fake',
      model: 'fake-1',
      promptVersion: ASSISTANT_PROMPT_VERSION,
      status: 'ok',
    });
    expect(log.input).toBe(
      'My NID is [number hidden] and my bKash is [number hidden]. How many days of sick leave do I get per year?',
    );
  });

  it('cannot act: asking it to apply for leave creates nothing', async () => {
    const before = (await co.rafi.api.get('/me/leave-requests').expect(200))
      .body.length;
    await ask(co.rafi, 'Please apply casual leave for me next Thursday').expect(
      200,
    );
    expect(
      (await co.rafi.api.get('/me/leave-requests').expect(200)).body.length,
    ).toBe(before);
  });

  it('records what the user thought of an answer; only the asker can', async () => {
    const res = (await ask(co.rafi, 'When is salary paid?').expect(200)).body;
    await co.salesHead.api
      .post(`/ai/interactions/${res.interactionId}/feedback`, {
        action: 'helpful',
      })
      .expect(404);
    const fb = (
      await co.rafi.api
        .post(`/ai/interactions/${res.interactionId}/feedback`, {
          action: 'not_helpful',
          note: 'I wanted the exact date',
        })
        .expect(200)
    ).body;
    expect(fb).toEqual({ id: res.interactionId, humanAction: 'not_helpful' });
  });
});

describe('payroll flag explanations', () => {
  it('only payroll reviewers may ask, and only for flags they can see', async () => {
    await co.rafi.api.post(`/payroll-flags/${flagId}/explanation`).expect(403);
    await co.accounts.api
      .post(`/payroll-flags/${randomUUID()}/explanation`)
      .expect(404);
  });

  it('explains the flag from its facts; the same flag is explained once', async () => {
    const first = (
      await co.accounts.api
        .post(`/payroll-flags/${flagId}/explanation`)
        .expect(200)
    ).body;
    expect(first).toMatchObject({ flagId, code: 'NET_CHANGE', reused: false });
    expect(first.explanation).toContain('Net pay changed 38%');

    const again = (
      await co.accounts.api
        .post(`/payroll-flags/${flagId}/explanation`)
        .expect(200)
    ).body;
    expect(again).toMatchObject({
      interactionId: first.interactionId,
      reused: true,
      explanation: first.explanation,
    });
  });
});

describe('graceful failure (spec §8 guardrail 8)', () => {
  afterEach(() => (model.mode = 'normal'));

  it('a model that does not answer in time: "not answering", logged, the call given back, screens unaffected', async () => {
    const usedBefore = (await co.md.api.get('/ai/usage').expect(200)).body.used;
    model.mode = 'hang';
    const started = Date.now();
    const res = await ask(co.rafi, 'What are the office hours?').expect(503);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(res.body.message).toMatch(/not answering/);

    await co.rafi.api.get('/me/leave-balances').expect(200);
    const log = (
      await co.md.api.get('/ai/interactions?status=timeout&limit=1').expect(200)
    ).body[0];
    expect(log).toMatchObject({ status: 'timeout', userEmail: co.rafi.email });
    expect((await co.md.api.get('/ai/usage').expect(200)).body.used).toBe(
      usedBefore,
    );
  });

  it('a provider error: same', async () => {
    model.mode = 'fail';
    await ask(co.rafi, 'What are the office hours?').expect(503);
    expect(
      (await co.md.api.get('/ai/interactions?status=error&limit=1').expect(200))
        .body[0].error,
    ).toBe('provider down');
  });
});

describe('metering, quota and oversight', () => {
  it('usage per feature against the quota, with answer ratings', async () => {
    await co.rafi.api.get('/ai/usage').expect(403);
    const usage = (await co.md.api.get('/ai/usage').expect(200)).body;
    expect(usage).toMatchObject({
      provider: 'fake',
      model: 'fake-1',
      quota: 3000,
    });
    const assistant = usage.features.find(
      (f: { feature: string }) => f.feature === 'assistant',
    );
    expect(assistant.calls).toBeGreaterThanOrEqual(30); // test set + the questions above
    expect(assistant.inputTokens).toBeGreaterThan(0);
    expect(assistant).toMatchObject({ notHelpful: 1, failed: 2 });
    const flags = usage.features.find(
      (f: { feature: string }) => f.feature === 'payroll_flag_explanation',
    );
    expect(flags.explainedFlags).toEqual({ cleared: 0, fixed: 0, open: 1 });
  });

  it('a used-up quota stops AI calls (429) and the app hides AI; nothing else changes', async () => {
    const used = (await co.md.api.get('/ai/usage').expect(200)).body.used;
    await setQuota(used);
    try {
      expect((await status(co.rafi)).assistant).toEqual({
        available: false,
        reason: 'quota_used_up',
      });
      const res = await ask(co.rafi, 'What are the office hours?').expect(429);
      expect(res.body.message).toMatch(/quota is used up/);
      await co.rafi.api.get('/me/leave-balances').expect(200);
    } finally {
      await setQuota(null);
    }
  });

  it('the Admin can switch one feature off', async () => {
    await co.md.api
      .put('/ai/settings', { payrollExplanationsEnabled: false })
      .expect(200);
    expect((await status(co.accounts)).payrollFlagExplanations).toEqual({
      available: false,
      reason: 'switched_off',
    });
    await co.accounts.api
      .post(`/payroll-flags/${flagId}/explanation`)
      .expect(403);
    expect((await status(co.rafi)).assistant).toEqual({ available: true });
    await co.md.api
      .put('/ai/settings', { payrollExplanationsEnabled: true })
      .expect(200);
  });

  it('policy documents: HR manages them, retired ones are no longer used', async () => {
    await co.rafi.api.get('/ai/policy-documents').expect(403);
    const docs = (await co.hr.api.get('/ai/policy-documents').expect(200)).body;
    expect(docs).toHaveLength(2);
    const bn = docs.find((d: { language: string }) => d.language === 'bn');
    await co.hr.api
      .post(`/ai/policy-documents/${bn.id}/deactivate`)
      .expect(200);
    const res = (
      await ask(co.rafi, 'অসুস্থতাজনিত ছুটি বছরে কত দিন?', 'bn').expect(200)
    ).body;
    expect(res.sources.map((s: { title: string }) => s.title)).not.toContain(
      'কর্মী হ্যান্ডবুক ২০২৬',
    );
  });

  it("another company never sees this company's policy texts or AI log", async () => {
    const other = await createTenant(db, 'ai-other');
    const otherAdmin = await apiFor(app, {
      slug: other.slug,
      email: other.email,
      password: other.password,
    });
    expect(
      (await otherAdmin.get('/ai/policy-documents').expect(200)).body,
    ).toEqual([]);
    expect((await otherAdmin.get('/ai/interactions').expect(200)).body).toEqual(
      [],
    );
  });
});
