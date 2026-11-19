/**
 * The portal's own explanation of itself: what each screen is for, how its work
 * flows, and the words the home screen, the menu and the search box use.
 *
 * Keys follow lib/portal-guide.ts: 'g.<screen id>.purpose' is one sentence a
 * person with no training can read; 'g.<id>.s1…s4' are the steps that work
 * takes, in order. Keep them short — this text is read while working, not
 * studied.
 */
export const en = {
  // ------------------------------------------------------------- the frame
  "g.what": "What this screen is for",
  "g.how": "How it works",
  "g.next": "Where to next",
  "g.hide": "Hide",
  "g.show": "Guide",
  "g.openSearch": "Search screens",
  "g.searchHint": "Type a screen or a word — salary, leave, VAT, bill",
  "g.noResults": "No screen matches that.",
  "g.menu": "Menu",
  "g.allScreens": "All screens",
  "g.shortcut": "Ctrl + K",
  "g.group.people":
    "Who works here, the structure they sit in, and who may sign in.",
  "g.group.time": "Attendance, leave, and the decisions waiting on someone.",
  "g.group.payroll":
    "From the month’s inputs to a paid salary, with the checks in between.",
  "g.group.crm": "Enquiries, deals, and what is sold to customers.",
  "g.group.hiring":
    "Posts the company may fill, who applied, and how they were judged.",
  "g.group.finance": "The ledger and everything that posts into it.",
  "g.group.admin": "Settings, data, and the record of what happened.",

  // -------------------------------------------------------------- dashboard
  "g.dashboard.purpose":
    "Your starting point: how far this company’s setup has got, and what is waiting for you today.",
  "g.dashboard.s1":
    "The setup list shows what the company still needs before payroll can run. Each line opens the screen that finishes it.",
  "g.dashboard.s2":
    "“Needs your attention” counts only work your own role can act on — so two people in one company see different lists.",
  "g.dashboard.s3":
    "Reach any screen from the menu on the left, or by searching with Ctrl + K. Every screen explains itself at the top.",

  // ----------------------------------------------------------------- people
  "g.employees.purpose":
    "The people register: who works here, in which department, on what salary, and in what state — probation, active, notice or separated.",
  "g.employees.s1":
    "Add a person with “New employee”: code, name and join date, then the first assignment (branch, department, designation, grade).",
  "g.employees.s2":
    "A new record starts as a draft. It becomes active once the assignment and the salary are in place, which is when payroll can pick it up.",
  "g.employees.s3":
    "Open a person for their tabs: job history, salary, leave balance, attendance and consent, bank account, documents.",
  "g.employees.s4":
    "Changes that touch money — salary, bank account — are saved as an approval request, not applied straight away.",

  "g.lifecycle.purpose":
    "The stages a person passes through: joining, probation confirmation, transfer, resignation and final settlement — and the papers (contracts, NID, licences) whose expiry date is about to pass.",
  "g.lifecycle.s1":
    "Onboarding: the checklist for a new joiner — documents, login, phone, bank account.",
  "g.lifecycle.s2":
    "Probation: a review before the probation end date. Confirming turns the person from probation to active.",
  "g.lifecycle.s3":
    "Transfer or promotion: a new assignment from a date. The old one is closed and the job history keeps both.",
  "g.lifecycle.s4":
    "Resignation: last working day, clearance from each department, then the final settlement run in payroll.",

  "g.organization.purpose":
    "The company’s shape — branches, departments, designations and grades. People, attendance, approvals and reports all hang on these.",
  "g.organization.s1":
    "Branch: a place of work, with its weekend days and the holiday calendar it follows.",
  "g.organization.s2":
    "Departments form a tree. Access scopes and approval routes follow it, so whoever covers a department also covers everything under it.",
  "g.organization.s3":
    "Designation is the job title; grade is the pay band, and it decides overtime eligibility and salary limits.",
  "g.organization.s4":
    "Nothing is deleted — set it inactive instead, so old records keep their meaning.",

  "g.users.purpose":
    "Logins and what each login may do: open one, give roles within a scope (with an end date where the role needs one), set a new password, and close it on the last working day.",
  "g.users.s1":
    "A login is a separate thing from an employee record. Link the two so the person can use the employee app as themselves.",
  "g.users.s2":
    "A role is given in a scope — the whole company, one branch, or one department and everything beneath it.",
  "g.users.s3":
    "Two-step verification is required for privileged roles; the user sets it up the first time they sign in.",
  "g.users.s4":
    "Delegation hands someone else an approval inbox for a period, without handing over the role itself.",

  // ------------------------------------------------------------------- time
  "g.attendance.purpose":
    "Each day’s attendance for every employee, the shifts and holidays behind it, and the monthly lock that payroll depends on.",
  "g.attendance.s1":
    "Day: punches from the phone, a biometric device or a manual correction, with the status the rules worked out — present, late, half day, absent.",
  "g.attendance.s2":
    "Shifts and holidays: start and end time, grace minutes, the half-day limit, and the holiday calendar each branch follows.",
  "g.attendance.s3":
    "Phones: a phone has to be approved here before its punches count, and stopped here on the last working day or when it is lost.",
  "g.attendance.s4":
    "Lock the month when it is correct. Payroll uses locked months only; a change after the lock becomes an adjustment in the next run.",

  "g.leave.purpose":
    "Leave types and the policy behind them, who is away and when, and the days paid out at year end. One person’s balance is on their own leave tab.",
  "g.leave.s1":
    "Leave types: CL, SL, EL and the rest — days a year, paid or unpaid, how they build up, and what happens to what is left at year end.",
  "g.leave.s2":
    "Policy: when the leave year starts, the sandwich rule, how far back an application may reach, and the team-absence warning.",
  "g.leave.s3":
    "Applications arrive from the employee app and follow their approval chain; a decision writes the balance at once.",
  "g.leave.s4":
    "Encashment turns unused days into money and waits for the next payroll run to pay it.",

  "g.approvals.purpose":
    "One inbox for every kind of request waiting on your decision, with the full history of what was decided and by whom.",
  "g.approvals.s1":
    "Open a request to see what would change, who asked, the whole chain of people who must agree and where it has reached, and every comment so far.",
  "g.approvals.s2":
    "Approve, reject, or return it for correction. Returning sends it back to the requester instead of ending it.",
  "g.approvals.s3":
    "A request moves on only when its current step is complete; the final step is what actually applies the change.",
  "g.approvals.s4":
    "Nothing is applied silently — the decision, the time and the device are kept in the audit log.",

  // ---------------------------------------------------------------- payroll
  "g.runs.purpose":
    "Salary, bonus and final settlement runs: prepare, check, approve, then pay.",
  "g.runs.s1":
    "Create the run for a month. It gathers locked attendance, approved leave, this month’s items and each person’s salary.",
  "g.runs.s2":
    "Calculate, then read the flags: anyone whose net pay moved more than the allowed percent, and anything missing.",
  "g.runs.s3":
    "One person prepares, a second verifies, a third approves. The same person cannot do two of those steps.",
  "g.runs.s4":
    "After approval, Accounts disburses: the bank file is produced and payslips appear in the employee app.",

  "g.items.purpose":
    "Amounts that belong to one month only: overtime, an allowance, a deduction, an advance recovery, arrears.",
  "g.items.s1":
    "Add items while the run is still a draft; a run that is already calculated must be recalculated to pick them up.",
  "g.items.s2":
    "Each item names the employee, the salary head and the amount, with a reason that goes to the audit log.",
  "g.items.s3":
    "Something that repeats every month belongs in the salary structure, not here.",

  "g.payrollSetup.purpose":
    "The rules payroll calculates with: salary heads, structures, rounding, PF, the overtime basis and the flag limit.",
  "g.payrollSetup.s1":
    "Salary heads are the lines of a payslip — basic, house rent, medical, PF, tax.",
  "g.payrollSetup.s2":
    "A structure says how each head is worked out: a percent of basic, a fixed amount, or a rule from the rule pack.",
  "g.payrollSetup.s3":
    "Settings decide rounding, the unpaid-day basis (calendar, 30 or 26 days), the overtime hour basis and the PF percents.",
  "g.payrollSetup.s4":
    "A changed structure applies from the next run; runs already calculated keep the rules they were calculated with.",

  "g.gate1.purpose":
    "The proof that this system matches the old one: the old register for a month, compared with the ERP’s run, with every difference explained.",
  "g.gate1.s1":
    "Upload the old payroll register against a calculated run for the same month.",
  "g.gate1.s2":
    "The comparison lists every employee whose figures differ by more than the tolerance.",
  "g.gate1.s3":
    "HR explains each difference; Accounts — someone other than the person who uploaded it — accepts the month.",
  "g.gate1.s4":
    "Three accepted months pass Gate 1, which is when payroll may stop running in parallel with the old system.",

  // ------------------------------------------------------------ CRM / sales
  "g.leads.purpose":
    "Enquiries that are not customers yet: who they are, where they came from, and who is following up.",
  "g.leads.s1":
    "A lead holds a name, a contact and a source; the website enquiry form creates them by itself.",
  "g.leads.s2":
    "Give every lead an owner — a lead with no owner is nobody’s work.",
  "g.leads.s3":
    "Qualifying a lead turns it into a customer, and usually into an opportunity.",

  "g.customers.purpose":
    "Your customers: contacts, addresses, credit limit and payment terms, and everything sold to them.",
  "g.customers.s1":
    "Quotations, orders, invoices and receipts all use this one record, so names and TINs stay consistent.",
  "g.customers.s2":
    "The credit limit and payment terms are checked when an order or an invoice is raised.",
  "g.customers.s3":
    "The ledger tab shows what has been billed, what is paid, and what is overdue.",

  "g.tickets.purpose":
    "What customers have complained about or asked for, with the clock the service promise is measured on.",
  "g.tickets.s1":
    "Every ticket belongs to a customer and to one person; the category sets how urgent it starts out.",
  "g.tickets.s2":
    "Two clocks run in working hours: the first reply to the customer, and the resolution. Waiting for the customer stops the resolution clock.",
  "g.tickets.s3":
    "A missed deadline is raised by itself, once, and goes to the person holding the ticket (and the Admin for an urgent one).",

  "g.commission.purpose":
    "What each salesperson earned this month, worked out from the invoices or the money collected.",
  "g.commission.s1":
    "One scheme at a time: the basis, the rate, and an optional better rate above target.",
  "g.commission.s2":
    "Every line keeps the receipts or invoices it came from, so a figure can be argued with.",
  "g.commission.s3":
    "Posting writes one payroll item per person; cancelling the run cancels those items with it.",

  "g.gate3.purpose":
    "Whether this pilot has actually run its sales pipeline and one appraisal cycle in the system.",
  "g.gate3.s1":
    "Each check says what has to be true and the numbers behind the answer.",
  "g.gate3.s2":
    "A check that is not met is shown as not met: the page never rounds up to \u201cready\u201d.",
  "g.gate3.s3":
    "Passing Gate 3 is a human decision, taken with this report in hand.",

  "g.cycles.purpose":
    "Appraisal cycles: goals, self-review, the manager\u2019s rating, HR\u2019s calibration, and what they lead to.",
  "g.cycles.s1":
    "A cycle moves forward one phase at a time, and never back: ratings and proposals already depend on it.",
  "g.cycles.s2":
    "Goals carry weights that add up to 100, so the score means the same thing for everyone.",
  "g.cycles.s3":
    "HR calibrates across departments before any increment is proposed \u2014 one department rating everyone 5 is not a company-wide 5.",
  "g.cycles.s4":
    "An approved increment becomes an effective-dated salary; payroll pays any arrears by itself.",

  "g.myTeamAppraisals.purpose":
    "The appraisals of the people who report to you: their goals, their self-review, your rating.",
  "g.myTeamAppraisals.s1":
    "Write the goals from the KPI library so two managers measuring the same job measure the same things.",
  "g.myTeamAppraisals.s2":
    "The weighted score is a suggestion; the rating you give is the one that is stored.",
  "g.myTeamAppraisals.s3":
    "The AI draft is built from the year\u2019s feedback and rates nobody: rewrite it in your own words.",

  "g.incrementProposals.purpose":
    "What the appraisal round led to: increments, promotions, and where each one stands.",
  "g.incrementProposals.s1":
    "A proposal needs a calibrated rating first \u2014 that is the point of calibration.",
  "g.incrementProposals.s2":
    "The Admin approves it, and HR then applies it.",
  "g.incrementProposals.s3":
    "Applying it writes the salary from its date; a back-dated one is paid as arrears in the next payroll, with no extra entry.",

  "g.openings.purpose":
    "Posts being recruited for right now, and the people who applied for each one.",
  "g.openings.s1":
    "An opening exists only for an approved post, so it can always be traced back to who allowed it.",
  "g.openings.s2":
    "Record where it was advertised; that is what tells you which channel actually brings people.",
  "g.openings.s3":
    "The screening score sorts the pile; the reasons are there so you can disagree with it.",

  "g.positions.purpose":
    "Requests for a new post: what is asked for, what the manpower plan allows, and who approved it.",
  "g.positions.s1":
    "A Dept Head asks; HR checks the plan and the terms; the Admin decides the money.",
  "g.positions.s2":
    "A request outside the plan is not refused \u2014 it is marked, and the approvers see exactly why.",
  "g.positions.s3":
    "Once approved, HR opens it for hiring, and the opening carries the approval with it.",

  "g.manpowerPlan.purpose":
    "How many posts of each designation each department may have this fiscal year.",
  "g.manpowerPlan.s1":
    "The plan is the budget for people: posts in use, posts asked for, posts left.",
  "g.manpowerPlan.s2":
    "An approved plan is not edited; next year gets its own.",

  "g.myInterviews.purpose":
    "The interviews you are on the panel of, and the scorecard only you can give.",
  "g.myInterviews.s1":
    "Each panel member gives their own card: nobody scores on someone else\u2019s behalf.",
  "g.myInterviews.s2":
    "HR records what the round decided after the cards are in.",

  "g.opportunities.purpose":
    "Deals being worked on: value, stage, expected close date, and the chance of winning.",
  "g.opportunities.s1":
    "Each stage carries a probability, and the forecast is built from it.",
  "g.opportunities.s2":
    "Move a deal on when something real happened — a quotation sent, a demo done — not by feel.",
  "g.opportunities.s3":
    "A won deal leads to a quotation or an order; a lost one keeps its reason, which is what makes the pipeline worth reading.",

  "g.forecast.purpose":
    "What the pipeline is expected to bring in against the target, by owner and territory.",

  "g.quotations.purpose":
    "Priced offers to a customer, with validity, discount and the terms attached.",
  "g.quotations.s1":
    "Build the quotation from the catalogue, so prices and VAT come out right.",
  "g.quotations.s2":
    "Send it with a validity date; a discount past the allowed limit needs approval first.",
  "g.quotations.s3":
    "An accepted quotation becomes a sales order in one step, with nothing retyped.",

  "g.orders.purpose":
    "Confirmed customer orders: what was promised, what has been delivered, and what is still to invoice.",
  "g.orders.s1":
    "The order holds the agreed quantity and price, and stock is committed as lines are delivered.",
  "g.orders.s2":
    "Deliver in parts when you must — each delivery can be invoiced on its own.",
  "g.orders.s3":
    "An order stays open until every line is both delivered and invoiced.",

  "g.catalogue.purpose":
    "The things you sell: code, description, unit, price list and VAT treatment.",
  "g.territories.purpose":
    "Who covers which area or customer group, and the target each one carries.",

  // ---------------------------------------------------------------- finance
  "g.financeHome.purpose":
    "The ledger at a glance: which periods are open, what was posted recently, and what still has to pass before a month can close.",
  "g.financeHome.s1":
    "Every money movement anywhere in the system ends up here as a journal entry.",
  "g.financeHome.s2":
    "Entries are grouped into vouchers, and a voucher must balance before it can be posted.",
  "g.financeHome.s3":
    "A closed month cannot be posted into; corrections go into the open month.",

  "g.vouchers.purpose":
    "Journal entries, by hand or raised by another module: payment, receipt, journal and contra vouchers.",
  "g.vouchers.s1":
    "A voucher is drafted, checked, then posted. Only a posted voucher reaches the ledger.",
  "g.vouchers.s2":
    "Debits must equal credits, and each line needs an account — and a cost centre where one is required.",
  "g.vouchers.s3":
    "A posted voucher is never edited. Reverse it and post a correct one, so the trail stays whole.",

  "g.accounts.purpose":
    "The chart of accounts: the tree of ledger accounts, what type each one is, and what posts into it.",
  "g.reports.purpose":
    "Trial balance, ledger, profit and loss, and balance sheet for any period.",

  "g.close.purpose":
    "The month-end checklist: what must be finished, what is still open, and the sign-off that closes the month.",
  "g.close.s1":
    "The list holds each check — bank reconciled, VAT return filed, payroll posted, depreciation run.",
  "g.close.s2":
    "Tick them off in any order, but the month only closes when every one of them is done.",
  "g.close.s3":
    "Closing locks the period; after that, a correction belongs to the next month.",

  "g.gate2.purpose":
    "Whether this company’s books are really running in the ERP: the opening balances, a closed month, and the old system agreeing with ours.",
  "g.gate2.s1":
    "Each criterion says what has to be true, and the figures behind the answer.",
  "g.gate2.s2":
    "The work that moves the gate is done on the month-end close and the opening-balances screens.",
  "g.gate2.s3":
    "Passing Gate 2 is a human decision, taken with this report in hand.",

  "g.opening.purpose":
    "The balances this company starts from in the ERP, imported once and signed off.",
  "g.vendors.purpose":
    "Suppliers: contact, TIN and VAT registration, bank details, and what is owed to them.",

  "g.procurement.purpose":
    "Buying: a requisition, its approval, the purchase order, what was received, and the bill that follows.",
  "g.procurement.s1":
    "A requisition asks for something, and is checked against the department’s budget before it can be approved.",
  "g.procurement.s2":
    "An approved requisition becomes a purchase order to a vendor.",
  "g.procurement.s3":
    "Receiving records what actually arrived; the bill is then matched against the order and that receipt.",

  "g.budgets.purpose":
    "What each department may spend under each head, and how much of it is already used or committed.",
  "g.assets.purpose":
    "Fixed assets: what was bought, who holds it, what it is worth now, and the depreciation posted.",
  "g.stock.purpose":
    "Stores and stock items: what is on hand, what moved, and the issue requests waiting.",

  "g.bills.purpose":
    "Vendor bills: what is due, what tax is deducted at source, and what has been paid.",
  "g.bills.s1":
    "A bill carries the vendor, the amount, the VAT, and the tax deducted at source.",
  "g.bills.s2":
    "Approval comes before payment; the payment then posts to the ledger and the bank account.",
  "g.bills.s3":
    "Tax deducted at source is held here and reported from the Tax screen.",

  "g.invoices.purpose":
    "Customer invoices: what was billed, the VAT on it, and what is still unpaid.",
  "g.invoices.s1":
    "Raise the invoice from a sales order or on its own; the VAT treatment comes from the catalogue.",
  "g.invoices.s2":
    "A posted invoice reaches the ledger and the customer’s account at once.",
  "g.invoices.s3":
    "Receipts are allocated against invoices, oldest first unless you choose otherwise.",

  "g.receipts.purpose":
    "Money received from customers, and which invoices each receipt settles.",
  "g.receivables.purpose":
    "What customers owe, by age, with the follow-up noted against each overdue amount.",

  "g.bank.purpose":
    "Company bank accounts, their statements, and the reconciliation against the ledger.",
  "g.bank.s1": "Import or enter the statement for a period.",
  "g.bank.s2":
    "Match statement lines against ledger entries; whatever stays unmatched is what needs explaining.",
  "g.bank.s3":
    "A reconciled period is one of the checks the month-end close asks for.",

  "g.tax.purpose":
    "Tax deducted at source: what was withheld, the challan it was deposited with, and the certificate issued.",

  "g.vat.purpose":
    "VAT: items and their rates, the sales record, and the return for the period.",
  "g.vat.s1":
    "Each catalogue item carries a VAT rate, and sales pick it up automatically.",
  "g.vat.s2": "The return adds up output and input VAT for the period.",
  "g.vat.s3": "File it, then keep the acknowledgement against that period.",

  "g.compliance.purpose":
    "Filings and renewals that have a deadline: what is due, what is done, and the proof kept against each.",

  "g.expenses.purpose":
    "Employee expense claims and advances: what was spent, what is approved, and what is paid back.",
  "g.expenses.s1":
    "A claim comes in from the employee app with its bills attached.",
  "g.expenses.s2":
    "The approval route follows the amount — a larger claim goes further up.",
  "g.expenses.s3":
    "An approved claim is paid with salary or on its own, and any advance it settles is adjusted.",

  // ---------------------------------------------------------- administration
  "p.nav.chains": "Approval chains",
  "g.approvalChains.purpose":
    "Who approves what: the steps each kind of request has to pass through.",
  "g.approvalChains.s1":
    "A chain belongs to a request type — leave, salary change, bill, purchase order — and may carry conditions on amount, department or grade.",
  "g.approvalChains.s2":
    "A step names its approvers by role and scope, never by person, so the chain survives people leaving.",
  "g.approvalChains.s3":
    "Priority decides which chain wins when more than one matches; the built-in chain is the fallback.",
  "g.approvalChains.s4":
    "Editing a chain does not disturb requests already in flight — they finish on the chain they started on.",

  "g.migration.purpose":
    "Bringing the old system’s data in: upload a file, see what failed and why, fix it, and sign the batch off.",
  "g.migration.s1":
    "Download the template for what you are importing — employees, salaries, balances, attendance history.",
  "g.migration.s2":
    "Upload it. Every row is checked first, and nothing is written until the whole batch is accepted.",
  "g.migration.s3":
    "The report names each rejected row with its reason, so you can fix the file and upload again.",
  "g.migration.s4":
    "Someone other than the uploader signs the batch off, and that sign-off is what makes the data official.",

  "g.ai.purpose":
    "The AI assistant: which models are allowed, what they may read, and what every question cost.",
  "g.ai.s1":
    "A policy says which roles may ask, and which of this company’s data the assistant may read.",
  "g.ai.s2":
    "The assistant answers from this company’s data only, and never changes anything by itself.",
  "g.ai.s3":
    "Every question and answer is logged with its cost, so usage can be checked later.",

  "g.audit.purpose":
    "Who did what, when, and from where — the record nobody can edit.",
  "g.audit.s1": "Filter by entity, action, person or date.",
  "g.audit.s2":
    "Each entry keeps what the record looked like before and after the change.",
  "g.audit.s3":
    "Entries are chained by hash, so an entry that was removed or altered can be detected.",

  "g.integrations.purpose":
    "Connections to the outside: notification channels, webhooks, service keys, and failed messages to replay.",
  "g.integrations.s1":
    "Channels are what send SMS, e-mail and push; test one before relying on it.",
  "g.integrations.s2":
    "A service key belongs to a machine, not a person, and carries only the permissions it needs.",
  "g.integrations.s3":
    "Outgoing messages that failed land in a dead-letter list: fix the cause, then replay them.",

  // ----------------------------------------------------------- home sections
  "p.home.setup": "Company setup",
  "p.home.setupHint":
    "{done} of {total} done. Finish these before payroll runs.",
  "p.home.setupComplete": "Setup is complete — nothing is missing.",
  "p.home.attention": "Needs your attention",
  "p.home.attentionNone": "Nothing is waiting for you right now.",
  "p.home.quick": "Common tasks",
  "p.home.todo": "To do",
  "p.home.numbers": "Numbers",
  "p.home.setup.branches": "At least one branch",
  "p.home.setup.departments": "Departments",
  "p.home.setup.designations": "Designations",
  "p.home.setup.grades": "Grades (pay bands)",
  "p.home.setup.shifts": "Shifts",
  "p.home.setup.holidays": "Holiday calendar",
  "p.home.setup.leaveTypes": "Leave types",
  "p.home.setup.employees": "Employees",
  "p.home.setup.structures": "Salary structures",
  "p.home.setup.salaries": "A salary for every employee",
  "p.home.setup.users": "Logins for the office staff",
  "p.home.setup.firstRun": "First payroll run",
  "p.home.setup.gate1": "Gate 1: three months matched",
  "p.home.setup.missing": "{n} missing",
  "p.home.task.approvals": "{n} request(s) waiting for your decision",
  "p.home.task.phones": "{n} employee phone(s) waiting for approval",
  "p.home.task.bankAccounts": "{n} salary account change(s) waiting",
  "p.home.task.leaveRequests": "{n} leave application(s) pending",
  "p.home.task.probation": "{n} probation(s) ending within 30 days",
  "p.home.task.attendanceLock": "Last month’s attendance is not locked yet",
  "p.home.task.openRuns": "{n} payroll run(s) not yet paid",
  "p.home.task.documentExpiry":
    "{n} document(s) expired or expiring within 30 days",
  "p.home.quick.employee": "Add an employee",
  "p.home.quick.run": "Open payroll runs",
  "p.home.quick.attendance": "Check attendance",
  "p.home.quick.leave": "Leave applications",
  "p.home.quick.user": "Invite a user",
  "p.home.quick.voucher": "New voucher",
  "p.home.quick.claim": "Expense claims",
  "g.empty.employees": "No employees yet.",
  "g.empty.employeesHint":
    "Add the first person here, or bring the old list in from Data migration.",
  "g.empty.search": "Nothing matches this search.",
  "g.empty.searchHint":
    "Clear the search box and the filters to see everyone again.",
} as const;

