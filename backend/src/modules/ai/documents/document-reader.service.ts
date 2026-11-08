/**
 * The bill and receipt reader (spec §8, Phase 2 WP22): a photo or PDF of a vendor bill
 * (Mushak 6.3) or a receipt -> the fields to fill in, for a person to check. Nothing is
 * saved: the bill form (portal) and the expense claim (app) are prefilled, and the person
 * corrects and submits as usual.
 *
 *   read(file, kind, companyId?)
 *     1. the feature is offered (plan, switched on, release gate, quota)
 *     2. a JPEG, PNG, WebP or PDF of at most 5 MB
 *     3. the model reads it and answers JSON in a fixed shape; anything else is "unreadable"
 *     4. the figures are checked (lines add up to the total, VAT to the VAT); the vendor is
 *        found among the company's vendors by BIN, then by name, when the user may see them
 *
 * The file itself goes to the provider unmasked (a business document: the supplier's
 * BIN / TIN are on it by law); the tenant's Admin switches the feature on knowingly.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../platform/db/database.service.js';
import { MSG } from '../../../platform/i18n/messages.js';
import { Money } from '../../../platform/money/money.js';
import { detectFileType } from '../../../platform/storage/file-storage.js';
import { AccessService } from '../../identity/access/access.service.js';
import { AiGatewayService } from '../gateway/ai-gateway.service.js';

export const DOCUMENT_PROMPT_VERSION = 'document-reader-v1';
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export interface ReadDocument {
  vendorName: string | null;
  vendorBin: string | null;
  documentNo: string | null;
  date: string | null;
  lines: Array<{
    description: string;
    amount: string;
    vatPercent: string | null;
  }>;
  subtotal: string | null;
  vat: string | null;
  total: string | null;
}

export function documentSystemPrompt(kind: 'bill' | 'receipt'): string {
  return [
    `You read a ${kind === 'bill' ? 'vendor bill (often a Bangladesh VAT invoice, Mushak 6.3)' : 'receipt for a business expense'} for an accountant in Bangladesh.`,
    'Copy what is printed; never guess a figure you cannot read (use null).',
    'Amounts in taka as plain numbers with at most 2 decimals (1,25,000.50 -> 125000.50). Dates as YYYY-MM-DD (Bangladesh writes the day first).',
    'Line amounts are before VAT. vatPercent is the VAT rate printed for the line, or null.',
    'Answer with JSON only, in exactly this shape:',
    '{"vendorName": string|null, "vendorBin": string|null, "documentNo": string|null, "date": string|null, "lines": [{"description": string, "amount": string, "vatPercent": string|null}], "subtotal": string|null, "vat": string|null, "total": string|null}',
  ].join('\n');
}

const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;

/** The model's answer, checked field by field; anything malformed becomes null. */
export function parseDocument(answer: string): ReadDocument | null {
  const json = /\{[\s\S]*\}/.exec(answer)?.[0];
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json ?? '');
  } catch {
    return null;
  }
  const text = (v: unknown, max = 200) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const amount = (v: unknown) => {
    const s =
      typeof v === 'number'
        ? String(v)
        : typeof v === 'string'
          ? v.replace(/[,\s]/g, '').replace(/^(tk|bdt|৳)/i, '')
          : '';
    return AMOUNT.test(s) ? Money.of(s).toDb() : null;
  };
  const date = (v: unknown) =>
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
      ? v
      : null;
  const lines = Array.isArray(raw.lines)
    ? (raw.lines as Array<Record<string, unknown>>)
        .slice(0, 50)
        .flatMap((l) => {
          const a = amount(l?.amount);
          const d = text(l?.description, 300);
          const p =
            l?.vatPercent === null || l?.vatPercent === undefined
              ? null
              : amount(l.vatPercent);
          return a && d ? [{ description: d, amount: a, vatPercent: p }] : [];
        })
    : [];
  // a BIN as 000123456-0101 (the space or missing dash of a photo put right)
  const digits = text(raw.vendorBin, 30)?.replace(/[\s-]/g, '') ?? null;
  const bin =
    digits && /^[0-9]{13}$/.test(digits)
      ? `${digits.slice(0, 9)}-${digits.slice(9)}`
      : digits;
  const read = {
    vendorName: text(raw.vendorName),
    vendorBin: bin && /^[0-9]{9}(-?[0-9]{4})?$/.test(bin) ? bin : null,
    documentNo: text(raw.documentNo, 60),
    date: date(raw.date),
    lines,
    subtotal: amount(raw.subtotal),
    vat: amount(raw.vat),
    total: amount(raw.total),
  };
  // the model said it cannot read it, or nothing useful came out
  if (
    raw.unreadable === true ||
    (!read.lines.length && !read.total && !read.documentNo && !read.vendorName)
  )
    return null;
  return read;
}

