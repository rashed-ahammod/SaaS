/**
 * AI gateway (spec §8, guide §16): every AI call in the product goes through run().
 *
 *   availability(feature)  is the feature offered to this tenant right now?
 *                          provider configured · Intelligent plan · switched on by
 *                          the tenant · release gate passed · quota left
 *   run(feature, ...)      1. check availability
 *                          2. reserve one call of the month's quota (race-safe)
 *                          3. mask the input; call the model; run the tools it asks
 *                             for (read-only, with the user's own access) and mask
 *                             their results too; at most MAX_TURNS rounds
 *                          4. stop at the time limit: the user gets "not answering"
 *                             and the normal screens; nothing waits on AI
 *                          5. log the interaction and the tokens (metered cost)
 *   feedback(id, ...)      what the human did with the answer
 *
 * Runs on @ShortTransactions() routes: no database transaction is held while the
 * model thinks. Each database step opens its own short one.
 */
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../../../config/config.js';
import { Clock } from '../../../platform/clock.js';
import { todayInDhaka } from '../../../platform/dates/business-date.js';
import { DatabaseService } from '../../../platform/db/database.service.js';
import type { AiFeature } from '../../../platform/db/schema.js';
import { MSG } from '../../../platform/i18n/messages.js';
import { requestContext } from '../../../platform/tenancy/request-context.js';
import { maskData, maskText } from './masking.js';
import {
  AI_PROVIDER,
  type AiMessage,
  type AiProvider,
  type AiToolCall,
  type AiToolSpec,
} from './provider.js';

/** Calls per month included in each plan (spec §1: "included quota per tier, extra credits sold"). Illustrative. */
export const TIER_QUOTA: Record<'core' | 'business' | 'intelligent', number> = {
  core: 0,
  business: 0,
  intelligent: 3000,
};

const MAX_TURNS = 4;
const MAX_TOOL_RESULT_CHARS = 12_000;

export type Unavailable =
  | 'provider_off'
  | 'not_in_plan'
  | 'switched_off'
  | 'not_released'
  | 'quota_used_up';

export interface Availability {
  available: boolean;
  reason?: Unavailable;
}

export interface Source {
  documentId: string;
  title: string;
  heading: string;
}

export interface ToolOutcome {
  content: unknown;
  sources?: Source[];
}

export interface RunInput {
  feature: AiFeature;
  promptVersion: string;
  /** What the call is about, e.g. "question" or "payroll_flag:<id>". */
  inputRef: string;
  system: string;
  /** Earlier turns (text only) followed by the new user message. */
  messages: AiMessage[];
  tools?: AiToolSpec[];
  /** Runs one tool call; must use db.transaction() and the user's own access. */
  executeTool?: (call: AiToolCall) => Promise<ToolOutcome>;
  maxTokens?: number;
  /** Only for the test-set run (npm run ai:eval), which is what opens the release gate. */
  ignoreReleaseGate?: boolean;
}

export interface RunResult {
  interactionId: string;
  status: 'ok' | 'refused';
  answer: string;
  sources: Source[];
  toolsUsed: string[];
  model: string;
}

