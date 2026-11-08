/**
 * Routes (WP12): Gate 1 parallel payroll comparison
 *
 *   GET  /parallel-comparisons/template                          the register columns (CSV)
 *   POST /payroll-runs/:runId/parallel-comparisons               HR: multipart file (+ tolerance)
 *   GET  /parallel-comparisons/:id                               summary and every employee
 *   POST /parallel-comparisons/:id/lines/:employeeCode/explain   HR: { explanation }
 *   POST /parallel-comparisons/:id/accept                        Accounts: { note? } (not the uploader)
 *   GET  /companies/:companyId/gate-1                            accepted months, Gate 1 passed?
 */
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  AcceptComparisonDto,
  CompareDto,
  ExplainDto,
} from './dto/parallel-run.dto.js';
import {
  MAX_REGISTER_BYTES,
  ParallelRunService,
} from './parallel-run.service.js';

@Controller()
export class ParallelRunController {
  constructor(private readonly parallelRunService: ParallelRunService) {}

  // GET /parallel-comparisons/template
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Get('parallel-comparisons/template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="payroll-register-template.csv"',
  )
  template() {
    return this.parallelRunService.template();
  }

  // POST /payroll-runs/:runId/parallel-comparisons
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_REGISTER_BYTES, files: 1 },
    }),
  )
  @Post('payroll-runs/:runId/parallel-comparisons')
  compare(
    @Param('runId', ParseUUIDPipe) runId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: CompareDto,
  ) {
    return this.parallelRunService.compare(runId, file, dto);
  }

  // GET /parallel-comparisons/:id
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.approve')
  @Get('parallel-comparisons/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.parallelRunService.get(id);
  }

  // POST /parallel-comparisons/:id/lines/:employeeCode/explain
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('parallel-comparisons/:id/lines/:employeeCode/explain')
  @HttpCode(200)
  explain(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employeeCode') employeeCode: string,
    @Body() dto: ExplainDto,
  ) {
    return this.parallelRunService.explain(id, employeeCode, dto);
  }

  // POST /parallel-comparisons/:id/accept
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.verify')
  @Post('parallel-comparisons/:id/accept')
  @HttpCode(200)
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcceptComparisonDto,
  ) {
    return this.parallelRunService.accept(id, dto);
  }

  // GET /companies/:companyId/gate-1
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.approve')
  @Get('companies/:companyId/gate-1')
  gate(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.parallelRunService.gate(companyId);
  }
}
