/**
 * Phase 2 WP15, vendors, bills and tax at source (Meghna Foods, fiscal year 2026-27).
 * Acceptance: withholding amounts match the rule pack cases (unit: withholding.spec.ts;
 * here the same rates end to end); a certificate per vendor per period; the payables
 * control account equals the sub-ledger (nightly check).
 *
 * Sujit is the Accounts maker; Sumaiya becomes a second Accounts user (checker).
 */
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { ManualClock } from '../../src/platform/clock.js';
import { apiFor, startApp, type Api } from './api-client.js';
import { createBdCompany, PASSWORD, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-10-15T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let c: string;
let checker: Api; // Sumaiya, second Accounts user
const acct: Record<string, string> = {}; // account code -> id
const vendor: Record<string, string> = {}; // short name -> id
const bill: Record<string, { id: string; voucherId: string }> = {};

const tenantSql = (q: ReturnType<typeof sql>) =>
  db.withTenant({ tenantId: co.tenant.id, access: AccessGrants.system() }, () =>
    q.execute(db.tx),
  );
const approve = (requestId: string, who: Api = checker) =>
  who.post(`/approvals/requests/${requestId}/approve`, {}).expect(200);
const line = (
  code: string,
  amount: string,
  vatPercent: string,
  description: string,
  departmentId?: string,
) => ({
  accountId: acct[code],
  amount,
  vatPercent,
  description,
  ...(departmentId ? { departmentId } : {}),
});
/** Maker enters and submits, checker approves: the bill is posted. */
async function approvedBill(body: object) {
  const draft = (
    await co.accounts.api.post(`${c}/vendor-bills`, body).expect(201)
  ).body;
  const submitted = (
    await co.accounts.api.post(`/vendor-bills/${draft.id}/submit`).expect(200)
  ).body;
  await approve(submitted.approvalRequestId);
  return (await co.accounts.api.get(`/vendor-bills/${draft.id}`).expect(200))
    .body;
}
const voucherOf = async (id: string) =>
  (await co.accounts.api.get(`/vouchers/${id}`).expect(200)).body;

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);
  c = `/companies/${co.companyId}`;

  // second Accounts user; rule pack with the tax-at-source rates; the books
  await co.owner
    .post(`/users/${co.financeOfficer.userId}/roles`, {
      role: 'accounts',
      scopeType: 'company',
      scopeId: co.companyId,
    })
    .expect(201);
  checker = await apiFor(app, {
    slug: co.tenant.slug,
    email: co.financeOfficer.email,
    password: PASSWORD,
  });
  const packs = (await co.owner.get('/rule-packs').expect(200)).body.packs;
  const pack = packs.find(
    (p: { code: string; version: string }) =>
      p.code === 'BD-LABOUR' && p.version === '2026.3',
  );
  await co.owner
    .post(`/rule-packs/${pack.id}/accept`, { effectiveFrom: '2025-01-01' })
    .expect(201);
  await co.accounts.api
    .post(`${c}/ledger/setup`, { asOf: '2026-10-15' })
    .expect(200);
  for (const a of (await co.accounts.api.get(`${c}/accounts`).expect(200)).body)
    acct[a.code] = a.id;
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('vendors and settings', () => {
  it('payment categories and rates come from the accepted rule pack', async () => {
    const cats = (
      await co.accounts.api
        .get(`${c}/withholding-categories?date=2026-10-15`)
        .expect(200)
    ).body;
    expect(cats.pack).toBe('BD-LABOUR 2026.3');
    expect(cats.categories.map((x: { code: string }) => x.code)).toEqual(
      expect.arrayContaining([
        'SUPPLY',
        'SERVICE',
        'RENT',
        'PROFESSIONAL',
        'EXEMPT',
      ]),
    );
    expect(cats.noTinSurchargePercent).toBe('50');
  });

  it('Accounts keeps vendors; codes are given in order; the same TIN twice is refused', async () => {
    await co.hr.api
      .post(`${c}/vendors`, { name: 'Should not work' })
      .expect(403);
    const add = async (key: string, body: object) =>
      (vendor[key] = (
        await co.accounts.api.post(`${c}/vendors`, body).expect(201)
      ).body.id);
    await add('clean', {
      name: 'Clean & Care Services Ltd',
      nameBn: 'ক্লিন অ্যান্ড কেয়ার সার্ভিসেস লিমিটেড',
      tin: '123456789012',
      bin: '000123456-0101',
      phone: '01711223344',
      withholdingCategory: 'SERVICE',
    });
    await add('rahman', {
      name: 'Rahman Properties',
      vendorType: 'individual',
      tin: '234567890123',
      bin: '000234567-0101',
      withholdingCategory: 'RENT',
      paymentTermsDays: 0,
    });
    await add('karim', {
      name: 'Karim Traders, Nawabpur Road',
      tin: '345678901234',
      bin: '000345678-0103',
      withholdingCategory: 'SUPPLY',
      paymentTermsDays: 45,
    });
    await add('shafiq', {
      name: 'Shafiqul Islam (IT consultant)',
      vendorType: 'individual',
      withholdingCategory: 'PROFESSIONAL',
    });
    expect(
      (await co.accounts.api.get(`/vendors/${vendor.clean}`).expect(200)).body
        .code,
    ).toBe('V-0001');
    expect(
      (await co.accounts.api.get(`/vendors/${vendor.shafiq}`).expect(200)).body
        .code,
    ).toBe('V-0004');

    expect(
      (
        await co.accounts.api
          .post(`${c}/vendors`, {
            name: 'Clean and Care (again)',
            tin: '123456789012',
          })
          .expect(409)
      ).body.code,
    ).toBe('VENDOR_DUPLICATE');
    expect(
      (
        await co.accounts.api
          .post(`${c}/vendors`, {
            name: 'Odd category',
            withholdingCategory: 'LOTTERY',
          })
          .expect(400)
      ).body.code,
    ).toBe('WITHHOLDING_CATEGORY_UNKNOWN');
    const found = (await co.md.api.get(`${c}/vendors?search=karim`).expect(200))
      .body;
    expect(found.map((v: { id: string }) => v.id)).toEqual([vendor.karim]);
  });

  it('the company becomes a VAT withholding entity (Accounts, not HR)', async () => {
    await co.hr.api
      .put(`${c}/payables-settings`, { vatWithholdingEntity: true })
      .expect(403);
    expect(
      (
        await co.accounts.api
          .put(`${c}/payables-settings`, { vatWithholdingEntity: true })
          .expect(200)
      ).body,
    ).toMatchObject({
      vatWithholdingEntity: true,
      defaultPaymentTermsDays: 30,
    });
  });
});

