/**
 * Turning an approval request into something the approver can read.
 *
 * Every module describes what it wants approved as a `snapshot` — a plain object
 * of its own field names. The decision screen used to print those names through a
 * camelCase-to-Title-Case transform, in English only, with the raw value beside
 * them, so a Dept Head approving three days of leave read
 *
 *     Leave Type Id  3f9a1c7e-…        From  2026-11-08        Half Day  null
 *
 * on the one screen where understanding matters most. These helpers give each
 * field its sentence in both languages (`appr.f.<key>`), format the value by what
 * it is, and drop what is noise: ids, nulls, and the internal keys an approver has
 * no use for. A field nobody has named yet still appears, under its tidied-up key,
 * because hiding it would hide what is being approved.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONEY = /^-?\d+(\.\d+)?$/;

/** Fields that exist for the machine, not the approver. */
const HIDDEN = new Set([
  "employeeId",
  "companyId",
  "sourceId",
  "approvalRequestId",
  "correctionId",
  "overtimeRequestId",
  "runId",
  "fileId",
  "accountId",
  "id",
]);

/** Keys whose value is money even though it arrives as a plain string. */
const TAKA = new Set([
  "amount",
  "total",
  "totalNet",
  "totalTax",
  "vat",
  "vds",
  "advance",
  "maxAmount",
  "minAmount",
]);

/** A key the approver should see, in the order the module listed them. */
export function snapshotFields(
  snapshot: Record<string, unknown>,
): Array<[string, unknown]> {
  return Object.entries(snapshot).filter(
    ([key, value]) =>
      !HIDDEN.has(key) &&
      !/Id$/.test(key) &&
      value !== null &&
      value !== undefined &&
      value !== "" &&
      !(typeof value === "string" && UUID.test(value)) &&
      !(Array.isArray(value) && value.length === 0),
  );
}

/** 'Half day' from 'halfDay', for a field nobody has given a sentence to yet. */
export function tidyKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

export interface ValueFormatters {
  date: (iso: string) => string;
  month: (period: string) => string;
  taka: (value: string | number) => string;
  number: (value: number) => string;
  yes: string;
  no: string;
}

/**
 * The value as a person reads it: a date in their own calendar format, money with
 * its symbol and digits, a boolean as yes or no, a list as a list. The caller
 * passes the formatters so this file stays free of the i18n hooks.
 */
export function formatSnapshotValue(
  key: string,
  value: unknown,
  f: ValueFormatters,
): string {
  if (typeof value === "boolean") return value ? f.yes : f.no;
  if (Array.isArray(value))
    return value.map((v) => formatSnapshotValue(key, v, f)).join(", ");
  if (typeof value === "number")
    return TAKA.has(key) ? f.taka(value) : f.number(value);
  if (typeof value === "string") {
    if (DATE.test(value)) return f.date(value);
    if (MONTH.test(value)) return f.month(value);
    if (TAKA.has(key) && MONEY.test(value)) return f.taka(value);
    return value;
  }
  return String(value);
}

/**
 * Why this person is on the chain, from the engine's own routing reason
 * ('line_manager', 'dept_head', 'role:hr', 'user:<id>'), as a text key.
 */
export function assignedBecauseKey(reason: string | null): string | null {
  if (!reason) return null;
  const rule = reason.split(":")[0];
  return ["line_manager", "dept_head", "role", "user"].includes(rule)
    ? `appr.because.${rule}`
    : null;
}
