/**
 * The tenant's own policy documents, which the assistant answers from
 * (guide §16: "policy answers from the tenant's own uploaded policy documents,
 * retrieval limited to that tenant" — row-level security does the limiting).
 *
 *   create(dto)       store the text and cut it into searchable pieces
 *   list()            documents, newest first
 *   deactivate(id)    no longer used for answers (kept for the audit trail)
 *   search(question)  the best-matching pieces (PostgreSQL full-text search,
 *                     Bangla words as written + English with stemming)
 *
 * The text is DATA for the model, never instructions: the assistant prompt wraps
 * each piece in <document> tags and says so.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../../platform/audit/audit.service.js';
import { Clock } from '../../../platform/clock.js';
import { DatabaseService } from '../../../platform/db/database.service.js';
import { MSG } from '../../../platform/i18n/messages.js';
import { requestContext } from '../../../platform/tenancy/request-context.js';
import type { CreatePolicyDocumentDto } from '../dto/ai.dto.js';
import { chunkPolicy } from './chunking.js';
import { words } from './text.js';

export interface PolicyHit {
  documentId: string;
  title: string;
  heading: string;
  excerpt: string;
}

@Injectable()
export class PolicyDocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async create(dto: CreatePolicyDocumentDto) {
    // cut into pieces (one Unicode form, so Bangla words match the search words)
    const body = dto.body.normalize('NFC');
    const chunks = chunkPolicy(body);

    // store document and pieces
    const doc = await this.db.tx
      .insertInto('ai_policy_documents')
      .values({
        title: dto.title.normalize('NFC'),
        language: dto.language,
        body,
        chunks: chunks.length,
        uploaded_by: requestContext.get().userId ?? null,
      })
      .returning(['id', 'title', 'language', 'chunks', 'created_at'])
      .executeTakeFirstOrThrow();
    if (chunks.length) {
      await this.db.tx
        .insertInto('ai_policy_chunks')
        .values(
          chunks.map((c, i) => ({
            document_id: doc.id,
            chunk_no: i + 1,
            heading: c.heading,
            content: c.content,
          })),
        )
        .execute();
    }
    await this.audit.record({
      action: 'ai_policy_document.created',
      entity: 'ai_policy_document',
      entityId: doc.id,
      after: {
        title: dto.title,
        language: dto.language,
        chunks: chunks.length,
      },
    });
    return {
      id: doc.id,
      title: doc.title,
      language: doc.language,
      chunks: doc.chunks,
      active: true,
      createdAt: doc.created_at,
    };
  }

  async list() {
    const rows = await this.db.tx
      .selectFrom('ai_policy_documents')
      .select([
        'id',
        'title',
        'language',
        'chunks',
        'active',
        'created_at',
        'deactivated_at',
      ])
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      language: r.language,
      chunks: r.chunks,
      active: r.active,
      createdAt: r.created_at,
      deactivatedAt: r.deactivated_at,
    }));
  }

  async get(id: string) {
    const row = await this.db.tx
      .selectFrom('ai_policy_documents')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundException(MSG.AI_POLICY_DOCUMENT_NOT_FOUND);
    return {
      id: row.id,
      title: row.title,
      language: row.language,
      body: row.body,
      chunks: row.chunks,
      active: row.active,
      createdAt: row.created_at,
      deactivatedAt: row.deactivated_at,
    };
  }

  async deactivate(id: string) {
    // find document
    const row = await this.db.tx
      .selectFrom('ai_policy_documents')
      .select(['id', 'active'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundException(MSG.AI_POLICY_DOCUMENT_NOT_FOUND);
    if (!row.active) return { id, active: false };

    // stop using it for answers
    await this.db.tx
      .updateTable('ai_policy_documents')
      .set({ active: false, deactivated_at: this.clock.now() })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'ai_policy_document.deactivated',
      entity: 'ai_policy_document',
      entityId: id,
    });
    return { id, active: false };
  }

  /** The best-matching pieces of the active documents for a question (any word may match; ranked). */
  async search(question: string, limit = 4): Promise<PolicyHit[]> {
    const terms = [...new Set(words(question))].slice(0, 20);
    if (!terms.length) return [];
    const either = terms.join(' | ');
    const query = sql`(to_tsquery('simple', ${either}) || to_tsquery('english', ${either}))`;
    const rows = await this.db.tx
      .selectFrom('ai_policy_chunks as c')
      .innerJoin('ai_policy_documents as d', 'd.id', 'c.document_id')
      .select(['c.document_id', 'd.title', 'c.heading', 'c.content'])
      .select(sql<number>`ts_rank_cd(c.tsv, ${query})`.as('rank'))
      .where('d.active', '=', true)
      .where(sql<boolean>`c.tsv @@ ${query}`)
      .orderBy('rank', 'desc')
      .orderBy('c.chunk_no')
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      documentId: r.document_id,
      title: r.title,
      heading: r.heading,
      excerpt: r.content,
    }));
  }
}
