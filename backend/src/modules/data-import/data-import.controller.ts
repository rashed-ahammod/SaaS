/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /imports/templates                              the seven templates and their columns (load in this order)
 *   GET   /imports/templates/:entity?format=xlsx|csv      download a template
 *   POST  /companies/:companyId/imports                   multipart/form-data: file, entity, cutOverDate  -> validated batch
 *   GET   /companies/:companyId/imports                   batches
 *   GET   /imports/:batchId                               batch with every row and its errors
 *   POST  /imports/:batchId/rows/:rowNo/skip              { reason }
 *   GET   /imports/:batchId/dry-run                       what commit would create, totals per department
 *   POST  /imports/:batchId/commit                        create everything in one transaction
 *   POST  /imports/:batchId/rollback                      { reason }  until signed off
 *   POST  /imports/:batchId/discard                       drop a batch that will not be committed
 *   GET   /companies/:companyId/migration/reconciliation?cutOverDate=2026-10-01
 *   POST  /companies/:companyId/migration/sign-off        { cutOverDate, note }  (Admin)
 *   GET   /companies/:companyId/migration/sign-offs
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { DataImportService, MAX_IMPORT_BYTES } from './data-import.service.js';
import {
  ImportReasonDto,
  ReconciliationQueryDto,
  SignOffDto,
  TemplateQueryDto,
  UploadImportDto,
} from './dto/data-import.dto.js';
import { ReconciliationService } from './reconciliation.service.js';
import { templateCsv, templateXlsx } from './spreadsheet.js';
import { TEMPLATES, templateOf } from './templates.js';

const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller()
export class DataImportController {
  constructor(
    private readonly dataImportService: DataImportService,
    private readonly reconciliationService: ReconciliationService,
  ) {}

  // GET /imports/templates
  @UseGuards(AuthGuard)
  @RequirePermission('data.import')
  @Get('imports/templates')
  listTemplates() {
    return TEMPLATES;
  }

  // GET /imports/templates/:entity?format=xlsx|csv
  @UseGuards(AuthGuard)
  @RequirePermission('data.import')
  @Get('imports/templates/:entity')
  async downloadTemplate(
    @Param('entity') entity: string,
    @Query() query: TemplateQueryDto,
  ) {
    const t = templateOf(entity);
    if (!t) throw new NotFoundException(`No template "${entity}"`);
    if (query.format === 'csv') {
      return new StreamableFile(Buffer.from(templateCsv(t), 'utf8'), {
        type: 'text/csv; charset=utf-8',
        disposition: `attachment; filename="${t.order}-${t.entity}.csv"`,
      });
    }
    return new StreamableFile(await templateXlsx(t), {
      type: XLSX,
      disposition: `attachment; filename="${t.order}-${t.entity}.xlsx"`,
    });
  }

  // POST /companies/:companyId/imports
  @UseGuards(AuthGuard)
  @RequirePermission('data.import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMPORT_BYTES, files: 1 },
    }),
  )
  @Post('companies/:companyId/imports')
  upload(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadImportDto,
  ) {
    return this.dataImportService.upload(companyId, file, dto);
  }

  // GET /companies/:companyId/imports
  @UseGuards(AuthGuard)
  @RequirePermission('data.import', 'data.import.sign_off')
  @Get('companies/:companyId/imports')
  listBatches(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.dataImportService.listBatches(companyId);
  }

  // GET /imports/:batchId
  @UseGuards(AuthGuard)
  @RequirePermission('data.import', 'data.import.sign_off')
  @Get('imports/:batchId')
  getBatch(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.dataImportService.getBatch(batchId);
  }

  // POST /imports/:batchId/rows/:rowNo/skip
  @UseGuards(AuthGuard)
  @RequirePermission('data.import')
  @Post('imports/:batchId/rows/:rowNo/skip')
  @HttpCode(200)
  skipRow(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Param('rowNo', ParseIntPipe) rowNo: number,
    @Body() dto: ImportReasonDto,
  ) {
    return this.dataImportService.skipRow(batchId, rowNo, dto);
  }

  // GET /imports/:batchId/dry-run
  @UseGuards(AuthGuard)
  @RequirePermission('data.import')
  @Get('imports/:batchId/dry-run')
  dryRun(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.dataImportService.dryRun(batchId);
  }

  // POST /imports/:batchId/commit
  @UseGuards(AuthGuard)
  @RequirePermission('data.import')
  @Post('imports/:batchId/commit')
  @HttpCode(200)
  commit(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.dataImportService.commit(batchId);
  }

  // POST /imports/:batchId/rollback
  @UseGuards(AuthGuard)
  @RequirePermission('data.import')
  @Post('imports/:batchId/rollback')
  @HttpCode(200)
  rollback(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() dto: ImportReasonDto,
  ) {
    return this.dataImportService.rollback(batchId, dto);
  }

  // POST /imports/:batchId/discard
  @UseGuards(AuthGuard)
  @RequirePermission('data.import')
  @Post('imports/:batchId/discard')
  @HttpCode(200)
  discard(@Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.dataImportService.discard(batchId);
  }

  // GET /companies/:companyId/migration/reconciliation?cutOverDate=2026-10-01
  @UseGuards(AuthGuard)
  @RequirePermission('data.import', 'data.import.sign_off')
  @Get('companies/:companyId/migration/reconciliation')
  reconciliation(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: ReconciliationQueryDto,
  ) {
    return this.reconciliationService.report(companyId, query.cutOverDate);
  }

  // POST /companies/:companyId/migration/sign-off
  @UseGuards(AuthGuard)
  @RequirePermission('data.import.sign_off')
  @Post('companies/:companyId/migration/sign-off')
  signOff(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SignOffDto,
  ) {
    return this.reconciliationService.signOff(companyId, dto);
  }

  // GET /companies/:companyId/migration/sign-offs
  @UseGuards(AuthGuard)
  @RequirePermission('data.import', 'data.import.sign_off')
  @Get('companies/:companyId/migration/sign-offs')
  listSignoffs(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.reconciliationService.listSignoffs(companyId);
  }
}
