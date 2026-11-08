/** Shapes of the VAT and compliance API (WP21). Money is a string. */

export type VatRateClass =
  "standard" | "reduced" | "truncated" | "zero" | "exempt";
export const RATE_CLASSES: VatRateClass[] = [
  "standard",
  "reduced",
  "truncated",
  "zero",
  "exempt",
];

export interface VatItem {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  kind: "goods" | "service";
  nbrCode: string | null;
  unit: string | null;
  isActive: boolean;
  version: number;
  rates: Array<{
    fiscalYear: string;
    rateClass: VatRateClass;
    vatPercent: string;
    sdPercent: string;
  }>;
}

export interface VatSale {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  customerBin: string | null;
  value: string;
  sdAmount: string;
  vatAmount: string;
  vdsByCustomer: string;
  receivedAmount: string;
  state: "in_approval" | "posted" | "cancelled" | "reversed";
  voucherNumber: string | null;
}

export interface PurchaseLine {
  billId: string;
  billNo: string;
  billDate: string;
  vendorName: string;
  vendorBin: string | null;
  lineNo: number;
  description: string;
  itemCode: string | null;
  value: string;
  vatPercent: string;
  vatAmount: string;
  rateClass: VatRateClass;
  claimable: boolean;
}

type Totals = { value: string; sd: string; vat: string };

export interface ReturnFigures {
  period: string;
  sales: { byClass: Record<VatRateClass, Totals>; total: Totals };
  purchases: {
    byClass: Record<VatRateClass, Totals>;
    notClaimable: Totals;
    total: Totals;
  };
  outputTax: string;
  inputTax: string;
  increasing: { vdsDeducted: string };
  decreasing: { vdsByCustomers: string };
  carryForwardIn: string;
  netTax: string;
  vds: { deducted: string; deposited: string; stillToDeposit: string };
  netPayable: string;
  carryForwardOut: string;
  notes: { sales: Record<string, number>; purchases: Record<string, number> };
}

export interface Tie {
  key: "input_vat" | "output_vat" | "vds_deducted";
  accountCode: string | null;
  fromDocuments: string;
  inLedger: string;
  difference: string;
  unexplained: Array<{
    voucherId: string;
    voucherNumber: string;
    voucherDate: string;
    narration: string;
    amount: string;
  }>;
}

export interface VatReturnPreview {
  figures: ReturnFigures;
  ties: Tie[];
  tied: boolean;
  filedReturnId: string | null;
}

export interface VatReturn {
  id: string;
  period: string;
  outputVat: string;
  inputVat: string;
  netPayable: string;
  carryForward: string;
  submittedOn: string;
  submissionRef: string | null;
  challanNo?: string | null;
  challanState?: string | null;
  figures?: ReturnFigures & { ties: Tie[] };
  settlementVoucher?: { id: string; number: string } | null;
  challan?: {
    id: string;
    challanNo: string;
    challanDate: string;
    amount: string;
    state: string;
    voucherNumber: string | null;
  } | null;
  changedSinceFiling?: boolean;
}

export interface ComplianceItem {
  id: string;
  kind: string;
  period: string;
  title: string;
  dueDate: string;
  state: "open" | "done" | "not_applicable";
  doneOn: string | null;
  evidence: string | null;
  note: string | null;
  daysLeft: number | null;
}
