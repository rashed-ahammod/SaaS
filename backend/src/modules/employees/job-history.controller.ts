/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST /employees/:employeeId/job-events                     transfer, promotion, ... (can be back-dated)
 *   GET  /employees/:employeeId/job-events                     every recorded change, incl. cancelled
 *   POST /employees/:employeeId/job-events/:eventId/cancel     { reason }
 *   GET  /employees/:employeeId/assignments                    the timeline (all periods)
 *   GET  /employees/:employeeId/assignments?asOf=2026-03-15    the period in force on a date
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
import { IsOptional } from 'class-validator';
import { IsBusinessDate } from '../../platform/http/common.dto.js';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { CancelJobEventDto, CreateJobEventDto } from './dto/job-event.dto.js';
import { JobHistoryService } from './job-history.service.js';

class AsOfQueryDto {
  @IsOptional()
  @IsBusinessDate()
  asOf?: string;
}

@Controller()
export class JobHistoryController {
  constructor(private readonly jobHistoryService: JobHistoryService) {}

  // POST /employees/:employeeId/job-events
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @Post('employees/:employeeId/job-events')
  createJobEvent(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: CreateJobEventDto,
  ) {
    return this.jobHistoryService.createJobEvent(employeeId, dto);
  }

  // GET /employees/:employeeId/job-events
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Get('employees/:employeeId/job-events')
  listJobEvents(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.jobHistoryService.listJobEvents(employeeId);
  }

  // POST /employees/:employeeId/job-events/:eventId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @Post('employees/:employeeId/job-events/:eventId/cancel')
  @HttpCode(200)
  cancelJobEvent(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CancelJobEventDto,
  ) {
    return this.jobHistoryService.cancelJobEvent(employeeId, eventId, dto);
  }

  // GET /employees/:employeeId/assignments
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Get('employees/:employeeId/assignments')
  getAssignments(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: AsOfQueryDto,
  ) {
    return this.jobHistoryService.getAssignments(employeeId, query.asOf);
  }
}
