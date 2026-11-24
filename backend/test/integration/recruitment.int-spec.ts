/**
 * WP29 recruitment through the API (Meghna Foods test company).
 * Acceptance (docs/phase-3-plan.md): "A hired applicant becomes an employee with nothing
 * retyped; CV screening never sees name, gender, religion, age or photo, and passes its
 * test set."
 *
 * The story: the Sales department needs one more Sales Executive. Tanvir (Dept Head) asks
 * for the post; HR and the Admin approve it; HR opens it, advertises it, takes two
 * applicants with their consent, screens their CVs blind, interviews one with a panel,
 * offers above the grade range (so the Admin decides), and hires. The second applicant is
 * rejected, and the retention sweep clears their CV when the time comes.
 *
 * The test-set half of the acceptance criterion is checked by
 * src/modules/recruitment/recruitment.spec.ts (the redaction) and test/ai-eval/cv-screening.yaml
 * (`npm run ai:eval`); here the API is checked end to end with the deterministic fake model.
 */
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { FakeProvider } from '../../src/modules/ai/gateway/fake.provider.js';
import { ApplicantsService } from '../../src/modules/recruitment/applicants.service.js';
import { ManualClock } from '../../src/platform/clock.js';
import { startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb, ownerDb } from './helpers.js';

const db = appDb();
const owner = ownerDb();
const dhaka = (local: string) => new Date(`${local}+06:00`);
const clock = new ManualClock(dhaka('2026-11-17T10:00:00'));

let app: INestApplication;
let co: BdCompany;
let c: string;
let planId: string;
let requestId: string;
let openingId: string;
let interviewId: string;
let offerId: string;
const applicant: Record<string, string> = {};
const application: Record<string, string> = {};
/** The fixture has one designation (Executive) and one grade (Grade 3). */
let designationId: string;
let gradeId: string;

const asTenant = <T>(work: () => Promise<T>) =>
  db.withTenant(
    { tenantId: co.tenant.id, access: AccessGrants.system() },
    work,
  );

const CV_SHAHIDUL = `Name: Md. Shahidul Islam
Father's Name: Abdul Karim
Date of Birth: 14-03-1997
Gender: Male
Religion: Islam
Marital Status: Married
Mobile: 01711-223344
Photo: attached

EXPERIENCE
Sales Executive, Padma Agro Ltd, Dhaka (2021 to date)
  - Visited 60 retail shops in Mirpur every month; collected orders and payments.
  - Kept the daily collection register and reported to the territory manager.
  - Negotiated dealer pricing within the approved discount limit.

EDUCATION
B.Com (Marketing), National University, 2019

SKILLS
Retail sales, dealer handling, MS Excel, collection follow-up`;

const CV_WEAK = `Name: Rakib Hasan
Gender: Male
Age: 23 years
Religion: Hindu

EXPERIENCE
Office Assistant, a small printing press, Dhaka (8 months)
  - Photocopying, filing and tea.

EDUCATION
HSC (Commerce), Dhaka College`;

beforeAll(async () => {
  app = await startApp({ clock, aiProvider: new FakeProvider() });
  co = await createBdCompany(app, db);
  c = `/companies/${co.companyId}`;
  // the Intelligent plan with AI on, so CV screening is offered (WP11 rules)
  await asTenant(async () => {
    await db.tx
      .updateTable('tenants')
      .set({ plan_tier: 'intelligent' })
      .execute();
  });
  await co.owner
    .put('/ai/settings', { enabled: true, cvScreeningEnabled: true })
    .expect(200);

  designationId = (await co.owner.get(`${c}/designations`).expect(200)).body[0]
    .id;
  const grade = (await co.owner.get(`${c}/grades`).expect(200)).body[0];
  gradeId = grade.id;
  // the grade gets a salary range, so an offer can be outside it (spec §5 "above threshold")
  await co.hr.api
    .patch(`/grades/${gradeId}`, {
      version: grade.version,
      salaryMin: '20000',
      salaryMax: '60000',
    })
    .expect(200);
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
  await owner.close();
});

