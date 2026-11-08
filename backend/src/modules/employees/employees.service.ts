/**
 * Employee records (spec §6.1, guide §7.3).
 *
 * Life so far (WP1):  draft --activate--> probation (or active if no probation)
 * Probation reviews, notice of leaving and clearance: lifecycle.service.ts.
 *
 * Access (WP2): every method checks the caller's permission against the
 * employee's company / department / own record (EmployeeAccess). NID and TIN are
 * encrypted in the database and shown in full only to users who may see the
 * "identity" field group (HR, the employee themself, or an explicit grant);
 * everyone else gets "**** **** 4417".
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { auditDiff } from '../../platform/audit/audit-diff.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import {
  FieldEncryption,
  mask,
} from '../../platform/crypto/field-encryption.js';
import { EXPORT_MAX_ROWS, csvFile } from '../../platform/csv.js';
import {
  addDays,
  addMonths,
  businessDate,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import {
  assertUpdated,
  assertVersion,
  changesOnly,
} from '../../platform/db/optimistic-lock.js';
import type { Employee } from '../../platform/db/schema.js';
import type { Page } from '../../platform/http/common.dto.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import type { AccessResource } from '../identity/access/access-grants.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  CreateEmployeeDto,
  ExportEmployeesQueryDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
  UpdateOwnContactDto,
} from './dto/employee.dto.js';
import { EmployeeAccess } from './employee-access.js';
import { JobHistoryService } from './job-history.service.js';
import { OnboardingService } from './onboarding.service.js';

@Injectable()
export class EmployeesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly encryption: FieldEncryption,
    private readonly org: OrgLookupService,
    private readonly jobHistory: JobHistoryService,
    private readonly onboarding: OnboardingService,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
  ) {}

  async createEmployee(dto: CreateEmployeeDto) {
    const { tenantId } = requestContext.get();

    // may create employees in this company / department?
    this.access.assert('employee.manage', {
      companyId: dto.companyId,
      departmentId: dto.departmentId,
    });

    // check the first placement belongs to the company
    await this.org.assertPlacement(dto.companyId, {
      branchId: dto.branchId,
      departmentId: dto.departmentId,
      designationId: dto.designationId,
      gradeId: dto.gradeId,
    });

    // employee code: given, or the company's next number
    const employeeCode =
      dto.employeeCode ?? (await this.org.allocateEmployeeCode(dto.companyId));

    // save the employee in draft
    const employee = await this.db.tx
      .insertInto('employees')
      .values({
        company_id: dto.companyId,
        employee_code: employeeCode,
        full_name_en: dto.fullNameEn,
        full_name_bn: dto.fullNameBn ?? null,
        date_of_birth: dto.dateOfBirth ?? null,
        gender: dto.gender ?? null,
        nid_encrypted: dto.nid
          ? this.encryption.encrypt(tenantId, dto.nid)
          : null,
        tin_encrypted: dto.tin
          ? this.encryption.encrypt(tenantId, dto.tin)
          : null,
        personal_email: dto.personalEmail ?? null,
        phone: dto.phone ?? null,
        present_address: dto.presentAddress ?? null,
        permanent_address: dto.permanentAddress ?? null,
        emergency_contact_name: dto.emergencyContactName ?? null,
        emergency_contact_phone: dto.emergencyContactPhone ?? null,
        festival_group: dto.festivalGroup ?? null,
        join_date: dto.joinDate,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // joining placement (job history) and onboarding checklist
    await this.jobHistory.recordJoining(employee, {
      branch_id: dto.branchId,
      department_id: dto.departmentId,
      designation_id: dto.designationId,
      grade_id: dto.gradeId,
      line_manager_id: dto.lineManagerId ?? null,
      functional_manager_id: dto.functionalManagerId ?? null,
    });
    await this.onboarding.createChecklist(employee.id);

    // audit + event (spec §9: employee.created; no personal data in the payload)
    await this.audit.record({
      action: 'employee.created',
      entity: 'employee',
      entityId: employee.id,
      after: this.toAuditView(employee),
    });
    await this.outbox.add({
      type: 'employee.created',
      entityId: employee.id,
      payload: {
        employeeId: employee.id,
        companyId: employee.company_id,
        employeeCode,
        joinDate: employee.join_date,
      },
    });

    return this.getEmployee(employee.id);
  }

  async listEmployees(query: ListEmployeesQueryDto): Promise<Page<unknown>> {
    const q = await this.filteredEmployees(query);
    if (!q)
      return {
        items: [],
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
      };

    // count + page
    const { total } = await q
      .select(sql<number>`count(*)::int`.as('total'))
      .executeTakeFirstOrThrow();
    const rows = await q
      .selectAll()
      .orderBy('employee_code')
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
      .execute();

    // add today's placement to each row
    const placements = await this.jobHistory.currentPlacements(
      rows.map((r) => r.id),
    );
    return {
      items: rows.map((r) => ({
        ...this.toSummary(r),
        currentAssignment: placements.get(r.id) ?? null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /**
   * The employee list as a CSV file (HR asks for it for bank letters, audits and
   * inspections). Same filters and same access scope as the list; capped at
   * EXPORT_MAX_ROWS rows, and the download is audited like any other export of
   * personal data (spec §11). No salary, bank or identity field is included.
   */
  async exportEmployeesCsv(
    query: ExportEmployeesQueryDto,
  ): Promise<{ fileName: string; content: Buffer }> {
    const q = await this.filteredEmployees({
      ...query,
      page: 1,
      pageSize: EXPORT_MAX_ROWS,
    });
    const rows = q
      ? await q
          .selectAll()
          .orderBy('employee_code')
          .limit(EXPORT_MAX_ROWS)
          .execute()
      : [];
    const placements = await this.jobHistory.currentPlacements(
      rows.map((r) => r.id),
    );

    const header = [
      'employee_code',
      'name_en',
      'name_bn',
      'status',
      'join_date',
      'probation_end_date',
      'last_working_day',
      'branch',
      'department',
      'designation',
      'grade',
      'line_manager',
      'phone',
      'personal_email',
      'festival_group',
    ];
    const lines = rows.map((r) => {
      const p = placements.get(r.id);
      return [
        r.employee_code,
        r.full_name_en,
        r.full_name_bn,
        r.status,
        r.join_date,
        r.probation_end_date,
        r.last_working_day,
        p?.branch.name,
        p?.department.name,
        p?.designation.nameEn,
        p?.grade.code,
        p?.lineManager && 'employeeCode' in p.lineManager
          ? `${p.lineManager.employeeCode} ${p.lineManager.fullNameEn}`.trim()
          : null,
        r.phone,
        r.personal_email,
        r.festival_group,
      ];
    });

    await this.audit.record({
      action: 'employee.exported',
      entity: 'employee',
      entityId: query.companyId ?? null,
      after: { rows: rows.length, filters: query },
    });

    return {
      fileName: `employees-${todayInDhaka()}.csv`,
      content: csvFile(header, lines),
    };
  }

  /**
   * The employee rows this caller may see, narrowed by the query's filters.
   * `null` means the caller may see nothing at all.
   */
  private async filteredEmployees(query: ListEmployeesQueryDto) {
    let q = this.db.tx.selectFrom('employees');
    const today = todayInDhaka();

    // only employees the caller may see (company / department / own)
    const scope = this.access.scopeFilter('employee.view');
    if (!scope.all) {
      if (
        !scope.companyIds.length &&
        !scope.departmentIds.length &&
        !scope.employeeIds.length
      )
        return null;
      q = q.where((eb) =>
        eb.or([
          ...(scope.companyIds.length
            ? [eb('company_id', 'in', scope.companyIds)]
            : []),
          ...(scope.employeeIds.length
            ? [eb('id', 'in', scope.employeeIds)]
            : []),
          ...(scope.departmentIds.length
            ? [
                eb('id', 'in', (sub) =>
                  sub
                    .selectFrom('employee_assignments')
                    .select('employee_id')
                    .where('department_id', 'in', scope.departmentIds)
                    .where('effective_from', '<=', today)
                    .where((w) =>
                      w.or([
                        w('effective_to', 'is', null),
                        w('effective_to', '>', today),
                      ]),
                    ),
                ),
              ]
            : []),
        ]),
      );
    }

    // filters
    if (query.companyId) q = q.where('company_id', '=', query.companyId);
    if (query.status) q = q.where('status', '=', query.status);
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      q = q.where((eb) =>
        eb.or([
          eb('full_name_en', 'ilike', like),
          eb('full_name_bn', 'ilike', like),
          eb('employee_code', 'ilike', like),
        ]),
      );
    }
    if (query.departmentId) {
      // the department and everything below it, using today's placement
      const departmentIds = await this.org.departmentWithDescendants(
        query.departmentId,
      );
      q = q.where('id', 'in', (eb) =>
        eb
          .selectFrom('employee_assignments')
          .select('employee_id')
          .where(
            'department_id',
            'in',
            departmentIds.length ? departmentIds : [query.departmentId!],
          )
          .where('effective_from', '<=', today)
          .where((w) =>
            w.or([
              w('effective_to', 'is', null),
              w('effective_to', '>', today),
            ]),
          ),
      );
    }
    // branch and designation: today's placement decides (a transfer moves the employee)
    for (const [column, value] of [
      ['branch_id', query.branchId],
      ['designation_id', query.designationId],
    ] as const) {
      if (!value) continue;
      q = q.where('id', 'in', (eb) =>
        eb
          .selectFrom('employee_assignments')
          .select('employee_id')
          .where(column, '=', value)
          .where('effective_from', '<=', today)
          .where((w) =>
            w.or([
              w('effective_to', 'is', null),
              w('effective_to', '>', today),
            ]),
          ),
      );
    }

    return q;
  }

  async getEmployee(id: string) {
    const employee = await this.employeeAccess.check('employee.view', id);
    const resource = await this.employeeAccess.resourceOf(employee);
    const placements = await this.jobHistory.currentPlacements([id]);
    return {
      ...this.toResponse(employee, resource),
      currentAssignment: placements.get(id) ?? null,
    };
  }

  async updateEmployee(id: string, dto: UpdateEmployeeDto) {
    const { tenantId } = requestContext.get();

    // find, check access and version
    const before = await this.employeeAccess.check('employee.manage', id);
    assertVersion(before, dto.version);

    // joining date: only while draft; moves the joining event too
    const joinDateChanged =
      dto.joinDate !== undefined && dto.joinDate !== before.join_date;
    if (joinDateChanged && before.status !== 'draft')
      throw new BadRequestException(MSG.EMPLOYEE_JOIN_DATE_LOCKED);

    // collect the fields that were sent
    const changes = changesOnly({
      full_name_en: dto.fullNameEn,
      full_name_bn: dto.fullNameBn,
      date_of_birth: dto.dateOfBirth,
      gender: dto.gender,
      nid_encrypted:
        dto.nid !== undefined
          ? this.encryption.encrypt(tenantId, dto.nid)
          : undefined,
      tin_encrypted:
        dto.tin !== undefined
          ? this.encryption.encrypt(tenantId, dto.tin)
          : undefined,
      personal_email: dto.personalEmail,
      phone: dto.phone,
      present_address: dto.presentAddress,
      permanent_address: dto.permanentAddress,
      emergency_contact_name: dto.emergencyContactName,
      emergency_contact_phone: dto.emergencyContactPhone,
      festival_group: dto.festivalGroup,
      join_date: joinDateChanged ? dto.joinDate : undefined,
    });
    if (!changes) return this.getEmployee(id);

    // save
    const result = await this.db.tx
      .updateTable('employees')
      .set(changes)
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .executeTakeFirst();
    assertUpdated(result);
    if (joinDateChanged)
      await this.jobHistory.moveJoiningDate(
        before,
        businessDate(dto.joinDate!),
      );

    const after = await this.employeeAccess.find(id);
    await this.audit.record({
      action: 'employee.updated',
      entity: 'employee',
      entityId: id,
      ...auditDiff(before, after),
    });
    return this.getEmployee(id);
  }

  /**
   * Draft -> probation (or active when the company has no probation).
   * Requires a complete onboarding checklist (spec §6.1).
   */
  async activateEmployee(id: string) {
    // find employee and check access
    const employee = await this.employeeAccess.check('employee.manage', id);
    if (employee.status !== 'draft')
      throw new BadRequestException(MSG.EMPLOYEE_NOT_DRAFT);

    // checklist must be complete
    if (!(await this.onboarding.isComplete(id)))
      throw new BadRequestException(MSG.ONBOARDING_INCOMPLETE);

    // probation length from company settings
    const { probationMonths } = await this.org.getCompanyRules(
      employee.company_id,
    );
    const joinDate = businessDate(employee.join_date);
    const probationEnd =
      probationMonths > 0
        ? addDays(addMonths(joinDate, probationMonths), -1)
        : null;

    // save
    await this.db.tx
      .updateTable('employees')
      .set({
        status: probationEnd ? 'probation' : 'active',
        probation_end_date: probationEnd,
        activated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'employee.activated',
      entity: 'employee',
      entityId: id,
      before: { status: 'draft' },
      after: {
        status: probationEnd ? 'probation' : 'active',
        probationEndDate: probationEnd,
      },
    });
    return this.getEmployee(id);
  }

  /**
   * Data migration (WP8): an imported employee was already working before
   * go-live, so onboarding is marked done and the status is set as given.
   */
  async activateImported(
    id: string,
    status: 'active' | 'probation',
    probationEndDate: string | null,
  ): Promise<void> {
    await this.onboarding.completeAllForImport(id);
    await this.db.tx
      .updateTable('employees')
      .set({
        status,
        probation_end_date: probationEndDate,
        activated_at: new Date(),
      })
      .where('id', '=', id)
      .where('status', '=', 'draft')
      .execute();
    await this.audit.record({
      action: 'employee.activated',
      entity: 'employee',
      entityId: id,
      after: { status, probationEndDate, source: 'data migration' },
    });
  }

  /** Called by payroll inside the final settlement approval. */
  async markSeparated(id: string): Promise<void> {
    await this.db.tx
      .updateTable('employees')
      .set({ status: 'separated' })
      .where('id', '=', id)
      .execute();
    await this.db.tx
      .updateTable('separations')
      .set({ state: 'separated', separated_at: new Date() })
      .where('employee_id', '=', id)
      .where('state', '=', 'in_notice')
      .execute();
    await this.audit.record({
      action: 'employee.separated',
      entity: 'employee',
      entityId: id,
      after: { status: 'separated' },
    });
  }

  /** The signed-in user's own employee profile (self-service). */
  async getOwnProfile() {
    return this.getEmployee(this.ownEmployeeId());
  }

  /** Employees edit their own contact details (spec §3); everything else stays with HR. */
  async updateOwnContact(dto: UpdateOwnContactDto) {
    // find own record and check version
    const id = this.ownEmployeeId();
    const before = await this.employeeAccess.check(
      'employee.contact.edit_own',
      id,
    );
    assertVersion(before, dto.version);

    // collect the fields that were sent
    const changes = changesOnly({
      personal_email: dto.personalEmail,
      phone: dto.phone,
      present_address: dto.presentAddress,
      emergency_contact_name: dto.emergencyContactName,
      emergency_contact_phone: dto.emergencyContactPhone,
    });
    if (!changes) return this.getEmployee(id);

    // save
    const result = await this.db.tx
      .updateTable('employees')
      .set(changes)
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .executeTakeFirst();
    assertUpdated(result);

    const after = await this.employeeAccess.find(id);
    await this.audit.record({
      action: 'employee.contact_updated_by_self',
      entity: 'employee',
      entityId: id,
      ...auditDiff(before, after),
    });
    return this.getEmployee(id);
  }

  // ------------------------------------------------------------------ helpers

  private ownEmployeeId(): string {
    const employeeId = this.access.current().employeeId;
    if (!employeeId) throw new NotFoundException(MSG.EMPLOYEE_NOT_FOUND);
    return employeeId;
  }

  /** Full value for users who may see identity fields; otherwise masked. */
  private identityField(
    employee: Employee,
    value: string | null,
    resource: AccessResource,
  ): string | null {
    if (!value) return null;
    const plain = this.encryption.decrypt(employee.tenant_id, value);
    return this.access.canSeeField('identity', resource) ? plain : mask(plain);
  }

  private toSummary(e: Employee) {
    return {
      id: e.id,
      companyId: e.company_id,
      employeeCode: e.employee_code,
      fullNameEn: e.full_name_en,
      fullNameBn: e.full_name_bn,
      status: e.status,
      joinDate: e.join_date,
    };
  }

  private toResponse(e: Employee, resource: AccessResource) {
    return {
      ...this.toSummary(e),
      dateOfBirth: e.date_of_birth,
      gender: e.gender,
      nid: this.identityField(e, e.nid_encrypted, resource),
      tin: this.identityField(e, e.tin_encrypted, resource),
      personalEmail: e.personal_email,
      phone: e.phone,
      presentAddress: e.present_address,
      permanentAddress: e.permanent_address,
      emergencyContact: {
        name: e.emergency_contact_name,
        phone: e.emergency_contact_phone,
      },
      festivalGroup: e.festival_group,
      probationEndDate: e.probation_end_date,
      lastWorkingDay: e.last_working_day,
      confirmedAt: e.confirmed_at,
      activatedAt: e.activated_at,
      version: e.version,
    };
  }

  /** What the audit log keeps on creation: no NID/TIN values. */
  private toAuditView(e: Employee) {
    return {
      ...this.toSummary(e),
      hasNid: e.nid_encrypted !== null,
      hasTin: e.tin_encrypted !== null,
    };
  }
}
