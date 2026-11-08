/**
 * Development seed data:  npm run db:seed
 *
 * Creates two FAKE workspaces so you can try the API in Postman and see tenant
 * isolation (guide §21: synthetic data only, never real customer data).
 *
 * All passwords: Demo-Pass-123
 *
 *   workspace  login                       role(s)                               person
 *   demo       admin@demo.test             System Admin + Admin + HR + Accounts  - (owner; Accounts checker)
 *   demo       anisur.rahman@demo.test     Admin (company) + Employee            Managing Director
 *   demo       farzana.akter@demo.test     HR (company) + Employee               HR Manager
 *   demo       sujit.das@demo.test         Accounts (company) + Employee         Finance Manager
 *   demo       tanvir.hossain@demo.test    Dept Head (Sales) + Employee          Sales Manager
 *   demo       nusrat.jahan@demo.test      System Admin (company) + Employee     IT Officer (no salary access)
 *   demo       rafi@demo.test              Employee                              Sales Executive
 *   rival      admin@rival.test            System Admin + Admin + HR (owner)     -
 *
 * Rule pack: BD-LABOUR 2026.1 is published (all values 'verify') and accepted by
 * both workspaces from 2025-01-01.
 *
 * Attendance (demo): Bangladesh 2026 holiday calendar (lunar dates tentative), General
 * shift 09:00-18:00, Ramadan hours, biometric user numbers, Rafi's phone approved,
 * device punches for 1-13 Oct 2026, and a service key for the Dhaka HQ agent
 * (printed once when created).
 *
 * Leave (demo): Bangladesh default leave types (CL, SL, EL, ML, LWP), 2026 grants,
 * opening earned-leave balances closed at the end of 2025 (carry 40, rest encashed),
 * Mitu's approved sick leave (7-8 Oct), Nusrat's casual leave (8 Oct), and Rafi's
 * casual leave 22-25 Oct waiting for Tanvir.
 *
 * Payroll (demo): Bangladesh salary heads and the standard structure (Basic 60%),
 * salaries for everyone (Rafi's July increment), July-August tax figures from the
 * old system (YTD openings), Rafi's commission, Mitu's salary advance waiting for
 * Tanvir, September attendance locked (Mitu absent on 17 Sep) and the September
 * run calculated, waiting for HR to clear flags and submit (try it in Postman).
 *
 * Consent (demo, WP12): every employee's signed biometric consent form recorded by HR,
 * and Rafi agreed to phone location in the app.
 *
 * AI (demo, WP11): Intelligent plan, AI switched on, and the illustrative employee
 * handbook in English and Bangla (samples/policies) for the assistant to answer from.
 * Which provider answers is set by AI_PROVIDER in .env (fake / anthropic / off).
 *
 * Finance (demo, Phase 2 WP14-15): the books (Bangladesh chart, fiscal year 2026-27), the
 * company as a VAT withholding entity, four vendors, October bills for rent and cleaning
 * (approved by the owner as the second Accounts user; rent paid by cheque), a stationery
 * bill waiting in the owner's inbox, and a consultant's bill still a draft for Sujit.
 *
 * Expenses (demo, WP16): Bangladesh expense categories; Rafi's cash advance for a Chattogram
 * dealer visit (paid) and his claim against it (settled); his mobile-bill claim approved and
 * waiting for Sujit to pay; Mitu's conveyance claim waiting for Tanvir.
 *
 * Assets and stock (demo, WP19): the standard asset classes; laptops, a Walton fridge, office
 * desks and a Toyota Hiace bought in 2024 (brought in with its depreciation so far); a laptop
 * with Tanvir (received) and one handed to Rafi he has not confirmed yet; depreciation posted
 * for July-September 2026. The head office store with paper, toner and files (toner below
 * its reorder level); Rafi's request approved and issued, Mitu's waiting for Tanvir.
 *
 * Bank (demo, WP20): the Dutch-Bangla current account (ledger 1130) reconciled from
 * 1 October 2026. October receipts from dealers (two of them banked as one cash deposit;
 * Rahim Traders' Tk 5,000 not yet in the bank, Karim Stores' Tk 5,000 credited: the AI
 * tells which is which) and the Link3 internet cheque; a statement to 25 October built
 * from the books, with cheques presented a few days late, the last cheque not yet
 * presented, an SMS charge to record and interest to post. The rules matched the rest.
 *
 * VAT and compliance (demo, WP21): the standard VAT items with 2026-27 rates; October VAT
 * invoices to Meghna Dealers (trading stage, 5 %) and Sylhet Agro (15 %, VAT deducted at
 * source by the customer), one more waiting for the owner; September's return filed (nil);
 * October's return to prepare in November. The compliance calendar with the trade licence
 * renewed and the fire licence still to do.
 *
 * Gate 2 rehearsal (demo, WP22): a second company, Meghna Agro Industries Ltd, the pilot
 * moving from Tally on 1 October 2026: the opening trial balance (samples/finance) posted
 * with its unpaid bill and customer invoices, October's rent, a cash sale and Bogura
 * Traders' payment, the month closed through the checklist, and Tally's 31 October trial
 * balance compared twice: first with the rent entered wrongly in Tally, then agreeing.
 * Gate 2 passes. Sujit (Accounts) and Anisur (Admin) work in it too.
 *
 * CRM (demo, Phase 3 WP23): Rafi and Mitu are Sales users under Tanvir (the Sales head);
 * the Chattogram territory (Chattogram, Cox's Bazar, Cumilla, Feni) is Rafi's, the rest of
 * the country goes to them in turn. Leads from Facebook and the website (as n8n would send
 * them), a walk-in qualified into Karim Stores, an enquiry from a known number, a
 * disqualified student; the customers Meghna Dealers, Sylhet Agro and Bogura Traders with
 * credit terms set by Sujit; tasks for Rafi (one late).
 * Opportunities (WP24): Rafi's Eid soybean oil deal in negotiation (Tk 12.5 lakh at 80%), Karim
 * Stores at quotation, a Puja-season order won in October; Mitu's Sylhet canteen contract,
 * a North Bengal dealer lead, and palm oil tins lost on price to a local mill. Targets for
 * October and November: Rafi Tk 15 lakh, Mitu Tk 12 lakh (set by Tanvir), Sales Tk 40 lakh
 * (set by Anisur).
 * Sales (WP25-WP27): rice bran oil, soybean oil and mustard oil with 2026-27 prices (a dealer list),
 * discount limits (3% for everyone, 5% for Rafi and Mitu). Karim Stores: quotation accepted,
 * delivered, invoiced and part paid by cheque. Meghna Dealers: an Eid quotation at 8% off,
 * waiting for Tanvir (above Rafi's limit). Sylhet Agro: an order over its credit limit, waiting
 * for Accounts. Bogura Traders: an October invoice past due (collection reminders).
 *
 * Waiting in approval inboxes: a bKash change by Rafi and a DBBL account change by
 * Mitu (HR approves); Tanvir's Nagad change was approved already.
 *
 * The organization is created through the real services, so audit entries,
 * job history and checklists are exactly what the API would produce.
 * Safe to run again: anything that already exists is skipped.
 */
import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';
import { AppModule } from '../app.module.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { EmployeesService } from '../modules/employees/employees.service.js';
import { JobHistoryService } from '../modules/employees/job-history.service.js';
import {
  DEFAULT_ONBOARDING_ITEMS,
  OnboardingService,
} from '../modules/employees/onboarding.service.js';
import { ApprovalsService } from '../modules/approvals/approvals.service.js';
import { BankAccountsService } from '../modules/bank-accounts/bank-accounts.service.js';
import { AccessGrants } from '../modules/identity/access/access-grants.js';
import { hashPassword } from '../modules/identity/password.js';
import { createTenantWithOwner } from '../modules/identity/tenant-bootstrap.js';
import { AttendanceService } from '../modules/attendance/attendance.service.js';
import { PunchesService } from '../modules/attendance/punches.service.js';
import { ShiftsService } from '../modules/attendance/shifts.service.js';
import { HolidaysService } from '../modules/calendar/holidays.service.js';
import { ServiceKeysService } from '../modules/users/service-keys.service.js';
import { LeaveLedgerService } from '../modules/leave/leave-ledger.service.js';
import { LeaveRequestsService } from '../modules/leave/leave-requests.service.js';
import { LeaveTypesService } from '../modules/leave/leave-types.service.js';
import { PayrollRunsService } from '../modules/payroll/payroll-runs.service.js';
import { PayrollSetupService } from '../modules/payroll/payroll-setup.service.js';
import { PayrollStatementsService } from '../modules/payroll/payroll-statements.service.js';
import { LifecycleService } from '../modules/employees/lifecycle.service.js';
import { PurchaseOrdersService } from '../modules/procurement/purchase-orders.service.js';
import { RequisitionsService } from '../modules/procurement/requisitions.service.js';
import { BudgetsService } from '../modules/budgets/budgets.service.js';
import { AssetsService } from '../modules/assets/assets.service.js';
import { StockService } from '../modules/assets/stock.service.js';
import { BankService } from '../modules/bank/bank.service.js';
import { ComplianceService } from '../modules/vat/compliance.service.js';
import { Gate2Service } from '../modules/close/gate2.service.js';
import { CustomersService } from '../modules/crm/customers.service.js';
import { LeadsService } from '../modules/crm/leads.service.js';
import { OpportunitiesService } from '../modules/crm/opportunities.service.js';
import { SalesPipelineService } from '../modules/crm/sales-pipeline.service.js';
import { CatalogueService } from '../modules/sales/catalogue.service.js';
import { InvoicesService } from '../modules/sales/invoices.service.js';
import { OrdersService } from '../modules/sales/orders.service.js';
import { QuotationsService } from '../modules/sales/quotations.service.js';
import { ReceiptsService } from '../modules/sales/receipts.service.js';
import { TerritoriesService } from '../modules/crm/territories.service.js';
import { MonthCloseService } from '../modules/close/month-close.service.js';
import { OpeningBalancesService } from '../modules/close/opening-balances.service.js';
import { ReceivablesService } from '../modules/close/receivables.service.js';
import { VatReturnsService } from '../modules/vat/vat-returns.service.js';
import { VatService } from '../modules/vat/vat.service.js';
import { VouchersService } from '../modules/ledger/vouchers.service.js';
import { PayrollVariablesService } from '../modules/payroll/payroll-variables.service.js';
import {
  addDays,
  businessDate,
  weekdayOf,
  type BusinessDate,
} from '../platform/dates/business-date.js';
import { publishRulePack } from '../modules/rules/rule-pack-admin.js';
import { readFileSync } from 'node:fs';
import { BranchesService } from '../modules/org/branches.service.js';
import { CompaniesService } from '../modules/org/companies.service.js';
import { DepartmentsService } from '../modules/org/departments.service.js';
import { DesignationsService } from '../modules/org/designations.service.js';
import { GradesService } from '../modules/org/grades.service.js';
import { DatabaseService } from '../platform/db/database.service.js';
import { Money } from '../platform/money/money.js';
import { PolicyDocumentsService } from '../modules/ai/policies/policy-documents.service.js';
import { LedgerPostingService } from '../modules/ledger/ledger-posting.service.js';
import { LedgerSetupService } from '../modules/ledger/ledger-setup.service.js';
import { VendorBillsService } from '../modules/payables/vendor-bills.service.js';
import { EmployeeAdvancesService } from '../modules/expenses/employee-advances.service.js';
import { ExpenseClaimsService } from '../modules/expenses/expense-claims.service.js';
import { AccessService } from '../modules/identity/access/access.service.js';
import { VendorPaymentsService } from '../modules/payables/vendor-payments.service.js';
import { VendorsService } from '../modules/payables/vendors.service.js';

const PASSWORD = 'Demo-Pass-123';
let currentDb: DatabaseService | undefined;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const config = app.get<AppConfig>(APP_CONFIG);
    if (config.isProduction)
      throw new Error('Refusing to seed a production database');
    const db = app.get(DatabaseService);
    currentDb = db;
    const get = <T>(cls: new (...args: never[]) => T) =>
      app.get(cls, { strict: false });

    // seed code runs as "system" (all permissions), like a background job
    const asSystem = <T>(
      tenantId: string,
      work: () => Promise<T>,
      userId?: string,
    ) =>
      db.withTenant({ tenantId, userId, access: AccessGrants.system() }, work);

    // the Bangladesh rule pack, published as the platform team would
    const ownerDb = new DatabaseService(config, 'erp_owner');
    try {
      for (const version of ['2026.1', '2026.2', '2026.3']) {
        const file = JSON.parse(
          readFileSync(`rule-packs/bd-labour-${version}.json`, 'utf8'),
        );
        const { created } = await publishRulePack(
          ownerDb.kysely,
          file,
          'dev seed',
        );
        console.log(
          created
            ? `rule pack BD-LABOUR ${version} published`
            : `rule pack BD-LABOUR ${version} already published`,
        );
      }
    } finally {
      await ownerDb.close();
    }

    const demo = await ensureWorkspace(
      db,
      'demo',
      'Demo Trading Ltd',
      'admin@demo.test',
    );
    await asSystem(demo, () => seedDemoOrganization(get));
    const logins = await asSystem(demo, () => seedDemoLogins());
    await seedDemoBankRequests(get, demo, logins, asSystem);
    await asSystem(demo, () => acceptRulePack('demo'));
    await asSystem(
      demo,
      () => seedDemoConsents(),
      logins.get('farzana.akter@demo.test'),
    );
    await asSystem(
      demo,
      () => seedDemoAttendance(get),
      logins.get('farzana.akter@demo.test'),
    );
    await seedDemoLeave(get, demo, logins, asSystem);
    await seedDemoPayroll(get, demo, logins, asSystem);
    await asSystem(
      demo,
      () => seedDemoAi(get),
      logins.get('farzana.akter@demo.test'),
    );
    await seedDemoFinance(get, demo, logins, asSystem);
    await seedDemoPayrollPostings(get, demo, logins, asSystem);
    await seedDemoExpenses(get, demo, logins, asSystem);
    await seedDemoPayrollStatements(get, demo, logins, asSystem);
    await seedDemoLifecycle(get, demo, logins, asSystem);
    await seedDemoProcurement(get, demo, logins, asSystem);
    await seedDemoBudgets(get, demo, logins, asSystem);
    await seedDemoAssets(get, demo, logins, asSystem);
    await seedDemoBank(get, demo, logins, asSystem);
    await seedDemoVat(get, demo, logins, asSystem);
    await seedDemoGate2(get, demo, logins, asSystem);
    await seedDemoCrm(get, demo, logins, asSystem);
    await seedDemoOpportunities(get, demo, logins, asSystem);
    await seedDemoSales(get, demo, logins, asSystem);
    await seedDemoOverdueInvoice(get, demo, logins, asSystem);
    await ensureDemoBooks(get, demo, logins, asSystem);
    await seedDemoSalesStock(get, demo, asSystem);

    const rival = await ensureWorkspace(
      db,
      'rival',
      'Rival Pharma Ltd',
      'admin@rival.test',
    );
    await asSystem(rival, () => seedRivalOrganization(get));
    await asSystem(rival, () => acceptRulePack('rival'));
  } finally {
    await app.close();
  }
}

/** Tenant + admin login. Returns the tenant id. */
async function ensureWorkspace(
  db: DatabaseService,
  slug: string,
  name: string,
  email: string,
): Promise<string> {
  const existing = await sql<{
    id: string | null;
  }>`SELECT auth_find_tenant_id(${slug}) AS id`.execute(db.kysely);
  if (existing.rows[0]?.id) {
    console.log(`workspace "${slug}" already exists`);
    await ensureOwnerRoles(db, existing.rows[0].id, email);
    return existing.rows[0].id;
  }

  const { tenantId } = await createTenantWithOwner(db, {
    slug,
    name,
    ownerEmail: email,
    ownerPassword: PASSWORD,
  });
  console.log(`workspace "${slug}" created: ${email} / ${PASSWORD}`);
  return tenantId;
}

/** Workspaces seeded before WP2 have an owner without roles: give the bootstrap roles. */
async function ensureOwnerRoles(
  db: DatabaseService,
  tenantId: string,
  email: string,
): Promise<void> {
  await db.withTenant({ tenantId, access: AccessGrants.system() }, async () => {
    const owner = await db.tx
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirst();
    if (!owner) return;
    const has = await db.tx
      .selectFrom('user_roles')
      .select('id')
      .where('user_id', '=', owner.id)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (has) return;
    await db.tx
      .insertInto('user_roles')
      .values(
        (['system_admin', 'admin', 'hr'] as const).map((role) => ({
          user_id: owner.id,
          system_role: role,
          scope_type: 'group' as const,
          scope_id: null,
        })),
      )
      .execute();
    console.log(`  gave ${email} the owner roles (System Admin, Admin, HR)`);
  });
}

