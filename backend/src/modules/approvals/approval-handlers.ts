/**
 * How a module plugs a request type into the approval engine (guide §9 rule 6:
 * "Final approval calls the owning module's execute() inside the same transaction").
 *
 *   @Injectable()
 *   export class BankAccountsService implements OnModuleInit {
 *     onModuleInit() {
 *       this.handlers.register('bank_account_change', {
 *         onApproved: (request) => this.applyApprovedChange(request),
 *         onClosed: (request, outcome) => this.discardChange(request, outcome),
 *       }, [defaultChain('Bank account change (default)', step(1, 'role:hr'))]);
 *     }
 *   }
 */
import { Injectable } from '@nestjs/common';
import type { ApprovalRequest } from '../../platform/db/schema.js';
import type { ChainDefinition } from './chains.js';

export interface ApprovalHandler {
  /** Last step approved: apply the change. Runs in the approval's transaction. */
  onApproved(request: ApprovalRequest): Promise<void>;
  /** Rejected, returned or cancelled: undo any pending state in the module. */
  onClosed?(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ): Promise<void>;
  /** A step other than the last was approved (e.g. payroll: Accounts verified). */
  onStepApproved?(request: ApprovalRequest, stepNo: number): Promise<void>;
  /**
   * Four-eyes across steps (payroll maker-checker, guide §12.4): a person who
   * approved one step is never an approver of a later step of the same request.
   */
  distinctApprovers?: boolean;
}

@Injectable()
export class ApprovalHandlers {
  private readonly handlers = new Map<string, ApprovalHandler>();
  private readonly defaults = new Map<string, ChainDefinition[]>();

  /**
   * @param defaultChains used when the tenant has configured no matching chain
   *                      (spec §5 "Default chains (customer can edit)")
   */
  register(
    requestType: string,
    handler: ApprovalHandler,
    defaultChains: ChainDefinition[],
  ): void {
    if (this.handlers.has(requestType))
      throw new Error(`Approval handler for ${requestType} registered twice`);
    this.handlers.set(requestType, handler);
    this.defaults.set(requestType, defaultChains);
  }

  defaultChains(requestType: string): ChainDefinition[] {
    return this.defaults.get(requestType) ?? [];
  }

  get(requestType: string): ApprovalHandler {
    const handler = this.handlers.get(requestType);
    if (!handler)
      throw new Error(`No approval handler for request type ${requestType}`);
    return handler;
  }

  knownTypes(): string[] {
    return [...this.handlers.keys()].sort();
  }
}