describe('bills', () => {
  it('a bill works out VAT and tax at source; the same invoice number twice is refused', async () => {
    const draft = (
      await co.accounts.api
        .post(`${c}/vendor-bills`, {
          vendorId: vendor.clean,
          billNo: 'CCS/2026/1043',
          billDate: '2026-10-05',
          narration: 'Office cleaning, October 2026 (6 staff)',
          lines: [
            line(
              '5275',
              '120000',
              '15',
              'Cleaning, Gulshan head office',
              co.departments.ho,
            ),
          ],
        })
        .expect(201)
    ).body;
    // SERVICE 7.5 %; VAT withheld in full (withholding entity)
    expect(draft).toMatchObject({
      state: 'draft',
      baseAmount: '120000.00',
      vatAmount: '18000.00',
      tdsPercent: '7.5000',
      tdsAmount: '9000.00',
      vdsAmount: '18000.00',
      netPayable: '111000.00',
      dueDate: '2026-11-04',
      rulePack: 'BD-LABOUR 2026.3',
    });
    expect(
      (
        await co.accounts.api
          .post(`${c}/vendor-bills`, {
            vendorId: vendor.clean,
            billNo: 'ccs/2026/1043',
            billDate: '2026-10-06',
            narration: 'Same invoice',
            lines: [line('5275', '1', '0', 'x')],
          })
          .expect(409)
      ).body.code,
    ).toBe('BILL_DUPLICATE');
    // cash, bank and the payables account are not expense lines
    await co.accounts.api
      .post(`${c}/vendor-bills`, {
        vendorId: vendor.clean,
        billNo: 'X-1',
        billDate: '2026-10-06',
        narration: 'Wrong',
        lines: [line('1130', '100', '0', 'x')],
      })
      .expect(400);

    const submitted = (
      await co.accounts.api.post(`/vendor-bills/${draft.id}/submit`).expect(200)
    ).body;
    await co.accounts.api
      .patch(`/vendor-bills/${draft.id}`, {
        version: submitted.version,
        narration: 'changed',
      })
      .expect(409);
    // maker-checker
    await co.accounts.api
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
      .expect(403);
    await approve(submitted.approvalRequestId);
    const approved = (
      await co.accounts.api.get(`/vendor-bills/${draft.id}`).expect(200)
    ).body;
    expect(approved).toMatchObject({
      state: 'approved',
      paymentStatus: 'unpaid',
      outstanding: '111000.00',
    });
    expect(
      approved.withholdings
        .map(
          (w: { taxType: string; amount: string }) =>
            `${w.taxType} ${w.amount}`,
        )
        .sort(),
    ).toEqual(['tds 9000.00', 'vds 18000.00']);
    bill.clean = { id: draft.id, voucherId: approved.voucherId };

    // the journal: expense, input VAT; tax at source and the vendor's payable
    const v = await voucherOf(approved.voucherId);
    expect(v).toMatchObject({
      voucherType: 'journal',
      state: 'posted',
      sourceType: 'vendor_bill',
      voucherDate: '2026-10-05',
    });
    const by = (code: string) =>
      v.lines.find((l: { accountCode: string }) => l.accountCode === code);
    expect(by('5275')).toMatchObject({
      debit: '120000.00',
      departmentId: co.departments.ho,
    });
    expect(by('1180')).toMatchObject({ debit: '18000.00' });
    expect(by('2140')).toMatchObject({ credit: '9000.00' });
    expect(by('2150')).toMatchObject({ credit: '18000.00' });
    expect(by('2110')).toMatchObject({
      credit: '111000.00',
      partyType: 'vendor',
      partyId: vendor.clean,
    });
  });

  it('a vendor without TIN pays the surcharge; without BIN the VAT is part of the cost', async () => {
    const b = await approvedBill({
      vendorId: vendor.shafiq,
      billNo: 'SI-07',
      billDate: '2026-10-08',
      narration: 'Payroll server setup',
      lines: [line('5295', '80000', '15', 'Server setup and training')],
    });
    expect(b).toMatchObject({
      tdsPercent: '15.0000',
      tdsAmount: '12000.00',
      vdsAmount: '12000.00',
      inputVat: '0.00',
      vatInCost: '12000.00',
      netPayable: '68000.00',
    });
    const v = await voucherOf(b.voucherId);
    expect(
      v.lines.find((l: { accountCode: string }) => l.accountCode === '5295')
        .debit,
    ).toBe('92000.00');
    expect(
      v.lines.some((l: { accountCode: string }) => l.accountCode === '1180'),
    ).toBe(false);
    bill.shafiq = { id: b.id, voucherId: b.voucherId };
  });

  it('rent and a supply bill (slab rate)', async () => {
    const rent = await approvedBill({
      vendorId: vendor.rahman,
      billNo: 'RP-2026-10',
      billDate: '2026-10-01',
      narration: 'Head office rent, October 2026',
      lines: [
        line('5210', '85000', '15', 'Gulshan-2, 4th floor', co.departments.ho),
      ],
    });
    expect(rent).toMatchObject({
      tdsAmount: '4250.00',
      vdsAmount: '12750.00',
      netPayable: '80750.00',
      dueDate: '2026-10-01',
    });
    const supply = await approvedBill({
      vendorId: vendor.karim,
      billNo: 'KT-5512',
      billDate: '2026-10-10',
      narration: 'Stationery for the year',
      lines: [line('5240', '350000', '7.5', 'Paper, files, toner')],
    });
    expect(supply).toMatchObject({
      tdsPercent: '1.0000',
      tdsAmount: '3500.00',
      vdsAmount: '26250.00',
      netPayable: '346500.00',
      dueDate: '2026-11-24',
    });
    bill.rent = { id: rent.id, voucherId: rent.voucherId };
    bill.karim = { id: supply.id, voucherId: supply.voucherId };
  });

  it('Tk 10 lakh or more also needs the Admin', async () => {
    const draft = (
      await co.accounts.api
        .post(`${c}/vendor-bills`, {
          vendorId: vendor.karim,
          billNo: 'KT-5530',
          billDate: '2026-10-12',
          narration: 'Packaging machine',
          lines: [line('5270', '1200000', '0', 'Sealing machine')],
        })
        .expect(201)
    ).body;
    const submitted = (
      await co.accounts.api.post(`/vendor-bills/${draft.id}/submit`).expect(200)
    ).body;
    await approve(submitted.approvalRequestId);
    expect(
      (await co.accounts.api.get(`/vendor-bills/${draft.id}`).expect(200)).body
        .state,
    ).toBe('in_approval');
    // rejected by the Admin: cancelled; the invoice number may be entered again
    await co.md.api
      .post(`/approvals/requests/${submitted.approvalRequestId}/reject`, {
        comment: 'Buy it next year',
      })
      .expect(200);
    expect(
      (await co.accounts.api.get(`/vendor-bills/${draft.id}`).expect(200)).body
        .state,
    ).toBe('cancelled');
    await co.accounts.api
      .post(`${c}/vendor-bills`, {
        vendorId: vendor.karim,
        billNo: 'KT-5530',
        billDate: '2026-10-12',
        narration: 'Packaging machine',
        lines: [line('5270', '1200000', '0', 'Sealing machine')],
      })
      .expect(201);
  });

  it('the payables account takes no manual entries; an approved bill never changes', async () => {
    const res = await co.accounts.api
      .post(`${c}/vouchers`, {
        voucherType: 'journal',
        voucherDate: '2026-10-10',
        narration: 'Adjust a vendor',
        lines: [
          { accountId: acct['2110'], debit: '1000' },
          { accountId: acct['2190'], credit: '1000' },
        ],
      })
      .expect(400);
    expect(res.body.code).toBe('CONTROL_ACCOUNT_MANUAL');
    await expect(
      tenantSql(
        sql`UPDATE vendor_bills SET net_payable = 1, base_amount = 1, vat_amount = 0, tds_amount = 0, vds_amount = 0 WHERE id = ${bill.clean.id}`,
      ),
    ).rejects.toThrow(/cannot change/);
    await expect(
      tenantSql(
        sql`UPDATE vendor_bills SET paid_amount = net_payable + 1 WHERE id = ${bill.clean.id}`,
      ),
    ).rejects.toThrow(/check/i);
  });
});

