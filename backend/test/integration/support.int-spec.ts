/**
 * WP28 support tickets and Customer 360 through the API (Meghna Foods test company).
 * Acceptance (docs/phase-3-plan.md): "A breach is raised on time from the SLA clock;
 * Customer 360 shows only what the viewer may see".
 *
 * The clock starts Thursday 12 November 2026 at 10:00 Dhaka. Dhaka HQ keeps a Friday and
 * Saturday weekend, so the SLA clock stops for two days — which is what makes the breach
 * tests worth running.
 *
 * People: Anwar (MD, Admin: sees and assigns every ticket), Tanvir (Dept Head of Sales:
 * his department's tickets), Rafi (Sales user, own scope: the tickets on his desk),
 * Sumaiya (Accounts: dues but no tickets).
 */
import type { INestApplication } from '@nestjs/common';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { TicketSlaService } from '../../src/modules/support/ticket-sla.service.js';
import { ManualClock } from '../../src/platform/clock.js';
import { apiFor, startApp, type Api } from './api-client.js';
import { createBdCompany, PASSWORD, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const dhaka = (local: string) => new Date(`${local}+06:00`);
const clock = new ManualClock(dhaka('2026-11-12T10:00:00'));

let app: INestApplication;
let co: BdCompany;
let c: string;
let sumaiya: Api;
let sla: TicketSlaService;
const category: Record<string, string> = {};
let karim: string; // customer, account manager Rafi
let ticket: string;

const asTenant = <T>(work: () => Promise<T>) =>
  db.withTenant(
    { tenantId: co.tenant.id, access: AccessGrants.system() },
    work,
  );
const events = (type: string) =>
  asTenant(() =>
    db.tx
      .selectFrom('outbox_events')
      .select(['id', 'payload'])
      .where('type', '=', type)
      .execute(),
  );
const processDue = () => asTenant(() => sla.processDue());

beforeAll(async () => {
  app = await startApp({ clock });
  sla = app.get(TicketSlaService, { strict: false });
  co = await createBdCompany(app, db);
  c = `/companies/${co.companyId}`;
  sla = app.get(TicketSlaService, { strict: false });

  // Rafi works his own customers' tickets (Sales user, own scope)
  await co.owner
    .post(`/users/${co.rafi.userId}/roles`, { role: 'sales', scopeType: 'own' })
    .expect(201);
  co.rafi.api = await apiFor(app, {
    slug: co.tenant.slug,
    email: co.rafi.email,
    password: PASSWORD,
  });
  sumaiya = await apiFor(app, {
    slug: co.tenant.slug,
    email: co.financeOfficer.email,
    password: PASSWORD,
  });

  karim = (
    await co.md.api
      .post(`${c}/customers`, {
        kind: 'company',
        name: 'Karim Stores',
        nameBn: 'করিম স্টোর্স',
        district: 'Chattogram',
        phone: '01711223344',
        accountManagerId: co.rafi.userId,
      })
      .expect(201)
  ).body.id;
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('settings', () => {
  it('a company starts with the shipped categories and SLA hours, in working hours', async () => {
    const list = (await co.md.api.get(`${c}/support/categories`).expect(200))
      .body.categories as Array<{ id: string; code: string }>;
    expect(list.map((x) => x.code)).toEqual(
      expect.arrayContaining(['DELIVERY', 'QUALITY', 'BILLING']),
    );
    for (const row of list) category[row.code] = row.id;

    const policy = (await co.md.api.get(`${c}/support/sla`).expect(200)).body;
    expect(policy.urgent).toEqual({
      firstResponseHours: 2,
      resolutionHours: 8,
    });
    expect(policy.low.resolutionHours).toBeGreaterThan(
      policy.urgent.resolutionHours,
    );
  });

  it('only support.manage changes them, and resolution is never sooner than the first response', async () => {
    await sumaiya
      .put(`${c}/support/sla`, {
        rows: [
          { priority: 'urgent', firstResponseHours: 1, resolutionHours: 4 },
        ],
      })
      .expect(403);
    await co.md.api
      .put(`${c}/support/sla`, {
        rows: [
          { priority: 'urgent', firstResponseHours: 8, resolutionHours: 4 },
        ],
      })
      .expect(400);
    const saved = (
      await co.md.api
        .put(`${c}/support/sla`, {
          rows: [
            { priority: 'high', firstResponseHours: 4, resolutionHours: 12 },
          ],
        })
        .expect(200)
    ).body;
    expect(saved.high).toEqual({
      firstResponseHours: 4,
      resolutionHours: 12,
    });
  });

  it('the service manager adds a category of their own', async () => {
    const after = (
      await co.md.api
        .post(`${c}/support/categories`, {
          code: 'COLD-CHAIN',
          name: 'Cold chain failure',
          nameBn: 'হিমায়ন ব্যর্থতা',
          defaultPriority: 'urgent',
        })
        .expect(201)
    ).body.categories as Array<{ id: string; code: string }>;
    const added = after.find((x) => x.code === 'COLD-CHAIN')!;
    category['COLD-CHAIN'] = added.id;
    await co.md.api
      .post(`${c}/support/categories`, { code: 'COLD-CHAIN', name: 'Again' })
      .expect(409);
  });
});

describe('a ticket from the customer', () => {
  it('takes the category priority, goes to the account manager, and gets deadlines in working hours', async () => {
    const t = (
      await co.md.api
        .post(`${c}/support/tickets`, {
          customerId: karim,
          categoryId: category.DELIVERY,
          subject: 'Two cans leaked on delivery',
          description:
            'The driver delivered 10 cans of rice bran oil; 2 were leaking.',
          source: 'phone',
        })
        .expect(201)
    ).body;
    ticket = t.id;
    expect(t).toMatchObject({
      number: expect.stringMatching(/^T\/2026-27\/\d{5}$/),
      priority: 'high', // DELIVERY ships as high
      state: 'new',
      assigneeId: co.rafi.userId, // Karim Stores' account manager
    });
    // high is 4 working hours to answer and 12 to resolve (set above): both still fit
    // inside Thursday, because working hours run through the whole of a working day
    // (ADR 0005) and stop only on weekends and holidays
    expect(new Date(t.sla.firstResponseDueAt)).toEqual(
      dhaka('2026-11-12T14:00:00'),
    );
    expect(new Date(t.sla.resolutionDueAt)).toEqual(
      dhaka('2026-11-12T22:00:00'),
    );
    expect(t.description).toContain('2 were leaking');
  });

  it('is in the account manager’s list, and in the Admin’s, but not in Accounts’', async () => {
    const mine = (
      await co.rafi.api.get(`${c}/support/my-tickets`).expect(200)
    ).body.tickets;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: ticket, customerName: 'Karim Stores' });

    const all = (
      await co.md.api.get(`${c}/support/tickets?state=open_only`).expect(200)
    ).body.tickets;
    expect(all.map((x: { id: string }) => x.id)).toContain(ticket);

    await sumaiya.get(`${c}/support/tickets`).expect(403);
    await sumaiya.get(`/support/tickets/${ticket}`).expect(403);
  });

  it('publishes ticket.created, with no customer wording in the payload', async () => {
    const created = await events('ticket.created');
    expect(created).toHaveLength(1);
    const payload = created[0].payload as Record<string, unknown>;
    expect(payload).toMatchObject({ ticketId: ticket, priority: 'high' });
    expect(JSON.stringify(payload)).not.toContain('leaking');
  });
});

describe('working the ticket', () => {
  it('an internal note is not an answer to the customer: the response clock runs on', async () => {
    const after = (
      await co.rafi.api
        .post(`/support/tickets/${ticket}/messages`, {
          kind: 'note',
          body: 'Checked the challan: driver Jamal, van DM-11-4471.',
        })
        .expect(201)
    ).body;
    expect(after.sla.firstResponseAt).toBeNull();
    expect(after.state).toBe('new');
    expect(after.messages.map((m: { kind: string }) => m.kind)).toEqual([
      'note',
    ]);
  });

  it('the first reply stops the response clock and puts the ticket in work', async () => {
    clock.set(dhaka('2026-11-12T11:30:00'));
    const after = (
      await co.rafi.api
        .post(`/support/tickets/${ticket}/messages`, {
          kind: 'reply',
          body: 'Sorry about that. We are sending 2 replacement cans tomorrow.',
        })
        .expect(201)
    ).body;
    expect(new Date(after.sla.firstResponseAt)).toEqual(
      dhaka('2026-11-12T11:30:00'),
    );
    expect(after.state).toBe('open');
    expect(after.sla.firstResponseBreached).toBe(false);
  });

  it('the time the customer keeps it is given back to the team', async () => {
    const asked = (
      await co.rafi.api
        .post(`/support/tickets/${ticket}/wait`, {
          question: 'Could you send a photo of the two cans?',
        })
        .expect(200)
    ).body;
    expect(asked.state).toBe('waiting_customer');
    const dueBefore = new Date(asked.sla.resolutionDueAt);

    // the photo comes on Sunday afternoon: Friday and Saturday never counted, so the
    // deadline moves out by the working hours between Thursday 11:30 and Sunday 14:00
    clock.set(dhaka('2026-11-15T14:00:00'));
    const back = (
      await co.rafi.api
        .post(`/support/tickets/${ticket}/messages`, {
          kind: 'customer',
          body: 'Photo attached, both cans are half empty.',
        })
        .expect(201)
    ).body;
    expect(back.state).toBe('open');
    expect(back.sla.waitingSince).toBeNull();
    const dueAfter = new Date(back.sla.resolutionDueAt);
    // Thursday 11:30-24:00 = 12.5 h, Sunday 00:00-14:00 = 14 h: 26.5 working hours
    expect(dueAfter.getTime() - dueBefore.getTime()).toBe(
      26.5 * 3_600_000 + 2 * 24 * 3_600_000, // the push itself crosses no weekend
    );
  });

  it('a higher priority tightens the deadlines from the ticket’s own clock', async () => {
    const after = (
      await co.rafi.api
        .put(`/support/tickets/${ticket}/priority`, {
          priority: 'urgent',
          reason: 'The shop is a dealer and the stock is unsellable.',
        })
        .expect(200)
    ).body;
    expect(after.priority).toBe('urgent');
    // urgent: 8 working hours from the ticket's own clock (Thursday 10:00) = Thursday 18:00,
    // which is already in the past, so the ticket is overdue the moment it becomes urgent
    expect(new Date(after.sla.resolutionDueAt)).toEqual(
      dhaka('2026-11-12T18:00:00'),
    );
    expect(
      after.messages.some((m: { body: string }) =>
        m.body.includes('high -> urgent'),
      ),
    ).toBe(true);
  });

  it('only support.manage hands a ticket to someone else, and only to someone who may work it', async () => {
    await co.rafi.api
      .post(`/support/tickets/${ticket}/assign`, {
        assigneeId: co.salesHead.userId,
      })
      .expect(403);
    await co.md.api
      .post(`/support/tickets/${ticket}/assign`, {
        assigneeId: co.hr.userId, // HR works no tickets
      })
      .expect(400);
    const after = (
      await co.md.api
        .post(`/support/tickets/${ticket}/assign`, {
          assigneeId: co.salesHead.userId,
          note: 'Tanvir is visiting Chattogram tomorrow.',
        })
        .expect(200)
    ).body;
    expect(after.assigneeId).toBe(co.salesHead.userId);
    const assigned = await events('ticket.assigned');
    expect(assigned).toHaveLength(1);
  });
});

describe('the SLA clock (acceptance: a breach is raised on time, once)', () => {
  it('the ticket that went past its resolution deadline is raised once, never twice', async () => {
    // the clock is Sunday 14:00; the urgent deadline was Thursday 18:00
    expect(await processDue()).toEqual({ firstResponse: 0, resolution: 1 });
    expect(await processDue()).toEqual({ firstResponse: 0, resolution: 0 });

    const breaches = await events('ticket.sla_breached');
    expect(breaches).toHaveLength(1);
    expect(breaches[0].payload).toMatchObject({
      ticketId: ticket,
      clock: 'resolution',
      priority: 'urgent',
    });
    const t = (await co.md.api.get(`/support/tickets/${ticket}`).expect(200))
      .body;
    expect(t.sla.resolutionBreached).toBe(true);
  });

  it('a new ticket is left alone until its deadline, then each clock is raised once', async () => {
    const other = (
      await co.md.api
        .post(`${c}/support/tickets`, {
          customerId: karim,
          categoryId: category['COLD-CHAIN'],
          subject: 'Freezer van broke down in Feni',
          description: 'Whole consignment is warm.',
          assigneeId: co.salesHead.userId,
        })
        .expect(201)
    ).body;
    // urgent (the category's priority): 2 working hours to answer, 8 to resolve
    expect(other.priority).toBe('urgent');
    expect(new Date(other.sla.firstResponseDueAt)).toEqual(
      dhaka('2026-11-15T16:00:00'),
    );

    clock.set(dhaka('2026-11-15T15:00:00')); // still inside the first hour
    expect(await processDue()).toEqual({ firstResponse: 0, resolution: 0 });

    clock.set(dhaka('2026-11-16T10:00:00')); // Monday, past both deadlines
    expect(await processDue()).toEqual({ firstResponse: 1, resolution: 1 });
    expect(await processDue()).toEqual({ firstResponse: 0, resolution: 0 });

    const breaches = await events('ticket.sla_breached');
    expect(
      breaches.filter(
        (b) => (b.payload as { ticketId: string }).ticketId === other.id,
      ),
    ).toHaveLength(2);
    const breached = (
      await co.md.api.get(`${c}/support/tickets?state=breached`).expect(200)
    ).body.tickets;
    expect(breached.map((x: { id: string }) => x.id)).toEqual(
      expect.arrayContaining([ticket, other.id]),
    );
  });
});

describe('resolving, closing and reopening', () => {
  it('a resolved ticket always says how, and the customer is told', async () => {
    const after = (
      await co.salesHead.api
        .post(`/support/tickets/${ticket}/resolve`, {
          resolution:
            '2 cans replaced from the Chattogram depot on 16 November; credit note not needed.',
        })
        .expect(200)
    ).body;
    expect(after).toMatchObject({ state: 'resolved' });
    expect(after.resolutionNote).toContain('2 cans replaced');
    expect(
      after.messages.filter((m: { kind: string }) => m.kind === 'reply'),
    ).toHaveLength(3); // the first reply, the question, the resolution
  });

  it('a closed ticket takes no more replies', async () => {
    await co.salesHead.api
      .post(`/support/tickets/${ticket}/close`, {})
      .expect(200);
    await co.salesHead.api
      .post(`/support/tickets/${ticket}/messages`, {
        kind: 'reply',
        body: 'One more thing',
      })
      .expect(400);
  });

  it('reopening needs support.manage and a reason, and starts a fresh clock', async () => {
    await co.rafi.api
      .post(`/support/tickets/${ticket}/reopen`, { reason: 'Leaked again' })
      .expect(403);
    clock.set(dhaka('2026-11-17T09:00:00')); // Tuesday
    const after = (
      await co.md.api
        .post(`/support/tickets/${ticket}/reopen`, {
          reason: 'The replacement cans leaked as well.',
        })
        .expect(200)
    ).body;
    expect(after).toMatchObject({
      state: 'open',
      reopenedCount: 1,
      resolutionNote: null,
    });
    expect(after.sla.firstResponseAt).toBeNull();
    expect(after.sla.resolutionBreached).toBe(false);
    expect(new Date(after.sla.resolutionDueAt)).toEqual(
      dhaka('2026-11-17T17:00:00'), // urgent: 8 working hours from now
    );
  });
});

describe('Customer 360 (acceptance: only what the viewer may see)', () => {
  it('the account manager sees the customer, activities, money and tickets', async () => {
    const page = (await co.rafi.api.get(`/customers/${karim}/360`).expect(200))
      .body;
    expect(page.customer).toMatchObject({ name: 'Karim Stores' });
    expect(page.sees).toEqual({ crm: true, money: true, support: true });
    expect(Array.isArray(page.opportunities)).toBe(true);
    expect(page.dues).toMatchObject({ owed: '0.00', overdue: '0.00' });
    expect(page.tickets.map((t: { id: string }) => t.id)).toContain(ticket);
  });

  it('Accounts sees the dues but not one ticket', async () => {
    const page = (
      await co.accounts.api.get(`/customers/${karim}/360`).expect(200)
    ).body;
    expect(page.sees).toMatchObject({ support: false });
    expect(page.dues).toBeDefined();
    expect(page.tickets).toBeUndefined();
  });

  it('someone with no claim on the customer gets nothing at all', async () => {
    await co.hr.api.get(`/customers/${karim}/360`).expect(403);
  });
});
