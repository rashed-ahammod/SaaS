/**
 * WP24 opportunities, the pipeline and targets through the API (Meghna Foods test company).
 * Acceptance (docs/phase-3-plan.md): "The weighted forecast equals Σ value × probability of
 * open opportunities; every stage change is kept".
 *
 * Rafi (Sales Dhaka, under Tanvir the Sales head) and Sumaiya (in Finance, also a Sales user)
 * sell edible oil to dealers and shops. The clock stands at 3 November 2026.
 */
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { ManualClock } from '../../src/platform/clock.js';
import { apiFor, startApp, type Api } from './api-client.js';
import { createBdCompany, PASSWORD, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-11-03T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let c: string;
let sumaiya: Api;
let rafi: Api;
const stage: Record<string, string> = {};
const opp: Record<string, string> = {};
const customer: Record<string, string> = {};
const asTenant = <T>(work: () => Promise<T>) =>
  db.withTenant(
    { tenantId: co.tenant.id, access: AccessGrants.system() },
    work,
  );
const historyOf = (id: string) =>
  asTenant(() =>
    db.tx
      .selectFrom('opportunity_stage_history as h')
      .innerJoin('opportunity_stages as s', 's.id', 'h.to_stage_id')
      .select([
        's.name',
        'h.from_state',
        'h.to_state',
        'h.value',
        'h.probability',
        'h.note',
      ])
      .where('h.opportunity_id', '=', id)
      .orderBy('h.changed_at')
      .execute(),
  );
/** Σ value × probability / 100 of the open opportunities, straight from the table. */
const weightedInDb = async (
  where: (o: { owner_id: string; expected_close_on: string }) => boolean,
) => {
  const rows = await asTenant(() =>
    db.tx
      .selectFrom('opportunities')
      .select(['owner_id', 'value', 'probability', 'expected_close_on'])
      .where('state', '=', 'open')
      .execute(),
  );
  const paisa = rows
    .filter(where)
    .reduce((a, r) => a + Math.round(Number(r.value) * 100) * r.probability, 0); // paisa × percent
  return (Math.round(paisa / 100) / 100).toFixed(2);
};

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);
  c = `/companies/${co.companyId}`;
  for (const p of [co.rafi, co.financeOfficer])
    await co.owner
      .post(`/users/${p.userId}/roles`, { role: 'sales', scopeType: 'own' })
      .expect(201);
  rafi = await apiFor(app, {
    slug: co.tenant.slug,
    email: co.rafi.email,
    password: PASSWORD,
  });
  sumaiya = await apiFor(app, {
    slug: co.tenant.slug,
    email: co.financeOfficer.email,
    password: PASSWORD,
  });
  const add = async (api: Api, key: string, body: object) =>
    (customer[key] = (
      await api.post(`${c}/customers`, body).expect(201)
    ).body.id);
  await add(rafi, 'khatunganj', {
    kind: 'company',
    name: 'Khatunganj Traders',
    customerType: 'dealer',
    phone: '031-2856677',
    district: 'Chattogram',
  });
  await add(rafi, 'agrabad', {
    kind: 'company',
    name: 'Agrabad Super Shop',
    customerType: 'retail',
    phone: '01819-112233',
    district: 'Chattogram',
  });
  await add(sumaiya, 'sylhet', {
    kind: 'company',
    name: 'Sylhet Hotel Supply',
    customerType: 'corporate',
    email: 'purchase@sylhethotelsupply.com',
    district: 'Sylhet',
  });
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('stages', () => {
  it('five stages on first use; the Admin adds one, a salesperson may not', async () => {
    const stages = (await rafi.get(`${c}/opportunity-stages`).expect(200))
      .body as Array<{ id: string; name: string; probability: number }>;
    expect(stages.map((s) => `${s.name} ${s.probability}`)).toEqual([
      'Prospecting 10',
      'Needs identified 25',
      'Quotation sent 50',
      'Negotiation 70',
      'Verbal yes 90',
    ]);
    stages.forEach((s) => (stage[s.name] = s.id));
    await rafi
      .post(`${c}/opportunity-stages`, {
        name: 'Sample delivered',
        probability: 40,
        sortOrder: 3,
      })
      .expect(403);
    const sample = (
      await co.md.api
        .post(`${c}/opportunity-stages`, {
          name: 'Sample delivered',
          nameBn: 'নমুনা পাঠানো হয়েছে',
          probability: 40,
          sortOrder: 3,
        })
        .expect(201)
    ).body;
    stage['Sample delivered'] = sample.id;
    expect(
      (await rafi.get(`${c}/opportunity-stages`).expect(200)).body,
    ).toHaveLength(6);
  });
});

