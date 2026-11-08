/**
 * CSV for a person, not a data feed: one page of a spreadsheet that Excel on a
 * Windows machine in Dhaka opens with the Bangla names intact.
 *
 * Two rules the whole product follows:
 *   - a cell is quoted only when it has to be, so a Bangla name with a comma survives;
 *   - the file starts with a UTF-8 BOM, or Excel reads Bangla as mojibake.
 *
 * An export is capped (EXPORT_MAX_ROWS) and audited by its caller, because
 * personal data leaving the system is an event worth recording (spec §11).
 */

/** A CSV export is a list for a person: one page of a spreadsheet, not the whole database. */
export const EXPORT_MAX_ROWS = 5000;

/** One CSV cell: quoted when it has to be, so a Bangla name with a comma survives Excel. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A whole file: the header, the rows, CRLF line ends and the BOM Excel needs. */
export function csvFile(
  header: string[],
  rows: Array<Array<string | number | null | undefined>>,
): Buffer {
  const lines = [
    header.join(','),
    ...rows.map((r) => r.map(csvCell).join(',')),
  ];
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}
