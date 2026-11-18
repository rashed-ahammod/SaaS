/**
 * Interviews and scorecards (WP29).
 *
 *   schedule(applicationId, dto)  HR sets a round with its panel; the application moves to
 *                                 'interviewing'. Rounds are numbered per application.
 *   score(interviewId, dto)       a PANEL MEMBER gives their own scorecard. Only the panel
 *                                 can, one card each, and theirs is the one they replace —
 *                                 nobody scores on someone else's behalf.
 *   finish(interviewId, dto)      HR records what the round decided (proceed / hold / reject)
 *                                 once the cards are in; rejecting closes the application.
 *   mine()                        the interviews I am on the panel of, and whether I have
 *                                 given my card yet.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Interview } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { ApplicantsService } from './applicants.service.js';
import { canMove } from './recruitment-rules.js';
import type {
  FinishInterviewDto,
  InterviewDto,
  ScorecardDto,
} from './dto/recruitment.dto.js';

@Injectable()
export class InterviewsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly outbox: OutboxService,
    private readonly org: OrgLookupService,
    private readonly applicants: ApplicantsService,
  ) {}

  async schedule(applicationId: string, dto: InterviewDto) {
    const application = await this.applicants.findApplication(applicationId);
    this.access.assert('recruitment.manage', {
      companyId: application.company_id,
    });
    if (
      !['screened', 'shortlisted', 'interviewing'].includes(application.state)
    )
      throw new ConflictException(MSG.APPLICATION_WRONG_STATE);
    if (!dto.panelUserIds.length)
      throw new BadRequestException(MSG.VALIDATION_FAILED);

    const last = await this.db.tx
      .selectFrom('interviews')
      .select('round_no')
      .where('application_id', '=', applicationId)
      .orderBy('round_no', 'desc')
      .executeTakeFirst();
    const interview = await this.db.tx
      .insertInto('interviews')
      .values({
        application_id: applicationId,
        round_no: (last?.round_no ?? 0) + 1,
        kind: dto.kind ?? 'in_person',
        scheduled_at: new Date(dto.scheduledAt),
        place: dto.place ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    for (const userId of new Set(dto.panelUserIds))
      await this.db.tx
        .insertInto('interview_panel')
        .values({ interview_id: interview.id, user_id: userId })
        .onConflict((oc) => oc.doNothing())
        .execute();

    if (application.state !== 'interviewing')
      await this.applicants.setState(
        application,
        'interviewing',
        `Interview round ${interview.round_no} scheduled`,
      );
    await this.audit.record({
      action: 'interview.scheduled',
      entity: 'interview',
      entityId: interview.id,
      after: {
        applicationId,
        roundNo: interview.round_no,
        scheduledAt: dto.scheduledAt,
        panel: dto.panelUserIds.length,
      },
    });
    await this.outbox.add({
      type: 'interview.scheduled',
      entityId: interview.id,
      payload: {
        interviewId: interview.id,
        companyId: application.company_id,
        applicationId,
        roundNo: interview.round_no,
        scheduledAt: new Date(dto.scheduledAt).toISOString(),
        panelUserIds: [...new Set(dto.panelUserIds)],
      },
    });
    return this.get(interview.id);
  }

  async get(interviewId: string) {
    const interview = await this.find(interviewId);
    const application = await this.applicants.findApplication(
      interview.application_id,
    );
    const onPanel = await this.panel(interviewId);
    const me = this.access.current().userId;
    const opening = await this.db.tx
      .selectFrom('job_openings as o')
      .innerJoin('position_requests as p', 'p.id', 'o.position_request_id')
      .select('p.department_id')
      .where('o.id', '=', application.opening_id)
      .executeTakeFirst();
    const resource = {
      companyId: application.company_id,
      departmentId: opening?.department_id,
    };
    const maySee =
      this.access.allows('recruitment.view', resource) ||
      this.access.allows('recruitment.manage', resource) ||
      (!!me && onPanel.includes(me));
    if (!maySee) throw new ForbiddenException(MSG.FORBIDDEN);

    const cards = await this.db.tx
      .selectFrom('interview_scorecards')
      .select([
        'id',
        'interviewer_id',
        'scores',
        'overall',
        'recommendation',
        'notes',
        'submitted_at',
      ])
      .where('interview_id', '=', interviewId)
      .orderBy('submitted_at')
      .execute();
    return {
      id: interview.id,
      applicationId: interview.application_id,
      roundNo: interview.round_no,
      kind: interview.kind,
      scheduledAt: interview.scheduled_at,
      place: interview.place,
      state: interview.state,
      outcome: interview.outcome,
      panelUserIds: onPanel,
      iAmOnPanel: !!me && onPanel.includes(me),
      scorecards: cards.map((c) => ({
        id: c.id,
        interviewerId: c.interviewer_id,
        scores: c.scores,
        overall: c.overall,
        recommendation: c.recommendation,
        notes: c.notes,
        at: c.submitted_at,
      })),
      version: interview.version,
    };
  }

  /** My own interviews (any employee can be on a panel). */
  async mine(companyId: string) {
    // another tenant's company does not exist for this transaction (RLS), which is what
    // refuses the route rather than answering with an empty list
    await this.org.assertCompanyExists(companyId);
    const me = this.access.current().userId;
    if (!me) throw new ForbiddenException(MSG.FORBIDDEN);
    const rows = await this.db.tx
      .selectFrom('interview_panel as p')
      .innerJoin('interviews as i', 'i.id', 'p.interview_id')
      .innerJoin('applications as a', 'a.id', 'i.application_id')
      .innerJoin('job_openings as o', 'o.id', 'a.opening_id')
      .leftJoin('interview_scorecards as s', (j) =>
        j
          .onRef('s.interview_id', '=', 'i.id')
          .on('s.interviewer_id', '=', me),
      )
      .select([
        'i.id',
        'i.round_no',
        'i.kind',
        'i.scheduled_at',
        'i.place',
        'i.state',
        'o.title',
        'o.number as opening_number',
        's.id as my_scorecard_id',
      ])
      .where('p.user_id', '=', me)
      .where('a.company_id', '=', companyId)
      .where('i.state', 'in', ['scheduled', 'done'])
      .orderBy('i.scheduled_at')
      .execute();
    return {
      interviews: rows.map((r) => ({
        id: r.id,
        roundNo: r.round_no,
        kind: r.kind,
        scheduledAt: r.scheduled_at,
        place: r.place,
        state: r.state,
        openingNumber: r.opening_number,
        openingTitle: r.title,
        myScorecardGiven: !!r.my_scorecard_id,
      })),
    };
  }

  async score(interviewId: string, dto: ScorecardDto) {
    const interview = await this.find(interviewId);
    const me = this.access.current().userId;
    if (!me) throw new ForbiddenException(MSG.FORBIDDEN);
    // the interview must exist in this tenant, which find() already proved
    // the panel is the authority here: a Dept Head holds recruitment.interview in their
    // own department's scope, and the candidate is in nobody's department yet
    if (!this.access.current().has('recruitment.interview'))
      throw new ForbiddenException(MSG.FORBIDDEN);
    if (!(await this.panel(interviewId)).includes(me))
      throw new ForbiddenException(MSG.INTERVIEW_NOT_ON_PANEL);
    if (!['scheduled', 'done'].includes(interview.state))
      throw new ConflictException(MSG.INTERVIEW_WRONG_STATE);

    const values = {
      interview_id: interviewId,
      interviewer_id: me,
      scores: JSON.stringify(dto.scores ?? {}),
      overall: dto.overall,
      recommendation: dto.recommendation,
      notes: dto.notes ?? null,
      submitted_at: this.clock.now(),
    };
    await this.db.tx
      .insertInto('interview_scorecards')
      .values(values)
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'interview_id', 'interviewer_id'])
          .doUpdateSet(values),
      )
      .execute();
    await this.audit.record({
      action: 'interview.scored',
      entity: 'interview',
      entityId: interviewId,
      after: {
        overall: dto.overall,
        recommendation: dto.recommendation,
      },
    });
    return this.get(interviewId);
  }

  async finish(interviewId: string, dto: FinishInterviewDto) {
    const interview = await this.find(interviewId);
    const application = await this.applicants.findApplication(
      interview.application_id,
    );
    this.access.assert('recruitment.manage', {
      companyId: application.company_id,
    });
    if (interview.state !== 'scheduled')
      throw new ConflictException(MSG.INTERVIEW_WRONG_STATE);
    await this.db.tx
      .updateTable('interviews')
      .set({ state: dto.state ?? 'done', outcome: dto.outcome })
      .where('id', '=', interviewId)
      .execute();
    if (dto.outcome === 'reject' && canMove(application.state, 'rejected'))
      await this.applicants.setState(
        application,
        'rejected',
        dto.note ?? `Not selected at interview round ${interview.round_no}`,
        {
          rejected_reason:
            dto.note ?? `Not selected at interview round ${interview.round_no}`,
        },
      );
    await this.audit.record({
      action: 'interview.finished',
      entity: 'interview',
      entityId: interviewId,
      after: { outcome: dto.outcome, state: dto.state ?? 'done' },
    });
    return this.get(interviewId);
  }

  async cancel(interviewId: string, reason: string) {
    const interview = await this.find(interviewId);
    this.access.assert('recruitment.manage', {
      companyId: (
        await this.applicants.findApplication(interview.application_id)
      ).company_id,
    });
    if (interview.state !== 'scheduled')
      throw new ConflictException(MSG.INTERVIEW_WRONG_STATE);
    await this.db.tx
      .updateTable('interviews')
      .set({ state: 'cancelled', cancel_reason: reason })
      .where('id', '=', interviewId)
      .execute();
    return this.get(interviewId);
  }

  private async panel(interviewId: string): Promise<string[]> {
    const rows = await this.db.tx
      .selectFrom('interview_panel')
      .select('user_id')
      .where('interview_id', '=', interviewId)
      .execute();
    return rows.map((r) => r.user_id);
  }

  private async find(interviewId: string): Promise<Interview> {
    const interview = await this.db.tx
      .selectFrom('interviews')
      .selectAll()
      .where('id', '=', interviewId)
      .executeTakeFirst();
    if (!interview) throw new NotFoundException(MSG.INTERVIEW_NOT_FOUND);
    return interview;
  }
}