/** Demo logins linked to the demo employees, with their roles. Returns userId by email. */
async function seedDemoLogins(): Promise<Map<string, string>> {
  const db = currentDb!;
  const company = await db.tx
    .selectFrom('companies')
    .select('id')
    .where('legal_name', '=', 'Demo Trading Ltd')
    .executeTakeFirstOrThrow();
  const sales = await db.tx
    .selectFrom('departments')
    .select('id')
    .where('code', '=', 'SALES')
    .where('company_id', '=', company.id)
    .executeTakeFirstOrThrow();
  const passwordHash = await hashPassword(PASSWORD);

  type Grant = {
    system_role: 'admin' | 'hr' | 'accounts' | 'dept_head' | 'system_admin';
    scope_type: 'company' | 'department';
    scope_id: string;
  };
  const people: Array<{ email: string; name: string; roles: Grant[] }> = [
    {
      email: 'anisur.rahman@demo.test',
      name: 'Anisur Rahman',
      roles: [
        { system_role: 'admin', scope_type: 'company', scope_id: company.id },
      ],
    },
    {
      email: 'farzana.akter@demo.test',
      name: 'Farzana Akter',
      roles: [
        { system_role: 'hr', scope_type: 'company', scope_id: company.id },
      ],
    },
    {
      email: 'sujit.das@demo.test',
      name: 'Sujit Kumar Das',
      roles: [
        {
          system_role: 'accounts',
          scope_type: 'company',
          scope_id: company.id,
        },
      ],
    },
    {
      email: 'tanvir.hossain@demo.test',
      name: 'Tanvir Hossain',
      roles: [
        {
          system_role: 'dept_head',
          scope_type: 'department',
          scope_id: sales.id,
        },
      ],
    },
    {
      email: 'nusrat.jahan@demo.test',
      name: 'Nusrat Jahan',
      roles: [
        {
          system_role: 'system_admin',
          scope_type: 'company',
          scope_id: company.id,
        },
      ],
    },
    { email: 'rafi@demo.test', name: 'Mahmudul Hasan Rafi', roles: [] },
    { email: 'mitu@demo.test', name: 'Sharmin Sultana Mitu', roles: [] },
  ];

  const ids = new Map<string, string>();
  for (const p of people) {
    const existing = await db.tx
      .selectFrom('users')
      .select('id')
      .where('email', '=', p.email)
      .executeTakeFirst();
    if (existing) {
      ids.set(p.email, existing.id);
      continue;
    }
    const employee = await db.tx
      .selectFrom('employees')
      .select('id')
      .where('full_name_en', '=', p.name)
      .executeTakeFirstOrThrow();
    const user = await db.tx
      .insertInto('users')
      .values({
        email: p.email,
        password_hash: passwordHash,
        employee_id: employee.id,
        preferred_language: p.email.startsWith('rafi') ? 'bn' : 'en',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db.tx
      .insertInto('user_roles')
      .values([
        {
          user_id: user.id,
          system_role: 'employee',
          scope_type: 'own',
          scope_id: null,
        },
        ...p.roles.map((r) => ({ user_id: user.id, ...r })),
      ])
      .execute();
    ids.set(p.email, user.id);
  }
  console.log(`  demo logins ready: ${people.map((p) => p.email).join(', ')}`);
  return ids;
}

/**
 * Bangladesh 2026 public / festival holidays. Lunar dates (Eid, Ashura, Miladunnabi,
 * Durga Puja ...) are TENTATIVE: HR must update them from the government notice.
 */
const BD_HOLIDAYS_2026: Array<[string, string, string, 'public' | 'festival']> =
  [
    [
      '2026-02-21',
      'Shaheed Day & International Mother Language Day',
      'শহীদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস',
      'public',
    ],
    [
      '2026-03-19',
      'Eid-ul-Fitr holiday (tentative)',
      'ঈদুল ফিতরের ছুটি (সম্ভাব্য)',
      'festival',
    ],
    [
      '2026-03-20',
      'Eid-ul-Fitr (tentative)',
      'ঈদুল ফিতর (সম্ভাব্য)',
      'festival',
    ],
    [
      '2026-03-21',
      'Eid-ul-Fitr holiday (tentative)',
      'ঈদুল ফিতরের ছুটি (সম্ভাব্য)',
      'festival',
    ],
    [
      '2026-03-22',
      'Eid-ul-Fitr holiday (tentative)',
      'ঈদুল ফিতরের ছুটি (সম্ভাব্য)',
      'festival',
    ],
    ['2026-03-26', 'Independence Day', 'স্বাধীনতা দিবস', 'public'],
    [
      '2026-04-14',
      'Pahela Baishakh (Bengali New Year)',
      'পহেলা বৈশাখ',
      'public',
    ],
    ['2026-05-01', 'May Day', 'মে দিবস', 'public'],
    [
      '2026-05-26',
      'Eid-ul-Adha holiday (tentative)',
      'ঈদুল আজহার ছুটি (সম্ভাব্য)',
      'festival',
    ],
    [
      '2026-05-27',
      'Eid-ul-Adha (tentative)',
      'ঈদুল আজহা (সম্ভাব্য)',
      'festival',
    ],
    [
      '2026-05-28',
      'Eid-ul-Adha holiday (tentative)',
      'ঈদুল আজহার ছুটি (সম্ভাব্য)',
      'festival',
    ],
    ['2026-06-26', 'Ashura (tentative)', 'আশুরা (সম্ভাব্য)', 'public'],
    [
      '2026-08-05',
      'July Mass Uprising Day',
      'জুলাই গণঅভ্যুত্থান দিবস',
      'public',
    ],
    [
      '2026-08-26',
      'Eid-e-Miladunnabi (tentative)',
      'ঈদে মিলাদুন্নবী (সম্ভাব্য)',
      'public',
    ],
    [
      '2026-09-04',
      'Janmashtami (tentative)',
      'জন্মাষ্টমী (সম্ভাব্য)',
      'festival',
    ],
    [
      '2026-10-21',
      'Durga Puja - Bijoya Dashami (tentative)',
      'দুর্গাপূজা - বিজয়া দশমী (সম্ভাব্য)',
      'festival',
    ],
    ['2026-12-16', 'Victory Day', 'বিজয় দিবস', 'public'],
    ['2026-12-25', 'Christmas Day', 'বড়দিন', 'festival'],
  ];

/** Calendar, shifts, devices and two weeks of punches for the demo company. */
async function seedDemoAttendance(get: Get) {
  const db = currentDb!;
  const company = await db.tx
    .selectFrom('companies')
    .select('id')
    .where('legal_name', '=', 'Demo Trading Ltd')
    .executeTakeFirstOrThrow();
  const existing = await db.tx
    .selectFrom('shifts')
    .select('id')
    .where('company_id', '=', company.id)
    .executeTakeFirst();
  if (existing) {
    console.log('  demo attendance already seeded');
    return;
  }
  const branches = await db.tx
    .selectFrom('branches')
    .selectAll()
    .where('company_id', '=', company.id)
    .execute();
  const dhk = branches.find((b) => b.code === 'DHK')!;
  const ctg = branches.find((b) => b.code === 'CTG')!;

  // holiday calendar for both branches
  const holidays = get(HolidaysService);
  const calendar = await holidays.createCalendar(company.id, {
    name: 'Bangladesh 2026',
  });
  for (const [date, nameEn, nameBn, type] of BD_HOLIDAYS_2026)
    await holidays.addHoliday(calendar.id, { date, nameEn, nameBn, type });
  await db.tx
    .updateTable('branches')
    .set({ holiday_calendar_id: calendar.id })
    .where('company_id', '=', company.id)
    .execute();

  // shifts: General (default) and Ramadan hours
  const shifts = get(ShiftsService);
  await shifts.createShift(company.id, {
    code: 'GEN',
    name: 'General',
    startTime: '09:00',
    endTime: '18:00',
    graceMinutes: 15,
    halfDayMinutes: 240,
    isDefault: true,
  });
  await shifts.createOverride(company.id, {
    name: 'Ramadan 2026 (tentative dates)',
    fromDate: '2026-02-18',
    toDate: '2026-03-18',
    startTime: '09:00',
    endTime: '15:30',
    graceMinutes: 15,
    halfDayMinutes: 180,
  });

  // biometric user numbers = last digits of the employee code
  const employees = await db.tx
    .selectFrom('employees')
    .select(['id', 'employee_code', 'full_name_en', 'status'])
    .where('company_id', '=', company.id)
    .execute();
  const userNo = new Map<string, string>();
  for (const e of employees) {
    const no = String(1000 + Number(e.employee_code.slice(-5)));
    userNo.set(e.full_name_en, no);
    await shifts.updateProfile(e.id, {
      deviceUserId: no,
      webPunchAllowed: e.full_name_en === 'Nusrat Jahan',
    });
  }

  // Rafi's phone, registered and approved
  const rafi = employees.find((e) => e.full_name_en === 'Mahmudul Hasan Rafi')!;
  await db.tx
    .insertInto('employee_devices')
    .values({
      employee_id: rafi.id,
      device_id: 'demo-install-rafi-a15',
      name: 'Samsung Galaxy A15',
      status: 'active',
      approved_at: new Date(),
    })
    .execute();

  // device punches 1-13 Oct 2026 (through the same path as the office agent)
  const punchesService = get(PunchesService);
  const people = employees.filter((e) => e.status !== 'draft');
  const at = (d: string, hhmm: string) => `${d}T${hhmm}:00+06:00`;
  for (const [branch, serial] of [
    [dhk, 'ZK-DHK-001'],
    [ctg, 'ZK-CTG-001'],
  ] as const) {
    const punches: Array<{ deviceUserId: string; punchedAt: string }> = [];
    for (
      let d: BusinessDate = businessDate('2026-10-01');
      d <= '2026-10-13';
      d = addDays(d, 1)
    ) {
      if ((branch.weekend_days as string[]).includes(weekdayOf(d))) continue;
      for (const e of people) {
        const placement = await db.tx
          .selectFrom('employee_assignments')
          .select('branch_id')
          .where('employee_id', '=', e.id)
          .where('effective_from', '<=', d)
          .where((eb) =>
            eb.or([eb('effective_to', 'is', null), eb('effective_to', '>', d)]),
          )
          .executeTakeFirst();
        if (placement?.branch_id !== branch.id) continue;
        const no = userNo.get(e.full_name_en)!;
        // a little realism: Mitu is late on the 5th and forgets to punch out on the 8th, Tanvir works late on the 6th
        if (e.full_name_en === 'Sharmin Sultana Mitu' && d === '2026-10-07')
          continue; // absent
        const inTime =
          e.full_name_en === 'Sharmin Sultana Mitu' && d === '2026-10-05'
            ? '09:42'
            : '08:5' + (d.charCodeAt(9) % 9);
        punches.push({ deviceUserId: no, punchedAt: at(d, inTime) });
        if (e.full_name_en === 'Sharmin Sultana Mitu' && d === '2026-10-08')
          continue; // missing punch
        punches.push({
          deviceUserId: no,
          punchedAt: at(
            d,
            e.full_name_en === 'Tanvir Hossain' && d === '2026-10-06'
              ? '20:30'
              : '18:0' + (d.charCodeAt(9) % 7),
          ),
        });
      }
    }
    await punchesService.deviceBatch({
      deviceSerial: serial,
      branchId: branch.id,
      brand: 'demo',
      deviceTime: new Date().toISOString(),
      punches,
    });
  }
  // finish the remaining days (weekends, holidays, absences)
  const attendance = get(AttendanceService);
  await attendance.recompute({
    companyId: company.id,
    from: '2026-10-01',
    to: '2026-10-13',
  });

  // service key for the Dhaka HQ agent (the secret is shown only now)
  const key = await get(ServiceKeysService).createKey({
    name: 'Dhaka HQ biometric agent (demo)',
    permissions: ['attendance.ingest'],
    companyId: company.id,
  });
  console.log(
    '  demo attendance seeded: holidays 2026, General shift, Ramadan hours, punches 1-13 Oct',
  );
  console.log(
    `  agent service key (save it, shown once): Authorization: ${key.authorizationHeader}`,
  );
  console.log(`  Dhaka HQ branchId for device uploads: ${dhk.id}`);
}

/** Leave types, balances, a closed 2025, and a few requests. */
async function seedDemoLeave(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const hr = logins.get('farzana.akter@demo.test');
  const done = await asSystem(tenantId, () =>
    db.tx.selectFrom('leave_types').select('id').executeTakeFirst(),
  );
  if (done) {
    console.log('  demo leave already seeded');
    return;
  }
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const employeeId = (name: string) =>
    asSystem(
      tenantId,
      async () =>
        (
          await db.tx
            .selectFrom('employees')
            .select('id')
            .where('full_name_en', '=', name)
            .executeTakeFirstOrThrow()
        ).id,
    );

  // leave types from the rule pack, and the 2026 grants
  const types = get(LeaveTypesService);
  await asSystem(tenantId, () => types.createDefaults(company.id), hr);
  const typeId = async (code: string) =>
    asSystem(
      tenantId,
      async () =>
        (
          await db.tx
            .selectFrom('leave_types')
            .select('id')
            .where('code', '=', code)
            .executeTakeFirstOrThrow()
        ).id,
    );
  const ledger = get(LeaveLedgerService);

  // earned-leave balances brought over from the old system, then 2025 closed
  const el = await typeId('EL');
  for (const [name, days] of [
    ['Anisur Rahman', 42],
    ['Farzana Akter', 25.5],
    ['Sujit Kumar Das', 31],
    ['Tanvir Hossain', 18],
  ] as const) {
    const id = await employeeId(name);
    await asSystem(
      tenantId,
      () =>
        ledger.addManualEntry(id, {
          leaveTypeId: el,
          kind: 'opening',
          days,
          entryDate: '2025-12-31',
          note: 'Opening balance from the old payroll register',
        }),
      hr,
    );
  }
  await asSystem(tenantId, () => ledger.runYearEnd(company.id, '2025'), hr);
  await asSystem(tenantId, () => ledger.runAccruals(company.id), hr);

  // requests (applied by the employee, approved by the approver)
  const requests = get(LeaveRequestsService);
  const approvals = get(ApprovalsService);
  const leave = async (
    email: string,
    name: string,
    code: string,
    fromDate: string,
    toDate: string,
    reason: string,
    approverEmail?: string,
  ) => {
    const id = await employeeId(name);
    const created = await asSystem(
      tenantId,
      async () =>
        requests.apply(id, {
          leaveTypeId: await typeId(code),
          fromDate,
          toDate,
          reason,
        }),
      email === 'hr' ? hr : logins.get(email),
    );
    if (approverEmail)
      await asSystem(
        tenantId,
        () =>
          approvals.decide(created.approvalRequestId!, 'approve', 'Approved'),
        logins.get(approverEmail),
      );
  };
  await leave(
    'hr',
    'Sharmin Sultana Mitu',
    'SL',
    '2026-10-07',
    '2026-10-08',
    'Fever (entered by HR)',
    'tanvir.hossain@demo.test',
  );
  await leave(
    'nusrat.jahan@demo.test',
    'Nusrat Jahan',
    'CL',
    '2026-10-08',
    '2026-10-08',
    'Family programme',
    'anisur.rahman@demo.test',
  );
  await leave(
    'rafi@demo.test',
    'Mahmudul Hasan Rafi',
    'CL',
    '2026-10-22',
    '2026-10-25',
    "Sister's wedding in Sylhet",
  );
  console.log(
    '  demo leave seeded: CL/SL/EL/ML/LWP, 2025 closed (EL carry 40 + encashment), 3 requests',
  );
}

/** Payroll setup, the September 2026 run calculated (waiting for HR to clear flags and submit). */
async function seedDemoPayroll(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const hr = logins.get('farzana.akter@demo.test');
  const done = await asSystem(tenantId, () =>
    db.tx.selectFrom('salary_heads').select('id').executeTakeFirst(),
  );
  if (done) {
    console.log('  demo payroll already seeded');
    return;
  }
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const employeeId = (name: string) =>
    asSystem(
      tenantId,
      async () =>
        (
          await db.tx
            .selectFrom('employees')
            .select('id')
            .where('full_name_en', '=', name)
            .executeTakeFirstOrThrow()
        ).id,
    );

  // heads, standard structure, salaries
  const setup = get(PayrollSetupService);
  const { structureId } = await asSystem(
    tenantId,
    () => setup.createDefaults(company.id),
    hr,
  );
  // [name, joining gross, July-August taxable income, tax withheld in the old system]
  const people: Array<[string, string, string, string]> = [
    ['Anisur Rahman', '180000', '360000', '37291.67'],
    ['Farzana Akter', '85000', '170000', '5125.00'],
    ['Sujit Kumar Das', '90000', '180000', '6125.00'],
    ['Tanvir Hossain', '95000', '190000', '7125.00'],
    ['Nusrat Jahan', '42000', '84000', '0'],
    ['Mahmudul Hasan Rafi', '28000', '60000', '0'],
    ['Sharmin Sultana Mitu', '26000', '52000', '0'],
  ];
  for (const [name, gross, taxable, tax] of people) {
    const id = await employeeId(name);
    const join = await asSystem(
      tenantId,
      async () =>
        (
          await db.tx
            .selectFrom('employees')
            .select('join_date')
            .where('id', '=', id)
            .executeTakeFirstOrThrow()
        ).join_date,
    );
    await asSystem(
      tenantId,
      () =>
        setup.addSalary(id, {
          effectiveFrom: join,
          gross,
          structureId,
          reason: 'Salary from the old payroll register',
        }),
      hr,
    );
    await asSystem(
      tenantId,
      () =>
        setup.saveYtdOpening(id, {
          fiscalYear: '2026-27',
          kind: 'opening',
          taxableIncome: taxable,
          taxWithheld: tax,
          note: 'July-August 2026 paid in the old system',
        }),
      hr,
    );
  }
  const rafi = await employeeId('Mahmudul Hasan Rafi');
  await asSystem(
    tenantId,
    () =>
      setup.addSalary(rafi, {
        effectiveFrom: '2026-07-01',
        gross: '30000',
        structureId,
        reason: 'Annual increment 2026',
      }),
    hr,
  );

  // a commission and a salary advance (waiting for Tanvir, then Accounts)
  const variables = get(PayrollVariablesService);
  await asSystem(
    tenantId,
    () =>
      variables.addVariable(company.id, {
        employeeId: rafi,
        period: '2026-09',
        headCode: 'COMMISSION',
        amount: '6000',
        note: 'Q3 dealer target met (Mirpur, Uttara)',
      }),
    hr,
  );
  const mitu = await employeeId('Sharmin Sultana Mitu');
  await asSystem(
    tenantId,
    () =>
      variables.requestLoan(mitu, {
        principal: '12000',
        installment: '3000',
        firstPeriod: '2026-10',
        reason:
          'Treatment of her mother at Chattogram Medical College Hospital',
      }),
    hr,
  );

  // September: no devices yet, so the month is locked and marked present (Mitu absent on Thursday 17 Sep)
  await asSystem(
    tenantId,
    () =>
      get(AttendanceService).lockMonth({
        companyId: company.id,
        period: '2026-09',
      }),
    hr,
  );
  await asSystem(tenantId, async () => {
    await db.tx
      .updateTable('attendance_days')
      .set({ status: 'present', worked_minutes: 540 })
      .where('company_id', '=', company.id)
      .where('work_date', '>=', '2026-09-01')
      .where('work_date', '<=', '2026-09-30')
      .where('status', '=', 'absent')
      .execute();
    await db.tx
      .updateTable('attendance_days')
      .set({ status: 'absent', worked_minutes: 0 })
      .where('employee_id', '=', mitu)
      .where('work_date', '=', '2026-09-17')
      .execute();
  });

  // the September run, calculated
  const runs = get(PayrollRunsService);
  const run = await asSystem(
    tenantId,
    () => runs.createRun(company.id, { runType: 'regular', period: '2026-09' }),
    hr,
  );
  const calculated = await asSystem(tenantId, () => runs.calculate(run.id), hr);
  console.log(
    `  demo payroll seeded: September run ${run.id} calculated for ${calculated.headcount} employees, ${calculated.openFlags} flag(s) to clear`,
  );
}

/** The workspace uses BD-LABOUR 2026.1 from 2025-01-01, 2026.2 (salary tax values) from 2025-07-01, 2026.3 (tax at source) from 2026-07-01. */
/** WP12: consent before biometric and location data are used (idempotent; also for older dev databases). */
async function seedDemoConsents() {
  const db = currentDb!;
  if (
    await db.tx
      .selectFrom('employee_consents')
      .select('id')
      .limit(1)
      .executeTakeFirst()
  )
    return;
  const employees = await db.tx
    .selectFrom('employees')
    .select(['id', 'full_name_en'])
    .where('status', '<>', 'draft')
    .execute();
  for (const e of employees) {
    await db.tx
      .insertInto('employee_consents')
      .values({
        employee_id: e.id,
        purpose: 'biometric_attendance',
        granted: true,
        notice_version: 'biometric-2026.1',
        method: 'paper',
      })
      .execute();
    if (e.full_name_en === 'Mahmudul Hasan Rafi') {
      await db.tx
        .insertInto('employee_consents')
        .values({
          employee_id: e.id,
          purpose: 'location_attendance',
          granted: true,
          notice_version: 'location-2026.1',
          method: 'app',
        })
        .execute();
    }
  }
  console.log(
    `  consent recorded for ${employees.length} employees (biometric) and Rafi (location)`,
  );
}

/** WP11: the demo company is on the Intelligent plan with AI on, and its handbook is loaded. */
async function seedDemoAi(get: Get) {
  const db = currentDb!;
  await db.tx
    .updateTable('tenants')
    .set({ plan_tier: 'intelligent' })
    .execute();
  await db.tx
    .insertInto('ai_settings')
    .values({ enabled: true })
    .onConflict((oc) => oc.column('tenant_id').doNothing())
    .execute();

  const handbooks = [
    {
      file: 'samples/policies/demo-hr-policy.en.md',
      title: 'Employee Handbook 2026',
      language: 'en' as const,
    },
    {
      file: 'samples/policies/demo-hr-policy.bn.md',
      title: 'কর্মী হ্যান্ডবুক ২০২৬',
      language: 'bn' as const,
    },
  ];
  for (const h of handbooks) {
    const exists = await db.tx
      .selectFrom('ai_policy_documents')
      .select('id')
      .where('title', '=', h.title)
      .where('active', '=', true)
      .executeTakeFirst();
    if (exists) continue;
    const doc = await get(PolicyDocumentsService).create({
      title: h.title,
      language: h.language,
      body: readFileSync(h.file, 'utf8'),
    });
    console.log(
      `  AI policy document "${h.title}" loaded (${doc.chunks} pieces)`,
    );
  }
}

async function acceptRulePack(workspace: string) {
  const db = currentDb!;
  for (const [version, from] of [
    ['2026.1', '2025-01-01'],
    ['2026.2', '2025-07-01'],
    ['2026.3', '2026-07-01'],
  ]) {
    const pack = await db.tx
      .selectFrom('rule_packs')
      .select('id')
      .where('code', '=', 'BD-LABOUR')
      .where('version', '=', version)
      .executeTakeFirstOrThrow();
    const already = await db.tx
      .selectFrom('tenant_rule_packs')
      .select('id')
      .where('pack_id', '=', pack.id)
      .executeTakeFirst();
    if (already) continue;
    await db.tx
      .insertInto('tenant_rule_packs')
      .values({ pack_id: pack.id, effective_from: from, note: 'Dev seed' })
      .execute();
    console.log(`  ${workspace}: accepted BD-LABOUR ${version} from ${from}`);
  }
}

/** A few salary account changes, so approval inboxes are not empty. */
async function seedDemoBankRequests(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const already = await asSystem(tenantId, () =>
    db.tx.selectFrom('approval_requests').select('id').executeTakeFirst(),
  );
  if (already) {
    console.log('  demo approval requests already seeded');
    return;
  }
  const bank = get(BankAccountsService);
  const approvals = get(ApprovalsService);
  const employeeIdOf = (email: string) =>
    asSystem(
      tenantId,
      async () =>
        (
          await db.tx
            .selectFrom('users')
            .select('employee_id')
            .where('email', '=', email)
            .executeTakeFirstOrThrow()
        ).employee_id!,
    );

  // Tanvir: Nagad wallet, approved by HR (Farzana)
  const tanvir = await employeeIdOf('tanvir.hossain@demo.test');
  const t = await asSystem(
    tenantId,
    () =>
      bank.requestChange(tanvir, {
        kind: 'wallet',
        walletProvider: 'nagad',
        walletNumber: '01719876543',
        accountName: 'Tanvir Hossain',
      }),
    logins.get('tanvir.hossain@demo.test'),
  );
  await asSystem(
    tenantId,
    () => approvals.decide(t.approvalRequestId, 'approve', 'Verified with NID'),
    logins.get('farzana.akter@demo.test'),
  );

  // Rafi: bKash, waiting for HR
  const rafi = await employeeIdOf('rafi@demo.test');
  await asSystem(
    tenantId,
    () =>
      bank.requestChange(rafi, {
        kind: 'wallet',
        walletProvider: 'bkash',
        walletNumber: '01712345678',
        accountName: 'Mahmudul Hasan Rafi',
      }),
    logins.get('rafi@demo.test'),
  );

  // Mitu: Dutch-Bangla Bank account, entered by HR (Farzana) -> the owner (also HR) approves it
  const mitu = await employeeIdOf('mitu@demo.test');
  await asSystem(
    tenantId,
    () =>
      bank.requestChange(mitu, {
        kind: 'bank',
        bankName: 'Dutch-Bangla Bank PLC',
        branchName: 'Agrabad',
        routingNumber: '090150250',
        accountName: 'Sharmin Sultana Mitu',
        accountNumber: '1501100054321',
      }),
    logins.get('farzana.akter@demo.test'),
  );
  console.log('  demo approval requests seeded (2 waiting in HR inbox)');
}

type Get = <T>(cls: new (...args: never[]) => T) => T;

/**
 * Payroll approved or paid before the books existed (e.g. by the e2e tests) is not in
 * the ledger; post it as Accounts would (POST /payroll-runs/:id/ledger-posting).
 */
async function seedDemoPayrollPostings(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const sujit = logins.get('sujit.das@demo.test');
  const posting = get(LedgerPostingService);
  const missing = await asSystem(tenantId, async () => ({
    runs: await db.tx
      .selectFrom('payroll_runs as r')
      .leftJoin('vouchers as v', (j) =>
        j.onRef('v.source_id', '=', 'r.id').on('v.state', '=', 'posted'),
      )
      .select('r.id')
      .where('r.state', 'in', ['approved', 'disbursed'])
      .where('v.id', 'is', null)
      .execute(),
    files: await db.tx
      .selectFrom('disbursement_files as f')
      .leftJoin('vouchers as v', (j) =>
        j.onRef('v.source_id', '=', 'f.id').on('v.state', '=', 'posted'),
      )
      .select('f.id')
      .where('f.state', '=', 'settled')
      .where('v.id', 'is', null)
      .execute(),
  }));
  let posted = 0;
  for (const r of missing.runs)
    posted += await asSystem(
      tenantId,
      () =>
        posting.postPayrollRun(r.id).then(
          () => 1,
          () => 0,
        ),
      sujit,
    );
  for (const f of missing.files)
    posted += await asSystem(
      tenantId,
      () =>
        posting.postDisbursementFile(f.id).then(
          () => 1,
          () => 0,
        ),
      sujit,
    );
  if (missing.runs.length || missing.files.length)
    console.log(
      `  demo payroll postings: ${posted} of ${missing.runs.length + missing.files.length} posted to the ledger`,
    );
}

/**
 * Payroll fixes (2026-10-21): PF balances brought from the old payroll, the
 * challan that deposited September's salary tax, Mitu's advance approved and
 * waiting for its payout, and an advance Rafi asked for himself (waiting for
 * Tanvir). Idempotent: skipped once a PF opening exists.
 */
async function seedDemoPayrollStatements(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const done = await asSystem(tenantId, () =>
    db.tx.selectFrom('pf_openings').select('id').executeTakeFirst(),
  );
  if (done) {
    console.log('  demo payroll statements already seeded');
    return;
  }
  const [hr, sujit, tanvir, rafiLogin] = [
    'farzana.akter@demo.test',
    'sujit.das@demo.test',
    'tanvir.hossain@demo.test',
    'rafi@demo.test',
  ].map((e) => logins.get(e));
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const employeeId = (name: string) =>
    asSystem(
      tenantId,
      async () =>
        (
          await db.tx
            .selectFrom('employees')
            .select('id')
            .where('full_name_en', '=', name)
            .executeTakeFirstOrThrow()
        ).id,
    );
  const statements = get(PayrollStatementsService);

  // PF members carried over from the old payroll (balance on 30 June 2026)
  for (const [name, part] of [
    ['Anisur Rahman', '216000'],
    ['Farzana Akter', '102000'],
    ['Sujit Kumar Das', '108000'],
    ['Tanvir Hossain', '114000'],
  ] as const) {
    const id = await employeeId(name);
    await asSystem(
      tenantId,
      () =>
        statements.savePfOpening(id, {
          asOf: '2026-06-30',
          employeePart: part,
          employerPart: part,
          note: 'Balance from the old payroll register, June 2026',
        }),
      hr,
    );
  }

  // September's salary tax deposited at Sonali Bank (Motijheel) on 12 October
  const withheld = await asSystem(
    tenantId,
    () => statements.listChallans(company.id, '2026-27'),
    sujit,
  );
  const september = withheld.months.find((m) => m.period === '2026-09');
  if (september && Number(september.withheld) > 0) {
    await asSystem(
      tenantId,
      () =>
        statements.addChallan(company.id, {
          period: '2026-09',
          challanNo: 'TR-2627-0912',
          challanDate: '2026-10-12',
          amount: september.withheld,
        }),
      sujit,
    );
  }

  // Mitu's advance: Tanvir and Accounts approve; Accounts still has to pay it out
  const approvals = get(ApprovalsService);
  const mitu = await employeeId('Sharmin Sultana Mitu');
  const pending = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('loans')
      .select('approval_request_id')
      .where('employee_id', '=', mitu)
      .where('state', '=', 'pending')
      .executeTakeFirst(),
  );
  if (pending?.approval_request_id) {
    await asSystem(
      tenantId,
      () =>
        approvals.decide(
          pending.approval_request_id!,
          'approve',
          'Family emergency, approved',
        ),
      tanvir,
    );
    await asSystem(
      tenantId,
      () =>
        approvals.decide(
          pending.approval_request_id!,
          'approve',
          'Recovery within 4 months is fine',
        ),
      sujit,
    );
  }

  // Rafi asks for an advance himself (from the app)
  const rafi = await employeeId('Mahmudul Hasan Rafi');
  const access = await asSystem(
    tenantId,
    () => get(AccessService).load(rafiLogin!),
    rafiLogin,
  );
  await db.withTenant({ tenantId, userId: rafiLogin, access }, () =>
    get(PayrollVariablesService).requestLoan(rafi, {
      principal: '20000',
      installment: '5000',
      firstPeriod: '2026-11',
      reason: 'Admission fee for my daughter at Viqarunnisa Noon School',
    }),
  );
  console.log(
    '  demo payroll statements seeded: 4 PF openings, September salary tax challan, 2 salary advances',
  );
}

/**
 * Employee audit fixes (2026-10-21): the long-serving staff are confirmed (their
 * probations ended years ago), Tanvir recommends confirming Rafi (HR still to
 * decide; Mitu has no recommendation yet), and Kamrul Hasan of Sales Dhaka has
 * resigned with 56 of 60 days' notice: IT has cleared him, Admin, Accounts and
 * Tanvir still have to. Idempotent: skipped once a separation exists.
 */
async function seedDemoLifecycle(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const done = await asSystem(tenantId, () =>
    db.tx.selectFrom('separations').select('id').executeTakeFirst(),
  );
  if (done) {
    console.log('  demo lifecycle already seeded');
    return;
  }
  const owner = await asSystem(
    tenantId,
    async () =>
      (
        await db.tx
          .selectFrom('users')
          .select('id')
          .where('email', '=', 'admin@demo.test')
          .executeTakeFirstOrThrow()
      ).id,
  );
  const [tanvir, nusrat, hr] = [
    'tanvir.hossain@demo.test',
    'nusrat.jahan@demo.test',
    'farzana.akter@demo.test',
  ].map((e) => logins.get(e));
  const asUser = async <T>(
    userId: string | undefined,
    work: () => Promise<T>,
  ) => {
    const access = await asSystem(
      tenantId,
      () => get(AccessService).load(userId!),
      userId,
    );
    return db.withTenant({ tenantId, userId, access }, work);
  };
  const lifecycle = get(LifecycleService);
  const employeeId = (name: string) =>
    asSystem(
      tenantId,
      async () =>
        (
          await db.tx
            .selectFrom('employees')
            .select('id')
            .where('full_name_en', '=', name)
            .executeTakeFirstOrThrow()
        ).id,
    );

  // confirmations (Farzana's by the owner: nobody decides their own)
  for (const name of [
    'Anisur Rahman',
    'Farzana Akter',
    'Sujit Kumar Das',
    'Tanvir Hossain',
    'Nusrat Jahan',
  ]) {
    const id = await employeeId(name);
    await asUser(owner, () =>
      lifecycle.decide(id, {
        outcome: 'confirm',
        note: 'Probation completed; confirmed when records moved to the new system',
      }),
    );
  }
  const rafi = await employeeId('Mahmudul Hasan Rafi');
  await asUser(tanvir, () =>
    lifecycle.recommend(rafi, {
      outcome: 'confirm',
      note: 'Consistently met the dealer targets in Mirpur and Uttara',
    }),
  );

  // Kamrul Hasan: in Sales Dhaka since May 2023, resigned on 5 October
  const ids = await asSystem(tenantId, async () => {
    const company = await db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow();
    const pick = async (
      table: 'branches' | 'departments' | 'designations' | 'grades',
      code: string,
    ) =>
      (
        await db.tx
          .selectFrom(table)
          .select('id')
          .where('company_id', '=', company.id)
          .where('code', '=', code)
          .executeTakeFirstOrThrow()
      ).id;
    return {
      company: company.id,
      branch: await pick('branches', 'DHK'),
      dept: await pick('departments', 'SALES-DHK'),
      desig: await pick('designations', 'SE'),
      grade: await pick('grades', 'G2'),
    };
  });
  const tanvirId = await employeeId('Tanvir Hossain');
  const kamrul = await asSystem(tenantId, () =>
    get(EmployeesService).createEmployee({
      companyId: ids.company,
      fullNameEn: 'Kamrul Hasan',
      fullNameBn: 'কামরুল হাসান',
      gender: 'male',
      joinDate: '2023-05-01',
      nid: '1993123456789',
      phone: '01823456789',
      festivalGroup: 'eid',
      branchId: ids.branch,
      departmentId: ids.dept,
      designationId: ids.desig,
      gradeId: ids.grade,
      lineManagerId: tanvirId,
    }),
  );
  await asSystem(tenantId, () =>
    get(EmployeesService).activateImported(kamrul.id, 'active', null),
  );
  const structure = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('salary_structures')
      .select('id')
      .where('company_id', '=', ids.company)
      .executeTakeFirst(),
  );
  if (structure) {
    await asSystem(
      tenantId,
      () =>
        get(PayrollSetupService).addSalary(kamrul.id, {
          effectiveFrom: '2023-05-01',
          gross: '38000',
          structureId: structure.id,
          reason: 'Salary from the old payroll register',
        }),
      hr,
    );
  }
  await asUser(owner, () =>
    lifecycle.recordNotice(kamrul.id, {
      kind: 'resignation',
      noticeDate: '2026-10-05',
      lastWorkingDay: '2026-11-30',
      reason:
        'Joining Square Pharmaceuticals as area sales manager (letter dated 5 October)',
    }),
  );
  const separation = await asSystem(
    tenantId,
    async () =>
      (
        await db.tx
          .selectFrom('separations')
          .select('id')
          .where('employee_id', '=', kamrul.id)
          .executeTakeFirstOrThrow()
      ).id,
  );
  await asUser(nusrat, () =>
    lifecycle.clear(
      separation,
      'it',
      'E-mail and ERP login to be closed on 30 November; nothing else held',
    ),
  );
  console.log(
    '  demo lifecycle seeded: 5 confirmations, a recommendation for Rafi, Kamrul Hasan leaving (1 of 4 cleared)',
  );
}