describe('payments', () => {
  let firstPaymentVoucher: string;

  it('a bank transfer needs an approved vendor bank account (maker-checker)', async () => {
    const pay = {
      vendorId: vendor.clean,
      paymentDate: '2026-10-20',
      method: 'bank_transfer',
      reference: 'BEFTN 20261020-118',
      paidFromAccountId: acct['1130'],
      allocations: [{ billId: bill.clean.id, amount: '60000' }],
    };
    expect(
      (await co.accounts.api.post(`${c}/vendor-payments`, pay).expect(400)).body
        .code,
    ).toBe('VENDOR_BANK_NOT_APPROVED');
    const requested = (
      await co.accounts.api
        .post(`/vendors/${vendor.clean}/bank-accounts`, {
          bankName: 'BRAC Bank PLC',
          branchName: 'Gulshan',
          routingNumber: '060261726',
          accountName: 'Clean & Care Services Ltd',
          accountNumber: '1501203456789001',
        })
        .expect(201)
    ).body;
    expect(requested.status).toBe('pending');
    await co.accounts.api
      .post(`/approvals/requests/${requested.approvalRequestId}/approve`, {})
      .expect(403);
    await approve(requested.approvalRequestId);
    expect(
      (await co.accounts.api.get(`/vendors/${vendor.clean}`).expect(200)).body
        .bankAccounts[0],
    ).toMatchObject({ status: 'approved', account: '**** 9001' });

    // part payment: reserved while it waits; never more than is owed
    const p = (
      await co.accounts.api.post(`${c}/vendor-payments`, pay).expect(201)
    ).body;
    expect(p).toMatchObject({ state: 'in_approval', amount: '60000.00' });
    const over = (
      await co.accounts.api
        .post(`${c}/vendor-payments`, {
          ...pay,
          allocations: [{ billId: bill.clean.id, amount: '51001' }],
        })
        .expect(400)
    ).body;
    expect(over).toMatchObject({
      code: 'PAYMENT_EXCEEDS_OUTSTANDING',
      details: { available: '51000.00' },
    });
    await co.accounts.api
      .post(`${c}/vendor-payments`, { ...pay, paidFromAccountId: acct['5210'] })
      .expect(400);

    await approve(p.approvalRequestId);
    expect(
      (await co.accounts.api.get(`/vendor-payments/${p.id}`).expect(200)).body
        .state,
    ).toBe('paid');
    expect(
      (await co.accounts.api.get(`/vendor-bills/${bill.clean.id}`).expect(200))
        .body,
    ).toMatchObject({
      paymentStatus: 'partly_paid',
      paidAmount: '60000.00',
      outstanding: '51000.00',
    });
    firstPaymentVoucher = p.voucherId;
  });

  it('a paid bill cannot be voided; a reversed payment opens the bill again', async () => {
    const cheque = (
      await co.accounts.api
        .post(`${c}/vendor-payments`, {
          vendorId: vendor.clean,
          paymentDate: '2026-10-25',
          method: 'cheque',
          reference: 'CHQ 0045512',
          paidFromAccountId: acct['1130'],
          allocations: [{ billId: bill.clean.id, amount: '51000' }],
        })
        .expect(201)
    ).body;
    await approve(cheque.approvalRequestId);
    expect(
      (await co.accounts.api.get(`/vendor-bills/${bill.clean.id}`).expect(200))
        .body.paymentStatus,
    ).toBe('paid');
    expect(
      (
        await co.accounts.api
          .post(`/vouchers/${bill.clean.voucherId}/reverse`, {
            reason: 'Wrong vendor',
          })
          .expect(409)
      ).body.code,
    ).toBe('BILL_HAS_PAYMENTS');

    const reversal = (
      await co.accounts.api
        .post(`/vouchers/${cheque.voucherId}/reverse`, {
          reason: 'Cheque bounced: account name mismatch',
        })
        .expect(201)
    ).body;
    await approve(reversal.approvalRequestId);
    expect(
      (await co.accounts.api.get(`/vendor-payments/${cheque.id}`).expect(200))
        .body.state,
    ).toBe('reversed');
    expect(
      (await co.accounts.api.get(`/vendor-bills/${bill.clean.id}`).expect(200))
        .body,
    ).toMatchObject({ paymentStatus: 'partly_paid', outstanding: '51000.00' });

    // paid again by transfer; a rejected payment releases its reservation
    const again = (
      await co.accounts.api
        .post(`${c}/vendor-payments`, {
          vendorId: vendor.clean,
          paymentDate: '2026-10-28',
          method: 'bank_transfer',
          reference: 'BEFTN 20261028-033',
          paidFromAccountId: acct['1130'],
          allocations: [{ billId: bill.clean.id, amount: '51000' }],
        })
        .expect(201)
    ).body;
    await checker
      .post(`/approvals/requests/${again.approvalRequestId}/reject`, {
        comment: 'Wait for the November invoice',
      })
      .expect(200);
    expect(
      (await co.accounts.api.get(`/vendor-payments/${again.id}`).expect(200))
        .body.state,
    ).toBe('cancelled');
    const last = (
      await co.accounts.api
        .post(`${c}/vendor-payments`, {
          vendorId: vendor.clean,
          paymentDate: '2026-10-28',
          method: 'bank_transfer',
          reference: 'BEFTN 20261028-034',
          paidFromAccountId: acct['1130'],
          allocations: [{ billId: bill.clean.id, amount: '51000' }],
        })
        .expect(201)
    ).body;
    await approve(last.approvalRequestId);
    expect(
      (await co.accounts.api.get(`/vendor-bills/${bill.clean.id}`).expect(200))
        .body.paymentStatus,
    ).toBe('paid');
    expect(firstPaymentVoucher).toBeTruthy();
  });

  it('an unpaid bill is voided by reversing its posting; its tax at source goes with it', async () => {
    const reversal = (
      await co.accounts.api
        .post(`/vouchers/${bill.shafiq.voucherId}/reverse`, {
          reason: 'Consultant re-issued the invoice with his TIN',
        })
        .expect(201)
    ).body;
    await approve(reversal.approvalRequestId);
    const voided = (
      await co.accounts.api.get(`/vendor-bills/${bill.shafiq.id}`).expect(200)
    ).body;
    expect(voided.state).toBe('cancelled');
    expect(
      voided.withholdings.every((w: { state: string }) => w.state === 'void'),
    ).toBe(true);
  });

  it('the vendor statement: bill, payments, reversal; balance back to zero', async () => {
    const st = (
      await co.accounts.api
        .get(`/vendors/${vendor.clean}/statement?to=2026-10-31`)
        .expect(200)
    ).body;
    expect(st.opening).toBe('0.00');
    expect(st.lines[0]).toMatchObject({
      source: 'vendor_bill',
      credit: '111000.00',
      balance: '111000.00',
    });
    expect(st.closing).toBe('0.00');
  });
});

