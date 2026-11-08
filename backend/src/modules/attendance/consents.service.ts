/**
 * Consent for biometric, phone-location and selfie attendance data (spec §11,
 * guide §20; WP12).
 *
 *   mine() / giveOwn()        the employee reads each notice and agrees or withdraws in the app
 *   ofEmployee() / record()   HR sees the history and records a signed paper form
 *   current() / consented()   what the rest of attendance checks before using the data
 *
 * Consent is an append-only history; the latest row per purpose counts. Without
 * a current "granted" row:
 *   - location:  no phone registration and no phone punch;
 *   - biometric: no device user number, and device punches for the person are
 *                not stored (the sync agent's answer counts them as "noConsent").
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { ConsentPurpose } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import { CONSENT_NOTICES, CONSENT_PURPOSES } from './consent-notices.js';
import type { GiveConsentDto, RecordConsentDto } from './dto/attendance.dto.js';

const REQUIRED_MESSAGE: Record<ConsentPurpose, string> = {
  location_attendance: MSG.CONSENT_REQUIRED_LOCATION,
  biometric_attendance: MSG.CONSENT_REQUIRED_BIOMETRIC,
  selfie_attendance: MSG.CONSENT_REQUIRED_SELFIE,
};

@Injectable()
export class ConsentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
  ) {}

  // ------------------------------------------------------------ employee

  /** Each purpose with its notice and my current answer. */
  async mine() {
    const employeeId = this.ownEmployeeId();
    const latest = await this.latest([employeeId]);
    return CONSENT_PURPOSES.map((purpose) => {
      const row = latest.get(`${employeeId}|${purpose}`);
      return {
        purpose,
        status: !row ? 'none' : row.granted ? 'granted' : 'withdrawn',
        since: row?.recorded_at ?? null,
        givenUnder: row?.notice_version ?? null,
        notice: CONSENT_NOTICES[purpose],
      };
    });
  }

  async giveOwn(dto: GiveConsentDto) {
    const employeeId = this.ownEmployeeId();
    this.access.assert('attendance.own', { employeeId });
    await this.append(employeeId, dto.purpose, dto.granted, 'app', null);
    return (await this.mine()).find((c) => c.purpose === dto.purpose);
  }

  // ------------------------------------------------------------------ HR

  async ofEmployee(employeeId: string) {
    await this.employeeAccess.check('attendance.manage', employeeId);
    const rows = await this.db.tx
      .selectFrom('employee_consents')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .orderBy('recorded_at', 'desc')
      .execute();
    const latest = await this.latest([employeeId]);
    return {
      employeeId,
      current: CONSENT_PURPOSES.map((purpose) => {
        const row = latest.get(`${employeeId}|${purpose}`);
        return {
          purpose,
          status: !row ? 'none' : row.granted ? 'granted' : 'withdrawn',
          since: row?.recorded_at ?? null,
        };
      }),
      history: rows.map((r) => ({
        id: r.id,
        purpose: r.purpose,
        granted: r.granted,
        noticeVersion: r.notice_version,
        method: r.method,
        documentId: r.document_id,
        recordedBy: r.recorded_by,
        recordedAt: r.recorded_at,
      })),
    };
  }

  /** HR records a consent or withdrawal the employee signed on paper (scan as an employee document). */
  async record(employeeId: string, dto: RecordConsentDto) {
    await this.employeeAccess.check('attendance.manage', employeeId);
    await this.append(
      employeeId,
      dto.purpose,
      dto.granted,
      'paper',
      dto.documentId ?? null,
    );
    return this.ofEmployee(employeeId);
  }

  // --------------------------------------------------------- for attendance

  /** Throws 403 with the reason when the employee has no current consent for the purpose. */
  async require(employeeId: string, purpose: ConsentPurpose): Promise<void> {
    const row = (await this.latest([employeeId])).get(
      `${employeeId}|${purpose}`,
    );
    if (!row?.granted) throw new ForbiddenException(REQUIRED_MESSAGE[purpose]);
  }

  /** The employees (of those given) with a current consent for the purpose. */
  async consented(
    employeeIds: string[],
    purpose: ConsentPurpose,
  ): Promise<Set<string>> {
    const latest = await this.latest(employeeIds);
    return new Set(
      employeeIds.filter((id) => latest.get(`${id}|${purpose}`)?.granted),
    );
  }

  // ------------------------------------------------------------- helpers

  private async append(
    employeeId: string,
    purpose: ConsentPurpose,
    granted: boolean,
    method: 'app' | 'paper',
    documentId: string | null,
  ) {
    const notice = CONSENT_NOTICES[purpose];
    await this.db.tx
      .insertInto('employee_consents')
      .values({
        employee_id: employeeId,
        purpose,
        granted,
        notice_version: notice.version,
        method,
        document_id: documentId,
      })
      .execute();
    await this.audit.record({
      action: granted ? 'employee.consent_given' : 'employee.consent_withdrawn',
      entity: 'employee',
      entityId: employeeId,
      after: {
        purpose,
        granted,
        noticeVersion: notice.version,
        method,
        documentId,
      },
    });
  }

  /** Latest row per employee and purpose, keyed "employeeId|purpose". */
  private async latest(employeeIds: string[]) {
    if (!employeeIds.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('employee_consents')
      .distinctOn(['employee_id', 'purpose'])
      .select([
        'employee_id',
        'purpose',
        'granted',
        'notice_version',
        'recorded_at',
      ])
      .where('employee_id', 'in', employeeIds)
      .orderBy('employee_id')
      .orderBy('purpose')
      .orderBy('recorded_at', 'desc')
      .execute();
    return new Map(rows.map((r) => [`${r.employee_id}|${r.purpose}`, r]));
  }

  private ownEmployeeId(): string {
    const employeeId = this.access.current().employeeId;
    if (!employeeId) throw new ForbiddenException(MSG.EMPLOYEE_NOT_FOUND);
    return employeeId;
  }
}
