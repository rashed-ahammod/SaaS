import { describe, expect, it } from 'vitest';
import {
  autoMatch,
  candidates,
  options,
  type BankLine,
  type LedgerLine,
} from './matching.js';
import { parseStatement, toAmount, toIsoDate } from './statement-formats.js';

describe('bank statement files', () => {
  it('reads a Dutch-Bangla style statement below the account details', () => {
    const csv = [
      'Dutch-Bangla Bank PLC,Tejgaon Branch',
      'Account,Demo Trading Ltd,1101100012345',
      '',
      'Txn Date,Value Date,Particulars,Cheque No,Debit,Credit,Balance',
      '01/10/2026,01/10/2026,"CHQ PAID, PARTEX FURNITURE",4521873,"73,400.00",,"9,26,600.00"',
      '02/10/2026,02/10/2026,NPSB CREDIT MEGHNA DEALERS,,,"1,50,000.00","10,76,600.00"',
      '05/10/2026,05/10/2026,SMS ALERT CHARGE,,115.00,,"10,76,485.00"',
      ',,Total,,"73,515.00","1,50,000.00",',
    ].join('\r\n');
    const s = parseStatement('dbbl', csv);
    expect(s.problems).toEqual([]);
    expect(s.lines.map((l) => [l.txnDate, l.amount, l.reference])).toEqual([
      ['2026-10-01', '-73400.00', '4521873'],
      ['2026-10-02', '150000.00', null],
      ['2026-10-05', '-115.00', null],
    ]);
    expect(s.lines[0].description).toBe('CHQ PAID, PARTEX FURNITURE');
    expect([
      s.openingBalance,
      s.closingBalance,
      s.periodFrom,
      s.periodTo,
    ]).toEqual(['1000000.00', '1076485.00', '2026-10-01', '2026-10-05']);
  });

  it('refuses a file whose running balance does not add up', () => {
    const csv =
      'Date,Description,Reference,Withdrawal,Deposit,Balance\n2026-10-01,Opening deposit,,,1000,1000\n2026-10-02,Charge,,10,,995\n';
    expect(parseStatement('generic', csv).problems).toEqual([
      'Row 3: balance 995.00 does not follow from 1000.00 and -10.00',
    ]);
  });

  it('refuses a file of another layout, and a row with both sides', () => {
    expect(
      parseStatement(
        'brac',
        'Date,Description,Reference,Withdrawal,Deposit,Balance\n',
      ),
    ).toMatchObject({
      problems: [expect.stringContaining('No header row of the brac layout')],
    });
    expect(
      parseStatement(
        'generic',
        'Date,Description,Reference,Withdrawal,Deposit\n2026-10-01,x,,5,5\n',
      ).problems,
    ).toEqual(['Row 2: give either a withdrawal or a deposit']);
  });

  it('reads City Bank balances with Dr / Cr and BRAC month names', () => {
    expect(toAmount('1,25,000.00 Cr')?.toDb()).toBe('125000.00');
    expect(toAmount('2,000.00 Dr')?.toDb()).toBe('-2000.00');
    expect(toAmount('(500)')?.toDb()).toBe('-500.00');
    expect(toAmount('Tk 1,500.5')?.toDb()).toBe('1500.50');
    expect(toAmount('abc')).toBeUndefined();
    expect(toIsoDate('05-Oct-2026')).toBe('2026-10-05');
    expect(toIsoDate('31/09/2026')).toBeNull();
  });

  it('gives the same transaction in two overlapping files the same key', () => {
    const a = parseStatement(
      'generic',
      'Date,Description,Reference,Withdrawal,Deposit,Balance\n2026-10-01,Dep,,,100,100\n2026-10-02,Chg,,10,,90\n',
    );
    const b = parseStatement(
      'generic',
      'Date,Description,Reference,Withdrawal,Deposit,Balance\n2026-10-02,Chg,,10,,90\n2026-10-03,Dep,,,50,140\n',
    );
    expect(a.lines[1].key).toBe(b.lines[0].key);
    // without a balance column, two identical charges on a day stay two lines
    const c = parseStatement(
      'generic',
      'Date,Description,Reference,Withdrawal,Deposit\n2026-10-02,Chg,,10,\n2026-10-02,Chg,,10,\n',
    );
    expect(new Set(c.lines.map((l) => l.key)).size).toBe(2);
  });
});

describe('matching', () => {
  const bank = (
    id: string,
    date: string,
    amount: string,
    description: string,
    reference: string | null = null,
  ): BankLine => ({ id, date, amount, description, reference });
  const book = (
    id: string,
    date: string,
    amount: string,
    narration: string,
    reference: string | null = null,
    voucherNumber = `PV/2026-27/${id}`,
  ): LedgerLine => ({ id, date, amount, narration, reference, voucherNumber });

  it('matches a cheque by its number even with another line of the same amount', () => {
    const lines = [bank('s1', '2026-10-09', '-73400.00', 'CHQ PAID 4521873')];
    const ledger = [
      book('l1', '2026-10-01', '-73400.00', 'Partex furniture', '4521873'),
      book('l2', '2026-10-08', '-73400.00', 'Another vendor', '4521900'),
    ];
    expect(candidates(lines[0], ledger).map((c) => c.ledgerLineId)).toEqual([
      'l1',
      'l2',
    ]);
    expect(autoMatch(lines, ledger)).toEqual([
      { statementLineId: 's1', ledgerLineId: 'l1', reason: 'reference' },
    ]);
  });

  it('matches the only line of an amount; leaves a tie for a person', () => {
    const ledger = [
      book('l1', '2026-10-02', '150000.00', 'Receipt from Meghna Dealers'),
    ];
    expect(
      autoMatch([bank('s1', '2026-10-02', '150000.00', 'NPSB CREDIT')], ledger),
    ).toEqual([
      { statementLineId: 's1', ledgerLineId: 'l1', reason: 'only_one' },
    ]);
    const two = [
      book('l1', '2026-10-02', '5000.00', 'Receipt A'),
      book('l2', '2026-10-02', '5000.00', 'Receipt B'),
    ];
    expect(
      autoMatch([bank('s1', '2026-10-02', '5000.00', 'CASH DEPOSIT')], two),
    ).toEqual([]);
    // two bank lines and one ledger line of an amount: no guess
    expect(
      autoMatch(
        [
          bank('s1', '2026-10-02', '5000.00', 'DEP'),
          bank('s2', '2026-10-03', '5000.00', 'DEP'),
        ],
        [two[0]],
      ),
    ).toEqual([]);
  });

  it('keeps to the date window and the sign', () => {
    const ledger = [
      book('l1', '2026-08-01', '-500.00', 'Old cheque', '1234567'),
      book('l2', '2026-10-01', '500.00', 'Receipt', '1234567'),
    ];
    expect(
      candidates(bank('s1', '2026-10-01', '-500.00', 'CHQ 1234567'), ledger),
    ).toEqual([]);
  });

  it('offers two receipts that make one deposit', () => {
    const ledger = [
      book('l1', '2026-10-03', '30000.00', 'Dealer A'),
      book('l2', '2026-10-03', '20000.00', 'Dealer B'),
      book('l3', '2026-10-03', '15000.00', 'Dealer C'),
    ];
    expect(
      options(bank('s1', '2026-10-03', '50000.00', 'CASH DEPOSIT'), ledger),
    ).toEqual([
      { ledgerLineIds: ['l1', 'l2'], score: 25, referenceAgrees: false },
    ]);
  });
});
