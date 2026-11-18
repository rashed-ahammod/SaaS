/**
 * AI review drafting (WP30; spec §8 feature 9 "review drafting from a year of feedback
 * (manager rewrites)").
 *
 *   draft(appraisalId)   1. the feature is offered to this tenant, and the user may rate
 *                           this appraisal
 *                        2. the model is given the GOALS with their weights and scores and
 *                           the FEEDBACK NOTES of the period — and nothing about who the
 *                           person is: no name, no gender, no religion, no age. The notes
 *                           are what managers wrote during the year, so they are the
 *                           evidence; the draft adds no facts of its own.
 *                        3. the answer comes back as text the manager REWRITES. Nothing is
 *                           saved on the appraisal: the manager decides what their comment
 *                           says, and `manager_comment` only ever holds what they submitted.
 *
 * The prompt forbids a rating and forbids recommending an increment, because those are the
 * two decisions the cycle exists to make (spec §8 guardrail: AI never decides about a
 * person).
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { AiGatewayService } from '../ai/gateway/ai-gateway.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { AppraisalsService } from './appraisals.service.js';
import {
  REVIEW_PROMPT_VERSION,
  reviewDraftSystemPrompt,
  weightedScore,
} from './performance-rules.js';

/** What the model is given. No name and no protected characteristic anywhere in it. */
export interface ReviewFacts {
  period: { from: string; to: string; kind: string };
  goals: Array<{
    title: string;
    target: string | null;
    weight: number;
    selfScore: number | null;
    managerScore: number | null;
  }>;
  /** The notes written during the year, oldest first, with their kind. */
  feedback: Array<{ kind: string; body: string }>;
  selfReview: string | null;
  weightedScore: number | null;
}

@Injectable()
export class ReviewDraftService {
  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: AiGatewayService,
    private readonly access: AccessService,
    private readonly appraisals: AppraisalsService,
  ) {}

  async draft(appraisalId: string) {
    await this.gateway.assertAvailable('review_draft', REVIEW_PROMPT_VERSION);

    const facts = await this.db.transaction(async () => {
      const appraisal = await this.appraisals.find(appraisalId);
      // the same check the rating screen does: the recorded manager, or HR
      await this.appraisals.assertSeeAppraisal(appraisal);
      const me = this.access.current().employeeId;
      const isManager =
        !!me &&
        appraisal.manager_employee_id === me &&
        this.access.current().has('performance.rate');
      if (
        !isManager &&
        !this.access.allows('performance.manage', {
          companyId: appraisal.company_id,
        })
      )
        throw new BadRequestException(MSG.APPRAISAL_NOT_MINE);

      const cycle = await this.appraisals.findCycle(appraisal.cycle_id);
      const goals = await this.appraisals.goalsOf(appraisalId);
      const notes = await this.db.tx
        .selectFrom('feedback_notes')
        .select(['kind', 'body'])
        .where('employee_id', '=', appraisal.employee_id)
        .where('created_at', '>=', new Date(`${cycle.period_from}T00:00:00+06:00`))
        .orderBy('created_at')
        .limit(100)
        .execute();
      const score = weightedScore(
        goals.map((g) => ({
          weight: g.weight,
          score: g.managerScore ?? g.selfScore ?? null,
        })),
      );
      return {
        appraisal,
        facts: {
          period: {
            from: cycle.period_from,
            to: cycle.period_to,
            kind: cycle.kind,
          },
          goals: goals.map((g) => ({
            title: g.title,
            target: g.target,
            weight: g.weight,
            selfScore: g.selfScore,
            managerScore: g.managerScore,
          })),
          feedback: notes.map((n) => ({ kind: n.kind, body: n.body })),
          selfReview: appraisal.self_review,
          weightedScore: score,
        } satisfies ReviewFacts,
      };
    });

    if (!facts.facts.goals.length && !facts.facts.feedback.length)
      throw new BadRequestException(MSG.GOALS_NEEDED);

    const result = await this.ask(facts.facts, `appraisal:${appraisalId}`);
    return {
      appraisalId,
      /** A draft for the manager to rewrite. Nothing is saved until they submit theirs. */
      draft: result.answer,
      model: result.model,
      interactionId: result.interactionId,
    };
  }

  /** The model call itself; `npm run ai:eval` calls it with synthetic facts. */
  async ask(facts: ReviewFacts, inputRef: string, evaluation = false) {
    const result = await this.gateway.run({
      feature: 'review_draft',
      promptVersion: REVIEW_PROMPT_VERSION,
      inputRef,
      system: reviewDraftSystemPrompt(requestContext.get().language),
      messages: [
        {
          role: 'user',
          text: `TASK: review_draft\nDraft the appraisal comment from this evidence.\nFACTS: ${JSON.stringify(facts)}`,
        },
      ],
      maxTokens: 1500,
      ignoreReleaseGate: evaluation,
    });
    return {
      answer: result.answer,
      model: result.model,
      interactionId: result.interactionId,
    };
  }
}