/**
 * WP17 procurement: three furniture vendors, and requisitions at every stage.
 *  - Rafi: chairs and meeting tables for the new sales officers (Tk 75,000): approved by
 *    Tanvir and Sujit, three quotations, Partex chosen (faster delivery, not the lowest)
 *    and approved by Anisur, PO issued, 4 of 6 chairs received; Partex's bill for all 6
 *    chairs is a draft that does not match (only 4 received).
 *  - Rafi: a whiteboard (Tk 6,500): approved, waiting for Accounts to buy.
 *  - Mitu: printer toner (Tk 9,000): waiting for Tanvir.
 * Idempotent: skipped once a requisition exists.
 */
async function seedDemoProcurement(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const done = await asSystem(tenantId, () =>
    db.tx.selectFrom('purchase_requisitions').select('id').executeTakeFirst(),
  );
  if (done) {
    console.log('  demo procurement already seeded');
    return;
  }
  const [rafi, mitu, tanvir, sujit, anisur] = [
    'rafi@demo.test',
    'mitu@demo.test',
    'tanvir.hossain@demo.test',
    'sujit.das@demo.test',
    'anisur.rahman@demo.test',
  ].map((e) => logins.get(e));
  const asUser = async <T>(
    userId: string | undefined,
    work: () => Promise<T>,
  ) => {
    const access = await asSystem(
      tenantId,
      () => get(AccessService).load(userId!),
      userId,
    );
    return db.withTenant({ tenantId, userId, access }, work);
  };
  const approvals = get(ApprovalsService);
  const decide = (requestId: string, who: string | undefined, note: string) =>
    asUser(who, () => approvals.decide(requestId, 'approve', note));
  const requisitions = get(RequisitionsService);
  const orders = get(PurchaseOrdersService);
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const account = await asSystem(tenantId, async () => {
    const rows = await db.tx
      .selectFrom('accounts')
      .select(['id', 'code'])
      .where('company_id', '=', company.id)
      .execute();
    return (code: string) => rows.find((r) => r.code === code)!.id;
  });

  // furniture vendors
  const vendors = get(VendorsService);
  const add = (dto: Parameters<VendorsService['create']>[1]) =>
    asSystem(tenantId, () => vendors.create(company.id, dto), sujit);
  const otobi = await add({
    name: 'Otobi Ltd',
    nameBn: 'অটবি লিমিটেড',
    tin: '412345678901',
    bin: '000412345-0101',
    phone: '01713001122',
    address: 'Tejgaon I/A, Dhaka 1208',
    withholdingCategory: 'SUPPLY',
  });
  const hatil = await add({
    name: 'Hatil Complex Ltd',
    nameBn: 'হাতিল কমপ্লেক্স লিমিটেড',
    tin: '423456789012',
    bin: '000423456-0101',
    phone: '01713002233',
    address: 'Mirpur Road, Dhaka 1207',
    withholdingCategory: 'SUPPLY',
  });
  const partex = await add({
    name: 'Partex Furniture Industries Ltd',
    nameBn: 'পারটেক্স ফার্নিচার ইন্ডাস্ট্রিজ লিমিটেড',
    tin: '434567890123',
    bin: '000434567-0101',
    phone: '01713003344',
    address: 'Gulshan-1, Dhaka 1212',
    withholdingCategory: 'SUPPLY',
  });

  // 1. chairs and tables, ordered from Partex, partly received
  const furniture = await asUser(rafi, () =>
    requisitions.create(company.id, {
      title: 'Furniture for the new sales officers',
      justification:
        'Six sales officers join Sales Dhaka on 1 November; the floor has no free chairs',
      neededBy: '2026-11-01',
      lines: [
        {
          description: 'Office chair, mesh back',
          quantity: '6',
          unit: 'pcs',
          estimatedUnitPrice: '8500',
        },
        {
          description: 'Meeting table, 6 seats',
          quantity: '2',
          unit: 'pcs',
          estimatedUnitPrice: '12000',
        },
      ],
    }),
  );
  const sent = await asUser(rafi, () => requisitions.submit(furniture.id));
  await decide(
    sent.approvalRequestId!,
    tanvir,
    'Needed before the new officers join',
  );
  await decide(
    sent.approvalRequestId!,
    sujit,
    'Within the Sales furniture budget',
  );
  const [chairs, tables] = furniture.lines;
  const quote = (
    vendorId: string,
    reference: string,
    chair: string,
    table: string,
    days: number,
  ) =>
    asUser(sujit, () =>
      requisitions.addQuotation(furniture.id, {
        vendorId,
        reference,
        quotationDate: '2026-10-06',
        validUntil: '2026-10-31',
        deliveryDays: days,
        lines: [
          { requisitionLineId: chairs.id, unitPrice: chair, vatPercent: '15' },
          { requisitionLineId: tables.id, unitPrice: table, vatPercent: '15' },
        ],
      }),
    );
  await quote(otobi.id, 'OT/Q/2026/311', '8200', '11500', 14);
  await quote(hatil.id, 'HCL-2026-0788', '8900', '12500', 10);
  const quoted = await quote(partex.id, 'PFIL/Q/1042', '8300', '11800', 5);
  const partexQuote = quoted.quotations.find((q) => q.vendorId === partex.id)!;
  const statement = await asUser(sujit, () =>
    requisitions.submitStatement(furniture.id, {
      quotationId: partexQuote.id,
      reason:
        'Delivery in 5 days; Otobi needs 14 and the officers join on 1 November',
    }),
  );
  await decide(
    statement.comparativeStatement.approvalRequestId!,
    anisur,
    'Agreed: delivery matters here',
  );
  const po = await asUser(sujit, () =>
    orders.create(furniture.id, {
      quotationId: partexQuote.id,
      orderDate: '2026-10-08',
      deliveryDate: '2026-10-13',
      deliverTo: 'Dhaka HQ, Gulshan-2 (3rd floor, Sales)',
      terms: 'Payment within 30 days of the bill',
      lines: [
        { requisitionLineId: chairs.id, accountId: account('1210') },
        { requisitionLineId: tables.id, accountId: account('1210') },
      ],
    }),
  );
  await asUser(sujit, () => orders.issue(po.id));
  const chairLine = po.lines.find((l) =>
    l.description.startsWith('Office chair'),
  )!;
  await asUser(tanvir, () =>
    orders.receive(po.id, {
      receivedDate: '2026-10-12',
      note: '4 chairs today; 2 more and the tables next week',
      lines: [{ poLineId: chairLine.id, quantity: '4' }],
    }),
  );
  await asSystem(
    tenantId,
    () =>
      get(VendorBillsService).create(company.id, {
        vendorId: partex.id,
        billNo: 'PFIL/INV/7781',
        billDate: '2026-10-13',
        narration: 'Office chairs, purchase order ' + po.number,
        purchaseOrderId: po.id,
        lines: [
          {
            accountId: account('1210'),
            description: 'Office chair, mesh back',
            amount: '49800',
            vatPercent: '15',
            poLineId: chairLine.id,
            quantity: '6',
          },
        ],
      }),
    sujit,
  );

  // 2. a whiteboard: approved, waiting to be bought
  const board = await asUser(rafi, () =>
    requisitions.create(company.id, {
      title: 'Whiteboard for the sales room',
      justification: 'For the weekly target meeting',
      lines: [
        {
          description: 'Magnetic whiteboard, 4 x 3 ft',
          quantity: '1',
          unit: 'pcs',
          estimatedUnitPrice: '6500',
        },
      ],
    }),
  );
  const boardSent = await asUser(rafi, () => requisitions.submit(board.id));
  await decide(boardSent.approvalRequestId!, tanvir, 'OK');
  await decide(
    boardSent.approvalRequestId!,
    sujit,
    'Buy from Nawabpur, below the quotation limit',
  );

  // 3. toner: waiting for Tanvir
  const toner = await asUser(mitu, () =>
    requisitions.create(company.id, {
      title: 'Printer toner, Chattogram office',
      justification: 'The office printer is out of toner',
      lines: [
        {
          description: 'Toner cartridge, HP 85A',
          quantity: '2',
          unit: 'pcs',
          estimatedUnitPrice: '4500',
        },
      ],
    }),
  );
  await asUser(mitu, () => requisitions.submit(toner.id));
  console.log(
    `  demo procurement seeded: ${po.number} (Partex, 4 of 6 chairs received, a draft bill that does not match), a whiteboard to buy, toner waiting for Tanvir`,
  );
}

