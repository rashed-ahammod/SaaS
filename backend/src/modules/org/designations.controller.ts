/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST  /companies/:companyId/designations
 *   GET   /companies/:companyId/designations
 *   GET   /designations/:designationId
 *   PATCH /designations/:designationId          body includes "version"
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { DesignationsService } from './designations.service.js';
import { CreateDesignationDto, UpdateDesignationDto } from './dto/org.dto.js';

@Controller()
export class DesignationsController {
  constructor(private readonly designationsService: DesignationsService) {}

  // POST /companies/:companyId/designations
  @UseGuards(AuthGuard)
  @RequirePermission('org.jobs.manage')
  @Post('companies/:companyId/designations')
  createDesignation(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateDesignationDto,
  ) {
    return this.designationsService.createDesignation(companyId, dto);
  }

  // GET /companies/:companyId/designations
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('companies/:companyId/designations')
  listDesignations(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.designationsService.listDesignations(companyId);
  }

  // GET /designations/:designationId
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('designations/:designationId')
  getDesignation(@Param('designationId', ParseUUIDPipe) designationId: string) {
    return this.designationsService.getDesignation(designationId);
  }

  // PATCH /designations/:designationId
  @UseGuards(AuthGuard)
  @RequirePermission('org.jobs.manage')
  @Patch('designations/:designationId')
  updateDesignation(
    @Param('designationId', ParseUUIDPipe) designationId: string,
    @Body() dto: UpdateDesignationDto,
  ) {
    return this.designationsService.updateDesignation(designationId, dto);
  }
}
