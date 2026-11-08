import {
  adapterFor,
  channelOf,
  parseReturnFile,
  type FileItem,
} from './adapters.js';

const ctx = {
  companyName: 'Meghna Foods Ltd',
  period: '2026-09',
  payType: 'salary',
  fileDate: '2026-10-02',
};
const rafi: FileItem = {
  reference: 'PAY-2026-09-7F3A91C2',
  amount: '29000.00',
  employeeCode: 'MFL-00006',
  employeeName: 'Mahmudul Hasan Rafi',
  details: {
    accountName: 'Mahmudul Hasan Rafi',
    bankName: 'Dutch-Bangla Bank PLC',
    branchName: 'Gulshan, Dhaka',
    routingNumber: '090261725',
    accountNumber: '1051100012345',
  },
};

describe('disbursement adapters', () => {
  it('BEFTN CSV: one row per payment, cells with commas are quoted', () => {
    const text = adapterFor('bank')!.build(ctx, [rafi]);
    const [header, row] = text.trim().split('\r\n');
    expect(header).toBe(
      'SL,BENEFICIARY_NAME,ACCOUNT_NUMBER,ROUTING_NUMBER,BANK_NAME,BRANCH_NAME,AMOUNT,PAYMENT_REFERENCE,NARRATION',
    );
    expect(row).toBe(
      '1,Mahmudul Hasan Rafi,1051100012345,090261725,Dutch-Bangla Bank PLC,"Gulshan, Dhaka",29000.00,PAY-2026-09-7F3A91C2,Salary 2026-09',
    );
  });

  it('bKash bulk: wallet number and amount', () => {
    const item = {
      ...rafi,
      details: {
        accountName: 'Mahmudul Hasan Rafi',
        walletProvider: 'bkash',
        walletNumber: '01712345678',
      },
    };
    const text = adapterFor('bkash')!.build(
      { ...ctx, payType: 'bonus:Durga Puja 2026' },
      [item],
    );
    expect(text.split('\r\n')[1]).toBe(
      '1,01712345678,29000.00,Mahmudul Hasan Rafi,PAY-2026-09-7F3A91C2,Durga Puja 2026 2026-09',
    );
  });

  it('cash sheet has a signature column; unknown format for a channel is refused', () => {
    expect(
      adapterFor('cash')!.build(ctx, [{ ...rafi, details: null }]),
    ).toContain('RECEIVED_SIGNATURE');
    expect(adapterFor('bank', 'bkash-bulk')).toBeUndefined();
  });

  it('channel of a salary account', () => {
    expect(channelOf(undefined)).toBe('cash');
    expect(channelOf({ kind: 'bank', provider: 'Dutch-Bangla Bank PLC' })).toBe(
      'bank',
    );
    expect(channelOf({ kind: 'wallet', provider: 'nagad' })).toBe('nagad');
  });
});

describe('return files', () => {
  it('reads returned and successful lines, any column order', () => {
    const { lines, problems } = parseReturnFile(
      'Status,Reference,Reason\r\nRETURNED,PAY-1,"Account closed, dormant"\r\nsuccess,PAY-2,\r\n',
    );
    expect(problems).toEqual([]);
    expect(lines).toEqual([
      {
        line: 2,
        reference: 'PAY-1',
        outcome: 'returned',
        reason: 'Account closed, dormant',
      },
      { line: 3, reference: 'PAY-2', outcome: 'success', reason: '' },
    ]);
  });

  it('reports problems instead of guessing', () => {
    expect(parseReturnFile('REF,RESULT\nPAY-1,OK').problems[0]).toMatch(
      /REFERENCE and STATUS/,
    );
    expect(
      parseReturnFile('REFERENCE,STATUS\nPAY-1,MAYBE\n,RETURNED').problems,
    ).toEqual(['Line 2: unknown status "MAYBE"', 'Line 3: no reference']);
  });
});
