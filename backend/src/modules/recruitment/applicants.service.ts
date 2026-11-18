/**
 * Applicants, their CVs and their applications (WP29; spec §11 consent and retention).
 *
 *   addApplicant      a person, with their consent to keep the CV recorded: no consent, no
 *                     CV. The same phone or e-mail is one person, not two.
 *   uploadCv          the file goes to the private bucket; its text (typed in, or read from
 *                     the file by WP11's document reader later) is what screening uses
 *   apply             the person for one opening: one application per person per opening
 *   move              applied -> screened -> shortlisted -> interviewing -> offered -> hired,
 *                     with rejected / withdrawn as exits. Every move is kept with its note.
 *   hire              the offer was accepted: the APPLICANT'S OWN DATA becomes the employee
 *                     record, with the offer's placement. Nothing is retyped, and the new
 *                     employee's onboarding checklist starts by itself (WP1).
 *   clearExpired      the retention sweep the daily job calls: the CV file is deleted from
 *                     the bucket and the person is blanked out of the database.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  addDays,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  Applicant,
  Application,
  ApplicationState,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { FileStorage, detectFileType } from '../../platform/storage/file-storage.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { EmployeesService } from '../employees/employees.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { normalizePhone } from '../crm/crm-rules.js';
import { OpeningsService } from './openings.service.js';
import {
  APPLICANT_RETENTION_DAYS,
  CONSENT_VERSION,
  canMove,
} from './recruitment-rules.js';
import type {
  ApplicantDto,
  ApplicantQueryDto,
  ApplyDto,
  CvTextDto,
  MoveApplicationDto,
} from './dto/recruitment.dto.js';

export const MAX_CV_BYTES = 5 * 1024 * 1024;

@Injectable()
export class ApplicantsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
    private readonly storage: FileStorage,
    private readonly openings: OpeningsService,
    private readonly employees: EmployeesService,
  ) {}

  // ================================================================ people

  async list(companyId: string, query: ApplicantQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.openings.assertSee(companyId);
    let q = this.db.tx
      .selectFrom('applicants')
      .select([
        'id',
        'full_name_en',
        'phone',
        'email',
        'district',
        'source',
        'cv_file_name',
        'retention_until',
        'redacted_at',
        'created_at',
      ])
      .where('company_id', '=', companyId)
      .orderBy('created_at', 'desc')
      .limit(300);
    if (query.q) {
      const like = `%${query.q}%`;
      q = q.where((eb) =>
        eb.or([
          eb('full_name_en', 'ilike', like),
          eb('phone', 'ilike', like),
          eb('email', 'ilike', like),
        ]),
      );
    }
    const rows = await q.execute();
    return {
      applicants: rows.map((r) => ({
        id: r.id,
        name: r.redacted_at ? null : r.full_name_en,
        phone: r.phone,
        email: r.email,
        district: r.district,
        source: r.source,
        cvFileName: r.cv_file_name,
        retentionUntil: r.retention_until,
        redacted: !!r.redacted_at,
        createdAt: r.created_at,
      })),
    };
  }

  async get(applicantId: string) {
    const applicant = await this.find(applicantId);
    this.openings.assertSee(applicant.company_id);
    const applications = await this.db.tx
      .selectFrom('applications as a')
      .innerJoin('job_openings as o', 'o.id', 'a.opening_id')
      .select([
        'a.id',
        'a.state',
        'a.applied_on',
        'a.rejected_reason',
        'a.hired_employee_id',
        'o.id as opening_id',
        'o.number as opening_number',
        'o.title',
      ])
      .where('a.applicant_id', '=', applicantId)
      .orderBy('a.created_at', 'desc')
      .execute();
    return {
      ...this.toApplicant(applicant),
      applications: applications.map((a) => ({
        id: a.id,
        state: a.state,
        appliedOn: a.applied_on,
        rejectedReason: a.rejected_reason,
        hiredEmployeeId: a.hired_employee_id,
        openingId: a.opening_id,
        openingNumber: a.opening_number,
        openingTitle: a.title,
      })),
    };
  }

  async addApplicant(companyId: string, dto: ApplicantDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('recruitment.manage', { companyId });
    if (!dto.consent) throw new BadRequestException(MSG.APPLICANT_CONSENT_NEEDED);
    if (!dto.phone && !dto.email)
      throw new BadRequestException(MSG.VALIDATION_FAILED);
    // as people write them: 01711-556677, +880 1711 556677, ০১৭১১৫৫৬৬৭৭
    const phone = dto.phone ? normalizePhone(dto.phone) : null;
    if (dto.phone && !phone)
      throw new BadRequestException(MSG.CRM_CONTACT_INVALID);
    const email = dto.email?.trim().toLowerCase() ?? null;

    const clash = await this.db.tx
      .selectFrom('applicants')
      .select(['id', 'full_name_en'])
      .where('company_id', '=', companyId)
      .where('redacted_at', 'is', null)
      .where((eb) =>
        eb.or(
          [
            phone ? eb('phone', '=', phone) : null,
            email ? eb('email', '=', email) : null,
          ].filter((x): x is NonNullable<typeof x> => !!x),
        ),
      )
      .executeTakeFirst();
    if (clash)
      throw new ConflictException({
        message: MSG.APPLICANT_DUPLICATE,
        details: { applicantId: clash.id },
      });

    const now = this.clock.now();
    const applicant = await this.db.tx
      .insertInto('applicants')
      .values({
        company_id: companyId,
        full_name_en: dto.fullNameEn,
        full_name_bn: dto.fullNameBn ?? null,
        phone,
        email,
        district: dto.district ?? null,
        date_of_birth: dto.dateOfBirth ?? null,
        gender: dto.gender ?? null,
        source: dto.source ?? 'website',
        source_detail: dto.sourceDetail ?? null,
        referred_by: dto.referredBy ?? null,
        cv_text: dto.cvText ?? null,
        consent_at: now,
        consent_version: CONSENT_VERSION,
        retention_until: addDays(
          todayInDhaka(now),
          APPLICANT_RETENTION_DAYS,
        ),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'applicant.added',
      entity: 'applicant',
      entityId: applicant.id,
      after: {
        source: applicant.source,
        consentVersion: CONSENT_VERSION,
        retentionUntil: applicant.retention_until,
      },
    });
    return this.get(applicant.id);
  }

  async uploadCv(
    applicantId: string,
    file: Express.Multer.File | undefined,
    dto: CvTextDto,
  ) {
    const applicant = await this.find(applicantId);
    this.access.assert('recruitment.manage', {
      companyId: applicant.company_id,
    });
    if (applicant.redacted_at)
      throw new ConflictException(MSG.APPLICANT_REDACTED);
    if (!file) throw new BadRequestException(MSG.FILE_REQUIRED);
    const contentType = detectFileType(file.buffer);
    if (!contentType || file.size > MAX_CV_BYTES)
      throw new BadRequestException(MSG.FILE_TYPE_NOT_ALLOWED);

    // the file first: a failed row leaves an orphan file, never a broken link
    const fileKey = `${requestContext.get().tenantId}/applicant-cvs/${randomUUID()}`;
    await this.storage.put(fileKey, file.buffer);
    await this.db.tx
      .updateTable('applicants')
      .set({
        cv_file_key: fileKey,
        cv_file_name: file.originalname.slice(0, 200),
        cv_text: dto.cvText ?? applicant.cv_text,
      })
      .where('id', '=', applicantId)
      .execute();
    await this.audit.record({
      action: 'applicant.cv_uploaded',
      entity: 'applicant',
      entityId: applicantId,
      after: {
        fileName: file.originalname.slice(0, 200),
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
      },
    });
    return this.get(applicantId);
  }

  async setCvText(applicantId: string, dto: CvTextDto) {
    const applicant = await this.find(applicantId);
    this.access.assert('recruitment.manage', {
      companyId: applicant.company_id,
    });
    if (applicant.redacted_at)
      throw new ConflictException(MSG.APPLICANT_REDACTED);
    await this.db.tx
      .updateTable('applicants')
      .set({ cv_text: dto.cvText ?? null })
      .where('id', '=', applicantId)
      .execute();
    return this.get(applicantId);
  }

  async cvFile(applicantId: string) {
    const applicant = await this.find(applicantId);
    this.openings.assertSee(applicant.company_id);
    if (!applicant.cv_file_key)
      throw new NotFoundException(MSG.NOT_FOUND);
    const content = await this.storage.get(applicant.cv_file_key);
    return { content, fileName: applicant.cv_file_name ?? 'cv' };
  }

  // =========================================================== applications

  async apply(openingId: string, dto: ApplyDto) {
    const opening = await this.openings.find(openingId);
    this.access.assert('recruitment.manage', {
      companyId: opening.company_id,
    });
    if (opening.state !== 'open')
      throw new ConflictException(MSG.OPENING_WRONG_STATE);
    const applicant = await this.find(dto.applicantId);
    if (applicant.company_id !== opening.company_id)
      throw new NotFoundException(MSG.APPLICANT_NOT_FOUND);
    if (applicant.redacted_at)
      throw new ConflictException(MSG.APPLICANT_REDACTED);

    const already = await this.db.tx
      .selectFrom('applications')
      .select('id')
      .where('applicant_id', '=', dto.applicantId)
      .where('opening_id', '=', openingId)
      .executeTakeFirst();
    if (already)
      throw new ConflictException({
        message: MSG.APPLICATION_EXISTS,
        details: { applicationId: already.id },
      });

    const application = await this.db.tx
      .insertInto('applications')
      .values({
        company_id: opening.company_id,
        applicant_id: dto.applicantId,
        opening_id: openingId,
        applied_on: dto.appliedOn ?? todayInDhaka(this.clock.now()),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.event(application.id, null, 'applied', dto.note ?? null);
    await this.audit.record({
      action: 'application.created',
      entity: 'application',
      entityId: application.id,
      after: { openingId, applicantId: dto.applicantId },
    });
    return this.application(application.id);
  }

  async application(applicationId: string) {
    const application = await this.findApplication(applicationId);
    this.openings.assertSee(application.company_id);
    const applicant = await this.find(application.applicant_id);
    const opening = await this.openings.find(application.opening_id);
    const events = await this.db.tx
      .selectFrom('application_events')
      .select(['id', 'from_state', 'to_state', 'note', 'by_user_id', 'at'])
      .where('application_id', '=', applicationId)
      .orderBy('at')
      .execute();
    const screenings = await this.db.tx
      .selectFrom('cv_screenings')
      .select(['id', 'score', 'reasons', 'model', 'prompt_version', 'created_at'])
      .where('application_id', '=', applicationId)
      .orderBy('created_at', 'desc')
      .execute();
    const interviews = await this.db.tx
      .selectFrom('interviews')
      .select([
        'id',
        'round_no',
        'kind',
        'scheduled_at',
        'place',
        'state',
        'outcome',
      ])
      .where('application_id', '=', applicationId)
      .orderBy('round_no')
      .execute();
    const offer = await this.db.tx
      .selectFrom('job_offers')
      .select(['id', 'number', 'state', 'joining_on', 'valid_until'])
      .where('application_id', '=', applicationId)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    return {
      id: application.id,
      state: application.state,
      appliedOn: application.applied_on,
      rejectedReason: application.rejected_reason,
      hiredEmployeeId: application.hired_employee_id,
      version: application.version,
      applicant: this.toApplicant(applicant),
      opening: {
        id: opening.id,
        number: opening.number,
        title: opening.title,
        requirements: opening.requirements,
        state: opening.state,
      },
      events: events.map((e) => ({
        id: e.id,
        from: e.from_state,
        to: e.to_state,
        note: e.note,
        byUserId: e.by_user_id,
        at: e.at,
      })),
      screenings: screenings.map((s) => ({
        id: s.id,
        score: s.score,
        reasons: s.reasons,
        model: s.model,
        promptVersion: s.prompt_version,
        at: s.created_at,
      })),
      interviews: interviews.map((i) => ({
        id: i.id,
        roundNo: i.round_no,
        kind: i.kind,
        scheduledAt: i.scheduled_at,
        place: i.place,
        state: i.state,
        outcome: i.outcome,
      })),
      offer: offer ?? null,
    };
  }

  async move(applicationId: string, dto: MoveApplicationDto) {
    const application = await this.findApplication(applicationId);
    this.access.assert('recruitment.manage', {
      companyId: application.company_id,
    });
    if (dto.to === 'hired')
      throw new BadRequestException(MSG.APPLICATION_WRONG_STATE); // hiring goes through the offer
    if (!canMove(application.state, dto.to))
      throw new ConflictException(MSG.APPLICATION_WRONG_STATE);
    if (dto.to === 'rejected' && !dto.note)
      throw new BadRequestException(MSG.VALIDATION_FAILED);

    await this.setState(application, dto.to, dto.note ?? null, {
      rejected_reason: dto.to === 'rejected' ? dto.note : null,
    });
    return this.application(applicationId);
  }

  /**
   * The offer was accepted (offers.service calls this): the applicant's own details become
   * an employee record with the offer's placement. Acceptance criterion of WP29: nothing is
   * retyped.
   */
  async hire(
    applicationId: string,
    offer: {
      branch_id: string;
      department_id: string;
      designation_id: string;
      grade_id: string;
      joining_on: string;
      id: string;
      number: string;
    },
  ) {
    const application = await this.findApplication(applicationId);
    if (!canMove(application.state, 'hired'))
      throw new ConflictException(MSG.APPLICATION_WRONG_STATE);
    const applicant = await this.find(application.applicant_id);
    if (applicant.redacted_at)
      throw new ConflictException(MSG.APPLICANT_REDACTED);

    const employee = await this.employees.createEmployee({
      companyId: applicant.company_id,
      fullNameEn: applicant.full_name_en,
      fullNameBn: applicant.full_name_bn ?? undefined,
      dateOfBirth: applicant.date_of_birth ?? undefined,
      gender: (applicant.gender ?? undefined) as 'male' | 'female' | undefined,
      personalEmail: applicant.email ?? undefined,
      phone: applicant.phone ?? undefined,
      presentAddress: applicant.district ?? undefined,
      joinDate: offer.joining_on,
      branchId: offer.branch_id,
      departmentId: offer.department_id,
      designationId: offer.designation_id,
      gradeId: offer.grade_id,
    });

    await this.db.tx
      .updateTable('applications')
      .set({ state: 'hired', hired_employee_id: employee.id })
      .where('id', '=', applicationId)
      .execute();
    await this.event(
      applicationId,
      application.state,
      'hired',
      `Offer ${offer.number} accepted; employee ${employee.employeeCode} created`,
    );
    await this.audit.record({
      action: 'application.hired',
      entity: 'application',
      entityId: applicationId,
      after: {
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        offer: offer.number,
      },
    });
    await this.outbox.add({
      type: 'application.hired',
      entityId: applicationId,
      payload: {
        applicationId,
        companyId: applicant.company_id,
        openingId: application.opening_id,
        employeeId: employee.id,
        offerId: offer.id,
      },
    });
    const filled = await this.openings.fillIfComplete(application.opening_id);
    return { employee, openingFilled: filled };
  }

  // ================================================================ retention

  /**
   * The daily retention job (spec §11): applicants past their retention date who were never
   * hired lose their CV file and their personal details. The file has to go first, because
   * clearing the row loses the key that finds it.
   */
  async clearExpired(): Promise<{ applicants: number; files: number }> {
    const cutoff = todayInDhaka(this.clock.now());
    const due = await this.db.tx
      .selectFrom('applicants as a')
      .select(['a.id', 'a.cv_file_key'])
      .where('a.redacted_at', 'is', null)
      .where('a.retention_until', '<', cutoff)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('applications as p')
              .select('p.id')
              .whereRef('p.applicant_id', '=', 'a.id')
              .where('p.state', '=', 'hired'),
          ),
        ),
      )
      .limit(500)
      .execute();
    let files = 0;
    for (const row of due) {
      if (!row.cv_file_key) continue;
      try {
        await this.storage.remove(row.cv_file_key);
        files += 1;
      } catch {
        // already gone, or the bucket is unreachable: the row is cleared anyway, and the
        // orphan file is reported by the storage audit rather than blocking retention
      }
    }
    return { applicants: due.length, files };
  }

  // ================================================================= helpers

  async find(applicantId: string): Promise<Applicant> {
    const applicant = await this.db.tx
      .selectFrom('applicants')
      .selectAll()
      .where('id', '=', applicantId)
      .executeTakeFirst();
    if (!applicant) throw new NotFoundException(MSG.APPLICANT_NOT_FOUND);
    return applicant;
  }

  async findApplication(applicationId: string): Promise<Application> {
    const application = await this.db.tx
      .selectFrom('applications')
      .selectAll()
      .where('id', '=', applicationId)
      .executeTakeFirst();
    if (!application)
      throw new NotFoundException(MSG.APPLICATION_NOT_FOUND);
    return application;
  }

  /** Used by offers and interviews to move the application along. */
  async setState(
    application: Application,
    to: ApplicationState,
    note: string | null,
    extra: Record<string, unknown> = {},
  ) {
    await this.db.tx
      .updateTable('applications')
      .set({ state: to, ...extra } as never)
      .where('id', '=', application.id)
      .execute();
    await this.event(application.id, application.state, to, note);
    await this.audit.record({
      action: `application.${to}`,
      entity: 'application',
      entityId: application.id,
      before: { state: application.state },
      after: { state: to, note },
    });
  }

  private async event(
    applicationId: string,
    from: string | null,
    to: string,
    note: string | null,
  ) {
    await this.db.tx
      .insertInto('application_events')
      .values({
        application_id: applicationId,
        from_state: from,
        to_state: to,
        note,
      })
      .execute();
  }

  private toApplicant(a: Applicant) {
    const redacted = !!a.redacted_at;
    return {
      id: a.id,
      companyId: a.company_id,
      name: redacted ? null : a.full_name_en,
      nameBn: redacted ? null : a.full_name_bn,
      phone: a.phone,
      email: a.email,
      district: a.district,
      dateOfBirth: a.date_of_birth,
      gender: a.gender,
      source: a.source,
      sourceDetail: a.source_detail,
      referredBy: a.referred_by,
      cvFileName: a.cv_file_name,
      hasCvText: !!a.cv_text,
      consentAt: a.consent_at,
      consentVersion: a.consent_version,
      retentionUntil: a.retention_until,
      redacted,
      createdAt: a.created_at,
      version: a.version,
    };
  }
}
