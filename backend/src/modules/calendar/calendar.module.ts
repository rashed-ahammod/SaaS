import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { HolidaysController } from './holidays.controller.js';
import { HolidaysService } from './holidays.service.js';
import { WorkCalendarService } from './work-calendar.service.js';

/**
 * Working calendar (WP4): holiday calendars + "is this a working day here?".
 * Used by attendance and by the approval engine's working-hours SLA.
 * Owns tables: holiday_calendars, holidays.
 */
@Module({
  imports: [IdentityModule, OrgModule],
  controllers: [HolidaysController],
  providers: [HolidaysService, WorkCalendarService],
  exports: [WorkCalendarService],
})
export class CalendarModule {}