describe('the manpower plan', () => {
  it('only the Admin sets it, and an approved plan is final', async () => {
    const lines = [
      {
        departmentId: co.departments.salesDhaka,
        designationId,
        headcount: 3,
      },
    ];
    await co.hr.api
      .put(`${c}/manpower-plan`, { lines })
      .expect(403);
    const saved = (
      await co.md.api
        .put(`${c}/manpower-plan`, {
          note: 'Sales push for the Eid season',
          lines,
        })
        .expect(200)
    ).body;
    expect(saved.fiscalYear).toBe('2026-27');
    expect(saved.plan.state).toBe('draft');
    expect(saved.lines[0]).toMatchObject({ headcount: 3 });
    planId = saved.plan.id;

    const approved = (
      await co.md.api.post(`/manpower-plans/${planId}/approve`).expect(200)
    ).body;
    expect(approved.plan.state).toBe('approved');
    await co.md.api.put(`${c}/manpower-plan`, { lines }).expect(409);
    await co.md.api.post(`/manpower-plans/${planId}/approve`).expect(409);
  });

  it('the Dept Head reads their own departments’ lines, and only those', async () => {
    // Their grant is held over their department, so asking about the company
    // refused them the plan their own position requests are checked against.
    const mine = (
      await co.salesHead.api.get(`${c}/manpower-plan`).expect(200)
    ).body;
    expect(mine.lines).toHaveLength(1);
    expect(mine.lines[0].departmentId).toBe(co.departments.salesDhaka);
    // and someone with no recruitment grant at all still gets nothing
    await co.accounts.api.get(`${c}/manpower-plan`).expect(403);
  });

  it('shows how much of each planned post is left', async () => {
    const plan = (await co.hr.api.get(`${c}/manpower-plan`).expect(200)).body;
    const line = plan.lines[0];
    // Rafi and Mitu already hold that designation in that department
    expect(line.filled).toBeGreaterThanOrEqual(1);
    expect(line.left).toBe(3 - line.filled - line.requested);
  });
});

describe('a new position', () => {
  it('the Dept Head asks for it, and the plan check travels with the request', async () => {
    const raised = (
      await co.salesHead.api
        .post(`${c}/position-requests`, {
          departmentId: co.departments.salesDhaka,
          designationId,
          gradeId,
          branchId: co.branchId,
          headcount: 1,
          reason: 'Mirpur and Uttara routes cannot be covered by two people.',
        })
        .expect(201)
    ).body;
    requestId = raised.id;
    expect(raised).toMatchObject({
      number: expect.stringMatching(/^NP\/2026-27\/\d{5}$/),
      state: 'in_approval',
      withinPlan: true,
    });
    expect(raised.plan).toMatchObject({ planned: 3, fiscalYear: '2026-27' });
  });

  it('a post the plan does not have room for is still raised, and says so', async () => {
    const raised = (
      await co.salesHead.api
        .post(`${c}/position-requests`, {
          departmentId: co.departments.sales, // the Sales department, not Sales Dhaka
          designationId,
          gradeId,
          branchId: co.branchId,
          headcount: 1,
          reason: 'A coordinator for the north, outside this year’s plan.',
        })
        .expect(201)
    ).body;
    expect(raised.withinPlan).toBe(false);
    expect(raised.plan.reason).toContain('no post of this designation');
    await co.salesHead.api
      .post(`/position-requests/${raised.id}/cancel`, {
        reason: 'Will wait for the next plan',
      })
      .expect(200);
    const cancelled = (
      await co.salesHead.api.get(`/position-requests/${raised.id}`).expect(200)
    ).body;
    expect(cancelled.state).toBe('cancelled');
  });

  it('goes to HR and then the Admin, and nobody else can open it until it is approved', async () => {
    const request = (
      await co.hr.api.get(`/position-requests/${requestId}`).expect(200)
    ).body;
    await co.hr.api
      .post(`/position-requests/${requestId}/opening`, {
        title: 'Sales Executive',
        description: 'Retail route sales in Dhaka north.',
        requirements: ['Retail sales experience', 'Dealer handling'],
      })
      .expect(409);

    // HR approves, then the Admin
    const inbox = async (api: typeof co.hr.api) =>
      (await api.get('/approvals/inbox').expect(200)).body as Array<{
        requestId: string;
      }>;
    expect(
      (await inbox(co.hr.api)).map((i) => i.requestId),
    ).toContain(request.approvalRequestId);
    await co.hr.api
      .post(`/approvals/requests/${request.approvalRequestId}/approve`, {
        comment: 'Within the plan; grade and route confirmed',
      })
      .expect(200);
    await co.md.api
      .post(`/approvals/requests/${request.approvalRequestId}/approve`, {
        comment: 'Approved',
      })
      .expect(200);
    const approved = (
      await co.hr.api.get(`/position-requests/${requestId}`).expect(200)
    ).body;
    expect(approved.state).toBe('approved');
  });
});

