/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /me/pf-ledger                                          the employee's own PF ledger (app)
 *   GET   /me/tax-certificates                                   income years with salary: [{ fiscalYear, final }]
 *   GET   /me/tax-certificate?fiscalYear=2025-26                 own annual tax certificate
 *   GET   /me/tax-certificate/pdf?fiscalYear=2025-26&lang=bn     ... as PDF
 *   GET   /employees/:employeeId/pf-ledger                       HR, Accounts, Admin (salary access)
 *   PUT   /employees/:employeeId/pf-opening                      HR  { asOf, employeePart, employerPart, note? }
 *   GET   /employees/:employeeId/tax-certificates                HR, Accounts, Admin
 *   GET   /employees/:employeeId/tax-certificate?fiscalYear=2025-26
 *   GET   /employees/:employeeId/tax-certificate/pdf?fiscalYear=2025-26&lang=en
 *   GET   /companies/:companyId/salary-tax-challans?fiscalYear=2025-26   tax withheld vs deposited per month
 *   POST  /companies/:companyId/salary-tax-challans              Accounts  { period, challanNo, challanDate, amount }
 *   POST  /salary-tax-challans/:challanId/cancel                 Accounts  { reason }
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  FiscalYearQueryDto,
  PfOpeningDto,
  ReasonDto,
  SalaryTaxChallanDto,
  TaxCertificateQueryDto,
} from './dto/payroll.dto.js';
import { PayrollStatementsService } from './payroll-statements.service.js';

const STAFF = ['payroll.prepare', 'payroll.verify', 'payroll.approve'] as const;

@Controller()
export class PayrollStatementsController {
  constructor(
    private readonly payrollStatementsService: PayrollStatementsService,
  ) {}

  // GET /me/pf-ledger
  @UseGuards(AuthGuard)
  @RequirePermission('payslip.view_own')
  @Get('me/pf-ledger')
  async myPfLedger() {
    return this.payrollStatementsService.pfLedger(
      await this.payrollStatementsService.ownEmployee(),
    );
  }

  // GET /me/tax-certificates
  @UseGuards(AuthGuard)
  @RequirePermission('payslip.view_own')
  @Get('me/tax-certificates')
  async myTaxYears() {
    return this.payrollStatementsService.taxYears(
      await this.payrollStatementsService.ownEmployee(),
    );
  }

  // GET /me/tax-certificate?fiscalYear=2025-26
  @UseGuards(AuthGuard)
  @RequirePermission('payslip.view_own')
  @Get('me/tax-certificate')
  async myTaxCertificate(@Query() query: TaxCertificateQueryDto) {
    return this.payrollStatementsService.taxCertificate(
      await this.payrollStatementsService.ownEmployee(),
      query.fiscalYear,
      query.lang ?? 'en',
    );
  }

  // GET /me/tax-certificate/pdf?fiscalYear=2025-26&lang=bn
  @UseGuards(AuthGuard)
  @RequirePermission('payslip.view_own')
  @Get('me/tax-certificate/pdf')
  async myTaxCertificatePdf(
    @Query() query: TaxCertificateQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const employee = await this.payrollStatementsService.ownEmployee();
    return pdfResponse(
      await this.payrollStatementsService.taxCertificatePdf(
        employee,
        query.fiscalYear,
        query.lang ?? 'en',
      ),
      res,
    );
  }

  // GET /employees/:employeeId/pf-ledger
  @UseGuards(AuthGuard)
  @RequirePermission(...STAFF)
  @Get('employees/:employeeId/pf-ledger')
  async pfLedger(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.payrollStatementsService.pfLedger(
      await this.payrollStatementsService.staffEmployee(employeeId),
    );
  }

  // PUT /employees/:employeeId/pf-opening
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Put('employees/:employeeId/pf-opening')
  savePfOpening(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: PfOpeningDto,
  ) {
    return this.payrollStatementsService.savePfOpening(employeeId, dto);
  }

  // GET /employees/:employeeId/tax-certificates
  @UseGuards(AuthGuard)
  @RequirePermission(...STAFF)
  @Get('employees/:employeeId/tax-certificates')
  async taxYears(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.payrollStatementsService.taxYears(
      await this.payrollStatementsService.staffEmployee(employeeId),
    );
  }

  // GET /employees/:employeeId/tax-certificate?fiscalYear=2025-26
  @UseGuards(AuthGuard)
  @RequirePermission(...STAFF)
  @Get('employees/:employeeId/tax-certificate')
  async taxCertificate(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: TaxCertificateQueryDto,
  ) {
    const employee =
      await this.payrollStatementsService.staffEmployee(employeeId);
    return this.payrollStatementsService.taxCertificate(
      employee,
      query.fiscalYear,
      query.lang ?? 'en',
    );
  }

  // GET /employees/:employeeId/tax-certificate/pdf?fiscalYear=2025-26&lang=en
  @UseGuards(AuthGuard)
  @RequirePermission(...STAFF)
  @Get('employees/:employeeId/tax-certificate/pdf')
  async taxCertificatePdf(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: TaxCertificateQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const employee =
      await this.payrollStatementsService.staffEmployee(employeeId);
    return pdfResponse(
      await this.payrollStatementsService.taxCertificatePdf(
        employee,
        query.fiscalYear,
        query.lang ?? 'en',
      ),
      res,
    );
  }

  // GET /companies/:companyId/salary-tax-challans?fiscalYear=2025-26
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payables.tax')
  @Get('companies/:companyId/salary-tax-challans')
  listChallans(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: FiscalYearQueryDto,
  ) {
    return this.payrollStatementsService.listChallans(
      companyId,
      query.fiscalYear,
    );
  }

  // POST /companies/:companyId/salary-tax-challans
  @UseGuards(AuthGuard)
  @RequirePermission('payables.tax')
  @Post('companies/:companyId/salary-tax-challans')
  addChallan(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SalaryTaxChallanDto,
  ) {
    return this.payrollStatementsService.addChallan(companyId, dto);
  }

  // POST /salary-tax-challans/:challanId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('payables.tax')
  @Post('salary-tax-challans/:challanId/cancel')
  @HttpCode(200)
  cancelChallan(
    @Param('challanId', ParseUUIDPipe) challanId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.payrollStatementsService.cancelChallan(challanId, dto);
  }
}

function pdfResponse(
  file: { fileName: string; content: Buffer },
  res: Response,
) {
  res.setHeader('Cache-Control', 'no-store');
  return new StreamableFile(file.content, {
    type: 'application/pdf',
    disposition: `attachment; filename="${file.fileName}"`,
  });
}
