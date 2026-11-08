/**
 * Routes (WP11): AI oversight and the assistant's policy texts
 *
 *   Admin (ai.manage):
 *     GET  /ai/settings                              on/off switches, plan, quota, provider and model
 *     PUT  /ai/settings                              { enabled?, assistantEnabled?, payrollExplanationsEnabled? }
 *     GET  /ai/usage?month=2026-10                   calls and tokens vs quota, answer ratings per feature
 *
 *   Admin or audit readers:
 *     GET  /ai/interactions?feature=&status=&limit=  every AI output with model, prompt version and human action
 *
 *   HR and Admin (ai.policies.manage):
 *     GET  /ai/policy-documents
 *     GET  /ai/policy-documents/:id
 *     POST /ai/policy-documents                      { title, language, body }   (plain text or Markdown)
 *     POST /ai/policy-documents/:id/deactivate       no longer used for answers
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { AiAdminService } from './ai-admin.service.js';
import {
  CreatePolicyDocumentDto,
  InteractionsQueryDto,
  UpdateAiSettingsDto,
  UsageQueryDto,
} from './dto/ai.dto.js';
import { PolicyDocumentsService } from './policies/policy-documents.service.js';

@Controller('ai')
export class AiAdminController {
  constructor(
    private readonly aiAdminService: AiAdminService,
    private readonly policyDocumentsService: PolicyDocumentsService,
  ) {}

  // GET /ai/settings
  @UseGuards(AuthGuard)
  @RequirePermission('ai.manage')
  @Get('settings')
  settings() {
    return this.aiAdminService.settings();
  }

  // PUT /ai/settings
  @UseGuards(AuthGuard)
  @RequirePermission('ai.manage')
  @Put('settings')
  updateSettings(@Body() dto: UpdateAiSettingsDto) {
    return this.aiAdminService.updateSettings(dto);
  }

  // GET /ai/usage?month=
  @UseGuards(AuthGuard)
  @RequirePermission('ai.manage')
  @Get('usage')
  usage(@Query() query: UsageQueryDto) {
    return this.aiAdminService.usage(query.month);
  }

  // GET /ai/interactions?feature=&status=&limit=
  @UseGuards(AuthGuard)
  @RequirePermission('ai.manage', 'audit.view')
  @Get('interactions')
  interactions(@Query() query: InteractionsQueryDto) {
    return this.aiAdminService.interactions(query);
  }

  // GET /ai/policy-documents
  @UseGuards(AuthGuard)
  @RequirePermission('ai.policies.manage')
  @Get('policy-documents')
  listPolicies() {
    return this.policyDocumentsService.list();
  }

  // GET /ai/policy-documents/:id
  @UseGuards(AuthGuard)
  @RequirePermission('ai.policies.manage')
  @Get('policy-documents/:id')
  getPolicy(@Param('id', ParseUUIDPipe) id: string) {
    return this.policyDocumentsService.get(id);
  }

  // POST /ai/policy-documents
  @UseGuards(AuthGuard)
  @RequirePermission('ai.policies.manage')
  @Post('policy-documents')
  createPolicy(@Body() dto: CreatePolicyDocumentDto) {
    return this.policyDocumentsService.create(dto);
  }

  // POST /ai/policy-documents/:id/deactivate
  @UseGuards(AuthGuard)
  @RequirePermission('ai.policies.manage')
  @Post('policy-documents/:id/deactivate')
  @HttpCode(200)
  deactivatePolicy(@Param('id', ParseUUIDPipe) id: string) {
    return this.policyDocumentsService.deactivate(id);
  }
}
