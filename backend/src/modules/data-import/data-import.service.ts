/**
 * Data migration batches (spec §10, guide §17):
 *
 *   upload    the filled template -> staging rows, every row validated
 *             (row-level errors; nothing is created yet)
 *   skip      a row with a reason (e.g. "left in September, not migrated")
 *   dry run   what commit would create, with totals per department
 *   commit    rows validated again against today's data, then every record is
 *             created in ONE transaction (any failure: nothing is created)
 *   rollback  until the customer signs the reconciliation: the created records
 *             are removed again (newest first; refused if already used)
 *
 * Opening values become normal records (employees, salaries, leave "opening"
 * entries, YTD openings, loans, approved salary accounts), so payroll, leave
 * and disbursement treat them exactly like data entered in the system.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { sha256Hex } from '../../platform/crypto/canonical-json.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import {
  FieldEncryption,
  mask,
} from '../../platform/crypto/field-encryption.js';
import type {
  ImportBatch,
  ImportEntity,
  ImportRow,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { BankAccountsService } from '../bank-accounts/bank-accounts.service.js';
import { EmployeeDirectory } from '../employees/employee-directory.service.js';
import { EmployeesService } from '../employees/employees.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { LeaveLedgerService } from '../leave/leave-ledger.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { PayrollSetupService } from '../payroll/payroll-setup.service.js';
import { PayrollVariablesService } from '../payroll/payroll-variables.service.js';
import type {
  ImportReasonDto,
  UploadImportDto,
} from './dto/data-import.dto.js';
import { CrmAccess } from '../crm/crm-access.js';
import { CustomersService } from '../crm/customers.service.js';
import { MAX_IMPORT_ROWS, readSheet } from './spreadsheet.js';
import {
  checkHeaders,
  validateRows,
  type BankAccountRow,
  type CustomerRow,
  type EmployeeRow,
  type ImportContext,
  type LeaveBalanceRow,
  type LoanRow,
  type RowError,
  type RowResult,
  type SalaryRow,
  type YtdRow,
} from './validators.js';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/** What a committed row created (rollback removes it). */
interface CreatedRecord {
  table:
    | 'employees'
    | 'employee_salaries'
    | 'leave_ledger'
    | 'payroll_ytd_openings'
    | 'loans'
    | 'employee_bank_accounts'
    | 'customers';
  id: string;
  seq: number; // creation order within the batch
}

