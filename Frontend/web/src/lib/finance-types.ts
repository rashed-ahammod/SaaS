/** Shapes of the finance API answers the portal uses (Phase 2: WP14 ledger, WP15 payables). */

export type AccountType =
  "asset" | "liability" | "equity" | "income" | "expense";

export interface Account {
  id: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  type: AccountType;
  parentId: string | null;
  postable: boolean;
  role: string | null;
  isActive: boolean;
  depth: number;
  version: number;
}

export interface LedgerStatus {
  setUp: boolean;
  accounts: number;
  fiscalYears: Array<{
    id: string;
    code: string;
    startsOn: string;
    endsOn: string;
  }>;
  missingPostingAccounts: string[];
}

export interface PostingAccount {
  key: string;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
}

export interface Period {
  id: string;
  period: string;
  startsOn: string;
  endsOn: string;
  state: "open" | "closed";
  closedAt: string | null;
}

export type VoucherType = "payment" | "receipt" | "journal" | "contra";
export type VoucherState = "draft" | "in_approval" | "posted" | "cancelled";

export interface VoucherSummary {
  id: string;
  voucherType: VoucherType;
  number: string;
  voucherDate: string;
  narration: string;
  state: VoucherState;
  total: string;
  sourceType: string | null;
  sourceId: string | null;
  isOpening: boolean;
  reversalOf: string | null;
  reversedBy: string | null;
  reason: string | null;
  approvalRequestId: string | null;
  version: number;
}

export interface VoucherLine {
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  departmentId: string | null;
  department: string | null;
  partyType: string | null;
  partyId: string | null;
  debit: string;
  credit: string;
  narration: string | null;
}

export interface Voucher extends VoucherSummary {
  lines: VoucherLine[];
}

export interface Check {
  ok: boolean;
  problems: Array<{ check: string; detail: string; sourceId?: string }>;
}

export interface TrialBalance {
  from: string;
  asOf: string;
  balanced: boolean;
  rows: Array<{
    accountId: string;
    code: string;
    name: string;
    type: AccountType;
    opening: string;
    debit: string;
    credit: string;
    closingDebit: string;
    closingCredit: string;
  }>;
  totals: {
    debit: string;
    credit: string;
    closingDebit: string;
    closingCredit: string;
  };
}

export interface ReportLine {
  accountId: string;
  code: string;
  name: string;
  group: string | null;
  amount: string;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  income: { lines: ReportLine[]; total: string };
  expenses: { lines: ReportLine[]; total: string };
  netProfit: string;
}

export interface BalanceSheet {
  asOf: string;
  assets: { lines: ReportLine[]; total: string };
  liabilities: { lines: ReportLine[]; total: string };
  equity: { lines: ReportLine[]; total: string };
  balanced: boolean;
}

export interface GeneralLedger {
  account: { id: string; code: string; name: string };
  from: string;
  to: string;
  opening: string;
  closing: string;
  lines: Array<{
    voucherId: string;
    number: string;
    date: string;
    type: VoucherType;
    narration: string;
    debit: string;
    credit: string;
    balance: string;
  }>;
}

// ------------------------------------------------------------- payables

export interface Vendor {
  id: string;
  code: string;
  name: string;
  nameBn: string | null;
  vendorType: "company" | "individual";
  tin: string | null;
  bin: string | null;
  tradeLicence: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  withholdingCategory: string;
  paymentTermsDays: number | null;
  isActive: boolean;
  version: number;
  bankAccounts?: Array<{
    id: string;
    bankName: string;
    account: string;
    status: string;
    approvalRequestId: string | null;
    approvedAt: string | null;
  }>;
}

export interface Category {
  code: string;
  nameEn: string;
  nameBn: string | null;
  section: string | null;
  tdsPercent: string | null;
  tdsSlabs: Array<{ upTo: string | null; percent: string }> | null;
  vdsShareOfVatPercent: string;
}

export type BillState = "draft" | "in_approval" | "approved" | "cancelled";

