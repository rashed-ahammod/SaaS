/** Shapes of the sales API (Phase 3 WP25-WP27). */

export interface Product {
  id: string;
  code: string;
  name: string;
  nameBn: string | null;
  kind: "goods" | "service";
  unit: string;
  vatItemId: string;
  vatItem?: string;
  stockItemId: string | null;
  stockItem?: string | null;
  isActive: boolean;
  version: number;
}
export interface PriceList {
  id: string;
  name: string;
  fiscalYear: string;
  customerType: string | null;
  isActive: boolean;
  prices: Array<{
    productId: string;
    code: string;
    name: string;
    unit: string;
    unitPrice: string;
  }>;
}
export interface DiscountLimit {
  id: string;
  userId: string | null;
  userName: string | null;
  productId: string | null;
  productCode: string | null;
  customerType: string | null;
  maxPercent: string;
}

export const QUOTE_STATE_COLOR: Record<
  string,
  "gray" | "blue" | "amber" | "green" | "red"
> = {
  draft: "gray",
  in_approval: "amber",
  approved: "blue",
  sent: "blue",
  accepted: "green",
  rejected: "red",
  expired: "gray",
  superseded: "gray",
  cancelled: "gray",
};
export const ORDER_STATE_COLOR: Record<
  string,
  "gray" | "blue" | "amber" | "green" | "red"
> = {
  in_approval: "amber",
  confirmed: "blue",
  delivered: "blue",
  invoiced: "green",
  cancelled: "gray",
};
export const RECEIPT_METHODS = [
  "cash",
  "cheque",
  "bank_transfer",
  "bkash",
  "nagad",
  "other",
] as const;

export interface Quotation {
  id: string;
  number: string;
  revision: number;
  customerId: string;
  opportunityId: string | null;
  ownerId: string;
  quoteDate: string;
  validUntil: string;
  language: "en" | "bn";
  state: string;
  needsApproval: boolean;
  approvalRequestId: string | null;
  subtotal: string;
  discountTotal: string;
  value: string;
  sdTotal: string;
  vatTotal: string;
  total: string;
  terms: string | null;
  rejectReason: string | null;
  version: number;
  customer?: string;
  ownerName?: string | null;
}
export interface QuotationDetail extends Omit<Quotation, "customer"> {
  customer: { id: string; code: string; name: string; customerType: string };
  opportunity: { id: string; number: string; title: string } | null;
  order: { id: string; number: string; state: string } | null;
  revisions: Array<{ id: string; revision: number; state: string }>;
  canWork: boolean;
  lines: Array<{
    id: string;
    lineNo: number;
    productId: string;
    productCode: string;
    description: string;
    quantity: string;
    unit: string;
    listPrice: string | null;
    unitPrice: string;
    discountPercent: string;
    discountLimit: string;
    gross: string;
    value: string;
    vatPercent: string;
    sdAmount: string;
    vatAmount: string;
    overLimit: boolean;
  }>;
}

export interface SalesOrder {
  id: string;
  companyId: string;
  number: string;
  customerId: string;
  quotationId: string | null;
  orderDate: string;
  customerRef: string | null;
  state: string;
  approvalRequestId: string | null;
  creditCheck: {
    creditLimit: string;
    openInvoices: string;
    openOrders: string;
    order: string;
    exposure: string;
    over: boolean;
    overBy: string;
  };
  deliveredOn: string | null;
  deliveryChallanNo: string | null;
  value: string;
  sdTotal: string;
  vatTotal: string;
  total: string;
  cancelReason: string | null;
  version: number;
  customer?: string;
  invoice?: { id: string; invoiceNo: string } | null;
}
export interface SalesOrderDetail extends Omit<SalesOrder, "customer"> {
  customer: {
    id: string;
    code: string;
    name: string;
    creditLimit: string;
    paymentTermsDays: number;
  };
  quotation: { id: string; number: string; revision: number } | null;
  store: { id: string; code: string; name: string } | null;
  needsStore: boolean;
  canWork: boolean;
  canInvoice: boolean;
  lines: Array<{
    id: string;
    lineNo: number;
    description: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    discountPercent: string;
    value: string;
    vatPercent: string;
    sdAmount: string;
    vatAmount: string;
  }>;
}

export interface SalesInvoice {
  id: string;
  invoiceNo: string;
  orderId: string;
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  customerName: string;
  customerBin: string | null;
  customerAddress: string | null;
  value: string;
  sdAmount: string;
  vatAmount: string;
  total: string;
  itemId: string;
  orderNumber: string;
  received: string;
  credited: string;
  outstanding: string;
}
export interface SalesInvoiceDetail extends SalesInvoice {
  voucher: { id: string; number: string } | null;
  canCredit: boolean;
  lines: Array<{
    id: string;
    lineNo: number;
    description: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    discountPercent: string;
    value: string;
    vatPercent: string;
    sdAmount: string;
    vatAmount: string;
    creditedQuantity: string;
  }>;
  creditNotes: Array<{
    id: string;
    number: string;
    noteDate: string;
    reason: string;
    total: string;
    voucherNumber: string | null;
  }>;
  receipts: Array<{
    id: string;
    number: string;
    receiptDate: string;
    state: string;
    amount: string;
  }>;
}

export interface CustomerReceipt {
  id: string;
  number: string;
  customerId: string;
  receiptDate: string;
  method: string;
  amount: string;
  vdsAmount: string;
  vdsCertificateNo: string | null;
  allocated: string;
  onAccount: string;
  chequeNo: string | null;
  chequeBank: string | null;
  reference: string | null;
  state: string;
  customer?: string;
  voucherNumber?: string | null;
}

export interface CustomerAccount {
  customer: {
    id: string;
    code: string;
    name: string;
    creditLimit: string;
    paymentTermsDays: number;
  };
  owed: string;
  onAccount: string;
  openInvoices: Array<{
    itemId: string;
    salesInvoiceId: string | null;
    reference: string;
    invoiceDate: string;
    dueDate: string;
    amount: string;
    outstanding: string;
    pending: string;
    daysLate: number;
  }>;
}

export interface Statement {
  customer: { id: string; code: string; name: string };
  from: string;
  to: string;
  opening: string;
  closing: string;
  lines: Array<{
    date: string;
    kind: string;
    number: string;
    detail: string | null;
    debit: string;
    credit: string;
    balance: string;
  }>;
}
