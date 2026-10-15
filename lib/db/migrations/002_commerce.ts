import type { Migration } from "../migrate";

/**
 * 002 — Universal commerce core: catalog, inventory, CRM, purchasing,
 * sales documents, payments and cash control.
 */
export const migration002Commerce: Migration = {
  id: "002_commerce",
  name: "Catalog, inventory, CRM, purchasing, sales, cash",
  async up(db) {
    await db.exec(`
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (org_id, parent_id, name)
);
CREATE INDEX idx_categories_org ON categories(org_id);

CREATE TABLE products (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type               TEXT NOT NULL DEFAULT 'simple' CHECK (type IN ('simple','variant','composite','service')),
  name               TEXT NOT NULL,
  description        TEXT,
  category_id        TEXT REFERENCES categories(id) ON DELETE SET NULL,
  sku                TEXT NOT NULL,
  base_price_cents   INTEGER NOT NULL DEFAULT 0,
  cost_cents         INTEGER NOT NULL DEFAULT 0,
  tax_rate_bps       INTEGER NOT NULL DEFAULT 2300,
  unit               TEXT NOT NULL DEFAULT 'un',
  sale_mode          TEXT NOT NULL DEFAULT 'units' CHECK (sale_mode IN ('units','weight')),
  track_stock        INTEGER NOT NULL DEFAULT 1,
  allow_negative     INTEGER,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','discontinued','archived')),
  image_url          TEXT,
  attributes         TEXT NOT NULL DEFAULT '{}',
  supplier_id        TEXT,
  reorder_point_milli INTEGER,
  reorder_qty_milli  INTEGER,
  shelf_life_days    INTEGER,
  track_batches      INTEGER NOT NULL DEFAULT 0,
  track_serials      INTEGER NOT NULL DEFAULT 0,
  created_by         TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  UNIQUE (org_id, sku)
);
CREATE INDEX idx_products_org ON products(org_id, status);
CREATE INDEX idx_products_name ON products(org_id, name);
CREATE INDEX idx_products_category ON products(org_id, category_id);

CREATE TABLE product_variants (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku            TEXT NOT NULL,
  label          TEXT NOT NULL,
  price_cents    INTEGER,
  cost_cents     INTEGER,
  tax_rate_bps   INTEGER,
  attributes     TEXT NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','discontinued','archived')),
  created_at     INTEGER NOT NULL,
  UNIQUE (org_id, sku)
);
CREATE INDEX idx_variants_product ON product_variants(product_id);

CREATE TABLE barcodes (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id      TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  embedded_kind   TEXT CHECK (embedded_kind IN ('price','weight')),
  created_at      INTEGER NOT NULL,
  UNIQUE (org_id, code)
);

CREATE TABLE kit_items (
  id                     TEXT PRIMARY KEY,
  org_id                 TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id             TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  component_variant_id   TEXT REFERENCES product_variants(id) ON DELETE RESTRICT,
  qty_milli              INTEGER NOT NULL,
  UNIQUE (product_id, component_product_id, component_variant_id)
);

CREATE TABLE price_lists (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'EUR',
  is_default  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE price_list_items (
  id             TEXT PRIMARY KEY,
  price_list_id  TEXT NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  org_id         TEXT NOT NULL,
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id     TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
  price_cents    INTEGER NOT NULL,
  UNIQUE (price_list_id, product_id, variant_id)
);

CREATE TABLE promotions (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('quantity_discount','period_price')),
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id   TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
  params       TEXT NOT NULL DEFAULT '{}',
  starts_at    INTEGER,
  ends_at      INTEGER,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','expired')),
  priority     INTEGER NOT NULL DEFAULT 100,
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_promotions_org ON promotions(org_id, status);

CREATE TABLE batches (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id   TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id     TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
  batch_number   TEXT NOT NULL,
  expiry_date    INTEGER,
  qty_received_milli INTEGER NOT NULL DEFAULT 0,
  qty_remaining_milli INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents INTEGER,
  supplier_id    TEXT,
  received_at    INTEGER NOT NULL,
  UNIQUE (org_id, warehouse_id, product_id, variant_id, batch_number)
);
CREATE INDEX idx_batches_expiry ON batches(org_id, expiry_date);

CREATE TABLE serials (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id     TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
  warehouse_id   TEXT REFERENCES warehouses(id) ON DELETE SET NULL,
  serial_number  TEXT NOT NULL,
  imei           INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','sold','returned','rma','scrapped')),
  sale_id        TEXT,
  warranty_ends_at INTEGER,
  received_at    INTEGER NOT NULL,
  UNIQUE (org_id, serial_number)
);

CREATE TABLE stock_levels (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id     TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id       TEXT REFERENCES product_variants(id) ON DELETE CASCADE,
  qty_milli        INTEGER NOT NULL DEFAULT 0,
  reserved_milli   INTEGER NOT NULL DEFAULT 0,
  avg_cost_cents   INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL,
  UNIQUE (warehouse_id, product_id, variant_id)
);
CREATE INDEX idx_stock_org ON stock_levels(org_id, product_id);

CREATE TABLE stock_movements (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL,
  warehouse_id     TEXT NOT NULL,
  product_id       TEXT NOT NULL,
  variant_id       TEXT,
  qty_milli        INTEGER NOT NULL,
  reason_code      TEXT NOT NULL,
  ref_type         TEXT,
  ref_id           TEXT,
  batch_id         TEXT,
  unit_cost_cents  INTEGER,
  note             TEXT,
  created_by       TEXT,
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_stock_mov_org ON stock_movements(org_id, created_at);
CREATE INDEX idx_stock_mov_product ON stock_movements(org_id, product_id, variant_id);

CREATE TABLE stock_transfers (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_warehouse_id  TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  to_warehouse_id    TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_transit','completed','cancelled')),
  note               TEXT,
  created_by         TEXT,
  created_at         INTEGER NOT NULL,
  completed_at       INTEGER
);

CREATE TABLE stock_transfer_lines (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,
  transfer_id        TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id         TEXT NOT NULL,
  variant_id         TEXT,
  qty_milli          INTEGER NOT NULL,
  received_qty_milli INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE count_sheets (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  warehouse_id  TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','counting','completed','cancelled')),
  note          TEXT,
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  completed_at  INTEGER
);

CREATE TABLE count_sheet_lines (
  id                TEXT PRIMARY KEY,
  sheet_id          TEXT NOT NULL REFERENCES count_sheets(id) ON DELETE CASCADE,
  org_id            TEXT NOT NULL,
  product_id        TEXT NOT NULL,
  variant_id        TEXT,
  batch_id          TEXT,
  expected_milli    INTEGER NOT NULL DEFAULT 0,
  counted_milli     INTEGER,
  variance_milli    INTEGER,
  counted_by        TEXT,
  counted_at        INTEGER
);

CREATE TABLE customers (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  email               TEXT,
  phone               TEXT,
  tax_id              TEXT,
  address             TEXT,
  city                TEXT,
  notes               TEXT,
  tags                TEXT NOT NULL DEFAULT '[]',
  marketing_consent   INTEGER NOT NULL DEFAULT 0,
  data_consent        INTEGER NOT NULL DEFAULT 1,
  customer_type       TEXT NOT NULL DEFAULT 'individual' CHECK (customer_type IN ('individual','business')),
  price_list_id       TEXT REFERENCES price_lists(id) ON DELETE SET NULL,
  credit_limit_cents  INTEGER NOT NULL DEFAULT 0,
  credit_balance_cents INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','archived')),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX idx_customers_org ON customers(org_id, name);
CREATE INDEX idx_customers_phone ON customers(org_id, phone);

CREATE TABLE loyalty_accounts (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id     TEXT NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  points_balance  INTEGER NOT NULL DEFAULT 0,
  tier            TEXT NOT NULL DEFAULT 'base',
  created_at      INTEGER NOT NULL
);

CREATE TABLE loyalty_transactions (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  account_id   TEXT NOT NULL REFERENCES loyalty_accounts(id) ON DELETE CASCADE,
  delta_points INTEGER NOT NULL,
  reason       TEXT NOT NULL CHECK (reason IN ('earn','redeem','adjust','expire')),
  ref_type     TEXT,
  ref_id       TEXT,
  note         TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE data_requests (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id  TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('access','rectification','erasure','portability')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','rejected')),
  note         TEXT,
  requested_at INTEGER NOT NULL,
  resolved_at  INTEGER,
  resolved_by  TEXT
);

CREATE TABLE suppliers (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  contact_name   TEXT,
  email          TEXT,
  phone          TEXT,
  tax_id         TEXT,
  address        TEXT,
  payment_terms  TEXT,
  lead_time_days INTEGER,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_suppliers_org ON suppliers(org_id, name);

CREATE TABLE purchase_orders (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  po_number         TEXT NOT NULL,
  supplier_id       TEXT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  warehouse_id      TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','sent','partially_received','received','cancelled')),
  expected_at       INTEGER,
  subtotal_cents    INTEGER NOT NULL DEFAULT 0,
  tax_cents         INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL DEFAULT 0,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  approved_by       TEXT,
  approved_at       INTEGER,
  note              TEXT,
  created_by        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  UNIQUE (org_id, po_number)
);
CREATE INDEX idx_po_org ON purchase_orders(org_id, status);

CREATE TABLE purchase_order_lines (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL,
  po_id            TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id       TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  qty_milli        INTEGER NOT NULL,
  received_milli   INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents  INTEGER NOT NULL,
  tax_rate_bps     INTEGER NOT NULL DEFAULT 2300,
  note             TEXT
);

CREATE TABLE goods_receipts (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  po_id         TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  warehouse_id  TEXT NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  note          TEXT,
  received_by   TEXT,
  received_at   INTEGER NOT NULL
);

CREATE TABLE goods_receipt_lines (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  receipt_id      TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  po_line_id      TEXT NOT NULL REFERENCES purchase_order_lines(id) ON DELETE RESTRICT,
  product_id      TEXT NOT NULL,
  variant_id      TEXT,
  qty_milli       INTEGER NOT NULL,
  unit_cost_cents INTEGER NOT NULL,
  batch_number    TEXT,
  expiry_date     INTEGER,
  serial_numbers  TEXT
);

CREATE TABLE supplier_price_history (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL,
  supplier_id      TEXT NOT NULL,
  product_id       TEXT NOT NULL,
  variant_id       TEXT,
  unit_cost_cents  INTEGER NOT NULL,
  po_id            TEXT,
  recorded_at      INTEGER NOT NULL
);
CREATE INDEX idx_sph_lookup ON supplier_price_history(org_id, product_id, recorded_at);

CREATE TABLE payment_methods (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('cash','card','digital_wallet','transfer','store_credit','gift_card','customer_credit','other')),
  enabled          INTEGER NOT NULL DEFAULT 1,
  is_cash          INTEGER NOT NULL DEFAULT 0,
  requires_terminal INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL DEFAULT 100,
  config           TEXT NOT NULL DEFAULT '{}',
  UNIQUE (org_id, key)
);

CREATE TABLE shifts (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id   TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  note        TEXT
);
CREATE INDEX idx_shifts_org ON shifts(org_id, started_at);

CREATE TABLE cash_sessions (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id             TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  terminal_id           TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
  shift_id              TEXT REFERENCES shifts(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_float_cents   INTEGER NOT NULL DEFAULT 0,
  opened_by             TEXT NOT NULL,
  opened_at             INTEGER NOT NULL,
  closed_by             TEXT,
  closed_at             INTEGER,
  expected_cash_cents   INTEGER,
  counted_cash_cents    INTEGER,
  difference_cents      INTEGER,
  closing_note          TEXT,
  totals                TEXT
);
CREATE INDEX idx_cash_sessions_org ON cash_sessions(org_id, status);
CREATE UNIQUE INDEX idx_cash_open_terminal ON cash_sessions(terminal_id) WHERE status = 'open';

CREATE TABLE cash_movements (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('in','out')),
  amount_cents   INTEGER NOT NULL,
  reason_code    TEXT NOT NULL,
  note           TEXT,
  created_by     TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_cash_mov_session ON cash_movements(cash_session_id);

CREATE TABLE document_series (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  doc_type     TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  fiscal_year  INTEGER NOT NULL,
  next_number  INTEGER NOT NULL DEFAULT 1,
  UNIQUE (org_id, doc_type, prefix, fiscal_year)
);

CREATE TABLE sales (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL,
  branch_id        TEXT NOT NULL,
  terminal_id      TEXT,
  cash_session_id  TEXT,
  shift_id         TEXT,
  customer_id      TEXT,
  order_id         TEXT,
  client_ref       TEXT,
  idempotency_key  TEXT,
  document_type    TEXT NOT NULL DEFAULT 'FT',
  document_number  TEXT,
  sequence_number  INTEGER,
  fiscal_year      INTEGER,
  status           TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','void','partially_returned','returned')),
  channel          TEXT NOT NULL DEFAULT 'in_store' CHECK (channel IN ('in_store','takeaway','delivery','counter','online')),
  currency         TEXT NOT NULL DEFAULT 'EUR',
  subtotal_cents   INTEGER NOT NULL DEFAULT 0,
  discount_cents   INTEGER NOT NULL DEFAULT 0,
  tax_cents        INTEGER NOT NULL DEFAULT 0,
  net_cents        INTEGER NOT NULL DEFAULT 0,
  total_cents      INTEGER NOT NULL DEFAULT 0,
  paid_cents       INTEGER NOT NULL DEFAULT 0,
  change_cents     INTEGER NOT NULL DEFAULT 0,
  cost_cents       INTEGER NOT NULL DEFAULT 0,
  tax_breakdown    TEXT NOT NULL DEFAULT '{}',
  loyalty_earned   INTEGER NOT NULL DEFAULT 0,
  loyalty_redeemed INTEGER NOT NULL DEFAULT 0,
  guest_count      INTEGER,
  notes            TEXT,
  hash             TEXT,
  prev_hash        TEXT,
  void_reason      TEXT,
  voided_by        TEXT,
  voided_at        INTEGER,
  created_by       TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);
CREATE INDEX idx_sales_org ON sales(org_id, created_at);
CREATE INDEX idx_sales_doc ON sales(org_id, document_number);
CREATE UNIQUE INDEX idx_sales_client_ref ON sales(org_id, client_ref) WHERE client_ref IS NOT NULL;
CREATE INDEX idx_sales_branch ON sales(org_id, branch_id, created_at);
CREATE INDEX idx_sales_customer ON sales(org_id, customer_id);
CREATE INDEX idx_sales_session ON sales(cash_session_id);

CREATE TABLE sale_lines (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL,
  sale_id           TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  sequence          INTEGER NOT NULL,
  product_id        TEXT NOT NULL,
  variant_id        TEXT,
  name_snapshot     TEXT NOT NULL,
  sku_snapshot      TEXT,
  qty_milli         INTEGER NOT NULL,
  returned_milli    INTEGER NOT NULL DEFAULT 0,
  unit              TEXT NOT NULL DEFAULT 'un',
  sale_mode         TEXT NOT NULL DEFAULT 'units',
  unit_price_cents  INTEGER NOT NULL,
  tax_rate_bps      INTEGER NOT NULL,
  discount_cents    INTEGER NOT NULL DEFAULT 0,
  discount_reason   TEXT,
  gross_cents       INTEGER NOT NULL,
  net_cents         INTEGER NOT NULL,
  tax_cents         INTEGER NOT NULL,
  total_cents       INTEGER NOT NULL,
  cost_cents        INTEGER NOT NULL DEFAULT 0,
  promotion_id      TEXT,
  modifiers         TEXT NOT NULL DEFAULT '[]',
  notes             TEXT
);
CREATE INDEX idx_sale_lines_sale ON sale_lines(sale_id);
CREATE INDEX idx_sale_lines_product ON sale_lines(org_id, product_id);

CREATE TABLE sale_payments (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  sale_id       TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method_key    TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,
  tendered_cents INTEGER,
  change_cents  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','declined','refunded')),
  terminal_ref  TEXT,
  created_at    INTEGER NOT NULL,
  confirmed_at  INTEGER
);
CREATE INDEX idx_sale_payments_sale ON sale_payments(sale_id);

CREATE TABLE held_sales (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  branch_id    TEXT NOT NULL,
  terminal_id  TEXT,
  user_id      TEXT,
  customer_id  TEXT,
  label        TEXT,
  cart         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_held_org ON held_sales(org_id, branch_id);

CREATE TABLE returns (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  sale_id         TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  document_number TEXT,
  sequence_number INTEGER,
  fiscal_year     INTEGER,
  status          TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','void')),
  reason_code     TEXT NOT NULL DEFAULT 'other',
  restock         INTEGER NOT NULL DEFAULT 1,
  warehouse_id    TEXT,
  note            TEXT,
  subtotal_cents  INTEGER NOT NULL DEFAULT 0,
  tax_cents       INTEGER NOT NULL DEFAULT 0,
  total_cents     INTEGER NOT NULL DEFAULT 0,
  prev_hash       TEXT,
  hash            TEXT,
  created_by      TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_returns_org ON returns(org_id, created_at);

CREATE TABLE return_lines (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  return_id      TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  sale_line_id   TEXT NOT NULL REFERENCES sale_lines(id) ON DELETE RESTRICT,
  qty_milli      INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  tax_rate_bps   INTEGER NOT NULL,
  total_cents    INTEGER NOT NULL,
  tax_cents      INTEGER NOT NULL,
  restock        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE return_payments (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  return_id    TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  method_key   TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
);

CREATE TABLE gift_cards (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,
  initial_cents   INTEGER NOT NULL,
  balance_cents   INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','depleted','blocked','expired')),
  expires_at      INTEGER,
  sold_by         TEXT,
  created_at      INTEGER NOT NULL
);

CREATE TABLE gift_card_transactions (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  card_id     TEXT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  delta_cents INTEGER NOT NULL,
  ref_type    TEXT,
  ref_id      TEXT,
  created_at  INTEGER NOT NULL
);
`);
  },
};
