/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET  /employees/:employeeId/onboarding                      checklist + "complete" flag
 *   POST /employees/:employeeId/onboarding/:itemCode/complete   { note? }
 *   POST /employees/:employeeId/onboarding/:itemCode/reopen
 *
 * Item codes: personal_documents, nid_verified, tin_collected, bank_account,
 *             assets_issued, email_account, id_card
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { CompleteOnboardingItemDto } from './dto/document.dto.js';
import { OnboardingService } from './onboarding.service.js';

@Controller()
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  // GET /employees/:employeeId/onboarding
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Get('employees/:employeeId/onboarding')
  getChecklist(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.onboardingService.getChecklist(employeeId);
  }

  // POST /employees/:employeeId/onboarding/:itemCode/complete
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @Post('employees/:employeeId/onboarding/:itemCode/complete')
  @HttpCode(200)
  completeItem(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('itemCode') itemCode: string,
    @Body() dto: CompleteOnboardingItemDto,
  ) {
    return this.onboardingService.completeItem(employeeId, itemCode, dto);
  }

  // POST /employees/:employeeId/onboarding/:itemCode/reopen
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @Post('employees/:employeeId/onboarding/:itemCode/reopen')
  @HttpCode(200)
  reopenItem(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('itemCode') itemCode: string,
  ) {
    return this.onboardingService.reopenItem(employeeId, itemCode);
  }
}
