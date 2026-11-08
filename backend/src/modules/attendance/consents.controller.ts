/**
 * Routes (WP12): consent for biometric, phone-location and selfie attendance data
 *
 *   Employee:
 *     GET  /me/consents                              each notice (bn / en) and my answer
 *     POST /me/consents                              { purpose, granted }   agree or withdraw
 *
 *   HR (attendance.manage):
 *     GET  /employees/:employeeId/consents           current answers and full history
 *     POST /employees/:employeeId/consents           { purpose, granted, documentId? }   signed paper form
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { ConsentsService } from './consents.service.js';
import { GiveConsentDto, RecordConsentDto } from './dto/attendance.dto.js';

@Controller()
export class ConsentsController {
  constructor(private readonly consentsService: ConsentsService) {}

  // GET /me/consents
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.own')
  @Get('me/consents')
  mine() {
    return this.consentsService.mine();
  }

  // POST /me/consents
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.own')
  @Post('me/consents')
  giveOwn(@Body() dto: GiveConsentDto) {
    return this.consentsService.giveOwn(dto);
  }

  // GET /employees/:employeeId/consents
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Get('employees/:employeeId/consents')
  ofEmployee(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.consentsService.ofEmployee(employeeId);
  }

  // POST /employees/:employeeId/consents
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Post('employees/:employeeId/consents')
  record(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: RecordConsentDto,
  ) {
    return this.consentsService.record(employeeId, dto);
  }
}