export type GuideKey = keyof typeof en;

export const bn: Record<GuideKey, string> = {
  // ---------------------------------------------------------------- the frame
  "g.what": "এই পর্দা কী কাজে লাগে",
  "g.how": "কীভাবে কাজ করে",
  "g.next": "এরপর কোথায়",
  "g.hide": "লুকান",
  "g.show": "নির্দেশিকা",
  "g.openSearch": "পর্দা খুঁজুন",
  "g.searchHint": "পর্দার নাম বা একটি শব্দ লিখুন — বেতন, ছুটি, ভ্যাট, বিল",
  "g.noResults": "এমন কোনো পর্দা নেই।",
  "g.menu": "মেনু",
  "g.allScreens": "সব পর্দা",
  "g.shortcut": "Ctrl + K",
  "g.group.people": "কারা কাজ করেন, কোন কাঠামোয় আছেন, আর কে লগইন করতে পারেন।",
  "g.group.time": "হাজিরা, ছুটি, আর যে সিদ্ধান্তগুলো কারও অপেক্ষায় আছে।",
  "g.group.payroll": "মাসের তথ্য থেকে বেতন পরিশোধ পর্যন্ত, মাঝের সব যাচাই সহ।",
  "g.group.crm": "অনুসন্ধান, সম্ভাব্য বিক্রি, আর ক্রেতার কাছে যা বিক্রি হয়।",
  "g.group.hiring":
    "কোন পদ পূরণ করা যাবে, কে আবেদন করলেন, আর কীভাবে বিচার হলো।",
  "g.group.finance": "হিসাবের খতিয়ান আর যা কিছু এখানে এসে জমা হয়।",
  "g.group.admin": "সেটিংস, তথ্য, আর কী ঘটেছে তার রেকর্ড।",

  // ----------------------------------------------------------------- dashboard
  "g.dashboard.purpose":
    "শুরুর জায়গা: কোম্পানির সেটআপ কতদূর হয়েছে, আর আজ আপনার জন্য কী অপেক্ষা করছে।",
  "g.dashboard.s1":
    "সেটআপ তালিকায় দেখা যায় বেতন চালানোর আগে কোম্পানির আর কী কী দরকার। প্রতিটি লাইন থেকে সেই পর্দায় যাওয়া যায়।",
  "g.dashboard.s2":
    "“আপনার মনোযোগ দরকার”-এ কেবল আপনার দায়িত্বের কাজ গোনা হয় — তাই এক কোম্পানির দুজন ভিন্ন তালিকা দেখেন।",
  "g.dashboard.s3":
    "বাঁ দিকের মেনু থেকে, বা Ctrl + K চেপে খুঁজে যেকোনো পর্দায় যান। প্রতিটি পর্দা উপরে নিজের কাজ বুঝিয়ে দেয়।",

  // -------------------------------------------------------------------- people
  "g.employees.purpose":
    "কর্মীদের তালিকা: কে কাজ করেন, কোন বিভাগে, কত বেতনে, আর কোন অবস্থায় — শিক্ষানবিশ, কর্মরত, নোটিশে বা বিদায়ী।",
  "g.employees.s1":
    "“নতুন কর্মী” দিয়ে যোগ করুন: কোড, নাম, যোগদানের তারিখ, তারপর প্রথম পদায়ন (শাখা, বিভাগ, পদ, গ্রেড)।",
  "g.employees.s2":
    "নতুন রেকর্ড খসড়া হিসেবে শুরু হয়। পদায়ন ও বেতন ঠিক হলে কর্মরত হয়, তখনই বেতনে ধরা পড়ে।",
  "g.employees.s3":
    "কোনো কর্মীর নাম খুললে ট্যাব পাওয়া যায়: চাকরির ইতিহাস, বেতন, ছুটির স্থিতি, হাজিরা ও সম্মতি, ব্যাংক হিসাব, কাগজপত্র।",
  "g.employees.s4":
    "টাকার সঙ্গে জড়িত পরিবর্তন — বেতন, ব্যাংক হিসাব — সঙ্গে সঙ্গে বসে না, অনুমোদনের আবেদন হিসেবে জমা হয়।",

  "g.lifecycle.purpose":
    "একজন কর্মী যে ধাপগুলো পার করেন: যোগদান, শিক্ষানবিশকাল নিশ্চিতকরণ, বদলি, পদত্যাগ ও চূড়ান্ত হিসাব — আর যে কাগজপত্রের (চুক্তি, এনআইডি, লাইসেন্স) মেয়াদ শেষ হতে চলেছে।",
  "g.lifecycle.s1":
    "যোগদান: নতুন কর্মীর চেকলিস্ট — কাগজপত্র, লগইন, ফোন, ব্যাংক হিসাব।",
  "g.lifecycle.s2":
    "শিক্ষানবিশকাল: শেষ তারিখের আগে পর্যালোচনা। নিশ্চিত করলে কর্মী শিক্ষানবিশ থেকে কর্মরত হন।",
  "g.lifecycle.s3":
    "বদলি বা পদোন্নতি: একটি তারিখ থেকে নতুন পদায়ন। পুরোনোটি বন্ধ হয়, আর চাকরির ইতিহাসে দুটোই থাকে।",
  "g.lifecycle.s4":
    "পদত্যাগ: শেষ কর্মদিবস, প্রতিটি বিভাগের ছাড়পত্র, তারপর বেতনে চূড়ান্ত হিসাবের রান।",

  "g.organization.purpose":
    "কোম্পানির কাঠামো — শাখা, বিভাগ, পদ ও গ্রেড। কর্মী, হাজিরা, অনুমোদন ও রিপোর্ট সবই এর উপর দাঁড়ানো।",
  "g.organization.s1":
    "শাখা: কাজের জায়গা, সঙ্গে সাপ্তাহিক ছুটির দিন ও যে ছুটির ক্যালেন্ডার মানা হয়।",
  "g.organization.s2":
    "বিভাগগুলো গাছের মতো সাজানো। প্রবেশাধিকার ও অনুমোদনের পথ এই গাছ মেনে চলে — যিনি উপরের বিভাগ দেখেন, তার নিচের সবও পড়ে।",
  "g.organization.s3":
    "পদ হলো কাজের নাম; গ্রেড হলো বেতনের ধাপ, আর এটিই ওভারটাইমের যোগ্যতা ও বেতনের সীমা ঠিক করে।",
  "g.organization.s4":
    "কিছুই মোছা হয় না — নিষ্ক্রিয় করে দিন, তাতে পুরোনো রেকর্ডের মানে ঠিক থাকে।",

  "g.users.purpose":
    "লগইন আর কে কী করতে পারবেন: নতুন লগইন খোলা, নির্দিষ্ট পরিধিতে ভূমিকা দেওয়া (দরকার হলে শেষ তারিখসহ), নতুন পাসওয়ার্ড দেওয়া, আর শেষ কর্মদিবসে লগইন বন্ধ করা।",
  "g.users.s1":
    "লগইন আর কর্মী-রেকর্ড আলাদা জিনিস। দুটি জুড়ে দিলে কর্মী নিজের নামে অ্যাপ ব্যবহার করতে পারেন।",
  "g.users.s2":
    "ভূমিকা একটি পরিধিতে দেওয়া হয় — পুরো কোম্পানি, একটি শাখা, বা একটি বিভাগ ও তার নিচের সব।",
  "g.users.s3":
    "ক্ষমতাসম্পন্ন ভূমিকার জন্য দুই-ধাপ যাচাই বাধ্যতামূলক; ব্যবহারকারী প্রথম লগইনেই তা ঠিক করে নেন।",
  "g.users.s4":
    "অর্পণে একটি সময়ের জন্য অনুমোদনের ইনবক্স অন্যকে দেওয়া হয়, ভূমিকা নিজে হাতবদল হয় না।",

  // ---------------------------------------------------------------------- time
  "g.attendance.purpose":
    "প্রতিদিনের হাজিরা, তার পেছনের শিফট ও ছুটির দিন, আর বেতনের জন্য দরকারি মাসিক লক।",
  "g.attendance.s1":
    "দিন: ফোন, বায়োমেট্রিক যন্ত্র বা হাতে সংশোধন থেকে আসা পাঞ্চ, সঙ্গে নিয়ম অনুযায়ী ঠিক হওয়া অবস্থা — উপস্থিত, দেরি, অর্ধদিবস, অনুপস্থিত।",
  "g.attendance.s2":
    "শিফট ও ছুটি: শুরু-শেষের সময়, ছাড়ের মিনিট, অর্ধদিবসের সীমা, আর প্রতিটি শাখার ছুটির ক্যালেন্ডার।",
  "g.attendance.s3":
    "ফোন: পাঞ্চ গোনার আগে ফোনটি এখানে অনুমোদন পেতে হয়, আর শেষ কর্মদিবসে বা ফোন হারালে এখানেই বন্ধ করতে হয়।",
  "g.attendance.s4":
    "মাস ঠিক থাকলে লক করুন। বেতন কেবল লক করা মাস ব্যবহার করে; লকের পরের পরিবর্তন পরের রানে সমন্বয় হয়ে আসে।",

  "g.leave.purpose":
    "ছুটির ধরন ও তার নীতি, কে কখন ছুটিতে, আর বছর শেষে নগদ হওয়া দিন। একজনের স্থিতি তার নিজের ছুটির ট্যাবে।",
  "g.leave.s1":
    "ছুটির ধরন: CL, SL, EL ও অন্যগুলো — বছরে কত দিন, বেতনসহ কি না, কীভাবে জমে, আর বছর শেষে বাকিটার কী হয়।",
  "g.leave.s2":
    "নীতি: ছুটির বছর কখন শুরু, স্যান্ডউইচ নিয়ম, কত দিন পেছনে আবেদন চলে, আর দলের অনুপস্থিতির সতর্কতা।",
  "g.leave.s3":
    "আবেদন কর্মীর অ্যাপ থেকে আসে এবং নিজের অনুমোদন-ধারা মেনে চলে; সিদ্ধান্ত হলে স্থিতি সঙ্গে সঙ্গে বদলায়।",
  "g.leave.s4":
    "নগদায়নে অব্যবহৃত দিন টাকায় রূপ নেয় এবং পরের বেতন রানের অপেক্ষায় থাকে।",

  "g.approvals.purpose":
    "আপনার সিদ্ধান্তের অপেক্ষায় থাকা সব ধরনের আবেদনের একটিই ইনবক্স, সঙ্গে কে কী সিদ্ধান্ত নিয়েছেন তার পূর্ণ ইতিহাস।",
  "g.approvals.s1":
    "আবেদন খুললে দেখা যায় কী বদলাবে, কে চেয়েছেন, কাদের সম্মতি দরকার ও কোন ধাপে আছে, আর এতক্ষণের সব মন্তব্য।",
  "g.approvals.s2":
    "অনুমোদন, নাকচ, বা সংশোধনের জন্য ফেরত দিন। ফেরত দিলে আবেদন শেষ হয় না, আবেদনকারীর কাছে ফিরে যায়।",
  "g.approvals.s3":
    "চলতি ধাপ শেষ হলেই আবেদন পরের ধাপে যায়; শেষ ধাপেই পরিবর্তনটি সত্যিকারে বসে।",
  "g.approvals.s4":
    "কিছুই চুপচাপ বসে না — সিদ্ধান্ত, সময় ও যন্ত্রের তথ্য নিরীক্ষা লগে থাকে।",

  // ------------------------------------------------------------------- payroll
  "g.runs.purpose":
    "বেতন, বোনাস ও চূড়ান্ত হিসাবের রান: প্রস্তুতি, যাচাই, অনুমোদন, তারপর পরিশোধ।",
  "g.runs.s1":
    "মাসের জন্য রান তৈরি করুন। এটি লক করা হাজিরা, অনুমোদিত ছুটি, মাসের এন্ট্রি ও প্রত্যেকের বেতন একসঙ্গে নেয়।",
  "g.runs.s2":
    "হিসাব করে ফ্ল্যাগগুলো পড়ুন: কার নিট বেতন অনুমোদিত শতাংশের বেশি বদলেছে, আর কী কী বাদ পড়েছে।",
  "g.runs.s3":
    "একজন প্রস্তুত করেন, দ্বিতীয়জন যাচাই করেন, তৃতীয়জন অনুমোদন দেন। একজন এর দুটি ধাপ করতে পারেন না।",
  "g.runs.s4":
    "অনুমোদনের পর হিসাব বিভাগ পরিশোধ করে: ব্যাংক ফাইল তৈরি হয় আর পে-স্লিপ কর্মীর অ্যাপে চলে যায়।",

  "g.items.purpose":
    "কেবল এক মাসের জন্য প্রযোজ্য টাকা: ওভারটাইম, ভাতা, কাটতি, অগ্রিম আদায়, বকেয়া।",
  "g.items.s1":
    "রান খসড়া থাকা অবস্থায় এন্ট্রি যোগ করুন; হিসাব হয়ে যাওয়া রানে ধরতে হলে আবার হিসাব করতে হবে।",
  "g.items.s2":
    "প্রতিটি এন্ট্রিতে কর্মী, বেতনের খাত ও টাকার অঙ্ক থাকে, সঙ্গে কারণ — যা নিরীক্ষা লগে যায়।",
  "g.items.s3": "যা প্রতি মাসেই আসে, তা এখানে নয়, বেতন-কাঠামোতে রাখুন।",

  "g.payrollSetup.purpose":
    "বেতন যে নিয়মে হিসাব হয়: বেতনের খাত, কাঠামো, রাউন্ডিং, পিএফ, ওভারটাইমের ভিত্তি ও ফ্ল্যাগের সীমা।",
  "g.payrollSetup.s1":
    "বেতনের খাত মানে পে-স্লিপের লাইনগুলো — মূল বেতন, বাড়িভাড়া, চিকিৎসা, পিএফ, কর।",
  "g.payrollSetup.s2":
    "কাঠামো বলে দেয় প্রতিটি খাত কীভাবে হিসাব হবে: মূল বেতনের শতাংশ, নির্দিষ্ট অঙ্ক, বা রুল প্যাকের নিয়ম।",
  "g.payrollSetup.s3":
    "সেটিংস ঠিক করে রাউন্ডিং, বিনা-বেতন দিনের ভিত্তি (ক্যালেন্ডার, ৩০ বা ২৬ দিন), ওভারটাইম ঘণ্টার ভিত্তি ও পিএফের শতাংশ।",
  "g.payrollSetup.s4":
    "কাঠামো বদলালে পরের রান থেকে কার্যকর হয়; আগে হিসাব হওয়া রান তার নিজের নিয়মেই থাকে।",

  "g.gate1.purpose":
    "পুরোনো সিস্টেমের সঙ্গে এই সিস্টেম মেলে — তার প্রমাণ: এক মাসের পুরোনো রেজিস্টার আর ইআরপির রান পাশাপাশি, প্রতিটি পার্থক্যের ব্যাখ্যা সহ।",
  "g.gate1.s1":
    "একই মাসের হিসাব-হওয়া রানের বিপরীতে পুরোনো বেতন রেজিস্টার আপলোড করুন।",
  "g.gate1.s2": "তুলনায় সেই সব কর্মী আসে যাদের হিসাব সহনসীমার বেশি আলাদা।",
  "g.gate1.s3":
    "এইচআর প্রতিটি পার্থক্য ব্যাখ্যা করে; হিসাব বিভাগ — আপলোডকারী ছাড়া অন্য কেউ — মাসটি গ্রহণ করে।",
  "g.gate1.s4":
    "তিন মাস গ্রহণ হলে গেট ১ পার হয়, তখনই পুরোনো সিস্টেমের সঙ্গে সমান্তরাল চালানো বন্ধ করা যায়।",

  // --------------------------------------------------------------- CRM / sales
  "g.leads.purpose":
    "যারা এখনো ক্রেতা হননি: কে তারা, কোথা থেকে এসেছেন, আর কে যোগাযোগ রাখছেন।",
  "g.leads.s1":
    "একটি লিডে নাম, যোগাযোগ ও উৎস থাকে; ওয়েবসাইটের অনুসন্ধান ফর্ম নিজেই এগুলো তৈরি করে।",
  "g.leads.s2": "প্রতিটি লিডের একজন মালিক দিন — মালিকহীন লিড কারও কাজ নয়।",
  "g.leads.s3":
    "লিড যোগ্য হলে তা ক্রেতা হয়ে যায়, আর সাধারণত একটি সম্ভাব্য বিক্রিও তৈরি হয়।",

  "g.customers.purpose":
    "আপনার ক্রেতারা: যোগাযোগ, ঠিকানা, ধারের সীমা ও পরিশোধের শর্ত, আর তাদের কাছে বিক্রি হওয়া সবকিছু।",
  "g.customers.s1":
    "কোটেশন, অর্ডার, চালান ও রসিদ — সবই এই একটি রেকর্ড ব্যবহার করে, তাই নাম ও টিআইএন সবখানে এক থাকে।",
  "g.customers.s2":
    "অর্ডার বা চালান তৈরির সময় ধারের সীমা ও পরিশোধের শর্ত যাচাই হয়।",
  "g.customers.s3":
    "খতিয়ান ট্যাবে দেখা যায় কত বিল হয়েছে, কত পরিশোধ হয়েছে, আর কত বকেয়া।",

  "g.tickets.purpose":
    "গ্রাহকেরা যা নিয়ে অভিযোগ করেছেন বা যা চেয়েছেন, আর সেবার প্রতিশ্রুতি মাপার ঘড়ি।",
  "g.tickets.s1":
    "প্রতিটি অভিযোগ একজন গ্রাহকের এবং একজন দায়িত্বপ্রাপ্তের; শ্রেণি ঠিক করে দেয় এটি কত জরুরি হিসেবে শুরু হবে।",
  "g.tickets.s2":
    "দুটি ঘড়ি কর্মঘণ্টায় চলে: গ্রাহককে প্রথম উত্তর, আর সমাধান। গ্রাহকের উত্তরের অপেক্ষায় থাকলে সমাধানের ঘড়ি থেমে থাকে।",
  "g.tickets.s3":
    "সময় পেরিয়ে গেলে তা নিজে থেকেই একবার জানানো হয় — দায়িত্বপ্রাপ্তকে, আর অতি জরুরি হলে অ্যাডমিনকেও।",

  "g.commission.purpose":
    "এই মাসে কোন বিক্রয়কর্মী কত পেলেন, চালান বা আদায় থেকে হিসাব করা।",
  "g.commission.s1":
    "এক সময়ে একটি নিয়ম: ভিত্তি, হার, আর ইচ্ছা হলে লক্ষ্য ছাড়ালে বেশি হার।",
  "g.commission.s2":
    "প্রতিটি লাইন তার প্রাপ্তি বা চালানগুলো বহন করে, তাই হিসাব নিয়ে তর্ক করা যায়।",
  "g.commission.s3":
    "পাঠালে প্রতিজনের জন্য একটি বেতন ভুক্তি হয়; বাতিল করলে সেগুলোও বাতিল হয়।",

  "g.gate3.purpose":
    "এই পাইলট সত্যিই নিজের বিক্রয় প্রক্রিয়া ও একটি মূল্যায়ন চক্র সিস্টেমে চালিয়েছে কি না।",
  "g.gate3.s1":
    "প্রতিটি যাচাই বলে কী সত্য হতে হবে, আর উত্তরের পিছনের সংখ্যাগুলো দেখায়।",
  "g.gate3.s2":
    "যা পূরণ হয়নি তা পূরণ হয়নি বলেই দেখায়: পাতাটি কখনো “প্রস্তুত” বলে দেয় না।",
  "g.gate3.s3":
    "গেট ৩ পার হলো কি না সে সিদ্ধান্ত মানুষের, এই প্রতিবেদন হাতে নিয়ে।",

  "g.cycles.purpose":
    "মূল্যায়ন চক্র: লক্ষ্য, নিজের পর্যালোচনা, ব্যবস্থাপকের রেটিং, এইজারের সমন্বয়, আর তার ফলাফল।",
  "g.cycles.s1":
    "চক্র এক ধাপ করে সামনে যায়, পিছনে নয়: রেটিং ও প্রস্তাব ইতিমধ্যে তার ওপর নির্ভর করে।",
  "g.cycles.s2":
    "লক্ষ্যগুলোর ভার মিলে ১০০ হয়, তাই নম্বরের অর্থ সবার জন্য একই।",
  "g.cycles.s3":
    "কোনো ইনক্রিমেন্টের প্রস্তাবের আগে এইজার বিভাগজুড়ে সমন্বয় করে — এক বিভাগের সবাই ৫ পেলে সেটা কোম্পানির ৫ নয়।",
  "g.cycles.s4":
    "অনুমোদিত ইনক্রিমেন্ট তারিখসহ বেতন পরিবর্তন হয়; বকেয়া বেতন নিজেই পরিশোধ করে।",

  "g.myTeamAppraisals.purpose":
    "আপনার অধীনস্থদের মূল্যায়ন: লক্ষ্য, নিজের পর্যালোচনা, আপনার রেটিং।",
  "g.myTeamAppraisals.s1":
    "কেপিআই তালিকা থেকে লক্ষ্য লিখুন, যাতে একই কাজের দুই ব্যবস্থাপক একই জিনিস মাপেন।",
  "g.myTeamAppraisals.s2":
    "ভারযুক্ত নম্বর কেবল পরামর্শ; আপনার দেওয়া রেটিংই সংরক্ষিত হয়।",
  "g.myTeamAppraisals.s3":
    "এআই খসড়া বছরের মতামত থেকে তৈরি আর কারও রেটিং দেয় না: নিজের ভাষায় লিখে নিন।",

  "g.incrementProposals.purpose":
    "মূল্যায়নের ফলাফল: ইনক্রিমেন্ট, পদোন্নতি, আর প্রতিটি কোন অবস্থায় আছে।",
  "g.incrementProposals.s1":
    "প্রস্তাবের আগে সমন্বিত রেটিং দরকার — সমন্বয়ের উদ্দেশ্য তাই।",
  "g.incrementProposals.s2":
    "অ্যাডমিন অনুমোদন দেন, তারপর এইজার সেটি কার্যকর করে।",
  "g.incrementProposals.s3":
    "কার্যকর করলে ওই তারিখ থেকে বেতন লিপিবদ্ধ হয়; পুরোনো তারিখ হলে পরের বেতনে বকেয়া হিসেবে পরিশোধ হয়।",

  "g.openings.purpose":
    "এখন যে পদগুলোর জন্য নিয়োগ চলছে, আর প্রতিটিতে কে কে আবেদন করেছেন।",
  "g.openings.s1":
    "অনুমোদিত পদ ছাড়া বিজ্ঞপ্তি হয় না, তাই কে অনুমোদন দিয়েছেন তা সবসময় খুঁজে পাওয়া যায়।",
  "g.openings.s2":
    "কোথায় প্রচার হয়েছে লিখে রাখুন; তাতেই বোঝা যায় কোন মাধ্যম থেকে আসলে লোক আসে।",
  "g.openings.s3":
    "যাচাইয়ের নম্বর শুধু সাজিয়ে দেয়; কারণগুলো দেওয়া আছে যাতে আপনি দ্বিমত করতে পারেন।",

  "g.positions.purpose":
    "নতুন পদের অনুরোধ: কী চাওয়া হয়েছে, জনবল পরিকল্পনা কী বলে, আর কে অনুমোদন দিয়েছেন।",
  "g.positions.s1":
    "বিভাগীয় প্রধান চান; এইজার পরিকল্পনা ও শর্ত দেখে; অ্যাডমিন টাকার সিদ্ধান্ত নেন।",
  "g.positions.s2":
    "পরিকল্পনার বাইরের অনুরোধ আটকে দেওয়া হয় না — চিহ্নিত হয়, আর অনুমোদনকারীরা কারণ দেখতে পান।",
  "g.positions.s3":
    "অনুমোদনের পর এইজার সেটি নিয়োগের জন্য খোলে, আর বিজ্ঞপ্তিটি অনুমোদনের সূত্র বহন করে।",

  "g.manpowerPlan.purpose":
    "এই অর্থবছরে কোন বিভাগে কোন পদবির কতটি পদ থাকতে পারে।",
  "g.manpowerPlan.s1":
    "পরিকল্পনা মানুষের বাজেট: কতটি পদ পূরণ, কতটি চাওয়া হয়েছে, কতটি বাকি।",
  "g.manpowerPlan.s2":
    "অনুমোদিত পরিকল্পনা পরিবর্তন করা হয় না; পরের বছর নতুন পরিকল্পনা হয়।",

  "g.myInterviews.purpose":
    "যে সাক্ষাৎকারের বোর্ডে আপনি আছেন, আর শুধু আপনিই যে মূল্যায়ন দিতে পারেন।",
  "g.myInterviews.s1":
    "বোর্ডের প্রত্যেকে নিজের মূল্যায়ন দেন: কেউ অন্যের হয়ে নম্বর দেন না।",
  "g.myInterviews.s2":
    "মূল্যায়ন জমা হলে এইজার পর্বের ফলাফল লিপিবদ্ধ করে।",

  "g.opportunities.purpose":
    "যে বিক্রিগুলো নিয়ে কাজ চলছে: টাকার অঙ্ক, ধাপ, সম্ভাব্য শেষ তারিখ ও জেতার সম্ভাবনা।",
  "g.opportunities.s1":
    "প্রতিটি ধাপের সঙ্গে একটি সম্ভাবনা জড়িত, আর পূর্বাভাস সেটা থেকেই তৈরি হয়।",
  "g.opportunities.s2":
    "সত্যিকারের কিছু ঘটলে ধাপ এগিয়ে দিন — কোটেশন পাঠানো, ডেমো হওয়া — আন্দাজে নয়।",
  "g.opportunities.s3":
    "জেতা বিক্রি থেকে কোটেশন বা অর্ডার হয়; হারালে কারণ রাখা হয়, আর সেটাই পাইপলাইনকে পড়ার যোগ্য করে।",

  "g.forecast.purpose":
    "পাইপলাইন থেকে কত আসার আশা, লক্ষ্যের বিপরীতে — মালিক ও অঞ্চল অনুযায়ী।",

  "g.quotations.purpose":
    "ক্রেতাকে দেওয়া দামসহ প্রস্তাব, সঙ্গে বৈধতার সময়, ছাড় ও শর্ত।",
  "g.quotations.s1": "ক্যাটালগ থেকে কোটেশন বানান, তাতে দাম ও ভ্যাট ঠিক আসে।",
  "g.quotations.s2":
    "বৈধতার তারিখ দিয়ে পাঠান; অনুমোদিত সীমার বেশি ছাড় দিতে আগে অনুমোদন লাগে।",
  "g.quotations.s3":
    "গৃহীত কোটেশন এক ধাপে বিক্রয় আদেশ হয়ে যায়, কিছুই আবার লিখতে হয় না।",

  "g.orders.purpose":
    "নিশ্চিত হওয়া ক্রেতার অর্ডার: কী কথা হয়েছে, কতটা দেওয়া হয়েছে, আর কতটার চালান বাকি।",
  "g.orders.s1":
    "অর্ডারে রাজি হওয়া পরিমাণ ও দাম থাকে, আর সরবরাহ অনুযায়ী পণ্য আটকে রাখা হয়।",
  "g.orders.s2":
    "দরকার হলে ভাগে ভাগে দিন — প্রতিটি সরবরাহের আলাদা চালান করা যায়।",
  "g.orders.s3": "প্রতিটি লাইনের সরবরাহ ও চালান শেষ না হলে অর্ডার খোলা থাকে।",

  "g.catalogue.purpose":
    "আপনি যা বিক্রি করেন: কোড, বিবরণ, একক, দামের তালিকা ও ভ্যাটের নিয়ম।",
  "g.territories.purpose":
    "কে কোন অঞ্চল বা ক্রেতার দল দেখেন, আর কার কত লক্ষ্য।",

  // ------------------------------------------------------------------- finance
  "g.financeHome.purpose":
    "খতিয়ানের সারসংক্ষেপ: কোন সময়কাল খোলা, সাম্প্রতিক কী বসেছে, আর মাস বন্ধ করার আগে কী কী বাকি।",
  "g.financeHome.s1":
    "সিস্টেমের যেখানেই টাকা নড়ে, শেষে এখানে একটি জার্নাল এন্ট্রি হয়ে বসে।",
  "g.financeHome.s2":
    "এন্ট্রিগুলো ভাউচারে জমা হয়, আর ভাউচার মিলে না গেলে পোস্ট করা যায় না।",
  "g.financeHome.s3": "বন্ধ মাসে কিছু বসানো যায় না; সংশোধন খোলা মাসে যায়।",

  "g.vouchers.purpose":
    "জার্নাল এন্ট্রি, হাতে লেখা বা অন্য মডিউল থেকে আসা: পেমেন্ট, রিসিট, জার্নাল ও কন্ট্রা ভাউচার।",
  "g.vouchers.s1":
    "ভাউচার খসড়া হয়, যাচাই হয়, তারপর পোস্ট হয়। কেবল পোস্ট হওয়া ভাউচারই খতিয়ানে পৌঁছায়।",
  "g.vouchers.s2":
    "ডেবিট ও ক্রেডিট সমান হতে হবে, আর প্রতিটি লাইনে হিসাব — এবং দরকার হলে কস্ট সেন্টার — থাকতে হবে।",
  "g.vouchers.s3":
    "পোস্ট হওয়া ভাউচার কখনো সম্পাদনা হয় না। উল্টো এন্ট্রি দিয়ে বাতিল করে ঠিকটি পোস্ট করুন, তাতে হিসাবের সূত্র অটুট থাকে।",

  "g.accounts.purpose":
    "হিসাবের তালিকা: খতিয়ানের হিসাবগুলোর গাছ, কোনটি কোন ধরনের, আর কোথায় কী বসে।",
  "g.reports.purpose":
    "যেকোনো সময়কালের রেওয়ামিল, খতিয়ান, লাভ-ক্ষতি ও স্থিতিপত্র।",

  "g.close.purpose":
    "মাস শেষের চেকলিস্ট: কী শেষ করতে হবে, কী এখনো বাকি, আর যে স্বাক্ষরে মাস বন্ধ হয়।",
  "g.close.s1":
    "তালিকায় প্রতিটি যাচাই থাকে — ব্যাংক মিলেছে, ভ্যাট রিটার্ন জমা হয়েছে, বেতন বসেছে, অবচয় হয়েছে।",
  "g.close.s2": "যেকোনো ক্রমে টিক দিন, তবে সব শেষ হলেই মাস বন্ধ হয়।",
  "g.close.s3": "বন্ধ করলে সময়কাল লক হয়; এরপর সংশোধন পরের মাসের ঘরে যায়।",

  "g.gate2.purpose":
    "এই কোম্পানির খাতা সত্যিই ইআরপি-তে চলছে কিনা: প্রারম্ভিক ব্যালেন্স, বন্ধ হয়েছে এমন একটি মাস, আর পুরনো সিস্টেমের সঙ্গে মিলে যাওয়া।",
  "g.gate2.s1":
    "প্রতিটি শর্ত বলে কী সত্য হওয়া দরকার, আর উত্তরের পেছনের হিসাব।",
  "g.gate2.s2":
    "গেট ২ এগিয়ে নেওয়ার কাজ হয় মাস-শেষের ক্লোজ ও প্রারম্ভিক ব্যালেন্সের পাতায়।",
  "g.gate2.s3":
    "গেট ২ উত্তীর্ণ বলা মানুষের সিদ্ধান্ত, এই প্রতিবেদন হাতে নিয়েই নেওয়া হয়।",

  "g.opening.purpose":
    "ইআরপিতে কোম্পানি যে স্থিতি নিয়ে শুরু করে — একবার আনা হয় আর স্বাক্ষর হয়।",
  "g.vendors.purpose":
    "সরবরাহকারী: যোগাযোগ, টিআইএন ও ভ্যাট নিবন্ধন, ব্যাংকের তথ্য, আর তাদের কত পাওনা।",

  "g.procurement.purpose":
    "কেনাকাটা: চাহিদাপত্র, তার অনুমোদন, ক্রয়াদেশ, কী এসেছে, আর তারপরের বিল।",
  "g.procurement.s1":
    "চাহিদাপত্রে কিছু চাওয়া হয়, আর অনুমোদনের আগে বিভাগের বাজেটের সঙ্গে মিলিয়ে দেখা হয়।",
  "g.procurement.s2":
    "অনুমোদিত চাহিদাপত্র সরবরাহকারীর কাছে ক্রয়াদেশ হয়ে যায়।",
  "g.procurement.s3":
    "গ্রহণে লেখা হয় সত্যিই কী এসেছে; তারপর বিলটি আদেশ ও সেই গ্রহণের সঙ্গে মেলানো হয়।",

  "g.budgets.purpose":
    "কোন বিভাগ কোন খাতে কত খরচ করতে পারে, আর তার কতটা ইতিমধ্যে খরচ বা প্রতিশ্রুত।",
  "g.assets.purpose":
    "স্থায়ী সম্পদ: কী কেনা হয়েছে, কার কাছে আছে, এখন মূল্য কত, আর কত অবচয় বসেছে।",
  "g.stock.purpose":
    "স্টোর ও মালামাল: হাতে কত আছে, কী নড়েছে, আর কোন চাহিদা অপেক্ষায়।",

  "g.bills.purpose":
    "সরবরাহকারীর বিল: কত দেনা, উৎসে কত কর কাটা হয়েছে, আর কত পরিশোধ হয়েছে।",
  "g.bills.s1": "বিলে সরবরাহকারী, অঙ্ক, ভ্যাট ও উৎসে কাটা কর থাকে।",
  "g.bills.s2":
    "পরিশোধের আগে অনুমোদন লাগে; পরিশোধ হলে তা খতিয়ান ও ব্যাংক হিসাবে বসে।",
  "g.bills.s3": "উৎসে কাটা কর এখানে জমা থাকে আর কর পর্দা থেকে রিপোর্ট হয়।",

  "g.invoices.purpose":
    "ক্রেতার চালান: কত বিল হয়েছে, তার ভ্যাট, আর কতটা এখনো অপরিশোধিত।",
  "g.invoices.s1":
    "বিক্রয় আদেশ থেকে বা আলাদা করে চালান করুন; ভ্যাটের নিয়ম ক্যাটালগ থেকে আসে।",
  "g.invoices.s2":
    "পোস্ট হওয়া চালান সঙ্গে সঙ্গে খতিয়ান ও ক্রেতার হিসাবে পৌঁছায়।",
  "g.invoices.s3":
    "রসিদ চালানের বিপরীতে বসে — আপনি অন্যভাবে না বললে পুরোনোটি আগে।",

  "g.receipts.purpose":
    "ক্রেতার কাছ থেকে পাওয়া টাকা, আর কোন রসিদে কোন চালান শোধ হলো।",
  "g.receivables.purpose":
    "ক্রেতাদের কাছে কত পাওনা, কত দিনের পুরোনো, আর প্রতিটি বকেয়ায় কী যোগাযোগ হয়েছে।",

  "g.bank.purpose":
    "কোম্পানির ব্যাংক হিসাব, তার বিবরণী, আর খতিয়ানের সঙ্গে মিলকরণ।",
  "g.bank.s1": "সময়কালের বিবরণী আনুন বা হাতে তুলুন।",
  "g.bank.s2":
    "বিবরণীর লাইন খতিয়ানের এন্ট্রির সঙ্গে মেলান; যা অমিল থাকে, সেটাই ব্যাখ্যা করার জিনিস।",
  "g.bank.s3": "মিলে যাওয়া সময়কাল মাস বন্ধের একটি যাচাই।",

  "g.tax.purpose":
    "উৎসে কাটা কর: কত কাটা হয়েছে, কোন চালানে জমা হয়েছে, আর কী সনদ দেওয়া হয়েছে।",

  "g.vat.purpose":
    "ভ্যাট: পণ্য ও তার হার, বিক্রির রেকর্ড, আর সময়কালের রিটার্ন।",
  "g.vat.s1":
    "ক্যাটালগের প্রতিটি পণ্যে ভ্যাটের হার থাকে, আর বিক্রি নিজেই তা নিয়ে নেয়।",
  "g.vat.s2": "রিটার্নে সময়কালের উৎপাদ ও উপকরণ ভ্যাট যোগ হয়।",
  "g.vat.s3": "জমা দিন, তারপর প্রাপ্তিস্বীকার সেই সময়কালের সঙ্গে রেখে দিন।",

  "g.compliance.purpose":
    "সময়সীমা আছে যে জমা ও নবায়নগুলোর: কোনটা বাকি, কোনটা হয়েছে, আর প্রতিটির প্রমাণ কী।",

  "g.expenses.purpose":
    "কর্মীর খরচের দাবি ও অগ্রিম: কত খরচ হয়েছে, কতটা অনুমোদিত, আর কত ফেরত দেওয়া হয়েছে।",
  "g.expenses.s1": "দাবি কর্মীর অ্যাপ থেকে বিল সংযুক্ত হয়ে আসে।",
  "g.expenses.s2":
    "অনুমোদনের পথ অঙ্ক অনুযায়ী বদলায় — বড় দাবি আরও উপরে যায়।",
  "g.expenses.s3":
    "অনুমোদিত দাবি বেতনের সঙ্গে বা আলাদা পরিশোধ হয়, আর যে অগ্রিম শোধ হচ্ছে তা সমন্বয় হয়।",

  // ------------------------------------------------------------ administration
  "p.nav.chains": "অনুমোদনের ধারা",
  "g.approvalChains.purpose":
    "কে কী অনুমোদন করবেন: প্রতিটি ধরনের আবেদন যে ধাপগুলো পার করে।",
  "g.approvalChains.s1":
    "একটি ধারা একটি আবেদনের ধরনের — ছুটি, বেতন পরিবর্তন, বিল, ক্রয়াদেশ — আর তাতে অঙ্ক, বিভাগ বা গ্রেডের শর্ত থাকতে পারে।",
  "g.approvalChains.s2":
    "ধাপে অনুমোদনকারী ঠিক হয় ভূমিকা ও পরিধি দিয়ে, কারও নাম দিয়ে নয় — তাই কেউ চলে গেলেও ধারা টিকে থাকে।",
  "g.approvalChains.s3":
    "একাধিক ধারা মিলে গেলে প্রাধান্য ঠিক করে কোনটি চলবে; সহজাত ধারাটি শেষ ভরসা।",
  "g.approvalChains.s4":
    "ধারা বদলালে চলমান আবেদনে হাত পড়ে না — তারা যে ধারায় শুরু হয়েছিল, সেখানেই শেষ হয়।",

  "g.migration.purpose":
    "পুরোনো সিস্টেমের তথ্য আনা: ফাইল আপলোড, কী বাদ পড়েছে ও কেন তা দেখা, ঠিক করা, তারপর ব্যাচে স্বাক্ষর।",
  "g.migration.s1":
    "যা আনছেন তার টেমপ্লেট নামিয়ে নিন — কর্মী, বেতন, স্থিতি, হাজিরার ইতিহাস।",
  "g.migration.s2":
    "আপলোড করুন। প্রতিটি সারি আগে যাচাই হয়, আর পুরো ব্যাচ গৃহীত না হলে কিছুই লেখা হয় না।",
  "g.migration.s3":
    "রিপোর্টে বাতিল হওয়া প্রতিটি সারি ও তার কারণ থাকে, তাই ফাইল ঠিক করে আবার আপলোড করা যায়।",
  "g.migration.s4":
    "আপলোডকারী ছাড়া অন্য কেউ ব্যাচে স্বাক্ষর দেন, আর সেই স্বাক্ষরেই তথ্য সরকারিভাবে গৃহীত হয়।",

  "g.ai.purpose":
    "এআই সহকারী: কোন মডেল চলবে, তারা কী পড়তে পারবে, আর প্রতিটি প্রশ্নে কত খরচ হয়েছে।",
  "g.ai.s1":
    "নীতি ঠিক করে কোন ভূমিকা প্রশ্ন করতে পারবে, আর সহকারী কোম্পানির কোন তথ্য পড়তে পারবে।",
  "g.ai.s2":
    "সহকারী কেবল এই কোম্পানির তথ্য থেকে উত্তর দেয়, আর নিজে থেকে কিছু বদলায় না।",
  "g.ai.s3":
    "প্রতিটি প্রশ্ন ও উত্তর খরচসহ লেখা থাকে, তাই ব্যবহার পরে যাচাই করা যায়।",

  "g.audit.purpose":
    "কে কী করেছেন, কখন ও কোথা থেকে — যে রেকর্ড কেউ সম্পাদনা করতে পারে না।",
  "g.audit.s1": "সত্তা, কাজ, ব্যক্তি বা তারিখ দিয়ে ছেঁকে দেখুন।",
  "g.audit.s2": "প্রতিটি এন্ট্রিতে পরিবর্তনের আগের ও পরের চেহারা থাকে।",
  "g.audit.s3":
    "এন্ট্রিগুলো হ্যাশ দিয়ে শিকলে বাঁধা, তাই কোনো এন্ট্রি সরানো বা বদলানো হলে ধরা পড়ে।",

  "g.integrations.purpose":
    "বাইরের সঙ্গে সংযোগ: বার্তার চ্যানেল, ওয়েবহুক, সার্ভিস কী, আর ব্যর্থ বার্তা আবার পাঠানো।",
  "g.integrations.s1":
    "চ্যানেলই এসএমএস, ই-মেইল ও পুশ পাঠায়; ভরসা করার আগে একবার পরীক্ষা করুন।",
  "g.integrations.s2":
    "সার্ভিস কী কোনো যন্ত্রের, কোনো মানুষের নয়, আর তাতে কেবল দরকারি অনুমতিই থাকে।",
  "g.integrations.s3":
    "যে বার্তাগুলো যেতে পারেনি, সেগুলো ব্যর্থ তালিকায় জমা হয়: কারণ ঠিক করে আবার পাঠান।",

  // -------------------------------------------------------------- home sections
  "p.home.setup": "কোম্পানির সেটআপ",
  "p.home.setupHint":
    "{total}টির মধ্যে {done}টি হয়েছে। বেতন চালানোর আগে এগুলো শেষ করুন।",
  "p.home.setupComplete": "সেটআপ সম্পূর্ণ — কিছুই বাকি নেই।",
  "p.home.attention": "আপনার মনোযোগ দরকার",
  "p.home.attentionNone": "এখন আপনার জন্য কিছু অপেক্ষা করছে না।",
  "p.home.quick": "নিত্যকাজ",
  "p.home.todo": "বাকি",
  "p.home.numbers": "সংখ্যা",
  "p.home.setup.branches": "অন্তত একটি শাখা",
  "p.home.setup.departments": "বিভাগ",
  "p.home.setup.designations": "পদ",
  "p.home.setup.grades": "গ্রেড (বেতনের ধাপ)",
  "p.home.setup.shifts": "শিফট",
  "p.home.setup.holidays": "ছুটির ক্যালেন্ডার",
  "p.home.setup.leaveTypes": "ছুটির ধরন",
  "p.home.setup.employees": "কর্মী",
  "p.home.setup.structures": "বেতন-কাঠামো",
  "p.home.setup.salaries": "প্রত্যেক কর্মীর বেতন",
  "p.home.setup.users": "অফিস কর্মীদের লগইন",
  "p.home.setup.firstRun": "প্রথম বেতন রান",
  "p.home.setup.gate1": "গেট ১: তিন মাস মিলেছে",
  "p.home.setup.missing": "{n}টি বাকি",
  "p.home.task.approvals": "{n}টি আবেদন আপনার সিদ্ধান্তের অপেক্ষায়",
  "p.home.task.phones": "{n}টি কর্মীর ফোন অনুমোদনের অপেক্ষায়",
  "p.home.task.bankAccounts": "{n}টি বেতন হিসাব পরিবর্তন অপেক্ষায়",
  "p.home.task.leaveRequests": "{n}টি ছুটির আবেদন ঝুলে আছে",
  "p.home.task.probation": "{n}জনের শিক্ষানবিশকাল ৩০ দিনের মধ্যে শেষ",
  "p.home.task.attendanceLock": "গত মাসের হাজিরা এখনো লক করা হয়নি",
  "p.home.task.openRuns": "{n}টি বেতন রান এখনো পরিশোধ হয়নি",
  "p.home.task.documentExpiry":
    "{n}টি কাগজের মেয়াদ শেষ বা ৩০ দিনের মধ্যে শেষ হবে",
  "p.home.quick.employee": "কর্মী যোগ করুন",
  "p.home.quick.run": "বেতন রান দেখুন",
  "p.home.quick.attendance": "হাজিরা দেখুন",
  "p.home.quick.leave": "ছুটির আবেদন",
  "p.home.quick.user": "ব্যবহারকারী আমন্ত্রণ",
  "p.home.quick.voucher": "নতুন ভাউচার",
  "p.home.quick.claim": "খরচের দাবি",
  "g.empty.employees": "এখনো কোনো কর্মী নেই।",
  "g.empty.employeesHint":
    "প্রথম কর্মীকে এখানে যোগ করুন, বা তথ্য স্থানান্তর থেকে পুরোনো তালিকা নিয়ে আসুন।",
  "g.empty.search": "এই খোঁজের সঙ্গে কিছু মেলেনি।",
  "g.empty.searchHint": "সবাইকে আবার দেখতে খোঁজার ঘর ও ছাঁকনিগুলো খালি করুন।",
};
