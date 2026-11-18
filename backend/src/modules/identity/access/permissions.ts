/**
 * Every permission in the system (spec §4). A role is a list of these keys;
 * a route declares the key it needs with @RequirePermission('...').
 *
 * Keys for modules not built yet (attendance, leave, payroll) are listed now so
 * the permission matrix is complete and testable from the start.
 */
export const PERMISSIONS = {
  // organization
  'org.view':
    'See the company structure (companies, branches, departments, designations, grades)',
  'org.structure.manage':
    'Create and change companies, branches and departments',
  'org.jobs.manage': 'Create and change designations and grades',

  // users and access
  'users.manage': 'Create user logins, disable them, link them to employees',
  'roles.manage': 'Create custom roles (copies of system roles)',
  'roles.grant': 'Grant and revoke roles and sensitive-field access',

  // employees
  'employee.view': 'View employee profiles',
  'employee.manage':
    'Create and change employee records, job history, onboarding, documents',
  'employee.lifecycle.review':
    'Recommend at the end of probation and clear the handover of a leaver (department)',
  'employee.documents.view': 'View and download employee documents',
  'employee.contact.edit_own': 'Edit own contact details',
  'employee.bank.manage': 'Record salary bank / wallet accounts for employees',
  'employee.bank.request_own':
    'Request a change to own salary bank / wallet account',

  // attendance (WP4)
  'attendance.view': 'View attendance',
  'attendance.manage':
    'Manage shifts, holidays, corrections and the monthly lock',
  'attendance.correction.approve': 'Approve attendance corrections',
  'attendance.own': 'Punch and view own attendance; request corrections',
  'attendance.ingest':
    'Upload punches from biometric devices (service keys only, no human role)',

  // leave (WP5)
  'leave.view': 'View leave',
  'leave.manage': 'Manage leave types, balances and year-end',
  'leave.approve': 'Approve leave',
  'leave.apply_own': 'Apply for own leave',

  // payroll (WP6)
  'payroll.prepare': 'Prepare payroll runs (maker)',
  'payroll.verify': 'Verify payroll runs',
  'payroll.approve': 'Give final approval to payroll runs',
  'payroll.disburse': 'Generate disbursement files and mark payroll paid',
  'payslip.view_own': 'View own payslips',
  'payroll.loan.request_own':
    'Ask for a salary advance for oneself and see own advances',

  // data migration (WP8)
  'data.import':
    'Upload, validate, commit and roll back data migration batches',
  'data.import.sign_off':
    'Sign the migration reconciliation report (customer sign-off before go-live)',

  // compliance rule pack (WP3)
  'rules.view':
    'See statutory rule values, their sources and verification status',
  'rules.accept':
    'Accept a rule pack version for the company group, from a date',

  // approvals
  'approvals.configure': 'Configure approval chains',
  'approvals.view_all': 'See every approval request of the company',

  // audit and integrations
  'audit.view': 'Read the audit log',
  'audit.view_finance': 'Read finance entries of the audit log',
  'integrations.manage': 'See failed outgoing events and replay them',

  // notifications (WP10)
  'notifications.relay':
    'Fetch and report outgoing messages for one event (n8n, with the event callback token only)',

  // general ledger (Phase 2 WP14)
  'ledger.view':
    'See the chart of accounts, vouchers, ledgers and financial reports',
  'ledger.vouchers.prepare':
    'Prepare and submit vouchers (maker); reversals; post pending automatic postings',
  'ledger.setup':
    'Set up the chart of accounts, posting accounts and fiscal years',
  'ledger.periods.close':
    'Close an accounting period (afterwards it accepts only reversals)',

  // payables and tax at source (Phase 2 WP15)
  'payables.view':
    'See vendors, vendor bills, payments, tax withheld and aged payables',
  'payables.manage':
    'Create vendors and their bank accounts; prepare vendor bills and payments (maker)',
  'payables.tax':
    'Withholding settings, tax challans and withholding certificates to vendors',

  // expense claims and employee advances (Phase 2 WP16)
  'expenses.claim_own':
    'Make own expense claims (with receipts) and ask for own cash advances',
  'expenses.view':
    'See expense claims, cash advances and the employee advances sub-ledger',
  'expenses.pay':
    'Pay approved claims and advances, record refunds and salary recovery, expense categories',

  // procurement (WP17)
  'procurement.request_own': 'Raise own purchase requisitions and follow them',
  'procurement.view':
    'See purchase requisitions, quotations, purchase orders and goods received',
  'procurement.manage':
    'Record quotations, prepare the comparative statement, raise and issue purchase orders, procurement settings',
  'procurement.receive':
    'Record goods / services received against a purchase order',
  'procurement.override_match':
    'Accept a three-way match variance on a vendor bill (with a reason)',

  // budgets (WP18)
  'budgets.view': 'See budgets and budget vs actual',
  'budgets.manage': 'Prepare budgets and their revisions, budget settings',
  'budgets.request_change': 'Ask for a change to the department budget',

  // assets and stock (WP19)
  'assets.view':
    'See the asset register, assignments, maintenance and depreciation',
  'assets.manage':
    'Register, assign, take back, maintain and dispose of assets; asset classes',
  'assets.depreciate': 'Run and reverse the monthly depreciation',
  'assets.own': 'See the assets assigned to oneself and acknowledge them',
  'stock.view': 'See stores, items, stock and issue requests',
  'stock.manage': 'Keep stores and items; receive, adjust and issue stock',
  'stock.request_own':
    "Ask the store for consumables for oneself or one's department",

  // bank reconciliation (WP20)
  'bank.view':
    'See company bank accounts, imported statements, matches and the reconciliation',
  'bank.reconcile':
    'Set up bank accounts for reconciliation; import statements; match and unmatch lines',
  'bank.import':
    'Send bank statement files (the n8n statement import, with a service key)',

  // VAT and compliance (WP21)
  'vat.view':
    'See VAT items and rates, the sales and purchase registers and the monthly VAT returns',
  'vat.manage':
    'Keep VAT items and rates; record VAT invoices; file the monthly VAT return and deposit the VAT',
  'compliance.view':
    'See the compliance calendar (returns, deposits and renewals and when they are due)',
  'compliance.manage': 'Add calendar items; mark them done or not applicable',

  // receivables (WP22)
  'receivables.view':
    'See what customers owe (invoices from the old system) and its aging',
  'receivables.manage':
    'Record money received from customers against their invoices',

  // CRM (Phase 3 WP23)
  'crm.view':
    'See leads, customers and their activities within the scope (company or department)',
  'crm.own':
    "Work one's own leads and customers: add leads, log calls and meetings, qualify (Sales user)",
  'crm.assign':
    'Hand leads and customers to another salesperson (Sales head, Admin)',
  'crm.manage':
    'Set up sales territories and who takes their leads; edit any customer',
  'crm.credit':
    'See customers and set their credit limit and payment terms (Accounts)',
  'crm.capture':
    'Send leads in from outside (the website form and Facebook lead ads through n8n, with a service key)',

  // quotations, orders and invoices (Phase 3 WP25-WP27)
  'sales.catalogue':
    'Set up products, price lists and the discount limits of salespeople',

  // commissions and the sales assistant (Phase 3 WP31)
  'commission.view':
    'See the commission scheme, the monthly runs and what each salesperson earned',
  'commission.manage':
    'Set the commission scheme, calculate a month and post it to payroll',
  'ai.sales_assist.use':
    'Ask the sales assistant about own leads and customers (score, next step, draft text)',
  'gate3.view':
    'See the Gate 3 report: the pilot ran its sales pipeline and one appraisal cycle',

  // performance (Phase 3 WP30)
  'performance.own':
    'Own appraisal: see the goals, write the self-review, read shared feedback',
  'performance.rate':
    "Rate one's own team's appraisals and write their goals (Dept Head)",
  'performance.view':
    'See appraisals, ratings and feedback within the scope',
  'performance.manage':
    'Cycles, the KPI library, opening appraisals, calibrating ratings across departments',
  'performance.propose':
    'Propose an increment or a promotion from a calibrated appraisal',

  // recruitment (Phase 3 WP29)
  'recruitment.request_own':
    'Ask for a new post in own department, and follow the request',
  'recruitment.view':
    'See the manpower plan, position requests, openings, applicants and interviews in scope',
  'recruitment.manage':
    'Openings and postings, applicants and their CVs, stages, interviews and offers',
  'recruitment.interview':
    'Give a scorecard for an interview one is on the panel of',
  'recruitment.plan': 'Set and approve the manpower plan for a fiscal year',

  // support tickets (Phase 3 WP28)
  'support.view':
    'See customers’ tickets within the scope, and the Customer 360 page',
  'support.own':
    'Work the tickets assigned to oneself: reply, note, resolve, ask the customer',
  'support.manage':
    'Raise and assign tickets, reopen a closed one, ticket categories and the SLA per priority',

  // AI assistant (WP11)
  'ai.assistant.use': 'Use the AI assistant within own access',
  'ai.manage':
    'Switch AI features on and off; see AI usage, quota and answer ratings',
  'ai.policies.manage':
    'Upload and retire the policy documents the AI assistant answers from',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

/**
 * The same catalogue in Bangla, for the "what can this role do" picker in the
 * portal (spec §8: Bangla and English from day one). TypeScript checks that
 * every permission above has a Bangla line.
 */
export const PERMISSIONS_BN: Record<PermissionKey, string> = {
  'org.view': 'কোম্পানির কাঠামো দেখা (কোম্পানি, শাখা, বিভাগ, পদবি, গ্রেড)',
  'org.structure.manage': 'কোম্পানি, শাখা ও বিভাগ তৈরি ও পরিবর্তন',
  'org.jobs.manage': 'পদবি ও গ্রেড তৈরি ও পরিবর্তন',
  'users.manage': 'লগইন তৈরি করা, বন্ধ করা, কর্মীর সাথে সংযুক্ত করা',
  'roles.manage': 'কাস্টম দায়িত্ব তৈরি (সিস্টেম দায়িত্বের অনুলিপি)',
  'roles.grant': 'দায়িত্ব ও সংবেদনশীল তথ্যের অনুমতি দেওয়া ও প্রত্যাহার',
  'employee.view': 'কর্মীর প্রোফাইল দেখা',
  'employee.manage':
    'কর্মীর তথ্য, পদ পরিবর্তন, যোগদান প্রক্রিয়া ও কাগজপত্র তৈরি ও পরিবর্তন',
  'employee.lifecycle.review':
    'শিক্ষানবিশকাল শেষে সুপারিশ এবং বিদায়ী কর্মীর দায়িত্ব হস্তান্তরের ছাড়পত্র (বিভাগ)',
  'employee.documents.view': 'কর্মীর কাগজপত্র দেখা ও নামানো',
  'employee.contact.edit_own': 'নিজের যোগাযোগের তথ্য পরিবর্তন',
  'employee.bank.manage': 'কর্মীর বেতনের ব্যাংক / ওয়ালেট হিসাব লিপিবদ্ধ করা',
  'employee.bank.request_own':
    'নিজের বেতনের ব্যাংক / ওয়ালেট হিসাব পরিবর্তনের অনুরোধ',
  'attendance.view': 'হাজিরা দেখা',
  'attendance.manage': 'শিফট, ছুটির দিন, সংশোধন ও মাসিক লক পরিচালনা',
  'attendance.correction.approve': 'হাজিরা সংশোধন অনুমোদন',
  'attendance.own': 'নিজের হাজিরা দেওয়া ও দেখা; সংশোধনের অনুরোধ',
  'attendance.ingest':
    'বায়োমেট্রিক যন্ত্র থেকে হাজিরা পাঠানো (শুধু সার্ভিস কী, কোনো মানুষের দায়িত্ব নয়)',
  'leave.view': 'ছুটি দেখা',
  'leave.manage': 'ছুটির ধরন, জমা ও বছর শেষ পরিচালনা',
  'leave.approve': 'ছুটি অনুমোদন',
  'leave.apply_own': 'নিজের ছুটির আবেদন',
  'payroll.prepare': 'বেতন রান প্রস্তুত করা (মেকার)',
  'payroll.verify': 'বেতন রান যাচাই',
  'payroll.approve': 'বেতন রানের চূড়ান্ত অনুমোদন',
  'payroll.disburse': 'বিতরণ ফাইল তৈরি ও বেতন পরিশোধ চিহ্নিত করা',
  'payslip.view_own': 'নিজের পে-স্লিপ দেখা',
  'payroll.loan.request_own':
    'নিজের জন্য বেতন অগ্রিম চাওয়া ও নিজের অগ্রিম দেখা',
  'data.import': 'স্থানান্তরের ব্যাচ আপলোড, যাচাই, কমিট ও ফেরত নেওয়া',
  'data.import.sign_off':
    'স্থানান্তরের মিলকরণ প্রতিবেদনে স্বাক্ষর (চালুর আগে গ্রাহকের অনুমোদন)',
  'rules.view': 'সরকারি নিয়মের মান, তার সূত্র ও যাচাইয়ের অবস্থা দেখা',
  'rules.accept':
    'কোম্পানি গ্রুপের জন্য একটি রুল প্যাক সংস্করণ নির্দিষ্ট তারিখ থেকে গ্রহণ',
  'approvals.configure': 'অনুমোদনের ধারা নির্ধারণ',
  'approvals.view_all': 'কোম্পানির সব অনুমোদনের আবেদন দেখা',
  'audit.view': 'অডিট লগ পড়া',
  'audit.view_finance': 'অডিট লগের আর্থিক ভুক্তি পড়া',
  'integrations.manage': 'ব্যর্থ বহির্গামী ইভেন্ট দেখা ও আবার পাঠানো',
  'notifications.relay':
    'একটি ইভেন্টের বহির্গামী বার্তা নেওয়া ও ফলাফল জানানো (n8n, শুধু ইভেন্ট কলব্যাক টোকেন দিয়ে)',
  'ledger.view': 'হিসাবের তালিকা, ভাউচার, খতিয়ান ও আর্থিক প্রতিবেদন দেখা',
  'ledger.vouchers.prepare':
    'ভাউচার প্রস্তুত ও জমা (মেকার); বিপরীত ভুক্তি; অপেক্ষমাণ স্বয়ংক্রিয় পোস্টিং',
  'ledger.setup': 'হিসাবের তালিকা, পোস্টিং হিসাব ও অর্থবছর নির্ধারণ',
  'ledger.periods.close': 'হিসাবকাল বন্ধ করা (এরপর শুধু বিপরীত ভুক্তি নেয়)',
  'payables.view': 'সরবরাহকারী, বিল, পরিশোধ, কাটা কর ও বকেয়া দেখা',
  'payables.manage':
    'সরবরাহকারী ও তাদের ব্যাংক হিসাব তৈরি; বিল ও পরিশোধ প্রস্তুত (মেকার)',
  'payables.tax': 'উৎসে কর কাটার সেটিংস, চালান ও সরবরাহকারীকে সনদ',
  'expenses.claim_own': 'নিজের খরচের দাবি (রসিদসহ) ও নিজের নগদ অগ্রিম চাওয়া',
  'expenses.view': 'খরচের দাবি, নগদ অগ্রিম ও কর্মী অগ্রিমের খতিয়ান দেখা',
  'expenses.pay':
    'অনুমোদিত দাবি ও অগ্রিম পরিশোধ, ফেরত ও বেতন থেকে কাটা, খরচের শ্রেণি',
  'procurement.request_own': 'নিজের ক্রয় অনুরোধ দেওয়া ও তার অবস্থা দেখা',
  'procurement.view': 'ক্রয় অনুরোধ, কোটেশন, ক্রয় আদেশ ও প্রাপ্ত মাল দেখা',
  'procurement.manage':
    'কোটেশন লিপিবদ্ধ, তুলনামূলক বিবরণী, ক্রয় আদেশ তৈরি ও ইস্যু, ক্রয়ের সেটিংস',
  'procurement.receive': 'ক্রয় আদেশের বিপরীতে প্রাপ্ত মাল / সেবা লিপিবদ্ধ করা',
  'procurement.override_match':
    'সরবরাহকারীর বিলে তিন-মুখী মিলের গরমিল কারণসহ গ্রহণ',
  'budgets.view': 'বাজেট ও বাজেট বনাম প্রকৃত দেখা',
  'budgets.manage': 'বাজেট ও তার সংশোধন প্রস্তুত, বাজেটের সেটিংস',
  'budgets.request_change': 'বিভাগের বাজেট পরিবর্তনের অনুরোধ',
  'assets.view': 'সম্পদের তালিকা, বরাদ্দ, মেরামত ও অবচয় দেখা',
  'assets.manage':
    'সম্পদ নিবন্ধন, বরাদ্দ, ফেরত, মেরামত ও বিলিবণ্টন; সম্পদের শ্রেণি',
  'assets.depreciate': 'মাসিক অবচয় চালানো ও ফেরত নেওয়া',
  'assets.own': 'নিজের নামে বরাদ্দ সম্পদ দেখা ও স্বীকার করা',
  'stock.view': 'স্টোর, মাল, স্টক ও ইস্যুর অনুরোধ দেখা',
  'stock.manage': 'স্টোর ও মাল রাখা; স্টক গ্রহণ, সমন্বয় ও ইস্যু',
  'stock.request_own': 'নিজের বা নিজের বিভাগের জন্য স্টোর থেকে মাল চাওয়া',
  'bank.view': 'কোম্পানির ব্যাংক হিসাব, আনা বিবরণী, মিল ও মিলকরণ দেখা',
  'bank.reconcile':
    'মিলকরণের জন্য ব্যাংক হিসাব প্রস্তুত; বিবরণী আনা; সারি মেলানো ও মিল ভাঙা',
  'bank.import': 'ব্যাংক বিবরণীর ফাইল পাঠানো (n8n, সার্ভিস কী দিয়ে)',
  'vat.view':
    'ভ্যাট মাল ও হার, বিক্রয় ও ক্রয় রেজিস্টার এবং মাসিক দাখিলপত্র দেখা',
  'vat.manage':
    'ভ্যাট মাল ও হার রাখা; ভ্যাট চালান লিপিবদ্ধ; মাসিক দাখিলপত্র জমা ও ভ্যাট পরিশোধ',
  'compliance.view':
    'পরিপালন ক্যালেন্ডার দেখা (দাখিল, জমা ও নবায়ন এবং তার সময়)',
  'compliance.manage':
    'ক্যালেন্ডারে কাজ যোগ; সম্পন্ন বা প্রযোজ্য নয় চিহ্নিত করা',
  'receivables.view':
    'গ্রাহকের কাছে পাওনা (পুরনো সিস্টেমের চালান) ও তার বয়স দেখা',
  'receivables.manage': 'গ্রাহকের চালানের বিপরীতে প্রাপ্ত টাকা লিপিবদ্ধ করা',
  'crm.view':
    'পরিসরের ভেতরে লিড, গ্রাহক ও তাদের কাজকর্ম দেখা (কোম্পানি বা বিভাগ)',
  'crm.own':
    'নিজের লিড ও গ্রাহক নিয়ে কাজ: লিড যোগ, ফোন ও বৈঠক লেখা, যোগ্যতা যাচাই (বিক্রয়কর্মী)',
  'crm.assign':
    'অন্য বিক্রয়কর্মীকে লিড ও গ্রাহক হস্তান্তর (বিক্রয় প্রধান, অ্যাডমিন)',
  'crm.manage':
    'বিক্রয় এলাকা ও কে তার লিড পাবে তা নির্ধারণ; যেকোনো গ্রাহক সম্পাদনা',
  'crm.credit': 'গ্রাহক দেখা এবং তাদের ঋণসীমা ও পরিশোধের শর্ত নির্ধারণ (হিসাব)',
  'crm.capture':
    'বাইরে থেকে লিড পাঠানো (ওয়েবসাইটের ফর্ম ও ফেসবুক লিড অ্যাড, n8n ও সার্ভিস কী দিয়ে)',
  'sales.catalogue': 'পণ্য, মূল্যতালিকা ও বিক্রয়কর্মীর ছাড়ের সীমা নির্ধারণ',
  'commission.view':
    'কমিশনের নিয়ম, মাসিক হিসাব ও কে কত পেলেন তা দেখা',
  'commission.manage':
    'কমিশনের নিয়ম নির্ধারণ, মাসের হিসাব করা ও বেতনে পাঠানো',
  'ai.sales_assist.use':
    'নিজের লিড ও গ্রাহক নিয়ে বিক্রয় সহকারীকে জিজ্ঞাসা (স্কোর, পরের ধাপ, খসড়া লেখা)',
  'gate3.view':
    'গেট ৩ প্রতিবেদন দেখা: পাইলট নিজের বিক্রয় প্রক্রিয়া ও একটি মূল্যায়ন চক্র চালিয়েছে',
  'performance.own':
    'নিজের মূল্যায়ন: লক্ষ্য দেখা, নিজের পর্যালোচনা লেখা, শেয়ার করা মতামত পড়া',
  'performance.rate':
    'নিজের দলের মূল্যায়ন ও লক্ষ্য নির্ধারণ (বিভাগীয় প্রধান)',
  'performance.view': 'নিজের আওতার মূল্যায়ন, রেটিং ও মতামত দেখা',
  'performance.manage':
    'মূল্যায়ন চক্র, কেপিআই তালিকা, মূল্যায়ন শুরু করা, বিভাগজুড়ে রেটিং সমন্বয়',
  'performance.propose':
    'সমন্বিত মূল্যায়ন থেকে ইনক্রিমেন্ট বা পদোন্নতির প্রস্তাব',
  'recruitment.request_own':
    'নিজের বিভাগে নতুন পদের অনুরোধ করা ও তার অবস্থা দেখা',
  'recruitment.view':
    'জনবল পরিকল্পনা, পদের অনুরোধ, নিয়োগ বিজ্ঞপ্তি, আবেদনকারী ও সাক্ষাৎকার দেখা',
  'recruitment.manage':
    'নিয়োগ বিজ্ঞপ্তি ও প্রচার, আবেদনকারী ও তাদের সিভি, ধাপ, সাক্ষাৎকার ও নিয়োগপত্র',
  'recruitment.interview':
    'যে সাক্ষাৎকারের বোর্ডে আছেন তার মূল্যায়ন দেওয়া',
  'recruitment.plan': 'অর্থবছরের জনবল পরিকল্পনা নির্ধারণ ও অনুমোদন',
  'support.view':
    'নিজের আওতার গ্রাহকদের অভিযোগ ও কাস্টমার ৩৬০ পাতা দেখা',
  'support.own':
    'নিজের ওপর দেওয়া অভিযোগের কাজ: উত্তর, অন্তর্গত নোট, সমাধান, গ্রাহকের কাছে জিজ্ঞাসা',
  'support.manage':
    'অভিযোগ তোলা ও কাউকে দেওয়া, বন্ধ অভিযোগ আবার খোলা, অভিযোগের শ্রেণি ও অগ্রাধিকার অনুযায়ী এসএলএ',
  'ai.assistant.use': 'নিজের প্রবেশাধিকারের ভেতরে এআই সহকারী ব্যবহার',
  'ai.manage':
    'এআই সুবিধা চালু ও বন্ধ; এআই ব্যবহার, কোটা ও উত্তরের মূল্যায়ন দেখা',
  'ai.policies.manage':
    'এআই সহকারী যে নীতিমালার নথি থেকে উত্তর দেয় তা আপলোড ও বাতিল',
};

export function isPermissionKey(value: string): value is PermissionKey {
  return value in PERMISSIONS;
}
