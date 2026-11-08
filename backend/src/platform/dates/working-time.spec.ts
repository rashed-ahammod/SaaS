import { weekdayOf, type BusinessDate } from './business-date.js';
import { addWorkingHours } from './working-time.js';

/** Dhaka HQ: Friday + Saturday weekend, plus one holiday (Victory Day). */
const dhakaHq = (date: BusinessDate) =>
  !['FRI', 'SAT'].includes(weekdayOf(date)) && date !== '2026-12-16';
const dhaka = (local: string) => new Date(`${local}+06:00`);

describe('addWorkingHours (Asia/Dhaka)', () => {
  it('runs normally inside working days', () => {
    // Sunday 10:00 + 24h = Monday 10:00
    expect(addWorkingHours(dhaka('2026-10-18T10:00:00'), 24, dhakaHq)).toEqual(
      dhaka('2026-10-19T10:00:00'),
    );
  });

  it('skips the Friday + Saturday weekend', () => {
    // Thursday 15:00 + 24h: 9h Thursday, weekend skipped, 15h Sunday -> Sunday 15:00
    expect(addWorkingHours(dhaka('2026-10-15T15:00:00'), 24, dhakaHq)).toEqual(
      dhaka('2026-10-18T15:00:00'),
    );
    // + 48h -> Monday 15:00
    expect(addWorkingHours(dhaka('2026-10-15T15:00:00'), 48, dhakaHq)).toEqual(
      dhaka('2026-10-19T15:00:00'),
    );
  });

  it('starts counting on the next working day when submitted on a weekend', () => {
    expect(addWorkingHours(dhaka('2026-10-16T10:00:00'), 24, dhakaHq)).toEqual(
      dhaka('2026-10-19T00:00:00'),
    );
  });

  it('skips holidays', () => {
    // Tuesday 15 Dec 12:00 + 24h: 12h Tue, Wed 16 Dec is a holiday, 12h Thu -> Thu 12:00
    expect(addWorkingHours(dhaka('2026-12-15T12:00:00'), 24, dhakaHq)).toEqual(
      dhaka('2026-12-17T12:00:00'),
    );
  });

  it('a branch with only a Friday weekend counts Saturday', () => {
    const ctg = (date: BusinessDate) => weekdayOf(date) !== 'FRI';
    expect(addWorkingHours(dhaka('2026-10-15T15:00:00'), 24, ctg)).toEqual(
      dhaka('2026-10-17T15:00:00'),
    );
  });
});