export interface BillSummary {
  id: string;
  companyId: string;
  vendorId: string;
  vendorCode?: string;
  vendorName?: string;
  billNo: string;
  billDate: string;
  dueDate: string;
  narration: string;
  withholdingCategory: string;
  baseAmount: string;
  vatAmount: string;
  total: string;
  tdsPercent: string;
  tdsAmount: string;
  vdsPercent: string;
  vdsAmount: string;
  inputVat: string;
  vatInCost: string;
  netPayable: string;
  paidAmount: string;
  pendingPayments: string;
  outstanding: string;
  paymentStatus: "unpaid" | "partly_paid" | "paid" | null;
  state: BillState;
  rulePack: string | null;
  voucherId: string | null;
  approvalRequestId: string | null;
  cancelReason: string | null;
  version: number;
}

export interface Bill extends BillSummary {
  purchaseOrderId: string | null;
  matchStatus: import("./procurement-types").MatchStatus;
  matchDetails: import("./procurement-types").MatchDetails | null;
  matchOverrideReason: string | null;
  vendor: {
    id: string;
    code: string;
    name: string;
    tin: string | null;
    bin: string | null;
  };
  voucherNumber: string | null;
  lines: Array<{
    lineNo: number;
    accountId: string;
    accountCode: string;
    accountName: string;
    departmentId: string | null;
    description: string;
    amount: string;
    vatPercent: string;
    vatAmount: string;
  }>;
  payments: Array<{
    paymentId: string;
    paymentDate: string;
    method: string;
    state: string;
    amount: string;
    voucherNumber: string | null;
  }>;
  withholdings: Array<{
    id: string;
    taxType: "tds" | "vds";
    base: string;
    percent: string;
    amount: string;
    state: string;
    challanNo: string | null;
    challanState: string | null;
    certificateNo: string | null;
  }>;
}

export interface VendorPayment {
  id: string;
  vendorId: string;
  vendorCode?: string;
  vendorName?: string;
  paymentDate: string;
  method: string;
  reference: string | null;
  amount: string;
  state: "in_approval" | "paid" | "cancelled" | "reversed";
  voucherId: string | null;
  voucherNumber: string | null;
  approvalRequestId: string | null;
}

export interface Withholdings {
  total: string;
  items: Array<{
    id: string;
    taxType: "tds" | "vds";
    category: string;
    base: string;
    percent: string;
    amount: string;
    deductedOn: string;
    period: string;
    vendorCode: string;
    vendorName: string;
    vendorTin: string | null;
    billNo: string;
    challanNo: string | null;
    challanState: string | null;
    certified: boolean;
  }>;
}

export interface Challan {
  id: string;
  taxType: "tds" | "vds";
  period: string;
  challanNo: string;
  challanDate: string;
  amount: string;
  state: "in_approval" | "deposited" | "cancelled" | "reversed";
  voucherId: string | null;
  voucherNumber: string | null;
  approvalRequestId: string | null;
}

export interface Certificate {
  id: string;
  number: string;
  taxType: "tds" | "vds";
  vendorCode?: string;
  vendorName?: string;
  periodFrom: string;
  periodTo: string;
  amount: string;
  issuedAt: string;
}

export interface CertificateDetail extends Certificate {
  title: string;
  deductor: { name: string };
  vendor: {
    code: string;
    name: string;
    nameBn: string | null;
    tin: string | null;
    bin: string | null;
    address: string | null;
  };
  lines: Array<{
    billNo: string;
    billDate: string;
    category: string;
    base: string;
    percent: string;
    amount: string;
    challanNo: string;
    challanDate: string;
  }>;
}

export interface Aging {
  asOf: string;
  vendors: Array<{
    vendorId: string;
    code: string;
    name: string;
    bills: number;
    notDue: string;
    days1to30: string;
    days31to60: string;
    days61to90: string;
    over90: string;
    total: string;
  }>;
  totals: {
    notDue: string;
    days1to30: string;
    days31to60: string;
    days61to90: string;
    over90: string;
    total: string;
  };
}

export interface PayablesSettings {
  vatWithholdingEntity: boolean;
  defaultPaymentTermsDays: number;
}
