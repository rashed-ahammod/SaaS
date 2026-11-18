/**
 * Employee documents (guide §7.3): NID scan, certificates, contract ...
 *
 * - Only PDF, JPG, PNG up to 10 MB; the type is checked from the file content.
 * - Files are kept in FileStorage; the table holds the details and a SHA-256.
 * - Documents are never deleted, only marked "removed" with a reason.
 * - Every download is audited (spec §11: exports of personal data are logged).
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  addDays,
  businessDate,
  daysBetween,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { EmployeeDocument } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import {
  detectFileType,
  FileStorage,
} from '../../platform/storage/file-storage.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  RemoveDocumentDto,
  UploadDocumentDto,
} from './dto/document.dto.js';
import { EmployeeAccess } from './employee-access.js';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
    private readonly employeeAccess: EmployeeAccess,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly clock: Clock,
    private readonly outbox: OutboxService,
  ) {}

  async uploadDocument(
    employeeId: string,
    file: Express.Multer.File | undefined,
    dto: UploadDocumentDto,
  ) {
    // check access and file
    await this.employeeAccess.check('employee.manage', employeeId);
    if (!file) throw new BadRequestException(MSG.FILE_REQUIRED);
    const contentType = detectFileType(file.buffer);
    if (!contentType || file.size > MAX_DOCUMENT_BYTES)
      throw new BadRequestException(MSG.FILE_TYPE_NOT_ALLOWED);

    // store the file first; if saving the row fails, the file is only an orphan, never a broken link
    const fileKey = `${requestContext.get().tenantId}/employee-documents/${randomUUID()}`;
    await this.storage.put(fileKey, file.buffer);

    // save details
    const document = await this.db.tx
      .insertInto('employee_documents')
      .values({
        employee_id: employeeId,
        doc_type: dto.docType,
        title: dto.title ?? null,
        file_key: fileKey,
        file_name: safeFileName(file.originalname),
        content_type: contentType,
        size_bytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        expires_on: dto.expiresOn ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.audit.record({
      action: 'employee.document_uploaded',
      entity: 'employee_document',
      entityId: document.id,
      after: {
        employeeId,
        docType: dto.docType,
        fileName: document.file_name,
        sha256: document.sha256,
      },
    });
    return toDocumentResponse(document);
  }

  /**
   * A supporting document for a request (e.g. a doctor's certificate for sick leave),
   * uploaded by the employee themself or by HR. The CALLER checks that the user may act
   * for this employee; this only checks the file. Stored as an ordinary document.
   */
  async uploadSupportingDocument(
    employeeId: string,
    file: Express.Multer.File | undefined,
    title: string,
  ) {
    if (!file) throw new BadRequestException(MSG.FILE_REQUIRED);
    const contentType = detectFileType(file.buffer);
    if (!contentType || file.size > MAX_DOCUMENT_BYTES)
      throw new BadRequestException(MSG.FILE_TYPE_NOT_ALLOWED);
    const fileKey = `${requestContext.get().tenantId}/employee-documents/${randomUUID()}`;
    await this.storage.put(fileKey, file.buffer);
    const document = await this.db.tx
      .insertInto('employee_documents')
      .values({
        employee_id: employeeId,
        doc_type: 'other',
        title,
        file_key: fileKey,
        file_name: safeFileName(file.originalname),
        content_type: contentType,
        size_bytes: file.size,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'employee.document_uploaded',
      entity: 'employee_document',
      entityId: document.id,
      after: {
        employeeId,
        docType: 'other',
        title,
        fileName: document.file_name,
        sha256: document.sha256,
      },
    });
    return toDocumentResponse(document);
  }

  /**
   * Documents of the company that have expired or expire soon — contracts, NID,
   * licences, work permits. The expiry date is captured on upload and was until
   * now only visible on that one employee's screen, so a contract could end with
   * nobody noticing. Separated employees are left out; each row is still checked
   * against the caller's own access (a Dept Head sees their department only).
   */
  async listExpiringDocuments(companyId: string, withinDays = 60) {
    await this.org.assertCompanyExists(companyId);
    const today = todayInDhaka();
    const rows = await this.db.tx
      .selectFrom('employee_documents')
      .innerJoin('employees', 'employees.id', 'employee_documents.employee_id')
      .select([
        'employee_documents.id as id',
        'employee_documents.employee_id as employee_id',
        'employee_documents.doc_type as doc_type',
        'employee_documents.title as title',
        'employee_documents.expires_on as expires_on',
        'employees.employee_code as employee_code',
        'employees.full_name_en as full_name_en',
        'employees.full_name_bn as full_name_bn',
      ])
      .where('employees.company_id', '=', companyId)
      .where('employees.status', '!=', 'separated')
      .where('employee_documents.status', '=', 'active')
      .where('employee_documents.expires_on', 'is not', null)
      .where('employee_documents.expires_on', '<=', addDays(today, withinDays))
      .orderBy('employee_documents.expires_on')
      .execute();

    const out = [];
    for (const r of rows) {
      const resource = await this.employeeAccess.resourceOf(
        await this.employeeAccess.find(r.employee_id),
      );
      if (
        !this.access.allows('employee.documents.view', resource) &&
        !this.access.allows('employee.manage', resource)
      )
        continue;
      out.push({
        id: r.id,
        employeeId: r.employee_id,
        employeeCode: r.employee_code,
        fullNameEn: r.full_name_en,
        fullNameBn: r.full_name_bn,
        docType: r.doc_type,
        title: r.title,
        expiresOn: r.expires_on,
        daysLeft: daysBetween(businessDate(today), businessDate(r.expires_on!)),
      });
    }
    return out;
  }

  /**
   * Expiry alerts (WP31): a document that runs out needs replacing before it does, and HR
   * only notices if something tells them. One event per document per stage (30 days, 7 days,
   * expired), tracked on the row itself, so a replay or a second worker sends nothing twice.
   *
   * Company renewals — trade licence, insurance, vendor agreements — are the compliance
   * calendar's job (WP21), which already reminds at 7 days, 1 day and overdue. This is for
   * the documents attached to people.
   */
  async remindExpiringDocuments(): Promise<number> {
    const today = todayInDhaka(this.clock.now());
    const stages: Array<{
      stage: 'expired' | 'days_7' | 'days_30';
      until: string;
      column: 'reminded_expired' | 'reminded_7' | 'reminded_30';
      prefixed: 'd.reminded_expired' | 'd.reminded_7' | 'd.reminded_30';
    }> = [
      {
        stage: 'expired',
        until: today,
        column: 'reminded_expired',
        prefixed: 'd.reminded_expired',
      },
      {
        stage: 'days_7',
        until: addDays(today, 7),
        column: 'reminded_7',
        prefixed: 'd.reminded_7',
      },
      {
        stage: 'days_30',
        until: addDays(today, 30),
        column: 'reminded_30',
        prefixed: 'd.reminded_30',
      },
    ];
    let sent = 0;
    for (const { stage, until, column, prefixed } of stages) {
      const due = await this.db.tx
        .selectFrom('employee_documents as d')
        .innerJoin('employees as e', 'e.id', 'd.employee_id')
        .select([
          'd.id',
          'd.employee_id',
          'd.doc_type',
          'd.expires_on',
          'e.company_id',
        ])
        .where('d.status', '=', 'active')
        .where('e.status', '<>', 'separated')
        .where('d.expires_on', 'is not', null)
        .where('d.expires_on', '<=', until)
        .where(prefixed, '=', false)
        .limit(500)
        .execute();
      for (const doc of due) {
        // the flag is set first and only sent when this call is the one that set it, so two
        // workers running at once send one event between them
        const claimed = await this.db.tx
          .updateTable('employee_documents')
          .set({ [column]: true } as never)
          .where('id', '=', doc.id)
          .where(column, '=', false)
          .executeTakeFirst();
        if (claimed.numUpdatedRows === 0n) continue;
        await this.outbox.add({
          type: 'document.expiring',
          entityId: doc.id,
          payload: {
            documentId: doc.id,
            companyId: doc.company_id,
            employeeId: doc.employee_id,
            docType: doc.doc_type,
            expiresOn: doc.expires_on,
            stage,
          },
        });
        sent += 1;
      }
    }
    return sent;
  }

  async listDocuments(employeeId: string, includeRemoved = false) {
    await this.employeeAccess.check('employee.documents.view', employeeId);
    let q = this.db.tx
      .selectFrom('employee_documents')
      .selectAll()
      .where('employee_id', '=', employeeId);
    if (!includeRemoved) q = q.where('status', '=', 'active');
    const documents = await q.orderBy('created_at', 'desc').execute();
    return documents.map(toDocumentResponse);
  }

  /** Returns the file content and details for download. */
  async downloadDocument(employeeId: string, documentId: string) {
    // check access and find document
    await this.employeeAccess.check('employee.documents.view', employeeId);
    const document = await this.findDocument(employeeId, documentId);

    // read file and log the download
    const content = await this.storage.get(document.file_key);
    await this.audit.record({
      action: 'employee.document_downloaded',
      entity: 'employee_document',
      entityId: document.id,
      after: { employeeId, fileName: document.file_name },
    });
    return {
      content,
      fileName: document.file_name,
      contentType: document.content_type,
    };
  }

  async removeDocument(
    employeeId: string,
    documentId: string,
    dto: RemoveDocumentDto,
  ) {
    // check access and find document
    await this.employeeAccess.check('employee.manage', employeeId);
    const document = await this.findDocument(employeeId, documentId);
    if (document.status === 'removed') return toDocumentResponse(document);

    // mark removed (the file is kept for the audit trail)
    const updated = await this.db.tx
      .updateTable('employee_documents')
      .set({ status: 'removed', removed_reason: dto.reason })
      .where('id', '=', documentId)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'employee.document_removed',
      entity: 'employee_document',
      entityId: documentId,
      after: { employeeId, reason: dto.reason },
    });
    return toDocumentResponse(updated);
  }

  // ------------------------------------------------------------------ helpers

  private async findDocument(
    employeeId: string,
    documentId: string,
  ): Promise<EmployeeDocument> {
    const document = await this.db.tx
      .selectFrom('employee_documents')
      .selectAll()
      .where('id', '=', documentId)
      .where('employee_id', '=', employeeId)
      .executeTakeFirst();
    if (!document) throw new NotFoundException(MSG.DOCUMENT_NOT_FOUND);
    return document;
  }
}

/** Keep the original name for download, without path parts or odd characters. */
function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 150) || 'file';
}

function toDocumentResponse(d: EmployeeDocument) {
  return {
    id: d.id,
    employeeId: d.employee_id,
    docType: d.doc_type,
    title: d.title,
    fileName: d.file_name,
    contentType: d.content_type,
    sizeBytes: d.size_bytes,
    sha256: d.sha256,
    expiresOn: d.expires_on,
    status: d.status,
    removedReason: d.removed_reason,
    uploadedAt: d.created_at,
    uploadedBy: d.created_by,
  };
}
