/**
 * Job openings and where they were advertised (WP29).
 *
 *   open(requestId, dto)   HR turns an APPROVED position request into an opening. One
 *                          opening per request (the database enforces it): the approval is
 *                          the authority for the post, so an opening can always be traced
 *                          back to who allowed it.
 *   post(openingId, dto)   where it was advertised (website, Facebook, notice board, ...).
 *                          The n8n workflow that actually publishes it is WP31; this records
 *                          what was done.
 *   hold / close / fill    its life. Filling happens by itself when the last opening is
 *                          taken by a hire (applicants.service).
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  fiscalYearOf,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { JobOpening } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { PositionsService } from './positions.service.js';
import { RecruitmentAccess } from './recruitment-access.js';
import type {
  CloseOpeningDto,
  OpeningDto,
  OpeningQueryDto,
  PostingDto,
} from './dto/recruitment.dto.js';

@Injectable()
export class OpeningsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
    private readonly positions: PositionsService,
    private readonly scope: RecruitmentAccess,
  ) {}

  async list(companyId: string, query: OpeningQueryDto) {
    await this.org.assertCompanyExists(companyId);
    // A Dept Head holds recruitment.view over their own department, not the
    // company, so they are not asked about the company: they are shown the
    // openings of the departments they lead.
    const scope = await this.scope.departmentScope(companyId);
    let q = this.db.tx
      .selectFrom('job_openings as o')
      .innerJoin('position_requests as p', 'p.id', 'o.position_request_id')
      .innerJoin('departments as d', 'd.id', 'p.department_id')
      .innerJoin('designations as g', 'g.id', 'p.designation_id')
      .select([
        'o.id',
        'o.number',
        'o.title',
        'o.openings',
        'o.state',
        'o.closing_on',
        'o.created_at',
        'd.name as department_name',
        'g.name_en as designation_name',
        'p.employment_type',
      ])
      .where('o.company_id', '=', companyId)
      .orderBy('o.created_at', 'desc')
      .limit(300);
    if (!scope.all)
      q = q.where('p.department_id', 'in', scope.departmentIds);
    if (query.state) q = q.where('o.state', '=', query.state);
    const rows = await q.execute();
    const counts = await this.applicationCounts(rows.map((r) => r.id));
    return {
      openings: rows.map((r) => ({
        id: r.id,
        number: r.number,
        title: r.title,
        openings: r.openings,
        state: r.state,
        closingOn: r.closing_on,
        departmentName: r.department_name,
        designationName: r.designation_name,
        employmentType: r.employment_type,
        applications: counts.get(r.id) ?? 0,
        createdAt: r.created_at,
      })),
    };
  }

  async get(openingId: string) {
    const opening = await this.find(openingId);
    const request = await this.positions.find(opening.position_request_id);
    this.assertSee(opening.company_id, request.department_id);
    const names = await this.org.names({
      departmentIds: [request.department_id],
      designationIds: [request.designation_id],
      gradeIds: [request.grade_id],
      branchIds: [request.branch_id],
    });
    const postings = await this.db.tx
      .selectFrom('job_postings')
      .select(['id', 'channel', 'posted_on', 'reference'])
      .where('opening_id', '=', openingId)
      .orderBy('posted_on', 'desc')
      .execute();
    const applications = await this.db.tx
      .selectFrom('applications as a')
      .innerJoin('applicants as p', 'p.id', 'a.applicant_id')
      .select((eb) => [
        'a.id',
        'a.state',
        'a.applied_on',
        'p.id as applicant_id',
        'p.full_name_en',
        'p.district',
        'p.redacted_at',
        // The LATEST screening's score, as a subquery rather than a join.
        // cv_screenings keeps every screening an application has had (0043 is
        // INSERT-only, and the applicant's own screen lists the history), so a
        // left join put the applicant in this list once per screening: screen
        // one CV a second time and the opening showed that person twice.
        eb
          .selectFrom('cv_screenings as s')
          .select('s.score')
          .whereRef('s.application_id', '=', 'a.id')
          .orderBy('s.created_at', 'desc')
          .limit(1)
          .as('score'),
      ])
      .where('a.opening_id', '=', openingId)
      // not yet screened first (DESC puts the nulls there), then by score
      .orderBy('score', 'desc')
      .orderBy('a.applied_on')
      .execute();
    return {
      ...this.toOpening(opening),
      positionRequest: {
        id: request.id,
        number: request.number,
        withinPlan: request.within_plan,
        headcount: request.headcount,
        employmentType: request.employment_type,
      },
      // the NAME, not the record the lookup holds: these four went out as
      // objects, and the screen that prints them crashed on every opening
      departmentName: names.departments.get(request.department_id)?.name ?? null,
      designationName:
        names.designations.get(request.designation_id)?.nameEn ?? null,
      gradeName: names.grades.get(request.grade_id)?.name ?? null,
      branchName: names.branches.get(request.branch_id)?.name ?? null,
      postings: postings.map((p) => ({
        id: p.id,
        channel: p.channel,
        postedOn: p.posted_on,
        reference: p.reference,
      })),
      applications: applications.map((a) => ({
        id: a.id,
        applicantId: a.applicant_id,
        name: a.redacted_at ? null : a.full_name_en,
        district: a.district,
        state: a.state,
        appliedOn: a.applied_on,
        screeningScore: a.score,
      })),
    };
  }

  async open(positionRequestId: string, dto: OpeningDto) {
    const request = await this.positions.find(positionRequestId);
    this.access.assert('recruitment.manage', {
      companyId: request.company_id,
      departmentId: request.department_id,
    });
    if (request.state !== 'approved')
      throw new ConflictException(MSG.POSITION_REQUEST_WRONG_STATE);
    const already = await this.db.tx
      .selectFrom('job_openings')
      .select('id')
      .where('position_request_id', '=', positionRequestId)
      .executeTakeFirst();
    if (already) throw new ConflictException(MSG.OPENING_EXISTS);

    const opening = await this.db.tx
      .insertInto('job_openings')
      .values({
        company_id: request.company_id,
        number: await this.nextNumber(request.company_id),
        position_request_id: positionRequestId,
        title: dto.title,
        title_bn: dto.titleBn ?? null,
        description: dto.description,
        requirements: dto.requirements,
        openings: dto.openings ?? request.headcount,
        closing_on: dto.closingOn ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.positions.markOpened(positionRequestId);
    await this.audit.record({
      action: 'job_opening.opened',
      entity: 'job_opening',
      entityId: opening.id,
      after: {
        number: opening.number,
        title: opening.title,
        openings: opening.openings,
        positionRequest: request.number,
      },
    });
    await this.outbox.add({
      type: 'job_opening.opened',
      entityId: opening.id,
      payload: {
        openingId: opening.id,
        companyId: opening.company_id,
        number: opening.number,
        title: opening.title,
        openings: opening.openings,
        departmentId: request.department_id,
      },
    });
    return this.get(opening.id);
  }

  async addPosting(openingId: string, dto: PostingDto) {
    const opening = await this.find(openingId);
    this.access.assert('recruitment.manage', {
      companyId: opening.company_id,
    });
    if (opening.state !== 'open')
      throw new ConflictException(MSG.OPENING_WRONG_STATE);
    await this.db.tx
      .insertInto('job_postings')
      .values({
        opening_id: openingId,
        channel: dto.channel,
        posted_on: dto.postedOn ?? todayInDhaka(this.clock.now()),
        reference: dto.reference ?? null,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await this.audit.record({
      action: 'job_opening.posted',
      entity: 'job_opening',
      entityId: openingId,
      after: { channel: dto.channel, reference: dto.reference ?? null },
    });
    return this.get(openingId);
  }

  async hold(openingId: string) {
    const opening = await this.find(openingId);
    this.access.assert('recruitment.manage', {
      companyId: opening.company_id,
    });
    if (opening.state !== 'open')
      throw new ConflictException(MSG.OPENING_WRONG_STATE);
    await this.patch(openingId, { state: 'on_hold' });
    return this.get(openingId);
  }

  async resume(openingId: string) {
    const opening = await this.find(openingId);
    this.access.assert('recruitment.manage', {
      companyId: opening.company_id,
    });
    if (opening.state !== 'on_hold')
      throw new ConflictException(MSG.OPENING_WRONG_STATE);
    await this.patch(openingId, { state: 'open' });
    return this.get(openingId);
  }

  async close(openingId: string, dto: CloseOpeningDto) {
    const opening = await this.find(openingId);
    this.access.assert('recruitment.manage', {
      companyId: opening.company_id,
    });
    if (opening.state === 'closed' || opening.state === 'filled')
      throw new ConflictException(MSG.OPENING_WRONG_STATE);
    await this.patch(openingId, {
      state: 'closed',
      close_reason: dto.reason,
    });
    await this.audit.record({
      action: 'job_opening.closed',
      entity: 'job_opening',
      entityId: openingId,
      after: { reason: dto.reason },
    });
    return this.get(openingId);
  }

  /** Called after a hire: when every post of the opening is taken it is filled. */
  async fillIfComplete(openingId: string): Promise<boolean> {
    const opening = await this.find(openingId);
    const hired = await this.db.tx
      .selectFrom('applications')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('opening_id', '=', openingId)
      .where('state', '=', 'hired')
      .executeTakeFirst();
    if (Number(hired?.n ?? 0) < opening.openings) return false;
    await this.patch(openingId, { state: 'filled' });
    await this.outbox.add({
      type: 'job_opening.filled',
      entityId: openingId,
      payload: {
        openingId,
        companyId: opening.company_id,
        number: opening.number,
      },
    });
    return true;
  }

  async find(openingId: string): Promise<JobOpening> {
    const opening = await this.db.tx
      .selectFrom('job_openings')
      .selectAll()
      .where('id', '=', openingId)
      .executeTakeFirst();
    if (!opening) throw new NotFoundException(MSG.OPENING_NOT_FOUND);
    return opening;
  }

  assertSee(companyId: string, departmentId?: string) {
    const resource = { companyId, departmentId };
    if (
      this.access.allows('recruitment.view', resource) ||
      this.access.allows('recruitment.manage', resource) ||
      this.access.allows('recruitment.plan', resource)
    )
      return;
    this.access.assert('recruitment.view', resource); // throws
  }

  private async applicationCounts(
    openingIds: string[],
  ): Promise<Map<string, number>> {
    if (!openingIds.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('applications')
      .select(['opening_id', (eb) => eb.fn.countAll<string>().as('n')])
      .where('opening_id', 'in', openingIds)
      .groupBy('opening_id')
      .execute();
    return new Map(rows.map((r) => [r.opening_id, Number(r.n)]));
  }

  private async patch(openingId: string, values: Record<string, unknown>) {
    await this.db.tx
      .updateTable('job_openings')
      .set(values as never)
      .where('id', '=', openingId)
      .execute();
  }

  private async nextNumber(companyId: string): Promise<string> {
    const fy = fiscalYearOf(todayInDhaka(this.clock.now()), '07-01');
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'job_opening',
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
    return `JO/${fy}/${String(row.last_no).padStart(5, '0')}`;
  }

  private toOpening(o: JobOpening) {
    return {
      id: o.id,
      number: o.number,
      companyId: o.company_id,
      positionRequestId: o.position_request_id,
      title: o.title,
      titleBn: o.title_bn,
      description: o.description,
      requirements: o.requirements,
      openings: o.openings,
      closingOn: o.closing_on,
      state: o.state,
      closeReason: o.close_reason,
      createdAt: o.created_at,
      version: o.version,
    };
  }
}
