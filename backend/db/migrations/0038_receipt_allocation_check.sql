-- =============================================================================
-- 0038  The receipt allocation check (0037) reads the receipt id by the table that fired it:
--       a customer_receipts row has no receipt_id column, so COALESCE(NEW.receipt_id, NEW.id)
--       failed at commit.
-- =============================================================================

CREATE OR REPLACE FUNCTION app_receipt_allocations_check() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  r customer_receipts%ROWTYPE;
  s numeric;
  rid uuid;
BEGIN
  IF TG_TABLE_NAME = 'customer_receipts' THEN rid := NEW.id; ELSE rid := NEW.receipt_id; END IF;
  SELECT * INTO r FROM customer_receipts WHERE id = rid;
  SELECT coalesce(sum(amount), 0) INTO s FROM customer_receipt_allocations WHERE receipt_id = r.id;
  IF s <> r.allocated THEN
    RAISE EXCEPTION 'receipt % allocates % but its allocations add up to %', r.number, r.allocated, s USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
