'use client';
import { Badge } from './ui';
import { useI18n } from '@/lib/i18n';
import type { DayStatus, LeaveRequest } from '@/lib/types';

const DAY_COLOR: Record<DayStatus, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  present: 'green',
  late: 'amber',
  half_day: 'amber',
  absent: 'red',
  missing_punch: 'red',
  on_leave: 'blue',
  holiday: 'gray',
  weekend: 'gray',
};

export function DayBadge({ status }: { status: DayStatus | null }) {
  const { t } = useI18n();
  if (!status) return <Badge>{t('status.notYet')}</Badge>;
  return <Badge color={DAY_COLOR[status]}>{t(`status.${status}`)}</Badge>;
}

const LEAVE_COLOR: Record<LeaveRequest['state'], 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
  returned: 'blue',
  cancelled: 'gray',
};

export function LeaveStateBadge({ state }: { state: LeaveRequest['state'] }) {
  const { t } = useI18n();
  return <Badge color={LEAVE_COLOR[state]}>{t(`leave.state.${state}`)}</Badge>;
}
