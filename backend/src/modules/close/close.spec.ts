import { describe, expect, it } from 'vitest';
import {
  parseDocument,
  warningsOf,
} from '../ai/documents/document-reader.service.js';
import {
  compare,
  parseOldTrialBalance,
  parseOpening,
} from './trial-balance-files.js';

describe('the opening trial balance', () => {
  const head =
    'account_code,old_code,old_name,debit,credit,party,reference,date,due_date,department_code\n';

  it('reads balances with their open items, below a title, and checks it balances', () => {
    const csv =
      'Tally export: Meghna Foods Ltd, trial balance as at 30-09-2026\n\n' +
      head +
      [
        '1130,BNK-DBBL,Dutch-Bangla Bank,"8,50,000.00",,,,,,',
        '1150,SDR-001,Sundry debtors,"1,20,000.00",,Sylhet Agro Ltd,SA-0912,12/09/2026,12/10/2026,',
        '2110,SCR-001,Sundry creditors,,"85,000.00",V-0003,KT-5498,20-Sep-2026,,',
        '3100,CAP,Share capital,,"8,85,000.00",,,,,',
        'Total,,,"9,70,000.00","9,70,000.00",,,,,',
      ].join('\n');
    const r = parseOpening(csv);
    expect(r.problems).toEqual([]);
    expect([r.totalDebit, r.totalCredit]).toEqual(['970000.00', '970000.00']);
    expect(r.rows[1]).toMatchObject({
      accountCode: '1150',
      party: 'Sylhet Agro Ltd',
      reference: 'SA-0912',
      date: '2026-09-12',
      dueDate: '2026-10-12',
      debit: '120000.00',
    });
    expect(r.rows[2]).toMatchObject({ date: '2026-09-20', credit: '85000.00' });
  });

  it('refuses one that does not balance, and an old account sent to two of ours', () => {
    const r = parseOpening(
      head +
        '1130,BNK,Bank,100,,,,,,\n3100,CAP,Capital,,90,,,,,\n5210,BNK,Bank again,,10,,,,,\n',
    );
    expect(r.problems).toEqual([
      'Row 4: old account BNK is mapped to both 1130 and 5210',
    ]);
    expect(
      parseOpening(head + '1130,,,100,,,,,,\n3100,,,,90,,,,,\n').problems,
    ).toEqual([
      'The trial balance does not balance: debits 100.00, credits 90.00',
    ]);
  });
});

describe('the old system against ours', () => {
  it('maps old codes to our accounts, shows differences and old codes with no mapping', () => {
    const old = parseOldTrialBalance(
      'old_code,old_name,debit,credit\nBNK-DBBL,Bank,"7,95,000",\nSDR-001,Debtors,"75,000",\nSCR-001,Creditors,,"85,000"\nCAP,Capital,,"7,85,000"\n',
    );
    expect(old.problems).toEqual([]);
    const map = new Map([
      ['BNK-DBBL', 'a1'],
      ['SDR-001', 'a2'],
      ['CAP', 'a4'],
    ]);
    const ours = [
      { accountId: 'a1', code: '1130', name: 'Bank', balance: '795000.00' },
      { accountId: 'a2', code: '1150', name: 'Debtors', balance: '70000.00' },
      { accountId: 'a3', code: '2110', name: 'Payables', balance: '-85000.00' },
      { accountId: 'a4', code: '3100', name: 'Capital', balance: '-785000.00' },
      { accountId: 'a5', code: '5210', name: 'Rent', balance: '0.00' },
    ];
    const r = compare(old.rows, map, ours);
    expect(r.lines.map((l) => [l.accountCode, l.difference])).toEqual([
      ['1130', '0.00'],
      ['1150', '-5000.00'],
      ['2110', '-85000.00'],
      ['3100', '0.00'],
    ]);
    expect(r.unmapped.map((u) => u.oldCode)).toEqual(['SCR-001']);
    expect(r.matched).toBe(false);
    map.set('SCR-001', 'a3');
    ours[1].balance = '75000.00';
    expect(compare(old.rows, map, ours).matched).toBe(true);
  });
});

describe("the document reader's answer", () => {
  it('keeps what is well-formed and flags what does not add up', () => {
    const d = parseDocument(
      'Here it is: {"vendorName":"Hotel Agrabad","vendorBin":"000222333 0201","documentNo":"HA/10/7731","date":"2026-10-19","lines":[{"description":"Room","amount":"6,000","vatPercent":"15"},{"description":"","amount":"5"}],"subtotal":"6000","vat":"900","total":"Tk 6950"}',
    )!;
    expect(d).toMatchObject({
      vendorBin: '000222333-0201',
      date: '2026-10-19',
      total: '6950.00',
      lines: [{ description: 'Room', amount: '6000.00', vatPercent: '15.00' }],
    });
    expect(warningsOf(d)).toEqual([
      'total_does_not_add_up: 6900.00 <> 6950.00',
    ]);
    expect(parseDocument('I cannot read this photo.')).toBeNull();
    expect(parseDocument('{"date":"19/10/2026","lines":[]}')).toBeNull();
    expect(
      parseDocument('{"vendorName":"Aarong","date":"19/10/2026","lines":[]}'),
    ).toMatchObject({ date: null, lines: [] });
  });
});
