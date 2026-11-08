/**
 * Approval chains: which steps a request goes through (spec §5).
 *
 * A tenant can configure chains (approval_chains table). For request types it
 * has not configured, the built-in default chain applies: each module registers
 * its own default together with its handler (ApprovalHandlers.register).
 *
 * Pure code: no database (chains.spec.ts).
 */
import { Money } from '../../platform/money/money.js';

/** Who approves a step. */
export type ApproverRule =
  'line_manager' | 'dept_head' | `role:${string}` | `user:${string}`;

export interface ChainStep {
  stepNo: number;
  approverRule: ApproverRule;
  /** 'any': one of the approvers is enough; 'all': every approver must approve. */
  mode: 'any' | 'all';
  reminderHours: number;
  escalationHours: number;
}

/** When a chain applies. Every condition given must hold; {} matches everything. */
export interface ChainConditions {
  minAmount?: string;
  maxAmount?: string;
  minDays?: number;
  maxDays?: number;
  companyIds?: string[];
  departmentIds?: string[];
  /** Request kinds set by the module, e.g. leave type codes ["ML", "LWP"]. */
  kinds?: string[];
}

export interface ChainDefinition {
  id: string | null; // null = built-in default
  name: string;
  conditions: ChainConditions;
  steps: ChainStep[];
}

/** Facts about a request used to pick its chain. */
export interface RequestFacts {
  amount?: string | null;
  days?: number | null;
  companyId: string;
  departmentId?: string | null;
  kind?: string | null;
}

/** A step with the spec §5 SLA defaults (reminder 24 h, escalation 48 h). */
export const step = (
  stepNo: number,
  approverRule: ApproverRule,
  mode: 'any' | 'all' = 'any',
): ChainStep => ({
  stepNo,
  approverRule,
  mode,
  reminderHours: 24,
  escalationHours: 48,
});

/** A built-in chain with no conditions. */
export const defaultChain = (
  name: string,
  ...steps: ChainStep[]
): ChainDefinition => ({ id: null, name, conditions: {}, steps });

/** A built-in chain that applies only when its conditions match. */
export const conditionalChain = (
  name: string,
  conditions: ChainConditions,
  ...steps: ChainStep[]
): ChainDefinition => ({ id: null, name, conditions, steps });

export function matchesConditions(
  c: ChainConditions,
  facts: RequestFacts,
): boolean {
  if (c.companyIds?.length && !c.companyIds.includes(facts.companyId))
    return false;
  if (
    c.departmentIds?.length &&
    (!facts.departmentId || !c.departmentIds.includes(facts.departmentId))
  )
    return false;
  if (c.kinds?.length && (!facts.kind || !c.kinds.includes(facts.kind)))
    return false;
  if (
    c.minAmount !== undefined &&
    (facts.amount == null || Money.of(facts.amount).lessThan(c.minAmount))
  )
    return false;
  if (
    c.maxAmount !== undefined &&
    (facts.amount == null || Money.of(facts.amount).greaterThan(c.maxAmount))
  )
    return false;
  if (c.minDays !== undefined && (facts.days == null || facts.days < c.minDays))
    return false;
  if (c.maxDays !== undefined && (facts.days == null || facts.days > c.maxDays))
    return false;
  return true;
}

/** First configured chain that matches (already sorted by priority), else the first matching default. */
export function pickChain(
  configured: ChainDefinition[],
  defaults: ChainDefinition[],
  facts: RequestFacts,
): ChainDefinition | undefined {
  return (
    configured.find((c) => matchesConditions(c.conditions, facts)) ??
    defaults.find((c) => matchesConditions(c.conditions, facts))
  );
}
