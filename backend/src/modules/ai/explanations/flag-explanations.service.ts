/**
 * Payroll pre-check explanations (guide §16 feature 2, spec §8 feature 5): a
 * plain-language explanation of one rule-based flag, for the reviewer who must
 * clear or fix it. The rules raise the flag; AI only explains it; the human decides.
 *
 *   explain(flagId)   1. the feature is offered (also for a reused explanation);
 *                        facts the reviewer may see (PayrollRunsService.flagFacts:
 *                        run access; amounts only with salary field access)
 *                     2. the same flag, language and visibility explained before
 *                        -> that explanation again (no new cost)
 *                     3. otherwise ask the model through the gateway
 */
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../platform/db/database.service.js';
import { requestContext } from '../../../platform/tenancy/request-context.js';
import { PayrollRunsService } from '../../payroll/payroll-runs.service.js';
import {
  FLAG_PROMPT_VERSION,
  FLAG_RULES,
  flagSystemPrompt,
} from '../assistant/prompts.js';
import { AiGatewayService } from '../gateway/ai-gateway.service.js';

export type FlagFacts = Pick<
  Awaited<ReturnType<PayrollRunsService['flagFacts']>>,
  'seesSalary' | 'flag' | 'run' | 'employee'
>;

@Injectable()
export class FlagExplanationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: AiGatewayService,
    private readonly payroll: PayrollRunsService,
  ) {}

  async explain(flagId: string) {
    // the feature is offered, and the facts the reviewer may see (403/404 before any quota is used)
    await this.gateway.assertAvailable(
      'payroll_flag_explanation',
      FLAG_PROMPT_VERSION,
    );
    const facts = await this.db.transaction(() =>
      this.payroll.flagFacts(flagId),
    );
    const language = requestContext.get().language;
    const inputRef = `payroll_flag:${flagId}:${facts.seesSalary ? 'amounts' : 'no_amounts'}`;

    // explained before for the same visibility and language
    const earlier = await this.db.transaction(() =>
      this.db.tx
        .selectFrom('ai_interactions')
        .select(['id', 'output_text', 'model'])
        .where('input_ref', '=', inputRef)
        .where('language', '=', language)
        .where('prompt_version', '=', FLAG_PROMPT_VERSION)
        .where('status', '=', 'ok')
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst(),
    );
    if (earlier?.output_text) {
      return {
        flagId,
        code: facts.flag.code,
        explanation: earlier.output_text,
        interactionId: earlier.id,
        model: earlier.model,
        reused: true,
      };
    }

    // ask the model
    const result = await this.explainFacts(facts, inputRef);
    return {
      flagId,
      code: facts.flag.code,
      explanation: result.answer,
      interactionId: result.interactionId,
      model: result.model,
      reused: false,
    };
  }

  /** The model call itself; the test set (npm run ai:eval) calls it with synthetic facts. */
  explainFacts(facts: FlagFacts, inputRef: string, evaluation = false) {
    const promptFacts = {
      flag: facts.flag,
      rule: FLAG_RULES[facts.flag.code] ?? null,
      run: facts.run,
      employee: facts.employee,
      amountsVisibleToReviewer: facts.seesSalary,
    };
    return this.gateway.run({
      feature: 'payroll_flag_explanation',
      promptVersion: FLAG_PROMPT_VERSION,
      inputRef,
      system: flagSystemPrompt(requestContext.get().language),
      messages: [
        {
          role: 'user',
          text: `Explain this payroll flag.\nFACTS: ${JSON.stringify(promptFacts)}`,
        },
      ],
      maxTokens: 4000,
      ignoreReleaseGate: evaluation,
    });
  }
}
