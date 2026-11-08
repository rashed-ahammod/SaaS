/**
 * WP2 approval engine through the API, using salary bank/wallet changes as the
 * request type. Acceptance criteria (guide §24):
 *   - self-approval is impossible;
 *   - SLA escalation fires on working hours.
 */
import type { INestApplication } from '@nestjs/common';
import { ApprovalSlaService } from '../../src/modules/approvals/approval-sla.service.js';
import { ManualClock } from '../../src/platform/clock.js';
import { todayInDhaka } from '../../src/platform/dates/business-date.js';
import { startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const dhaka = (local: string) => new Date(`${local}+06:00`);

const bkash = (number = '01712345678') => ({
  kind: 'wallet',
  walletProvider: 'bkash',
  walletNumber: number,
  accountName: 'Mahmudul Hasan Rafi',
});
const dbbl = {
  kind: 'bank',
  bankName: 'Dutch-Bangla Bank PLC',
  branchName: 'Gulshan',
  routingNumber: '090261725',
  accountName: 'Mahmudul Hasan Rafi',
  accountNumber: '1051100012345',
};

async function eventsOfType(tenantId: string, type: string) {
  return db.withTenant({ tenantId }, () =>
    db.tx
      .selectFrom('outbox_events')
      .select(['type', 'payload'])
      .where('type', '=', type)
      .execute(),
  );
}

describe('approval engine (real clock)', () => {
  let app: INestApplication;
  let co: BdCompany;

  beforeAll(async () => {
    app = await startApp();
    co = await createBdCompany(app, db);
  }, 120_000);

  afterAll(() => app.close());

  it('an employee requests a bKash account; HR approves; it becomes the salary account', async () => {
    // Rafi asks (own record)
    const submitted = await co.rafi.api
      .post(`/employees/${co.rafi.employeeId}/bank-accounts`, bkash())
      .expect(201);
    const requestId = submitted.body.approvalRequestId;
    expect(submitted.body.account).toMatchObject({
      status: 'pending',
      provider: 'bkash',
      number: '01712345678',
    }); // own record: full

    // HR sees it in the inbox, Rafi does not
    const inbox = (await co.hr.api.get('/approvals/inbox').expect(200)).body;
    expect(inbox.map((i: { requestId: string }) => i.requestId)).toContain(
      requestId,
    );
    expect(
      (await co.rafi.api.get('/approvals/inbox').expect(200)).body,
    ).toEqual([]);

    // the Dept Head sees the account number masked
    const forHead = await co.salesHead.api
      .get(`/employees/${co.rafi.employeeId}/bank-accounts`)
      .expect(200);
    expect(forHead.body[0].number).toBe('**** 5678');

    // HR approves -> executed, account approved, employee notified via outbox
    const done = await co.hr.api
      .post(`/approvals/requests/${requestId}/approve`, {
        comment: 'Checked with NID',
      })
      .expect(200);
    expect(done.body.state).toBe('executed');
    const accounts = (
      await co.hr.api
        .get(`/employees/${co.rafi.employeeId}/bank-accounts`)
        .expect(200)
    ).body;
    expect(accounts[0]).toMatchObject({
      status: 'approved',
      number: '01712345678',
    });
    const notices = await eventsOfType(
      co.tenant.id,
      'employee.bank_account_changed',
    );
    expect(notices.length).toBeGreaterThan(0);
  });

  it('a second change retires the first account; only one waits at a time', async () => {
    const first = await co.hr.api
      .post(`/employees/${co.rafi.employeeId}/bank-accounts`, dbbl)
      .expect(201);
    const dup = await co.hr.api.post(
      `/employees/${co.rafi.employeeId}/bank-accounts`,
      bkash('01811111111'),
    );
    expect(dup.body.code).toBe('BANK_ACCOUNT_PENDING_EXISTS');

    // HR submitted it, so HR (Farzana) cannot approve it: the workspace owner (also HR) does
    const self = await co.hr.api.post(
      `/approvals/requests/${first.body.approvalRequestId}/approve`,
      {},
    );
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('APPROVAL_SELF_APPROVAL');
    await co.owner
      .post(`/approvals/requests/${first.body.approvalRequestId}/approve`, {})
      .expect(200);

    const accounts = (
      await co.hr.api
        .get(`/employees/${co.rafi.employeeId}/bank-accounts`)
        .expect(200)
    ).body;
    expect(
      accounts.map(
        (a: { provider: string; status: string }) =>
          `${a.provider}:${a.status}`,
      ),
    ).toEqual(['Dutch-Bangla Bank PLC:approved', 'bkash:retired']);
  });

  it('reject needs a comment and leaves the account rejected', async () => {
    const r = await co.rafi.api
      .post(
        `/employees/${co.rafi.employeeId}/bank-accounts`,
        bkash('01999999999'),
      )
      .expect(201);
    const id = r.body.approvalRequestId;
    expect(
      (await co.hr.api.post(`/approvals/requests/${id}/reject`, {})).status,
    ).toBe(400);
    await co.hr.api
      .post(`/approvals/requests/${id}/reject`, {
        comment: 'Number is not registered to the employee',
      })
      .expect(200);

    const detail = (
      await co.rafi.api.get(`/approvals/requests/${id}`).expect(200)
    ).body;
    expect(detail.state).toBe('rejected');
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual([
      'submit',
      'reject',
    ]);
    const accounts = (
      await co.hr.api
        .get(`/employees/${co.rafi.employeeId}/bank-accounts`)
        .expect(200)
    ).body;
    expect(
      accounts.find((a: { number: string }) => a.number === '01999999999')
        .status,
    ).toBe('rejected');
  });

  it('only the requester can cancel', async () => {
    const r = await co.rafi.api
      .post(
        `/employees/${co.rafi.employeeId}/bank-accounts`,
        bkash('01555555555'),
      )
      .expect(201);
    const id = r.body.approvalRequestId;
    expect(
      (await co.hr.api.post(`/approvals/requests/${id}/cancel`, {})).body.code,
    ).toBe('APPROVAL_CANCEL_NOT_ALLOWED');
    await co.rafi.api
      .post(`/approvals/requests/${id}/cancel`, { comment: 'Wrong number' })
      .expect(200);
    expect(
      (await co.hr.api.post(`/approvals/requests/${id}/approve`, {})).body.code,
    ).toBe('APPROVAL_NOT_OPEN');
  });

  it('people outside the request cannot see it', async () => {
    const r = await co.rafi.api
      .post(
        `/employees/${co.rafi.employeeId}/bank-accounts`,
        bkash('01666666666'),
      )
      .expect(201);
    await co.financeOfficer.api
      .get(`/approvals/requests/${r.body.approvalRequestId}`)
      .expect(404);
    await co.md.api
      .get(`/approvals/requests/${r.body.approvalRequestId}`)
      .expect(200); // Admin: approvals.view_all
    await co.rafi.api
      .post(`/approvals/requests/${r.body.approvalRequestId}/cancel`, {})
      .expect(200);
  });

  describe('two-step chain: line manager, then HR', () => {
    let chainId: string;

    beforeAll(async () => {
      const chain = await co.owner
        .post('/approvals/chains', {
          requestType: 'bank_account_change',
          name: 'Line manager then HR',
          priority: 10,
          steps: [
            { approverRule: 'line_manager' },
            { approverRule: 'role:hr' },
          ],
        })
        .expect(201);
      chainId = chain.body.id;
    });

    afterAll(async () => {
      const chains = (await co.owner.get('/approvals/chains').expect(200)).body
        .configured;
      const chain = chains.find((c: { id: string }) => c.id === chainId);
      await co.owner
        .patch(`/approvals/chains/${chainId}`, {
          isActive: false,
          version: chain.version,
        })
        .expect(200);
    });

    it('goes to Tanvir first; HR cannot jump the queue; then HR', async () => {
      const r = await co.rafi.api
        .post(
          `/employees/${co.rafi.employeeId}/bank-accounts`,
          bkash('01777777777'),
        )
        .expect(201);
      const id = r.body.approvalRequestId;

      expect(
        (await co.hr.api.post(`/approvals/requests/${id}/approve`, {})).body
          .code,
      ).toBe('APPROVAL_NOT_YOUR_TURN');
      const step1 = await co.salesHead.api
        .post(`/approvals/requests/${id}/approve`, {
          comment: 'Confirmed with Rafi',
        })
        .expect(200);
      expect(step1.body).toMatchObject({
        state: 'in_approval',
        currentStep: 2,
      });

      const step2 = await co.hr.api
        .post(`/approvals/requests/${id}/approve`, {})
        .expect(200);
      expect(step2.body.state).toBe('executed');
      expect(
        step2.body.history.map((h: { action: string }) => h.action),
      ).toEqual(['submit', 'approve', 'approve', 'execute']);
    });

    it('a delegate approves on behalf of the line manager; both names are recorded', async () => {
      const today = todayInDhaka(); // business dates are Dhaka dates, not UTC
      // the Sales head cannot list users, but can pick whom to hand over to (no e-mails shown)
      await co.salesHead.api.get('/users').expect(403);
      const candidates = (
        await co.salesHead.api.get('/delegations/candidates').expect(200)
      ).body as Array<{ userId: string; name: string }>;
      expect(candidates.map((c) => c.userId)).toContain(co.md.userId);
      expect(candidates.map((c) => c.userId)).not.toContain(
        co.salesHead.userId,
      );
      expect(candidates.map((c) => c.userId)).not.toContain(co.rafi.userId); // an Employee approves nothing
      await co.salesHead.api
        .post('/delegations', {
          toUserId: co.md.userId,
          startsOn: today,
          endsOn: today,
          reason: 'Tanvir on leave (Durga Puja)',
        })
        .expect(201);

      const r = await co.rafi.api
        .post(
          `/employees/${co.rafi.employeeId}/bank-accounts`,
          bkash('01888888888'),
        )
        .expect(201);
      const id = r.body.approvalRequestId;
      const inbox = (await co.md.api.get('/approvals/inbox').expect(200)).body;
      expect(
        inbox.find((i: { requestId: string }) => i.requestId === id),
      ).toMatchObject({ onBehalfOf: co.salesHead.userId });

      const res = await co.md.api
        .post(`/approvals/requests/${id}/approve`, {
          comment: 'On behalf of Tanvir',
        })
        .expect(200);
      const approve = res.body.history.find(
        (h: { action: string }) => h.action === 'approve',
      );
      expect(approve).toMatchObject({
        actorUserId: co.md.userId,
        onBehalfOfUserId: co.salesHead.userId,
      });

      // finish: HR approves step 2
      await co.hr.api.post(`/approvals/requests/${id}/approve`, {}).expect(200);
    });
  });

  it('acceptance: nobody approves their own request, even when the chain names them', async () => {
    // a chain that names Farzana (HR) as the only approver
    const chain = (
      await co.owner
        .post('/approvals/chains', {
          requestType: 'bank_account_change',
          name: 'Farzana only',
          priority: 1,
          steps: [{ approverRule: `user:${co.hr.userId}` }],
        })
        .expect(201)
    ).body;

    // Farzana requests her OWN salary account change
    const r = await co.hr.api
      .post(`/employees/${co.hr.employeeId}/bank-accounts`, {
        ...bkash('01322222222'),
        accountName: 'Farzana Akter',
      })
      .expect(201);
    const id = r.body.approvalRequestId;

    // she is not assigned, and cannot act even if she tries
    const self = await co.hr.api.post(`/approvals/requests/${id}/approve`, {});
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('APPROVAL_SELF_APPROVAL');

    // the engine fell back to the Admins (Anwar Hossain and the workspace owner), never Farzana
    const detail = (
      await co.md.api.get(`/approvals/requests/${id}`).expect(200)
    ).body;
    expect(
      detail.approvers.every(
        (a: { assignedBecause: string }) =>
          a.assignedBecause === 'fallback_admin',
      ),
    ).toBe(true);
    expect(detail.approvers.map((a: { userId: string }) => a.userId)).toContain(
      co.md.userId,
    );
    expect(
      detail.approvers.map((a: { userId: string }) => a.userId),
    ).not.toContain(co.hr.userId);
    await co.md.api.post(`/approvals/requests/${id}/approve`, {}).expect(200);

    await co.owner
      .patch(`/approvals/chains/${chain.id}`, {
        isActive: false,
        version: chain.version,
      })
      .expect(200);
  });

  // ------------------------------------------------- readable, and findable (ADR 0034)

  it('a request names its people, so the screen need not print user ids', async () => {
    const r = await co.rafi.api
      .post(
        `/employees/${co.rafi.employeeId}/bank-accounts`,
        bkash('01911111111'),
      )
      .expect(201);
    const id = r.body.approvalRequestId;

    const detail = (
      await co.hr.api.get(`/approvals/requests/${id}`).expect(200)
    ).body;
    expect(detail.requesterName).toBe('Mahmudul Hasan Rafi');
    expect(detail.approvers[0].name).toBeTruthy();
    expect(detail.chainName).toBeTruthy();
    expect(detail.steps.length).toBeGreaterThan(0);
    expect(detail.history[0]).toMatchObject({
      action: 'submit',
      actorName: 'Mahmudul Hasan Rafi',
    });

    await co.hr.api.post(`/approvals/requests/${id}/approve`, {}).expect(200);
    const decided = (
      await co.hr.api.get(`/approvals/requests/${id}`).expect(200)
    ).body;
    expect(
      decided.history.find((h: { action: string }) => h.action === 'approve')
        .actorName,
    ).toBe('Farzana Akter');
    // the system carried it out, so that entry has nobody's name on it
    expect(decided.history.at(-1)).toMatchObject({
      action: 'execute',
      actorName: null,
    });
  });

  it('the Admin can list every request of the company and find what is stuck; HR cannot', async () => {
    const all = (
      await co.md.api
        .get(`/approvals/requests?companyId=${co.companyId}`)
        .expect(200)
    ).body;
    expect(all.length).toBeGreaterThan(1);
    expect(all[0]).toMatchObject({ requesterName: expect.any(String) });
    expect(new Date(all[0].submittedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(all.at(-1).submittedAt).getTime(),
    );

    const kinds = new Set(
      all.map((r: { requestType: string }) => r.requestType),
    );
    expect(kinds).toContain('bank_account_change');

    // narrowing: by kind, and to the ones still waiting
    const filtered = (
      await co.md.api
        .get(
          `/approvals/requests?companyId=${co.companyId}&requestType=bank_account_change&open=true`,
        )
        .expect(200)
    ).body;
    expect(
      filtered.every((r: { state: string }) => r.state === 'in_approval'),
    ).toBe(true);
    expect(
      (
        await co.md.api
          .get(
            `/approvals/requests?companyId=${co.companyId}&requestType=leave_request`,
          )
          .expect(200)
      ).body,
    ).toEqual([]);

    // nothing is overdue on a fresh company
    expect(
      (
        await co.md.api
          .get(`/approvals/requests?companyId=${co.companyId}&overdue=true`)
          .expect(200)
      ).body,
    ).toEqual([]);

    // HR runs the people work but does not oversee everyone's approvals
    await co.hr.api
      .get(`/approvals/requests?companyId=${co.companyId}`)
      .expect(403);
    await co.rafi.api
      .get(`/approvals/requests?companyId=${co.companyId}`)
      .expect(403);
  });
});

describe('acceptance: SLA escalation fires on working hours', () => {
  // Thursday 15 Oct 2026, 15:00 in Dhaka; Dhaka HQ weekend is Friday + Saturday
  const clock = new ManualClock(dhaka('2026-10-15T15:00:00'));
  let app: INestApplication;
  let co: BdCompany;
  let sla: ApprovalSlaService;

  beforeAll(async () => {
    app = await startApp({ clock });
    sla = app.get(ApprovalSlaService);
    co = await createBdCompany(app, db);
    await co.owner
      .post('/approvals/chains', {
        requestType: 'bank_account_change',
        name: 'Line manager (SLA test)',
        steps: [{ approverRule: 'line_manager' }],
      })
      .expect(201);
  }, 120_000);

  afterAll(() => app.close());

  it('reminds after 24 and escalates after 48 working hours, skipping the weekend', async () => {
    const r = await co.rafi.api
      .post(
        `/employees/${co.rafi.employeeId}/bank-accounts`,
        bkash('01400000000'),
      )
      .expect(201);
    const id = r.body.approvalRequestId;
    const approvers = async () =>
      (await co.md.api.get(`/approvals/requests/${id}`).expect(200)).body
        .approvers;

    // assigned to Tanvir, with deadlines in working hours
    const [first] = await approvers();
    expect(first).toMatchObject({
      userId: co.salesHead.userId,
      assignedBecause: 'line_manager',
    });
    expect(new Date(first.reminderAt)).toEqual(dhaka('2026-10-18T15:00:00')); // Sunday, not Friday
    expect(new Date(first.escalationAt)).toEqual(dhaka('2026-10-19T15:00:00')); // Monday

    // Saturday afternoon: 48 calendar hours have passed, but no working hours on Fri/Sat
    expect(
      await sla.processDue(dhaka('2026-10-17T16:00:00'), co.tenant.id),
    ).toMatchObject({ reminded: 0, escalated: 0 });

    // Sunday 15:01: reminder only
    expect(
      await sla.processDue(dhaka('2026-10-18T15:01:00'), co.tenant.id),
    ).toMatchObject({ reminded: 1, escalated: 0 });

    // Monday 15:01: escalation to Tanvir's line manager, Anwar Hossain (MD)
    expect(
      await sla.processDue(dhaka('2026-10-19T15:01:00'), co.tenant.id),
    ).toMatchObject({ escalated: 1 });
    const after = await approvers();
    expect(after).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: co.md.userId,
          assignedBecause: 'escalation',
          status: 'pending',
        }),
      ]),
    );
    expect(
      (await eventsOfType(co.tenant.id, 'approval.sla_breached')).length,
    ).toBe(1);

    // running again does not escalate twice
    expect(
      await sla.processDue(dhaka('2026-10-19T16:00:00'), co.tenant.id),
    ).toMatchObject({ escalated: 0 });

    // the MD can now approve in Tanvir's place; Tanvir's assignment is superseded
    clock.set(dhaka('2026-10-19T16:30:00'));
    await co.md.api
      .post(`/approvals/requests/${id}/approve`, { comment: 'Escalated to me' })
      .expect(200);
    const final = (await co.md.api.get(`/approvals/requests/${id}`).expect(200))
      .body;
    expect(final.state).toBe('executed');
    expect(
      final.approvers.find(
        (a: { userId: string }) => a.userId === co.salesHead.userId,
      ).status,
    ).toBe('superseded');
  });
});

afterAll(() => db.close());
