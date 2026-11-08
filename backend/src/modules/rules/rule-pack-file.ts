/**
 * The rule pack file format (rule-packs/*.json) and its checks.
 * Pure code: no database (rule-pack-file.spec.ts).
 *
 * A file can never mark a value as verified: verification is a separate,
 * named act by the compliance owner (`npm run rules:verify`).
 */
import { businessDate } from '../../platform/dates/business-date.js';
import type { RuleValueType } from '../../platform/db/schema.js';

export interface RulePackFile {
  code: string;
  version: string;
  title: string;
  notes?: string;
  values: RuleValueEntry[];
}

export interface RuleValueEntry {
  key: string;
  type: RuleValueType;
  unit?: string;
  value: unknown;
  effectiveFrom: string;
  effectiveTo?: string;
  descriptionEn: string;
  descriptionBn?: string;
  sourceNote?: string;
}

const TYPES: RuleValueType[] = [
  'integer',
  'decimal',
  'money',
  'boolean',
  'text',
  'json',
];
const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Returns a list of problems; empty when the file is valid. */
export function validateRulePackFile(file: RulePackFile): string[] {
  const problems: string[] = [];
  if (!/^[A-Z0-9-]{2,30}$/.test(file.code ?? ''))
    problems.push('code must be upper-case letters, digits, "-"');
  if (!/^[0-9]{4}\.[0-9]{1,3}$/.test(file.version ?? ''))
    problems.push('version must look like 2026.1');
  if (!file.title) problems.push('title is required');
  if (!Array.isArray(file.values) || file.values.length === 0)
    problems.push('values must be a non-empty list');

  (file.values ?? []).forEach((v, i) => {
    const at = `values[${i}] (${v.key})`;
    if (!/^[a-z_]+(\.[a-z_0-9]+)+$/.test(v.key ?? ''))
      problems.push(`${at}: key must look like leave.maternity.days`);
    if (!TYPES.includes(v.type))
      problems.push(`${at}: type must be one of ${TYPES.join(', ')}`);
    if (!v.descriptionEn) problems.push(`${at}: descriptionEn is required`);
    if (!isValidDate(v.effectiveFrom))
      problems.push(`${at}: effectiveFrom must be YYYY-MM-DD`);
    if (
      v.effectiveTo !== undefined &&
      (!isValidDate(v.effectiveTo) || v.effectiveTo <= v.effectiveFrom)
    ) {
      problems.push(`${at}: effectiveTo must be a date after effectiveFrom`);
    }
    if ('status' in v || 'verifiedBy' in v)
      problems.push(
        `${at}: a file cannot mark values verified; use rules:verify`,
      );
    const typeProblem = checkValueType(v.type, v.value);
    if (typeProblem) problems.push(`${at}: ${typeProblem}`);
  });

  // one value per key per day
  const byKey = new Map<string, RuleValueEntry[]>();
  for (const v of file.values ?? [])
    byKey.set(v.key, [...(byKey.get(v.key) ?? []), v]);
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom),
    );
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].effectiveTo;
      if (prevEnd === undefined || prevEnd > sorted[i].effectiveFrom)
        problems.push(`${key}: periods overlap`);
    }
  }
  return problems;
}

function checkValueType(
  type: RuleValueType,
  value: unknown,
): string | undefined {
  switch (type) {
    case 'integer':
      return Number.isInteger(value)
        ? undefined
        : 'value must be a whole number';
    case 'decimal':
    case 'money':
      return typeof value === 'string' && DECIMAL.test(value)
        ? undefined
        : 'value must be a decimal written as a string, e.g. "2" or "0.10"';
    case 'boolean':
      return typeof value === 'boolean'
        ? undefined
        : 'value must be true or false';
    case 'text':
      return typeof value === 'string' ? undefined : 'value must be text';
    case 'json':
      return value !== null && typeof value === 'object'
        ? undefined
        : 'value must be an object or list';
  }
}

function isValidDate(text: string | undefined): boolean {
  if (!text) return false;
  try {
    businessDate(text);
    return true;
  } catch {
    return false;
  }
}
