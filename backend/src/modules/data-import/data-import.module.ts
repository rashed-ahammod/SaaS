import { CrmModule } from '../crm/crm.module.js';
import { Module } from '@nestjs/common';
import { BankAccountsModule } from '../bank-accounts/bank-accounts.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LeaveModule } from '../leave/leave.module.js';
import { OrgModule } from '../org/org.module.js';
import { PayrollModule } from '../payroll/payroll.module.js';
import { DataImportController } from './data-import.controller.js';
import { DataImportService } from './data-import.service.js';
import { ReconciliationService } from './reconciliation.service.js';

/**
 * Data migration (WP8): Excel / CSV templates, staging with row-level
 * validation, dry run, one-transaction commit, rollback until sign-off, and the
 * go-live reconciliation report the customer signs. Records are created through
 * the owning modules' services.
 * Owns tables: import_batches, import_rows, migration_signoffs.
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    EmployeesModule,
    LeaveModule,
    PayrollModule,
    BankAccountsModule,
    CrmModule,
  ],
  controllers: [DataImportController],
  providers: [DataImportService, ReconciliationService],
})
export class DataImportModule {}
