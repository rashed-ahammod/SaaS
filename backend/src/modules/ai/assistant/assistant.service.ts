/**
 * The read-only policy and balance assistant (guide §16 feature 1), Bangla and English.
 *
 *   status()     which AI features the app may show right now (hidden otherwise)
 *   ask(dto)     one question (plus up to six earlier turns of the chat) -> an
 *                answer with its policy sources and an interaction id for feedback
 *
 * No actions in Phase 1: the tools only read, and the prompt sends the user to
 * the right screen when they want to do something.
 */
import { Injectable } from '@nestjs/common';
import { Clock } from '../../../platform/clock.js';
import { todayInDhaka } from '../../../platform/dates/business-date.js';
import { requestContext } from '../../../platform/tenancy/request-context.js';
import type { AskAssistantDto } from '../dto/ai.dto.js';
import { DOCUMENT_PROMPT_VERSION } from '../documents/document-reader.service.js';
import { AiGatewayService } from '../gateway/ai-gateway.service.js';
import type { AiMessage } from '../gateway/provider.js';
import { AssistantToolsService } from './assistant-tools.service.js';
import {
  ASSISTANT_PROMPT_VERSION,
  ASSISTANT_TOOLS,
  assistantSystemPrompt,
  FLAG_PROMPT_VERSION,
  REFUSAL_TEXT,
} from './prompts.js';

@Injectable()
export class AssistantService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly tools: AssistantToolsService,
    private readonly clock: Clock,
  ) {}

  async status() {
    const access = requestContext.get().access;
    const assistant = await this.gateway.availability(
      'assistant',
      ASSISTANT_PROMPT_VERSION,
    );
    const flags = await this.gateway.availability(
      'payroll_flag_explanation',
      FLAG_PROMPT_VERSION,
    );
    const reader = await this.gateway.availability(
      'document_reader',
      DOCUMENT_PROMPT_VERSION,
    );
    return {
      assistant: {
        ...assistant,
        available: assistant.available && !!access?.has('ai.assistant.use'),
      },
      payrollFlagExplanations: flags,
      // the bill and receipt reader (WP22): for bills (payables) and one's own claims
      documentReader: {
        ...reader,
        available:
          reader.available &&
          (!!access?.has('payables.manage') ||
            !!access?.has('expenses.claim_own')),
      },
    };
  }

  /** evalCaseId: a test-set run (logged as "eval:<case>", allowed before the release gate opens). */
  async ask(dto: AskAssistantDto, evalCaseId?: string) {
    const language = requestContext.get().language;
    const history: AiMessage[] = (dto.history ?? []).map((t) => ({
      role: t.role,
      text: t.text,
    }));
    const result = await this.gateway.run({
      feature: 'assistant',
      promptVersion: ASSISTANT_PROMPT_VERSION,
      inputRef: evalCaseId ? `eval:${evalCaseId}` : 'question',
      system: assistantSystemPrompt(language, todayInDhaka(this.clock.now())),
      messages: [...history, { role: 'user', text: dto.question }],
      tools: ASSISTANT_TOOLS,
      executeTool: (call) => this.tools.execute(call),
      ignoreReleaseGate: !!evalCaseId,
    });
    return {
      interactionId: result.interactionId,
      answer:
        result.status === 'refused' && !result.answer
          ? REFUSAL_TEXT[language]
          : result.answer,
      refused: result.status === 'refused',
      sources: result.sources.map((s) => ({
        title: s.title,
        heading: s.heading,
      })),
      toolsUsed: result.toolsUsed,
      language,
    };
  }
}
