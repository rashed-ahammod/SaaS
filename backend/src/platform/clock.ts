/**
 * The current time, as a service, so time-dependent rules (SLA reminders and
 * escalations) can be tested by replacing it:
 *
 *   Test.createTestingModule(...).overrideProvider(Clock).useValue(fixedClock)
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

/** A clock that tests move by hand. */
export class ManualClock extends Clock {
  constructor(private current: Date) {
    super();
  }
  override now(): Date {
    return new Date(this.current);
  }
  set(to: Date): void {
    this.current = new Date(to);
  }
}
