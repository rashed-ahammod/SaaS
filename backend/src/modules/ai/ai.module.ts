import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LeaveModule } from '../leave/leave.module.js';
import { PayrollModule } from '../payroll/payroll.module.js';
import { AiAdminController } from './ai-admin.controller.js';
import { AiAdminService } from './ai-admin.service.js';
import { AiController } from './ai.controller.js';
import { DocumentReaderService } from './documents/document-reader.service.js';
import { AssistantToolsService } from './assistant/assistant-tools.service.js';
import { AssistantService } from './assistant/assistant.service.js';
import { FlagExplanationsService } from './explanations/flag-explanations.service.js';
import { AiGatewayService } from './gateway/ai-gateway.service.js';
import { AnthropicProvider } from './gateway/anthropic.provider.js';
import { FakeProvider } from './gateway/fake.provider.js';
import { AI_PROVIDER } from './gateway/provider.js';
import { PolicyDocumentsService } from './policies/policy-documents.service.js';

/**
 * AI, Phase 1 (WP11): the AI gateway (masking, quota, interaction log, time
 * limit, release gate), the read-only policy and balance assistant, and payroll
 * flag explanations. With AI_PROVIDER=off the provider is null and every
 * feature reports itself unavailable; the rest of the app does not depend on it.
 * Owns tables: ai_settings, ai_usage, ai_interactions, ai_policy_documents,
 * ai_policy_chunks, ai_release_gates (read only; written by the eval script).
 */
@Module({
  imports: [IdentityModule, LeaveModule, PayrollModule, AttendanceModule],
  controllers: [AiController, AiAdminController],
  providers: [
    DocumentReaderService,
    {
      provide: AI_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.ai.provider === 'anthropic'
          ? new AnthropicProvider(config.ai.model, config.ai.anthropicApiKey)
          : config.ai.provider === 'fake'
            ? new FakeProvider()
            : null,
    },
    AiGatewayService,
    PolicyDocumentsService,
    AssistantToolsService,
    AssistantService,
    FlagExplanationsService,
    AiAdminService,
  ],
  exports: [AiGatewayService, AssistantService, PolicyDocumentsService],
})
export class AiModule {}