describe('tax at source: challans and certificates', () => {
  it('a month of income tax withheld is deposited by one challan (maker-checker)', async () => {
    clock.set(new Date('2026-11-10T11:00:00+06:00'));
    const open = (
      await co.accounts.api
        .get(`${c}/tax-withholdings?taxType=tds&period=2026-10&deposited=false`)
        .expect(200)
    ).body;
    // cleaning 9000 + rent 4250 + stationery 3500 (the consultant's bill is void)
    expect(open.total).toBe('16750.00');

    await co.hr.api
      .post(`${c}/tax-challans`, {
        taxType: 'tds',
        period: '2026-10',
        challanNo: 'TR-2026-11-55871',
        challanDate: '2026-11-10',
        paidFromAccountId: acct['1130'],
      })
      .expect(403);
    const challan = (
      await co.accounts.api
        .post(`${c}/tax-challans`, {
          taxType: 'tds',
          period: '2026-10',
          challanNo: 'TR-2026-11-55871',
          challanDate: '2026-11-10',
          paidFromAccountId: acct['1130'],
        })
        .expect(201)
    ).body;
    expect(challan).toMatchObject({ state: 'in_approval', amount: '16750.00' });
    expect(challan.withholdings).toHaveLength(3);
    expect(
      (
        await co.accounts.api
          .post(`${c}/tax-challans`, {
            taxType: 'tds',
            period: '2026-10',
            challanNo: 'TR-2',
            challanDate: '2026-11-10',
            paidFromAccountId: acct['1130'],
          })
          .expect(400)
      ).body.code,
    ).toBe('NOTHING_TO_DEPOSIT');
    await approve(challan.approvalRequestId);
    expect(
      (await co.accounts.api.get(`/tax-challans/${challan.id}`).expect(200))
        .body.state,
    ).toBe('deposited');

    // the TDS payable account is cleared
    const gl = (
      await co.accounts.api
        .get(`/accounts/${acct['2140']}/ledger?to=2026-11-30`)
        .expect(200)
    ).body;
    expect(gl.closing).toBe('0.00');
  });

  it('a rejected VAT challan releases the withholdings for a new one', async () => {
    const body = {
      taxType: 'vds',
      period: '2026-10',
      challanNo: 'VDS-2026-10-0091',
      challanDate: '2026-11-10',
      paidFromAccountId: acct['1130'],
    };
    const first = (
      await co.accounts.api.post(`${c}/tax-challans`, body).expect(201)
    ).body;
    expect(first.amount).toBe('57000.00'); // 18000 + 12750 + 26250
    await checker
      .post(`/approvals/requests/${first.approvalRequestId}/reject`, {
        comment: 'Wrong challan number',
      })
      .expect(200);
    expect(
      (await co.accounts.api.get(`/tax-challans/${first.id}`).expect(200)).body
        .state,
    ).toBe('cancelled');
    const second = (
      await co.accounts.api
        .post(`${c}/tax-challans`, { ...body, challanNo: 'VDS-2026-10-0092' })
        .expect(201)
    ).body;
    expect(second.amount).toBe('57000.00');
    await approve(second.approvalRequestId);
  });

  it('a certificate per vendor per period, numbered; each withholding is certified once', async () => {
    const cert = (
      await co.accounts.api
        .post(`/vendors/${vendor.clean}/tax-certificates`, {
          taxType: 'tds',
          from: '2026-07-01',
          to: '2026-12-31',
        })
        .expect(201)
    ).body;
    expect(cert).toMatchObject({
      number: 'TDSC/2026-27/00001',
      amount: '9000.00',
      vendor: { tin: '123456789012' },
    });
    expect(cert.lines).toEqual([
      expect.objectContaining({
        billNo: 'CCS/2026/1043',
        base: '120000.00',
        amount: '9000.00',
        challanNo: 'TR-2026-11-55871',
      }),
    ]);
    expect(
      (
        await co.accounts.api
          .post(`/vendors/${vendor.clean}/tax-certificates`, {
            taxType: 'tds',
            from: '2026-07-01',
            to: '2026-12-31',
          })
          .expect(400)
      ).body.code,
    ).toBe('NOTHING_TO_CERTIFY');
    const karim = (
      await co.accounts.api
        .post(`/vendors/${vendor.karim}/tax-certificates`, {
          taxType: 'tds',
          from: '2026-10-01',
          to: '2026-10-31',
        })
        .expect(201)
    ).body;
    expect(karim).toMatchObject({
      number: 'TDSC/2026-27/00002',
      amount: '3500.00',
    });
    const vds = (
      await co.accounts.api
        .post(`/vendors/${vendor.karim}/tax-certificates`, {
          taxType: 'vds',
          from: '2026-10-01',
          to: '2026-10-31',
        })
        .expect(201)
    ).body;
    expect(vds).toMatchObject({
      number: 'VDSC/2026-27/00001',
      amount: '26250.00',
    });

    // a challan with certified tax stays; the database agrees
    const challans = (
      await co.accounts.api.get(`${c}/tax-challans`).expect(200)
    ).body;
    const tds = challans.find(
      (x: { taxType: string; state: string }) =>
        x.taxType === 'tds' && x.state === 'deposited',
    );
    expect(
      (
        await co.accounts.api
          .post(`/vouchers/${tds.voucherId}/reverse`, { reason: 'test' })
          .expect(409)
      ).body.code,
    ).toBe('CHALLAN_CERTIFIED');
    await expect(
      tenantSql(
        sql`UPDATE tax_withholdings SET challan_id = NULL WHERE certificate_id IS NOT NULL`,
      ),
    ).rejects.toThrow(/certified/);
  });
});

