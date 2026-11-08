import type { FieldGroup } from '../../../platform/db/schema.js';
import { AccessGrants, type ScopedGrant } from './access-grants.js';
import type { PermissionKey } from './permissions.js';

const COMPANY = 'company-1';
const OTHER_COMPANY = 'company-2';
const SALES = 'dept-sales';
const SALES_DHAKA = 'dept-sales-dhaka';
const FINANCE = 'dept-finance';

function grants(
  perms: Array<[PermissionKey, ScopedGrant]>,
  opts: {
    employeeId?: string;
    fields?: Array<[FieldGroup, ScopedGrant]>;
    explicit?: FieldGroup[];
  } = {},
) {
  const p = new Map<PermissionKey, ScopedGrant[]>();
  for (const [k, g] of perms) p.set(k, [...(p.get(k) ?? []), g]);
  const f = new Map<FieldGroup, ScopedGrant[]>();
  for (const [k, g] of opts.fields ?? []) f.set(k, [...(f.get(k) ?? []), g]);
  return new AccessGrants(
    'user-1',
    opts.employeeId ?? null,
    p,
    f,
    new Set(opts.explicit ?? []),
    [],
    false,
  );
}

describe('AccessGrants.allows (scopes)', () => {
  it('company scope covers only that company', () => {
    const hr = grants([
      ['employee.manage', { scope: 'company', companyId: COMPANY }],
    ]);
    expect(hr.allows('employee.manage', { companyId: COMPANY })).toBe(true);
    expect(hr.allows('employee.manage', { companyId: OTHER_COMPANY })).toBe(
      false,
    );
    expect(hr.allows('employee.view', { companyId: COMPANY })).toBe(false); // different permission
  });

  it('department scope covers the department and its sub-departments only', () => {
    const head = grants([
      [
        'employee.view',
        { scope: 'department', departmentIds: new Set([SALES, SALES_DHAKA]) },
      ],
    ]);
    expect(
      head.allows('employee.view', {
        companyId: COMPANY,
        departmentId: SALES_DHAKA,
      }),
    ).toBe(true);
    expect(
      head.allows('employee.view', {
        companyId: COMPANY,
        departmentId: FINANCE,
      }),
    ).toBe(false);
    expect(head.allows('employee.view', { companyId: COMPANY })).toBe(false); // no department known
  });

  it("own scope covers only the user's own employee record", () => {
    const emp = grants([['employee.view', { scope: 'own' }]], {
      employeeId: 'emp-rafi',
    });
    expect(emp.allows('employee.view', { employeeId: 'emp-rafi' })).toBe(true);
    expect(emp.allows('employee.view', { employeeId: 'emp-mitu' })).toBe(false);
  });

  it('own scope gives nothing to a login without an employee record', () => {
    const noEmp = grants([['employee.view', { scope: 'own' }]]);
    expect(noEmp.allows('employee.view', { employeeId: 'emp-rafi' })).toBe(
      false,
    );
  });

  it('group scope covers everything in the tenant', () => {
    const admin = grants([['employee.view', { scope: 'group' }]]);
    expect(admin.allows('employee.view', { companyId: OTHER_COMPANY })).toBe(
      true,
    );
    expect(admin.scopeFilter('employee.view')).toEqual({ all: true });
  });

  it('several roles add up (one person, many roles)', () => {
    const headAndEmployee = grants(
      [
        [
          'employee.view',
          { scope: 'department', departmentIds: new Set([SALES]) },
        ],
        ['employee.view', { scope: 'own' }],
      ],
      { employeeId: 'emp-tanvir' },
    );
    expect(
      headAndEmployee.allows('employee.view', {
        departmentId: SALES,
        employeeId: 'emp-x',
      }),
    ).toBe(true);
    expect(
      headAndEmployee.allows('employee.view', {
        departmentId: FINANCE,
        employeeId: 'emp-tanvir',
      }),
    ).toBe(true);
    expect(headAndEmployee.scopeFilter('employee.view')).toEqual({
      all: false,
      companyIds: [],
      departmentIds: [SALES],
      employeeIds: ['emp-tanvir'],
    });
  });
});

describe('AccessGrants.canSeeField', () => {
  const inCompany = {
    companyId: COMPANY,
    departmentId: SALES,
    employeeId: 'emp-x',
  };

  it('own record: always', () => {
    const emp = grants([], { employeeId: 'emp-x' });
    expect(emp.canSeeField('identity', inCompany)).toBe(true);
  });

  it('through a role, within its scope', () => {
    const hr = grants(
      [['employee.view', { scope: 'company', companyId: COMPANY }]],
      {
        fields: [['identity', { scope: 'company', companyId: COMPANY }]],
      },
    );
    expect(hr.canSeeField('identity', inCompany)).toBe(true);
    expect(
      hr.canSeeField('identity', { ...inCompany, companyId: OTHER_COMPANY }),
    ).toBe(false);
    expect(hr.canSeeField('salary', inCompany)).toBe(false);
  });

  it('through an explicit grant, only where the user can view the employee', () => {
    const admin = grants(
      [['employee.view', { scope: 'company', companyId: COMPANY }]],
      { explicit: ['salary'] },
    );
    expect(admin.canSeeField('salary', inCompany)).toBe(true);
    expect(
      admin.canSeeField('salary', { ...inCompany, companyId: OTHER_COMPANY }),
    ).toBe(false);
    expect(admin.canSeeField('identity', inCompany)).toBe(false);
  });

  it('Admin without a grant sees no salary', () => {
    const admin = grants([
      ['employee.view', { scope: 'company', companyId: COMPANY }],
    ]);
    expect(admin.canSeeField('salary', inCompany)).toBe(false);
  });
});

describe('AccessGrants.system', () => {
  it('allows everything (jobs and seed only)', () => {
    const sys = AccessGrants.system();
    expect(sys.allows('payroll.approve', {})).toBe(true);
    expect(sys.canSeeField('salary', {})).toBe(true);
  });
});
