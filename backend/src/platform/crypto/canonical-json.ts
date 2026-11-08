/**
 * Canonical JSON: the same data always produces the same text, whatever order
 * the object keys were written in. Used wherever a hash must be reproducible
 * (audit hash chain, idempotency request hash, payroll input hash).
 *
 *   canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })  ->  '{"a":[2,{"c":4,"d":3}],"b":1}'
 *
 * Values are first passed through JSON.stringify's rules (Dates become ISO
 * strings, undefined properties are dropped, Money becomes its string).
 */
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  return serialize(
    value === undefined ? null : JSON.parse(JSON.stringify(value)),
  );
}

function serialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`).join(',')}}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
