/** Shapes of the support API (Phase 3 WP28 tickets, SLA and Customer 360). */

export type TicketPriority = "urgent" | "high" | "normal" | "low";
export type TicketState =
  | "new"
  | "open"
  | "waiting_customer"
  | "resolved"
  | "closed";
export type TicketSource =
  | "phone"
  | "email"
  | "walk_in"
  | "portal"
  | "field_visit"
  | "other";
export type TicketMessageKind = "reply" | "note" | "customer";

export const TICKET_PRIORITIES: TicketPriority[] = [
  "urgent",
  "high",
  "normal",
  "low",
];
export const TICKET_SOURCES: TicketSource[] = [
  "phone",
  "email",
  "walk_in",
  "portal",
  "field_visit",
  "other",
];
export const TICKET_STATES: TicketState[] = [
  "new",
  "open",
  "waiting_customer",
  "resolved",
  "closed",
];

export const PRIORITY_COLOR = {
  urgent: "red",
  high: "amber",
  normal: "blue",
  low: "gray",
} as const;

export const TICKET_STATE_COLOR = {
  new: "blue",
  open: "amber",
  waiting_customer: "gray",
  resolved: "green",
  closed: "gray",
} as const;

export interface TicketRow {
  id: string;
  number: string;
  subject: string;
  priority: TicketPriority;
  state: TicketState;
  assigneeId: string | null;
  customerId: string;
  customerName: string;
  categoryName: string;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  firstResponseAt: string | null;
  breached: boolean;
  resolvedAt: string | null;
  createdAt: string;
}

export interface TicketMessage {
  id: string;
  kind: TicketMessageKind;
  body: string;
  authorId: string | null;
  at: string;
}

export interface Ticket {
  id: string;
  number: string;
  companyId: string;
  customerId: string;
  categoryId: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  source: TicketSource;
  state: TicketState;
  assigneeId: string | null;
  sla: {
    from: string;
    firstResponseDueAt: string;
    resolutionDueAt: string;
    firstResponseAt: string | null;
    firstResponseBreached: boolean;
    resolutionBreached: boolean;
    waitingSince: string | null;
  };
  resolvedAt: string | null;
  resolutionNote: string | null;
  closedAt: string | null;
  reopenedCount: number;
  createdAt: string;
  version: number;
  customer: {
    id: string;
    code: string;
    name: string;
    nameBn: string | null;
    phone: string | null;
    accountManagerId: string | null;
  } | null;
  contact: {
    id: string;
    name: string;
    designation: string | null;
    phone: string | null;
  } | null;
  category: {
    id: string;
    code: string;
    name: string;
    nameBn: string | null;
  } | null;
  messages: TicketMessage[];
}

export interface TicketCategory {
  id: string;
  code: string;
  name: string;
  nameBn: string | null;
  defaultPriority: TicketPriority;
  isActive: boolean;
  version: number;
}

export type SlaPolicy = Record<
  TicketPriority,
  { firstResponseHours: number; resolutionHours: number }
>;

/** GET /customers/:id/360 — blocks the viewer may not see are absent, not empty. */
export interface Customer360 {
  customer: {
    id: string;
    code: string;
    name: string;
    nameBn: string | null;
    kind: "company" | "person";
    customerType: string;
    phone: string | null;
    email: string | null;
    district: string | null;
    address: string | null;
    accountManagerId: string | null;
    isActive: boolean;
  };
  sees: { crm: boolean; money: boolean; support: boolean };
  contacts: Array<{
    id: string;
    name: string;
    designation: string | null;
    phone: string | null;
    email: string | null;
    isPrimary: boolean;
  }>;
  activities?: Array<{
    id: string;
    kind: string;
    subject: string;
    dueAt: string | null;
    doneAt: string | null;
    at: string;
  }>;
  opportunities?: Array<{
    id: string;
    number: string;
    title: string;
    value: string;
    probability: number;
    state: string;
    stageName: string | null;
    expectedCloseOn: string;
  }>;
  quotations?: Array<{
    id: string;
    number: string;
    revision: number;
    quoteDate: string;
    validUntil: string;
    state: string;
    total: string;
  }>;
  orders?: Array<{
    id: string;
    number: string;
    orderDate: string;
    state: string;
    total: string;
  }>;
  invoices?: Array<{
    id: string;
    invoiceNo: string;
    invoiceDate: string;
    dueDate: string;
    total: string;
    posted: boolean;
  }>;
  dues?: {
    creditLimit: string;
    paymentTermsDays: number;
    owed: string;
    overdue: string;
    items: Array<{
      id: string;
      reference: string;
      dueDate: string;
      outstanding: string;
      overdue: boolean;
    }>;
  };
  tickets?: Array<{
    id: string;
    number: string;
    subject: string;
    priority: TicketPriority;
    state: TicketState;
    categoryName: string;
    resolutionDueAt: string;
    breached: boolean;
    resolvedAt: string | null;
    createdAt: string;
  }>;
}
