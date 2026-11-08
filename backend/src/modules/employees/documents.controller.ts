/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST /employees/:employeeId/documents                         multipart/form-data: file, docType, title?, expiresOn?
 *   GET  /employees/:employeeId/documents?includeRemoved=true
 *   GET  /employees/:employeeId/documents/:documentId/file        downloads the file
 *   POST /employees/:employeeId/documents/:documentId/remove      { reason }
 *   GET  /companies/:companyId/document-expiries?withinDays=60    expired / expiring soon, whole company
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
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
import { DocumentsService, MAX_DOCUMENT_BYTES } from './documents.service.js';
import {
  DocumentExpiryQueryDto,
  RemoveDocumentDto,
  UploadDocumentDto,
} from './dto/document.dto.js';

@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // POST /employees/:employeeId/documents
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
    }),
  )
  @Post('employees/:employeeId/documents')
  uploadDocument(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
  ) {
    return this.documentsService.uploadDocument(employeeId, file, dto);
  }

  // GET /companies/:companyId/document-expiries
  @UseGuards(AuthGuard)
  @RequirePermission('employee.documents.view', 'employee.manage')
  @Get('companies/:companyId/document-expiries')
  listExpiring(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: DocumentExpiryQueryDto,
  ) {
    return this.documentsService.listExpiringDocuments(
      companyId,
      query.withinDays ?? 60,
    );
  }

  // GET /employees/:employeeId/documents
  @UseGuards(AuthGuard)
  @RequirePermission('employee.documents.view')
  @Get('employees/:employeeId/documents')
  listDocuments(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query('includeRemoved', new ParseBoolPipe({ optional: true }))
    includeRemoved?: boolean,
  ) {
    return this.documentsService.listDocuments(
      employeeId,
      includeRemoved ?? false,
    );
  }

  // GET /employees/:employeeId/documents/:documentId/file
  @UseGuards(AuthGuard)
  @RequirePermission('employee.documents.view')
  @Get('employees/:employeeId/documents/:documentId/file')
  async downloadDocument(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    const file = await this.documentsService.downloadDocument(
      employeeId,
      documentId,
    );
    return new StreamableFile(file.content, {
      type: file.contentType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }

  // POST /employees/:employeeId/documents/:documentId/remove
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @Post('employees/:employeeId/documents/:documentId/remove')
  @HttpCode(200)
  removeDocument(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: RemoveDocumentDto,
  ) {
    return this.documentsService.removeDocument(employeeId, documentId, dto);
  }
}
