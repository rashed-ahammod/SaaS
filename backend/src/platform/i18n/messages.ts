/**
 * User-facing messages in English and Bangla (guide §19: no hardcoded text).
 *
 * Services throw Nest exceptions with a message KEY:
 *     throw new NotFoundException(MSG.USER_NOT_FOUND);
 * and HttpExceptionFilter replaces the key with the text in the user's language.
 *
 * To add a message: add the key to MSG, then the text to BOTH `en` and `bn`.
 * TypeScript refuses to compile if a language is missing a key.
 */

export const MSG = {
  // general
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // auth
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  AUTH_MFA_INVALID_CODE: 'AUTH_MFA_INVALID_CODE',
  AUTH_MFA_NOT_SET_UP: 'AUTH_MFA_NOT_SET_UP',
  AUTH_MFA_ALREADY_ENABLED: 'AUTH_MFA_ALREADY_ENABLED',
  AUTH_STEP_UP_REQUIRED: 'AUTH_STEP_UP_REQUIRED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  // data
  DUPLICATE_VALUE: 'DUPLICATE_VALUE',
  REFERENCE_NOT_FOUND: 'REFERENCE_NOT_FOUND',
  STALE_VERSION: 'STALE_VERSION',
  INVALID_DATE: 'INVALID_DATE',
  // organization and employees
  COMPANY_NOT_FOUND: 'COMPANY_NOT_FOUND',
  BRANCH_NOT_FOUND: 'BRANCH_NOT_FOUND',
  DEPARTMENT_NOT_FOUND: 'DEPARTMENT_NOT_FOUND',
  DEPARTMENT_CYCLE: 'DEPARTMENT_CYCLE',
  DESIGNATION_NOT_FOUND: 'DESIGNATION_NOT_FOUND',
  GRADE_NOT_FOUND: 'GRADE_NOT_FOUND',
  EMPLOYEE_NOT_FOUND: 'EMPLOYEE_NOT_FOUND',
  EMPLOYEE_NOT_DRAFT: 'EMPLOYEE_NOT_DRAFT',
  EMPLOYEE_JOIN_DATE_LOCKED: 'EMPLOYEE_JOIN_DATE_LOCKED',
  INVALID_NID: 'INVALID_NID',
  INVALID_TIN: 'INVALID_TIN',
  MANAGER_INVALID: 'MANAGER_INVALID',
  JOB_EVENT_BEFORE_JOINING: 'JOB_EVENT_BEFORE_JOINING',
  JOB_EVENT_NO_CHANGES: 'JOB_EVENT_NO_CHANGES',
  JOB_EVENT_NOT_FOUND: 'JOB_EVENT_NOT_FOUND',
  JOB_EVENT_ALREADY_CANCELLED: 'JOB_EVENT_ALREADY_CANCELLED',
  JOINING_EVENT_CANNOT_CANCEL: 'JOINING_EVENT_CANNOT_CANCEL',
  ONBOARDING_INCOMPLETE: 'ONBOARDING_INCOMPLETE',
  ONBOARDING_ITEM_NOT_FOUND: 'ONBOARDING_ITEM_NOT_FOUND',
  DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
  FILE_REQUIRED: 'FILE_REQUIRED',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  // access control, approvals, bank accounts
  AUTH_MFA_REQUIRED: 'AUTH_MFA_REQUIRED',
  AUTH_STEP_UP_INVALID: 'AUTH_STEP_UP_INVALID',
  ROLE_NOT_FOUND: 'ROLE_NOT_FOUND',
  ROLE_SCOPE_INVALID: 'ROLE_SCOPE_INVALID',
  ROLE_EXPIRY_REQUIRED: 'ROLE_EXPIRY_REQUIRED',
  ROLE_SELF_GRANT: 'ROLE_SELF_GRANT',
  ROLE_GRANT_NOT_FOUND: 'ROLE_GRANT_NOT_FOUND',
  PERMISSION_UNKNOWN: 'PERMISSION_UNKNOWN',
  FIELD_GRANT_NOT_FOUND: 'FIELD_GRANT_NOT_FOUND',
  DELEGATION_NOT_FOUND: 'DELEGATION_NOT_FOUND',
  APPROVAL_NOT_FOUND: 'APPROVAL_NOT_FOUND',
  APPROVAL_NOT_OPEN: 'APPROVAL_NOT_OPEN',
  APPROVAL_NOT_YOUR_TURN: 'APPROVAL_NOT_YOUR_TURN',
  APPROVAL_SELF_APPROVAL: 'APPROVAL_SELF_APPROVAL',
  APPROVAL_NO_APPROVER: 'APPROVAL_NO_APPROVER',
  APPROVAL_NO_CHAIN: 'APPROVAL_NO_CHAIN',
  APPROVAL_COMMENT_REQUIRED: 'APPROVAL_COMMENT_REQUIRED',
  APPROVAL_CANCEL_NOT_ALLOWED: 'APPROVAL_CANCEL_NOT_ALLOWED',
  BANK_ACCOUNT_NOT_FOUND: 'BANK_ACCOUNT_NOT_FOUND',
  BANK_ACCOUNT_PENDING_EXISTS: 'BANK_ACCOUNT_PENDING_EXISTS',
  OUTBOX_EVENT_NOT_DEAD: 'OUTBOX_EVENT_NOT_DEAD',
  // rule pack
  RULE_PACK_NOT_FOUND: 'RULE_PACK_NOT_FOUND',
  RULE_PACK_NOT_ACCEPTED: 'RULE_PACK_NOT_ACCEPTED',
  RULE_NOT_FOUND: 'RULE_NOT_FOUND',
  RULE_NOT_VERIFIED: 'RULE_NOT_VERIFIED',
  // attendance and service keys
  SERVICE_KEY_INVALID: 'SERVICE_KEY_INVALID',
  SHIFT_NOT_FOUND: 'SHIFT_NOT_FOUND',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  ATTENDANCE_DEVICE_NOT_REGISTERED: 'ATTENDANCE_DEVICE_NOT_REGISTERED',
  ATTENDANCE_OUTSIDE_GEOFENCE: 'ATTENDANCE_OUTSIDE_GEOFENCE',
  ATTENDANCE_GEOFENCE_NOT_SET: 'ATTENDANCE_GEOFENCE_NOT_SET',
  ATTENDANCE_WEB_PUNCH_NOT_ALLOWED: 'ATTENDANCE_WEB_PUNCH_NOT_ALLOWED',
  ATTENDANCE_NOT_EMPLOYED: 'ATTENDANCE_NOT_EMPLOYED',
  ATTENDANCE_CORRECTION_LIMIT: 'ATTENDANCE_CORRECTION_LIMIT',
  ATTENDANCE_DATE_IN_FUTURE: 'ATTENDANCE_DATE_IN_FUTURE',
  ATTENDANCE_NO_OVERTIME: 'ATTENDANCE_NO_OVERTIME',
  ATTENDANCE_MONTH_LOCKED: 'ATTENDANCE_MONTH_LOCKED',
  // leave
  LEAVE_TYPE_NOT_FOUND: 'LEAVE_TYPE_NOT_FOUND',
  LEAVE_REQUEST_NOT_FOUND: 'LEAVE_REQUEST_NOT_FOUND',
  LEAVE_NOT_ELIGIBLE: 'LEAVE_NOT_ELIGIBLE',
  LEAVE_INSUFFICIENT_BALANCE: 'LEAVE_INSUFFICIENT_BALANCE',
  LEAVE_OVERLAP: 'LEAVE_OVERLAP',
  LEAVE_TOO_FAR_BACK: 'LEAVE_TOO_FAR_BACK',
  LEAVE_HALF_DAY_NOT_ALLOWED: 'LEAVE_HALF_DAY_NOT_ALLOWED',
  LEAVE_NO_DAYS: 'LEAVE_NO_DAYS',
  LEAVE_DOCUMENT_REQUIRED: 'LEAVE_DOCUMENT_REQUIRED',
  LEAVE_TOO_LONG: 'LEAVE_TOO_LONG',
  LEAVE_CANNOT_CANCEL: 'LEAVE_CANNOT_CANCEL',
  LEAVE_NOT_RETURNED: 'LEAVE_NOT_RETURNED',
  // payroll
  APPROVAL_ALREADY_APPROVED_EARLIER_STEP:
    'APPROVAL_ALREADY_APPROVED_EARLIER_STEP',
  PAYROLL_RUN_NOT_FOUND: 'PAYROLL_RUN_NOT_FOUND',
  PAYROLL_RUN_WRONG_STATE: 'PAYROLL_RUN_WRONG_STATE',
  PAYROLL_ATTENDANCE_NOT_LOCKED: 'PAYROLL_ATTENDANCE_NOT_LOCKED',
  PAYROLL_FLAGS_OPEN: 'PAYROLL_FLAGS_OPEN',
  PAYROLL_NO_SALARY: 'PAYROLL_NO_SALARY',
  PAYROLL_STRUCTURE_INVALID: 'PAYROLL_STRUCTURE_INVALID',
  PAYROLL_STRUCTURE_NOT_FOUND: 'PAYROLL_STRUCTURE_NOT_FOUND',
  PAYROLL_HEAD_NOT_FOUND: 'PAYROLL_HEAD_NOT_FOUND',
  SALARY_NOT_FOUND: 'SALARY_NOT_FOUND',
  LOAN_NOT_FOUND: 'LOAN_NOT_FOUND',
  PAYROLL_PERIOD_PAID: 'PAYROLL_PERIOD_PAID',
  PAYROLL_NOT_SEPARATING: 'PAYROLL_NOT_SEPARATING',
  PAYSLIP_NOT_FOUND: 'PAYSLIP_NOT_FOUND',
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  ASSET_CLASS_NOT_FOUND: 'ASSET_CLASS_NOT_FOUND',
  ASSET_WRONG_STATE: 'ASSET_WRONG_STATE',
  ASSET_ASSIGNED: 'ASSET_ASSIGNED',
  ASSETS_NOT_RETURNED: 'ASSETS_NOT_RETURNED',
  DEPRECIATION_PERIOD_INVALID: 'DEPRECIATION_PERIOD_INVALID',
  DEPRECIATION_RUN_NOT_FOUND: 'DEPRECIATION_RUN_NOT_FOUND',
  DEPRECIATION_NOT_LATEST: 'DEPRECIATION_NOT_LATEST',
  STORE_NOT_FOUND: 'STORE_NOT_FOUND',
  STOCK_ITEM_NOT_FOUND: 'STOCK_ITEM_NOT_FOUND',
  STOCK_NOT_ENOUGH: 'STOCK_NOT_ENOUGH',
  STOCK_REQUEST_NOT_FOUND: 'STOCK_REQUEST_NOT_FOUND',
  STOCK_REQUEST_WRONG_STATE: 'STOCK_REQUEST_WRONG_STATE',
  CRM_DUPLICATE: 'CRM_DUPLICATE',
  CRM_CONTACT_INVALID: 'CRM_CONTACT_INVALID',
  CRM_OWNER_INVALID: 'CRM_OWNER_INVALID',
  CRM_NO_SALESPERSON: 'CRM_NO_SALESPERSON',
  LEAD_NOT_FOUND: 'LEAD_NOT_FOUND',
  LEAD_WRONG_STATE: 'LEAD_WRONG_STATE',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  ACTIVITY_NOT_FOUND: 'ACTIVITY_NOT_FOUND',
  TERRITORY_NOT_FOUND: 'TERRITORY_NOT_FOUND',
  TERRITORY_DISTRICT_TAKEN: 'TERRITORY_DISTRICT_TAKEN',
  OPPORTUNITY_NOT_FOUND: 'OPPORTUNITY_NOT_FOUND',
  OPPORTUNITY_WRONG_STATE: 'OPPORTUNITY_WRONG_STATE',
  STAGE_NOT_FOUND: 'STAGE_NOT_FOUND',
  STAGE_IN_USE: 'STAGE_IN_USE',
  TARGET_INVALID: 'TARGET_INVALID',
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  PRODUCT_CODE_TAKEN: 'PRODUCT_CODE_TAKEN',
  PRICE_MISSING: 'PRICE_MISSING',
  SALES_QUOTATION_NOT_FOUND: 'SALES_QUOTATION_NOT_FOUND',
  QUOTATION_WRONG_STATE: 'QUOTATION_WRONG_STATE',
  QUOTATION_EXPIRED: 'QUOTATION_EXPIRED',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ORDER_WRONG_STATE: 'ORDER_WRONG_STATE',
  INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
  INVOICE_LINE_NOT_FOUND: 'INVOICE_LINE_NOT_FOUND',
  CREDIT_TOO_MUCH: 'CREDIT_TOO_MUCH',
  SALES_DOCUMENT_NOT_REVERSIBLE: 'SALES_DOCUMENT_NOT_REVERSIBLE',
  CUSTOMER_RECEIPT_NOT_FOUND: 'CUSTOMER_RECEIPT_NOT_FOUND',
  PF_PAYMENT_NOT_REVERSIBLE: 'PF_PAYMENT_NOT_REVERSIBLE',
  PF_TOO_MUCH: 'PF_TOO_MUCH',
  PF_NOT_LEAVING: 'PF_NOT_LEAVING',
  PF_SETTLED: 'PF_SETTLED',
  PF_PENDING: 'PF_PENDING',
  SALES_STORE_NEEDED: 'SALES_STORE_NEEDED',
  RESIGNATION_PENDING: 'RESIGNATION_PENDING',
  RESIGNATION_NOT_POSSIBLE: 'RESIGNATION_NOT_POSSIBLE',
  RECEIPT_ALLOCATION_INVALID: 'RECEIPT_ALLOCATION_INVALID',
  RECEIPT_ADVANCE_USED: 'RECEIPT_ADVANCE_USED',
  ADVANCE_TOO_MUCH: 'ADVANCE_TOO_MUCH',
  OPENING_FILE_INVALID: 'OPENING_FILE_INVALID',
  OPENING_IMPORT_FINAL: 'OPENING_IMPORT_FINAL',
  OLD_TB_INVALID: 'OLD_TB_INVALID',
  RECEIVABLE_NOT_FOUND: 'RECEIVABLE_NOT_FOUND',
  RECEIPT_TOO_MUCH: 'RECEIPT_TOO_MUCH',
  MONTH_CLOSE_NOT_READY: 'MONTH_CLOSE_NOT_READY',
  MONTH_CLOSE_ITEM_UNKNOWN: 'MONTH_CLOSE_ITEM_UNKNOWN',
  DOCUMENT_UNREADABLE: 'DOCUMENT_UNREADABLE',
  VAT_ITEM_NOT_FOUND: 'VAT_ITEM_NOT_FOUND',
  VAT_RATE_MISSING: 'VAT_RATE_MISSING',
  VAT_SALE_NOT_FOUND: 'VAT_SALE_NOT_FOUND',
  VAT_PERIOD_FILED: 'VAT_PERIOD_FILED',
  VAT_RETURN_NOT_FOUND: 'VAT_RETURN_NOT_FOUND',
  VAT_RETURN_FILED: 'VAT_RETURN_FILED',
  VAT_RETURN_PERIOD_INVALID: 'VAT_RETURN_PERIOD_INVALID',
  VAT_RETURN_NOT_TIED: 'VAT_RETURN_NOT_TIED',
  VAT_RETURN_NOTHING_TO_PAY: 'VAT_RETURN_NOTHING_TO_PAY',
  VAT_CHALLAN_EXISTS: 'VAT_CHALLAN_EXISTS',
  COMPLIANCE_ITEM_NOT_FOUND: 'COMPLIANCE_ITEM_NOT_FOUND',
  COMPANY_BANK_ACCOUNT_NOT_FOUND: 'COMPANY_BANK_ACCOUNT_NOT_FOUND',
  BANK_LEDGER_ACCOUNT_INVALID: 'BANK_LEDGER_ACCOUNT_INVALID',
  BANK_ACCOUNT_HAS_STATEMENTS: 'BANK_ACCOUNT_HAS_STATEMENTS',
  BANK_STATEMENT_INVALID: 'BANK_STATEMENT_INVALID',
  BANK_STATEMENT_DUPLICATE: 'BANK_STATEMENT_DUPLICATE',
  BANK_FILE_MISSING: 'BANK_FILE_MISSING',
  BANK_LINE_NOT_FOUND: 'BANK_LINE_NOT_FOUND',
  BANK_LINE_ALREADY_MATCHED: 'BANK_LINE_ALREADY_MATCHED',
  BANK_MATCH_UNBALANCED: 'BANK_MATCH_UNBALANCED',
  BANK_MATCH_NOT_FOUND: 'BANK_MATCH_NOT_FOUND',
  BANK_MATCH_UNDONE: 'BANK_MATCH_UNDONE',
  BANK_LINE_NOT_UNRECORDED: 'BANK_LINE_NOT_UNRECORDED',
  BUDGET_NOT_FOUND: 'BUDGET_NOT_FOUND',
  BUDGET_WRONG_STATE: 'BUDGET_WRONG_STATE',
  BUDGET_EXISTS: 'BUDGET_EXISTS',
  BUDGET_REVISION_OPEN: 'BUDGET_REVISION_OPEN',
  BUDGET_REVISION_NOT_FOUND: 'BUDGET_REVISION_NOT_FOUND',
  FISCAL_YEAR_INVALID: 'FISCAL_YEAR_INVALID',
  REQUISITION_NOT_FOUND: 'REQUISITION_NOT_FOUND',
  REQUISITION_WRONG_STATE: 'REQUISITION_WRONG_STATE',
  QUOTATION_NOT_FOUND: 'QUOTATION_NOT_FOUND',
  QUOTATION_INCOMPLETE: 'QUOTATION_INCOMPLETE',
  QUOTATIONS_TOO_FEW: 'QUOTATIONS_TOO_FEW',
  SELECTION_REASON_REQUIRED: 'SELECTION_REASON_REQUIRED',
  COMPARATIVE_STATEMENT_REQUIRED: 'COMPARATIVE_STATEMENT_REQUIRED',
  PURCHASE_ORDER_NOT_FOUND: 'PURCHASE_ORDER_NOT_FOUND',
  PURCHASE_ORDER_WRONG_STATE: 'PURCHASE_ORDER_WRONG_STATE',
  RECEIPT_EXCEEDS_ORDER: 'RECEIPT_EXCEEDS_ORDER',
  GOODS_RECEIPT_NOT_FOUND: 'GOODS_RECEIPT_NOT_FOUND',
  RECEIPT_ALREADY_BILLED: 'RECEIPT_ALREADY_BILLED',
  BILL_PO_INVALID: 'BILL_PO_INVALID',
  BILL_NOT_MATCHED: 'BILL_NOT_MATCHED',
  NOT_ON_PROBATION: 'NOT_ON_PROBATION',
  SEPARATION_EXISTS: 'SEPARATION_EXISTS',
  SEPARATION_NOT_FOUND: 'SEPARATION_NOT_FOUND',
  SEPARATION_NOT_CLEARED: 'SEPARATION_NOT_CLEARED',
  SEPARATION_HAS_SETTLEMENT: 'SEPARATION_HAS_SETTLEMENT',
  NOT_SEPARATED: 'NOT_SEPARATED',
  TAX_CERTIFICATE_EMPTY: 'TAX_CERTIFICATE_EMPTY',
  SALARY_TAX_CHALLAN_NOT_FOUND: 'SALARY_TAX_CHALLAN_NOT_FOUND',
  SALARY_TAX_CHALLAN_DUPLICATE: 'SALARY_TAX_CHALLAN_DUPLICATE',
  // disbursement
  DISBURSEMENT_FILE_NOT_FOUND: 'DISBURSEMENT_FILE_NOT_FOUND',
  DISBURSEMENT_FILE_ACTIVE: 'DISBURSEMENT_FILE_ACTIVE',
  DISBURSEMENT_NOTHING_TO_PAY: 'DISBURSEMENT_NOTHING_TO_PAY',
  DISBURSEMENT_FILE_NOT_ACTIVE: 'DISBURSEMENT_FILE_NOT_ACTIVE',
  DISBURSEMENT_CANCEL_PENDING: 'DISBURSEMENT_CANCEL_PENDING',
  DISBURSEMENT_ADAPTER_UNKNOWN: 'DISBURSEMENT_ADAPTER_UNKNOWN',
  DISBURSEMENT_RETURN_FILE_INVALID: 'DISBURSEMENT_RETURN_FILE_INVALID',
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  PAYMENT_NOT_RETURNED: 'PAYMENT_NOT_RETURNED',
  PAYROLL_NOT_APPROVED: 'PAYROLL_NOT_APPROVED',
  // data import
  IMPORT_BATCH_NOT_FOUND: 'IMPORT_BATCH_NOT_FOUND',
  IMPORT_FILE_INVALID: 'IMPORT_FILE_INVALID',
  IMPORT_HAS_ERRORS: 'IMPORT_HAS_ERRORS',
  IMPORT_WRONG_STATE: 'IMPORT_WRONG_STATE',
  IMPORT_NOTHING_TO_SIGN: 'IMPORT_NOTHING_TO_SIGN',
  IMPORT_ROLLBACK_BLOCKED: 'IMPORT_ROLLBACK_BLOCKED',
  // idempotency
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  // AI (WP11)
  AI_OFF: 'AI_OFF',
  AI_NOT_IN_PLAN: 'AI_NOT_IN_PLAN',
  AI_NOT_RELEASED: 'AI_NOT_RELEASED',
  AI_QUOTA_EXCEEDED: 'AI_QUOTA_EXCEEDED',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_INTERACTION_NOT_FOUND: 'AI_INTERACTION_NOT_FOUND',
  AI_POLICY_DOCUMENT_NOT_FOUND: 'AI_POLICY_DOCUMENT_NOT_FOUND',
  PAYROLL_FLAG_NOT_FOUND: 'PAYROLL_FLAG_NOT_FOUND',
  // consent (WP12)
  CONSENT_REQUIRED_LOCATION: 'CONSENT_REQUIRED_LOCATION',
  CONSENT_REQUIRED_BIOMETRIC: 'CONSENT_REQUIRED_BIOMETRIC',
  CONSENT_REQUIRED_SELFIE: 'CONSENT_REQUIRED_SELFIE',
  // Gate 1 parallel payroll (WP12)
  PARALLEL_FILE_INVALID: 'PARALLEL_FILE_INVALID',
  PARALLEL_COMPARISON_NOT_FOUND: 'PARALLEL_COMPARISON_NOT_FOUND',
  PARALLEL_UNEXPLAINED: 'PARALLEL_UNEXPLAINED',
  PARALLEL_OUTDATED: 'PARALLEL_OUTDATED',
  PARALLEL_SAME_PERSON: 'PARALLEL_SAME_PERSON',
  PARALLEL_ALREADY_ACCEPTED: 'PARALLEL_ALREADY_ACCEPTED',
  // general ledger (WP14)
  LEDGER_NOT_SET_UP: 'LEDGER_NOT_SET_UP',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ACCOUNT_NOT_POSTABLE: 'ACCOUNT_NOT_POSTABLE',
  VOUCHER_NOT_FOUND: 'VOUCHER_NOT_FOUND',
  VOUCHER_UNBALANCED: 'VOUCHER_UNBALANCED',
  VOUCHER_WRONG_STATE: 'VOUCHER_WRONG_STATE',
  VOUCHER_NEEDS_CASH_OR_BANK: 'VOUCHER_NEEDS_CASH_OR_BANK',
  PERIOD_CLOSED: 'PERIOD_CLOSED',
  PERIOD_NOT_FOUND: 'PERIOD_NOT_FOUND',
  VOUCHER_ALREADY_REVERSED: 'VOUCHER_ALREADY_REVERSED',
  POSTING_ACCOUNT_MISSING: 'POSTING_ACCOUNT_MISSING',
  ALREADY_POSTED: 'ALREADY_POSTED',
  OPENING_VOUCHER_RULES: 'OPENING_VOUCHER_RULES',
  OPENING_BALANCES_EXIST: 'OPENING_BALANCES_EXIST',
  CONTROL_ACCOUNT_MANUAL: 'CONTROL_ACCOUNT_MANUAL',
  VENDOR_NOT_FOUND: 'VENDOR_NOT_FOUND',
  VENDOR_INACTIVE: 'VENDOR_INACTIVE',
  VENDOR_DUPLICATE: 'VENDOR_DUPLICATE',
  VENDOR_BANK_PENDING_EXISTS: 'VENDOR_BANK_PENDING_EXISTS',
  VENDOR_BANK_NOT_APPROVED: 'VENDOR_BANK_NOT_APPROVED',
  BILL_NOT_FOUND: 'BILL_NOT_FOUND',
  BILL_DUPLICATE: 'BILL_DUPLICATE',
  BILL_WRONG_STATE: 'BILL_WRONG_STATE',
  BILL_HAS_PAYMENTS: 'BILL_HAS_PAYMENTS',
  WITHHOLDING_CATEGORY_UNKNOWN: 'WITHHOLDING_CATEGORY_UNKNOWN',
  PAYMENT_EXCEEDS_OUTSTANDING: 'PAYMENT_EXCEEDS_OUTSTANDING',
  PAYMENT_ACCOUNT_NOT_MONEY: 'PAYMENT_ACCOUNT_NOT_MONEY',
  VENDOR_PAYMENT_NOT_FOUND: 'VENDOR_PAYMENT_NOT_FOUND',
  NOTHING_TO_DEPOSIT: 'NOTHING_TO_DEPOSIT',
  CHALLAN_NOT_FOUND: 'CHALLAN_NOT_FOUND',
  CHALLAN_CERTIFIED: 'CHALLAN_CERTIFIED',
  NOTHING_TO_CERTIFY: 'NOTHING_TO_CERTIFY',
  CERTIFICATE_NOT_FOUND: 'CERTIFICATE_NOT_FOUND',
  EXPENSE_CLAIM_NOT_FOUND: 'EXPENSE_CLAIM_NOT_FOUND',
  EXPENSE_CLAIM_WRONG_STATE: 'EXPENSE_CLAIM_WRONG_STATE',
  EXPENSE_CATEGORY_NOT_FOUND: 'EXPENSE_CATEGORY_NOT_FOUND',
  EXPENSE_CLAIM_EMPTY: 'EXPENSE_CLAIM_EMPTY',
  EXPENSE_DATE_FUTURE: 'EXPENSE_DATE_FUTURE',
  RECEIPT_REQUIRED: 'RECEIPT_REQUIRED',
  RECEIPT_DUPLICATE: 'RECEIPT_DUPLICATE',
  RECEIPT_NOT_FOUND: 'RECEIPT_NOT_FOUND',
  ADVANCE_NOT_FOUND: 'ADVANCE_NOT_FOUND',
  ADVANCE_WRONG_STATE: 'ADVANCE_WRONG_STATE',
  ADVANCE_EXCEEDED: 'ADVANCE_EXCEEDED',
  EMPLOYEE_ACCOUNT_REQUIRED: 'EMPLOYEE_ACCOUNT_REQUIRED',
  LOAN_WRONG_STATE: 'LOAN_WRONG_STATE',
  ATTENDANCE_OVERTIME_TOO_MUCH: 'ATTENDANCE_OVERTIME_TOO_MUCH',
  ATTENDANCE_WEAK_GPS: 'ATTENDANCE_WEAK_GPS',
} as const;

