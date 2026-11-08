/**
 * Routes (WP11)
 *
 *   Signed-in user:
 *     GET  /ai/status                                which AI features the app may show now
 *     POST /ai/assistant                             { question, history? }   read-only assistant
 *     POST /ai/interactions/:id/feedback             { action: helpful|not_helpful, note? }
 *
 *   Payroll reviewers (prepare / verify / approve):
 *     POST /payroll-flags/:flagId/explanation        plain-language explanation of a rule-based flag
 *
 *   Bills and receipts (payables.manage, or an employee's own claims):
 *     POST /ai/document-reader                       multipart "file" + { kind: bill | receipt, companyId? }  -> fields to check
 *
 * The AI calls wait for an outside model, so they run with short transactions
 * (@ShortTransactions) and without an Idempotency-Key: they change nothing in
 * the business data, and a repeated question is simply asked again.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AnyAuthenticated,
  RequirePermission,
} from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { SkipIdempotency } from '../../platform/idempotency/idempotency.interceptor.js';
import { ShortTransactions } from '../../platform/tenancy/tenant-transaction.interceptor.js';
import { AssistantService } from './assistant/assistant.service.js';
import {
  DocumentReaderService,
  MAX_DOCUMENT_BYTES,
} from './documents/document-reader.service.js';
import { AskAssistantDto, DocumentReadDto, FeedbackDto } from './dto/ai.dto.js';
import { FlagExplanationsService } from './explanations/flag-explanations.service.js';
import { AiGatewayService } from './gateway/ai-gateway.service.js';

@Controller()
export class AiController {
  constructor(
    private readonly assistantService: AssistantService,
    private readonly flagExplanationsService: FlagExplanationsService,
    private readonly aiGatewayService: AiGatewayService,
    private readonly documentReaderService: DocumentReaderService,
  ) {}

  // POST /ai/document-reader
  @UseGuards(AuthGuard)
  @RequirePermission('payables.manage', 'expenses.claim_own')
  @ShortTransactions()
  @SkipIdempotency()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
    }),
  )
  @Post('ai/document-reader')
  @HttpCode(200)
  readDocument(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: DocumentReadDto,
  ) {
    return this.documentReaderService.read(file, dto.kind, dto.companyId);
  }

  // GET /ai/status
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Get('ai/status')
  status() {
    return this.assistantService.status();
  }

  // POST /ai/assistant
  @UseGuards(AuthGuard)
  @RequirePermission('ai.assistant.use')
  @ShortTransactions()
  @SkipIdempotency()
  @Post('ai/assistant')
  @HttpCode(200)
  ask(@Body() dto: AskAssistantDto) {
    return this.assistantService.ask(dto);
  }

  // POST /ai/interactions/:id/feedback
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @SkipIdempotency()
  @Post('ai/interactions/:id/feedback')
  @HttpCode(200)
  feedback(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FeedbackDto) {
    return this.aiGatewayService.feedback(id, dto.action, dto.note);
  }

  // POST /payroll-flags/:flagId/explanation
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.approve')
  @ShortTransactions()
  @SkipIdempotency()
  @Post('payroll-flags/:flagId/explanation')
  @HttpCode(200)
  explainFlag(@Param('flagId', ParseUUIDPipe) flagId: string) {
    return this.flagExplanationsService.explain(flagId);
  }
}