describe('reports and the nightly check', () => {
  it('aged payables by days past due', async () => {
    const aging = (
      await co.accounts.api
        .get(`${c}/payables/aging?asOf=2026-12-15`)
        .expect(200)
    ).body;
    const rahman = aging.vendors.find(
      (v: { vendorId: string }) => v.vendorId === vendor.rahman,
    );
    const karim = aging.vendors.find(
      (v: { vendorId: string }) => v.vendorId === vendor.karim,
    );
    expect(rahman).toMatchObject({ days61to90: '80750.00', total: '80750.00' }); // due 1 Oct
    expect(karim).toMatchObject({ days1to30: '346500.00' }); // due 24 Nov
    expect(
      aging.vendors.find(
        (v: { vendorId: string }) => v.vendorId === vendor.clean,
      ),
    ).toBeUndefined(); // paid
    expect(aging.totals.total).toBe('427250.00');
  });

  it('the payables account equals the open bills; a mismatch is reported', async () => {
    expect(
      (await co.accounts.api.get(`${c}/ledger/checks`).expect(200)).body,
    ).toMatchObject({ ok: true, problems: [] });
    await tenantSql(
      sql`UPDATE vendor_bills SET paid_amount = 1000 WHERE id = ${bill.karim.id}`,
    );
    const checks = (await co.accounts.api.get(`${c}/ledger/checks`).expect(200))
      .body;
    expect(checks.problems.map((p: { check: string }) => p.check)).toEqual([
      'payables_control',
      'payables_vendor_mismatch',
    ]);
    await tenantSql(
      sql`UPDATE vendor_bills SET paid_amount = 0 WHERE id = ${bill.karim.id}`,
    );
    expect(
      (await co.accounts.api.get(`${c}/ledger/checks`).expect(200)).body.ok,
    ).toBe(true);
  });

  it('auditors and the Admin read payables; HR and employees do not', async () => {
    await co.md.api.get(`${c}/vendor-bills`).expect(200);
    await co.hr.api.get(`${c}/vendor-bills`).expect(403);
    await co.rafi.api.get(`/vendors/${vendor.clean}`).expect(403);
  });
});
