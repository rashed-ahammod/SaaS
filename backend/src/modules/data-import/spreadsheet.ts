/**
 * Reading uploaded migration files (Excel .xlsx or .csv) into plain text cells,
 * and building the downloadable templates.
 */
import ExcelJS from 'exceljs';
import type { TemplateDef } from './templates.js';

export const MAX_IMPORT_ROWS = 5000;

export interface Sheet {
  headers: string[];
  rows: Array<{ rowNo: number; cells: Record<string, string> }>;
}

/** "Employee Code " -> "employee_code" */
export function normalizeHeader(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Read the first worksheet (xlsx) or the CSV text. Empty rows are ignored. */
export async function readSheet(
  content: Buffer,
  fileName: string,
): Promise<Sheet> {
  const grid = fileName.toLowerCase().endsWith('.xlsx')
    ? await readXlsx(content)
    : parseCsv(content.toString('utf8').replace(/^﻿/, ''));
  const [header, ...body] = grid;
  if (!header) return { headers: [], rows: [] };
  const headers = header.map((h) => normalizeHeader(h.value));
  const rows: Sheet['rows'] = [];
  for (const line of body) {
    if (line.every((c) => c.value.trim() === '')) continue;
    const cells: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) cells[h] = (line[i]?.value ?? '').trim();
    });
    rows.push({ rowNo: line[0]?.rowNo ?? 0, cells });
  }
  return { headers: headers.filter(Boolean), rows };
}

type Cell = { value: string; rowNo: number };

async function readXlsx(content: Buffer): Promise<Cell[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(content as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const grid: Cell[][] = [];
  const width = sheet.columnCount;
  sheet.eachRow({ includeEmpty: false }, (row, rowNo) => {
    const line: Cell[] = [];
    for (let c = 1; c <= width; c++)
      line.push({ value: cellText(row.getCell(c).value), rowNo });
    grid.push(line);
  });
  return grid;
}

/** Text of an Excel cell: dates as YYYY-MM-DD, numbers as typed, rich text joined. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text);
  }
  return String(value);
}

/** CSV with quoted cells (quotes doubled inside, line breaks allowed inside quotes). */
export function parseCsv(text: string): Cell[][] {
  const grid: Cell[][] = [];
  let line: Cell[] = [];
  let current = '';
  let quoted = false;
  let rowNo = 1;
  let startRow = 1;
  const endCell = () => {
    line.push({ value: current, rowNo: startRow });
    current = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') rowNo++;
        current += ch;
      }
    } else if (ch === '"') quoted = true;
    else if (ch === ',') endCell();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endCell();
      grid.push(line);
      line = [];
      rowNo++;
      startRow = rowNo;
    } else current += ch;
  }
  if (current !== '' || line.length) {
    endCell();
    grid.push(line);
  }
  return grid;
}

// ------------------------------------------------------------------ templates

/** Excel template: the data sheet (header + one example row) and an instructions sheet. */
export async function templateXlsx(t: TemplateDef): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ERP data migration';
  const data = workbook.addWorksheet(t.entity);
  data.columns = t.columns.map((c) => ({
    header: c.key,
    key: c.key,
    width: Math.max(14, c.key.length + 4),
  }));
  data.getRow(1).font = { bold: true };
  data.addRow(Object.fromEntries(t.columns.map((c) => [c.key, c.example])));
  // every cell is text, so codes such as 090261725 keep their leading zero
  for (let i = 1; i <= t.columns.length; i++) data.getColumn(i).numFmt = '@';

  const help = workbook.addWorksheet('instructions');
  help.columns = [
    { header: 'column', key: 'column', width: 22 },
    { header: 'required', key: 'required', width: 10 },
    { header: 'description', key: 'description', width: 80 },
  ];
  help.getRow(1).font = { bold: true };
  help.addRow({
    column: `${t.order}. ${t.title}`,
    required: '',
    description: `${t.description} Delete the example row before uploading.`,
  });
  for (const c of t.columns)
    help.addRow({
      column: c.key,
      required: c.required ? 'yes' : '',
      description: c.description,
    });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function templateCsv(t: TemplateDef): string {
  const cell = (v: string) =>
    /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return (
    [
      t.columns.map((c) => c.key).join(','),
      t.columns.map((c) => cell(c.example)).join(','),
    ].join('\r\n') + '\r\n'
  );
}