/** What does not add up (the person checks these first). */
export function warningsOf(d: ReadDocument): string[] {
  const out: string[] = [];
  const sum = Money.sum(d.lines.map((l) => l.amount));
  if (d.subtotal && d.lines.length && !sum.equals(d.subtotal))
    out.push(`lines_do_not_add_up: ${sum.toDb()} <> ${d.subtotal}`);
  if (d.subtotal && d.total) {
    const expected = Money.of(d.subtotal).plus(d.vat ?? '0');
    if (!expected.equals(d.total))
      out.push(`total_does_not_add_up: ${expected.toDb()} <> ${d.total}`);
  }
  if (!d.date) out.push('date_not_read');
  if (!d.lines.length) out.push('no_lines_read');
  return out;
}

@Injectable()
export class DocumentReaderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: AiGatewayService,
    private readonly access: AccessService,
  ) {}

  async read(
    file: Express.Multer.File | undefined,
    kind: 'bill' | 'receipt',
    companyId?: string,
  ) {
    await this.gateway.assertAvailable(
      'document_reader',
      DOCUMENT_PROMPT_VERSION,
    );
    const mediaType = file?.buffer
      ? (detectFileType(file.buffer) ??
        (file.buffer.subarray(8, 12).toString('latin1') === 'WEBP'
          ? 'image/webp'
          : undefined))
      : undefined;
    if (!file || !mediaType || file.size > MAX_DOCUMENT_BYTES)
      throw new BadRequestException(MSG.DOCUMENT_UNREADABLE);
    const result = await this.readFile(
      { mediaType, data: file.buffer },
      kind,
      `document:${kind}:${file.originalname}`.slice(0, 200),
    );
    const fields = result.fields;
    const vendor =
      fields && companyId ? await this.matchVendor(companyId, fields) : null;
    return {
      kind,
      readable: !!fields,
      fields,
      warnings: fields ? warningsOf(fields) : [],
      vendor,
      interactionId: result.interactionId,
    };
  }

  /** The model call itself; the test set (npm run ai:eval) calls it with sample files. */
  async readFile(
    file: { mediaType: string; data: Buffer },
    kind: 'bill' | 'receipt',
    inputRef: string,
    evaluation = false,
  ) {
    const run = await this.gateway.run({
      feature: 'document_reader',
      promptVersion: DOCUMENT_PROMPT_VERSION,
      inputRef,
      system: documentSystemPrompt(kind),
      messages: [
        {
          role: 'user',
          text: `TASK: read_document (${kind}). Read this document.`,
          files: [file],
        },
      ],
      maxTokens: 2000,
      ignoreReleaseGate: evaluation,
    });
    return {
      fields: parseDocument(run.answer),
      answer: run.answer,
      interactionId: run.interactionId,
    };
  }

  /** Short transactions: each lookup opens its own. */
  private async matchVendor(companyId: string, d: ReadDocument) {
    return this.db.transaction(async () => {
      if (!this.access.allows('payables.view', { companyId })) return null;
      const vendors = await this.db.tx
        .selectFrom('vendors')
        .select(['id', 'code', 'name', 'bin'])
        .where('company_id', '=', companyId)
        .where('is_active', '=', true)
        .execute();
      const squash = (s: string | null) =>
        (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const byBin = d.vendorBin
        ? vendors.find((v) => v.bin && squash(v.bin) === squash(d.vendorBin))
        : undefined;
      const byName =
        !byBin && d.vendorName
          ? vendors.find(
              (v) =>
                squash(v.name).includes(squash(d.vendorName)) ||
                squash(d.vendorName).includes(squash(v.name)),
            )
          : undefined;
      const v = byBin ?? byName;
      return v
        ? {
            id: v.id,
            code: v.code,
            name: v.name,
            matchedBy: byBin ? 'bin' : 'name',
          }
        : null;
    });
  }
}
