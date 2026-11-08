import { businessDate } from '../../platform/dates/business-date.js';
import {
  computeDay,
  distanceMetres,
  punchWindow,
  type DayInput,
} from './day-status.js';

const at = (local: string) => new Date(`${local}+06:00`);
const general = {
  startTime: '09:00',
  endTime: '18:00',
  graceMinutes: 15,
  halfDayMinutes: 240,
};

const day = (overrides: Partial<DayInput> = {}): DayInput => ({
  date: businessDate('2026-10-15'), // Thursday
  shift: general,
  isWeekend: false,
  holidayName: null,
  onLeave: false,
  punches: [],
  otEligible: false,
  ...overrides,
});

describe('computeDay on a working day (General shift 09:00-18:00, 15 min grace)', () => {
  it('no punch -> absent; one punch -> missing punch', () => {
    expect(computeDay(day()).status).toBe('absent');
    expect(
      computeDay(day({ punches: [at('2026-10-15T09:02:00')] })).status,
    ).toBe('missing_punch');
  });

  it('on time, and within grace -> present', () => {
    const r = computeDay(
      day({ punches: [at('2026-10-15T09:14:00'), at('2026-10-15T18:05:00')] }),
    );
    expect(r).toMatchObject({
      status: 'present',
      lateMinutes: 0,
      workedMinutes: 531,
    });
  });

  it('after grace -> late, minutes counted from shift start', () => {
    const r = computeDay(
      day({ punches: [at('2026-10-15T09:40:00'), at('2026-10-15T18:00:00')] }),
    );
    expect(r).toMatchObject({ status: 'late', lateMinutes: 40 });
  });

  it('worked less than the half-day threshold -> half day', () => {
    const r = computeDay(
      day({ punches: [at('2026-10-15T09:00:00'), at('2026-10-15T12:30:00')] }),
    );
    expect(r.status).toBe('half_day');
  });

  it('overtime after shift end only for OT-eligible grades', () => {
    const punches = [at('2026-10-15T08:55:00'), at('2026-10-15T20:10:00')];
    expect(computeDay(day({ punches, otEligible: true })).otMinutes).toBe(130);
    expect(computeDay(day({ punches, otEligible: false })).otMinutes).toBe(0);
  });

  it('extra punches in between do not matter (first in, last out)', () => {
    const r = computeDay(
      day({
        punches: [
          at('2026-10-15T13:00:00'),
          at('2026-10-15T09:00:00'),
          at('2026-10-15T18:00:00'),
          at('2026-10-15T14:00:00'),
        ],
      }),
    );
    expect(r.firstIn).toEqual(at('2026-10-15T09:00:00'));
    expect(r.lastOut).toEqual(at('2026-10-15T18:00:00'));
  });
});

describe('computeDay on days off', () => {
  it('leave wins over everything', () => {
    expect(
      computeDay(
        day({ onLeave: true, isWeekend: true, holidayName: 'Victory Day' }),
      ).status,
    ).toBe('on_leave');
  });

  it('holiday and weekend; work on them is overtime for eligible grades', () => {
    expect(
      computeDay(day({ holidayName: 'Durga Puja (Bijoya Dashami)' })),
    ).toMatchObject({
      status: 'holiday',
      holidayName: 'Durga Puja (Bijoya Dashami)',
    });
    const r = computeDay(
      day({
        isWeekend: true,
        otEligible: true,
        punches: [at('2026-10-15T10:00:00'), at('2026-10-15T14:00:00')],
      }),
    );
    expect(r).toMatchObject({ status: 'weekend', otMinutes: 240 });
  });
});

describe('night shift (22:00 - 06:00)', () => {
  const night = {
    startTime: '22:00',
    endTime: '06:00',
    graceMinutes: 10,
    halfDayMinutes: 240,
  };

  it('punches after midnight belong to the shift start date', () => {
    const window = punchWindow(businessDate('2026-10-15'), night);
    expect(window.from).toEqual(at('2026-10-15T18:00:00'));
    expect(window.to).toEqual(at('2026-10-16T12:00:00'));

    const r = computeDay(
      day({
        shift: night,
        punches: [at('2026-10-15T22:30:00'), at('2026-10-16T06:00:00')],
      }),
    );
    expect(r).toMatchObject({
      status: 'late',
      lateMinutes: 30,
      workedMinutes: 450,
    });
  });
});

describe('distanceMetres', () => {
  it('Gulshan-2 to Banani is about 1.4 km; same point is 0', () => {
    const gulshan2 = { lat: 23.7925, lng: 90.4078 };
    const banani = { lat: 23.7937, lng: 90.4066 + 0.0125 };
    expect(
      distanceMetres(gulshan2.lat, gulshan2.lng, gulshan2.lat, gulshan2.lng),
    ).toBe(0);
    const d = distanceMetres(
      gulshan2.lat,
      gulshan2.lng,
      banani.lat,
      banani.lng,
    );
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1400);
  });
});
