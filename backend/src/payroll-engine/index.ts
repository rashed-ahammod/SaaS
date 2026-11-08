/**
 * Payroll engine public API. A pure library (guide §12.1): it must never import
 * the database, Nest, the network or the clock. engine-purity.spec.ts checks this.
 */
export * from './types.js';
export {
  calculateMonthly,
  calculateBonus,
  computeArrears,
  monthsLeftAfter,
  type BonusInput,
  type ArrearsInput,
} from './engine.js';
export { annualTax, monthlyWithholding } from './tax.js';
export { applyStructure } from './earnings.js';
export { SYSTEM_HEADS } from './heads.js';
