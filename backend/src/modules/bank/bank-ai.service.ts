/**
 * AI match suggestions (spec §8 "AI bank reconciliation matching"): for one unmatched
 * statement line, the model chooses among the options the rules found (matching.ts:
 * single ledger lines and pairs), or none. It never matches anything itself: the
 * accountant accepts the suggestion (a match of kind "suggestion") or not.
 *
 *   suggest(lineId)   1. the feature is offered (plan, switched on, release gate, quota)
 *                     2. the options (with the user's own access); none -> no AI call
 *                     3. the model gets the bank line and the options, masked (no
 *                        account numbers), and answers {"choice": "A" | null, "reason"}
 *                     4. an answer that is not one of the options counts as no choice
 *
 * Runs on a @ShortTransactions route: no transaction is held while the model thinks.
 */
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../platform/db/database.service.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { AiGatewayService } from '../ai/gateway/ai-gateway.service.js';
import { BankService } from './bank.service.js';

export const BANK_MATCH_PROMPT_VERSION = 'bank-match-v1';

/** What the model sees for one bank line. */
export interface BankMatchFacts {
  bankLine: {
    date: string;
    amount: string;
    description: string;
    reference: string | null;
  };
  options: Array<{
    key: string;
    lines: Array<{
      date: string;
      amount: string;
      voucherNumber: string;
      narration: string;
      reference: string | null;
    }>;
  }>;
}

export function bankMatchSystemPrompt(language: 'bn' | 'en'): string {
  return [
    'You help an accountant in Bangladesh reconcile a company bank account.',
    'You get one line of the bank statement and a few options from the books (each option is one or two ledger lines whose total equals the bank line).',
    'Choose the option that is the same transaction, using the description, cheque or transfer reference, party name and dates. A cheque is usually presented some days after the books record it.',
    'If no option is clearly the same transaction, choose none. Never guess between options that look equally likely.',
    'Answer with JSON only: {"choice": "<option key or null>", "reason": "<one short sentence>"}.',
    `Write the reason in ${language === 'bn' ? 'Bangla' : 'English'}.`,
  ].join('\n');
}

export function parseChoice(
  answer: string,
  keys: string[],
): { choice: string | null; reason: string } {
  const json = /\{[\s\S]*\}/.exec(answer)?.[0];
  try {
    const parsed = JSON.parse(json ?? '') as {
      choice?: unknown;
      reason?: unknown;
    };
    const choice =
      typeof parsed.choice === 'string' && keys.includes(parsed.choice)
        ? parsed.choice
        : null;
    return {
      choice,
      reason:
        typeof parsed.reason === 'string' ? parsed.reason.slice(0, 500) : '',
    };
  } catch {
    return { choice: null, reason: '' };
  }
}

@Injectable()
export class BankAiService {
  constructor(
    private readonly db: DatabaseService,
    private readonly gateway: AiGatewayService,
    private readonly bank: BankService,
  ) {}

  async suggest(statementLineId: string) {
    // offered, and the options this user may see (403/404 before any quota is used)
    await this.gateway.assertAvailable(
      'bank_match_suggestion',
      BANK_MATCH_PROMPT_VERSION,
    );
    const found = await this.db.transaction(() =>
      this.bank.options(statementLineId),
    );
    if (!found.options.length)
      return {
        statementLineId,
        suggestion: null,
        reason: null,
        interactionId: null,
      };

    const keys = found.options.map((_, i) => String.fromCharCode(65 + i));
    const facts: BankMatchFacts = {
      bankLine: {
        date: found.line.date,
        amount: found.line.amount,
        description: found.line.description,
        reference: found.line.reference,
      },
      options: found.options.map((o, i) => ({
        key: keys[i],
        lines: o.lines.map((l) => ({
          date: l.date,
          amount: l.amount,
          voucherNumber: l.voucherNumber,
          narration: l.narration,
          reference: l.reference,
        })),
      })),
    };
    const result = await this.chooseFrom(facts, `bank_line:${statementLineId}`);
    const index = result.choice ? keys.indexOf(result.choice) : -1;
    return {
      statementLineId,
      suggestion:
        index >= 0
          ? {
              ledgerLineIds: found.options[index].ledgerLineIds,
              lines: found.options[index].lines,
            }
          : null,
      reason: result.reason || null,
      interactionId: result.interactionId,
    };
  }

  /** The model call itself; the test set (npm run ai:eval) calls it with synthetic facts. */
  async chooseFrom(
    facts: BankMatchFacts,
    inputRef: string,
    evaluation = false,
  ) {
    const result = await this.gateway.run({
      feature: 'bank_match_suggestion',
      promptVersion: BANK_MATCH_PROMPT_VERSION,
      inputRef,
      system: bankMatchSystemPrompt(requestContext.get().language),
      messages: [
        {
          role: 'user',
          text: `TASK: bank_match\nWhich option is this bank line?\nFACTS: ${JSON.stringify(facts)}`,
        },
      ],
      maxTokens: 1000,
      ignoreReleaseGate: evaluation,
    });
    return {
      ...parseChoice(
        result.answer,
        facts.options.map((o) => o.key),
      ),
      interactionId: result.interactionId,
      answer: result.answer,
    };
  }
}