@Injectable()
export class DataImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly directory: EmployeeDirectory,
    private readonly employees: EmployeesService,
    private readonly payrollSetup: PayrollSetupService,
    private readonly payrollVariables: PayrollVariablesService,
    private readonly leave: LeaveLedgerService,
    private readonly bank: BankAccountsService,
    private readonly encryption: FieldEncryption,
    private readonly customers: CustomersService,
    private readonly crmAccess: CrmAccess,
  ) {}

  // ============================================================ staging at rest

  /** Identity and account numbers in a staged row are stored field-encrypted (guide §20), never in clear. */
  private seal(cells: Record<string, string>): Record<string, string> {
    const tenantId = requestContext.get().tenantId;
    return Object.fromEntries(
      Object.entries(cells).map(([k, v]) => [
        k,
        SENSITIVE_CELLS.has(k) && v
          ? SEALED + this.encryption.encrypt(tenantId, v)
          : v,
      ]),
    );
  }

  /** A staged row as shown on screen: sensitive cells masked to their last digits. */
  private masked(cells: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.unseal(cells)).map(([k, v]) => [
        k,
        SENSITIVE_CELLS.has(k) && v ? mask(v, 3) : v,
      ]),
    );
  }

  private unseal(cells: Record<string, string>): Record<string, string> {
    const tenantId = requestContext.get().tenantId;
    return Object.fromEntries(
      Object.entries(cells).map(([k, v]) => [
        k,
        typeof v === 'string' && v.startsWith(SEALED)
          ? this.encryption.decrypt(tenantId, v.slice(SEALED.length))
          : v,
      ]),
    );
  }

  // ================================================================ upload

  async upload(
    companyId: string,
    file: Express.Multer.File | undefined,
    dto: UploadImportDto,
  ) {
    // check access and the file
    await this.org.assertCompanyExists(companyId);
    this.access.assert('data.import', { companyId });
    if (!file)
      throw new BadRequestException({
        message: MSG.IMPORT_FILE_INVALID,
        details: { problems: ['Attach the file as form field "file"'] },
      });
    if (!/\.(xlsx|csv)$/i.test(file.originalname))
      throw new BadRequestException({
        message: MSG.IMPORT_FILE_INVALID,
        details: { problems: ['Upload the template as .xlsx or .csv'] },
      });

    // read the sheet; wrong or missing columns reject the whole file
    let sheet;
    try {
      sheet = await readSheet(file.buffer, file.originalname);
    } catch {
      throw new BadRequestException({
        message: MSG.IMPORT_FILE_INVALID,
        details: { problems: ['The file is not a readable Excel / CSV file'] },
      });
    }
    const problems = checkHeaders(dto.entity, sheet.headers);
    if (sheet.rows.length === 0) problems.push('The file has no data rows');
    if (sheet.rows.length > MAX_IMPORT_ROWS)
      problems.push(`At most ${MAX_IMPORT_ROWS} rows per file`);
    if (problems.length)
      throw new BadRequestException({
        message: MSG.IMPORT_FILE_INVALID,
        details: { problems },
      });

    // validate every row
    const ctx = await this.buildContext(companyId, dto.cutOverDate);
    const results = validateRows(dto.entity, sheet.rows, ctx);

    // save the batch and its rows (staging)
    const batch = await this.db.tx
      .insertInto('import_batches')
      .values({
        company_id: companyId,
        entity: dto.entity,
        file_name: file.originalname,
        file_sha256: sha256Hex(file.buffer.toString('base64')),
        cut_over_date: dto.cutOverDate,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const cellsByRow = new Map(sheet.rows.map((r) => [r.rowNo, r.cells]));
    for (let i = 0; i < results.length; i += 500) {
      await this.db.tx
        .insertInto('import_rows')
        .values(
          results.slice(i, i + 500).map((r) => ({
            batch_id: batch.id,
            row_no: r.rowNo,
            data: JSON.stringify(this.seal(cellsByRow.get(r.rowNo) ?? {})),
            status: r.errors.length ? ('error' as const) : ('valid' as const),
            errors: JSON.stringify(r.errors),
          })),
        )
        .execute();
    }
    await this.recount(batch.id);
    await this.audit.record({
      action: 'import.uploaded',
      entity: 'import_batch',
      entityId: batch.id,
      after: {
        entity: dto.entity,
        file: file.originalname,
        rows: results.length,
        cutOverDate: dto.cutOverDate,
      },
    });
    return this.getBatch(batch.id);
  }

  // ================================================================ read

  async listBatches(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.assertCanSee(companyId);
    const rows = await this.db.tx
      .selectFrom('import_batches')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('created_at', 'desc')
      .limit(200)
      .execute();
    return rows.map(toBatchSummary);
  }

  /** A batch with its rows (errors first). */
  async getBatch(batchId: string) {
    const batch = await this.findBatch(batchId);
    this.assertCanSee(batch.company_id);
    const rows = await this.db.tx
      .selectFrom('import_rows')
      .selectAll()
      .where('batch_id', '=', batch.id)
      .orderBy('row_no')
      .execute();
    const order = {
      error: 0,
      skipped: 1,
      valid: 2,
      committed: 3,
      rolled_back: 4,
    };
    return {
      ...toBatchSummary(batch),
      rows: rows
        .sort(
          (a, b) => order[a.status] - order[b.status] || a.row_no - b.row_no,
        )
        .map((r) => ({
          rowNo: r.row_no,
          status: r.status,
          errors: r.errors as RowError[],
          skipReason: r.skip_reason,
          data: this.masked(r.data as Record<string, string>),
        })),
    };
  }

  // ================================================================ fix

  /** Leave a row out of the import, with a reason (spec §10: "fixed or explicitly skipped"). */
  async skipRow(batchId: string, rowNo: number, dto: ImportReasonDto) {
    const batch = await this.findBatch(batchId);
    this.access.assert('data.import', { companyId: batch.company_id });
    if (batch.state !== 'validated')
      throw new ConflictException(MSG.IMPORT_WRONG_STATE);
    const updated = await this.db.tx
      .updateTable('import_rows')
      .set({ status: 'skipped', skip_reason: dto.reason })
      .where('batch_id', '=', batch.id)
      .where('row_no', '=', rowNo)
      .where('status', 'in', ['valid', 'error'])
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 0)
      throw new NotFoundException(`Row ${rowNo} not found or already skipped`);
    await this.recount(batch.id);
    await this.audit.record({
      action: 'import.row_skipped',
      entity: 'import_batch',
      entityId: batch.id,
      after: { rowNo, reason: dto.reason },
    });
    return this.getBatch(batch.id);
  }

  /** Drop a batch that will not be committed (e.g. a corrected file was uploaded). */
  async discard(batchId: string) {
    const batch = await this.findBatch(batchId);
    this.access.assert('data.import', { companyId: batch.company_id });
    if (batch.state !== 'validated')
      throw new ConflictException(MSG.IMPORT_WRONG_STATE);
    await this.db.tx
      .updateTable('import_batches')
      .set({ state: 'discarded' })
      .where('id', '=', batch.id)
      .execute();
    await this.audit.record({
      action: 'import.discarded',
      entity: 'import_batch',
      entityId: batch.id,
    });
    return toBatchSummary(await this.findBatch(batch.id));
  }

  // ================================================================ dry run

  /** What commit would create now (rows checked again), with totals. */
  async dryRun(batchId: string) {
    const batch = await this.findBatch(batchId);
    this.access.assert('data.import', { companyId: batch.company_id });
    if (batch.state !== 'validated')
      throw new ConflictException(MSG.IMPORT_WRONG_STATE);
    const { results, staged } = await this.revalidate(batch);
    const ok = results.filter((r) => r.errors.length === 0 && r.value);
    const blocking = results.filter((r) => r.errors.length > 0);
    return {
      batchId: batch.id,
      entity: batch.entity,
      cutOverDate: batch.cut_over_date,
      willCreate: ok.length,
      skipped: staged.filter((r) => r.status === 'skipped').length,
      errors: blocking.map((r) => ({ rowNo: r.rowNo, errors: r.errors })),
      canCommit: blocking.length === 0 && ok.length > 0,
      totals: await this.totals(
        batch.entity,
        ok.map((r) => r.value!),
      ),
    };
  }

  // ================================================================ commit

  /** All rows (except skipped) are checked again and created in one transaction. */
  async commit(batchId: string) {
    // find batch, check access and state
    const batch = await this.findBatch(batchId);
    this.access.assert('data.import', { companyId: batch.company_id });
    if (batch.state !== 'validated')
      throw new ConflictException(MSG.IMPORT_WRONG_STATE);

    // validate again: the data may have changed since upload
    const { results } = await this.revalidate(batch);
    const blocking = results.filter((r) => r.errors.length > 0);
    if (blocking.length)
      throw new BadRequestException({
        message: MSG.IMPORT_HAS_ERRORS,
        details: {
          rows: blocking
            .slice(0, 100)
            .map((r) => ({ rowNo: r.rowNo, errors: r.errors })),
        },
      });
    if (results.length === 0)
      throw new BadRequestException(MSG.IMPORT_HAS_ERRORS);

    // create the records (any failure rolls back the whole request)
    const created = await this.create(batch, results);
    for (const [rowNo, record] of created) {
      await this.db.tx
        .updateTable('import_rows')
        .set({
          status: 'committed',
          created_record: record ? JSON.stringify(record) : null,
        })
        .where('batch_id', '=', batch.id)
        .where('row_no', '=', rowNo)
        .execute();
    }
    await this.db.tx
      .updateTable('import_batches')
      .set({
        state: 'committed',
        committed_at: this.clock.now(),
        committed_by: requestContext.get().userId ?? null,
      })
      .where('id', '=', batch.id)
      .execute();
    await this.recount(batch.id);
    await this.audit.record({
      action: 'import.committed',
      entity: 'import_batch',
      entityId: batch.id,
      after: { entity: batch.entity, created: created.size },
    });
    await this.outbox.add({
      type: 'import.committed',
      entityId: batch.id,
      payload: {
        batchId: batch.id,
        companyId: batch.company_id,
        entity: batch.entity,
        rows: created.size,
      },
    });
    return this.getBatch(batch.id);
  }

  // ================================================================ rollback

  /**
   * Remove what the batch created, newest first, until the reconciliation is
   * signed. Refused (and nothing removed) if any record is already used, e.g.
   * employees whose salaries were imported by a later batch.
   */
  async rollback(batchId: string, dto: ImportReasonDto) {
    const batch = await this.findBatch(batchId);
    this.access.assert('data.import', { companyId: batch.company_id });
    if (batch.state !== 'committed')
      throw new ConflictException(MSG.IMPORT_WRONG_STATE);

    const rows = await this.db.tx
      .selectFrom('import_rows')
      .selectAll()
      .where('batch_id', '=', batch.id)
      .where('status', '=', 'committed')
      .execute();
    const records = rows
      .map((r) => ({
        row: r,
        record: r.created_record as CreatedRecord | null,
      }))
      .sort((a, b) => (b.record?.seq ?? 0) - (a.record?.seq ?? 0));
    try {
      for (const { record } of records) {
        if (record)
          await sql`SELECT import_remove_record(${record.table}, ${record.id}::uuid)`.execute(
            this.db.tx,
          );
      }
    } catch (err) {
      throw new ConflictException({
        message: MSG.IMPORT_ROLLBACK_BLOCKED,
        details: { reason: (err as Error).message },
      });
    }

    await this.db.tx
      .updateTable('import_rows')
      .set({ status: 'rolled_back' })
      .where('batch_id', '=', batch.id)
      .where('status', '=', 'committed')
      .execute();
    await this.db.tx
      .updateTable('import_batches')
      .set({
        state: 'rolled_back',
        rolled_back_at: this.clock.now(),
        rolled_back_by: requestContext.get().userId ?? null,
        rollback_reason: dto.reason,
      })
      .where('id', '=', batch.id)
      .execute();
    await this.audit.record({
      action: 'import.rolled_back',
      entity: 'import_batch',
      entityId: batch.id,
      after: {
        entity: batch.entity,
        removed: records.filter((r) => r.record).length,
        reason: dto.reason,
      },
    });
    return toBatchSummary(await this.findBatch(batch.id));
  }

  // ================================================================ internals

  /** Lookups for validation, read fresh from the database. */
  private async buildContext(
    companyId: string,
    cutOverDate: string,
  ): Promise<ImportContext> {
    const codes = await this.org.codeMaps(companyId);
    const employees = await this.directory.byCode(companyId);
    const ids = [...employees.values()].map((e) => e.id);
    const facts = await this.payrollSetup.importFacts(ids);
    return {
      cutOverDate,
      ...codes,
      employees,
      structures: await this.payrollSetup.structuresByCode(companyId),
      leaveTypes: await this.leave.typesByCode(companyId),
      salaryDates: facts.salaryDates,
      ytdOpenings: facts.ytdOpenings,
      leaveOpenings: await this.leave.openingPairs(ids),
      employeesWithAccount: await this.bank.employeesWithAccount(ids),
      employeesWithLoan:
        await this.payrollVariables.employeesWithOpenLoan(companyId),
      ...(await this.crmContext(companyId)),
    };
  }

  /** Validate the batch's non-skipped rows again with today's data. */
  private async revalidate(
    batch: ImportBatch,
  ): Promise<{ results: RowResult[]; staged: ImportRow[] }> {
    const staged = await this.db.tx
      .selectFrom('import_rows')
      .selectAll()
      .where('batch_id', '=', batch.id)
      .orderBy('row_no')
      .execute();
    const ctx = await this.buildContext(batch.company_id, batch.cut_over_date);
    const active = staged.filter((r) => r.status !== 'skipped');
    const results = validateRows(
      batch.entity,
      active.map((r) => ({
        rowNo: r.row_no,
        cells: this.unseal(r.data as Record<string, string>),
      })),
      ctx,
    );
    return { results, staged };
  }

  /** Create every record; returns row number -> created record. */
  private async create(
    batch: ImportBatch,
    results: RowResult[],
  ): Promise<Map<number, CreatedRecord | null>> {
    const out = new Map<number, CreatedRecord | null>();
    let seq = 0;
    const done = (
      rowNo: number,
      table: CreatedRecord['table'],
      id: string | null,
    ) => out.set(rowNo, id ? { table, id, seq: ++seq } : null);

    switch (batch.entity) {
      case 'employees': {
        // managers first, so each line manager exists when their team is created
        const ids = await this.directory.byCode(batch.company_id);
        for (const r of managersFirst(results)) {
          const v = r.value as EmployeeRow;
          const lineManagerId = v.managerCode
            ? ids.get(v.managerCode)?.id
            : undefined;
          const employee = await this.employees.createEmployee({
            companyId: batch.company_id,
            employeeCode: v.code,
            fullNameEn: v.fullNameEn,
            fullNameBn: v.fullNameBn,
            gender: v.gender,
            dateOfBirth: v.dateOfBirth,
            nid: v.nid,
            tin: v.tin,
            phone: v.phone,
            personalEmail: v.personalEmail,
            joinDate: v.joinDate,
            branchId: v.branchId,
            departmentId: v.departmentId,
            designationId: v.designationId,
            gradeId: v.gradeId,
            lineManagerId,
            festivalGroup: v.festivalGroup,
          });
          await this.employees.activateImported(
            employee.id,
            v.status,
            v.probationEndDate ?? null,
          );
          ids.set(v.code, { id: employee.id, joinDate: v.joinDate });
          done(r.rowNo, 'employees', employee.id);
        }
        break;
      }
      case 'salaries':
        for (const r of results)
          done(
            r.rowNo,
            'employee_salaries',
            await this.payrollSetup.importSalary(r.value as SalaryRow),
          );
        break;
      case 'leave_balances':
        for (const r of results)
          done(
            r.rowNo,
            'leave_ledger',
            await this.leave.importOpening(
              r.value as LeaveBalanceRow,
              batch.cut_over_date,
              batch.company_id,
            ),
          );
        break;
      case 'ytd_openings':
        for (const r of results)
          done(
            r.rowNo,
            'payroll_ytd_openings',
            await this.payrollSetup.importYtdOpening(r.value as YtdRow),
          );
        break;
      case 'loans':
        for (const r of results)
          done(
            r.rowNo,
            'loans',
            await this.payrollVariables.importLoan(r.value as LoanRow),
          );
        break;
      case 'bank_accounts':
        for (const r of results) {
          const v = r.value as BankAccountRow;
          const details =
            v.kind === 'bank'
              ? {
                  kind: v.kind,
                  accountName: v.accountName,
                  bankName: v.bankName,
                  branchName: v.branchName,
                  routingNumber: v.routingNumber,
                  accountNumber: v.accountNumber,
                }
              : {
                  kind: v.kind,
                  accountName: v.accountName,
                  walletProvider: v.walletProvider,
                  walletNumber: v.walletNumber,
                };
          done(
            r.rowNo,
            'employee_bank_accounts',
            await this.bank.importApprovedAccount(v.employeeId, details),
          );
        }
        break;
      case 'customers':
        for (const r of results) {
          const v = r.value as CustomerRow;
          done(
            r.rowNo,
            'customers',
            await this.customers.importCustomer(batch.company_id, {
              kind: v.kind,
              name: v.name,
              nameBn: v.nameBn,
              customerType: v.customerType,
              bin: v.bin,
              tin: v.tin,
              phone: v.phone,
              email: v.email,
              address: v.address,
              district: v.district,
              accountManagerId: v.accountManagerId,
              creditLimit: v.creditLimit,
              paymentTermsDays: v.paymentTermsDays,
            }),
          );
        }
        break;
    }
    return out;
  }

  /** Dry-run totals per entity (per department where it matters). */
  private async totals(
    entity: ImportEntity,
    values: Array<NonNullable<RowResult['value']>>,
  ) {
    const departmentNames = async (ids: string[]) =>
      (await this.org.names({ departmentIds: ids })).departments;
    switch (entity) {
      case 'employees': {
        const rows = values as EmployeeRow[];
        const names = await departmentNames(rows.map((r) => r.departmentId));
        return {
          headcountByDepartment: countBy(
            rows,
            (r) => names.get(r.departmentId)?.code ?? '?',
          ),
          byStatus: countBy(rows, (r) => r.status),
        };
      }
      case 'salaries': {
        const rows = values as SalaryRow[];
        const latest = new Map<string, SalaryRow>();
        for (const r of rows)
          if (
            !latest.has(r.employeeId) ||
            latest.get(r.employeeId)!.effectiveFrom < r.effectiveFrom
          )
            latest.set(r.employeeId, r);
        const departmentOf = await this.departmentsOf([...latest.keys()]);
        const names = await departmentNames([...departmentOf.values()]);
        const gross = new Map<string, Money>();
        for (const r of latest.values()) {
          const key =
            names.get(departmentOf.get(r.employeeId) ?? '')?.code ?? '?';
          gross.set(key, (gross.get(key) ?? Money.zero()).plus(r.gross));
        }
        return {
          employees: latest.size,
          grossByDepartment: Object.fromEntries(
            [...gross].sort().map(([k, m]) => [k, m.toDb()]),
          ),
          totalGross: Money.sum([...gross.values()]).toDb(),
        };
      }
      case 'leave_balances': {
        const rows = values as LeaveBalanceRow[];
        const days = new Map<string, number>();
        for (const r of rows)
          days.set(r.leaveTypeCode, (days.get(r.leaveTypeCode) ?? 0) + r.days);
        return {
          daysByLeaveType: Object.fromEntries(
            [...days].sort().map(([k, d]) => [k, d.toFixed(2)]),
          ),
        };
      }
      case 'ytd_openings': {
        const rows = values as YtdRow[];
        return {
          employees: rows.length,
          taxableIncome: Money.sum(rows.map((r) => r.taxableIncome)).toDb(),
          taxWithheld: Money.sum(rows.map((r) => r.taxWithheld)).toDb(),
          pfEmployee: Money.sum(rows.map((r) => r.pfEmployee)).toDb(),
          pfEmployer: Money.sum(rows.map((r) => r.pfEmployer)).toDb(),
        };
      }
      case 'loans': {
        const rows = values as LoanRow[];
        return {
          loans: rows.length,
          outstanding: Money.sum(rows.map((r) => r.outstanding)).toDb(),
        };
      }
      case 'bank_accounts': {
        const rows = values as BankAccountRow[];
        return {
          accounts: rows.length,
          byChannel: countBy(rows, (r) =>
            r.kind === 'bank' ? 'bank' : r.walletProvider!,
          ),
        };
      }
      case 'customers': {
        const rows = values as CustomerRow[];
        return {
          customers: rows.length,
          byType: countBy(rows, (r) => r.customerType),
          creditLimits: Money.sum(rows.map((r) => r.creditLimit)).toDb(),
          withoutAccountManager: rows.filter((r) => !r.accountManagerId).length,
        };
      }
    }
  }

  /** Phones / e-mails taken in the CRM, and who may look after a customer (Sales users and Admins). */
  private async crmContext(companyId: string) {
    const keys = await this.db.tx
      .selectFrom('crm_contact_keys')
      .select(['kind', 'value'])
      .where('company_id', '=', companyId)
      .execute();
    const people = [
      ...(await this.crmAccess.salespeople(companyId)),
      ...(await this.access.usersWithSystemRole('admin', { companyId })),
    ];
    const users = people.length
      ? await this.db.tx
          .selectFrom('users')
          .select(['id', 'email'])
          .where('id', 'in', people)
          .execute()
      : [];
    return {
      crmKeys: new Set(keys.map((k) => `${k.kind}|${k.value}`)),
      accountManagers: new Map(users.map((u) => [u.email.toLowerCase(), u.id])),
    };
  }

  private async departmentsOf(
    employeeIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const id of employeeIds) {
      const p = await this.directory.currentOrFirstPlacement(id);
      if (p) map.set(id, p.departmentId);
    }
    return map;
  }

  private async recount(batchId: string): Promise<void> {
    const rows = await this.db.tx
      .selectFrom('import_rows')
      .select(['status'])
      .where('batch_id', '=', batchId)
      .execute();
    const n = (s: string) => rows.filter((r) => r.status === s).length;
    await this.db.tx
      .updateTable('import_batches')
      .set({
        total_rows: rows.length,
        valid_rows: n('valid') + n('committed'),
        error_rows: n('error'),
        skipped_rows: n('skipped'),
      })
      .where('id', '=', batchId)
      .execute();
  }

  private assertCanSee(companyId: string): void {
    if (
      !this.access.allows('data.import', { companyId }) &&
      !this.access.allows('data.import.sign_off', { companyId })
    ) {
      this.access.assert('data.import', { companyId });
    }
  }

  private async findBatch(id: string): Promise<ImportBatch> {
    const batch = await this.db.tx
      .selectFrom('import_batches')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!batch) throw new NotFoundException(MSG.IMPORT_BATCH_NOT_FOUND);
    return batch;
  }
}

