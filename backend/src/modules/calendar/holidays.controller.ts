/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST  /companies/:companyId/holiday-calendars          { name }
 *   GET   /companies/:companyId/holiday-calendars
 *   POST  /holiday-calendars/:calendarId/holidays           { date, nameEn, nameBn?, type }
 *   GET   /holiday-calendars/:calendarId/holidays?year=2026
 *   PATCH /holidays/:holidayId                              { date?, nameEn?, nameBn?, type?, version }
 *   POST  /holidays/:holidayId/remove                       { reason }
 *
 * Link a calendar to a branch with PATCH /branches/:branchId { holidayCalendarId }.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  CreateHolidayCalendarDto,
  CreateHolidayDto,
  RemoveHolidayDto,
  UpdateHolidayDto,
  YearQueryDto,
} from './dto/calendar.dto.js';
import { HolidaysService } from './holidays.service.js';

@Controller()
export class HolidaysController {
  constructor(private readonly holidaysService: HolidaysService) {}

  // POST /companies/:companyId/holiday-calendars
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Post('companies/:companyId/holiday-calendars')
  createCalendar(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateHolidayCalendarDto,
  ) {
    return this.holidaysService.createCalendar(companyId, dto);
  }

  // GET /companies/:companyId/holiday-calendars
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('companies/:companyId/holiday-calendars')
  listCalendars(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.holidaysService.listCalendars(companyId);
  }

  // POST /holiday-calendars/:calendarId/holidays
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Post('holiday-calendars/:calendarId/holidays')
  addHoliday(
    @Param('calendarId', ParseUUIDPipe) calendarId: string,
    @Body() dto: CreateHolidayDto,
  ) {
    return this.holidaysService.addHoliday(calendarId, dto);
  }

  // GET /holiday-calendars/:calendarId/holidays?year=
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('holiday-calendars/:calendarId/holidays')
  listHolidays(
    @Param('calendarId', ParseUUIDPipe) calendarId: string,
    @Query() query: YearQueryDto,
  ) {
    return this.holidaysService.listHolidays(calendarId, query.year);
  }

  // PATCH /holidays/:holidayId
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Patch('holidays/:holidayId')
  updateHoliday(
    @Param('holidayId', ParseUUIDPipe) holidayId: string,
    @Body() dto: UpdateHolidayDto,
  ) {
    return this.holidaysService.updateHoliday(holidayId, dto);
  }

  // POST /holidays/:holidayId/remove
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Post('holidays/:holidayId/remove')
  @HttpCode(200)
  removeHoliday(
    @Param('holidayId', ParseUUIDPipe) holidayId: string,
    @Body() dto: RemoveHolidayDto,
  ) {
    return this.holidaysService.removeHoliday(holidayId, dto);
  }
}