describe('the opening', () => {
  it('HR opens it once, from the approved request, and advertises it', async () => {
    const opening = (
      await co.hr.api
        .post(`/position-requests/${requestId}/opening`, {
          title: 'Sales Executive (Dhaka north)',
          titleBn: 'বিক্রয় নির্বাহী (ঢাকা উত্তর)',
          description:
            'Route sales to retail shops in Mirpur and Uttara, with collection.',
          requirements: [
            'Retail sales experience',
            'Dealer handling',
            'Collection follow-up',
          ],
          closingOn: '2026-12-15',
        })
        .expect(201)
    ).body;
    openingId = opening.id;
    expect(opening).toMatchObject({
      number: expect.stringMatching(/^JO\/2026-27\/\d{5}$/),
      state: 'open',
      openings: 1,
    });
    expect(opening.positionRequest.number).toMatch(/^NP\//);

    // the authority for a post is its approval: one opening per request
    await co.hr.api
      .post(`/position-requests/${requestId}/opening`, {
        title: 'Again',
        description: 'Again',
        requirements: ['x'],
      })
      .expect(409);

    const posted = (
      await co.hr.api
        .post(`/job-openings/${openingId}/postings`, {
          channel: 'facebook',
          reference: 'Company page post',
        })
        .expect(201)
    ).body;
    expect(posted.postings).toHaveLength(1);
  });
});

describe('who sees an opening', () => {
  it('the Dept Head sees their own department’s; a role with no grant sees none', async () => {
    const mine = (
      await co.salesHead.api.get(`${c}/job-openings`).expect(200)
    ).body.openings;
    expect(mine.map((o: { id: string }) => o.id)).toContain(openingId);
    const hr = (await co.hr.api.get(`${c}/job-openings`).expect(200)).body
      .openings;
    expect(hr.length).toBeGreaterThanOrEqual(mine.length);
    await co.accounts.api.get(`${c}/job-openings`).expect(403);
  });
});

describe('applicants, their consent and their CVs', () => {
  it('no consent, no applicant', async () => {
    await co.hr.api
      .post(`${c}/applicants`, {
        fullNameEn: 'No Consent',
        phone: '01799000000',
        consent: false,
      })
      .expect(400);
  });

  it('are taken with their consent and a retention date, and never twice', async () => {
    const added = (
      await co.hr.api
        .post(`${c}/applicants`, {
          fullNameEn: 'Md. Shahidul Islam',
          phone: '01711-223344',
          email: 'Shahidul.Islam@example.com',
          district: 'Dhaka',
          dateOfBirth: '1997-03-14',
          gender: 'male',
          source: 'facebook',
          cvText: CV_SHAHIDUL,
          consent: true,
        })
        .expect(201)
    ).body;
    applicant.shahidul = added.id;
    expect(added).toMatchObject({
      name: 'Md. Shahidul Islam',
      email: 'shahidul.islam@example.com',
      phone: '+8801711223344',
      consentVersion: 'cv-consent-v1',
      redacted: false,
    });
    // consent today + 365 days
    expect(added.retentionUntil).toBe('2027-11-17');

    await co.hr.api
      .post(`${c}/applicants`, {
        fullNameEn: 'Shahidul (again)',
        phone: '+880 1711 223344',
        consent: true,
      })
      .expect(409);

    const weak = (
      await co.hr.api
        .post(`${c}/applicants`, {
          fullNameEn: 'Rakib Hasan',
          phone: '01799887766',
          district: 'Dhaka',
          dateOfBirth: '2003-01-20',
          gender: 'male',
          source: 'walk_in',
          cvText: CV_WEAK,
          consent: true,
        })
        .expect(201)
    ).body;
    applicant.rakib = weak.id;
  });

  it('apply for the opening once each', async () => {
    for (const [who, id] of Object.entries(applicant)) {
      const applied = (
        await co.hr.api
          .post(`/job-openings/${openingId}/applications`, {
            applicantId: id,
          })
          .expect(201)
      ).body;
      application[who] = applied.id;
      expect(applied.state).toBe('applied');
    }
    await co.hr.api
      .post(`/job-openings/${openingId}/applications`, {
        applicantId: applicant.shahidul,
      })
      .expect(409);
  });
});

describe('CV screening is blind (acceptance)', () => {
  it('scores on the requirements, and the model is never shown who the person is', async () => {
    const screened = (
      await co.hr.api
        .post(`/applications/${application.shahidul}/screen`)
        .expect(200)
    ).body;
    expect(screened.score).toBeGreaterThan(50);
    expect(screened.reasons.length).toBeGreaterThan(0);
    // what was taken out before the model saw it
    expect(screened.removed).toEqual(
      expect.arrayContaining(['gender', 'religion']),
    );

    // the record of what the model actually received
    const blind = await asTenant(() =>
      db.tx
        .selectFrom('cv_screenings')
        .select(['blind_input', 'score', 'prompt_version'])
        .where('application_id', '=', application.shahidul)
        .executeTakeFirstOrThrow(),
    );
    const text = blind.blind_input.toLowerCase();
    for (const forbidden of [
      'shahidul',
      'islam',
      'male',
      'married',
      '14-03-1997',
      '01711',
      'photo: attached',
      'abdul karim',
    ])
      expect(text).not.toContain(forbidden);
    // and it kept what the job is about
    expect(text).toContain('retail');
    expect(blind.prompt_version).toBe('cv-screening-v1');
  });

  it('a CV that matches little scores lower, with its reasons', async () => {
    const weak = (
      await co.hr.api
        .post(`/applications/${application.rakib}/screen`)
        .expect(200)
    ).body;
    const strong = (
      await co.hr.api.get(`/applications/${application.shahidul}`).expect(200)
    ).body.screenings[0];
    expect(weak.score).toBeLessThan(strong.score);
    expect(weak.reasons.join(' ').toLowerCase()).toContain('no evidence');
  });

  // cv_screenings keeps every screening an application has had, on purpose: the
  // applicant's own screen lists them as a history. The opening's list of
  // applicants joined that table, so each screening put the applicant in the
  // list again -- screen one CV twice and the opening showed that person twice,
  // with the same name, district and date.
  it('screening the same CV again does not list the applicant twice', async () => {
    const listed = async () =>
      (await co.hr.api.get(`/job-openings/${openingId}`).expect(200)).body
        .applications as Array<{
        id: string;
        screeningScore: number | null;
      }>;

    const before = await listed();
    await co.hr.api
      .post(`/applications/${application.rakib}/screen`)
      .expect(200);
    const after = await listed();

    expect(after).toHaveLength(before.length);
    // one row per application, however many times it has been screened
    expect(new Set(after.map((a) => a.id)).size).toBe(after.length);
    // and the score shown is the one from the latest screening
    const history = (
      await co.hr.api.get(`/applications/${application.rakib}`).expect(200)
    ).body.screenings as Array<{ score: number }>;
    expect(history.length).toBeGreaterThan(1);
    expect(after.find((a) => a.id === application.rakib)?.screeningScore).toBe(
      history[0].score,
    );
  });

  it('is refused without the CV text, and to someone who may not work the application', async () => {
    const noCv = (
      await co.hr.api
        .post(`${c}/applicants`, {
          fullNameEn: 'No CV Yet',
          phone: '01700000011',
          consent: true,
        })
        .expect(201)
    ).body;
    const app2 = (
      await co.hr.api
        .post(`/job-openings/${openingId}/applications`, {
          applicantId: noCv.id,
        })
        .expect(201)
    ).body;
    await co.hr.api.post(`/applications/${app2.id}/screen`).expect(400);
    await co.salesHead.api
      .post(`/applications/${application.shahidul}/screen`)
      .expect(403);
  });
});

describe('interviews and scorecards', () => {
  it('HR schedules a round with a panel; only the panel scores it', async () => {
    await co.hr.api
      .post(`/applications/${application.shahidul}/move`, {
        to: 'shortlisted',
        note: 'Best match on the route experience',
      })
      .expect(200);
    const interview = (
      await co.hr.api
        .post(`/applications/${application.shahidul}/interviews`, {
          scheduledAt: '2026-11-19T04:00:00.000Z',
          kind: 'in_person',
          place: 'Meghna Foods HQ, Gulshan',
          panelUserIds: [co.salesHead.userId, co.hr.userId],
        })
        .expect(201)
    ).body;
    interviewId = interview.id;
    expect(interview).toMatchObject({ roundNo: 1, state: 'scheduled' });
    const moved = (
      await co.hr.api.get(`/applications/${application.shahidul}`).expect(200)
    ).body;
    expect(moved.state).toBe('interviewing');

    // Rafi is not on this panel
    await co.rafi.api
      .post(`/interviews/${interviewId}/scorecard`, {
        overall: 5,
        recommendation: 'hire',
      })
      .expect(403);

    const scored = (
      await co.salesHead.api
        .post(`/interviews/${interviewId}/scorecard`, {
          scores: { 'Route knowledge': 5, Communication: 4 },
          overall: 4,
          recommendation: 'hire',
          notes: 'Knows the Mirpur shops; handled a dealer objection well.',
        })
        .expect(200)
    ).body;
    expect(scored.scorecards).toHaveLength(1);
    expect(scored.scorecards[0]).toMatchObject({
      interviewerId: co.salesHead.userId,
      recommendation: 'hire',
    });

    // a panel member replaces their own card, never adds a second
    const again = (
      await co.salesHead.api
        .post(`/interviews/${interviewId}/scorecard`, {
          overall: 5,
          recommendation: 'hire',
        })
        .expect(200)
    ).body;
    expect(again.scorecards).toHaveLength(1);
    expect(again.scorecards[0].overall).toBe(5);
  });

  it('a panel member sees their own interviews', async () => {
    const mine = (
      await co.salesHead.api.get(`${c}/my-interviews`).expect(200)
    ).body.interviews;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      id: interviewId,
      myScorecardGiven: true,
    });
  });

  it('HR records what the round decided', async () => {
    const done = (
      await co.hr.api
        .post(`/interviews/${interviewId}/finish`, { outcome: 'proceed' })
        .expect(200)
    ).body;
    expect(done).toMatchObject({ state: 'done', outcome: 'proceed' });
    await co.hr.api
      .post(`/interviews/${interviewId}/finish`, { outcome: 'proceed' })
      .expect(409);
  });
});

