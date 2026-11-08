import {
  compareRegister,
  parseAmount,
  parseRegister,
  type ErpEmployee,
} from './compare.js';

const erp = (
  code: string,
  gross: string,
  net: string,
  tax = '0.00',
): ErpEmployee => ({
  employeeId: `id-${code}`,
  employeeCode: code,
  figures: { gross, net, tax, total_deductions: '0.00', pf_employee: '0.00' },
});

describe('parallel payroll comparison (Gate 1)', () => {
  it.each([
    ['45,250.00', '45250.00'],
    ['1,25,000', '125000.00'],
    ['Tk 52000', '52000.00'],
    ['৳১,২৫,০০০.৫০', '125000.50'],
    ['-350.5', '-350.50'],
    ['abc', null],
    ['12.345', null],
  ])('reads the amount "%s"', (text, expected) => {
    expect(parseAmount(text)).toBe(expected);
  });

  it('refuses a register without the required columns, duplicate employees or bad amounts', () => {
    const r = parseRegister(
      ['employee_code', 'gross'],
      [
        { rowNo: 2, cells: { employee_code: 'MFL-00001', gross: '50000' } },
        { rowNo: 3, cells: { employee_code: 'MFL-00001', gross: 'fifty' } },
      ],
    );
    expect(r.problems).toEqual([
      'Missing column "net"',
      'Row 3: employee MFL-00001 also in row 2',
      'Row 3: gross "fifty" is not an amount',
    ]);
  });

  it('matches within the tolerance, lists differences and people missing on either side', () => {
    const { rows, figures } = parseRegister(
      ['employee_code', 'gross', 'net', 'tax'],
      [
        {
          rowNo: 2,
          cells: {
            employee_code: 'MFL-00001',
            gross: '85,000.00',
            net: '78,500.00',
            tax: '1,250',
          },
        },
        {
          rowNo: 3,
          cells: {
            employee_code: 'MFL-00002',
            gross: '52,000.00',
            net: '49,400.40',
            tax: '0',
          },
        },
        {
          rowNo: 4,
          cells: {
            employee_code: 'MFL-00009',
            gross: '30,000',
            net: '30,000',
            tax: '0',
          },
        },
      ],
    );
    const { lines, summary } = compareRegister(
      rows,
      figures,
      [
        erp('MFL-00001', '85000.00', '78500.60', '1250.00'), // net off by 0.60: within Tk 1 rounding
        erp('MFL-00002', '52000.00', '48900.40', '500.00'), // tax 500 vs 0: a real difference
        erp('MFL-00003', '41000.00', '41000.00'), // joined, not in the old register
      ],
      '1.00',
    );

    expect(lines.map((l) => [l.employeeCode, l.outcome])).toEqual([
      ['MFL-00001', 'match'],
      ['MFL-00002', 'different'],
      ['MFL-00003', 'missing_in_legacy'],
      ['MFL-00009', 'missing_in_erp'],
    ]);
    expect(lines[1].differences).toEqual({ net: '-500.00', tax: '500.00' });
    expect(summary).toMatchObject({
      employees: 4,
      matched: 1,
      different: 1,
      missingInErp: 1,
      missingInLegacy: 1,
    });
    expect(summary.totals.legacy).toEqual({
      gross: '167000.00',
      net: '157900.40',
      tax: '1250.00',
    });
    expect(summary.totals.erp).toEqual({
      gross: '178000.00',
      net: '168401.00',
      tax: '1750.00',
    });
  });

  it('with no tolerance, one paisa is a difference', () => {
    const { rows, figures } = parseRegister(
      ['employee_code', 'gross', 'net'],
      [
        {
          rowNo: 2,
          cells: { employee_code: 'A', gross: '100.00', net: '100.00' },
        },
      ],
    );
    expect(
      compareRegister(rows, figures, [erp('A', '100.01', '100.00')], '0')
        .lines[0].differences,
    ).toEqual({ gross: '0.01' });
  });
});
