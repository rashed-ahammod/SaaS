import {
  signCallbackToken,
  verifyCallbackToken,
} from '../../platform/outbox/callback-token.js';
import { normalizePhone } from './notifications.service.js';
import { CHANNELS, shortDate, TEMPLATES } from './templates.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const EVENT = '22222222-2222-4222-8222-222222222222';

describe('event callback token', () => {
  it('names its tenant and event, and expires after 7 days', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    const token = signCallbackToken('s3cret', TENANT, EVENT, now);
    expect(verifyCallbackToken('s3cret', token, now)).toEqual({
      tenantId: TENANT,
      eventId: EVENT,
    });
    expect(
      verifyCallbackToken('s3cret', token, new Date('2026-10-23T00:00:00Z')),
    ).toBeNull();
  });

  it('refuses another secret, a changed event and garbage', () => {
    const token = signCallbackToken('s3cret', TENANT, EVENT);
    expect(verifyCallbackToken('other', token)).toBeNull();
    expect(
      verifyCallbackToken(
        's3cret',
        token.replace(EVENT, '33333333-3333-4333-8333-333333333333'),
      ),
    ).toBeNull();
    expect(verifyCallbackToken('s3cret', 'v1.x.y.z.w')).toBeNull();
    expect(verifyCallbackToken('s3cret', undefined)).toBeNull();
  });
});

describe('templates', () => {
  it('payslip SMS in Bangla is short and carries the amount', () => {
    const t = TEMPLATES.payslip_ready('bn', {
      company: 'DTL',
      period: '2026-09',
      what: null,
      net: '29000.00',
      passwordHint: 'জন্মতারিখ (DDMMYYYY)',
      link: 'https://app.example.com/payslips/x',
    });
    expect(t.sms).toBe(
      'DTL: সেপ্টেম্বর ২০২৬ বেতন ৳২৯,০০০.০০ পরিশোধ হয়েছে। https://app.example.com/payslips/x',
    );
    expect(t.subject).toContain('৳২৯,০০০.০০');
  });

  it('attendance digest lists absent and late people', () => {
    const t = TEMPLATES.attendance_digest('en', {
      date: '2026-09-15',
      department: 'Sales',
      headcount: 4,
      lines: [
        {
          name: 'Mahmudul Hasan Rafi',
          code: 'MFL-00006',
          status: 'absent',
          lateMinutes: 0,
        },
        {
          name: 'Sumaiya Islam',
          code: 'MFL-00004',
          status: 'late',
          lateMinutes: 40,
        },
      ],
      link: 'x',
    });
    expect(t.subject).toBe('Attendance 15 Sep 2026, Sales: 1 absent, 1 late');
    expect(t.body).toContain('• Sumaiya Islam (MFL-00004) — Late 40 min');
  });

  it('dates in both languages; SMS never the only channel', () => {
    expect(shortDate('2026-10-21', 'bn')).toBe('২১ অক্টোবর ২০২৬');
    for (const channels of Object.values(CHANNELS))
      expect(channels).toContain('in_app');
  });
});

describe('phone numbers for SMS gateways', () => {
  it('Bangladeshi mobiles become +8801XXXXXXXXX', () => {
    expect(normalizePhone('01712345678')).toBe('+8801712345678');
    expect(normalizePhone('8801712345678')).toBe('+8801712345678');
    expect(normalizePhone('+8801712345678')).toBe('+8801712345678');
    expect(normalizePhone(null)).toBeNull();
  });
});
