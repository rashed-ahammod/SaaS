/**
 * The assistant's tools (guide §16, spec §8 guardrail 1: same permissions as the
 * user). Each tool calls the SAME service method the app's own screen calls, in
 * the signed-in user's request context, so the assistant can never see more than
 * the user can. Every tool is read-only.
 *
 * Results are cut down to the fields an answer needs (data minimization); the
 * gateway masks numbers on top of that.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { Clock } from '../../../platform/clock.js';
import {
  addDays,
  addMonths,
  businessDate,
  todayInDhaka,
} from '../../../platform/dates/business-date.js';
import { DatabaseService } from '../../../platform/db/database.service.js';
import { MSG } from '../../../platform/i18n/messages.js';
import { requestContext } from '../../../platform/tenancy/request-context.js';
import { AttendanceService } from '../../attendance/attendance.service.js';
import type { PermissionKey } from '../../identity/access/permissions.js';
import { LeaveLedgerService } from '../../leave/leave-ledger.service.js';
import { PayrollRunsService } from '../../payroll/payroll-runs.service.js';
import type { ToolOutcome } from '../gateway/ai-gateway.service.js';
import type { AiToolCall } from '../gateway/provider.js';
import { PolicyDocumentsService } from '../policies/policy-documents.service.js';

const INPUTS = {
  search_policy: z.object({ query: z.string().min(1).max(500) }),
  get_my_leave_balances: z.object({}),
  get_my_payslips: z.object({}),
  get_my_attendance: z.object({
    month: z.string().regex(/^(current|\d{4}-(0[1-9]|1[0-2]))$/),
  }),
};

const DHAKA_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dhaka',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

@Injectable()
export class AssistantToolsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly clock: Clock,
    private readonly policies: PolicyDocumentsService,
    private readonly ledger: LeaveLedgerService,
    private readonly payroll: PayrollRunsService,
    private readonly attendance: AttendanceService,
  ) {}

  /** Runs one tool call in its own short transaction, with the user's access. */
  execute(call: AiToolCall): Promise<ToolOutcome> {
    const schema = INPUTS[call.name as keyof typeof INPUTS];
    if (!schema) throw new BadRequestException(MSG.VALIDATION_FAILED);
    const parsed = schema.safeParse(call.input ?? {});
    if (!parsed.success) throw new BadRequestException(MSG.VALIDATION_FAILED);

    return this.db.transaction(async () => {
      switch (call.name) {
        case 'search_policy':
          return this.searchPolicy((parsed.data as { query: string }).query);
        case 'get_my_leave_balances':
          return this.leaveBalances();
        case 'get_my_payslips':
          return this.payslips();
        default:
          return this.attendanceMonth((parsed.data as { month: string }).month);
      }
    });
  }

  private async searchPolicy(query: string): Promise<ToolOutcome> {
    const hits = await this.policies.search(query);
    return {
      content: {
        results: hits.map((h) => ({
          title: h.title,
          heading: h.heading,
          excerpt: h.excerpt,
        })),
      },
      sources: hits.map((h) => ({
        documentId: h.documentId,
        title: h.title,
        heading: h.heading,
      })),
    };
  }

  private async leaveBalances(): Promise<ToolOutcome> {
    // same check as GET /me/leave-balances
    const employeeId = this.ownEmployee('leave.apply_own');
    const result = await this.ledger.balances(employeeId);
    return {
      content: {
        asOf: result.asOf,
        balances: result.balances
          .filter((b) => b.usesBalance)
          .map((b) => ({
            name: b.nameEn,
            nameBn: b.nameBn,
            balance: b.balance,
            pending: b.pending,
            available: b.available,
          })),
      },
    };
  }

  private async payslips(): Promise<ToolOutcome> {
    // same check as GET /me/payslips
    this.ownEmployee('payslip.view_own');
    const list = await this.payroll.myPayslips();
    const latest = list[0] ? await this.payroll.myPayslip(list[0].runId) : null;
    return {
      content: {
        payslips: list.slice(0, 6).map((p) => ({
          period: p.period,
          runType: p.runType,
          bonusName: p.bonusName,
          gross: p.gross,
          deductions: p.deductions,
          net: p.net,
        })),
        latest: latest && {
          period: latest.period,
          runType: latest.runType,
          earnings: latest.earnings.map((l) => ({
            head: l.head,
            amount: l.amount,
          })),
          deductions: latest.deductions.map((l) => ({
            head: l.head,
            amount: l.amount,
          })),
          gross: latest.gross,
          totalDeductions: latest.totalDeductions,
          net: latest.net,
          taxThisMonth: latest.tax.thisMonth,
        },
      },
    };
  }

  private async attendanceMonth(month: string): Promise<ToolOutcome> {
    // same check as GET /me/attendance
    this.ownEmployee('attendance.own');
    const today = todayInDhaka(this.clock.now());
    const ym = month === 'current' ? today.slice(0, 7) : month;
    if (ym > today.slice(0, 7)) throw new BadRequestException(MSG.INVALID_DATE);
    const from = businessDate(`${ym}-01`);
    const monthEnd = addDays(addMonths(from, 1), -1);
    const to = monthEnd < today ? monthEnd : today;

    const result = await this.attendance.ownDays(from, to);
    return {
      content: {
        month: ym,
        totals: Object.fromEntries(
          Object.entries(result.totals).filter(([, n]) => n > 0),
        ),
        days: result.days.map((d) => ({
          date: d.date,
          status: d.status,
          firstIn: d.firstIn ? DHAKA_TIME.format(new Date(d.firstIn)) : null,
          lastOut: d.lastOut ? DHAKA_TIME.format(new Date(d.lastOut)) : null,
          lateMinutes: d.lateMinutes || undefined,
          holiday: d.holidayName ?? undefined,
        })),
      },
    };
  }

  /** The user's own employee record, if their role has the self-service permission. */
  private ownEmployee(permission: PermissionKey): string {
    const access = requestContext.get().access;
    if (!access?.has(permission)) throw new ForbiddenException(MSG.FORBIDDEN);
    if (!access.employeeId) throw new NotFoundException(MSG.EMPLOYEE_NOT_FOUND);
    return access.employeeId;
  }
}
