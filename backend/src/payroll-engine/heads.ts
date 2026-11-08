/**
 * Heads the engine itself produces. Company heads (from the salary structure
 * and manual variables) come in the input; these are always known.
 */
import type { HeadDef } from './types.js';

export const SYSTEM_HEADS: Record<string, HeadDef> = {
  UNPAID_DAYS: { code: 'UNPAID_DAYS', kind: 'earning', taxable: true }, // negative amount
  MATERNITY_PAY: { code: 'MATERNITY_PAY', kind: 'earning', taxable: true },
  ATTENDANCE_ADJUSTMENT: {
    code: 'ATTENDANCE_ADJUSTMENT',
    kind: 'earning',
    taxable: true,
  },
  OVERTIME: { code: 'OVERTIME', kind: 'earning', taxable: true },
  ARREAR: { code: 'ARREAR', kind: 'earning', taxable: true },
  LEAVE_ENCASHMENT: {
    code: 'LEAVE_ENCASHMENT',
    kind: 'earning',
    taxable: true,
  },
  FESTIVAL_BONUS: { code: 'FESTIVAL_BONUS', kind: 'earning', taxable: true },
  GRATUITY: { code: 'GRATUITY', kind: 'earning', taxable: false }, // exemption limit: ask the tax adviser
  PF_EMPLOYEE: { code: 'PF_EMPLOYEE', kind: 'deduction', taxable: false },
  LOAN_RECOVERY: { code: 'LOAN_RECOVERY', kind: 'deduction', taxable: false },
  NOTICE_SHORTFALL: {
    code: 'NOTICE_SHORTFALL',
    kind: 'deduction',
    taxable: false,
  },
  TAX: { code: 'TAX', kind: 'deduction', taxable: false },
  PF_EMPLOYER: { code: 'PF_EMPLOYER', kind: 'employer_cost', taxable: false },
  GRATUITY_PROVISION: {
    code: 'GRATUITY_PROVISION',
    kind: 'employer_cost',
    taxable: false,
  },
};
