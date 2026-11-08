/**
 * Three-way match (spec §6.7 step 4): a vendor bill against its purchase order and
 * the goods / services received. Pure code; the caller collects the quantities.
 *
 * For every PO line the bill charges:
 *   - billed (this bill + the other live bills of the PO) <= received      else "billed_more_than_received"
 *   - billed <= ordered                                                     else "billed_more_than_ordered"
 *   - the bill's unit price <= the PO's unit price x (1 + tolerance %)      else "price_above_order"
 * Any problem makes the bill a mismatch, and a mismatched bill cannot be paid.
 */
import { Decimal } from 'decimal.js';

export type MatchProblem =
  | 'billed_more_than_received'
  | 'billed_more_than_ordered'
  | 'price_above_order';

export interface MatchInputLine {
  poLineId: string;
  description: string;
  orderedQty: string;
  receivedQty: string;
  /** billed on other live bills of the same PO */
  billedElsewhereQty: string;
  /** billed on this bill */
  billQty: string;
  poUnitPrice: string;
  /** amount / quantity on this bill */
  billUnitPrice: string;
}

export interface MatchResultLine extends MatchInputLine {
  billedTotalQty: string;
  maxUnitPrice: string;
  problems: MatchProblem[];
}

export interface MatchResult {
  status: 'matched' | 'mismatch';
  tolerancePercent: string;
  lines: MatchResultLine[];
}

const qty = (d: Decimal) => d.toDecimalPlaces(3).toString();
const money = (d: Decimal) =>
  d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

export function threeWayMatch(
  lines: MatchInputLine[],
  tolerancePercent: string,
): MatchResult {
  const factor = new Decimal(1).plus(
    new Decimal(tolerancePercent).dividedBy(100),
  );
  const out = lines.map((l) => {
    const billedTotal = new Decimal(l.billedElsewhereQty).plus(l.billQty);
    const maxPrice = new Decimal(l.poUnitPrice).times(factor);
    const problems: MatchProblem[] = [];
    if (billedTotal.greaterThan(l.receivedQty))
      problems.push('billed_more_than_received');
    if (billedTotal.greaterThan(l.orderedQty))
      problems.push('billed_more_than_ordered');
    // compare at the paisa: a bill line's unit price comes from amount / quantity
    if (
      new Decimal(l.billUnitPrice)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .greaterThan(maxPrice.toDecimalPlaces(2, Decimal.ROUND_HALF_UP))
    ) {
      problems.push('price_above_order');
    }
    return {
      ...l,
      billedTotalQty: qty(billedTotal),
      maxUnitPrice: money(maxPrice),
      problems,
    };
  });
  return {
    status: out.some((l) => l.problems.length) ? 'mismatch' : 'matched',
    tolerancePercent,
    lines: out,
  };
}