const UNAVAILABLE_MESSAGE: Record<Unavailable, string> = {
  provider_off: MSG.AI_OFF,
  switched_off: MSG.AI_OFF,
  not_in_plan: MSG.AI_NOT_IN_PLAN,
  not_released: MSG.AI_NOT_RELEASED,
  quota_used_up: MSG.AI_QUOTA_EXCEEDED,
};

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly clock: Clock,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider | null,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ============================================================ availability

  /** Is the feature offered right now? (the app hides it otherwise) */
  async availability(
    feature: AiFeature,
    promptVersion: string,
    options: { ignoreReleaseGate?: boolean } = {},
  ): Promise<Availability> {
    if (!this.provider) return { available: false, reason: 'provider_off' };
    return this.db.transaction(async () => {
      const tenant = await this.db.tx
        .selectFrom('tenants')
        .select('plan_tier')
        .executeTakeFirstOrThrow();
      if (tenant.plan_tier !== 'intelligent')
        return { available: false, reason: 'not_in_plan' as const };

      const settings = await this.db.tx
        .selectFrom('ai_settings')
        .selectAll()
        .executeTakeFirst();
      const featureOn = {
        assistant: settings?.assistant_enabled,
        payroll_flag_explanation: settings?.payroll_explain_enabled,
        bank_match_suggestion: settings?.bank_match_enabled,
        document_reader: settings?.document_reader_enabled,
        cv_screening: settings?.cv_screening_enabled,
        review_draft: settings?.review_draft_enabled,
        sales_assist: settings?.sales_assist_enabled,
      }[feature];
      if (!settings?.enabled || !featureOn)
        return { available: false, reason: 'switched_off' as const };

      if (
        this.config.ai.requireReleaseGate &&
        !options.ignoreReleaseGate &&
        !(await this.releaseGatePassed(feature, promptVersion))
      ) {
        return { available: false, reason: 'not_released' as const };
      }

      const { used, quota } = await this.quotaState();
      if (used >= quota)
        return { available: false, reason: 'quota_used_up' as const };
      return { available: true };
    });
  }

  /** Throws 403 (or 429 for a used-up quota) with the reason, when the feature is not offered. */
  async assertAvailable(
    feature: AiFeature,
    promptVersion: string,
    options: { ignoreReleaseGate?: boolean } = {},
  ): Promise<void> {
    const availability = await this.availability(
      feature,
      promptVersion,
      options,
    );
    if (availability.available) return;
    const status =
      availability.reason === 'quota_used_up'
        ? HttpStatus.TOO_MANY_REQUESTS
        : HttpStatus.FORBIDDEN;
    throw new HttpException(UNAVAILABLE_MESSAGE[availability.reason!], status);
  }

  /** The latest test-set run for this feature, model and prompt version passed. */
  async releaseGatePassed(
    feature: AiFeature,
    promptVersion: string,
  ): Promise<boolean> {
    if (!this.provider) return false;
    const gate = await this.db.tx
      .selectFrom('ai_release_gates')
      .select('passed')
      .where('feature', '=', feature)
      .where('model', '=', this.provider.model)
      .where('prompt_version', '=', promptVersion)
      .orderBy('run_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return gate?.passed ?? false;
  }

  /** Calls used this month (all features) and the month's quota. */
  async quotaState(): Promise<{ month: string; used: number; quota: number }> {
    const month = this.month();
    const tenant = await this.db.tx
      .selectFrom('tenants')
      .select('plan_tier')
      .executeTakeFirstOrThrow();
    const settings = await this.db.tx
      .selectFrom('ai_settings')
      .select(['monthly_quota', 'extra_credits'])
      .executeTakeFirst();
    const usage = await this.db.tx
      .selectFrom('ai_usage')
      .select(sql<number>`coalesce(sum(calls), 0)::int`.as('calls'))
      .where('month', '=', month)
      .executeTakeFirst();
    const quota =
      (settings?.monthly_quota ?? TIER_QUOTA[tenant.plan_tier]) +
      (settings?.extra_credits ?? 0);
    return { month, used: usage?.calls ?? 0, quota };
  }

  get providerInfo() {
    return {
      provider: this.provider?.name ?? 'off',
      model: this.provider?.model ?? null,
    };
  }

  // ===================================================================== run

  async run(input: RunInput): Promise<RunResult> {
    // check the feature is offered
    await this.assertAvailable(input.feature, input.promptVersion, {
      ignoreReleaseGate: input.ignoreReleaseGate,
    });
    const provider = this.provider!;

    // reserve one call of the quota
    await this.reserve(input.feature);

    // mask everything that leaves the system
    const messages: AiMessage[] = input.messages.map((m) =>
      m.role === 'tool_results' ? m : { ...m, text: maskText(m.text) },
    );
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const inputText = lastUser?.role === 'user' ? lastUser.text : '';

    const started = Date.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.config.ai.timeoutMs);
    const tokens = { inputTokens: 0, outputTokens: 0 };
    const toolsUsed: string[] = [];
    const sources: Source[] = [];
    let model = provider.model;

    try {
      for (let turn = 1; ; turn++) {
        // call the model (the last round gets no tools, so it must answer)
        const result = await provider.call({
          system: input.system,
          messages,
          tools: turn < MAX_TURNS ? (input.tools ?? []) : [],
          maxTokens: input.maxTokens ?? 8000,
          language: requestContext.get().language,
          signal: abort.signal,
        });
        tokens.inputTokens += result.usage.inputTokens;
        tokens.outputTokens += result.usage.outputTokens;
        model = result.model;

        if (result.stop !== 'tool_calls') {
          const status = result.stop === 'refused' ? 'refused' : 'ok';
          const answer = result.text || (status === 'refused' ? '' : '…');
          const interactionId = await this.finish(input, inputText, {
            status,
            output: answer,
            model,
            tokens,
            toolsUsed,
            sources,
            started,
          });
          return {
            interactionId,
            status,
            answer,
            sources: uniqueSources(sources),
            toolsUsed,
            model,
          };
        }

        // run the tools the model asked for (read-only, user's own access), mask the results
        messages.push({
          role: 'assistant',
          text: result.text,
          raw: result.raw,
        });
        const results = [];
        for (const call of result.toolCalls) {
          toolsUsed.push(call.name);
          try {
            if (!input.executeTool) throw new Error('no tools');
            const outcome = await input.executeTool(call);
            sources.push(...(outcome.sources ?? []));
            results.push({
              callId: call.id,
              content: JSON.stringify(maskData(outcome.content)).slice(
                0,
                MAX_TOOL_RESULT_CHARS,
              ),
            });
          } catch (err) {
            results.push({
              callId: call.id,
              content: JSON.stringify({ error: toolError(err) }),
              isError: true,
            });
          }
        }
        messages.push({ role: 'tool_results', results });
      }
    } catch (err) {
      // time limit or provider failure: log it, give the call back, show the normal screens
      const timedOut = abort.signal.aborted;
      this.logger.warn(
        `AI ${input.feature} ${timedOut ? 'timed out' : 'failed'}: ${(err as Error).message}`,
      );
      await this.finish(input, inputText, {
        status: timedOut ? 'timeout' : 'error',
        output: null,
        error: (err as Error).message.slice(0, 500),
        model,
        tokens,
        toolsUsed,
        sources,
        started,
      });
      throw new ServiceUnavailableException(MSG.AI_UNAVAILABLE);
    } finally {
      clearTimeout(timer);
    }
  }

  // ================================================================ feedback

  /** What the user did with an answer they received (spec §8 guardrail 6). */
  async feedback(
    interactionId: string,
    action: 'helpful' | 'not_helpful',
    note?: string,
  ) {
    return this.db.transaction(async () => {
      const ctx = requestContext.get();
      const row = await this.db.tx
        .updateTable('ai_interactions')
        .set({
          human_action: action,
          human_note: note ?? null,
          acted_at: this.clock.now(),
        })
        .where('id', '=', interactionId)
        .where('user_id', '=', ctx.userId!)
        .returning(['id', 'human_action'])
        .executeTakeFirst();
      if (!row) throw new NotFoundException(MSG.AI_INTERACTION_NOT_FOUND);
      return { id: row.id, humanAction: row.human_action };
    });
  }

  // ================================================================= helpers

  /** Takes one call from the month's quota; refuses when none is left (one tenant at a time). */
  private async reserve(feature: AiFeature): Promise<void> {
    await this.db.transaction(async () => {
      const ctx = requestContext.get();
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'ai-quota:' + ctx.tenantId}, 0))`.execute(
        this.db.tx,
      );
      const { month, used, quota } = await this.quotaState();
      if (used >= quota)
        throw new HttpException(
          MSG.AI_QUOTA_EXCEEDED,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      await this.db.tx
        .insertInto('ai_usage')
        .values({ month, feature, calls: 1 })
        .onConflict((oc) =>
          oc
            .columns(['tenant_id', 'month', 'feature'])
            .doUpdateSet({ calls: sql`ai_usage.calls + 1` }),
        )
        .execute();
    });
  }

  /** Logs the interaction and the tokens; a call that produced no answer is given back. */
  private async finish(
    input: RunInput,
    inputText: string,
    out: {
      status: 'ok' | 'refused' | 'timeout' | 'error';
      output: string | null;
      error?: string;
      model: string;
      tokens: { inputTokens: number; outputTokens: number };
      toolsUsed: string[];
      sources: Source[];
      started: number;
    },
  ): Promise<string> {
    return this.db.transaction(async () => {
      const ctx = requestContext.get();
      const answered = out.status === 'ok' || out.status === 'refused';
      await this.db.tx
        .updateTable('ai_usage')
        .set({
          calls: answered ? sql`calls` : sql`greatest(calls - 1, 0)`,
          input_tokens: sql`input_tokens + ${out.tokens.inputTokens}`,
          output_tokens: sql`output_tokens + ${out.tokens.outputTokens}`,
        })
        .where('month', '=', this.month())
        .where('feature', '=', input.feature)
        .execute();
      const row = await this.db.tx
        .insertInto('ai_interactions')
        .values({
          user_id: ctx.userId!,
          feature: input.feature,
          provider: this.provider?.name ?? 'off',
          model: out.model,
          prompt_version: input.promptVersion,
          language: ctx.language,
          input_ref: input.inputRef,
          input_text: inputText,
          output_text: out.output,
          tools_used: JSON.stringify(out.toolsUsed),
          sources: JSON.stringify(uniqueSources(out.sources)),
          status: out.status,
          error: out.error ?? null,
          input_tokens: out.tokens.inputTokens,
          output_tokens: out.tokens.outputTokens,
          latency_ms: Date.now() - out.started,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
  }

  private month(): string {
    return todayInDhaka(this.clock.now()).slice(0, 7);
  }
}

function uniqueSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  return sources.filter((s) => {
    const key = `${s.documentId}|${s.heading}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A tool failure as the model sees it: the reason, never a stack trace. */
function toolError(err: unknown): string {
  if (err instanceof HttpException) {
    const status = err.getStatus();
    return status === 403
      ? 'not allowed for this user'
      : status === 404
        ? 'not found'
        : 'not available';
  }
  return 'not available';
}