describe('opportunities', () => {
  it('a qualified lead becomes a customer and an opportunity at once', async () => {
    const lead = (
      await rafi
        .post(`${c}/leads`, {
          name: 'Abdul Karim',
          organisation: 'Karim Stores',
          phone: '01711-223344',
          district: 'Dhaka',
          source: 'walk_in',
        })
        .expect(201)
    ).body;
    await rafi
      .post(`/leads/${lead.id}/qualify`, {
        customer: {
          kind: 'company',
          name: 'Karim Stores',
          customerType: 'retail',
        },
        opportunity: {
          title: 'Rice bran oil 5 L, 200 cans a month',
          value: '360000',
          expectedCloseOn: '2026-11-20',
        },
      })
      .expect(200);
    const l = (await rafi.get(`/leads/${lead.id}`).expect(200)).body;
    expect(l.opportunities).toHaveLength(1);
    opp.karim = l.opportunities[0].id;
    const o = (await rafi.get(`/opportunities/${opp.karim}`).expect(200)).body;
    expect(o).toMatchObject({
      number: 'O/2026-27/00001',
      ownerId: co.rafi.userId,
      departmentId: co.departments.salesDhaka,
      stageName: 'Prospecting',
      probability: 10,
      value: '360000.00',
      weighted: '36000.00',
      lead: { id: lead.id },
    });
    expect(o.history).toMatchObject([
      {
        fromStage: null,
        toStage: 'Prospecting',
        toState: 'open',
        note: `From lead ${lead.number}`,
      },
    ]);
    customer.karim = o.customerId;
  });

  it('salespeople open opportunities on their own customers only', async () => {
    opp.khatunganj = (
      await rafi
        .post(`${c}/opportunities`, {
          customerId: customer.khatunganj,
          title: 'Soybean oil 1 L for Eid stock',
          value: '1250000',
          expectedCloseOn: '2026-12-10',
          stageId: stage['Needs identified'],
        })
        .expect(201)
    ).body.id;
    opp.agrabad = (
      await rafi
        .post(`${c}/opportunities`, {
          customerId: customer.agrabad,
          title: 'Mustard oil 500 ml, six months',
          value: '480000.50',
          expectedCloseOn: '2026-11-28',
          probability: 35,
        })
        .expect(201)
    ).body.id;
    opp.sylhet = (
      await sumaiya
        .post(`${c}/opportunities`, {
          customerId: customer.sylhet,
          title: 'Kitchen oil, 12-month hotel contract',
          value: '900000',
          expectedCloseOn: '2026-12-05',
        })
        .expect(201)
    ).body.id;
    // Rafi cannot see Sumaiya's customer, so cannot sell to it
    await rafi
      .post(`${c}/opportunities`, {
        customerId: customer.sylhet,
        title: 'X',
        value: '1',
        expectedCloseOn: '2026-12-01',
      })
      .expect(403);
    await rafi.get(`/opportunities/${opp.sylhet}`).expect(403);
    const mine = (await rafi.get(`${c}/opportunities`).expect(200))
      .body as Array<{ ownerId: string }>;
    expect(mine).toHaveLength(3);
    expect(mine.every((o) => o.ownerId === co.rafi.userId)).toBe(true);
    // the Sales head sees his department (Rafi), not Sumaiya, who sits in Finance; Accounts sees none
    const team = (await co.salesHead.api.get(`${c}/opportunities`).expect(200))
      .body as Array<{ id: string }>;
    expect(team.map((o) => o.id).sort()).toEqual(
      [opp.karim, opp.khatunganj, opp.agrabad].sort(),
    );
    await co.accounts.api.get(`${c}/opportunities`).expect(403);
  });

  it('every stage change is kept, with the value and probability of the moment', async () => {
    let o = (await rafi.get(`/opportunities/${opp.khatunganj}`).expect(200))
      .body;
    o = (
      await rafi
        .post(`/opportunities/${opp.khatunganj}/stage`, {
          version: o.version,
          stageId: stage['Quotation sent'],
          note: 'Quotation QT-118 sent by e-mail',
        })
        .expect(200)
    ).body;
    expect(o).toMatchObject({ stageName: 'Quotation sent', probability: 50 });
    o = (
      await rafi
        .patch(`/opportunities/${opp.khatunganj}`, {
          version: o.version,
          value: '1180000',
        })
        .expect(200)
    ).body; // a better price agreed
    o = (
      await rafi
        .post(`/opportunities/${opp.khatunganj}/stage`, {
          version: o.version,
          stageId: stage.Negotiation,
          probability: 80,
          note: 'Wants 45 days credit',
        })
        .expect(200)
    ).body;
    await rafi
      .post(`/opportunities/${opp.khatunganj}/stage`, {
        version: o.version - 1,
        stageId: stage['Verbal yes'],
      })
      .expect(409); // stale
    expect(
      o.history.map(
        (h: {
          toStage: string;
          value: string;
          probability: number;
          note: string | null;
        }) => [h.toStage, h.value, h.probability, h.note],
      ),
    ).toEqual([
      ['Needs identified', '1250000.00', 25, null],
      ['Quotation sent', '1250000.00', 50, 'Quotation QT-118 sent by e-mail'],
      ['Negotiation', '1180000.00', 80, 'Wants 45 days credit'],
    ]);
  });

  it('the history is kept by the database: a change made around the API is recorded too, and nothing is rewritten', async () => {
    await asTenant(() =>
      db.tx
        .updateTable('opportunities')
        .set({ stage_id: stage['Sample delivered'], probability: 40 })
        .where('id', '=', opp.agrabad)
        .execute(),
    );
    expect(
      (await historyOf(opp.agrabad)).map((h) => `${h.name} ${h.probability}`),
    ).toEqual(['Prospecting 35', 'Sample delivered 40']);
    await expect(
      asTenant(() =>
        db.tx
          .updateTable('opportunity_stage_history')
          .set({ note: 'edited' })
          .where('opportunity_id', '=', opp.agrabad)
          .execute(),
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(() =>
        db.tx
          .deleteFrom('opportunity_stage_history')
          .where('opportunity_id', '=', opp.agrabad)
          .execute(),
      ),
    ).rejects.toThrow();
  });

  it('won raises opportunity.won; lost needs a reason; a closed one opens again with a note', async () => {
    let o = (await rafi.get(`/opportunities/${opp.karim}`).expect(200)).body;
    await rafi
      .post(`/opportunities/${opp.karim}/won`, {
        version: o.version,
        closedOn: '2026-11-10',
      })
      .expect(400); // in the future
    o = (
      await rafi
        .post(`/opportunities/${opp.karim}/won`, {
          version: o.version,
          value: '342000',
          note: 'First order: 190 cans',
        })
        .expect(200)
    ).body;
    expect(o).toMatchObject({
      state: 'won',
      probability: 100,
      value: '342000.00',
      closedOn: '2026-11-03',
    });
    await rafi
      .post(`/opportunities/${opp.karim}/stage`, {
        version: o.version,
        stageId: stage.Negotiation,
      })
      .expect(409);
    const event = await asTenant(() =>
      db.tx
        .selectFrom('outbox_events')
        .select('payload')
        .where('type', '=', 'opportunity.won')
        .executeTakeFirstOrThrow(),
    );
    expect(event.payload).toMatchObject({
      opportunityId: opp.karim,
      ownerId: co.rafi.userId,
      value: '342000.00',
      closedOn: '2026-11-03',
    });

    let a = (await rafi.get(`/opportunities/${opp.agrabad}`).expect(200)).body;
    await rafi
      .post(`/opportunities/${opp.agrabad}/lost`, { version: a.version })
      .expect(400);
    a = (
      await rafi
        .post(`/opportunities/${opp.agrabad}/lost`, {
          version: a.version,
          reason: 'competitor',
          note: 'Bought Teer at Tk 4 less a bottle',
        })
        .expect(200)
    ).body;
    expect(a).toMatchObject({
      state: 'lost',
      probability: 0,
      lostReason: 'competitor',
    });
    a = (
      await rafi
        .post(`/opportunities/${opp.agrabad}/reopen`, {
          version: a.version,
          stageId: stage.Negotiation,
          expectedCloseOn: '2026-12-20',
          note: 'Teer stock ran out; asking us again',
        })
        .expect(200)
    ).body;
    expect(a).toMatchObject({
      state: 'open',
      stageName: 'Negotiation',
      probability: 70,
      lostReason: null,
    });
    expect(
      a.history.map(
        (h: { toStage: string; fromState: string | null; toState: string }) =>
          `${h.fromState ?? '-'}>${h.toState} ${h.toStage}`,
      ),
    ).toEqual([
      '->open Prospecting',
      'open>open Sample delivered',
      'open>lost Sample delivered',
      'lost>open Negotiation',
    ]);
  });

  it('a stage with open opportunities cannot be retired', async () => {
    const s = (
      await co.md.api.get(`${c}/opportunity-stages`).expect(200)
    ).body.find((x: { id: string }) => x.id === stage.Negotiation);
    expect(s.openCount).toBe(2);
    expect(
      (
        await co.md.api
          .put(`/opportunity-stages/${stage.Negotiation}`, {
            version: s.version,
            name: s.name,
            probability: 70,
            sortOrder: s.sortOrder,
            isActive: false,
          })
          .expect(409)
      ).body.code,
    ).toBe('STAGE_IN_USE');
  });

  it('the Sales head hands an opportunity over within his department only', async () => {
    const o = (
      await co.salesHead.api.get(`/opportunities/${opp.khatunganj}`).expect(200)
    ).body;
    await co.salesHead.api
      .post(`/opportunities/${opp.khatunganj}/assign`, {
        ownerId: co.financeOfficer.userId,
      })
      .expect(403);
    await rafi
      .post(`/opportunities/${opp.khatunganj}/assign`, {
        ownerId: co.financeOfficer.userId,
      })
      .expect(403);
    expect(o.ownerId).toBe(co.rafi.userId);
  });
});

describe('pipeline and forecast', () => {
  it('the weighted forecast equals Σ value × probability of the open opportunities', async () => {
    const f = (
      await co.md.api
        .get(`${c}/sales-forecast?from=2026-11&to=2027-01`)
        .expect(200)
    ).body;
    const inWindow = (o: { expected_close_on: string }) =>
      o.expected_close_on >= '2026-11-01' &&
      o.expected_close_on <= '2027-01-31';
    expect(f.total.weighted).toBe(await weightedInDb(inWindow));
    // 1,180,000 × 80% + 480,000.50 × 70% + 900,000 × 10%
    expect(f.total).toEqual({
      count: 3,
      value: '2560000.50',
      weighted: '1370000.35',
    });
    expect(
      f.months.map((m: { month: string; weighted: string; won: string }) => [
        m.month,
        m.weighted,
        m.won,
      ]),
    ).toEqual([
      ['2026-11', '0.00', '342000.00'],
      ['2026-12', '1370000.35', '0.00'],
      ['2027-01', '0.00', '0.00'],
    ]);
    expect(
      f.byStage.map(
        (s: { name: string; weighted: string }) => `${s.name} ${s.weighted}`,
      ),
    ).toEqual(['Prospecting 90000.00', 'Negotiation 1280000.35']);
    // each sees their own part
    const mine = (
      await rafi.get(`${c}/sales-forecast?from=2026-11&to=2027-01`).expect(200)
    ).body;
    expect(mine.total.weighted).toBe(
      await weightedInDb((o) => inWindow(o) && o.owner_id === co.rafi.userId),
    );
    expect(mine.total.weighted).toBe('1280000.35');
    await rafi.get(`${c}/sales-forecast?from=2027-01&to=2026-11`).expect(400);
  });

  it('an open opportunity past its close date is shown apart as late', async () => {
    const o = (await sumaiya.get(`/opportunities/${opp.sylhet}`).expect(200))
      .body;
    await sumaiya
      .patch(`/opportunities/${opp.sylhet}`, {
        version: o.version,
        expectedCloseOn: '2026-10-25',
      })
      .expect(200);
    const f = (
      await co.md.api
        .get(`${c}/sales-forecast?from=2026-11&to=2027-01`)
        .expect(200)
    ).body;
    expect(f.late).toEqual({
      count: 1,
      value: '900000.00',
      weighted: '90000.00',
    });
    expect(f.total.weighted).toBe('1280000.35');
  });

  it('the board: open opportunities by stage, and what was won this month', async () => {
    const b = (await co.salesHead.api.get(`${c}/pipeline`).expect(200)).body;
    const col = (name: string) =>
      b.stages.find((s: { name: string }) => s.name === name);
    expect(col('Negotiation')).toMatchObject({
      count: 2,
      value: '1660000.50',
      weighted: '1280000.35',
    });
    expect(col('Prospecting')).toMatchObject({ count: 0 });
    expect(b.open.weighted).toBe('1280000.35');
    expect(b.wonThisMonth).toMatchObject({ count: 1, value: '342000.00' });
  });
});

describe('targets', () => {
  it("the Sales head sets his salespeople's targets; the Admin sets the department's", async () => {
    await co.salesHead.api
      .put(`${c}/sales-targets`, {
        month: '2026-11',
        targets: [{ userId: co.rafi.userId, amount: '1500000' }],
      })
      .expect(200);
    await co.salesHead.api
      .put(`${c}/sales-targets`, {
        month: '2026-11',
        targets: [{ userId: co.financeOfficer.userId, amount: '500000' }],
      })
      .expect(403);
    await co.salesHead.api
      .put(`${c}/sales-targets`, {
        month: '2026-11',
        targets: [{ departmentId: co.departments.sales, amount: '4000000' }],
      })
      .expect(403);
    await rafi
      .put(`${c}/sales-targets`, {
        month: '2026-11',
        targets: [{ userId: co.rafi.userId, amount: '1' }],
      })
      .expect(403);
    expect(
      (
        await co.md.api
          .put(`${c}/sales-targets`, {
            month: '2026-11',
            targets: [
              {
                userId: co.rafi.userId,
                departmentId: co.departments.sales,
                amount: '1',
              },
            ],
          })
          .expect(400)
      ).body.code,
    ).toBe('TARGET_INVALID');
    const t = (
      await co.md.api
        .put(`${c}/sales-targets`, {
          month: '2026-11',
          targets: [
            { departmentId: co.departments.sales, amount: '4000000' },
            { userId: co.financeOfficer.userId, amount: '600000' },
          ],
        })
        .expect(200)
    ).body;
    const row = (name: string) =>
      t.rows.find((r: { name: string }) => r.name === name);
    // the Sales department counts Sales Dhaka (Rafi) too
    expect(row('Sales')).toMatchObject({
      kind: 'department',
      amount: '4000000.00',
      won: '342000.00',
      attainment: 8.6,
    });
    expect(row('Mahmudul Hasan Rafi')).toMatchObject({
      kind: 'user',
      amount: '1500000.00',
      won: '342000.00',
      attainment: 22.8,
    });
    expect(
      row('Sumaiya Akter') ??
        t.rows.find(
          (r: { userId: string }) => r.userId === co.financeOfficer.userId,
        ),
    ).toMatchObject({ amount: '600000.00', won: '0.00' });
  });

  it('a salesperson sees only their own target', async () => {
    const t = (await rafi.get(`${c}/sales-targets?month=2026-11`).expect(200))
      .body;
    expect(t.rows).toEqual([
      expect.objectContaining({
        kind: 'user',
        userId: co.rafi.userId,
        canSet: false,
      }),
    ]);
    const head = (
      await co.salesHead.api.get(`${c}/sales-targets?month=2026-11`).expect(200)
    ).body;
    expect(
      head.rows.map(
        (r: { kind: string; name: string; canSet: boolean }) =>
          `${r.kind} ${r.name} ${r.canSet}`,
      ),
    ).toEqual(['department Sales false', 'user Mahmudul Hasan Rafi true']);
    // the December weighted value expected for Rafi
    const dec = (
      await co.md.api.get(`${c}/sales-targets?month=2026-12`).expect(200)
    ).body;
    expect(
      dec.rows.find((r: { userId: string }) => r.userId === co.rafi.userId),
    ).toMatchObject({ amount: null, expected: '1280000.35' });
  });

  it('the stage history has one row per change, never more', async () => {
    const n = await asTenant(() =>
      db.tx
        .selectFrom('opportunity_stage_history')
        .select(sql<number>`count(*)::int`.as('n'))
        .executeTakeFirstOrThrow(),
    );
    // karim 2 (open, won), khatunganj 3, agrabad 4, sylhet 1
    expect(n.n).toBe(10);
  });
});
