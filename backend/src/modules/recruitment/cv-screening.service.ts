/**
 * AI CV screening (WP29; spec §8 feature "CV screening with protected characteristics
 * removed and reasons shown", and guardrail "AI never decides about a person").
 *
 *   screen(applicationId)   1. the feature is offered to this tenant (plan, switch, release
 *                              gate, quota) and the user may work this application
 *                           2. the CV is made BLIND (recruitment-rules.blindCv): the
 *                              applicant's name, gender, religion, age, date of birth,
 *                              marital status, photo, phone, e-mail and address are removed
 *                              before anything leaves the process
 *                           3. the model sees the post's requirements and the blind text
 *                              only, and answers {score, reasons}
 *                           4. what the model was shown is stored with the answer, so a
 *                              fairness question can be answered with evidence
 *
 * The score sorts a pile of CVs. It rejects nobody: only an HR officer moves an application,
 * and the reasons are shown next to the score so they can disagree with it.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { AiGatewayService } from '../ai/gateway/ai-gateway.service.js';
import { AccessService } from '../identity/access/access.service.js';
import {
  SCREENING_PROMPT_VERSION,
  blindCv,
  parseScreening,
  screeningSystemPrompt,
} from './recruitment-rules.js';

/** What the model is given: the post, and a CV with the person taken out of it. */
export interface ScreeningFacts {
  post: {
    title: string;
    requirements: string[];
  };
  /** Already blind: every protected characteristic is "[removed]". */
  cv: string;
}

@Injectable()
export class CvScreeningService {
  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: AiGatewayService,
    private readonly access: AccessService,
  ) {}

  async screen(applicationId: string) {
    await this.gateway.assertAvailable('cv_screening', SCREENING_PROMPT_VERSION);

    // the facts, with the user's own access (no quota is used if they may not see this)
    const facts = await this.db.transaction(async () => {
      const row = await this.db.tx
        .selectFrom('applications as a')
        .innerJoin('applicants as p', 'p.id', 'a.applicant_id')
        .innerJoin('job_openings as o', 'o.id', 'a.opening_id')
        .select([
          'a.id',
          'a.company_id',
          'p.full_name_en',
          'p.full_name_bn',
          'p.phone',
          'p.email',
          'p.date_of_birth',
          'p.gender',
          'p.district',
          'p.cv_text',
          'p.redacted_at',
          'o.title',
          'o.requirements',
        ])
        .where('a.id', '=', applicationId)
        .executeTakeFirst();
      if (!row) throw new BadRequestException(MSG.APPLICATION_NOT_FOUND);
      this.access.assert('recruitment.manage', { companyId: row.company_id });
      if (row.redacted_at)
        throw new BadRequestException(MSG.APPLICANT_REDACTED);
      if (!row.cv_text?.trim())
        throw new BadRequestException(MSG.CV_TEXT_NEEDED);
      return row;
    });

    const blind = blindCv(facts.cv_text!, {
      fullNameEn: facts.full_name_en,
      fullNameBn: facts.full_name_bn,
      phone: facts.phone,
      email: facts.email,
      dateOfBirth: facts.date_of_birth,
      gender: facts.gender,
      district: facts.district,
    });

    const result = await this.ask(
      { post: { title: facts.title, requirements: facts.requirements }, cv: blind.text },
      `application:${applicationId}`,
    );
    if (!result.parsed) {
      // a reply that is not a score is not a screening: nothing is stored
      return {
        applicationId,
        score: null,
        reasons: [],
        removed: blind.removed,
        model: result.model,
        interactionId: result.interactionId,
      };
    }

    const saved = await this.db.transaction(() =>
      this.db.tx
        .insertInto('cv_screenings')
        .values({
          application_id: applicationId,
          score: result.parsed!.score,
          reasons: JSON.stringify(result.parsed!.reasons),
          blind_input: blind.text,
          model: result.model,
          prompt_version: SCREENING_PROMPT_VERSION,
          interaction_id: result.interactionId,
        })
        .returning(['id', 'created_at'])
        .executeTakeFirstOrThrow(),
    );
    return {
      id: saved.id,
      applicationId,
      score: result.parsed.score,
      reasons: result.parsed.reasons,
      /** What was taken out before the model saw the CV, for the record. */
      removed: blind.removed,
      model: result.model,
      interactionId: result.interactionId,
      at: saved.created_at,
    };
  }

  /** The model call itself; `npm run ai:eval` calls it with synthetic facts. */
  async ask(facts: ScreeningFacts, inputRef: string, evaluation = false) {
    const result = await this.gateway.run({
      feature: 'cv_screening',
      promptVersion: SCREENING_PROMPT_VERSION,
      inputRef,
      system: screeningSystemPrompt(requestContext.get().language),
      messages: [
        {
          role: 'user',
          text: `TASK: cv_screening\nHow well does this CV match the post?\nFACTS: ${JSON.stringify(facts)}`,
        },
      ],
      maxTokens: 1200,
      ignoreReleaseGate: evaluation,
    });
    return {
      parsed: parseScreening(result.answer),
      answer: result.answer,
      model: result.model,
      interactionId: result.interactionId,
    };
  }
}