export type MessageKey = keyof typeof MSG;
export type Language = 'bn' | 'en';

const en: Record<MessageKey, string> = {
  IMPORT_BATCH_NOT_FOUND: 'Import batch not found.',
  IMPORT_FILE_INVALID:
    'The file cannot be read as this template. Nothing was loaded.',
  IMPORT_HAS_ERRORS:
    'Some rows have errors. Fix the file and upload it again, or skip those rows with a reason.',
  IMPORT_WRONG_STATE: 'The import batch is not in a state that allows this.',
  IMPORT_NOTHING_TO_SIGN:
    'There are no committed imports for this cut-over date.',
  IMPORT_ROLLBACK_BLOCKED:
    'This batch cannot be rolled back: its records are already used. Roll back the later batches first.',
  DISBURSEMENT_FILE_NOT_FOUND: 'Disbursement file not found.',
  DISBURSEMENT_FILE_ACTIVE:
    'An active file already exists for this run and channel. Settle it, or cancel it with approval, first.',
  DISBURSEMENT_NOTHING_TO_PAY:
    'There are no payments waiting for a file on this channel.',
  DISBURSEMENT_FILE_NOT_ACTIVE: 'This file is not active.',
  DISBURSEMENT_CANCEL_PENDING:
    'A cancellation of this file is waiting for approval.',
  DISBURSEMENT_ADAPTER_UNKNOWN: 'Unknown file format for this channel.',
  DISBURSEMENT_RETURN_FILE_INVALID:
    'The return file has problems; nothing was changed.',
  PAYMENT_NOT_FOUND: 'Payment not found.',
  PAYMENT_NOT_RETURNED: 'Only a returned payment can be re-issued.',
  PAYROLL_NOT_APPROVED: 'The payroll run must be approved first.',
  APPROVAL_ALREADY_APPROVED_EARLIER_STEP:
    'You approved an earlier step of this request; another person must approve this step.',
  PAYROLL_RUN_NOT_FOUND: 'Payroll run not found.',
  PAYROLL_RUN_WRONG_STATE:
    'The payroll run is not in a state that allows this.',
  PAYROLL_ATTENDANCE_NOT_LOCKED:
    'Lock attendance for this month before running payroll.',
  PAYROLL_FLAGS_OPEN:
    'Every flag must be cleared with a reason before submission.',
  PAYROLL_NO_SALARY: 'Some employees have no salary recorded for this period.',
  PAYROLL_STRUCTURE_INVALID: 'The salary structure is not valid.',
  PAYROLL_STRUCTURE_NOT_FOUND: 'Salary structure not found.',
  PAYROLL_HEAD_NOT_FOUND: 'Salary head not found.',
  SALARY_NOT_FOUND: 'Salary record not found.',
  LOAN_NOT_FOUND: 'Loan or salary advance not found.',
  PAYROLL_PERIOD_PAID: 'Payroll for this month is already approved.',
  PAYROLL_NOT_SEPARATING:
    'Record the last working day before the final settlement.',
  PAYSLIP_NOT_FOUND: 'Payslip not found.',
  ASSET_NOT_FOUND: 'Asset not found.',
  ASSET_CLASS_NOT_FOUND: 'Asset class not found.',
  ASSET_WRONG_STATE: 'This asset cannot do that in its current state.',
  ASSET_ASSIGNED: 'The asset is with an employee; take it back first.',
  ASSETS_NOT_RETURNED:
    'The employee still holds company assets; take them back first.',
  DEPRECIATION_PERIOD_INVALID:
    'Depreciation runs month by month, after the last run and not for a future month.',
  DEPRECIATION_RUN_NOT_FOUND: 'Depreciation run not found.',
  DEPRECIATION_NOT_LATEST: 'Only the latest depreciation run can be reversed.',
  STORE_NOT_FOUND: 'Store not found.',
  STOCK_ITEM_NOT_FOUND: 'Item not found.',
  STOCK_NOT_ENOUGH: 'Not enough stock: it can never go below zero.',
  STOCK_REQUEST_NOT_FOUND: 'Store request not found.',
  STOCK_REQUEST_WRONG_STATE:
    'This store request cannot be changed in its current state.',
  CRM_DUPLICATE:
    'This phone number or e-mail already belongs to a lead or customer.',
  CRM_CONTACT_INVALID:
    'Give a Bangladesh phone number or an e-mail (and a district of Bangladesh).',
  CRM_OWNER_INVALID: 'Not a salesperson of this company.',
  CRM_NO_SALESPERSON: 'No salesperson or Admin to take the lead.',
  LEAD_NOT_FOUND: 'Lead not found.',
  LEAD_WRONG_STATE: 'This lead cannot be changed in its current state.',
  CUSTOMER_NOT_FOUND: 'Customer not found.',
  ACTIVITY_NOT_FOUND: 'Task not found.',
  TERRITORY_NOT_FOUND: 'Sales territory not found.',
  TERRITORY_DISTRICT_TAKEN: 'A district can be in one sales territory only.',
  OPPORTUNITY_NOT_FOUND: 'Opportunity not found.',
  OPPORTUNITY_WRONG_STATE:
    'This opportunity cannot be changed in its current state.',
  STAGE_NOT_FOUND: 'Pipeline stage not found, or not in use.',
  STAGE_IN_USE: 'Open opportunities are in this stage: move them first.',
  TARGET_INVALID: 'Give a month and either a salesperson or a department.',
  PRODUCT_NOT_FOUND: 'Product not found, or not in use.',
  PRODUCT_CODE_TAKEN: 'Another product has this code.',
  PRICE_MISSING:
    'No price for this product in the price list: type a unit price.',
  SALES_QUOTATION_NOT_FOUND: 'Quotation not found.',
  QUOTATION_WRONG_STATE: 'This quotation cannot do that in its current state.',
  QUOTATION_EXPIRED: 'The quotation is past its validity: make a new revision.',
  ORDER_NOT_FOUND: 'Sales order not found.',
  ORDER_WRONG_STATE: 'This order cannot do that in its current state.',
  INVOICE_NOT_FOUND: 'Invoice not found.',
  INVOICE_LINE_NOT_FOUND: 'That line is not on this invoice.',
  CREDIT_TOO_MUCH:
    'A credit note cannot exceed what was invoiced and is still owed.',
  SALES_DOCUMENT_NOT_REVERSIBLE:
    'Customer invoices are corrected with a credit note, not reversed.',
  CUSTOMER_RECEIPT_NOT_FOUND: 'Receipt not found.',
  PF_PAYMENT_NOT_REVERSIBLE:
    'A PF payment or interest is not reversed: record what corrects it.',
  PF_TOO_MUCH: 'More than the member’s own PF part.',
  PF_NOT_LEAVING:
    'The final PF settlement is for an employee in notice or separated.',
  PF_SETTLED: 'This member’s PF is settled already.',
  PF_PENDING: 'A PF payment for this member waits for the checker.',
  SALES_STORE_NEEDED:
    'Name the store the goods leave from (some products are kept in a store).',
  RESIGNATION_PENDING: 'You have a resignation waiting for approval already.',
  RESIGNATION_NOT_POSSIBLE:
    'A resignation is for an active employee (or on probation) not already leaving.',
  RECEIPT_ALLOCATION_INVALID:
    'The allocation does not fit the customer’s open invoices.',
  RECEIPT_ADVANCE_USED:
    'Money from this receipt has been applied to an invoice since: undo that first.',
  ADVANCE_TOO_MUCH:
    'More than the customer has on account, or than the invoice still owes.',
  OPENING_FILE_INVALID: 'The opening trial balance cannot be used as it is.',
  OPENING_IMPORT_FINAL:
    'Opening balances are final once posted: correct them with a journal.',
  OLD_TB_INVALID: 'The old system’s trial balance cannot be read.',
  RECEIVABLE_NOT_FOUND: 'Customer invoice not found.',
  RECEIPT_TOO_MUCH: 'More than the customer still owes on this invoice.',
  MONTH_CLOSE_NOT_READY:
    'The month cannot close yet: finish the checklist first.',
  MONTH_CLOSE_ITEM_UNKNOWN: 'Not an item of the month-end checklist.',
  DOCUMENT_UNREADABLE:
    'Upload a photo (JPEG, PNG, WebP) or a PDF of the bill or receipt.',
  VAT_ITEM_NOT_FOUND: 'VAT item not found.',
  VAT_RATE_MISSING:
    'This item has no VAT rate for that fiscal year: add the rate first.',
  VAT_SALE_NOT_FOUND: 'VAT invoice not found.',
  VAT_PERIOD_FILED:
    'The VAT return of that month is filed: it can no longer change.',
  VAT_RETURN_NOT_FOUND: 'VAT return not found.',
  VAT_RETURN_FILED: 'The VAT return of this month is filed already.',
  VAT_RETURN_PERIOD_INVALID:
    'A return is filed for a month that has ended, one month after the other.',
  VAT_RETURN_NOT_TIED:
    'The return does not agree with the ledger: clear the differences first.',
  VAT_RETURN_NOTHING_TO_PAY: 'Nothing to deposit for this return.',
  VAT_CHALLAN_EXISTS: 'A challan for this return is already made.',
  COMPLIANCE_ITEM_NOT_FOUND: 'Calendar item not found.',
  COMPANY_BANK_ACCOUNT_NOT_FOUND: 'Company bank account not found.',
  BANK_LEDGER_ACCOUNT_INVALID:
    "Choose an active bank account of this company's chart of accounts.",
  BANK_ACCOUNT_HAS_STATEMENTS:
    'Statements are already imported: the start date and opening balance can no longer change.',
  BANK_STATEMENT_INVALID: 'The statement file cannot be read.',
  BANK_STATEMENT_DUPLICATE: 'This statement file was imported already.',
  BANK_FILE_MISSING: 'Attach the statement file (CSV).',
  BANK_LINE_NOT_FOUND:
    'Statement or ledger line not found for this bank account.',
  BANK_LINE_ALREADY_MATCHED:
    'A line is already matched: a line can be matched only once.',
  BANK_MATCH_UNBALANCED:
    'The statement lines and the ledger lines must add up to the same amount.',
  BANK_MATCH_NOT_FOUND: 'Match not found.',
  BANK_MATCH_UNDONE: 'This match is already undone.',
  BANK_LINE_NOT_UNRECORDED:
    'This statement line is matched already: nothing to record.',
  BUDGET_NOT_FOUND: 'Budget not found.',
  BUDGET_WRONG_STATE: 'This budget cannot be changed in its current state.',
  BUDGET_EXISTS: 'This department already has a budget for the year.',
  BUDGET_REVISION_OPEN:
    'A change to this budget is already waiting for approval.',
  BUDGET_REVISION_NOT_FOUND: 'Budget change not found.',
  FISCAL_YEAR_INVALID: 'The fiscal year must look like 2026-27.',
  REQUISITION_NOT_FOUND: 'Purchase requisition not found.',
  REQUISITION_WRONG_STATE:
    'This purchase requisition cannot be changed in its current state.',
  QUOTATION_NOT_FOUND: 'Quotation not found.',
  QUOTATION_INCOMPLETE:
    'The quotation needs a price for every line of the requisition.',
  QUOTATIONS_TOO_FEW: 'More quotations are needed for this amount.',
  SELECTION_REASON_REQUIRED:
    'Give a reason for choosing a quotation that is not the lowest.',
  COMPARATIVE_STATEMENT_REQUIRED:
    'The comparative statement must be approved first, and the order must use the chosen quotation.',
  PURCHASE_ORDER_NOT_FOUND: 'Purchase order not found.',
  PURCHASE_ORDER_WRONG_STATE:
    'This purchase order cannot be changed in its current state.',
  RECEIPT_EXCEEDS_ORDER: 'More would be received than was ordered.',
  GOODS_RECEIPT_NOT_FOUND: 'Goods received note not found.',
  RECEIPT_ALREADY_BILLED:
    'Bills already charge for these goods; cancel or correct the bill first.',
  BILL_PO_INVALID:
    'The bill does not fit its purchase order: same vendor, and every line must name an order line with a quantity.',
  BILL_NOT_MATCHED:
    'This bill does not match its purchase order and goods received, so it cannot be paid.',
  NOT_ON_PROBATION: 'The employee is not on probation.',
  SEPARATION_EXISTS:
    'This employee is already leaving. Withdraw that notice first to change it.',
  SEPARATION_NOT_FOUND: 'No notice of leaving was found for this employee.',
  SEPARATION_NOT_CLEARED:
    'Clearance is not complete yet: every department must clear the leaver before the final settlement.',
  SEPARATION_HAS_SETTLEMENT:
    'A final settlement run exists for this employee; cancel it first.',
  NOT_SEPARATED:
    'The experience certificate is issued after the final settlement.',
  TAX_CERTIFICATE_EMPTY:
    'No salary was paid in this fiscal year, so there is no tax certificate.',
  SALARY_TAX_CHALLAN_NOT_FOUND: 'Salary tax challan not found.',
  SALARY_TAX_CHALLAN_DUPLICATE: 'This challan number is already recorded.',
  LEAVE_TYPE_NOT_FOUND: 'Leave type not found.',
  LEAVE_REQUEST_NOT_FOUND: 'Leave request not found.',
  LEAVE_NOT_ELIGIBLE: 'You are not eligible for this leave type.',
  LEAVE_INSUFFICIENT_BALANCE: 'Not enough leave balance.',
  LEAVE_OVERLAP: 'These dates overlap another leave request.',
  LEAVE_TOO_FAR_BACK: 'This date is too far in the past. Ask HR to enter it.',
  LEAVE_HALF_DAY_NOT_ALLOWED:
    'Half-day leave is not allowed for this leave type or range.',
  LEAVE_NO_DAYS:
    'The selected dates contain no leave days (weekends and holidays are not counted).',
  LEAVE_DOCUMENT_REQUIRED: 'A supporting document is required for this leave.',
  LEAVE_TOO_LONG: 'This request is longer than allowed for this leave type.',
  LEAVE_CANNOT_CANCEL: 'This leave can no longer be cancelled by you. Ask HR.',
  LEAVE_NOT_RETURNED:
    'Only a request returned for correction can be edited and sent again.',
  SERVICE_KEY_INVALID: 'Service key is missing, wrong or revoked.',
  SHIFT_NOT_FOUND: 'Shift not found.',
  DEVICE_NOT_FOUND: 'Device not found.',
  ATTENDANCE_DEVICE_NOT_REGISTERED:
    'This phone is not registered and approved for your attendance.',
  ATTENDANCE_OUTSIDE_GEOFENCE:
    'You are outside the office area. Punch from the office.',
  ATTENDANCE_GEOFENCE_NOT_SET:
    'Mobile punch is not set up for your branch (no office location).',
  ATTENDANCE_WEB_PUNCH_NOT_ALLOWED:
    'Web punch is allowed only for approved remote staff.',
  ATTENDANCE_NOT_EMPLOYED: 'No employment record for this date.',
  ATTENDANCE_CORRECTION_LIMIT:
    "You have reached this month's limit of attendance corrections.",
  ATTENDANCE_DATE_IN_FUTURE: 'The date cannot be in the future.',
  ATTENDANCE_NO_OVERTIME: 'There is no overtime to approve on this day.',
  ATTENDANCE_MONTH_LOCKED: 'Attendance for this month is already locked.',
  RULE_PACK_NOT_FOUND: 'Rule pack not found.',
  RULE_PACK_NOT_ACCEPTED:
    'No rule pack is accepted for this date. An admin must accept a rule pack version first.',
  RULE_NOT_FOUND: 'The rule pack has no value for this rule on this date.',
  RULE_NOT_VERIFIED:
    'This statutory value has not been verified by the compliance owner yet, so it cannot be used.',
  AUTH_MFA_REQUIRED:
    'Your role requires two-factor authentication. Set it up and sign in again.',
  AUTH_STEP_UP_INVALID:
    'The verification code for this action is incorrect or already used.',
  ROLE_NOT_FOUND: 'Role not found.',
  ROLE_SCOPE_INVALID: 'This role cannot be given with that scope.',
  ROLE_EXPIRY_REQUIRED: 'This role must have an end date.',
  ROLE_SELF_GRANT: 'You cannot change your own roles or access.',
  ROLE_GRANT_NOT_FOUND: 'Role assignment not found.',
  PERMISSION_UNKNOWN: 'Unknown permission.',
  FIELD_GRANT_NOT_FOUND: 'Field access grant not found.',
  DELEGATION_NOT_FOUND: 'Delegation not found.',
  APPROVAL_NOT_FOUND: 'Approval request not found.',
  APPROVAL_NOT_OPEN: 'This request is no longer waiting for approval.',
  APPROVAL_NOT_YOUR_TURN:
    'You are not an approver for the current step of this request.',
  APPROVAL_SELF_APPROVAL: 'Nobody can approve their own request.',
  APPROVAL_NO_APPROVER:
    'No approver could be found for this request. Ask the admin to check the approval chain.',
  APPROVAL_NO_CHAIN: 'No approval chain is set up for this kind of request.',
  APPROVAL_COMMENT_REQUIRED: 'A comment is required.',
  APPROVAL_CANCEL_NOT_ALLOWED:
    'Only the requester can cancel, and only before final approval.',
  BANK_ACCOUNT_NOT_FOUND: 'Bank or wallet account not found.',
  BANK_ACCOUNT_PENDING_EXISTS:
    'A bank or wallet change is already waiting for approval.',
  OUTBOX_EVENT_NOT_DEAD: 'Only failed (dead) events can be replayed.',
  DUPLICATE_VALUE: 'A record with this value already exists.',
  REFERENCE_NOT_FOUND:
    'A linked record does not exist or belongs to another company.',
  STALE_VERSION:
    'This record was changed by someone else. Reload and try again.',
  INVALID_DATE: 'The date is not valid.',
  COMPANY_NOT_FOUND: 'Company not found.',
  BRANCH_NOT_FOUND: 'Branch not found.',
  DEPARTMENT_NOT_FOUND: 'Department not found.',
  DEPARTMENT_CYCLE:
    'A department cannot be moved under itself or its own sub-department.',
  DESIGNATION_NOT_FOUND: 'Designation not found.',
  GRADE_NOT_FOUND: 'Grade not found.',
  EMPLOYEE_NOT_FOUND: 'Employee not found.',
  EMPLOYEE_NOT_DRAFT: 'Only an employee in draft status can be activated.',
  EMPLOYEE_JOIN_DATE_LOCKED:
    'The joining date can only be changed while the employee is in draft.',
  INVALID_NID: 'National ID must have 10, 13 or 17 digits.',
  INVALID_TIN: 'TIN must have 12 digits.',
  MANAGER_INVALID:
    'The manager must be another current employee of the company.',
  JOB_EVENT_BEFORE_JOINING:
    'The change cannot take effect before the joining date.',
  JOB_EVENT_NO_CHANGES: 'This change does not alter anything on that date.',
  JOB_EVENT_NOT_FOUND: 'Job change not found.',
  JOB_EVENT_ALREADY_CANCELLED: 'This job change is already cancelled.',
  JOINING_EVENT_CANNOT_CANCEL: 'The joining record cannot be cancelled.',
  ONBOARDING_INCOMPLETE: 'Complete all required onboarding items first.',
  ONBOARDING_ITEM_NOT_FOUND: 'Onboarding item not found.',
  DOCUMENT_NOT_FOUND: 'Document not found.',
  FILE_REQUIRED: 'Attach a file.',
  FILE_TYPE_NOT_ALLOWED: 'Only PDF, JPG and PNG files up to 10 MB are allowed.',
  VALIDATION_FAILED: 'Some fields are missing or invalid.',
  NOT_FOUND: 'Not found.',
  FORBIDDEN: 'You do not have permission to do this.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
  AUTH_REQUIRED: 'Please sign in.',
  AUTH_INVALID_CREDENTIALS: 'Workspace, email or password is incorrect.',
  AUTH_ACCOUNT_LOCKED: 'Too many failed attempts. Try again after 15 minutes.',
  AUTH_MFA_INVALID_CODE: 'The verification code is incorrect or expired.',
  AUTH_MFA_NOT_SET_UP: 'Two-factor authentication is not set up.',
  AUTH_MFA_ALREADY_ENABLED: 'Two-factor authentication is already enabled.',
  AUTH_STEP_UP_REQUIRED: 'Enter your verification code to confirm this action.',
  USER_NOT_FOUND: 'User not found.',
  IDEMPOTENCY_KEY_REQUIRED:
    'Idempotency-Key header is required for this request.',
  IDEMPOTENCY_KEY_REUSED:
    'This Idempotency-Key was already used for a different request.',
  AI_OFF: 'The AI assistant is switched off. All screens work as usual.',
  AI_NOT_IN_PLAN: 'AI features are part of the Intelligent plan.',
  AI_NOT_RELEASED:
    'This AI feature has not passed its quality test yet, so it is not offered.',
  AI_QUOTA_EXCEEDED:
    "This month's AI quota is used up. Ask your admin for more credits; all screens still work.",
  AI_UNAVAILABLE:
    'The AI assistant is not answering right now. Please use the normal screens or try again later.',
  AI_INTERACTION_NOT_FOUND: 'AI answer not found.',
  AI_POLICY_DOCUMENT_NOT_FOUND: 'Policy document not found.',
  PAYROLL_FLAG_NOT_FOUND: 'Payroll flag not found.',
  CONSENT_REQUIRED_LOCATION:
    'Phone punches use your location. Please read and accept the location notice in the app (Me > Consents) first.',
  CONSENT_REQUIRED_BIOMETRIC:
    'The employee has not consented to biometric attendance. Record the signed consent form first (Consents).',
  CONSENT_REQUIRED_SELFIE:
    'Photo punches need your consent first (Me > Consents).',
  PARALLEL_FILE_INVALID:
    'The payroll register cannot be compared. Nothing was saved.',
  PARALLEL_COMPARISON_NOT_FOUND: 'Parallel payroll comparison not found.',
  PARALLEL_UNEXPLAINED:
    'Every difference must be explained before the comparison can be accepted.',
  PARALLEL_OUTDATED:
    'The payroll run was recalculated after this comparison. Upload the register again.',
  PARALLEL_SAME_PERSON:
    'The person who uploaded the comparison cannot also accept it.',
  PARALLEL_ALREADY_ACCEPTED: 'This comparison is already accepted.',
  LEDGER_NOT_SET_UP:
    'Accounting is not set up for this company yet (chart of accounts and fiscal year).',
  ACCOUNT_NOT_FOUND: 'Account not found.',
  ACCOUNT_NOT_POSTABLE:
    'Vouchers can only use active postable accounts (not group accounts).',
  VOUCHER_NOT_FOUND: 'Voucher not found.',
  VOUCHER_UNBALANCED:
    'Debits and credits must be equal, with at least two lines, and each line on one side only.',
  VOUCHER_WRONG_STATE: 'The voucher is not in a state that allows this.',
  VOUCHER_NEEDS_CASH_OR_BANK:
    'A payment voucher credits a cash or bank account, a receipt voucher debits one, and a contra voucher uses only cash and bank accounts.',
  PERIOD_CLOSED:
    'The accounting period is closed. Only reversal vouchers can be dated in it.',
  PERIOD_NOT_FOUND:
    'No accounting period for this date. Open the fiscal year first.',
  VOUCHER_ALREADY_REVERSED: 'This voucher has already been reversed.',
  POSTING_ACCOUNT_MISSING:
    'Some posting accounts are not set (see details). Set them in the ledger setup.',
  ALREADY_POSTED: 'This document is already posted to the ledger.',
  OPENING_VOUCHER_RULES:
    'Opening balances are entered as a journal dated on the first day of a month.',
  OPENING_BALANCES_EXIST:
    'This company already has opening balances. Reverse them to enter new ones.',
  CONTROL_ACCOUNT_MANUAL:
    'This account is kept by vendor bills and payments and takes no manual entries.',
  VENDOR_NOT_FOUND: 'Vendor not found.',
  VENDOR_INACTIVE: 'This vendor is inactive.',
  VENDOR_DUPLICATE: 'A vendor with this code or TIN already exists.',
  VENDOR_BANK_PENDING_EXISTS:
    'A bank account change for this vendor is already waiting for approval.',
  VENDOR_BANK_NOT_APPROVED:
    'A bank transfer needs an approved bank account for the vendor.',
  BILL_NOT_FOUND: 'Vendor bill not found.',
  BILL_DUPLICATE: "This vendor's invoice number is already entered.",
  BILL_WRONG_STATE: 'This cannot be done with the bill in its current state.',
  BILL_HAS_PAYMENTS:
    'This bill has payments, or its tax is deposited. Reverse those first.',
  WITHHOLDING_CATEGORY_UNKNOWN: 'Unknown payment category for tax at source.',
  PAYMENT_EXCEEDS_OUTSTANDING:
    'The amount is more than is still owed on the bill.',
  PAYMENT_ACCOUNT_NOT_MONEY: 'Pay from a cash or bank account.',
  VENDOR_PAYMENT_NOT_FOUND: 'Vendor payment not found.',
  NOTHING_TO_DEPOSIT:
    'There is no tax withheld in this month that is waiting to be deposited.',
  CHALLAN_NOT_FOUND: 'Tax challan not found.',
  CHALLAN_CERTIFIED:
    'Tax in this challan is already certified to vendors, so the challan cannot be reversed.',
  NOTHING_TO_CERTIFY:
    'No deposited tax for this vendor in this period is waiting for a certificate.',
  CERTIFICATE_NOT_FOUND: 'Certificate not found.',
  EXPENSE_CLAIM_NOT_FOUND: 'Expense claim not found.',
  EXPENSE_CLAIM_WRONG_STATE:
    'This cannot be done with the claim in its current state.',
  EXPENSE_CATEGORY_NOT_FOUND: 'Expense category not found or not active.',
  EXPENSE_CLAIM_EMPTY: 'Add at least one expense line.',
  EXPENSE_DATE_FUTURE: 'An expense cannot be dated in the future.',
  RECEIPT_REQUIRED: 'A receipt is needed for these lines.',
  RECEIPT_DUPLICATE: 'This receipt is already in another claim.',
  RECEIPT_NOT_FOUND: 'Receipt not found.',
  ADVANCE_NOT_FOUND: 'Advance not found.',
  ADVANCE_WRONG_STATE:
    'This cannot be done with the advance in its current state.',
  ADVANCE_EXCEEDED: 'The amount is more than is still open on the advance.',
  EMPLOYEE_ACCOUNT_REQUIRED:
    "Paying by bank or wallet needs the employee's approved salary account.",
  LOAN_WRONG_STATE:
    'This cannot be done with the salary advance in its current state.',
  ATTENDANCE_OVERTIME_TOO_MUCH:
    'That is more overtime than was worked on this day.',
  ATTENDANCE_WEAK_GPS:
    'The location is not accurate enough. Step near a window or outside and try again.',
};

