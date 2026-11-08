/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/compliance?from=&to=&state=open    the calendar (kept up to date on read)
 *   POST  /companies/:companyId/compliance                         Accounts / Admin  { title, dueDate, note? }  a company's own item
 *   POST  /compliance/:itemId/close                                Accounts / Admin  { state: done | not_applicable, evidence, doneOn? }
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { ComplianceService } from './compliance.service.js';
import {
  CloseComplianceDto,
  ComplianceItemDto,
  ComplianceQueryDto,
} from './dto/vat.dto.js';

@Controller()
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  // GET /companies/:companyId/compliance
  @UseGuards(AuthGuard)
  @RequirePermission('compliance.view', 'compliance.manage')
  @Get('companies/:companyId/compliance')
  list(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: ComplianceQueryDto,
  ) {
    return this.complianceService.list(companyId, query);
  }

  // POST /companies/:companyId/compliance
  @UseGuards(AuthGuard)
  @RequirePermission('compliance.manage')
  @Post('companies/:companyId/compliance')
  add(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: ComplianceItemDto,
  ) {
    return this.complianceService.add(companyId, dto);
  }

  // POST /compliance/:itemId/close
  @UseGuards(AuthGuard)
  @RequirePermission('compliance.manage')
  @Post('compliance/:itemId/close')
  @HttpCode(200)
  close(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: CloseComplianceDto,
  ) {
    return this.complianceService.close(itemId, dto);
  }
}
