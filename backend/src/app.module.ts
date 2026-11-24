import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AiModule } from './modules/ai/ai.module.js';
import { ApprovalsModule } from './modules/approvals/approvals.module.js';
import { AttendanceModule } from './modules/attendance/attendance.module.js';
import { BankAccountsModule } from './modules/bank-accounts/bank-accounts.module.js';
import { CalendarModule } from './modules/calendar/calendar.module.js';
import { EmployeesModule } from './modules/employees/employees.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { LeaveModule } from './modules/leave/leave.module.js';
import { PayrollModule } from './modules/payroll/payroll.module.js';
import { DisbursementModule } from './modules/disbursement/disbursement.module.js';
import { DataImportModule } from './modules/data-import/data-import.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { ParallelRunModule } from './modules/parallel-run/parallel-run.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { PayablesModule } from './modules/payables/payables.module.js';
import { ExpensesModule } from './modules/expenses/expenses.module.js';
import { ProcurementModule } from './modules/procurement/procurement.module.js';
import { BudgetsModule } from './modules/budgets/budgets.module.js';
import { AssetsModule } from './modules/assets/assets.module.js';
import { BankModule } from './modules/bank/bank.module.js';
import { VatModule } from './modules/vat/vat.module.js';
import { CloseModule } from './modules/close/close.module.js';
import { CrmModule } from './modules/crm/crm.module.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { SupportModule } from './modules/support/support.module.js';
import { RecruitmentModule } from './modules/recruitment/recruitment.module.js';
import { PerformanceModule } from './modules/performance/performance.module.js';
import { CommissionsModule } from './modules/commissions/commissions.module.js';
import { ResignationModule } from './modules/resignation/resignation.module.js';
import { OrgModule } from './modules/org/org.module.js';
import { PortalModule } from './modules/portal/portal.module.js';
import { RulesModule } from './modules/rules/rules.module.js';
import { SystemModule } from './modules/system/system.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { HttpExceptionFilter } from './platform/http/http-exception.filter.js';
import { IdempotencyInterceptor } from './platform/idempotency/idempotency.interceptor.js';
import { PlatformModule } from './platform/platform.module.js';
import { TenantTransactionInterceptor } from './platform/tenancy/tenant-transaction.interceptor.js';

@Module({
  imports: [
    PlatformModule,
    // Default rate limit for every route: 300 requests per minute per IP.
    // Login routes set a stricter limit with @Throttle, and so does the public
    // lead capture (crm.controller.ts).
    //
    // The counters live in THIS PROCESS's memory. ONE API instance only -- the
    // same condition RUN_JOBS_IN_API already imposes. Run two and each keeps
    // its own count, so every limit here silently becomes as many times looser
    // as there are instances, with nothing failing to say so. Before scaling
    // out, give ThrottlerModule a shared storage (its storage option) backed by
    // PostgreSQL or Redis.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      // Integration tests make many logins from one IP. Never in production:
      // this switch turns off the login rate limit and with it the only thing
      // that makes password guessing slow, so it is ignored there whatever the
      // environment says (and config.ts refuses to start if it is set).
      skipIf: () =>
        process.env.DISABLE_RATE_LIMIT === '1' &&
        process.env.NODE_ENV !== 'production',
    }),
    IdentityModule,
    // Business modules, one per work package
    OrgModule, // WP1
    EmployeesModule, // WP1
    UsersModule, // WP2
    ApprovalsModule, // WP2
    BankAccountsModule, // WP2
    SystemModule, // WP2
    RulesModule, // WP3
    CalendarModule, // WP4
    AttendanceModule, // WP4
    LeaveModule, // WP5
    PayrollModule, // WP6
    DisbursementModule, // WP7
    DataImportModule, // WP8
    NotificationsModule, // WP10
    AiModule, // WP11
    ParallelRunModule, // WP12 (Gate 1)
    LedgerModule, // Phase 2 WP14
    PayablesModule, // Phase 2 WP15
    ExpensesModule, // Phase 2 WP16
    ProcurementModule, // Phase 2 WP17
    BudgetsModule, // Phase 2 WP18
    AssetsModule, // Phase 2 WP19
    BankModule, // Phase 2 WP20
    VatModule, // Phase 2 WP21
    CloseModule, // Phase 2 WP22
    CrmModule, // Phase 3 WP23
    SalesModule, // Phase 3 WP25-WP27
    SupportModule, // Phase 3 WP28
    RecruitmentModule, // Phase 3 WP29
    PerformanceModule, // Phase 3 WP30
    CommissionsModule, // Phase 3 WP31
    ResignationModule, // resignation from the app (2026-10-30)
    PortalModule, // portal home screen (setup progress + what needs attention)
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // Order matters: the tenant transaction opens first, then idempotency runs inside it.
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
