/** Badge colours for states shown on several portal screens. */
export const EMPLOYEE_STATUS_COLOR = {
  draft: "gray",
  probation: "blue",
  active: "green",
  notice: "amber",
  separated: "red",
} as const;

export const RUN_STATE_COLOR = {
  draft: "gray",
  calculated: "blue",
  in_approval: "amber",
  verified: "amber",
  approved: "green",
  disbursed: "green",
  cancelled: "red",
} as const;

// finance (Phase 2)
export const VOUCHER_STATE_COLOR = {
  draft: "gray",
  in_approval: "amber",
  posted: "green",
  cancelled: "red",
} as const;
export const BILL_STATE_COLOR = {
  draft: "gray",
  in_approval: "amber",
  approved: "green",
  cancelled: "red",
} as const;
export const PAY_STATUS_COLOR = {
  unpaid: "amber",
  partly_paid: "blue",
  paid: "green",
} as const;
export const CHALLAN_STATE_COLOR = {
  in_approval: "amber",
  deposited: "green",
  cancelled: "red",
  reversed: "red",
} as const;
export const BANK_STATE_COLOR = {
  pending: "amber",
  approved: "green",
  retired: "gray",
  rejected: "red",
  cancelled: "gray",
} as const;
