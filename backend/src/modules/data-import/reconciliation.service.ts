/**
 * Go-live reconciliation (spec §10, guide §17 step 5): totals of what is now in
 * the system on the day before cut-over, to compare with the old system:
 *
 *   headcount and gross salary per department    (HR signs off)
 *   leave balances per leave type                (each balance matches the old record)
 *   year-to-date taxable income, tax and PF      (totals match the old payroll register)
 *   outstanding advances                         (total matches Accounts)
 *   salary accounts per channel
 *
 * The customer (Admin) signs it: the exact report and its hash are stored, the
 * committed batches become "signed_off" and can no longer be rolled back.
 * Only totals are shown, so no individual salary is revealed to the signer.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  canonicalJson,
  sha256Hex,
} from '../../platform/crypto/canonical-json.js';
import { addDays, businessDate } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { channelOf } from '../disbursement/adapters.js';
import { BankAccountsService } from '../bank-accounts/bank-accounts.service.js';
import { EmployeeDirectory } from '../employees/employee-directory.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { LeaveLedgerService } from '../leave/leave-ledger.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { PayrollSetupService } from '../payroll/payroll-setup.service.js';
import { PayrollVariablesService } from '../payroll/payroll-variables.service.js';
import type { SignOffDto } from './dto/data-import.dto.js';
import { fiscalYearOf } from './validators.js';

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly directory: EmployeeDirectory,
    private readonly payrollSetup: PayrollSetupService,
    private readonly payrollVariables: PayrollVariablesService,
    private readonly leave: LeaveLedgerService,
    private readonly bank: BankAccountsService,
  ) {}

  async report(companyId: string, cutOverDate: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertCanSee(companyId);
    return this.build(companyId, cutOverDate);
  }

  /** The customer signs the report; the committed batches of that cut-over are locked. */
  async signOff(companyId: string, dto: SignOffDto) {
    // check access; there must be something to sign
    await this.org.assertCompanyExists(companyId);
    this.access.assert('data.import.sign_off', { companyId });
    const batches = await this.db.tx
      .selectFrom('import_batches')
      .select('id')
      .where('company_id', '=', companyId)
      .where('cut_over_date', '=', dto.cutOverDate)
      .where('state', '=', 'committed')
      .execute();
    if (batches.length === 0)
      throw new BadRequestException(MSG.IMPORT_NOTHING_TO_SIGN);

    // store the report exactly as signed
    const report = await this.build(companyId, dto.cutOverDate);
    const signoff = await this.db.tx
      .insertInto('migration_signoffs')
      .values({
        company_id: companyId,
        cut_over_date: dto.cutOverDate,
        report: JSON.stringify(report),
        report_sha256: sha256Hex(canonicalJson(report)),
        note: dto.note,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .updateTable('import_batches')
      .set({ state: 'signed_off', signoff_id: signoff.id })
      .where(
        'id',
        'in',
        batches.map((b) => b.id),
      )
      .execute();

    await this.audit.record({
      action: 'migration.signed_off',
      entity: 'company',
      entityId: companyId,
      after: {
        signoffId: signoff.id,
        cutOverDate: dto.cutOverDate,
        batches: batches.length,
        reportSha256: signoff.report_sha256,
        note: dto.note,
      },
    });
    await this.outbox.add({
      type: 'migration.signed_off',
      entityId: signoff.id,
      payload: {
        companyId,
        cutOverDate: dto.cutOverDate,
        batches: batches.length,
      },
    });
    return {
      id: signoff.id,
      cutOverDate: dto.cutOverDate,
      batches: batches.length,
      signedAt: signoff.signed_at,
      reportSha256: signoff.report_sha256,
      report,
    };
  }

  async listSignoffs(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertCanSee(companyId);
    const rows = await this.db.tx
      .selectFrom('migration_signoffs')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('signed_at', 'desc')
      .execute();
    return rows.map((s) => ({
      id: s.id,
      cutOverDate: s.cut_over_date,
      note: s.note,
      signedBy: s.signed_by,
      signedAt: s.signed_at,
      reportSha256: s.report_sha256,
      report: s.report,
    }));
  }

  // ------------------------------------------------------------------ internals

  private async build(companyId: string, cutOverDate: string) {
    const asOf = addDays(businessDate(cutOverDate), -1);
    const fiscalYear = fiscalYearOf(cutOverDate);

    // people on the payroll at the day before cut-over, by department
    const employeeIds = await this.directory.onPayrollOn(companyId, asOf);
    const departmentOf = new Map<string, string>();
    for (const id of employeeIds) {
      const p =
        (await this.directory.placementOn(id, asOf)) ??
        (await this.directory.currentOrFirstPlacement(id));
      if (p) departmentOf.set(id, p.departmentId);
    }
    const names = (
      await this.org.names({ departmentIds: [...departmentOf.values()] })
    ).departments;
    const gross = await this.payrollSetup.grossOn(employeeIds, asOf);

    const byDepartment = new Map<
      string,
      {
        department: string;
        headcount: number;
        withSalary: number;
        gross: Money;
      }
    >();
    for (const id of employeeIds) {
      const dept = names.get(departmentOf.get(id) ?? '');
      const key = dept ? `${dept.code} ${dept.name}` : 'UNASSIGNED';
      const d = byDepartment.get(key) ?? {
        department: key,
        headcount: 0,
        withSalary: 0,
        gross: Money.zero(),
      };
      d.headcount++;
      if (gross.has(id)) {
        d.withSalary++;
        d.gross = d.gross.plus(gross.get(id)!);
      }
      byDepartment.set(key, d);
    }
    const departments = [...byDepartment.values()].sort((a, b) =>
      a.department.localeCompare(b.department),
    );

    // salary accounts per channel
    const accounts = await this.bank.salaryAccounts(employeeIds);
    const channels: Record<string, number> = {};
    for (const id of employeeIds) {
      const ch = channelOf(accounts.get(id));
      channels[ch] = (channels[ch] ?? 0) + 1;
    }

    const batches = await this.db.tx
      .selectFrom('import_batches')
      .select([
        'id',
        'entity',
        'file_name',
        'state',
        'total_rows',
        'valid_rows',
        'skipped_rows',
        'committed_at',
      ])
      .where('company_id', '=', companyId)
      .where('cut_over_date', '=', cutOverDate)
      .where('state', 'in', ['committed', 'signed_off'])
      .orderBy('created_at')
      .execute();

    const company = await this.org.companyNames(companyId);
    return {
      company: company.legalName,
      cutOverDate,
      asOf,
      fiscalYear,
      headcount: employeeIds.length,
      departments: departments.map((d) => ({
        department: d.department,
        headcount: d.headcount,
        withSalary: d.withSalary,
        gross: d.gross.toDb(),
      })),
      totalGross: Money.sum(departments.map((d) => d.gross)).toDb(),
      employeesWithoutSalary: departments.reduce(
        (n, d) => n + d.headcount - d.withSalary,
        0,
      ),
      leaveBalances: await this.leave.balanceTotals(employeeIds, asOf),
      yearToDate: await this.payrollSetup.ytdOpeningTotals(
        employeeIds,
        fiscalYear,
      ),
      advances: await this.payrollVariables.outstandingTotals(companyId),
      salaryAccounts: Object.fromEntries(Object.entries(channels).sort()),
      batches: batches.map((b) => ({
        id: b.id,
        entity: b.entity,
        fileName: b.file_name,
        state: b.state,
        rows: b.total_rows,
        created: b.valid_rows,
        skipped: b.skipped_rows,
        committedAt: b.committed_at,
      })),
    };
  }

  private assertCanSee(companyId: string): void {
    if (!this.access.allows('data.import.sign_off', { companyId }))
      this.access.assert('data.import', { companyId });
  }
}
