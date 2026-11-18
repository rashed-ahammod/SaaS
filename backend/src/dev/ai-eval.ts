/**
 * The AI release gate (guide §16):  npm run ai:eval
 *
 * Runs the fixed test sets in test/ai-eval against the configured provider and
 * model (AI_PROVIDER, AI_MODEL in .env), in a seeded workspace, and records each
 * result in ai_release_gates. A feature is offered in production only while its
 * latest run for the current model and prompt version passed.
 *
 *   npm run ai:eval                                  demo workspace, as Rafi (employee) and Farzana (HR)
 *   npm run ai:eval -- --workspace=demo --as=rafi@demo.test --reviewer=farzana.akter@demo.test
 *   npm run ai:eval -- --only=assistant              or --only=payroll_flag_explanation, --only=bank_match_suggestion, --only=document_reader
 *
 * With AI_PROVIDER=fake the run checks the plumbing (retrieval, tools, masking,
 * logging); run it with AI_PROVIDER=anthropic to measure real answers. Each case
 * is one metered AI call in the workspace.
 */
import { NestFactory } from '@nestjs/core';
import { sql } from 'kysely';
import { AppModule } from '../app.module.js';
import { CvScreeningService } from '../modules/recruitment/cv-screening.service.js';
import { ReviewDraftService } from '../modules/performance/review-draft.service.js';
import { REVIEW_PROMPT_VERSION } from '../modules/performance/performance-rules.js';
import {
  SALES_ASSIST_PROMPT_VERSION,
  SalesAssistService,
} from '../modules/commissions/sales-assist.service.js';
import { SCREENING_PROMPT_VERSION } from '../modules/recruitment/recruitment-rules.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { AssistantService } from '../modules/ai/assistant/assistant.service.js';
import {
  ASSISTANT_PROMPT_VERSION,
  FLAG_PROMPT_VERSION,
} from '../modules/ai/assistant/prompts.js';
import {
  loadCases,
  runCases,
  type EvalReport,
} from '../modules/ai/eval/evaluation.js';
import { FlagExplanationsService } from '../modules/ai/explanations/flag-explanations.service.js';
import { AiGatewayService } from '../modules/ai/gateway/ai-gateway.service.js';
import {
  BANK_MATCH_PROMPT_VERSION,
  BankAiService,
} from '../modules/bank/bank-ai.service.js';
import {
  DOCUMENT_PROMPT_VERSION,
  DocumentReaderService,
} from '../modules/ai/documents/document-reader.service.js';
import { detectFileType } from '../platform/storage/file-storage.js';
import { readFileSync } from 'node:fs';
import { AccessService } from '../modules/identity/access/access.service.js';
import { LeaveLedgerService } from '../modules/leave/leave-ledger.service.js';
import { DatabaseService } from '../platform/db/database.service.js';
import type { AiFeature } from '../platform/db/schema.js';
import { requestContext } from '../platform/tenancy/request-context.js';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a) => a.replace(/^--/, '').split('=') as [string, string]),
);
const workspace = args.workspace ?? 'demo';
const employeeEmail = args.as ?? 'rafi@demo.test';
const reviewerEmail = args.reviewer ?? 'farzana.akter@demo.test';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const config = app.get<AppConfig>(APP_CONFIG);
    const db = app.get(DatabaseService);
    const gateway = app.get(AiGatewayService, { strict: false });
    const { provider, model } = gateway.providerInfo;
    if (provider === 'off')
      throw new Error('AI_PROVIDER is off: nothing to evaluate');
    console.log(
      `AI release gate: provider ${provider}, model ${model}, workspace "${workspace}", required pass rate ${config.ai.requiredPassRate}`,
    );

    // who asks
    const found = await sql<{
      id: string | null;
    }>`SELECT auth_find_tenant_id(${workspace}) AS id`.execute(db.kysely);
    const tenantId = found.rows[0]?.id;
    if (!tenantId)
      throw new Error(
        `Workspace "${workspace}" not found (run npm run db:seed)`,
      );
    const signIn = (email: string) =>
      db.withTenant({ tenantId }, async () => {
        const user = await db.tx
          .selectFrom('users')
          .select('id')
          .where('email', '=', email)
          .executeTakeFirst();
        if (!user) throw new Error(`User ${email} not found in "${workspace}"`);
        return {
          userId: user.id,
          access: await app.get(AccessService, { strict: false }).load(user.id),
        };
      });
    const employee = await signIn(employeeEmail);
    const reviewer = await signIn(reviewerEmail);
    const as = <T>(
      who: typeof employee,
      language: 'bn' | 'en',
      work: () => Promise<T>,
    ) =>
      requestContext.run(
        { tenantId, userId: who.userId, access: who.access, language },
        work,
      );

    // values the answers must contain, read now
    const balances = await db.withTenant(
      { tenantId, userId: employee.userId, access: employee.access },
      () =>
        app
          .get(LeaveLedgerService, { strict: false })
          .balances(employee.access.employeeId!),
    );
    const resolve = (ref: string) => {
      const [kind, arg] = ref.split(':');
      if (kind === 'myLeaveAvailable')
        return String(
          balances.balances.find((b) => b.code === arg)?.available ?? 'n/a',
        );
      throw new Error(`Unknown data reference ${ref}`);
    };

    const reports: Array<{
      feature: AiFeature;
      promptVersion: string;
      report: EvalReport;
    }> = [];

    if (!args.only || args.only === 'assistant') {
      const assistant = app.get(AssistantService, { strict: false });
      const report = await runCases(
        loadCases('test/ai-eval/assistant.yaml'),
        config.ai.requiredPassRate,
        (c) =>
          as(employee, c.language, () =>
            assistant.ask({ question: c.question! }, c.id),
          ),
        resolve,
      );
      reports.push({
        feature: 'assistant',
        promptVersion: ASSISTANT_PROMPT_VERSION,
        report,
      });
    }

    if (!args.only || args.only === 'payroll_flag_explanation') {
      const flags = app.get(FlagExplanationsService, { strict: false });
      const report = await runCases(
        loadCases('test/ai-eval/payroll-flags.yaml'),
        config.ai.requiredPassRate,
        async (c) => {
          const facts = {
            seesSalary: c.facts!.seesSalary,
            flag: {
              code: c.facts!.flag.code,
              message: c.facts!.flag.message,
              cleared: false,
              clearReason: null,
            },
            run: {
              period: '2026-09',
              runType: 'regular',
              bonusName: null,
              state: 'calculated',
            },
            employee: { code: 'EVAL-0001', status: 'active' },
          } as Parameters<FlagExplanationsService['explainFacts']>[0];
          const result = await as(reviewer, c.language, () =>
            flags.explainFacts(facts, `eval:${c.id}`, true),
          );
          return { answer: result.answer, toolsUsed: [] };
        },
        resolve,
      );
      reports.push({
        feature: 'payroll_flag_explanation',
        promptVersion: FLAG_PROMPT_VERSION,
        report,
      });
    }

    if (!args.only || args.only === 'bank_match_suggestion') {
      const bank = app.get(BankAiService, { strict: false });
      const report = await runCases(
        loadCases('test/ai-eval/bank-match.yaml'),
        config.ai.requiredPassRate,
        async (c) => {
          const r = await as(reviewer, c.language, () =>
            bank.chooseFrom(c.bankFacts!, `eval:${c.id}`, true),
          );
          return {
            answer: `choice: ${r.choice ?? 'none'} ${r.reason}`,
            toolsUsed: [],
          };
        },
        resolve,
      );
      reports.push({
        feature: 'bank_match_suggestion',
        promptVersion: BANK_MATCH_PROMPT_VERSION,
        report,
      });
    }

    if (!args.only || args.only === 'cv_screening') {
      const screening = app.get(CvScreeningService, { strict: false });
      const report = await runCases(
        loadCases('test/ai-eval/cv-screening.yaml'),
        config.ai.requiredPassRate,
        async (c) => {
          const r = await as(reviewer, c.language, () =>
            screening.ask(
              { post: c.post!, cv: c.cv! },
              `eval:${c.id}`,
              true,
            ),
          );
          // graded on the reasons: the score alone says nothing about fairness
          return {
            answer: `score: ${r.parsed?.score ?? 'none'}\n${(r.parsed?.reasons ?? []).join('\n')}`,
            toolsUsed: [],
          };
        },
        resolve,
      );
      reports.push({
        feature: 'cv_screening',
        promptVersion: SCREENING_PROMPT_VERSION,
        report,
      });
    }

    if (!args.only || args.only === 'sales_assist') {
      const assist = app.get(SalesAssistService, { strict: false });
      const report = await runCases(
        loadCases('test/ai-eval/sales-assist.yaml'),
        config.ai.requiredPassRate,
        async (c) => {
          const r = await as(reviewer, c.language, () =>
            assist.ask(c.assist!, `eval:${c.id}`, true),
          );
          return { answer: r.answer, toolsUsed: [] };
        },
        resolve,
      );
      reports.push({
        feature: 'sales_assist',
        promptVersion: SALES_ASSIST_PROMPT_VERSION,
        report,
      });
    }

    if (!args.only || args.only === 'review_draft') {
      const drafts = app.get(ReviewDraftService, { strict: false });
      const report = await runCases(
        loadCases('test/ai-eval/review-draft.yaml'),
        config.ai.requiredPassRate,
        async (c) => {
          const r = await as(reviewer, c.language, () =>
            drafts.ask(c.review!, `eval:${c.id}`, true),
          );
          return { answer: r.answer, toolsUsed: [] };
        },
        resolve,
      );
      reports.push({
        feature: 'review_draft',
        promptVersion: REVIEW_PROMPT_VERSION,
        report,
      });
    }

    if (!args.only || args.only === 'document_reader') {
      const reader = app.get(DocumentReaderService, { strict: false });
      const report = await runCases(
        loadCases('test/ai-eval/document-reader.yaml'),
        config.ai.requiredPassRate,
        async (c) => {
          const data = readFileSync(c.document!);
          const r = await as(reviewer, c.language, () =>
            reader.readFile(
              { mediaType: detectFileType(data) ?? 'image/png', data },
              c.kind ?? 'bill',
              `eval:${c.id}`,
              true,
            ),
          );
          return {
            answer: r.fields ? JSON.stringify(r.fields) : 'unreadable',
            toolsUsed: [],
          };
        },
        resolve,
      );
      reports.push({
        feature: 'document_reader',
        promptVersion: DOCUMENT_PROMPT_VERSION,
        report,
      });
    }

    // record the results: this is what opens or closes the gate
    const owner = new DatabaseService(config, 'erp_owner');
    try {
      for (const { feature, promptVersion, report } of reports) {
        await owner.kysely
          .insertInto('ai_release_gates')
          .values({
            feature,
            provider,
            model: model!,
            prompt_version: promptVersion,
            cases: report.cases,
            passed_cases: report.passed,
            pass_rate: report.passRate.toFixed(4),
            required_rate: report.requiredRate.toFixed(4),
            passed: report.gatePassed,
            details: JSON.stringify(report.outcomes),
          })
          .execute();
      }
    } finally {
      await owner.close();
    }

    // print
    for (const { feature, promptVersion, report } of reports) {
      console.log(
        `\n${feature} (${promptVersion}): ${report.passed}/${report.cases} passed = ${(report.passRate * 100).toFixed(1)}%  ->  gate ${report.gatePassed ? 'PASSED' : 'FAILED'}`,
      );
      for (const o of report.outcomes.filter((x) => !x.passed)) {
        console.log(`  FAIL ${o.id}: ${o.failures.join('; ')}`);
        console.log(
          `       answer: ${o.answer.replace(/\s+/g, ' ').slice(0, 300)}`,
        );
      }
    }
    if (reports.some((r) => !r.report.gatePassed)) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
