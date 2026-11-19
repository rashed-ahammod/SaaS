/**
 * Which departments a recruitment screen may show (spec §4: Admin and HR see the company,
 * a Dept Head sees their own department and everything under it).
 *
 *   departmentScope(companyId)   everything, or the departments this user's grants reach
 *
 * A Dept Head's grant is held at department scope, so it never satisfies a question asked
 * about the company alone — `allows('recruitment.view', { companyId })` is false for them by
 * design (access-grants.spec.ts pins it). A list that asked that question therefore refused a
 * Dept Head outright, although their menu offers the screen: the openings, the manpower plan
 * and the appraisal cycles all did. The answer is the same one the position requests already
 * use: find the departments the user reaches, and filter the rows by them.
 *
 * The returned department ids are not checked against the company, because every caller
 * filters rows by `company_id` as well: a department of another company matches no row.
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';

/** Which records a recruitment list may return. */
export interface RecruitmentScope {
  /** The whole company. */
  all: boolean;
  /** When not all: these departments, and nothing else. */
  departmentIds: string[];
}

/** Permissions that see recruitment at the level they are granted at. */
const SEE = [
  'recruitment.view',
  'recruitment.manage',
  'recruitment.plan',
] as const;

@Injectable()
export class RecruitmentAccess {
  constructor(
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
  ) {}

  /** Throws FORBIDDEN when the user reaches no part of this company's recruitment. */
  async departmentScope(companyId: string): Promise<RecruitmentScope> {
    if (SEE.some((p) => this.access.allows(p, { companyId })))
      return { all: true, departmentIds: [] };
    const granted = [
      ...new Set(
        [...SEE, 'recruitment.request_own' as const]
          .map((p) => this.access.scopeFilter(p))
          .flatMap((f) => (f.all ? [] : f.departmentIds)),
      ),
    ];
    const departmentIds = await this.org.departmentsOfCompany(
      companyId,
      granted,
    );
    if (!departmentIds.length) throw new ForbiddenException(MSG.FORBIDDEN);
    return { all: false, departmentIds };
  }
}
