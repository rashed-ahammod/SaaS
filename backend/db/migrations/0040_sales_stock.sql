-- =============================================================================
-- 0040  Sales take stock out of a store (2026-10-31)
--
--   products.stock_item_id     goods kept in a store: the stock item they are
--   sales_orders.store_id      the store the order was delivered from
--   stock_moves sales_issue    out on delivery (negative), per order line
--   stock_moves sales_return   back in with a credit note for returned goods (positive)
--
-- The balance trigger (0029) keeps a store's stock from going below zero, so a delivery
-- larger than what is on hand is refused by the database too.
-- =============================================================================

ALTER TABLE products ADD COLUMN stock_item_id uuid REFERENCES stock_items (id);
ALTER TABLE products ADD CONSTRAINT products_stock_goods CHECK (stock_item_id IS NULL OR kind = 'goods');

ALTER TABLE sales_orders ADD COLUMN store_id uuid REFERENCES stores (id);

ALTER TABLE stock_moves ADD COLUMN sales_order_id uuid REFERENCES sales_orders (id);
ALTER TABLE stock_moves ADD COLUMN credit_note_id uuid REFERENCES credit_notes (id);
ALTER TABLE stock_moves DROP CONSTRAINT stock_moves_kind_check;
ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_kind_check CHECK (kind IN ('opening', 'receipt', 'issue', 'adjustment', 'sales_issue', 'sales_return'));
ALTER TABLE stock_moves DROP CONSTRAINT stock_moves_check;
ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_check CHECK (
  (kind IN ('opening', 'receipt', 'sales_return') AND quantity > 0)
  OR (kind IN ('issue', 'sales_issue') AND quantity < 0)
  OR kind = 'adjustment'
);
-- a sales issue names its order, a sales return its credit note; nothing else names either
ALTER TABLE stock_moves ADD CONSTRAINT stock_moves_sales_source CHECK (
  (kind = 'sales_issue') = (sales_order_id IS NOT NULL)
  AND (kind = 'sales_return') = (credit_note_id IS NOT NULL)
);