const bn: Record<MessageKey, string> = {
  IMPORT_BATCH_NOT_FOUND: 'ইমপোর্ট ব্যাচ পাওয়া যায়নি।',
  IMPORT_FILE_INVALID:
    'ফাইলটি এই টেমপ্লেট হিসেবে পড়া যাচ্ছে না। কিছুই লোড হয়নি।',
  IMPORT_HAS_ERRORS:
    'কিছু সারিতে ভুল আছে। ফাইল ঠিক করে আবার আপলোড করুন, অথবা কারণসহ সেই সারিগুলো বাদ দিন।',
  IMPORT_WRONG_STATE: 'ইমপোর্ট ব্যাচের বর্তমান অবস্থায় এটি করা যায় না।',
  IMPORT_NOTHING_TO_SIGN: 'এই কাট-ওভার তারিখের জন্য কোনো সম্পন্ন ইমপোর্ট নেই।',
  IMPORT_ROLLBACK_BLOCKED:
    'এই ব্যাচ ফেরত নেওয়া যাবে না: এর তথ্য ইতিমধ্যে ব্যবহৃত হয়েছে। আগে পরের ব্যাচগুলো ফেরত নিন।',
  DISBURSEMENT_FILE_NOT_FOUND: 'বিতরণ ফাইল পাওয়া যায়নি।',
  DISBURSEMENT_FILE_ACTIVE:
    'এই প্রক্রিয়া ও মাধ্যমের জন্য একটি সক্রিয় ফাইল আছে। আগে সেটি নিষ্পত্তি করুন অথবা অনুমোদন নিয়ে বাতিল করুন।',
  DISBURSEMENT_NOTHING_TO_PAY:
    'এই মাধ্যমে ফাইলের জন্য অপেক্ষমাণ কোনো পেমেন্ট নেই।',
  DISBURSEMENT_FILE_NOT_ACTIVE: 'এই ফাইলটি সক্রিয় নয়।',
  DISBURSEMENT_CANCEL_PENDING:
    'এই ফাইল বাতিলের অনুরোধ অনুমোদনের অপেক্ষায় আছে।',
  DISBURSEMENT_ADAPTER_UNKNOWN: 'এই মাধ্যমের জন্য ফাইল ফরম্যাটটি অজানা।',
  DISBURSEMENT_RETURN_FILE_INVALID:
    'রিটার্ন ফাইলে সমস্যা আছে; কিছুই পরিবর্তন করা হয়নি।',
  PAYMENT_NOT_FOUND: 'পেমেন্ট পাওয়া যায়নি।',
  PAYMENT_NOT_RETURNED: 'শুধু ফেরত আসা পেমেন্ট পুনরায় প্রদান করা যায়।',
  PAYROLL_NOT_APPROVED: 'আগে বেতন প্রক্রিয়া অনুমোদিত হতে হবে।',
  APPROVAL_ALREADY_APPROVED_EARLIER_STEP:
    'আপনি এই অনুরোধের আগের ধাপ অনুমোদন করেছেন; এই ধাপ অন্য কাউকে অনুমোদন করতে হবে।',
  PAYROLL_RUN_NOT_FOUND: 'বেতন প্রক্রিয়া পাওয়া যায়নি।',
  PAYROLL_RUN_WRONG_STATE: 'বেতন প্রক্রিয়ার বর্তমান অবস্থায় এটি করা যায় না।',
  PAYROLL_ATTENDANCE_NOT_LOCKED:
    'বেতন প্রক্রিয়ার আগে এই মাসের হাজিরা লক করুন।',
  PAYROLL_FLAGS_OPEN:
    'জমা দেওয়ার আগে প্রতিটি সতর্কতা কারণসহ নিষ্পত্তি করতে হবে।',
  PAYROLL_NO_SALARY: 'কিছু কর্মীর এই সময়ের বেতন নির্ধারিত নেই।',
  PAYROLL_STRUCTURE_INVALID: 'বেতন কাঠামো সঠিক নয়।',
  PAYROLL_STRUCTURE_NOT_FOUND: 'বেতন কাঠামো পাওয়া যায়নি।',
  PAYROLL_HEAD_NOT_FOUND: 'বেতনের খাত পাওয়া যায়নি।',
  SALARY_NOT_FOUND: 'বেতনের তথ্য পাওয়া যায়নি।',
  LOAN_NOT_FOUND: 'ঋণ বা অগ্রিম বেতন পাওয়া যায়নি।',
  PAYROLL_PERIOD_PAID: 'এই মাসের বেতন ইতিমধ্যে অনুমোদিত।',
  PAYROLL_NOT_SEPARATING: 'চূড়ান্ত নিষ্পত্তির আগে শেষ কর্মদিবস লিখুন।',
  PAYSLIP_NOT_FOUND: 'বেতন বিবরণী পাওয়া যায়নি।',
  ASSET_NOT_FOUND: 'সম্পদ পাওয়া যায়নি।',
  ASSET_CLASS_NOT_FOUND: 'সম্পদের শ্রেণি পাওয়া যায়নি।',
  ASSET_WRONG_STATE: 'এই অবস্থায় সম্পদটির জন্য এটি করা যাবে না।',
  ASSET_ASSIGNED: 'সম্পদটি একজন কর্মীর কাছে আছে; আগে ফেরত নিন।',
  ASSETS_NOT_RETURNED: 'কর্মীর কাছে এখনো কোম্পানির সম্পদ আছে; আগে ফেরত নিন।',
  DEPRECIATION_PERIOD_INVALID:
    'অবচয় মাসে মাসে চলে: শেষ চালানোর পরে, এবং ভবিষ্যতের মাসের জন্য নয়।',
  DEPRECIATION_RUN_NOT_FOUND: 'অবচয় চালানো পাওয়া যায়নি।',
  DEPRECIATION_NOT_LATEST: 'শুধু সর্বশেষ অবচয় চালানো বাতিল করা যায়।',
  STORE_NOT_FOUND: 'স্টোর পাওয়া যায়নি।',
  STOCK_ITEM_NOT_FOUND: 'পণ্য পাওয়া যায়নি।',
  STOCK_NOT_ENOUGH: 'যথেষ্ট মজুদ নেই: মজুদ কখনো শূন্যের নিচে যেতে পারে না।',
  STOCK_REQUEST_NOT_FOUND: 'স্টোর অনুরোধ পাওয়া যায়নি।',
  STOCK_REQUEST_WRONG_STATE: 'এই অবস্থায় স্টোর অনুরোধটি বদলানো যাবে না।',
  CRM_DUPLICATE: 'এই ফোন নম্বর বা ই-মেইল আগে থেকেই একটি লিড বা গ্রাহকের।',
  CRM_CONTACT_INVALID:
    'বাংলাদেশের একটি ফোন নম্বর বা ই-মেইল দিন (এবং বাংলাদেশের একটি জেলা)।',
  CRM_OWNER_INVALID: 'এই কোম্পানির বিক্রয় কর্মী নন।',
  CRM_NO_SALESPERSON: 'লিড নেওয়ার মতো কোনো বিক্রয় কর্মী বা অ্যাডমিন নেই।',
  LEAD_NOT_FOUND: 'লিড পাওয়া যায়নি।',
  LEAD_WRONG_STATE: 'এই অবস্থায় লিডটি বদলানো যাবে না।',
  CUSTOMER_NOT_FOUND: 'গ্রাহক পাওয়া যায়নি।',
  ACTIVITY_NOT_FOUND: 'কাজটি পাওয়া যায়নি।',
  TERRITORY_NOT_FOUND: 'বিক্রয় এলাকা পাওয়া যায়নি।',
  TERRITORY_DISTRICT_TAKEN: 'একটি জেলা একটি বিক্রয় এলাকাতেই থাকতে পারে।',
  OPPORTUNITY_NOT_FOUND: 'সম্ভাব্য বিক্রয়টি পাওয়া যায়নি।',
  OPPORTUNITY_WRONG_STATE: 'এই অবস্থায় সম্ভাব্য বিক্রয়টি বদলানো যাবে না।',
  STAGE_NOT_FOUND: 'পাইপলাইনের ধাপটি পাওয়া যায়নি, বা চালু নেই।',
  STAGE_IN_USE: 'এই ধাপে চলমান সম্ভাব্য বিক্রয় আছে: আগে সেগুলো সরান।',
  TARGET_INVALID: 'একটি মাস এবং একজন বিক্রয় কর্মী বা একটি বিভাগ দিন।',
  PRODUCT_NOT_FOUND: 'পণ্যটি পাওয়া যায়নি, বা চালু নেই।',
  PRODUCT_CODE_TAKEN: 'এই কোডে আরেকটি পণ্য আছে।',
  PRICE_MISSING: 'মূল্য তালিকায় এই পণ্যের দাম নেই: একক মূল্য লিখুন।',
  SALES_QUOTATION_NOT_FOUND: 'কোটেশনটি পাওয়া যায়নি।',
  QUOTATION_WRONG_STATE: 'এই অবস্থায় কোটেশনটিতে এটি করা যাবে না।',
  QUOTATION_EXPIRED: 'কোটেশনের মেয়াদ পেরিয়ে গেছে: নতুন সংস্করণ করুন।',
  ORDER_NOT_FOUND: 'বিক্রয় অর্ডারটি পাওয়া যায়নি।',
  ORDER_WRONG_STATE: 'এই অবস্থায় অর্ডারটিতে এটি করা যাবে না।',
  INVOICE_NOT_FOUND: 'চালানপত্রটি পাওয়া যায়নি।',
  INVOICE_LINE_NOT_FOUND: 'এই লাইনটি এই চালানপত্রে নেই।',
  CREDIT_TOO_MUCH: 'ক্রেডিট নোট চালানকৃত ও এখনো বকেয়া অংশের বেশি হতে পারে না।',
  SALES_DOCUMENT_NOT_REVERSIBLE:
    'গ্রাহকের চালানপত্র ক্রেডিট নোট দিয়ে সংশোধন করা হয়, রিভার্স করা হয় না।',
  CUSTOMER_RECEIPT_NOT_FOUND: 'প্রাপ্তিটি পাওয়া যায়নি।',
  PF_PAYMENT_NOT_REVERSIBLE:
    'পিএফ পরিশোধ বা মুনাফা রিভার্স করা হয় না: সংশোধনী লিপিবদ্ধ করুন।',
  PF_TOO_MUCH: 'সদস্যের নিজস্ব পিএফ অংশের চেয়ে বেশি।',
  PF_NOT_LEAVING:
    'চূড়ান্ত পিএফ নিষ্পত্তি শুধু নোটিশে থাকা বা অব্যাহতিপ্রাপ্ত কর্মীর জন্য।',
  PF_SETTLED: 'এই সদস্যের পিএফ ইতিমধ্যে নিষ্পত্তি হয়েছে।',
  PF_PENDING: 'এই সদস্যের একটি পিএফ পরিশোধ যাচাইকারীর অপেক্ষায়।',
  SALES_STORE_NEEDED:
    'যে স্টোর থেকে মাল যাচ্ছে তা উল্লেখ করুন (কিছু পণ্য স্টোরে রাখা হয়)।',
  RESIGNATION_PENDING: 'আপনার একটি পদত্যাগপত্র ইতিমধ্যে অনুমোদনের অপেক্ষায়।',
  RESIGNATION_NOT_POSSIBLE:
    'পদত্যাগ শুধু সক্রিয় (বা শিক্ষানবিশ) কর্মীর জন্য, যিনি ইতিমধ্যে চলে যাচ্ছেন না।',
  RECEIPT_ALLOCATION_INVALID: 'বরাদ্দটি গ্রাহকের বকেয়া চালানের সাথে মেলে না।',
  RECEIPT_ADVANCE_USED:
    'এই প্রাপ্তির টাকা এর মধ্যে একটি চালানে সমন্বয় করা হয়েছে: আগে সেটি বাতিল করুন।',
  ADVANCE_TOO_MUCH: 'গ্রাহকের অগ্রিম বা চালানের বকেয়ার চেয়ে বেশি।',
  OPENING_FILE_INVALID:
    'প্রারম্ভিক রেওয়ামিল যেমন আছে তেমন ব্যবহার করা যাচ্ছে না।',
  OPENING_IMPORT_FINAL:
    'পোস্ট হওয়ার পর প্রারম্ভিক ব্যালেন্স চূড়ান্ত: জার্নাল দিয়ে সংশোধন করুন।',
  OLD_TB_INVALID: 'পুরনো সিস্টেমের রেওয়ামিল পড়া যাচ্ছে না।',
  RECEIVABLE_NOT_FOUND: 'ক্রেতার চালান পাওয়া যায়নি।',
  RECEIPT_TOO_MUCH: 'এই চালানে ক্রেতার বাকির চেয়ে বেশি।',
  MONTH_CLOSE_NOT_READY: 'মাস এখনো বন্ধ করা যাবে না: আগে চেকলিস্ট শেষ করুন।',
  MONTH_CLOSE_ITEM_UNKNOWN: 'মাস-শেষের চেকলিস্টের বিষয় নয়।',
  DOCUMENT_UNREADABLE: 'বিল বা রসিদের ছবি (JPEG, PNG, WebP) বা PDF আপলোড করুন।',
  VAT_ITEM_NOT_FOUND: 'ভ্যাট পণ্য/সেবা পাওয়া যায়নি।',
  VAT_RATE_MISSING:
    'ওই অর্থবছরের জন্য এই পণ্য/সেবার ভ্যাট হার নেই: আগে হার যোগ করুন।',
  VAT_SALE_NOT_FOUND: 'ভ্যাট চালানপত্র পাওয়া যায়নি।',
  VAT_PERIOD_FILED:
    'ওই মাসের ভ্যাট রিটার্ন দাখিল হয়ে গেছে: আর বদলানো যাবে না।',
  VAT_RETURN_NOT_FOUND: 'ভ্যাট রিটার্ন পাওয়া যায়নি।',
  VAT_RETURN_FILED: 'এই মাসের ভ্যাট রিটার্ন আগেই দাখিল হয়েছে।',
  VAT_RETURN_PERIOD_INVALID:
    'শেষ হওয়া মাসের রিটার্ন দাখিল করা যায়, মাসের পর মাস ক্রমানুসারে।',
  VAT_RETURN_NOT_TIED:
    'রিটার্ন লেজারের সাথে মিলছে না: আগে পার্থক্যগুলো ঠিক করুন।',
  VAT_RETURN_NOTHING_TO_PAY: 'এই রিটার্নের জন্য জমা দেওয়ার কিছু নেই।',
  VAT_CHALLAN_EXISTS: 'এই রিটার্নের চালান আগেই তৈরি হয়েছে।',
  COMPLIANCE_ITEM_NOT_FOUND: 'ক্যালেন্ডারের বিষয়টি পাওয়া যায়নি।',
  COMPANY_BANK_ACCOUNT_NOT_FOUND: 'কোম্পানির ব্যাংক হিসাব পাওয়া যায়নি।',
  BANK_LEDGER_ACCOUNT_INVALID:
    'এই কোম্পানির হিসাব-তালিকার একটি সক্রিয় ব্যাংক হিসাব বেছে নিন।',
  BANK_ACCOUNT_HAS_STATEMENTS:
    'স্টেটমেন্ট আমদানি হয়ে গেছে: শুরুর তারিখ ও প্রারম্ভিক ব্যালেন্স আর বদলানো যাবে না।',
  BANK_STATEMENT_INVALID: 'স্টেটমেন্ট ফাইলটি পড়া যাচ্ছে না।',
  BANK_STATEMENT_DUPLICATE: 'এই স্টেটমেন্ট ফাইলটি আগেই আমদানি করা হয়েছে।',
  BANK_FILE_MISSING: 'স্টেটমেন্ট ফাইল (CSV) সংযুক্ত করুন।',
  BANK_LINE_NOT_FOUND:
    'এই ব্যাংক হিসাবের স্টেটমেন্ট বা লেজারের লাইন পাওয়া যায়নি।',
  BANK_LINE_ALREADY_MATCHED:
    'একটি লাইন আগেই মেলানো হয়েছে: একটি লাইন একবারই মেলানো যায়।',
  BANK_MATCH_UNBALANCED:
    'স্টেটমেন্টের লাইন ও লেজারের লাইনের যোগফল সমান হতে হবে।',
  BANK_MATCH_NOT_FOUND: 'মিল পাওয়া যায়নি।',
  BANK_MATCH_UNDONE: 'এই মিলটি আগেই বাতিল করা হয়েছে।',
  BANK_LINE_NOT_UNRECORDED:
    'এই স্টেটমেন্ট লাইনটি আগেই মেলানো: লিপিবদ্ধ করার কিছু নেই।',
  BUDGET_NOT_FOUND: 'বাজেট পাওয়া যায়নি।',
  BUDGET_WRONG_STATE: 'এই অবস্থায় বাজেটটি বদলানো যাবে না।',
  BUDGET_EXISTS: 'এই বিভাগের এ বছরের বাজেট আগেই আছে।',
  BUDGET_REVISION_OPEN: 'এই বাজেটের একটি পরিবর্তন আগেই অনুমোদনের অপেক্ষায়।',
  BUDGET_REVISION_NOT_FOUND: 'বাজেট পরিবর্তন পাওয়া যায়নি।',
  FISCAL_YEAR_INVALID: 'অর্থবছর 2026-27 এর মতো হতে হবে।',
  REQUISITION_NOT_FOUND: 'ক্রয় চাহিদাপত্র পাওয়া যায়নি।',
  REQUISITION_WRONG_STATE: 'এই অবস্থায় ক্রয় চাহিদাপত্রটি বদলানো যাবে না।',
  QUOTATION_NOT_FOUND: 'দরপত্র পাওয়া যায়নি।',
  QUOTATION_INCOMPLETE: 'চাহিদাপত্রের প্রতিটি লাইনের দাম দরপত্রে থাকতে হবে।',
  QUOTATIONS_TOO_FEW: 'এই পরিমাণের জন্য আরও দরপত্র প্রয়োজন।',
  SELECTION_REASON_REQUIRED: 'সর্বনিম্ন নয় এমন দরপত্র বাছাইয়ের কারণ লিখুন।',
  COMPARATIVE_STATEMENT_REQUIRED:
    'আগে তুলনামূলক বিবরণী অনুমোদিত হতে হবে, এবং বাছাই করা দরপত্র থেকেই ক্রয়াদেশ দিতে হবে।',
  PURCHASE_ORDER_NOT_FOUND: 'ক্রয়াদেশ পাওয়া যায়নি।',
  PURCHASE_ORDER_WRONG_STATE: 'এই অবস্থায় ক্রয়াদেশটি বদলানো যাবে না।',
  RECEIPT_EXCEEDS_ORDER: 'অর্ডারের চেয়ে বেশি গ্রহণ করা যাবে না।',
  GOODS_RECEIPT_NOT_FOUND: 'মালামাল গ্রহণ নোট পাওয়া যায়নি।',
  RECEIPT_ALREADY_BILLED:
    'এই মালামালের বিল আগেই হয়েছে; আগে বিল বাতিল বা সংশোধন করুন।',
  BILL_PO_INVALID:
    'বিলটি ক্রয়াদেশের সঙ্গে মেলে না: একই সরবরাহকারী, এবং প্রতিটি লাইনে ক্রয়াদেশের লাইন ও পরিমাণ থাকতে হবে।',
  BILL_NOT_MATCHED:
    'বিলটি ক্রয়াদেশ ও গৃহীত মালামালের সঙ্গে মেলেনি, তাই পরিশোধ করা যাবে না।',
  NOT_ON_PROBATION: 'কর্মী শিক্ষানবিশকালে নেই।',
  SEPARATION_EXISTS:
    'এই কর্মীর চাকরি ছাড়ার প্রক্রিয়া আগেই চলছে। বদলাতে হলে আগেরটি প্রত্যাহার করুন।',
  SEPARATION_NOT_FOUND: 'এই কর্মীর চাকরি ছাড়ার কোনো নোটিশ পাওয়া যায়নি।',
  SEPARATION_NOT_CLEARED:
    'ছাড়পত্র এখনো সম্পূর্ণ হয়নি: চূড়ান্ত নিষ্পত্তির আগে সব বিভাগকে ছাড়পত্র দিতে হবে।',
  SEPARATION_HAS_SETTLEMENT:
    'এই কর্মীর চূড়ান্ত নিষ্পত্তি প্রক্রিয়া চলছে; আগে সেটি বাতিল করুন।',
  NOT_SEPARATED: 'চূড়ান্ত নিষ্পত্তির পরে অভিজ্ঞতা সনদ দেওয়া হয়।',
  TAX_CERTIFICATE_EMPTY: 'এই অর্থবছরে কোনো বেতন দেওয়া হয়নি, তাই কর সনদ নেই।',
  SALARY_TAX_CHALLAN_NOT_FOUND: 'বেতনের কর চালান পাওয়া যায়নি।',
  SALARY_TAX_CHALLAN_DUPLICATE: 'এই চালান নম্বর আগেই লেখা হয়েছে।',
  LEAVE_TYPE_NOT_FOUND: 'ছুটির ধরন পাওয়া যায়নি।',
  LEAVE_REQUEST_NOT_FOUND: 'ছুটির আবেদন পাওয়া যায়নি।',
  LEAVE_NOT_ELIGIBLE: 'আপনি এই ধরনের ছুটির যোগ্য নন।',
  LEAVE_INSUFFICIENT_BALANCE: 'ছুটির পর্যাপ্ত ব্যালান্স নেই।',
  LEAVE_OVERLAP: 'এই তারিখগুলো আরেকটি ছুটির আবেদনের সাথে মিলে যায়।',
  LEAVE_TOO_FAR_BACK: 'তারিখটি অনেক আগের। এইচআর-কে এটি যোগ করতে বলুন।',
  LEAVE_HALF_DAY_NOT_ALLOWED:
    'এই ধরনের ছুটি বা তারিখে অর্ধদিবস ছুটি নেওয়া যায় না।',
  LEAVE_NO_DAYS:
    'নির্বাচিত তারিখে কোনো ছুটির দিন নেই (সাপ্তাহিক ও অন্যান্য ছুটি গণনা হয় না)।',
  LEAVE_DOCUMENT_REQUIRED: 'এই ছুটির জন্য সহায়ক নথি প্রয়োজন।',
  LEAVE_TOO_LONG: 'এই ধরনের ছুটির জন্য অনুমোদিত সময়ের চেয়ে বেশি।',
  LEAVE_CANNOT_CANCEL:
    'এই ছুটি আপনি আর বাতিল করতে পারবেন না। এইচআর-এর সাথে যোগাযোগ করুন।',
  LEAVE_NOT_RETURNED:
    'শুধু সংশোধনের জন্য ফেরত আসা আবেদন সম্পাদনা করে আবার পাঠানো যায়।',
  SERVICE_KEY_INVALID: 'সার্ভিস কী নেই, ভুল অথবা বাতিল।',
  SHIFT_NOT_FOUND: 'শিফট পাওয়া যায়নি।',
  DEVICE_NOT_FOUND: 'ডিভাইস পাওয়া যায়নি।',
  ATTENDANCE_DEVICE_NOT_REGISTERED:
    'এই ফোনটি আপনার হাজিরার জন্য নিবন্ধিত ও অনুমোদিত নয়।',
  ATTENDANCE_OUTSIDE_GEOFENCE:
    'আপনি অফিস এলাকার বাইরে আছেন। অফিস থেকে হাজিরা দিন।',
  ATTENDANCE_GEOFENCE_NOT_SET:
    'আপনার শাখার জন্য মোবাইল হাজিরা চালু নেই (অফিসের অবস্থান দেওয়া হয়নি)।',
  ATTENDANCE_WEB_PUNCH_NOT_ALLOWED:
    'ওয়েব হাজিরা শুধু অনুমোদিত দূরবর্তী কর্মীদের জন্য।',
  ATTENDANCE_NOT_EMPLOYED: 'এই তারিখে কোনো চাকরির রেকর্ড নেই।',
  ATTENDANCE_CORRECTION_LIMIT: 'এই মাসের হাজিরা সংশোধনের সীমা পূর্ণ হয়েছে।',
  ATTENDANCE_DATE_IN_FUTURE: 'তারিখটি ভবিষ্যতের হতে পারে না।',
  ATTENDANCE_NO_OVERTIME: 'এই দিনে অনুমোদনের জন্য কোনো ওভারটাইম নেই।',
  ATTENDANCE_MONTH_LOCKED: 'এই মাসের হাজিরা ইতিমধ্যে লক করা হয়েছে।',
  RULE_PACK_NOT_FOUND: 'নিয়ম প্যাক পাওয়া যায়নি।',
  RULE_PACK_NOT_ACCEPTED:
    'এই তারিখের জন্য কোনো নিয়ম প্যাক গ্রহণ করা হয়নি। আগে একজন অ্যাডমিনকে নিয়ম প্যাক সংস্করণ গ্রহণ করতে হবে।',
  RULE_NOT_FOUND: 'এই তারিখে এই নিয়মের কোনো মান নিয়ম প্যাকে নেই।',
  RULE_NOT_VERIFIED:
    'এই আইনি মানটি এখনো কমপ্লায়েন্স দায়িত্বপ্রাপ্ত ব্যক্তি যাচাই করেননি, তাই ব্যবহার করা যাবে না।',
  AUTH_MFA_REQUIRED:
    'আপনার ভূমিকার জন্য টু-ফ্যাক্টর যাচাইকরণ বাধ্যতামূলক। এটি চালু করে আবার সাইন ইন করুন।',
  AUTH_STEP_UP_INVALID: 'এই কাজের যাচাইকরণ কোডটি ভুল অথবা আগে ব্যবহৃত।',
  ROLE_NOT_FOUND: 'ভূমিকা পাওয়া যায়নি।',
  ROLE_SCOPE_INVALID: 'এই ভূমিকা ওই পরিসরে দেওয়া যায় না।',
  ROLE_EXPIRY_REQUIRED: 'এই ভূমিকার একটি শেষ তারিখ দিতে হবে।',
  ROLE_SELF_GRANT: 'আপনি নিজের ভূমিকা বা প্রবেশাধিকার পরিবর্তন করতে পারবেন না।',
  ROLE_GRANT_NOT_FOUND: 'ভূমিকা প্রদানের রেকর্ড পাওয়া যায়নি।',
  PERMISSION_UNKNOWN: 'অজানা অনুমতি।',
  FIELD_GRANT_NOT_FOUND: 'তথ্য দেখার অনুমতি পাওয়া যায়নি।',
  DELEGATION_NOT_FOUND: 'দায়িত্ব অর্পণ পাওয়া যায়নি।',
  APPROVAL_NOT_FOUND: 'অনুমোদনের অনুরোধ পাওয়া যায়নি।',
  APPROVAL_NOT_OPEN: 'এই অনুরোধটি আর অনুমোদনের অপেক্ষায় নেই।',
  APPROVAL_NOT_YOUR_TURN: 'এই অনুরোধের বর্তমান ধাপে আপনি অনুমোদনকারী নন।',
  APPROVAL_SELF_APPROVAL: 'কেউ নিজের অনুরোধ অনুমোদন করতে পারেন না।',
  APPROVAL_NO_APPROVER:
    'এই অনুরোধের জন্য কোনো অনুমোদনকারী পাওয়া যায়নি। অ্যাডমিনকে অনুমোদন ধারা যাচাই করতে বলুন।',
  APPROVAL_NO_CHAIN: 'এই ধরনের অনুরোধের জন্য কোনো অনুমোদন ধারা নেই।',
  APPROVAL_COMMENT_REQUIRED: 'একটি মন্তব্য দিতে হবে।',
  APPROVAL_CANCEL_NOT_ALLOWED:
    'শুধু অনুরোধকারী চূড়ান্ত অনুমোদনের আগে বাতিল করতে পারেন।',
  BANK_ACCOUNT_NOT_FOUND: 'ব্যাংক বা ওয়ালেট হিসাব পাওয়া যায়নি।',
  BANK_ACCOUNT_PENDING_EXISTS:
    'একটি ব্যাংক বা ওয়ালেট পরিবর্তন ইতিমধ্যে অনুমোদনের অপেক্ষায় আছে।',
  OUTBOX_EVENT_NOT_DEAD: 'শুধু ব্যর্থ (ডেড) ইভেন্ট পুনরায় পাঠানো যায়।',
  DUPLICATE_VALUE: 'এই তথ্যসহ একটি রেকর্ড আগে থেকেই আছে।',
  REFERENCE_NOT_FOUND: 'সংযুক্ত রেকর্ডটি নেই অথবা অন্য কোম্পানির।',
  STALE_VERSION: 'রেকর্ডটি অন্য কেউ পরিবর্তন করেছেন। আবার লোড করে চেষ্টা করুন।',
  INVALID_DATE: 'তারিখটি সঠিক নয়।',
  COMPANY_NOT_FOUND: 'কোম্পানি পাওয়া যায়নি।',
  BRANCH_NOT_FOUND: 'শাখা পাওয়া যায়নি।',
  DEPARTMENT_NOT_FOUND: 'বিভাগ পাওয়া যায়নি।',
  DEPARTMENT_CYCLE:
    'কোনো বিভাগকে তার নিজের বা নিজের উপ-বিভাগের অধীনে নেওয়া যায় না।',
  DESIGNATION_NOT_FOUND: 'পদবি পাওয়া যায়নি।',
  GRADE_NOT_FOUND: 'গ্রেড পাওয়া যায়নি।',
  EMPLOYEE_NOT_FOUND: 'কর্মী পাওয়া যায়নি।',
  EMPLOYEE_NOT_DRAFT: 'শুধু খসড়া অবস্থার কর্মীকে সক্রিয় করা যায়।',
  EMPLOYEE_JOIN_DATE_LOCKED:
    'যোগদানের তারিখ শুধু খসড়া অবস্থায় পরিবর্তন করা যায়।',
  INVALID_NID: 'জাতীয় পরিচয়পত্র নম্বর ১০, ১৩ বা ১৭ অঙ্কের হতে হবে।',
  INVALID_TIN: 'টিআইএন ১২ অঙ্কের হতে হবে।',
  MANAGER_INVALID:
    'ম্যানেজার অবশ্যই কোম্পানির অন্য একজন বর্তমান কর্মী হতে হবে।',
  JOB_EVENT_BEFORE_JOINING:
    'যোগদানের তারিখের আগে পরিবর্তন কার্যকর হতে পারে না।',
  JOB_EVENT_NO_CHANGES: 'এই পরিবর্তনে ওই তারিখে কিছুই বদলায় না।',
  JOB_EVENT_NOT_FOUND: 'চাকরির পরিবর্তনটি পাওয়া যায়নি।',
  JOB_EVENT_ALREADY_CANCELLED: 'এই পরিবর্তনটি আগেই বাতিল করা হয়েছে।',
  JOINING_EVENT_CANNOT_CANCEL: 'যোগদানের রেকর্ড বাতিল করা যায় না।',
  ONBOARDING_INCOMPLETE: 'আগে সব প্রয়োজনীয় অনবোর্ডিং কাজ সম্পন্ন করুন।',
  ONBOARDING_ITEM_NOT_FOUND: 'অনবোর্ডিং কাজটি পাওয়া যায়নি।',
  DOCUMENT_NOT_FOUND: 'নথি পাওয়া যায়নি।',
  FILE_REQUIRED: 'একটি ফাইল সংযুক্ত করুন।',
  FILE_TYPE_NOT_ALLOWED:
    'শুধু ১০ এমবি পর্যন্ত PDF, JPG ও PNG ফাইল দেওয়া যাবে।',
  VALIDATION_FAILED: 'কিছু তথ্য দেওয়া হয়নি বা সঠিক নয়।',
  NOT_FOUND: 'খুঁজে পাওয়া যায়নি।',
  FORBIDDEN: 'এই কাজের অনুমতি আপনার নেই।',
  INTERNAL_ERROR: 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।',
  AUTH_REQUIRED: 'অনুগ্রহ করে সাইন ইন করুন।',
  AUTH_INVALID_CREDENTIALS: 'ওয়ার্কস্পেস, ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।',
  AUTH_ACCOUNT_LOCKED:
    'অনেকবার ভুল চেষ্টা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।',
  AUTH_MFA_INVALID_CODE: 'যাচাইকরণ কোডটি ভুল বা মেয়াদোত্তীর্ণ।',
  AUTH_MFA_NOT_SET_UP: 'টু-ফ্যাক্টর যাচাইকরণ চালু করা হয়নি।',
  AUTH_MFA_ALREADY_ENABLED: 'টু-ফ্যাক্টর যাচাইকরণ আগেই চালু আছে।',
  AUTH_STEP_UP_REQUIRED: 'এই কাজটি নিশ্চিত করতে আপনার যাচাইকরণ কোড দিন।',
  USER_NOT_FOUND: 'ব্যবহারকারী পাওয়া যায়নি।',
  IDEMPOTENCY_KEY_REQUIRED: 'এই অনুরোধের জন্য Idempotency-Key হেডার প্রয়োজন।',
  IDEMPOTENCY_KEY_REUSED:
    'এই Idempotency-Key আগে অন্য একটি অনুরোধে ব্যবহার হয়েছে।',
  AI_OFF: 'এআই সহকারী বন্ধ আছে। সব স্ক্রিন আগের মতোই কাজ করবে।',
  AI_NOT_IN_PLAN: 'এআই সুবিধা ইন্টেলিজেন্ট প্ল্যানের অংশ।',
  AI_NOT_RELEASED:
    'এই এআই সুবিধা এখনো মান-পরীক্ষায় উত্তীর্ণ হয়নি, তাই চালু নেই।',
  AI_QUOTA_EXCEEDED:
    'এ মাসের এআই কোটা শেষ। আরও ক্রেডিটের জন্য অ্যাডমিনকে বলুন; সব স্ক্রিন আগের মতো কাজ করবে।',
  AI_UNAVAILABLE:
    'এআই সহকারী এখন উত্তর দিচ্ছে না। অনুগ্রহ করে সাধারণ স্ক্রিন ব্যবহার করুন বা পরে চেষ্টা করুন।',
  AI_INTERACTION_NOT_FOUND: 'এআই উত্তর পাওয়া যায়নি।',
  AI_POLICY_DOCUMENT_NOT_FOUND: 'নীতিমালার নথি পাওয়া যায়নি।',
  PAYROLL_FLAG_NOT_FOUND: 'বেতন হিসাবের সতর্কতা পাওয়া যায়নি।',
  CONSENT_REQUIRED_LOCATION:
    'ফোনে পাঞ্চ করতে আপনার অবস্থান লাগে। আগে অ্যাপে (আমি > সম্মতি) অবস্থান সংক্রান্ত নোটিশ পড়ে সম্মতি দিন।',
  CONSENT_REQUIRED_BIOMETRIC:
    'কর্মী বায়োমেট্রিক হাজিরায় সম্মতি দেননি। আগে স্বাক্ষরিত সম্মতিপত্র রেকর্ড করুন (সম্মতি)।',
  CONSENT_REQUIRED_SELFIE:
    'ছবিসহ পাঞ্চের জন্য আগে আপনার সম্মতি লাগবে (আমি > সম্মতি)।',
  PARALLEL_FILE_INVALID:
    'বেতন রেজিস্টার মেলানো যাচ্ছে না। কিছুই সংরক্ষণ করা হয়নি।',
  PARALLEL_COMPARISON_NOT_FOUND: 'সমান্তরাল বেতন তুলনা পাওয়া যায়নি।',
  PARALLEL_UNEXPLAINED:
    'তুলনা গ্রহণের আগে প্রতিটি পার্থক্যের ব্যাখ্যা দিতে হবে।',
  PARALLEL_OUTDATED:
    'এই তুলনার পর বেতন আবার হিসাব করা হয়েছে। রেজিস্টার আবার আপলোড করুন।',
  PARALLEL_SAME_PERSON:
    'যিনি তুলনা আপলোড করেছেন তিনি নিজে তা গ্রহণ করতে পারবেন না।',
  PARALLEL_ALREADY_ACCEPTED: 'এই তুলনা আগেই গ্রহণ করা হয়েছে।',
  LEDGER_NOT_SET_UP:
    'এই কোম্পানির হিসাবরক্ষণ এখনো সেটআপ হয়নি (হিসাবের তালিকা ও অর্থবছর)।',
  ACCOUNT_NOT_FOUND: 'হিসাব পাওয়া যায়নি।',
  ACCOUNT_NOT_POSTABLE:
    'ভাউচারে শুধু সক্রিয় পোস্টযোগ্য হিসাব ব্যবহার করা যায় (গ্রুপ হিসাব নয়)।',
  VOUCHER_NOT_FOUND: 'ভাউচার পাওয়া যায়নি।',
  VOUCHER_UNBALANCED:
    'ডেবিট ও ক্রেডিট সমান হতে হবে, কমপক্ষে দুটি লাইন, এবং প্রতিটি লাইন এক দিকেই।',
  VOUCHER_WRONG_STATE: 'ভাউচারটি এই কাজের অবস্থায় নেই।',
  VOUCHER_NEEDS_CASH_OR_BANK:
    'পেমেন্ট ভাউচারে নগদ বা ব্যাংক হিসাব ক্রেডিট, রসিদ ভাউচারে ডেবিট, এবং কন্ট্রা ভাউচারে শুধু নগদ ও ব্যাংক হিসাব থাকে।',
  PERIOD_CLOSED: 'হিসাবকাল বন্ধ। এতে শুধু রিভার্সাল ভাউচার দেওয়া যায়।',
  PERIOD_NOT_FOUND: 'এই তারিখের কোনো হিসাবকাল নেই। আগে অর্থবছর খুলুন।',
  VOUCHER_ALREADY_REVERSED: 'এই ভাউচার আগেই রিভার্স করা হয়েছে।',
  POSTING_ACCOUNT_MISSING:
    'কিছু পোস্টিং হিসাব নির্ধারিত নেই (বিস্তারিত দেখুন)। লেজার সেটআপে নির্ধারণ করুন।',
  ALREADY_POSTED: 'এই নথি আগেই লেজারে পোস্ট হয়েছে।',
  OPENING_VOUCHER_RULES:
    'প্রারম্ভিক ব্যালান্স মাসের প্রথম দিনের তারিখে জার্নাল ভাউচারে দিতে হয়।',
  OPENING_BALANCES_EXIST:
    'এই কোম্পানির প্রারম্ভিক ব্যালান্স আগেই দেওয়া আছে। নতুন দিতে হলে আগেরটি রিভার্স করুন।',
  CONTROL_ACCOUNT_MANUAL:
    'এই হিসাবে শুধু সরবরাহকারীর বিল ও পরিশোধ থেকে এন্ট্রি হয়; হাতে এন্ট্রি দেওয়া যায় না।',
  VENDOR_NOT_FOUND: 'সরবরাহকারী পাওয়া যায়নি।',
  VENDOR_INACTIVE: 'এই সরবরাহকারী নিষ্ক্রিয়।',
  VENDOR_DUPLICATE: 'এই কোড বা টিআইএন দিয়ে আগেই একজন সরবরাহকারী আছে।',
  VENDOR_BANK_PENDING_EXISTS:
    'এই সরবরাহকারীর একটি ব্যাংক হিসাব পরিবর্তন আগেই অনুমোদনের অপেক্ষায় আছে।',
  VENDOR_BANK_NOT_APPROVED:
    'ব্যাংক ট্রান্সফারের জন্য সরবরাহকারীর অনুমোদিত ব্যাংক হিসাব লাগবে।',
  BILL_NOT_FOUND: 'সরবরাহকারীর বিল পাওয়া যায়নি।',
  BILL_DUPLICATE: 'এই সরবরাহকারীর এই ইনভয়েস নম্বর আগেই দেওয়া হয়েছে।',
  BILL_WRONG_STATE: 'বিলের বর্তমান অবস্থায় এটি করা যায় না।',
  BILL_HAS_PAYMENTS:
    'এই বিলে পরিশোধ হয়েছে বা কর জমা হয়েছে। আগে সেগুলো রিভার্স করুন।',
  WITHHOLDING_CATEGORY_UNKNOWN: 'উৎসে করের জন্য অজানা পরিশোধের ধরন।',
  PAYMENT_EXCEEDS_OUTSTANDING: 'পরিমাণটি বিলের বাকি পাওনার চেয়ে বেশি।',
  PAYMENT_ACCOUNT_NOT_MONEY: 'নগদ বা ব্যাংক হিসাব থেকে পরিশোধ করুন।',
  VENDOR_PAYMENT_NOT_FOUND: 'সরবরাহকারীর পরিশোধ পাওয়া যায়নি।',
  NOTHING_TO_DEPOSIT: 'এই মাসে জমার অপেক্ষায় থাকা কোনো উৎসে কর্তিত কর নেই।',
  CHALLAN_NOT_FOUND: 'কর চালান পাওয়া যায়নি।',
  CHALLAN_CERTIFIED:
    'এই চালানের কর সরবরাহকারীদের সনদে দেওয়া হয়েছে, তাই চালানটি রিভার্স করা যায় না।',
  NOTHING_TO_CERTIFY:
    'এই সময়ে এই সরবরাহকারীর সনদের অপেক্ষায় থাকা কোনো জমাকৃত কর নেই।',
  CERTIFICATE_NOT_FOUND: 'সনদ পাওয়া যায়নি।',
  EXPENSE_CLAIM_NOT_FOUND: 'খরচের দাবি পাওয়া যায়নি।',
  EXPENSE_CLAIM_WRONG_STATE: 'দাবির বর্তমান অবস্থায় এটি করা যায় না।',
  EXPENSE_CATEGORY_NOT_FOUND: 'খরচের ধরন পাওয়া যায়নি বা সক্রিয় নয়।',
  EXPENSE_CLAIM_EMPTY: 'অন্তত একটি খরচের লাইন দিন।',
  EXPENSE_DATE_FUTURE: 'ভবিষ্যতের তারিখে খরচ দেখানো যায় না।',
  RECEIPT_REQUIRED: 'এই লাইনগুলোর জন্য রসিদ লাগবে।',
  RECEIPT_DUPLICATE: 'এই রসিদ আগেই অন্য একটি দাবিতে দেওয়া হয়েছে।',
  RECEIPT_NOT_FOUND: 'রসিদ পাওয়া যায়নি।',
  ADVANCE_NOT_FOUND: 'অগ্রিম পাওয়া যায়নি।',
  ADVANCE_WRONG_STATE: 'অগ্রিমের বর্তমান অবস্থায় এটি করা যায় না।',
  ADVANCE_EXCEEDED: 'পরিমাণটি অগ্রিমের বাকি অংশের চেয়ে বেশি।',
  EMPLOYEE_ACCOUNT_REQUIRED:
    'ব্যাংক বা ওয়ালেটে পরিশোধের জন্য কর্মীর অনুমোদিত বেতন হিসাব লাগবে।',
  LOAN_WRONG_STATE: 'অগ্রিম বেতনের বর্তমান অবস্থায় এটি করা যায় না।',
  ATTENDANCE_OVERTIME_TOO_MUCH:
    'এই দিনে যত ওভারটাইম হয়েছে, এটি তার চেয়ে বেশি।',
  ATTENDANCE_WEAK_GPS:
    'অবস্থান যথেষ্ট নির্ভুল নয়। জানালার কাছে বা বাইরে গিয়ে আবার চেষ্টা করুন।',
};

const catalogues: Record<Language, Record<MessageKey, string>> = { en, bn };

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === 'string' && value in MSG;
}

/** Text of a message in a language. Unknown keys are returned unchanged. */
export function translate(key: string, lang: Language = 'en'): string {
  return isMessageKey(key) ? catalogues[lang][key] : key;
}

/**
 * The language the client asks for in X-Language (the app's language switch),
 * or undefined when it sends none. It wins over the user's saved preference.
 */
export function languageOverride(
  header: string | string[] | undefined,
): Language | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  return value === 'bn' || value === 'en' ? value : undefined;
}

/** Pick 'bn' or 'en' from an Accept-Language header (default English). */
export function languageFromHeader(header: string | undefined): Language {
  return header?.toLowerCase().startsWith('bn') ? 'bn' : 'en';
}
