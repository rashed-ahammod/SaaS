-- =============================================================================
-- 0021  Opening balances (Phase 2 WP14)
--
-- A company that starts its books in the ERP brings its balances from the old
-- system as one opening journal, dated on the first day of the cut-over month.
-- At most one live opening voucher per company: a correction is a reversal, or
-- cancelling the draft, never a second opening.
-- =============================================================================

CREATE UNIQUE INDEX one_opening_per_company ON vouchers (tenant_id, company_id)
  WHERE is_opening AND reversal_of IS NULL AND reversed_by IS NULL AND state <> 'cancelled';
