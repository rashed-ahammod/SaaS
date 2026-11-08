/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /disbursement-formats                          file formats per channel
 *   GET   /payroll-runs/:runId/payments                  payments + totals per channel and status
 *   POST  /payroll-runs/:runId/disbursement-files        { channel, adapter? }   step-up X-OTP-Code
 *   GET   /payroll-runs/:runId/disbursement-files
 *   GET   /disbursement-files/:fileId/download
 *   POST  /disbursement-files/:fileId/settle             the bank paid it -> payments paid
 *   POST  /disbursement-files/:fileId/returns            { content: "REFERENCE,STATUS,REASON\n..." }
 *   POST  /disbursement-files/:fileId/cancel             { reason }  -> Admin approval, then payments freed
 *   POST  /payments/:paymentId/reissue                   { reason }  a returned payment, step-up X-OTP-Code
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  RequirePermission,
  RequireStepUp,
} from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { ADAPTERS } from './adapters.js';
import { DisbursementService } from './disbursement.service.js';
import {
  DisbursementReasonDto,
  GenerateFileDto,
  ImportReturnsDto,
} from './dto/disbursement.dto.js';

@Controller()
export class DisbursementController {
  constructor(private readonly disbursementService: DisbursementService) {}

  // GET /disbursement-formats
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.disburse')
  @Get('disbursement-formats')
  listFormats() {
    return ADAPTERS.map((a) => ({
      code: a.code,
      channel: a.channel,
      label: a.label,
    }));
  }

  // GET /payroll-runs/:runId/payments
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.disburse', 'payroll.verify', 'payroll.prepare')
  @Get('payroll-runs/:runId/payments')
  listPayments(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.disbursementService.listPayments(runId);
  }

  // POST /payroll-runs/:runId/disbursement-files
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.disburse')
  @RequireStepUp()
  @Post('payroll-runs/:runId/disbursement-files')
  generateFile(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: GenerateFileDto,
  ) {
    return this.disbursementService.generateFile(runId, dto);
  }

  // GET /payroll-runs/:runId/disbursement-files
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.disburse', 'payroll.verify', 'payroll.prepare')
  @Get('payroll-runs/:runId/disbursement-files')
  listFiles(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.disbursementService.listFiles(runId);
  }

  // GET /disbursement-files/:fileId/download
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.disburse')
  @Get('disbursement-files/:fileId/download')
  async downloadFile(@Param('fileId', ParseUUIDPipe) fileId: string) {
    const file = await this.disbursementService.downloadFile(fileId);
    return new StreamableFile(file.content, {
      type: `${file.contentType}; charset=utf-8`,
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  // POST /disbursement-files/:fileId/settle
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.disburse')
  @Post('disbursement-files/:fileId/settle')
  @HttpCode(200)
  settleFile(@Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.disbursementService.settleFile(fileId);
  }

  // POST /disbursement-files/:fileId/returns
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.disburse')
  @Post('disbursement-files/:fileId/returns')
  @HttpCode(200)
  importReturns(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: ImportReturnsDto,
  ) {
    return this.disbursementService.importReturns(fileId, dto);
  }

  // POST /disbursement-files/:fileId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.disburse')
  @Post('disbursement-files/:fileId/cancel')
  @HttpCode(200)
  cancelFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Body() dto: DisbursementReasonDto,
  ) {
    return this.disbursementService.cancelFile(fileId, dto);
  }

  // POST /payments/:paymentId/reissue
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.disburse')
  @RequireStepUp()
  @Post('payments/:paymentId/reissue')
  reissue(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: DisbursementReasonDto,
  ) {
    return this.disbursementService.reissue(paymentId, dto);
  }
}