/**
 * WP18 budgets for 2026-27, prepared by Sujit and approved by Anisur:
 *  - the department of Rafi's furniture order: furniture Tk 1,00,000 (the Partex order
 *    commits Tk 73,400), stationery, travel; Tanvir asks to raise furniture to Tk 1,50,000
 *    (waiting for Anisur);
 *  - Head Office: rent, cleaning, stationery;
 *  - HR: a draft not sent yet.
 * Alerts are raised for lines already at 80 %. Idempotent: skipped once a budget exists.
 */
async function seedDemoBudgets(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const done = await asSystem(tenantId, () =>
    db.tx.selectFrom('budgets').select('id').executeTakeFirst(),
  );
  if (done) {
    console.log('  demo budgets already seeded');
    return;
  }
  const [sujit, anisur, tanvir] = [
    'sujit.das@demo.test',
    'anisur.rahman@demo.test',
    'tanvir.hossain@demo.test',
  ].map((e) => logins.get(e));
  const asUser = async <T>(
    userId: string | undefined,
    work: () => Promise<T>,
  ) => {
    const access = await asSystem(
      tenantId,
      () => get(AccessService).load(userId!),
      userId,
    );
    return db.withTenant({ tenantId, userId, access }, work);
  };
  const approvals = get(ApprovalsService);
  const budgets = get(BudgetsService);
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const lookup = await asSystem(tenantId, async () => {
    const accounts = await db.tx
      .selectFrom('accounts')
      .select(['id', 'code'])
      .where('company_id', '=', company.id)
      .execute();
    const departments = await db.tx
      .selectFrom('departments')
      .select(['id', 'code'])
      .where('company_id', '=', company.id)
      .execute();
    const furniture = await db.tx
      .selectFrom('purchase_requisitions')
      .select('department_id')
      .where('title', '=', 'Furniture for the new sales officers')
      .executeTakeFirst();
    return {
      account: (code: string) => accounts.find((a) => a.code === code)!.id,
      department: (code: string) =>
        departments.find((d) => d.code === code)!.id,
      salesDept: furniture?.department_id,
    };
  });

  const approved = async (
    departmentId: string,
    note: string,
    lines: Array<[string, string]>,
  ) => {
    const b = await asUser(sujit, () =>
      budgets.create(company.id, {
        fiscalYear: '2026-27',
        departmentId,
        note,
        lines: lines.map(([code, amount]) => ({
          accountId: lookup.account(code),
          amount,
        })),
      }),
    );
    const sent = await asUser(sujit, () => budgets.submit(b.id));
    await asUser(anisur, () =>
      approvals.decide(
        sent.approvalRequestId!,
        'approve',
        'As agreed in the budget meeting',
      ),
    );
    return b;
  };
  const sales = lookup.salesDept ?? lookup.department('SALES-DHK');
  const salesBudget = await approved(
    sales,
    'Board meeting, 28 September 2026',
    [
      ['1210', '100000'],
      ['5240', '30000'],
      ['5250', '120000'],
    ],
  );
  await approved(lookup.department('HO'), 'Board meeting, 28 September 2026', [
    ['5210', '1800000'],
    ['5275', '600000'],
    ['5240', '50000'],
  ]);
  await asUser(sujit, () =>
    budgets.create(company.id, {
      fiscalYear: '2026-27',
      departmentId: lookup.department('HR'),
      note: 'Draft: training figures still to come',
      lines: [{ accountId: lookup.account('5240'), amount: '40000' }],
    }),
  );

  // Tanvir asks for more furniture money: two more officers
  await asUser(tanvir, () =>
    budgets.requestRevision(salesBudget.id, {
      reason: 'Two more sales officers approved in October',
      lines: [{ accountId: lookup.account('1210'), amount: '150000' }],
    }),
  );

  const raised = await asSystem(tenantId, () => budgets.raiseAlerts());
  console.log(
    `  demo budgets seeded: 2 approved (2026-27), HR in draft, a change waiting for Anisur, ${raised} alert(s)`,
  );
}

/** WP19: fixed assets and the head office store (idempotent: skipped once an asset exists). */
async function seedDemoAssets(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const done = await asSystem(tenantId, () =>
    db.tx.selectFrom('assets').select('id').executeTakeFirst(),
  );
  if (done) {
    console.log('  demo assets already seeded');
    return;
  }
  const [rafi, mitu, tanvir, sujit, anisur] = [
    'rafi@demo.test',
    'mitu@demo.test',
    'tanvir.hossain@demo.test',
    'sujit.das@demo.test',
    'anisur.rahman@demo.test',
  ].map((e) => logins.get(e));
  const asUser = async <T>(
    userId: string | undefined,
    work: () => Promise<T>,
  ) => {
    const access = await asSystem(
      tenantId,
      () => get(AccessService).load(userId!),
      userId,
    );
    return db.withTenant({ tenantId, userId, access }, work);
  };
  const assets = get(AssetsService);
  const stock = get(StockService);
  const approvals = get(ApprovalsService);
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const lookup = await asSystem(tenantId, async () => {
    const departments = await db.tx
      .selectFrom('departments')
      .select(['id', 'code'])
      .where('company_id', '=', company.id)
      .execute();
    const people = await db.tx
      .selectFrom('users')
      .select(['email', 'employee_id'])
      .where('employee_id', 'is not', null)
      .execute();
    return {
      department: (code: string) =>
        departments.find((d) => d.code === code)?.id,
      employee: (email: string) =>
        people.find((u) => u.email === email)!.employee_id!,
    };
  });
  // the department Tanvir heads (Rafi's and Mitu's)
  const salesDept = await asSystem(
    tenantId,
    async () =>
      (
        await db.tx
          .selectFrom('departments')
          .select('id')
          .where(
            'head_employee_id',
            '=',
            lookup.employee('tanvir.hossain@demo.test'),
          )
          .executeTakeFirst()
      )?.id,
  );

  // books set up before WP19 get the disposal gain and loss accounts
  await asSystem(
    tenantId,
    () => get(LedgerSetupService).setUp(company.id),
    sujit,
  );
  const classes = await asUser(anisur, () =>
    assets.createDefaultClasses(company.id),
  );
  const cls = (code: string) => classes.find((c) => c.code === code)!.id;
  const add = (dto: Parameters<AssetsService['create']>[1]) =>
    asUser(anisur, () => assets.create(company.id, dto));

  const hiace = await add({
    classId: cls('VEH'),
    name: 'Toyota Hiace microbus (Dhaka Metro-Cha 15-4821)',
    serialNo: 'KDH201-0087342',
    inServiceDate: '2024-07-01',
    cost: '4200000',
    openingAccumulated: '1512000',
    openingAsOf: '2026-06-30',
    departmentId: salesDept,
    location: 'Head office car park, Tejgaon',
  });
  const laptopTanvir = await add({
    classId: cls('IT'),
    name: 'HP ProBook 450 G10 laptop',
    serialNo: '5CD3281KQZ',
    inServiceDate: '2026-07-01',
    cost: '98000',
    departmentId: salesDept,
    location: 'Head office',
  });
  const laptopRafi = await add({
    classId: cls('IT'),
    name: 'Lenovo ThinkPad E14 Gen 5 laptop',
    serialNo: 'PF4MZ2K7',
    inServiceDate: '2026-08-01',
    cost: '86500',
    departmentId: salesDept,
    location: 'Chattogram field office',
  });
  await add({
    classId: cls('IT'),
    name: 'Dell Latitude 3540 laptop (spare)',
    serialNo: 'HJ8T2X3',
    inServiceDate: '2026-09-01',
    cost: '79000',
    departmentId: lookup.department('HO'),
    location: 'Head office IT room',
  });
  await add({
    classId: cls('OFFEQ'),
    name: 'Walton WFC-3D8-GDEL refrigerator',
    serialNo: 'WLT-2608-55190',
    inServiceDate: '2026-08-10',
    cost: '48500',
    departmentId: lookup.department('HO'),
    location: 'Head office pantry',
  });
  await add({
    classId: cls('FURN'),
    name: 'Hatil executive desks (set of 4)',
    inServiceDate: '2026-07-15',
    cost: '112000',
    residualValue: '11200',
    departmentId: salesDept,
    location: 'Sales floor, Tejgaon',
  });

  await asUser(anisur, () =>
    assets.assign(laptopTanvir.id, {
      employeeId: lookup.employee('tanvir.hossain@demo.test'),
      assignedOn: '2026-07-01',
      note: 'With charger and laptop bag',
    }),
  );
  const given = await asUser(tanvir, () => assets.myAssets());
  await asUser(tanvir, () => assets.acknowledge(given[0].assignmentId));
  await asUser(anisur, () =>
    assets.assign(laptopRafi.id, {
      employeeId: lookup.employee('rafi@demo.test'),
      assignedOn: '2026-10-20',
      expectedReturn: '2027-10-19',
      note: 'For dealer visits in Chattogram',
    }),
  );
  await asUser(anisur, () =>
    assets.addMaintenance(hiace.id, {
      doneOn: '2026-09-14',
      kind: 'service',
      description:
        '20,000 km service at Navana Toyota, Tejgaon: engine oil, filters, brake pads',
      cost: '18750',
      nextDue: '2027-03-14',
    }),
  );

  for (const period of ['2026-07', '2026-08', '2026-09'])
    await asSystem(
      tenantId,
      () => assets.runDepreciation(company.id, period),
      sujit,
    );

  // the head office store
  const store = (await asUser(sujit, () =>
    stock.createStore(company.id, {
      code: 'HO',
      name: 'Head office store, Tejgaon',
      keeperEmployeeId: lookup.employee('farzana.akter@demo.test'),
    }),
  ))!;
  const item = async (
    code: string,
    name: string,
    nameBn: string,
    unit: string,
    reorderLevel: string,
  ) =>
    (
      await asUser(sujit, () =>
        stock.createItem(company.id, {
          code,
          name,
          nameBn,
          unit,
          reorderLevel,
        }),
      )
    ).id;
  const paper = await item(
    'A4-80',
    'A4 paper 80 gsm (Double A)',
    'এ৪ কাগজ ৮০ জিএসএম',
    'ream',
    '20',
  );
  const toner = await item(
    'TONER-85A',
    'HP 85A toner cartridge',
    'এইচপি ৮৫এ টোনার',
    'pcs',
    '3',
  );
  const files = await item(
    'FILE-BOX',
    'Box file (Matador)',
    'বক্স ফাইল',
    'pcs',
    '30',
  );
  const pens = await item(
    'PEN-MAT',
    'Matador ball pen (box of 12)',
    'মাতাডোর বলপেন (১২টির বক্স)',
    'box',
    '10',
  );
  await asUser(sujit, () =>
    stock.addMoves(store.id, {
      kind: 'opening',
      moveDate: '2026-07-01',
      note: 'Count on 1 July 2026',
      lines: [
        { itemId: paper, quantity: '18' },
        { itemId: toner, quantity: '2' },
        { itemId: files, quantity: '25' },
        { itemId: pens, quantity: '6' },
      ],
    }),
  );
  await asUser(sujit, () =>
    stock.addMoves(store.id, {
      kind: 'receipt',
      moveDate: '2026-10-12',
      reference: 'Karim Traders KT/2026/1301',
      lines: [
        { itemId: paper, quantity: '50' },
        { itemId: files, quantity: '40' },
        { itemId: pens, quantity: '12' },
      ],
    }),
  );
  await asUser(sujit, () =>
    stock.addMoves(store.id, {
      kind: 'adjustment',
      moveDate: '2026-10-15',
      note: 'Stock count: 2 reams damaged by water from the AC',
      lines: [{ itemId: paper, quantity: '-2' }],
    }),
  );

  const rafiAsks = await asUser(rafi, () =>
    stock.createRequest(company.id, {
      storeId: store.id,
      note: 'Dealer files for the Chattogram visit',
      lines: [
        { itemId: files, quantity: '10' },
        { itemId: paper, quantity: '2' },
        { itemId: toner, quantity: '1' },
      ],
    }),
  );
  await asSystem(
    tenantId,
    () => approvals.decide(rafiAsks.approvalRequestId!, 'approve', 'OK'),
    tanvir,
  );
  await asUser(sujit, () =>
    stock.issue(rafiAsks.id, {
      issueDate: '2026-10-22',
      lines: [
        { itemId: files, quantity: '10' },
        { itemId: paper, quantity: '2' },
      ],
    }),
  );
  await asUser(mitu, () =>
    stock.createRequest(company.id, {
      storeId: store.id,
      note: 'For the October sales report binders',
      lines: [
        { itemId: paper, quantity: '3' },
        { itemId: pens, quantity: '1' },
      ],
    }),
  );

  console.log(
    "  demo assets seeded: 6 assets (Rafi's laptop not yet confirmed), depreciation July-September, HO store; Rafi's request part-issued, Mitu's waiting for Tanvir",
  );
}

