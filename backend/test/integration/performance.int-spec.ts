/**
 * WP30 performance through the API (Meghna Foods test company).
 * Acceptance (docs/phase-3-plan.md): "An approved increment reaches payroll as an
 * effective-dated change with the correct arrears; ratings are calibrated before proposals
 * go out."
 *
 * The year: HR opens the 2025-26 annual cycle, Tanvir sets Rafi's goals, Rafi reviews
 * himself, Tanvir rates him, HR calibrates across departments, HR proposes an increment
 * back-dated to 1 September (September was already paid at 30,000), the Admin approves it,
 * HR applies it — and October's payroll pays the September arrear by itself.
 *
 * The clock starts 15 October 2026, so September is a closed, paid month.
 */
import type { INestApplication } from '@nestjs/common';
import { FakeProvider } from '../../src/modules/ai/gateway/fake.provider.js';
import { ManualClock } from '../../src/platform/clock.js';
import { startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-10-15T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let c: string;
let structureId: string;
let cycleId: string;
let rafiAppraisal: string;
let tanvirAppraisal: string;
let proposalId: string;
let septemberRun: string;

/** Lock a month and mark every working day present (stands in for device punches). */
async function lockMonthAllPresent(period: string) {
  await co.hr.api
    .post('/attendance/locks', { companyId: co.companyId, period })
    .expect(201);
  await db.withTenant({ tenantId: co.tenant.id }, async () => {
    await db.tx
      .updateTable('attendance_days')
      .set({ status: 'present', worked_minutes: 540 })
      .where('company_id', '=', co.companyId)
      .where('work_date', '>=', `${period}-01`)
      .where('work_date', '<', period === '2026-09' ? '2026-10-01' : '2026-11-01')
      .where('status', '=', 'absent')
      .execute();
  });
}

async function clearAllFlags(runId: string) {
  const run = (await co.hr.api.get(`/payroll-runs/${runId}`).expect(200)).body;
  for (const f of run.flags.filter((x: { cleared: boolean }) => !x.cleared))
    await co.hr.api
      .post(`/payroll-flags/${f.id}/clear`, { reason: `Checked: ${f.code}` })
      .expect(200);
}

async function approveRun(runId: string) {
  const submitted = (
    await co.hr.api.post(`/payroll-runs/${runId}/submit`).expect(200)
  ).body;
  await co.accounts.api
    .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
    .expect(200);
  await co.md.api
    .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
    .expect(200);
}

async function linesOf(runId: string, employeeId: string) {
  const slip = (
    await co.hr.api
      .get(`/payroll-runs/${runId}/employees/${employeeId}`)
      .expect(200)
  ).body;
  return {
    slip,
    lines: Object.fromEntries(
      [...slip.earnings, ...slip.deductions].map(
        (l: { head: string; amount: string }) => [l.head, l.amount],
      ),
    ) as Record<string, string>,
  };
}

beforeAll(async () => {
  app = await startApp({ clock, aiProvider: new FakeProvider() });
  co = await createBdCompany(app, db);
  c = `/companies/${co.companyId}`;

  // payroll setup: the rule pack, the Bangladesh heads and the standard structure
  const packs = (await co.owner.get('/rule-packs').expect(200)).body.packs;
  const pack = packs.find(
    (p: { code: string; version: string }) =>
      p.code === 'BD-LABOUR' && p.version === '2026.2',
  );
  await co.owner
    .post(`/rule-packs/${pack.id}/accept`, { effectiveFrom: '2025-01-01' })
    .expect(201);
  structureId = (await co.hr.api.post(`${c}/salary-heads/defaults`).expect(201))
    .body.structureId;
  for (const [key, gross] of [
    ['md', '150000'],
    ['hr', '80000'],
    ['accounts', '90000'],
    ['financeOfficer', '40000'],
    ['salesHead', '100000'],
    ['rafi', '30000'],
  ] as const)
    await co.hr.api
      .post(
        `/employees/${(co[key] as BdCompany['rafi']).employeeId}/salaries`,
        {
          effectiveFrom: '2025-01-01',
          gross,
          structureId,
          reason: 'Joining salary',
        },
      )
      .expect(201);

  // September is worked, paid and closed
  await lockMonthAllPresent('2026-09');
  septemberRun = (
    await co.hr.api
      .post(`${c}/payroll-runs`, { runType: 'regular', period: '2026-09' })
      .expect(201)
  ).body.id;
  await co.hr.api.post(`/payroll-runs/${septemberRun}/calculate`).expect(200);
  await clearAllFlags(septemberRun);
  await approveRun(septemberRun);

  // AI on, so the review draft is offered
  await db.withTenant({ tenantId: co.tenant.id }, async () => {
    await db.tx
      .updateTable('tenants')
      .set({ plan_tier: 'intelligent' })
      .execute();
  });
  await co.owner
    .put('/ai/settings', { enabled: true, reviewDraftEnabled: true })
    .expect(200);
}, 300_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('the KPI library', () => {
  it('HR keeps it; a Dept Head reads it but cannot change it', async () => {
    await co.salesHead.api
      .post(`${c}/kpis`, { code: 'X', title: 'Mine' })
      .expect(403);
    const after = (
      await co.hr.api
        .post(`${c}/kpis`, {
          code: 'COLLECT',
          title: 'Collection of dues within 45 days',
          titleBn: 'বকেয়া আদায় ৪৫ দিনের মধ্যে',
          measure: 'percent',
          defaultWeight: 40,
        })
        .expect(201)
    ).body.kpis;
    expect(after.map((k: { code: string }) => k.code)).toContain('COLLECT');
    await co.hr.api
      .post(`${c}/kpis`, { code: 'COLLECT', title: 'Again' })
      .expect(409);
    const read = (await co.salesHead.api.get(`${c}/kpis`).expect(200)).body
      .kpis;
    expect(read).toHaveLength(1);
  });
});

describe('the cycle', () => {
  it('HR opens it, and one appraisal exists per active employee with their manager on it', async () => {
    const cycle = (
      await co.hr.api
        .post(`${c}/appraisal-cycles`, {
          name: '2025-26 annual',
          kind: 'annual',
          periodFrom: '2025-07-01',
          periodTo: '2026-06-30',
          incrementFrom: '2026-09-01',
          note: 'First annual cycle in the system',
        })
        .expect(201)
    ).body;
    cycleId = cycle.id;
    expect(cycle).toMatchObject({ state: 'draft', kind: 'annual' });
    await co.salesHead.api
      .post(`${c}/appraisal-cycles`, {
        name: 'Mine',
        kind: 'annual',
        periodFrom: '2025-07-01',
        periodTo: '2026-06-30',
      })
      .expect(403);

    const opened = (
      await co.hr.api.post(`/appraisal-cycles/${cycleId}/open`).expect(200)
    ).body;
    expect(opened.state).toBe('goals');
    expect(opened.appraisals.length).toBeGreaterThanOrEqual(6);
    const rafi = opened.appraisals.find(
      (a: { employeeId: string }) => a.employeeId === co.rafi.employeeId,
    );
    expect(rafi).toMatchObject({
      state: 'goals',
      managerEmployeeId: co.salesHead.employeeId,
    });
    rafiAppraisal = rafi.id;
    tanvirAppraisal = opened.appraisals.find(
      (a: { employeeId: string }) => a.employeeId === co.salesHead.employeeId,
    ).id;

    // opening again adds nobody twice
    const again = (
      await co.hr.api.post(`/appraisal-cycles/${cycleId}/open`).expect(200)
    ).body;
    expect(again.appraisals).toHaveLength(opened.appraisals.length);
  });

  it('the Dept Head reads the cycles they rate in, over their own people only', async () => {
    // A Dept Head's grant is held over their department, so a question asked
    // about the company alone is false for them. The list of cycles used to ask
    // exactly that and refuse them, although their menu offers the screen and
    // they cannot reach their team's appraisals without picking a cycle.
    const list = (
      await co.salesHead.api.get(`${c}/appraisal-cycles`).expect(200)
    ).body.cycles;
    expect(list).toHaveLength(1);

    const all = (await co.hr.api.get(`/appraisal-cycles/${cycleId}`).expect(200))
      .body.appraisals;
    const mine = (
      await co.salesHead.api.get(`/appraisal-cycles/${cycleId}`).expect(200)
    ).body.appraisals;
    // HR sees the company; the Sales head sees Sales, and is counted over it
    expect(mine.length).toBeLessThan(all.length);
    expect(mine.map((a: { employeeId: string }) => a.employeeId)).toContain(
      co.rafi.employeeId,
    );
    expect(mine.map((a: { employeeId: string }) => a.employeeId)).not.toContain(
      co.hr.employeeId,
    );
    expect(list[0].appraisals).toBe(mine.length);

    // the employee reaches their OWN appraisal through the same screen, and
    // sees that one row of the cycle and nothing else
    const his = (await co.rafi.api.get(`${c}/appraisal-cycles`).expect(200)).body
      .cycles;
    expect(his[0].appraisals).toBe(1);
    const hisCycle = (
      await co.rafi.api.get(`/appraisal-cycles/${cycleId}`).expect(200)
    ).body.appraisals;
    expect(hisCycle).toHaveLength(1);
    expect(hisCycle[0].employeeId).toBe(co.rafi.employeeId);
  });

  it('does not open the self-review until every appraisal has its goals', async () => {
    await co.hr.api
      .post(`/appraisal-cycles/${cycleId}/advance`)
      .expect(409);
  });

  it('the manager writes the goals, and the weights must add up to 100', async () => {
    const kpi = (await co.hr.api.get(`${c}/kpis`).expect(200)).body.kpis[0];
    await co.salesHead.api
      .put(`/appraisals/${rafiAppraisal}/goals`, {
        goals: [
          { title: 'Collection', weight: 40, kpiId: kpi.id },
          { title: 'Route reporting', weight: 40 },
        ],
      })
      .expect(400);
    const withGoals = (
      await co.salesHead.api
        .put(`/appraisals/${rafiAppraisal}/goals`, {
          goals: [
            {
              title: 'Collection of dues within 45 days',
              target: '95% of invoices',
              weight: 40,
              kpiId: kpi.id,
            },
            { title: 'New dealer accounts opened', target: '6', weight: 30 },
            { title: 'Daily route reporting in the app', weight: 30 },
          ],
        })
        .expect(200)
    ).body;
    expect(withGoals.weights).toBe(100);
    expect(withGoals.goals).toHaveLength(3);

    // not his team: Tanvir cannot write goals for Tanvir's own appraisal
    await co.salesHead.api
      .put(`/appraisals/${tanvirAppraisal}/goals`, {
        goals: [{ title: 'Mine', weight: 100 }],
      })
      .expect(403);
    // HR may, for anyone
    await co.hr.api
      .put(`/appraisals/${tanvirAppraisal}/goals`, {
        goals: [{ title: 'Grow the Dhaka north territory', weight: 100 }],
      })
      .expect(200);
  });
});

describe('self-review, rating and calibration', () => {
  it('the employee cannot review before the phase opens, then scores their own goals', async () => {
    const mine = (
      await co.rafi.api.get(`/appraisal-cycles/${cycleId}/mine`).expect(200)
    ).body;
    expect(mine.id).toBe(rafiAppraisal);
    await co.rafi.api
      .post(`/appraisals/${rafiAppraisal}/self-review`, {
        review: 'Too early',
      })
      .expect(409);

    // HR opens the self-review phase for everyone whose goals are set
    await co.hr.api.post(`/appraisal-cycles/${cycleId}/advance`).expect(200);
    const goals = (
      await co.rafi.api.get(`/appraisals/${rafiAppraisal}`).expect(200)
    ).body.goals as Array<{ id: string; title: string }>;
    const reviewed = (
      await co.rafi.api
        .post(`/appraisals/${rafiAppraisal}/self-review`, {
          review:
            'I collected well this year and opened four new dealers. Route reporting slipped during Ramadan.',
          scores: [
            { goalId: goals[0].id, score: 4, note: 'Khatunganj dues cleared' },
            { goalId: goals[1].id, score: 4 },
            { goalId: goals[2].id, score: 3, note: 'Missed days in Ramadan' },
          ],
        })
        .expect(200)
    ).body;
    expect(reviewed.state).toBe('manager_review');
    expect(reviewed.selfSubmittedAt).not.toBeNull();
    expect(reviewed.weightedScore).toBeCloseTo(3.7, 2);

    // nobody reviews somebody else's appraisal
    await co.rafi.api
      .post(`/appraisals/${tanvirAppraisal}/self-review`, { review: 'Not mine' })
      .expect(403);
  });

  it('the manager sees their team, gets an AI draft that rates nobody, and gives one rating', async () => {
    // continuous feedback written during the year is the evidence the draft uses
    for (const note of [
      {
        kind: 'praise',
        body: 'Recovered a six-month-old due from the Khatunganj dealer without escalation.',
        sharedWithEmployee: true,
      },
      {
        kind: 'concern',
        body: 'Route reports were missing for most of Ramadan.',
      },
    ])
      await co.salesHead.api
        .post(`/employees/${co.rafi.employeeId}/feedback`, note)
        .expect(201);

    const team = (
      await co.salesHead.api
        .get(`/appraisal-cycles/${cycleId}/my-team`)
        .expect(200)
    ).body.appraisals;
    expect(team.map((a: { id: string }) => a.id)).toContain(rafiAppraisal);
    expect(
      team.find((a: { id: string }) => a.id === rafiAppraisal),
    ).toMatchObject({ selfReviewDone: true });

    await co.hr.api.post(`/appraisal-cycles/${cycleId}/advance`).expect(200); // manager_review
    const draft = (
      await co.salesHead.api
        .post(`/appraisals/${rafiAppraisal}/review-draft`)
        .expect(200)
    ).body;
    expect(draft.draft).toContain('Collection');
    expect(draft.draft.toLowerCase()).toContain('route');
    // the draft never rates and never recommends: that is the manager's decision
    expect(draft.draft.toLowerCase()).not.toContain('out of 5');
    expect(draft.draft.toLowerCase()).not.toContain('recommend an increment');

    const goals = (
      await co.salesHead.api.get(`/appraisals/${rafiAppraisal}`).expect(200)
    ).body.goals as Array<{ id: string }>;
    const rated = (
      await co.salesHead.api
        .post(`/appraisals/${rafiAppraisal}/rate`, {
          rating: 4,
          comment:
            'Strong on collection, weaker on reporting discipline. Agreed to file the route report before leaving the last shop.',
          scores: [
            { goalId: goals[0].id, score: 4 },
            { goalId: goals[1].id, score: 3 },
            { goalId: goals[2].id, score: 2 },
          ],
        })
        .expect(200)
    ).body;
    expect(rated).toMatchObject({ state: 'calibration', managerRating: 4 });
    expect(rated.weightedScore).toBeCloseTo(3.1, 2);
    expect(rated.suggestedRating).toBe(3); // the weighted score suggests 3; the manager said 4
  });

  it('HR sees the spread per department and sets the rating that counts', async () => {
    await co.hr.api.post(`/appraisal-cycles/${cycleId}/advance`).expect(200); // calibration
    const view = (
      await co.hr.api
        .get(`/appraisal-cycles/${cycleId}/calibration`)
        .expect(200)
    ).body;
    const sales = view.departments.find(
      (d: { departmentName: string | null }) =>
        d.departmentName === 'Sales Dhaka',
    );
    expect(sales.counts['4']).toBeGreaterThanOrEqual(1);
    await co.salesHead.api
      .get(`/appraisal-cycles/${cycleId}/calibration`)
      .expect(403);

    const calibrated = (
      await co.hr.api
        .post(`/appraisals/${rafiAppraisal}/calibrate`, {
          rating: 3,
          note:
            'Sales rated everyone 4 or 5; moderated to 3 to match the other departments.',
        })
        .expect(200)
    ).body;
    expect(calibrated).toMatchObject({
      state: 'done',
      managerRating: 4,
      calibratedRating: 3,
      finalRating: 3,
    });
    await co.salesHead.api
      .post(`/appraisals/${rafiAppraisal}/calibrate`, { rating: 5 })
      .expect(403);
  });
});

describe('feedback notes', () => {
  it('the employee sees only what was shared with them', async () => {
    const asEmployee = (
      await co.rafi.api
        .get(`/employees/${co.rafi.employeeId}/feedback`)
        .expect(200)
    ).body.notes;
    expect(asEmployee).toHaveLength(1);
    expect(asEmployee[0].body).toContain('Khatunganj');
    expect(asEmployee[0].authorUserId).toBeNull();

    const asManager = (
      await co.salesHead.api
        .get(`/employees/${co.rafi.employeeId}/feedback`)
        .expect(200)
    ).body.notes;
    expect(asManager).toHaveLength(2);
    expect(asManager[0].authorUserId).not.toBeNull();
  });
});

describe('the increment (acceptance)', () => {
  it('is refused before calibration, and only HR proposes it', async () => {
    // Tanvir's own appraisal is rated by nobody yet, so it is not calibrated
    await co.hr.api
      .post(`/appraisals/${tanvirAppraisal}/proposal`, {
        kind: 'increment',
        newGross: '110000',
        structureId,
        justification: 'Too early',
      })
      .expect(409);
    await co.salesHead.api
      .post(`/appraisals/${rafiAppraisal}/proposal`, {
        kind: 'increment',
        newGross: '33000',
        structureId,
        justification: 'Not mine to propose',
      })
      .expect(403);
  });

  it('is proposed from the calibrated appraisal and approved by the Admin', async () => {
    const proposal = (
      await co.hr.api
        .post(`/appraisals/${rafiAppraisal}/proposal`, {
          kind: 'increment',
          newGross: '33000',
          structureId,
          justification:
            'Rating 3/5 after calibration; 10% increment per the appraisal policy.',
        })
        .expect(201)
    ).body;
    proposalId = proposal.id;
    expect(proposal).toMatchObject({
      state: 'in_approval',
      kind: 'increment',
      effectiveFrom: '2026-09-01', // the cycle's increment date
      newGross: '33000.00',
    });

    // a second live proposal for the same appraisal is refused
    await co.hr.api
      .post(`/appraisals/${rafiAppraisal}/proposal`, {
        kind: 'increment',
        newGross: '34000',
        structureId,
        justification: 'Again',
      })
      .expect(409);

    // it cannot be applied before the Admin approves
    await co.hr.api
      .post(`/increment-proposals/${proposalId}/apply`)
      .expect(409);
    await co.md.api
      .post(`/approvals/requests/${proposal.approvalRequestId}/approve`, {
        comment: 'Approved with the appraisal round',
      })
      .expect(200);
    const approved = (
      await co.hr.api.get(`/increment-proposals/${proposalId}`).expect(200)
    ).body;
    expect(approved.state).toBe('approved');
  });

  it('applied, it becomes an effective-dated salary — and nothing else', async () => {
    const applied = (
      await co.hr.api
        .post(`/increment-proposals/${proposalId}/apply`)
        .expect(200)
    ).body;
    expect(applied).toMatchObject({ state: 'applied' });
    expect(applied.appliedSalaryId).not.toBeNull();
    expect(applied.appliedEventId).toBeNull(); // an increment is not a promotion

    const salaries = (
      await co.hr.api
        .get(`/employees/${co.rafi.employeeId}/salaries`)
        .expect(200)
    ).body;
    expect(salaries.current).toMatchObject({ gross: '33000.00' });
    expect(
      salaries.history.find(
        (s: { effectiveFrom: string }) => s.effectiveFrom === '2026-09-01',
      ),
    ).toMatchObject({ reason: expect.stringContaining('Appraisal increment') });

    // the Sales head sees the proposal without the amount (salary is a sensitive field)
    const headView = (
      await co.salesHead.api
        .get(`/increment-proposals/${proposalId}`)
        .expect(200)
    ).body;
    expect(headView.newGross).toBeNull();
    expect(headView.effectiveFrom).toBe('2026-09-01');
  });

  it('October’s payroll pays the September arrear, with no help from this module', async () => {
    clock.set(new Date('2026-11-02T10:00:00+06:00'));
    await lockMonthAllPresent('2026-10');
    const october = (
      await co.hr.api
        .post(`${c}/payroll-runs`, { runType: 'regular', period: '2026-10' })
        .expect(201)
    ).body.id;
    await co.hr.api.post(`/payroll-runs/${october}/calculate`).expect(200);

    const { lines, slip } = await linesOf(october, co.rafi.employeeId);
    // October itself is paid at the new gross (33,000 on the 60/50/10 structure)
    expect(lines.BASIC).toBe('19800.00');
    // September was paid at 30,000 and is now due at 33,000: the difference is the arrear
    expect(lines.ARREAR).toBe('3000.00');
    expect(
      slip.earnings.find((l: { head: string }) => l.head === 'ARREAR'),
    ).toMatchObject({ forPeriod: '2026-09' });
  });
});
