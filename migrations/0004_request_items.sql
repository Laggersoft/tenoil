-- Migration 0004: Request items (multiple positions per request), user stats

-- Request items table (multiple products per request)
CREATE TABLE IF NOT EXISTS request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  item_number INTEGER NOT NULL DEFAULT 1,
  product_name TEXT NOT NULL,
  model TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit TEXT DEFAULT 'шт.',
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_request_items_request_id ON request_items(request_id);

-- Backfill: convert existing requests to items
INSERT OR IGNORE INTO request_items (request_id, item_number, product_name, model, quantity)
SELECT id, 1, product_name, model, quantity FROM requests WHERE product_name IS NOT NULL AND product_name != '';