/** WP20: the bank account and an October statement made from the books (idempotent: skipped once a bank account exists). */
async function seedDemoBank(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const done = await asSystem(tenantId, () =>
    db.tx.selectFrom('company_bank_accounts').select('id').executeTakeFirst(),
  );
  if (done) {
    console.log('  demo bank already seeded');
    return;
  }
  const sujit = logins.get('sujit.das@demo.test');
  const asUser = async <T>(
    userId: string | undefined,
    work: () => Promise<T>,
  ) => {
    const access = await asSystem(
      tenantId,
      () => get(AccessService).load(userId!),
      userId,
    );
    return db.withTenant({ tenantId, userId, access }, work);
  };
  const bank = get(BankService);
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const owner = await asSystem(
    tenantId,
    async () =>
      (
        await db.tx
          .selectFrom('users')
          .select('id')
          .where('email', '=', 'admin@demo.test')
          .executeTakeFirstOrThrow()
      ).id,
  );

  // October's money through the bank: Sujit prepares, the owner (second Accounts user) approves
  const vouchers = get(VouchersService);
  const approvals = get(ApprovalsService);
  const codes = await asSystem(tenantId, async () => {
    const rows = await db.tx
      .selectFrom('accounts')
      .select(['id', 'code'])
      .where('company_id', '=', company.id)
      .execute();
    return (code: string) => rows.find((r) => r.code === code)!.id;
  });
  const post = async (
    type: 'receipt' | 'payment',
    date: string,
    narration: string,
    other: string,
    amount: string,
  ) => {
    const lines =
      type === 'receipt'
        ? [
            { accountId: codes('1130'), debit: amount },
            { accountId: codes(other), credit: amount },
          ]
        : [
            { accountId: codes(other), debit: amount },
            { accountId: codes('1130'), credit: amount },
          ];
    const draft = await asUser(sujit, () =>
      vouchers.create(company.id, {
        voucherType: type,
        voucherDate: date,
        narration,
        lines,
      }),
    );
    const sent = await asUser(sujit, () => vouchers.submit(draft.id));
    await asSystem(
      tenantId,
      () =>
        approvals.decide(
          sent.approvalRequestId!,
          'approve',
          'Checked with the bank slip',
        ),
      owner,
    );
  };
  await post(
    'receipt',
    '2026-10-02',
    'Meghna Dealers Chattogram, September invoices',
    '4100',
    '150000',
  );
  await post(
    'receipt',
    '2026-10-05',
    'Sylhet Agro dealer, cash sale',
    '4100',
    '30000',
  );
  await post(
    'receipt',
    '2026-10-05',
    'Bogura Traders dealer, cash sale',
    '4100',
    '20000',
  );
  await post(
    'payment',
    '2026-10-08',
    'Link3 Technologies, October internet, cheque 7712044',
    '5230',
    '23000',
  );
  await post('receipt', '2026-10-20', 'Rahim Traders, Mirpur', '4100', '5000');
  await post('receipt', '2026-10-20', 'Karim Stores, Uttara', '4100', '5000');

  const ledger = await asSystem(tenantId, async () => {
    const account = await db.tx
      .selectFrom('accounts')
      .select('id')
      .where('company_id', '=', company.id)
      .where('code', '=', '1130')
      .executeTakeFirstOrThrow();
    // the balance the bank also had on 30 September (everything before October has cleared)
    const opening = await db.tx
      .selectFrom('voucher_lines as vl')
      .innerJoin('vouchers as v', 'v.id', 'vl.voucher_id')
      .select(sql<string>`coalesce(sum(vl.debit - vl.credit), 0)::text`.as('b'))
      .where('vl.account_id', '=', account.id)
      .where('v.state', '=', 'posted')
      .where('v.voucher_date', '<', '2026-10-01')
      .executeTakeFirstOrThrow();
    return { accountId: account.id, opening: opening.b };
  });

  const b = await asUser(sujit, () =>
    bank.createAccount(company.id, {
      accountId: ledger.accountId,
      bankName: 'Dutch-Bangla Bank PLC',
      branch: 'Tejgaon Industrial Area',
      accountName: 'Demo Trading Ltd',
      accountNo: '1101100023456',
      statementFormat: 'dbbl',
      reconcileFrom: '2026-10-01',
      openingBankBalance: Money.of(ledger.opening).round().toDb(),
    }),
  );

  // the statement as the bank would send it, from October's postings up to the 25th
  const october = (
    await asUser(sujit, () =>
      bank.ledgerLines(b.id, {
        state: 'all',
        from: '2026-10-01',
        to: '2026-10-25',
      }),
    )
  ).sort((x, y) => x.date.localeCompare(y.date));
  const lastPayment = october
    .filter((l) => Money.of(l.amount).isNegative())
    .at(-1);
  const shift = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const out = d.toISOString().slice(0, 10);
    return out > '2026-10-25' ? '2026-10-25' : out;
  };
  const upper = (text: string) =>
    text
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
  const rows: Array<{
    date: string;
    text: string;
    cheque: string;
    amount: Money;
  }> = [];
  for (const l of october) {
    // the last cheque is not presented yet; Rahim Traders' money is not in the bank yet;
    // the two dealers were banked together (below)
    if (
      l.id === lastPayment?.id ||
      /Rahim Traders|Sylhet Agro|Bogura Traders/.test(l.narration)
    )
      continue;
    const amount = Money.of(l.amount);
    // the link3 cheque's number is in the narration (no vendor payment behind it)
    const cheque = l.reference ?? /cheque (\d+)/.exec(l.narration)?.[1] ?? null;
    if (amount.isNegative() && cheque) {
      rows.push({
        date: shift(l.date, 3),
        text: `CLG CHQ PAID ${upper(l.narration.split(',')[0])}`,
        cheque,
        amount,
      });
      continue;
    }
    if (amount.isNegative())
      rows.push({
        date: shift(l.date, l.reference ? 3 : 0),
        text: l.reference
          ? `CLG CHQ PAID ${upper(l.narration)}`
          : `BEFTN DEBIT ${upper(l.narration)}`,
        cheque: l.reference ?? '',
        amount,
      });
    else
      rows.push({
        date: shift(l.date, 1),
        text: `NPSB CREDIT ${upper(l.narration)}`,
        cheque: '',
        amount,
      });
  }
  rows.push({
    date: '2026-10-06',
    text: 'CASH DEPOSIT GULSHAN BR SYLHET AGRO BOGURA TRADERS',
    cheque: '',
    amount: Money.of('50000'),
  });
  rows.push({
    date: '2026-10-15',
    text: 'SMS ALERT CHARGE Q3 INCL VAT',
    cheque: '',
    amount: Money.of('-115'),
  });
  rows.push({
    date: '2026-10-25',
    text: 'INTEREST CREDIT SND OCT-26',
    cheque: '',
    amount: Money.of('842.50'),
  });
  rows.sort((x, y) => x.date.localeCompare(y.date));
  let balance = Money.of(ledger.opening).round();
  const ddmmyyyy = (d: string) =>
    `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const csvAmount = (m: Money) => `"${m.toDb()}"`;
  const lines = rows.map((r) => {
    balance = balance.plus(r.amount);
    const debit = r.amount.isNegative() ? csvAmount(r.amount.negate()) : '';
    const credit = r.amount.isPositive() ? csvAmount(r.amount) : '';
    return [
      ddmmyyyy(r.date),
      ddmmyyyy(r.date),
      `"${r.text}"`,
      r.cheque,
      debit,
      credit,
      csvAmount(balance),
    ].join(',');
  });
  const csv = [
    'Dutch-Bangla Bank PLC,Tejgaon Industrial Area Branch',
    'Statement of account,Demo Trading Ltd,1101100023456',
    'Period,01/10/2026 to 25/10/2026',
    '',
    'Txn Date,Value Date,Particulars,Cheque No,Debit,Credit,Balance',
    ...lines,
  ].join('\r\n');
  const result = await asUser(sujit, () =>
    bank.importStatement(
      b.id,
      { name: 'DBBL-1101100023456-OCT-2026.csv', content: csv },
      'upload',
    ),
  );
  console.log(
    `  demo bank seeded: DBBL 1130 from 1 October, ${result.imported} statement lines, ${result.autoMatched} matched by the rules`,
  );
}

/** WP21: VAT items, October VAT invoices, September's return and the calendar (idempotent: skipped once a VAT item exists). */
async function seedDemoVat(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const done = await asSystem(tenantId, () =>
    db.tx.selectFrom('vat_items').select('id').executeTakeFirst(),
  );
  if (done) {
    console.log('  demo VAT already seeded');
    return;
  }
  const sujit = logins.get('sujit.das@demo.test');
  const asUser = async <T>(
    userId: string | undefined,
    work: () => Promise<T>,
  ) => {
    const access = await asSystem(
      tenantId,
      () => get(AccessService).load(userId!),
      userId,
    );
    return db.withTenant({ tenantId, userId, access }, work);
  };
  const vat = get(VatService);
  const approvals = get(ApprovalsService);
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const owner = await asSystem(
    tenantId,
    async () =>
      (
        await db.tx
          .selectFrom('users')
          .select('id')
          .where('email', '=', 'admin@demo.test')
          .executeTakeFirstOrThrow()
      ).id,
  );
  const bank = await asSystem(
    tenantId,
    async () =>
      (
        await db.tx
          .selectFrom('accounts')
          .select('id')
          .where('company_id', '=', company.id)
          .where('code', '=', '1130')
          .executeTakeFirstOrThrow()
      ).id,
  );

  // books set up before WP21 get the VAT posting accounts (output VAT, sales)
  await asSystem(
    tenantId,
    () => get(LedgerSetupService).setUp(company.id),
    sujit,
  );
  const items = await asUser(sujit, () =>
    vat.createDefaultItems(company.id, '2026-27'),
  );
  const item = (code: string) => items.find((i) => i.code === code)!.id;

  const sale = async (
    dto: Parameters<VatService['createSale']>[1],
    approve: boolean,
  ) => {
    const s = await asUser(sujit, () => vat.createSale(company.id, dto));
    if (approve)
      await asSystem(
        tenantId,
        () =>
          approvals.decide(
            s.approvalRequestId!,
            'approve',
            'Checked with the delivery challan',
          ),
        owner,
      );
  };
  await sale(
    {
      invoiceDate: '2026-10-08',
      customerName: 'Meghna Dealers, Chattogram',
      customerAddress: 'Khatunganj, Chattogram',
      receivedIntoAccountId: bank,
      lines: [
        {
          itemId: item('TRADE-5'),
          description: 'Rice bran oil, 5 L cans',
          quantity: '120',
          value: '84000',
        },
      ],
    },
    true,
  );
  await sale(
    {
      invoiceDate: '2026-10-14',
      customerName: 'Sylhet Agro Ltd',
      customerBin: '000456789-0201',
      customerAddress: 'Zindabazar, Sylhet',
      receivedIntoAccountId: bank,
      lines: [
        {
          itemId: item('GOODS-STD'),
          description: 'Mustard oil, 1 L bottles',
          quantity: '1500',
          value: '150000',
        },
        {
          itemId: item('GOODS-STD'),
          description: 'Delivery to Sylhet depot',
          value: '6000',
        },
      ],
      vdsByCustomer: '3510',
      vdsCertificateNo: 'M6.6-SA-2026-1014',
    },
    true,
  );
  await sale(
    {
      invoiceDate: '2026-10-27',
      customerName: 'Bogura Traders',
      receivedIntoAccountId: bank,
      lines: [
        {
          itemId: item('TRADE-5'),
          description: 'Rice bran oil, 5 L cans',
          quantity: '40',
          value: '28000',
        },
      ],
    },
    false,
  );

  // September's return: nothing sold or bought with VAT (a nil return)
  const filed = await asUser(sujit, () =>
    get(VatReturnsService).file(company.id, {
      period: '2026-09',
      submittedOn: '2026-10-12',
      submissionRef: 'NBR-ERET-2610-10233',
    }),
  );

  // the calendar: the trade licence renewed; the fire licence still to do
  const compliance = get(ComplianceService);
  const calendar = await asUser(sujit, () => compliance.list(company.id, {}));
  const licence = calendar.find((i) => i.kind === 'trade_licence');
  if (licence)
    await asUser(sujit, () =>
      compliance.close(licence.id, {
        state: 'done',
        doneOn: '2026-09-21',
        evidence: 'Renewed: DNCC trade licence TRAD/DNCC/045812/2026',
      }),
    );
  await asUser(sujit, () =>
    compliance.add(company.id, {
      title: 'Fire licence renewal (Fire Service and Civil Defence)',
      dueDate: '2026-12-31',
      note: 'Tejgaon warehouse',
    }),
  );
  console.log(
    `  demo VAT seeded: ${items.length} items, 3 October invoices (one waiting for the owner), September return ${filed.period} filed, calendar ready`,
  );
}

/** WP22: the pilot company's Gate 2, start to finish (idempotent: skipped once the pilot company exists). */
async function seedDemoGate2(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const existing = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Meghna Agro Industries Ltd')
      .executeTakeFirst(),
  );
  const done =
    existing &&
    (await asSystem(tenantId, () =>
      db.tx
        .selectFrom('old_system_comparisons')
        .select('id')
        .where('company_id', '=', existing.id)
        .executeTakeFirst(),
    ));
  if (done) {
    console.log('  demo Gate 2 already seeded');
    return;
  }
  const [sujit, anisur] = [
    'sujit.das@demo.test',
    'anisur.rahman@demo.test',
  ].map((e) => logins.get(e));
  const owner = await asSystem(
    tenantId,
    async () =>
      (
        await db.tx
          .selectFrom('users')
          .select('id')
          .where('email', '=', 'admin@demo.test')
          .executeTakeFirstOrThrow()
      ).id,
  );
  const asUser = async <T>(
    userId: string | undefined,
    work: () => Promise<T>,
  ) => {
    const access = await asSystem(
      tenantId,
      () => get(AccessService).load(userId!),
      userId,
    );
    return db.withTenant({ tenantId, userId, access }, work);
  };
  const approvals = get(ApprovalsService);
  /** The owner checks (second Accounts user); Anisur approves what is above the voucher limit. */
  const decide = async (requestId: string) => {
    const state = async () =>
      await asSystem(tenantId, () =>
        db.tx
          .selectFrom('approval_requests')
          .select(['state', 'current_step'])
          .where('id', '=', requestId)
          .executeTakeFirstOrThrow(),
      );
    if ((await state()).current_step === 1)
      await asUser(owner, () =>
        approvals.decide(
          requestId,
          'approve',
          'Checked against the Tally printout',
        ),
      );
    if ((await state()).state === 'in_approval')
      await asUser(anisur, () =>
        approvals.decide(
          requestId,
          'approve',
          'Opening balances as signed by the auditor',
        ),
      );
  };

  // the pilot company, its books from 1 October, Sujit and Anisur working in it
  // (an earlier run that stopped part-way left the company: carry on with it)
  const company =
    existing ??
    (await asSystem(tenantId, () =>
      get(CompaniesService).createCompany({
        legalName: 'Meghna Agro Industries Ltd',
        shortName: 'MAIL',
        employeeCodePrefix: 'MAI',
        tin: '456789012345',
        bin: '000456789-0101',
      }),
    ));
  if (!existing) {
    await asSystem(tenantId, () =>
      db.tx
        .insertInto('user_roles')
        .values([
          {
            user_id: sujit!,
            system_role: 'accounts',
            scope_type: 'company',
            scope_id: company.id,
          },
          {
            user_id: anisur!,
            system_role: 'admin',
            scope_type: 'company',
            scope_id: company.id,
          },
        ])
        .execute(),
    );
  }
  await asSystem(
    tenantId,
    () => get(LedgerSetupService).setUp(company.id, '2026-10-01'),
    sujit,
  );
  const karim = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('vendors')
      .select('id')
      .where('company_id', '=', company.id)
      .where('code', '=', 'KARIM')
      .executeTakeFirst(),
  );
  if (!karim)
    await asUser(sujit, () =>
      get(VendorsService).create(company.id, {
        code: 'KARIM',
        name: 'Karim Traders, Nawabpur Road',
        tin: '345678901234',
        bin: '000345678-0103',
        withholdingCategory: 'SUPPLY',
      }),
    );
  const account = await asSystem(tenantId, async () => {
    const rows = await db.tx
      .selectFrom('accounts')
      .select(['id', 'code'])
      .where('company_id', '=', company.id)
      .execute();
    return (code: string) => rows.find((r) => r.code === code)!.id;
  });

  // Tally's trial balance at 30 September becomes the opening voucher
  const imported = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('opening_balance_imports as i')
      .innerJoin('vouchers as v', 'v.id', 'i.voucher_id')
      .select(['i.state', 'v.approval_request_id'])
      .where('i.company_id', '=', company.id)
      .where('i.state', '<>', 'cancelled')
      .executeTakeFirst(),
  );
  if (!imported) {
    const opening = await asUser(sujit, () =>
      get(OpeningBalancesService).import(
        company.id,
        {
          name: 'meghna-agro-tally-tb-2026-09-30.csv',
          content: readFileSync(
            'samples/finance/meghna-agro-tally-tb-2026-09-30.csv',
            'utf8',
          ),
        },
        '2026-10-01',
      ),
    );
    await decide(opening.approvalRequestId!);
  } else if (imported.state === 'in_approval')
    await decide(imported.approval_request_id!);

  // October
  const vouchers = get(VouchersService);
  const post = async (
    type: 'payment' | 'receipt',
    date: string,
    narration: string,
    lines: Array<{ accountId: string; debit?: string; credit?: string }>,
  ) => {
    const draft = await asUser(sujit, () =>
      vouchers.create(company.id, {
        voucherType: type,
        voucherDate: date,
        narration,
        lines,
      }),
    );
    const sent = await asUser(sujit, () => vouchers.submit(draft.id));
    await decide(sent.approvalRequestId!);
  };
  const october = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('vouchers')
      .select('id')
      .where('company_id', '=', company.id)
      .where('is_opening', '=', false)
      .executeTakeFirst(),
  );
  if (!october) {
    await post('payment', '2026-10-05', 'Office rent, October 2026, Tejgaon', [
      { accountId: account('5210'), debit: '85000' },
      { accountId: account('1130'), credit: '85000' },
    ]);
    await post(
      'receipt',
      '2026-10-15',
      'Cash sale: rice bran oil to walk-in dealers',
      [
        { accountId: account('1130'), debit: '200000' },
        { accountId: account('4100'), credit: '200000' },
      ],
    );
    const receivables = get(ReceivablesService);
    const bogura = (
      await asUser(sujit, () => receivables.list(company.id, true))
    ).find((i) => i.customerName === 'Bogura Traders')!;
    const receipt = await asUser(sujit, () =>
      receivables.receipt(bogura.id, {
        receiptDate: '2026-10-20',
        amount: '45000',
        receivedIntoAccountId: account('1130'),
        reference: 'NPSB 1020-88412',
      }),
    );
    await decide(receipt.approvalRequestId!);
  }

  // October closed through the checklist
  const close = get(MonthCloseService);
  const notes: Record<string, string> = {
    accruals: 'No accruals: DESCO and audit fee billed in October',
    prepayments: 'None this month',
    petty_cash: 'Counted Tk 25,000 on 31 October with the cashier; agrees',
    asset_additions: 'No asset bought in October',
  };
  const october31 = await asUser(sujit, () =>
    close.checklist(company.id, '2026-10'),
  );
  if (october31.state === 'open') {
    for (const [key, note] of Object.entries(notes))
      await asUser(sujit, () => close.tick(company.id, '2026-10', key, note));
    await asUser(sujit, () => close.close(company.id, '2026-10'));
  }

  // Tally at 31 October: two new accounts mapped, the first export off by the rent, the second agrees
  const gate = get(Gate2Service);
  await asUser(sujit, () =>
    gate.map(company.id, {
      oldCode: 'EXP-RENT',
      oldName: 'Office rent',
      accountId: account('5210'),
    }),
  );
  await asUser(sujit, () =>
    gate.map(company.id, {
      oldCode: 'INC-SALES',
      oldName: 'Sales - local',
      accountId: account('4100'),
    }),
  );
  for (const v of ['v1', 'v2']) {
    const name = `meghna-agro-tally-tb-2026-10-31-${v}.csv`;
    await asUser(sujit, () =>
      gate.compare(
        company.id,
        { name, content: readFileSync(`samples/finance/${name}`, 'utf8') },
        '2026-10-31',
        v === 'v2'
          ? 'Tally rent voucher corrected by the old accountant (85,500 -> 85,000)'
          : undefined,
      ),
    );
  }
  const report = await asUser(sujit, () => gate.report(company.id));
  console.log(
    `  demo Gate 2 seeded: Meghna Agro Industries Ltd, October closed, Tally agrees -> Gate 2 ${report.passed ? 'PASSED' : 'not passed'}`,
  );
}

/** Phase 3 WP23: salespeople, a territory, leads and customers (idempotent: skipped once the demo company has a lead). */
async function seedDemoCrm(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const done = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('leads')
      .select('id')
      .where('company_id', '=', company.id)
      .executeTakeFirst(),
  );
  if (done) {
    console.log('  demo CRM already seeded');
    return;
  }
  const [rafi, mitu, sujit, anisur] = [
    'rafi@demo.test',
    'mitu@demo.test',
    'sujit.das@demo.test',
    'anisur.rahman@demo.test',
  ].map((e) => logins.get(e)!);
  const asUser = async <T>(userId: string, work: () => Promise<T>) => {
    const access = await asSystem(
      tenantId,
      () => get(AccessService).load(userId),
      userId,
    );
    return db.withTenant({ tenantId, userId, access }, work);
  };
  // Rafi and Mitu sell (they stay employees too)
  await asSystem(tenantId, async () => {
    for (const userId of [rafi, mitu]) {
      const has = await db.tx
        .selectFrom('user_roles')
        .select('id')
        .where('user_id', '=', userId)
        .where('system_role', '=', 'sales')
        .where('revoked_at', 'is', null)
        .executeTakeFirst();
      if (!has)
        await db.tx
          .insertInto('user_roles')
          .values({
            user_id: userId,
            system_role: 'sales',
            scope_type: 'own',
            scope_id: null,
          })
          .execute();
    }
  });
  await asUser(anisur, () =>
    get(TerritoriesService).create(company.id, {
      code: 'CTG',
      name: 'Chattogram division',
      districts: ['Chattogram', "Cox's Bazar", 'Cumilla', 'Feni'],
      memberIds: [rafi],
    }),
  );

  // leads from outside, as n8n sends them
  const leads = get(LeadsService);
  const capture = (dto: Parameters<LeadsService['capture']>[1]) =>
    asSystem(tenantId, () => leads.capture(company.id, dto));
  const nasrin = await capture({
    source: 'facebook',
    externalRef: 'leadgen:1203948571',
    name: 'Nasrin Akter',
    organisation: 'Nasrin Traders, Khatunganj',
    phone: '01819-445566',
    district: 'Chattogram',
    sourceDetail: 'Eid campaign 2026',
    message: 'Dealer price for 5 L rice bran oil? We sell 300 cans a month.',
  });
  await capture({
    source: 'web_form',
    externalRef: 'form:2026-10-27-001',
    name: 'Rezaul Karim',
    organisation: 'Gazipur Super Shop',
    phone: '01711-908070',
    district: 'Gazipur',
    message: 'Need mustard oil 1 L, 500 bottles every month',
  });
  await capture({
    source: 'web_form',
    externalRef: 'form:2026-10-28-004',
    name: 'Shirin Sultana',
    organisation: 'Hotel Shuktara, Sylhet',
    email: 'purchase@shuktara-sylhet.com',
    district: 'Sylhet',
    message: 'Quotation for kitchen oil, 12 months contract',
  });
  const student = await capture({
    source: 'web_form',
    externalRef: 'form:2026-10-29-002',
    name: 'Tanjim Ahmed',
    phone: '01911-334455',
    district: 'Dhaka',
    message: 'University assignment on edible oil market',
  });
  // the same Facebook enquirer writes on the website too
  await capture({
    source: 'web_form',
    externalRef: 'form:2026-10-29-007',
    name: 'Nasrin',
    phone: '+8801819445566',
    message: 'Please call after Asr prayer',
  });

  // a walk-in at the Tejgaon office, qualified into a customer
  const karim = await asUser(rafi, () =>
    leads.create(company.id, {
      name: 'Abdul Karim',
      organisation: 'Karim Stores',
      phone: '01711-223344',
      email: 'karim.stores@gmail.com',
      district: 'Dhaka',
      source: 'walk_in',
      message: '200 cans a month for his two shops in Uttara',
    }),
  );
  await asUser(rafi, () =>
    leads.addActivity(
      { leadId: karim.id },
      {
        kind: 'meeting',
        subject: 'Met at Tejgaon office',
        body: 'Wants 30 days credit; pays by bKash or cheque',
      },
    ),
  );
  await asUser(rafi, () =>
    leads.qualify(karim.id, {
      customer: {
        kind: 'company',
        name: 'Karim Stores',
        customerType: 'retail',
        address: 'House 12, Road 7, Sector 7, Uttara, Dhaka',
      },
    }),
  );
  const studentOwner = (
    await asSystem(tenantId, () => leads.find(student.leadId!))
  ).owner_id;
  await asUser(studentOwner, () =>
    leads.disqualify(student.leadId!, 'Student assignment, not a buyer'),
  );
  if (nasrin.leadId) {
    await asUser(rafi, () =>
      leads.addActivity(
        { leadId: nasrin.leadId! },
        {
          kind: 'call',
          subject: 'Called Nasrin: sending the dealer price list',
          body: 'Visit planned next week with the Chattogram distributor',
        },
      ),
    );
    await asUser(rafi, () =>
      leads.addActivity(
        { leadId: nasrin.leadId! },
        {
          kind: 'task',
          subject: 'Send the dealer price list (5 L cans)',
          dueOn: '2026-10-28',
        },
      ),
    );
    await asUser(rafi, () =>
      leads.addActivity(
        { leadId: nasrin.leadId! },
        {
          kind: 'task',
          subject: 'Visit Khatunganj with the distributor',
          dueOn: '2026-11-04',
        },
      ),
    );
  }

  // the dealers we sell to already, with Accounts' credit terms
  const customers = get(CustomersService);
  const add = async (
    managerId: string,
    dto: Parameters<CustomersService['create']>[1],
    credit: { creditLimit: string; paymentTermsDays: number },
  ) => {
    const c = await asUser(managerId, () => customers.create(company.id, dto));
    await asUser(sujit, () =>
      customers.credit(c.id, { version: c.version, ...credit }),
    );
  };
  await add(
    rafi,
    {
      kind: 'company',
      name: 'Meghna Dealers',
      customerType: 'dealer',
      bin: '000234567-0201',
      phone: '031-2852211',
      address: 'Khatunganj, Chattogram',
      district: 'Chattogram',
    },
    { creditLimit: '500000', paymentTermsDays: 30 },
  );
  await add(
    mitu,
    {
      kind: 'company',
      name: 'Sylhet Agro Ltd',
      customerType: 'corporate',
      bin: '000456789-0201',
      email: 'accounts@sylhetagro.com.bd',
      address: 'Zindabazar, Sylhet',
      district: 'Sylhet',
    },
    { creditLimit: '300000', paymentTermsDays: 45 },
  );
  await add(
    mitu,
    {
      kind: 'company',
      name: 'Bogura Traders',
      customerType: 'dealer',
      phone: '01712-556600',
      address: 'Satmatha, Bogura',
      district: 'Bogura',
    },
    { creditLimit: '150000', paymentTermsDays: 15 },
  );
  console.log(
    "  demo CRM seeded: Rafi and Mitu sell (territory CTG is Rafi's), 6 leads (one became Karim Stores, one disqualified), 4 customers with credit terms",
  );
}

/** Every run: the demo books get template accounts and posting keys added since (e.g. the PF fund keys, 2026-10-30). Idempotent. */
async function ensureDemoBooks(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const sujit = logins.get('sujit.das@demo.test')!;
  const access = await asSystem(
    tenantId,
    () => get(AccessService).load(sujit),
    sujit,
  );
  const status = await db.withTenant({ tenantId, userId: sujit, access }, () =>
    get(LedgerSetupService).setUp(company.id),
  );
  console.log(
    `  demo books up to date (${status.missingPostingAccounts.length} posting keys missing)`,
  );

  // a PF member to show the fund on (2026-10-30): Tanvir's balance brought from the old payroll
  const tanvir = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('employees')
      .select('id')
      .where('company_id', '=', company.id)
      .where('full_name_en', '=', 'Tanvir Hossain')
      .executeTakeFirst(),
  );
  if (tanvir) {
    await asSystem(tenantId, () =>
      db.tx
        .insertInto('pf_openings')
        .values({
          employee_id: tanvir.id,
          as_of: '2026-06-30',
          employee_part: '96000',
          employer_part: '96000',
          note: 'Brought from the old payroll (June 2026 PF register)',
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'employee_id']).doNothing(),
        )
        .execute(),
    );
  }
}

/** 2026-10-31: the oils are kept in a finished-goods depot, so delivery takes stock (idempotent: skipped once the products name a stock item). */
async function seedDemoSalesStock(
  _get: Get,
  tenantId: string,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  await asSystem(tenantId, async () => {
    const company = await db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow();
    const products = await db.tx
      .selectFrom('products')
      .select(['id', 'code', 'name', 'name_bn', 'unit', 'stock_item_id'])
      .where('company_id', '=', company.id)
      .execute();
    if (!products.length || products.some((p) => p.stock_item_id)) {
      console.log('  demo sales stock already seeded');
      return;
    }
    const store = await db.tx
      .insertInto('stores')
      .values({
        company_id: company.id,
        code: 'FG-CTG',
        name: 'Finished goods depot, Sagarika Road, Chattogram',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const opening: Record<string, string> = {
      'RBO-5L': '480',
      'SOY-1L': '9000',
      'MUS-500': '3600',
    };
    for (const p of products) {
      const item = await db.tx
        .insertInto('stock_items')
        .values({
          company_id: company.id,
          code: `FG-${p.code}`,
          name: p.name,
          name_bn: p.name_bn,
          unit: p.unit,
          reorder_level: p.unit === 'can' ? '100' : '1000',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db.tx
        .updateTable('products')
        .set({ stock_item_id: item.id })
        .where('id', '=', p.id)
        .execute();
      if (opening[p.code])
        await db.tx
          .insertInto('stock_moves')
          .values({
            store_id: store.id,
            item_id: item.id,
            move_date: '2026-10-01',
            kind: 'opening',
            quantity: opening[p.code],
            reference: 'Stock count at cut-over',
          })
          .execute();
    }
    console.log('  demo sales stock seeded: depot FG-CTG with the three oils');
  });
}

/** Phase 3 WP25-WP27: products, prices, limits; quotations, orders, invoices and a receipt in every state (idempotent: skipped once the demo company has a product). */
async function seedDemoSales(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const done = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('products')
      .select('id')
      .where('company_id', '=', company.id)
      .executeTakeFirst(),
  );
  if (done) {
    console.log('  demo sales already seeded');
    return;
  }
  const [rafi, mitu, sujit] = [
    'rafi@demo.test',
    'mitu@demo.test',
    'sujit.das@demo.test',
  ].map((e) => logins.get(e)!);
  const owner = await asSystem(
    tenantId,
    async () =>
      (
        await db.tx
          .selectFrom('users')
          .select('id')
          .where('email', '=', 'admin@demo.test')
          .executeTakeFirstOrThrow()
      ).id,
  );
  const asUser = async <T>(userId: string, work: () => Promise<T>) => {
    const access = await asSystem(
      tenantId,
      () => get(AccessService).load(userId),
      userId,
    );
    return db.withTenant({ tenantId, userId, access }, work);
  };
  // the chart gets the customer advances account (2105) and the new posting keys
  await asUser(sujit, () => get(LedgerSetupService).setUp(company.id));
  const ids = await asSystem(tenantId, async () => ({
    goods: (
      await db.tx
        .selectFrom('vat_items')
        .select('id')
        .where('company_id', '=', company.id)
        .where('code', '=', 'GOODS-STD')
        .executeTakeFirstOrThrow()
    ).id,
    bank: (
      await db.tx
        .selectFrom('accounts')
        .select('id')
        .where('company_id', '=', company.id)
        .where('code', '=', '1130')
        .executeTakeFirstOrThrow()
    ).id,
  }));
  const customer = async (name: string) =>
    (
      await asSystem(tenantId, () =>
        db.tx
          .selectFrom('customers')
          .select('id')
          .where('company_id', '=', company.id)
          .where('name', '=', name)
          .executeTakeFirstOrThrow(),
      )
    ).id;

  const catalogue = get(CatalogueService);
  const product: Record<string, string> = {};
  for (const [code, name, nameBn, unit] of [
    ['RBO-5L', 'Rice bran oil 5 L can', 'রাইস ব্রান তেল ৫ লিটার ক্যান', 'can'],
    ['SOY-1L', 'Soybean oil 1 L bottle', 'সয়াবিন তেল ১ লিটার বোতল', 'bottle'],
    [
      'MUS-500',
      'Mustard oil 500 ml bottle',
      'সরিষার তেল ৫০০ মিলি বোতল',
      'bottle',
    ],
  ]) {
    product[code] = (
      await asUser(sujit, () =>
        catalogue.createProduct(company.id, {
          code,
          name,
          nameBn,
          unit,
          vatItemId: ids.goods,
        }),
      )
    ).id;
  }
  await asUser(sujit, () =>
    catalogue.createPriceList(company.id, {
      name: 'Prices 2026-27',
      fiscalYear: '2026-27',
      prices: [
        { productId: product['RBO-5L'], unitPrice: '1850' },
        { productId: product['SOY-1L'], unitPrice: '185' },
        { productId: product['MUS-500'], unitPrice: '125' },
      ],
    }),
  );
  await asUser(sujit, () =>
    catalogue.createPriceList(company.id, {
      name: 'Dealer prices 2026-27',
      fiscalYear: '2026-27',
      customerType: 'dealer',
      prices: [
        { productId: product['RBO-5L'], unitPrice: '1780' },
        { productId: product['SOY-1L'], unitPrice: '178' },
        { productId: product['MUS-500'], unitPrice: '118' },
      ],
    }),
  );
  await asUser(sujit, () =>
    catalogue.setDiscountLimits(company.id, {
      limits: [
        { maxPercent: '3' },
        { userId: rafi, maxPercent: '5' },
        { userId: mitu, maxPercent: '5' },
      ],
    }),
  );

  const quotes = get(QuotationsService);
  const orders = get(OrdersService);
  const invoices = get(InvoicesService);
  const approvals = get(ApprovalsService);
  type Q = { id: string; version: number };
  const step = async (who: string, q: Q, action: 'submit' | 'send') =>
    asUser(who, () => quotes[action](q.id, { version: q.version }));

  // Karim Stores came in as a lead (WP23) without credit terms: Accounts gives it Tk 5 lakh, 30 days
  const karimRow = await asSystem(tenantId, async () =>
    get(CustomersService).find(await customer('Karim Stores')),
  );
  if (Number(karimRow.credit_limit) === 0)
    await asUser(sujit, () =>
      get(CustomersService).credit(karimRow.id, {
        version: karimRow.version,
        creditLimit: '500000',
        paymentTermsDays: 30,
      }),
    );

  // Karim Stores (Rafi): accepted, delivered, invoiced; part paid by cheque
  let karim: Q & { order?: { id: string } | null } = await asUser(
    rafi,
    async () =>
      quotes.create(company.id, {
        customerId: await customer('Karim Stores'),
        validUntil: '2026-11-15',
        language: 'bn',
        terms:
          'Delivery to the Uttara shops within 3 days; payment by cheque within 30 days',
        lines: [
          {
            productId: product['RBO-5L'],
            quantity: '200',
            discountPercent: '4',
          },
        ],
      }),
  );
  karim = await step(rafi, karim, 'submit');
  karim = await step(rafi, karim, 'send');
  karim = await asUser(rafi, () =>
    quotes.accept(karim.id, {
      version: karim.version,
      customerRef: 'KS/PO/112',
    }),
  );
  let order = await asSystem(tenantId, () => orders.find(karim.order!.id));
  await asUser(rafi, () =>
    orders.deliver(order.id, {
      version: order.version,
      challanNo: 'DC-2026-0041',
    }),
  );
  const karimInvoice = await asUser(sujit, () =>
    invoices.invoice(order.id, {}),
  );
  const receipt = await asUser(sujit, async () =>
    get(ReceiptsService).create(company.id, {
      customerId: await customer('Karim Stores'),
      receiptDate: karimInvoice.invoiceDate,
      method: 'cheque',
      chequeNo: 'CA-5512093',
      chequeBank: 'Dutch-Bangla Bank, Uttara',
      receivedIntoAccountId: ids.bank,
      amount: '200000',
      allocations: [{ itemId: karimInvoice.itemId, amount: '200000' }],
    }),
  );
  await asUser(owner, () =>
    approvals.decide(
      receipt.voucher!.approvalRequestId!,
      'approve',
      'Cheque deposited',
    ),
  );

  // Meghna Dealers (Rafi): the Eid quotation at 8% off, above his limit: waiting for Tanvir
  const eid = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('opportunities')
      .select('id')
      .where('company_id', '=', company.id)
      .where('title', '=', 'Soybean oil 1 L, Eid stock')
      .executeTakeFirstOrThrow(),
  );
  let meghna: Q = await asUser(rafi, async () =>
    quotes.create(company.id, {
      customerId: await customer('Meghna Dealers'),
      opportunityId: eid.id,
      validUntil: '2026-11-20',
      lines: [
        {
          productId: product['SOY-1L'],
          quantity: '6000',
          discountPercent: '8',
        },
      ],
    }),
  );
  meghna = await step(rafi, meghna, 'submit');

  // Sylhet Agro (Mitu): accepted, but the order is over the Tk 3 lakh credit limit: waiting for Accounts
  let sylhet: Q = await asUser(mitu, async () =>
    quotes.create(company.id, {
      customerId: await customer('Sylhet Agro Ltd'),
      validUntil: '2026-11-30',
      lines: [
        { productId: product['MUS-500'], quantity: '2400', unitPrice: '125' },
      ],
    }),
  );
  sylhet = await step(mitu, sylhet, 'submit');
  sylhet = await step(mitu, sylhet, 'send');
  await asUser(mitu, () =>
    quotes.accept(sylhet.id, {
      version: sylhet.version,
      customerRef: 'SAL/CANTEEN/26-11',
    }),
  );

  console.log(
    '  demo sales seeded: 3 products, 2 price lists, limits; Karim Stores invoiced and part paid, Meghna discount waiting for Tanvir, Sylhet credit waiting for Accounts',
  );
}

/** Phase 3 WP27: Bogura Traders' October invoice, past due, for the collection reminders (idempotent: skipped once Bogura has an invoice). */
async function seedDemoOverdueInvoice(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const customer = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('customers')
      .select('id')
      .where('company_id', '=', company.id)
      .where('name', '=', 'Bogura Traders')
      .executeTakeFirstOrThrow(),
  );
  const done = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('sales_invoices')
      .select('id')
      .where('customer_id', '=', customer.id)
      .executeTakeFirst(),
  );
  if (done) {
    console.log('  demo overdue invoice already seeded');
    return;
  }
  const [mitu, sujit] = ['mitu@demo.test', 'sujit.das@demo.test'].map((e) =>
    logins.get(e)!,
  );
  const asUser = async <T>(userId: string, work: () => Promise<T>) => {
    const access = await asSystem(
      tenantId,
      () => get(AccessService).load(userId),
      userId,
    );
    return db.withTenant({ tenantId, userId, access }, work);
  };
  const quotes = get(QuotationsService);
  const orders = get(OrdersService);
  const product = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('products')
      .select('id')
      .where('company_id', '=', company.id)
      .where('code', '=', 'RBO-5L')
      .executeTakeFirstOrThrow(),
  );
  type Q = { id: string; version: number };
  let bogura: Q = await asUser(mitu, () =>
    quotes.create(company.id, {
      customerId: customer.id,
      quoteDate: '2026-10-01',
      validUntil: '2026-11-30',
      lines: [{ productId: product.id, quantity: '60', discountPercent: '2' }],
    }),
  );
  bogura = await asUser(mitu, () =>
    quotes.submit(bogura.id, { version: bogura.version }),
  );
  bogura = await asUser(mitu, () =>
    quotes.send(bogura.id, { version: bogura.version }),
  );
  const accepted = await asUser(mitu, () =>
    quotes.accept(bogura.id, {
      version: bogura.version,
      orderDate: '2026-10-02',
    }),
  );
  const order = await asSystem(tenantId, () => orders.find(accepted.order!.id));
  await asUser(mitu, () =>
    orders.deliver(order.id, {
      version: order.version,
      challanNo: 'DC-2026-0033',
      deliveredOn: '2026-10-04',
    }),
  );
  await asUser(sujit, () =>
    get(InvoicesService).invoice(order.id, { invoiceDate: '2026-10-05' }),
  );
  console.log('  demo overdue invoice seeded: Bogura Traders, 5 Oct, 15 days');
}

/** Phase 3 WP24: opportunities in every state, their stage history, October and November targets (idempotent: skipped once the demo company has an opportunity). */
async function seedDemoOpportunities(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const done = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('opportunities')
      .select('id')
      .where('company_id', '=', company.id)
      .executeTakeFirst(),
  );
  if (done) {
    console.log('  demo opportunities already seeded');
    return;
  }
  const [rafi, mitu, tanvir, anisur] = [
    'rafi@demo.test',
    'mitu@demo.test',
    'tanvir.hossain@demo.test',
    'anisur.rahman@demo.test',
  ].map((e) => logins.get(e)!);
  const asUser = async <T>(userId: string, work: () => Promise<T>) => {
    const access = await asSystem(
      tenantId,
      () => get(AccessService).load(userId),
      userId,
    );
    return db.withTenant({ tenantId, userId, access }, work);
  };
  const customer = async (name: string) =>
    (
      await asSystem(tenantId, () =>
        db.tx
          .selectFrom('customers')
          .select('id')
          .where('company_id', '=', company.id)
          .where('name', '=', name)
          .executeTakeFirstOrThrow(),
      )
    ).id;
  const sales = await asSystem(
    tenantId,
    async () =>
      (
        await db.tx
          .selectFrom('departments')
          .select('id')
          .where('company_id', '=', company.id)
          .where('code', '=', 'SALES')
          .executeTakeFirstOrThrow()
      ).id,
  );
  const opps = get(OpportunitiesService);
  const stages = await asUser(anisur, () => opps.stages(company.id));
  const stage = (name: string) => stages.find((s) => s.name === name)!.id;
  type Opp = { id: string; version: number };
  const open = (
    userId: string,
    dto: Parameters<OpportunitiesService['create']>[1],
  ) => asUser(userId, () => opps.create(company.id, dto));
  const move = (
    userId: string,
    o: Opp,
    to: string,
    extra: { probability?: number; note?: string } = {},
  ) =>
    asUser(userId, () =>
      opps.moveStage(o.id, {
        version: o.version,
        stageId: stage(to),
        ...extra,
      }),
    );

  // Rafi: Chattogram and Dhaka dealers
  const meghna = await customer('Meghna Dealers');
  let karim: Opp = await open(rafi, {
    customerId: await customer('Karim Stores'),
    title: 'Rice bran oil 5 L, 200 cans a month',
    value: '360000',
    expectedCloseOn: '2026-11-15',
  });
  karim = await move(rafi, karim, 'Needs identified');
  await move(rafi, karim, 'Quotation sent', {
    note: 'Quotation sent on WhatsApp: Tk 1,800 a can',
  });
  const eid = await open(rafi, {
    customerId: meghna,
    title: 'Soybean oil 1 L, Eid stock',
    value: '1250000',
    expectedCloseOn: '2026-11-25',
    stageId: stage('Quotation sent'),
  });
  await move(rafi, eid, 'Negotiation', {
    probability: 80,
    note: 'Wants 45 days credit; Sujit to confirm the limit',
  });
  const puja = await open(rafi, {
    customerId: meghna,
    title: 'Mustard oil for the Puja season',
    value: '420000',
    expectedCloseOn: '2026-10-10',
    stageId: stage('Negotiation'),
  });
  await asUser(rafi, () =>
    opps.won(puja.id, {
      version: puja.version,
      closedOn: '2026-10-12',
      note: 'Delivered from the Chattogram depot',
    }),
  );

  // Mitu: Sylhet and North Bengal
  const bogura = await customer('Bogura Traders');
  const canteen = await open(mitu, {
    customerId: await customer('Sylhet Agro Ltd'),
    title: 'Kitchen oil, 12-month canteen contract',
    value: '900000',
    expectedCloseOn: '2026-12-10',
  });
  await move(mitu, canteen, 'Needs identified', {
    note: 'Met the canteen manager at Zindabazar',
  });
  const tins = await open(mitu, {
    customerId: bogura,
    title: 'Palm oil 16 L tins',
    value: '275000',
    expectedCloseOn: '2026-10-20',
    stageId: stage('Quotation sent'),
  });
  await asUser(mitu, () =>
    opps.lost(tins.id, {
      version: tins.version,
      reason: 'price',
      closedOn: '2026-10-20',
      note: 'A local mill offered Tk 60 less a tin',
    }),
  );
  await open(mitu, {
    customerId: bogura,
    title: 'Rice bran oil for North Bengal dealers',
    value: '650000',
    expectedCloseOn: '2027-01-15',
  });

  // targets: the Sales head for his people, the Admin for the department
  const pipeline = get(SalesPipelineService);
  for (const month of ['2026-10', '2026-11']) {
    await asUser(tanvir, () =>
      pipeline.setTargets(company.id, {
        month,
        targets: [
          { userId: rafi, amount: '1500000' },
          { userId: mitu, amount: '1200000' },
        ],
      }),
    );
    await asUser(anisur, () =>
      pipeline.setTargets(company.id, {
        month,
        targets: [{ departmentId: sales, amount: '4000000' }],
      }),
    );
  }
  console.log(
    '  demo opportunities seeded: 6 (one won, one lost), targets for October and November',
  );
}

/** WP16: claims and a cash advance in every state (idempotent: skipped once a claim exists). */
async function seedDemoExpenses(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const done = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('expense_claims')
      .select('id')
      .where('company_id', '=', company.id)
      .executeTakeFirst(),
  );
  if (done) {
    console.log('  demo expenses already seeded');
    return;
  }
  const [rafi, mitu, tanvir, sujit] = [
    'rafi@demo.test',
    'mitu@demo.test',
    'tanvir.hossain@demo.test',
    'sujit.das@demo.test',
  ].map((e) => logins.get(e));
  const owner = await asSystem(
    tenantId,
    async () =>
      (
        await db.tx
          .selectFrom('users')
          .select('id')
          .where('email', '=', 'admin@demo.test')
          .executeTakeFirstOrThrow()
      ).id,
  );
  const claims = get(ExpenseClaimsService);
  const advances = get(EmployeeAdvancesService);
  // employees act with their own access (their claims, their advances)
  const asUser = async <T>(
    userId: string | undefined,
    work: () => Promise<T>,
  ) => {
    const access = await asSystem(
      tenantId,
      () => get(AccessService).load(userId!),
      userId,
    );
    return db.withTenant({ tenantId, userId, access }, work);
  };
  const approvals = get(ApprovalsService);
  const decide = (requestId: string, who: string | undefined, note: string) =>
    asSystem(tenantId, () => approvals.decide(requestId, 'approve', note), who);
  const account = await asSystem(tenantId, async () => {
    const rows = await db.tx
      .selectFrom('accounts')
      .select(['id', 'code'])
      .where('company_id', '=', company.id)
      .execute();
    return (code: string) => rows.find((r) => r.code === code)!.id;
  });

  // books set up before WP16 get the new posting accounts (setup adds only what is missing)
  await asSystem(
    tenantId,
    () => get(LedgerSetupService).setUp(company.id),
    sujit,
  );
  const categories = await asSystem(
    tenantId,
    () => claims.createDefaultCategories(company.id),
    sujit,
  );
  const cat = (code: string) => categories.find((c) => c.code === code)!.id;
  // sample receipt photos (each one a different file: the same receipt cannot be claimed twice)
  const image = readFileSync('samples/receipts/receipt.png');
  let n = 0;
  const receipt = (claimId: string, who: string | undefined) =>
    asUser(who, () => {
      const buffer = Buffer.concat([image, Buffer.from(`demo receipt ${++n}`)]);
      return claims.uploadReceipt(claimId, {
        buffer,
        size: buffer.length,
        originalname: `receipt-${n}.png`,
      } as Express.Multer.File);
    }) as Promise<{ id: string }>;

  // Rafi: cash advance for the Chattogram dealer visit, paid in cash; his claim settles it
  const advance = await asUser(rafi, () =>
    advances.request({
      purpose: 'Dealer visit, Chattogram (12-14 Oct): bus, hotel, meals',
      amount: '15000',
      neededBy: '2026-10-11',
    }),
  );
  await decide(
    advance.approvalRequestId!,
    tanvir,
    'Visit planned with the dealers',
  );
  await decide(advance.approvalRequestId!, sujit, 'Within the travel policy');
  const payout = await asSystem(
    tenantId,
    () =>
      advances.payout(advance.id, {
        method: 'cash',
        paidFromAccountId: account('1110'),
        paymentDate: '2026-10-11',
      }),
    sujit,
  );
  await decide(payout.payout!.approvalRequestId!, owner, 'Cash handed over');
  const trip = await asUser(rafi, () =>
    claims.create({
      title: 'Dealer visit, Chattogram (12-14 Oct)',
      advanceId: advance.id,
    }),
  );
  const [bus, hotel, lunch] = [
    await receipt(trip.id, rafi),
    await receipt(trip.id, rafi),
    await receipt(trip.id, rafi),
  ];
  await asUser(rafi, () =>
    claims.update(trip.id, {
      version: trip.version,
      lines: [
        {
          expenseDate: '2026-10-12',
          categoryId: cat('TRAVEL'),
          description: 'Green Line bus Dhaka-Chattogram and back',
          amount: '2800',
          receiptId: bus.id,
        },
        {
          expenseDate: '2026-10-12',
          categoryId: cat('HOTEL'),
          description: 'Hotel Agrabad, 2 nights',
          amount: '7000',
          receiptId: hotel.id,
        },
        {
          expenseDate: '2026-10-13',
          categoryId: cat('TRAVEL_LOCAL'),
          description: 'CNG to dealers in Halishahar and GEC',
          amount: '350',
        },
        {
          expenseDate: '2026-10-13',
          categoryId: cat('MEALS'),
          description: 'Lunch with 3 dealers',
          amount: '2500',
          receiptId: lunch.id,
        },
      ],
    }),
  );
  const tripSubmitted = await asUser(rafi, () => claims.submit(trip.id));
  await decide(
    tripSubmitted.approvalRequestId!,
    tanvir,
    'Dealer meetings done',
  );
  await decide(tripSubmitted.approvalRequestId!, sujit, 'Receipts checked');

  // Rafi: mobile bill, approved, waiting for Accounts to pay
  const mobile = await asUser(rafi, () =>
    claims.create({ title: 'Mobile bill October (dealer calls)' }),
  );
  const bill = await receipt(mobile.id, rafi);
  await asUser(rafi, () =>
    claims.update(mobile.id, {
      version: mobile.version,
      lines: [
        {
          expenseDate: '2026-10-10',
          categoryId: cat('MOBILE'),
          description: 'Grameenphone postpaid, dealer calls',
          amount: '1200',
          receiptId: bill.id,
        },
      ],
    }),
  );
  const mobileSubmitted = await asUser(rafi, () => claims.submit(mobile.id));
  await decide(mobileSubmitted.approvalRequestId!, tanvir, 'OK');
  await decide(mobileSubmitted.approvalRequestId!, sujit, 'Bill checked');

  // Mitu: local conveyance, waiting for Tanvir
  const cng = await asUser(mitu, () =>
    claims.create({ title: 'Market visits, Mirpur and Uttara' }),
  );
  await asUser(mitu, () =>
    claims.update(cng.id, {
      version: cng.version,
      lines: [
        {
          expenseDate: '2026-10-14',
          categoryId: cat('TRAVEL_LOCAL'),
          description: 'CNG Mirpur 10 - Uttara Sector 7',
          amount: '450',
        },
        {
          expenseDate: '2026-10-15',
          categoryId: cat('TRAVEL_LOCAL'),
          description: 'Pathao bike, Uttara dealers',
          amount: '280',
        },
      ],
    }),
  );
  await asUser(mitu, () => claims.submit(cng.id));
  console.log(
    '  demo expenses seeded: categories, Rafi advance + settled claim, 1 claim to pay, 1 waiting for Tanvir',
  );
}

/** Phase 2: books, vendors and bills in every state (idempotent: skipped once the books exist). */
async function seedDemoFinance(
  get: Get,
  tenantId: string,
  logins: Map<string, string>,
  asSystem: <T>(
    tenantId: string,
    work: () => Promise<T>,
    userId?: string,
  ) => Promise<T>,
) {
  const db = currentDb!;
  const sujit = logins.get('sujit.das@demo.test');
  const company = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('companies')
      .select('id')
      .where('legal_name', '=', 'Demo Trading Ltd')
      .executeTakeFirstOrThrow(),
  );
  const done = await asSystem(tenantId, () =>
    db.tx
      .selectFrom('accounts')
      .select('id')
      .where('company_id', '=', company.id)
      .executeTakeFirst(),
  );
  if (done) {
    console.log('  demo finance already seeded');
    return;
  }

  // the workspace owner is also an Accounts user: the checker for Sujit's vouchers and bills
  const owner = await asSystem(tenantId, async () => {
    const user = await db.tx
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'admin@demo.test')
      .executeTakeFirstOrThrow();
    const has = await db.tx
      .selectFrom('user_roles')
      .select('id')
      .where('user_id', '=', user.id)
      .where('system_role', '=', 'accounts')
      .executeTakeFirst();
    if (!has)
      await db.tx
        .insertInto('user_roles')
        .values({
          user_id: user.id,
          system_role: 'accounts',
          scope_type: 'group',
          scope_id: null,
        })
        .execute();
    return user.id;
  });

  // the books and payables settings
  await asSystem(
    tenantId,
    () => get(LedgerSetupService).setUp(company.id, '2026-07-01'),
    sujit,
  );
  const vendors = get(VendorsService);
  await asSystem(
    tenantId,
    () =>
      vendors.updateSettings(company.id, {
        vatWithholdingEntity: true,
        defaultPaymentTermsDays: 30,
      }),
    sujit,
  );
  const account = await asSystem(tenantId, async () => {
    const rows = await db.tx
      .selectFrom('accounts')
      .select(['id', 'code'])
      .where('company_id', '=', company.id)
      .execute();
    return (code: string) => rows.find((r) => r.code === code)!.id;
  });
  const ho = await asSystem(
    tenantId,
    async () =>
      (
        await db.tx
          .selectFrom('departments')
          .select('id')
          .where('code', '=', 'HO')
          .executeTakeFirstOrThrow()
      ).id,
  );
  const sales = await asSystem(
    tenantId,
    async () =>
      (
        await db.tx
          .selectFrom('departments')
          .select('id')
          .where('code', '=', 'SALES')
          .executeTakeFirstOrThrow()
      ).id,
  );

  // vendors
  const add = (dto: Parameters<VendorsService['create']>[1]) =>
    asSystem(tenantId, () => vendors.create(company.id, dto), sujit);
  const clean = await add({
    name: 'Clean & Care Services Ltd',
    nameBn: 'ক্লিন অ্যান্ড কেয়ার সার্ভিসেস লিমিটেড',
    tin: '123456789012',
    bin: '000123456-0101',
    phone: '01711223344',
    address: 'House 12, Road 7, Banani, Dhaka 1213',
    withholdingCategory: 'SERVICE',
  });
  const rahman = await add({
    name: 'Rahman Properties',
    nameBn: 'রহমান প্রপার্টিজ',
    vendorType: 'individual',
    tin: '234567890123',
    bin: '000234567-0101',
    address: 'Road 45, Gulshan-2, Dhaka',
    withholdingCategory: 'RENT',
    paymentTermsDays: 0,
  });
  const karim = await add({
    name: 'Karim Traders',
    nameBn: 'করিম ট্রেডার্স',
    tin: '345678901234',
    bin: '000345678-0103',
    phone: '01819556677',
    address: '27 Nawabpur Road, Dhaka 1100',
    withholdingCategory: 'SUPPLY',
    paymentTermsDays: 45,
  });
  const shafiq = await add({
    name: 'Shafiqul Islam (IT consultant)',
    vendorType: 'individual',
    phone: '01556123456',
    withholdingCategory: 'PROFESSIONAL',
  });

  // bills: approved (rent, cleaning), waiting (stationery), draft (consultant)
  const bills = get(VendorBillsService);
  const approvals = get(ApprovalsService);
  const bill = async (
    dto: Parameters<VendorBillsService['create']>[1],
    state: 'draft' | 'submitted' | 'approved',
  ) => {
    const draft = await asSystem(
      tenantId,
      () => bills.create(company.id, dto),
      sujit,
    );
    if (state === 'draft') return draft;
    const submitted = await asSystem(
      tenantId,
      () => bills.submit(draft.id),
      sujit,
    );
    if (state === 'approved')
      await asSystem(
        tenantId,
        () =>
          approvals.decide(
            submitted.approvalRequestId!,
            'approve',
            'Checked against the Mushak 6.3 invoice',
          ),
        owner,
      );
    return submitted;
  };
  const rent = await bill(
    {
      vendorId: rahman.id,
      billNo: 'RP-2026-10',
      billDate: '2026-10-01',
      narration: 'Head office rent, October 2026',
      lines: [
        {
          accountId: account('5210'),
          departmentId: ho,
          description: 'Gulshan-2, 4th floor',
          amount: '85000',
          vatPercent: '15',
        },
      ],
    },
    'approved',
  );
  await bill(
    {
      vendorId: clean.id,
      billNo: 'CCS/2026/1043',
      billDate: '2026-10-05',
      narration: 'Office cleaning, October 2026 (6 staff)',
      lines: [
        {
          accountId: account('5275'),
          departmentId: ho,
          description: 'Cleaning, Gulshan head office',
          amount: '120000',
          vatPercent: '15',
        },
      ],
    },
    'approved',
  );
  await bill(
    {
      vendorId: karim.id,
      billNo: 'KT-5512',
      billDate: '2026-10-10',
      narration: 'Stationery and sales brochures',
      lines: [
        {
          accountId: account('5240'),
          departmentId: ho,
          description: 'Paper, files, toner',
          amount: '150000',
          vatPercent: '7.5',
        },
        {
          accountId: account('5240'),
          departmentId: sales,
          description: 'Dealer brochures (Bangla), 5,000 copies',
          amount: '200000',
          vatPercent: '7.5',
        },
      ],
    },
    'submitted',
  );
  await bill(
    {
      vendorId: shafiq.id,
      billNo: 'SI-07',
      billDate: '2026-10-12',
      narration: 'Payroll server setup and training',
      lines: [
        {
          accountId: account('5295'),
          departmentId: ho,
          description: 'Server setup, 2 days training',
          amount: '80000',
          vatPercent: '15',
        },
      ],
    },
    'draft',
  );

  // rent paid by cheque, approved by the owner
  const payment = await asSystem(
    tenantId,
    () =>
      get(VendorPaymentsService).create(company.id, {
        vendorId: rahman.id,
        paymentDate: '2026-10-03',
        method: 'cheque',
        reference: 'CHQ 0045512',
        paidFromAccountId: account('1130'),
        allocations: [{ billId: rent.id, amount: '80750' }],
      }),
    sujit,
  );
  await asSystem(
    tenantId,
    () =>
      approvals.decide(payment.approvalRequestId!, 'approve', 'Cheque signed'),
    owner,
  );
  console.log(
    '  demo finance seeded: books 2026-27, 4 vendors, 4 bills (1 waiting for admin@demo.test, 1 draft), rent paid',
  );
}

async function seedDemoOrganization(get: Get) {
  const companies = get(CompaniesService);
  if ((await companies.listCompanies()).length > 0) {
    console.log('  demo organization already seeded');
    return;
  }

  // company and branches
  const company = await companies.createCompany({
    legalName: 'Demo Trading Ltd',
    shortName: 'DTL',
    employeeCodePrefix: 'DTL',
    tin: '123456789012',
  });
  const branches = get(BranchesService);
  const dhaka = await branches.createBranch(company.id, {
    code: 'DHK',
    name: 'Dhaka HQ',
    address: 'Gulshan-2, Dhaka',
    weekendDays: ['FRI', 'SAT'],
    geoLat: 23.7925,
    geoLng: 90.4078,
    geoRadiusM: 150,
  });
  const ctg = await branches.createBranch(company.id, {
    code: 'CTG',
    name: 'Chattogram Office',
    address: 'Agrabad, Chattogram',
    weekendDays: ['FRI'],
    geoLat: 22.3245,
    geoLng: 91.8123,
    geoRadiusM: 150,
  });

  // departments (tree)
  const departments = get(DepartmentsService);
  const ho = await departments.createDepartment(company.id, {
    code: 'HO',
    name: 'Head Office',
    costCentreCode: 'CC-100',
  });
  const hr = await departments.createDepartment(company.id, {
    code: 'HR',
    name: 'Human Resources',
    parentId: ho.id,
    costCentreCode: 'CC-110',
  });
  const fin = await departments.createDepartment(company.id, {
    code: 'FIN',
    name: 'Finance & Accounts',
    parentId: ho.id,
    costCentreCode: 'CC-120',
  });
  const it = await departments.createDepartment(company.id, {
    code: 'IT',
    name: 'Information Technology',
    parentId: ho.id,
    costCentreCode: 'CC-130',
  });
  const sales = await departments.createDepartment(company.id, {
    code: 'SALES',
    name: 'Sales',
    costCentreCode: 'CC-200',
  });
  const salesDhk = await departments.createDepartment(company.id, {
    code: 'SALES-DHK',
    name: 'Sales Dhaka',
    parentId: sales.id,
    costCentreCode: 'CC-210',
  });
  const salesCtg = await departments.createDepartment(company.id, {
    code: 'SALES-CTG',
    name: 'Sales Chattogram',
    parentId: sales.id,
    costCentreCode: 'CC-220',
  });

  // designations and grades
  const designations = get(DesignationsService);
  const md = await designations.createDesignation(company.id, {
    code: 'MD',
    nameEn: 'Managing Director',
    nameBn: 'ব্যবস্থাপনা পরিচালক',
  });
  const mgr = await designations.createDesignation(company.id, {
    code: 'MGR',
    nameEn: 'Manager',
    nameBn: 'ব্যবস্থাপক',
  });
  const se = await designations.createDesignation(company.id, {
    code: 'SE',
    nameEn: 'Senior Executive',
    nameBn: 'সিনিয়র এক্সিকিউটিভ',
  });
  const exe = await designations.createDesignation(company.id, {
    code: 'EXE',
    nameEn: 'Executive',
    nameBn: 'এক্সিকিউটিভ',
  });
  const off = await designations.createDesignation(company.id, {
    code: 'OFF',
    nameEn: 'Officer',
    nameBn: 'অফিসার',
  });

  const grades = get(GradesService);
  const g1 = await grades.createGrade(company.id, {
    code: 'G1',
    name: 'Grade 1',
    rank: 1,
    otEligible: true,
    salaryMin: '18000',
    salaryMax: '30000',
  });
  const g2 = await grades.createGrade(company.id, {
    code: 'G2',
    name: 'Grade 2',
    rank: 2,
    otEligible: true,
    salaryMin: '28000',
    salaryMax: '45000',
  });
  await grades.createGrade(company.id, {
    code: 'G3',
    name: 'Grade 3',
    rank: 3,
    salaryMin: '45000',
    salaryMax: '80000',
  });
  const g4 = await grades.createGrade(company.id, {
    code: 'G4',
    name: 'Grade 4',
    rank: 4,
    salaryMin: '80000',
    salaryMax: '150000',
  });
  const g5 = await grades.createGrade(company.id, {
    code: 'G5',
    name: 'Grade 5',
    rank: 5,
    salaryMin: '150000',
  });

  // employees
  const employees = get(EmployeesService);
  const hire = (p: {
    nameEn: string;
    nameBn: string;
    gender: 'male' | 'female';
    join: string;
    branch: string;
    dept: string;
    desig: string;
    grade: string;
    manager?: string;
    group?: string;
    nid: string;
  }) =>
    employees.createEmployee({
      companyId: company.id,
      fullNameEn: p.nameEn,
      fullNameBn: p.nameBn,
      gender: p.gender,
      joinDate: p.join,
      nid: p.nid,
      phone: '017' + p.nid.slice(-8),
      festivalGroup: p.group ?? 'eid',
      branchId: p.branch,
      departmentId: p.dept,
      designationId: p.desig,
      gradeId: p.grade,
      lineManagerId: p.manager,
    });

  const boss = await hire({
    nameEn: 'Anisur Rahman',
    nameBn: 'আনিসুর রহমান',
    gender: 'male',
    join: '2019-01-01',
    branch: dhaka.id,
    dept: ho.id,
    desig: md.id,
    grade: g5.id,
    nid: '1975123456781',
  });
  const hrMgr = await hire({
    nameEn: 'Farzana Akter',
    nameBn: 'ফারজানা আক্তার',
    gender: 'female',
    join: '2021-03-01',
    branch: dhaka.id,
    dept: hr.id,
    desig: mgr.id,
    grade: g4.id,
    manager: boss.id,
    nid: '1985123456782',
  });
  const finMgr = await hire({
    nameEn: 'Sujit Kumar Das',
    nameBn: 'সুজিত কুমার দাস',
    gender: 'male',
    join: '2020-07-01',
    branch: dhaka.id,
    dept: fin.id,
    desig: mgr.id,
    grade: g4.id,
    manager: boss.id,
    group: 'puja',
    nid: '1983123456783',
  });
  const salesMgr = await hire({
    nameEn: 'Tanvir Hossain',
    nameBn: 'তানভীর হোসেন',
    gender: 'male',
    join: '2021-09-01',
    branch: dhaka.id,
    dept: sales.id,
    desig: mgr.id,
    grade: g4.id,
    manager: boss.id,
    nid: '1987123456784',
  });
  const itOff = await hire({
    nameEn: 'Nusrat Jahan',
    nameBn: 'নুসরাত জাহান',
    gender: 'female',
    join: '2024-02-01',
    branch: dhaka.id,
    dept: it.id,
    desig: off.id,
    grade: g2.id,
    manager: boss.id,
    nid: '1996123456785',
  });
  const rafi = await hire({
    nameEn: 'Mahmudul Hasan Rafi',
    nameBn: 'মাহমুদুল হাসান রাফি',
    gender: 'male',
    join: '2025-01-01',
    branch: dhaka.id,
    dept: salesDhk.id,
    desig: exe.id,
    grade: g1.id,
    manager: salesMgr.id,
    nid: '1998123456786',
  });
  const mitu = await hire({
    nameEn: 'Sharmin Sultana Mitu',
    nameBn: 'শারমিন সুলতানা মিতু',
    gender: 'female',
    join: '2025-03-01',
    branch: ctg.id,
    dept: salesCtg.id,
    desig: exe.id,
    grade: g1.id,
    manager: salesMgr.id,
    nid: '1999123456787',
  });
  // a new joiner still in draft (onboarding not finished)
  await hire({
    nameEn: 'Arif Chowdhury',
    nameBn: 'আরিফ চৌধুরী',
    gender: 'male',
    join: '2026-11-01',
    branch: ctg.id,
    dept: salesCtg.id,
    desig: exe.id,
    grade: g1.id,
    manager: salesMgr.id,
    nid: '2000123456788',
  });

  // job history: promotion, then a transfer recorded later but back-dated before it
  const jobs = get(JobHistoryService);
  await jobs.createJobEvent(rafi.id, {
    type: 'promotion',
    effectiveFrom: '2026-07-01',
    designationId: se.id,
    gradeId: g2.id,
    reason: 'Annual promotion',
  });
  await jobs.createJobEvent(rafi.id, {
    type: 'transfer',
    effectiveFrom: '2026-04-01',
    branchId: ctg.id,
    departmentId: salesCtg.id,
    reason: 'Back-dated: moved to Chattogram in April',
  });

  // department heads
  const head = async (deptId: string, employeeId: string) => {
    const d = await departments.getDepartment(deptId);
    await departments.updateDepartment(deptId, {
      headEmployeeId: employeeId,
      version: d.version,
    });
  };
  await head(ho.id, boss.id);
  await head(hr.id, hrMgr.id);
  await head(fin.id, finMgr.id);
  await head(sales.id, salesMgr.id);

  // onboarding done + activated for everyone except the draft joiner
  const onboarding = get(OnboardingService);
  for (const e of [boss, hrMgr, finMgr, salesMgr, itOff, rafi, mitu]) {
    for (const item of DEFAULT_ONBOARDING_ITEMS)
      await onboarding.completeItem(e.id, item.code, { note: 'Seed data' });
    await employees.activateEmployee(e.id);
  }
  console.log(
    '  demo organization seeded: 1 company, 2 branches, 7 departments, 8 employees',
  );
}

async function seedRivalOrganization(get: Get) {
  const companies = get(CompaniesService);
  if ((await companies.listCompanies()).length > 0) {
    console.log('  rival organization already seeded');
    return;
  }
  const company = await companies.createCompany({
    legalName: 'Rival Pharma Ltd',
    employeeCodePrefix: 'RPL',
  });
  const branch = await get(BranchesService).createBranch(company.id, {
    code: 'DHK',
    name: 'Tejgaon Office',
  });
  const dept = await get(DepartmentsService).createDepartment(company.id, {
    code: 'OPS',
    name: 'Operations',
  });
  const desig = await get(DesignationsService).createDesignation(company.id, {
    code: 'OFF',
    nameEn: 'Officer',
  });
  const grade = await get(GradesService).createGrade(company.id, {
    code: 'G1',
    name: 'Grade 1',
  });
  await get(EmployeesService).createEmployee({
    companyId: company.id,
    fullNameEn: 'Rival Employee',
    joinDate: '2025-06-01',
    branchId: branch.id,
    departmentId: dept.id,
    designationId: desig.id,
    gradeId: grade.id,
  });
  console.log('  rival organization seeded');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
