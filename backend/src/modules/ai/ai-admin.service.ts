/**
 * AI oversight for the tenant's Admin (spec §8 guardrails 3, 6, 7, 10):
 *
 *   settings / updateSettings   switch AI, or each feature, on and off
 *   usage(month)                calls and tokens against the quota, and per
 *                               feature how people judged the answers
 *                               (not-helpful rate; for payroll flags, how many
 *                               explained flags were cleared or fixed)
 *   interactions(query)         the log: who asked, which model and prompt
 *                               version, what came back, what the human did
 *
 * The quota itself is set by the platform operator (sold credits), not here.
 */
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { AiGatewayService, TIER_QUOTA } from './gateway/ai-gateway.service.js';
import type {
  InteractionsQueryDto,
  UpdateAiSettingsDto,
} from './dto/ai.dto.js';

@Injectable()
export class AiAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly gateway: AiGatewayService,
  ) {}

  async settings() {
    const tenant = await this.db.tx
      .selectFrom('tenants')
      .select('plan_tier')
      .executeTakeFirstOrThrow();
    const row = await this.db.tx
      .selectFrom('ai_settings')
      .selectAll()
      .executeTakeFirst();
    return {
      ...this.gateway.providerInfo,
      planTier: tenant.plan_tier,
      enabled: row?.enabled ?? false,
      assistantEnabled: row?.assistant_enabled ?? true,
      payrollExplanationsEnabled: row?.payroll_explain_enabled ?? true,
      bankMatchSuggestionsEnabled: row?.bank_match_enabled ?? true,
      documentReaderEnabled: row?.document_reader_enabled ?? true,
      monthlyQuota: row?.monthly_quota ?? TIER_QUOTA[tenant.plan_tier],
      extraCredits: row?.extra_credits ?? 0,
      updatedAt: row?.updated_at ?? null,
    };
  }

  async updateSettings(dto: UpdateAiSettingsDto) {
    // current values
    const before = await this.settings();
    const values = {
      enabled: dto.enabled ?? before.enabled,
      assistant_enabled: dto.assistantEnabled ?? before.assistantEnabled,
      payroll_explain_enabled:
        dto.payrollExplanationsEnabled ?? before.payrollExplanationsEnabled,
      bank_match_enabled:
        dto.bankMatchSuggestionsEnabled ?? before.bankMatchSuggestionsEnabled,
      document_reader_enabled:
        dto.documentReaderEnabled ?? before.documentReaderEnabled,
      updated_by: requestContext.get().userId ?? null,
      updated_at: this.clock.now(),
    };

    // save
    await this.db.tx
      .insertInto('ai_settings')
      .values(values)
      .onConflict((oc) => oc.column('tenant_id').doUpdateSet(values))
      .execute();
    await this.audit.record({
      action: 'ai_settings.updated',
      entity: 'ai_settings',
      before: {
        enabled: before.enabled,
        assistantEnabled: before.assistantEnabled,
        payrollExplanationsEnabled: before.payrollExplanationsEnabled,
        bankMatchSuggestionsEnabled: before.bankMatchSuggestionsEnabled,
        documentReaderEnabled: before.documentReaderEnabled,
      },
      after: {
        enabled: values.enabled,
        assistantEnabled: values.assistant_enabled,
        payrollExplanationsEnabled: values.payroll_explain_enabled,
        bankMatchSuggestionsEnabled: values.bank_match_enabled,
        documentReaderEnabled: values.document_reader_enabled,
      },
    });
    return this.settings();
  }

  async usage(month?: string) {
    const m = month ?? todayInDhaka(this.clock.now()).slice(0, 7);
    const { quota } = await this.gateway.quotaState();
    const usage = await this.db.tx
      .selectFrom('ai_usage')
      .selectAll()
      .where('month', '=', m)
      .execute();

    // how the answers were judged, per feature
    const judged = await this.db.tx
      .selectFrom('ai_interactions')
      .select(['feature'])
      .select([
        sql<number>`count(*)::int`.as('total'),
        sql<number>`count(*) FILTER (WHERE status = 'ok')::int`.as('answered'),
        sql<number>`count(*) FILTER (WHERE status IN ('timeout', 'error'))::int`.as(
          'failed',
        ),
        sql<number>`count(*) FILTER (WHERE status = 'refused')::int`.as(
          'refused',
        ),
        sql<number>`count(*) FILTER (WHERE human_action = 'helpful')::int`.as(
          'helpful',
        ),
        sql<number>`count(*) FILTER (WHERE human_action = 'not_helpful')::int`.as(
          'not_helpful',
        ),
        sql<number>`percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::int`.as(
          'p95_latency_ms',
        ),
      ])
      .where(
        sql<boolean>`to_char(created_at AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM') = ${m}`,
      )
      .groupBy('feature')
      .execute();

    // what reviewers did with explained payroll flags: cleared with a reason, fixed (flag gone after recalculation), still open
    const flagOutcomes = await sql<{
      cleared: number;
      fixed: number;
      open: number;
    }>`
      SELECT count(*) FILTER (WHERE f.cleared_at IS NOT NULL)::int AS cleared,
             count(*) FILTER (WHERE f.id IS NULL)::int AS fixed,
             count(*) FILTER (WHERE f.id IS NOT NULL AND f.cleared_at IS NULL)::int AS open
        FROM (SELECT DISTINCT split_part(input_ref, ':', 2)::uuid AS flag_id
                FROM ai_interactions
               WHERE feature = 'payroll_flag_explanation' AND status = 'ok' AND input_ref LIKE 'payroll_flag:%'
                 AND to_char(created_at AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM') = ${m}) x
        LEFT JOIN payroll_flags f ON f.id = x.flag_id`.execute(this.db.tx);

    const calls = usage.reduce((n, u) => n + u.calls, 0);
    return {
      month: m,
      ...this.gateway.providerInfo,
      quota,
      used: calls,
      remaining: Math.max(quota - calls, 0),
      features: (
        [
          'assistant',
          'payroll_flag_explanation',
          'bank_match_suggestion',
          'document_reader',
        ] as const
      ).map((feature) => {
        const u = usage.find((x) => x.feature === feature);
        const j = judged.find((x) => x.feature === feature);
        const rated = (j?.helpful ?? 0) + (j?.not_helpful ?? 0);
        return {
          feature,
          calls: u?.calls ?? 0,
          inputTokens: u?.input_tokens ?? 0,
          outputTokens: u?.output_tokens ?? 0,
          interactions: j?.total ?? 0,
          answered: j?.answered ?? 0,
          refused: j?.refused ?? 0,
          failed: j?.failed ?? 0,
          helpful: j?.helpful ?? 0,
          notHelpful: j?.not_helpful ?? 0,
          // spec §8 guardrail 10: a feature whose rejection rate is too high is switched off until fixed
          notHelpfulRate: rated
            ? Number((j!.not_helpful / rated).toFixed(3))
            : null,
          p95LatencyMs: j?.p95_latency_ms ?? null,
          ...(feature === 'payroll_flag_explanation'
            ? { explainedFlags: flagOutcomes.rows[0] }
            : {}),
        };
      }),
    };
  }

  async interactions(query: InteractionsQueryDto) {
    let q = this.db.tx
      .selectFrom('ai_interactions as i')
      .leftJoin('users as u', 'u.id', 'i.user_id')
      .select([
        'i.id',
        'i.created_at',
        'i.user_id',
        'u.email',
        'i.feature',
        'i.provider',
        'i.model',
        'i.prompt_version',
        'i.language',
        'i.input_ref',
        'i.input_text',
        'i.output_text',
        'i.tools_used',
        'i.sources',
        'i.status',
        'i.error',
        'i.input_tokens',
        'i.output_tokens',
        'i.latency_ms',
        'i.human_action',
        'i.human_note',
        'i.acted_at',
      ])
      .orderBy('i.created_at', 'desc')
      .limit(query.limit ?? 50);
    if (query.feature) q = q.where('i.feature', '=', query.feature);
    if (query.status) q = q.where('i.status', '=', query.status);
    const rows = await q.execute();
    return rows.map((r) => ({
      id: r.id,
      at: r.created_at,
      userId: r.user_id,
      userEmail: r.email,
      feature: r.feature,
      provider: r.provider,
      model: r.model,
      promptVersion: r.prompt_version,
      language: r.language,
      inputRef: r.input_ref,
      input: r.input_text,
      output: r.output_text,
      toolsUsed: r.tools_used,
      sources: r.sources,
      status: r.status,
      error: r.error,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      latencyMs: r.latency_ms,
      humanAction: r.human_action,
      humanNote: r.human_note,
      actedAt: r.acted_at,
    }));
  }
}
