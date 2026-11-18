/**
 * Support rules that are settings, not code (WP28).
 *
 * The SLA hours below are the values the product ships with, in WORKING hours
 * (spec §5: weekends and holidays do not count). They are ILLUSTRATIVE, like the
 * withholding rates of WP15: a pilot's service manager sets the real ones per
 * company with  PUT /companies/:id/support/sla  before the first ticket matters.
 */
import type { TicketPriority, TicketState } from '../../platform/db/schema.js';

export const TICKET_PRIORITIES: TicketPriority[] = [
  'urgent',
  'high',
  'normal',
  'low',
];

export interface SlaHours {
  firstResponseHours: number;
  resolutionHours: number;
}

/** Working hours per priority, until the company sets its own. */
export const DEFAULT_SLA: Record<TicketPriority, SlaHours> = {
  urgent: { firstResponseHours: 2, resolutionHours: 8 },
  high: { firstResponseHours: 4, resolutionHours: 24 },
  normal: { firstResponseHours: 8, resolutionHours: 48 },
  low: { firstResponseHours: 24, resolutionHours: 120 },
};

/** Categories a new company starts with (it may rename or retire them). */
export const DEFAULT_CATEGORIES: Array<{
  code: string;
  name: string;
  nameBn: string;
  defaultPriority: TicketPriority;
}> = [
  {
    code: 'DELIVERY',
    name: 'Delivery problem',
    nameBn: 'সরবরাহ সমস্যা',
    defaultPriority: 'high',
  },
  {
    code: 'QUALITY',
    name: 'Product quality',
    nameBn: 'পণ্যের গুণমান',
    defaultPriority: 'high',
  },
  {
    code: 'BILLING',
    name: 'Bill or payment',
    nameBn: 'বিল বা পরিশোধ',
    defaultPriority: 'normal',
  },
  {
    code: 'SERVICE',
    name: 'Service request',
    nameBn: 'সেবার অনুরোধ',
    defaultPriority: 'normal',
  },
  {
    code: 'OTHER',
    name: 'Other',
    nameBn: 'অন্যান্য',
    defaultPriority: 'low',
  },
];

/**
 * The ticket's life (spec §6.8 step 7). "waiting_customer" is the only state where
 * the resolution clock stops, because the delay is then the customer's.
 */
const NEXT: Record<TicketState, TicketState[]> = {
  new: ['open', 'waiting_customer', 'resolved'],
  open: ['waiting_customer', 'resolved'],
  waiting_customer: ['open', 'resolved'],
  resolved: ['closed', 'open'], // open again = reopened
  closed: ['open'], // reopened
};

export function canMove(from: TicketState, to: TicketState): boolean {
  return NEXT[from].includes(to);
}

export const OPEN_STATES: TicketState[] = ['new', 'open', 'waiting_customer'];

/** An hours value as the database stores it: numeric(6,2) comes back as a string. */
export function hours(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}
