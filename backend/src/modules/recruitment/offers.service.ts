/**
 * Job offers (WP29).
 *
 *   make(applicationId, dto)  HR writes the offer: placement, gross salary, joining date,
 *                             probation, validity. A salary outside the grade's range is
 *                             marked and cannot be sent until the ADMIN approves it
 *                             (request type 'job_offer'), which is the same shape as every
 *                             other "above the limit" rule in the product (spec §5).
 *   send / accept / decline / withdraw
 *   accept                    makes the employee record from the applicant's own data
 *                             (applicants.service.hire): nothing is retyped.
 *   letter(offerId)           the offer letter as a PDF, from the template.
 *
 * The salary is a sensitive field: the amount is returned only to someone who may see
 * salaries (field group 'salary'), exactly as on an employee record.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  businessDate,
  fiscalYearOf,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { ApprovalRequest, JobOffer } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { defaultChain, step } from '../approvals/chains.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { ApplicantsService } from './applicants.service.js';
import { renderOfferLetterPdf } from './offer-letter-pdf.js';
import type {
  DeclineOfferDto,
  OfferDto,
  WithdrawOfferDto,
} from './dto/recruitment.dto.js';

export const JOB_OFFER_REQUEST = 'job_offer';

@Injectable()
export class OffersService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly applicants: ApplicantsService,
  ) {}

  onModuleInit() {
    this.handlers.register(
      JOB_OFFER_REQUEST,
      {
        onApproved: (r) => this.approved(r),
        onClosed: (r, outcome) => this.closed(r, outcome),
      },
      // only an offer outside the grade's range goes through this chain, and then it is the
      // Admin's call (spec §5 "above threshold -> Admin")
      [defaultChain('Offer outside the grade range', step(1, 'role:admin'))],
    );
  }

  async make(applicationId: string, dto: OfferDto) {
    const application = await this.applicants.findApplication(applicationId);
    this.access.assert('recruitment.manage', {
      companyId: application.company_id,
    });
    if (!['shortlisted', 'interviewing', 'offered'].includes(application.state))
      throw new ConflictException(MSG.APPLICATION_WRONG_STATE);
    const live = await this.db.tx
      .selectFrom('job_offers')
      .select('id')
      .where('application_id', '=', applicationId)
      .where('state', 'in', [
        'draft',
        'in_approval',
        'approved',
        'sent',
        'accepted',
      ])
      .executeTakeFirst();
    if (live) throw new ConflictException(MSG.OFFER_LIVE_EXISTS);

    await this.org.assertPlacement(application.company_id, {
      branchId: dto.branchId,
      departmentId: dto.departmentId,
      designationId: dto.designationId,
      gradeId: dto.gradeId,
    });
    const joining = businessDate(dto.joiningOn);
    const validUntil = businessDate(dto.validUntil);
    if (validUntil < todayInDhaka(this.clock.now()))
      throw new BadRequestException(MSG.INVALID_DATE);

    const grade = await this.db.tx
      .selectFrom('grades')
      .select(['salary_min', 'salary_max'])
      .where('id', '=', dto.gradeId)
      .executeTakeFirstOrThrow();
    const gross = Money.of(dto.grossSalary);
    const outside =
      (!!grade.salary_min && gross.compare(Money.of(grade.salary_min)) < 0) ||
      (!!grade.salary_max && gross.compare(Money.of(grade.salary_max)) > 0);

    const offer = await this.db.tx
      .insertInto('job_offers')
      .values({
        company_id: application.company_id,
        number: await this.nextNumber(application.company_id),
        application_id: applicationId,
        branch_id: dto.branchId,
        department_id: dto.departmentId,
        designation_id: dto.designationId,
        grade_id: dto.gradeId,
        gross_salary: gross.toString(),
        outside_grade_range: outside,
        joining_on: joining,
        probation_months: dto.probationMonths ?? 6,
        valid_until: validUntil,
        terms: dto.terms ?? null,
        state: 'draft',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    if (application.state !== 'offered')
      await this.applicants.setState(
        application,
        'offered',
        `Offer ${offer.number} prepared`,
      );

    // outside the grade range: the Admin decides before it can go out
    if (outside) {
      const applicant = await this.applicants.find(application.applicant_id);
      const approval = await this.approvals.submit({
        requestType: JOB_OFFER_REQUEST,
        sourceId: offer.id,
        subjectEmployeeId: null,
        companyId: application.company_id,
        amount: gross.toString(),
        summary: `Offer ${offer.number}: salary outside the grade range (${applicant.full_name_en})`,
        snapshot: {
          number: offer.number,
          gradeMin: grade.salary_min,
          gradeMax: grade.salary_max,
          joiningOn: joining,
        },
      });
      await this.db.tx
        .updateTable('job_offers')
        .set({ state: 'in_approval', approval_request_id: approval.id })
        .where('id', '=', offer.id)
        .execute();
    }

    await this.audit.record({
      action: 'job_offer.made',
      entity: 'job_offer',
      entityId: offer.id,
      after: {
        number: offer.number,
        joiningOn: joining,
        outsideGradeRange: outside,
      },
    });
    return this.get(offer.id);
  }

  async send(offerId: string) {
    const offer = await this.find(offerId);
    this.access.assert('recruitment.manage', { companyId: offer.company_id });
    if (offer.state === 'in_approval')
      throw new ConflictException(MSG.OFFER_NEEDS_APPROVAL);
    if (!['draft', 'approved'].includes(offer.state))
      throw new ConflictException(MSG.OFFER_WRONG_STATE);
    await this.patch(offerId, { state: 'sent', sent_at: this.clock.now() });
    await this.audit.record({
      action: 'job_offer.sent',
      entity: 'job_offer',
      entityId: offerId,
      after: { number: offer.number },
    });
    await this.outbox.add({
      type: 'job_offer.sent',
      entityId: offerId,
      payload: {
        offerId,
        companyId: offer.company_id,
        number: offer.number,
        applicationId: offer.application_id,
        joiningOn: offer.joining_on,
      },
    });
    return this.get(offerId);
  }

  /** The candidate said yes: the employee record is created from the applicant's own data. */
  async accept(offerId: string) {
    const offer = await this.find(offerId);
    this.access.assert('recruitment.manage', { companyId: offer.company_id });
    if (offer.state !== 'sent')
      throw new ConflictException(MSG.OFFER_WRONG_STATE);
    if (businessDate(offer.valid_until) < todayInDhaka(this.clock.now())) {
      await this.patch(offerId, { state: 'expired' });
      throw new ConflictException(MSG.OFFER_WRONG_STATE);
    }
    const hired = await this.applicants.hire(offer.application_id, offer);
    await this.patch(offerId, {
      state: 'accepted',
      decided_at: this.clock.now(),
    });
    await this.audit.record({
      action: 'job_offer.accepted',
      entity: 'job_offer',
      entityId: offerId,
      after: {
        number: offer.number,
        employeeId: hired.employee.id,
        employeeCode: hired.employee.employeeCode,
      },
    });
    return {
      ...(await this.get(offerId)),
      employee: {
        id: hired.employee.id,
        employeeCode: hired.employee.employeeCode,
        status: hired.employee.status,
      },
      openingFilled: hired.openingFilled,
    };
  }

  async decline(offerId: string, dto: DeclineOfferDto) {
    const offer = await this.find(offerId);
    this.access.assert('recruitment.manage', { companyId: offer.company_id });
    if (offer.state !== 'sent')
      throw new ConflictException(MSG.OFFER_WRONG_STATE);
    await this.patch(offerId, {
      state: 'declined',
      decline_reason: dto.reason,
      decided_at: this.clock.now(),
    });
    const application = await this.applicants.findApplication(
      offer.application_id,
    );
    await this.applicants.setState(
      application,
      'rejected',
      `Offer ${offer.number} declined: ${dto.reason}`,
      { rejected_reason: `Offer declined: ${dto.reason}` },
    );
    return this.get(offerId);
  }

  async withdraw(offerId: string, dto: WithdrawOfferDto) {
    const offer = await this.find(offerId);
    this.access.assert('recruitment.manage', { companyId: offer.company_id });
    if (!['draft', 'in_approval', 'approved', 'sent'].includes(offer.state))
      throw new ConflictException(MSG.OFFER_WRONG_STATE);
    if (offer.approval_request_id && offer.state === 'in_approval')
      await this.approvals.cancel(offer.approval_request_id, dto.reason);
    await this.patch(offerId, {
      state: 'withdrawn',
      decline_reason: dto.reason,
      decided_at: this.clock.now(),
    });
    await this.audit.record({
      action: 'job_offer.withdrawn',
      entity: 'job_offer',
      entityId: offerId,
      after: { number: offer.number, reason: dto.reason },
    });
    return this.get(offerId);
  }

  async get(offerId: string) {
    const offer = await this.find(offerId);
    const companyId = offer.company_id;
    // the post's own department, so the Dept Head who asked for it may read the offer
    const resource = { companyId, departmentId: offer.department_id };
    if (
      !this.access.allows('recruitment.view', resource) &&
      !this.access.allows('recruitment.manage', resource)
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    const application = await this.applicants.findApplication(
      offer.application_id,
    );
    const applicant = await this.applicants.find(application.applicant_id);
    const names = await this.org.names({
      branchIds: [offer.branch_id],
      departmentIds: [offer.department_id],
      designationIds: [offer.designation_id],
      gradeIds: [offer.grade_id],
    });
    // the salary is a sensitive field, as on an employee record
    const seesSalary = this.access.canSeeField('salary', { companyId });
    return {
      id: offer.id,
      number: offer.number,
      companyId,
      applicationId: offer.application_id,
      applicantName: applicant.redacted_at ? null : applicant.full_name_en,
      branchId: offer.branch_id,
      branchName: names.branches.get(offer.branch_id)?.name ?? null,
      departmentId: offer.department_id,
      departmentName: names.departments.get(offer.department_id)?.name ?? null,
      designationId: offer.designation_id,
      designationName:
        names.designations.get(offer.designation_id)?.nameEn ?? null,
      gradeId: offer.grade_id,
      gradeName: names.grades.get(offer.grade_id)?.name ?? null,
      grossSalary: seesSalary ? offer.gross_salary : null,
      outsideGradeRange: offer.outside_grade_range,
      approvalRequestId: offer.approval_request_id,
      joiningOn: offer.joining_on,
      probationMonths: offer.probation_months,
      validUntil: offer.valid_until,
      terms: offer.terms,
      state: offer.state,
      declineReason: offer.decline_reason,
      sentAt: offer.sent_at,
      decidedAt: offer.decided_at,
      createdAt: offer.created_at,
      version: offer.version,
    };
  }

  /** The letter the candidate gets. Only someone who may see the salary may print it. */
  async letter(offerId: string, language: 'bn' | 'en') {
    const offer = await this.find(offerId);
    this.access.assert('recruitment.manage', { companyId: offer.company_id });
    if (!this.access.canSeeField('salary', { companyId: offer.company_id }))
      throw new ForbiddenException(MSG.FORBIDDEN);
    const application = await this.applicants.findApplication(
      offer.application_id,
    );
    const applicant = await this.applicants.find(application.applicant_id);
    const company = await this.org.companyNames(offer.company_id);
    const names = await this.org.names({
      branchIds: [offer.branch_id],
      departmentIds: [offer.department_id],
      designationIds: [offer.designation_id],
      gradeIds: [offer.grade_id],
    });
    return renderOfferLetterPdf({
      lang: language,
      companyName: company.legalName,
      number: offer.number,
      issuedOn: todayInDhaka(this.clock.now()),
      candidateName: applicant.full_name_en,
      designation: names.designations.get(offer.designation_id)?.nameEn ?? '',
      department: names.departments.get(offer.department_id)?.name ?? '',
      branch: names.branches.get(offer.branch_id)?.name ?? '',
      grade: names.grades.get(offer.grade_id)?.name ?? '',
      grossSalary: offer.gross_salary,
      joiningOn: offer.joining_on,
      probationMonths: offer.probation_months,
      validUntil: offer.valid_until,
      terms: offer.terms,
    });
  }

  // ================================================================ approval

  private async approved(r: ApprovalRequest) {
    await this.db.tx
      .updateTable('job_offers')
      .set({ state: 'approved' })
      .where('id', '=', r.source_id)
      .where('state', '=', 'in_approval')
      .execute();
  }

  private async closed(
    r: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    if (outcome === 'returned') return;
    await this.db.tx
      .updateTable('job_offers')
      .set({
        state: 'withdrawn',
        decided_at: this.clock.now(),
        decline_reason:
          outcome === 'rejected'
            ? 'The Admin did not approve the salary'
            : 'Withdrawn',
      })
      .where('id', '=', r.source_id)
      .where('state', '=', 'in_approval')
      .execute();
  }

  // ================================================================= helpers

  async find(offerId: string): Promise<JobOffer> {
    const offer = await this.db.tx
      .selectFrom('job_offers')
      .selectAll()
      .where('id', '=', offerId)
      .executeTakeFirst();
    if (!offer) throw new NotFoundException(MSG.OFFER_NOT_FOUND);
    return offer;
  }

  /** Offers past their validity, for the daily job: nobody can accept them any more. */
  async expireOverdue(): Promise<number> {
    const today = todayInDhaka(this.clock.now());
    const result = await this.db.tx
      .updateTable('job_offers')
      .set({ state: 'expired' })
      .where('state', 'in', ['draft', 'approved', 'sent'])
      .where('valid_until', '<', today)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  private async patch(offerId: string, values: Record<string, unknown>) {
    await this.db.tx
      .updateTable('job_offers')
      .set(values as never)
      .where('id', '=', offerId)
      .execute();
  }

  private async nextNumber(companyId: string): Promise<string> {
    const fy = fiscalYearOf(todayInDhaka(this.clock.now()), '07-01');
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'job_offer',
        fiscal_year_code: fy,
        last_no: 1,
      })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'company_id', 'kind', 'fiscal_year_code'])
          .doUpdateSet({ last_no: sql`payables_sequences.last_no + 1` }),
      )
      .returning('last_no')
      .executeTakeFirstOrThrow();
    return `OF/${fy}/${String(row.last_no).padStart(5, '0')}`;
  }
}