// ------------------------------------------------------------------ helpers

/** Order employee rows so every line manager in the file comes before the people reporting to them. */
export function managersFirst(results: RowResult[]): RowResult[] {
  const byCode = new Map(
    results.map((r) => [(r.value as EmployeeRow).code, r]),
  );
  const placed = new Set<string>();
  const out: RowResult[] = [];
  const place = (r: RowResult) => {
    const v = r.value as EmployeeRow;
    if (placed.has(v.code)) return;
    placed.add(v.code);
    const manager = v.managerCode ? byCode.get(v.managerCode) : undefined;
    if (manager) place(manager);
    out.push(r);
  };
  results.forEach(place);
  return out;
}

/** Staged cells that hold identity or account numbers (encrypted at rest, masked when shown). */
const SENSITIVE_CELLS = new Set([
  'nid',
  'tin',
  'account_number',
  'wallet_number',
]);
const SEALED = 'enc:';

function countBy<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort());
}

function toBatchSummary(b: ImportBatch) {
  return {
    id: b.id,
    companyId: b.company_id,
    entity: b.entity,
    fileName: b.file_name,
    cutOverDate: b.cut_over_date,
    state: b.state,
    counts: {
      total: b.total_rows,
      valid: b.valid_rows,
      errors: b.error_rows,
      skipped: b.skipped_rows,
    },
    committedAt: b.committed_at,
    rolledBackAt: b.rolled_back_at,
    rollbackReason: b.rollback_reason,
    signoffId: b.signoff_id,
    createdAt: b.created_at,
  };
}
