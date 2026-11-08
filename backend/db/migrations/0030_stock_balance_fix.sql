-- =============================================================================
-- 0030  Stock balance trigger fix (WP19)
--
-- INSERT ... ON CONFLICT DO UPDATE checks the CHECK constraint (quantity >= 0) on the
-- proposed new row before it resolves the conflict, so every issue (a negative move)
-- was refused even with stock on hand. Update the existing balance first; insert only
-- for the first move of an item in a store (which must be an increase).
-- =============================================================================

CREATE OR REPLACE FUNCTION stock_move_balance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE stock_balances SET quantity = quantity + NEW.quantity
   WHERE tenant_id = NEW.tenant_id AND store_id = NEW.store_id AND item_id = NEW.item_id;
  IF NOT FOUND THEN
    INSERT INTO stock_balances (tenant_id, store_id, item_id, quantity) VALUES (NEW.tenant_id, NEW.store_id, NEW.item_id, NEW.quantity);
  END IF;
  RETURN NEW;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'stock of item % in store % would go below zero', NEW.item_id, NEW.store_id USING ERRCODE = 'check_violation';
END $$;