describe('the offer', () => {
  it('above the grade range it waits for the Admin, and cannot be sent before', async () => {
    const offer = (
      await co.hr.api
        .post(`/applications/${application.shahidul}/offer`, {
          branchId: co.branchId,
          departmentId: co.departments.salesDhaka,
          designationId,
          gradeId,
          grossSalary: '95000', // above the officer grade's maximum
          joiningOn: '2026-12-01',
          validUntil: '2026-11-30',
          probationMonths: 6,
          terms: 'Mobile and fuel allowance as per policy.',
        })
        .expect(201)
    ).body;
    offerId = offer.id;
    expect(offer).toMatchObject({
      number: expect.stringMatching(/^OF\/2026-27\/\d{5}$/),
      state: 'in_approval',
      outsideGradeRange: true,
    });
    await co.hr.api.post(`/job-offers/${offerId}/send`).expect(409);

    await co.md.api
      .post(`/approvals/requests/${offer.approvalRequestId}/approve`, {
        comment: 'Worth it for the north routes',
      })
      .expect(200);
    const approved = (
      await co.hr.api.get(`/job-offers/${offerId}`).expect(200)
    ).body;
    expect(approved.state).toBe('approved');
  });

  it('the salary is a sensitive field: the Sales head sees the offer without the amount', async () => {
    const hrView = (await co.hr.api.get(`/job-offers/${offerId}`).expect(200))
      .body;
    expect(hrView.grossSalary).toBe('95000.00');
    const headView = (
      await co.salesHead.api.get(`/job-offers/${offerId}`).expect(200)
    ).body;
    expect(headView.grossSalary).toBeNull();
    expect(headView.number).toBe(hrView.number);
  });

  it('the letter is a PDF, and only someone who may see salaries may print it', async () => {
    const pdf = await co.hr.api
      .get(`/job-offers/${offerId}/letter.pdf?lang=en`)
      .expect(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
    await co.salesHead.api
      .get(`/job-offers/${offerId}/letter.pdf`)
      .expect(403);
  });
});

describe('hiring (acceptance: nothing is retyped)', () => {
  it('the accepted offer makes the employee record from the applicant’s own data', async () => {
    await co.hr.api.post(`/job-offers/${offerId}/send`).expect(200);
    const accepted = (
      await co.hr.api.post(`/job-offers/${offerId}/accept`).expect(200)
    ).body;
    expect(accepted.state).toBe('accepted');
    expect(accepted.employee.employeeCode).toMatch(/^MFL/);
    expect(accepted.openingFilled).toBe(true);

    // the employee carries the applicant's details, and the offer's placement
    const employee = (
      await co.hr.api.get(`/employees/${accepted.employee.id}`).expect(200)
    ).body;
    expect(employee).toMatchObject({
      fullNameEn: 'Md. Shahidul Islam',
      dateOfBirth: '1997-03-14',
      gender: 'male',
      personalEmail: 'shahidul.islam@example.com',
      joinDate: '2026-12-01',
      status: 'draft',
    });
    // the placement starts on the joining date, so it is in the future today
    const placement = (
      await co.hr.api
        .get(`/employees/${accepted.employee.id}/assignments?asOf=2026-12-01`)
        .expect(200)
    ).body;
    expect(placement.designation.id).toBe(designationId);
    expect(placement.effectiveFrom).toBe('2026-12-01');

    // and its onboarding checklist started by itself (WP1)
    const onboarding = (
      await co.hr.api
        .get(`/employees/${accepted.employee.id}/onboarding`)
        .expect(200)
    ).body;
    expect(onboarding.length ?? onboarding.items?.length).toBeGreaterThan(0);

    // the application and the opening know what happened
    const hired = (
      await co.hr.api.get(`/applications/${application.shahidul}`).expect(200)
    ).body;
    expect(hired).toMatchObject({
      state: 'hired',
      hiredEmployeeId: accepted.employee.id,
    });
    const opening = (
      await co.hr.api.get(`/job-openings/${openingId}`).expect(200)
    ).body;
    expect(opening.state).toBe('filled');
  });

  it('one employee record can come from one application only', async () => {
    const hired = await asTenant(() =>
      db.tx
        .selectFrom('applications')
        .select(['id', 'hired_employee_id'])
        .where('opening_id', '=', openingId)
        .where('state', '=', 'hired')
        .executeTakeFirstOrThrow(),
    );
    await expect(
      asTenant(() =>
        db.tx
          .updateTable('applications')
          .set({ hired_employee_id: hired.hired_employee_id })
          .where('id', '=', application.rakib)
          .execute(),
      ),
    ).rejects.toThrow();
  });
});

describe('the applicant nobody hired (spec §11 retention)', () => {
  it('is rejected with a reason, and keeps its retention date', async () => {
    const rejected = (
      await co.hr.api
        .post(`/applications/${application.rakib}/move`, {
          to: 'rejected',
          note: 'No retail sales experience',
        })
        .expect(200)
    ).body;
    expect(rejected).toMatchObject({
      state: 'rejected',
      rejectedReason: 'No retail sales experience',
    });
  });

  it('is cleared when the period has passed, while the hired one is left alone', async () => {
    // put both applicants past their retention date, with consent old enough for the
    // database's floor (90 days)
    await asTenant(() =>
      db.tx
        .updateTable('applicants')
        .set({
          retention_until: '2026-01-01',
          consent_at: sql`now() - interval '400 days'`,
        })
        .where('company_id', '=', co.companyId)
        .execute(),
    );
    const service = app.get(ApplicantsService, { strict: false });
    const files = await asTenant(() => service.clearExpired());
    expect(files.applicants).toBeGreaterThan(0);
    const cleared = await asTenant(
      async () =>
        (
          await sql<{
            r: { applicants: number };
          }>`SELECT retention_apply(now() - interval '200 days', now() - interval '200 days', now() - interval '100 days', now()) AS r`.execute(
            db.tx,
          )
        ).rows[0].r,
    );
    expect(cleared.applicants).toBeGreaterThan(0);

    const rows = await asTenant(() =>
      db.tx
        .selectFrom('applicants')
        .select([
          'id',
          'full_name_en',
          'phone',
          'cv_text',
          'cv_file_key',
          'redacted_at',
        ])
        .where('company_id', '=', co.companyId)
        .execute(),
    );
    const hiredRow = rows.find((r) => r.id === applicant.shahidul)!;
    const rejectedRow = rows.find((r) => r.id === applicant.rakib)!;
    // hired: their details are an employee record now, with its own retention
    expect(hiredRow.redacted_at).toBeNull();
    expect(hiredRow.full_name_en).toBe('Md. Shahidul Islam');
    // not hired: the person is gone, the application count stays
    expect(rejectedRow.redacted_at).not.toBeNull();
    expect(rejectedRow.full_name_en).toBe('[removed after retention period]');
    expect(rejectedRow.phone).toBeNull();
    expect(rejectedRow.cv_text).toBeNull();
    expect(rejectedRow.cv_file_key).toBeNull();
    const stillCounted = await asTenant(() =>
      db.tx
        .selectFrom('applications')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('opening_id', '=', openingId)
        .executeTakeFirstOrThrow(),
    );
    expect(Number(stillCounted.n)).toBeGreaterThanOrEqual(2);

    // what the API shows for a cleared applicant
    const view = (
      await co.hr.api.get(`/applicants/${applicant.rakib}`).expect(200)
    ).body;
    expect(view).toMatchObject({ name: null, redacted: true });
  });
});
