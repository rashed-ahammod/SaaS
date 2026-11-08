/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST  /companies/:companyId/grades
 *   GET   /companies/:companyId/grades       most senior first
 *   GET   /grades/:gradeId
 *   PATCH /grades/:gradeId                   body includes "version"
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
import { CreateGradeDto, UpdateGradeDto } from './dto/org.dto.js';
import { GradesService } from './grades.service.js';

@Controller()
export class GradesController {
  constructor(private readonly gradesService: GradesService) {}

  // POST /companies/:companyId/grades
  @UseGuards(AuthGuard)
  @RequirePermission('org.jobs.manage')
  @Post('companies/:companyId/grades')
  createGrade(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateGradeDto,
  ) {
    return this.gradesService.createGrade(companyId, dto);
  }

  // GET /companies/:companyId/grades
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('companies/:companyId/grades')
  listGrades(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.gradesService.listGrades(companyId);
  }

  // GET /grades/:gradeId
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('grades/:gradeId')
  getGrade(@Param('gradeId', ParseUUIDPipe) gradeId: string) {
    return this.gradesService.getGrade(gradeId);
  }

  // PATCH /grades/:gradeId
  @UseGuards(AuthGuard)
  @RequirePermission('org.jobs.manage')
  @Patch('grades/:gradeId')
  updateGrade(
    @Param('gradeId', ParseUUIDPipe) gradeId: string,
    @Body() dto: UpdateGradeDto,
  ) {
    return this.gradesService.updateGrade(gradeId, dto);
  }
}
