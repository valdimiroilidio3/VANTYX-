import type { Migration } from "../migrate";

/**
 * 003 — Industry (vertical) domain tables: restaurant floor & kitchen
 * operations, service businesses scheduling, and auto/electronics repair
 * orders. Tables exist for every vertical pack; packs activate them via
 * the module registry.
 */
export const migration003Industry: Migration = {
  id: "003_industry",
  name: "Vertical domains: restaurant, scheduling, repair orders",
  up(db) {
    db.exec(`
-- ============ RESTAURANT ============
CREATE TABLE r_tables (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id   TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  zone        TEXT NOT NULL DEFAULT 'main',
  seats       INTEGER NOT NULL DEFAULT 4,
  status      TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','occupied','reserved','bill_requested')),
  position_x  INTEGER NOT NULL DEFAULT 0,
  position_y  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  UNIQUE (org_id, branch_id, name)
);
CREATE INDEX idx_rtables_branch ON r_tables(org_id, branch_id);

CREATE TABLE r_orders (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  branch_id    TEXT NOT NULL,
  table_id     TEXT REFERENCES r_tables(id) ON DELETE SET NULL,
  channel      TEXT NOT NULL DEFAULT 'dine_in' CHECK (channel IN ('dine_in','takeaway','counter','delivery')),
  customer_id  TEXT,
  customer_name TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  guest_count  INTEGER NOT NULL DEFAULT 1,
  opened_at    INTEGER NOT NULL,
  opened_by    TEXT,
  closed_at    INTEGER,
  sale_id      TEXT,
  notes        TEXT
);
CREATE INDEX idx_rorders_open ON r_orders(org_id, branch_id, status);

CREATE TABLE modifier_groups (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  min_select   INTEGER NOT NULL DEFAULT 0,
  max_select   INTEGER NOT NULL DEFAULT 9,
  created_at   INTEGER NOT NULL
);

CREATE TABLE modifier_options (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  group_id      TEXT NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  price_delta_cents INTEGER NOT NULL DEFAULT 0,
  is_default    INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 100
);

CREATE TABLE product_modifier_groups (
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id    TEXT NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, group_id)
);

CREATE TABLE kitchen_tickets (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  order_id     TEXT NOT NULL REFERENCES r_orders(id) ON DELETE CASCADE,
  station      TEXT NOT NULL DEFAULT 'kitchen' CHECK (station IN ('kitchen','bar','grill','cold')),
  sequence     INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','preparing','ready','delivered','cancelled')),
  table_label  TEXT,
  channel      TEXT,
  note         TEXT,
  sent_at      INTEGER NOT NULL,
  started_at   INTEGER,
  ready_at     INTEGER,
  delivered_at INTEGER,
  cancelled_at INTEGER
);
CREATE INDEX idx_tickets_open ON kitchen_tickets(org_id, status, sent_at);
CREATE INDEX idx_tickets_order ON kitchen_tickets(order_id);

CREATE TABLE kitchen_ticket_lines (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  ticket_id   TEXT NOT NULL REFERENCES kitchen_tickets(id) ON DELETE CASCADE,
  product_id  TEXT NOT NULL,
  variant_id  TEXT,
  name        TEXT NOT NULL,
  qty_milli   INTEGER NOT NULL,
  unit        TEXT NOT NULL DEFAULT 'un',
  modifiers   TEXT NOT NULL DEFAULT '[]',
  notes       TEXT,
  sequence    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE r_order_items (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  order_id      TEXT NOT NULL REFERENCES r_orders(id) ON DELETE CASCADE,
  ticket_id     TEXT REFERENCES kitchen_tickets(id) ON DELETE SET NULL,
  product_id    TEXT NOT NULL,
  variant_id    TEXT,
  name_snapshot TEXT NOT NULL,
  qty_milli     INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  modifiers     TEXT NOT NULL DEFAULT '[]',
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','sent','served','cancelled','billed')),
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_roitems_order ON r_order_items(order_id);

CREATE TABLE reservations (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id     TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  table_id      TEXT REFERENCES r_tables(id) ON DELETE SET NULL,
  customer_id   TEXT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  phone         TEXT,
  party_size    INTEGER NOT NULL DEFAULT 2,
  reserved_for  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','seated','completed','cancelled','no_show')),
  note          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_reservations_branch ON reservations(org_id, branch_id, reserved_for);

CREATE TABLE recipes (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  servings     INTEGER NOT NULL DEFAULT 1,
  waste_pct    INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  created_at   INTEGER NOT NULL
);

CREATE TABLE recipe_items (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  recipe_id     TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty_milli     INTEGER NOT NULL
);

CREATE TABLE waste_records (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  product_id   TEXT NOT NULL,
  variant_id   TEXT,
  qty_milli    INTEGER NOT NULL,
  reason_code  TEXT NOT NULL DEFAULT 'spoilage' CHECK (reason_code IN ('spoilage','preparation','overproduction','damage','other')),
  note         TEXT,
  created_by   TEXT,
  created_at   INTEGER NOT NULL
);

-- ============ SERVICE BUSINESSES (barber / salon / spa) ============
CREATE TABLE service_resources (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id    TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'staff' CHECK (kind IN ('staff','room','equipment')),
  commission_bps INTEGER NOT NULL DEFAULT 0,
  color        TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL
);

CREATE TABLE appointments (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  resource_id    TEXT NOT NULL REFERENCES service_resources(id) ON DELETE CASCADE,
  customer_id    TEXT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name  TEXT NOT NULL,
  phone          TEXT,
  product_id     TEXT REFERENCES products(id) ON DELETE SET NULL,
  starts_at      INTEGER NOT NULL,
  duration_min   INTEGER NOT NULL DEFAULT 30,
  status         TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','confirmed','in_progress','done','cancelled','no_show')),
  price_cents    INTEGER,
  notes          TEXT,
  sale_id        TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_appointments_branch ON appointments(org_id, branch_id, starts_at);

-- ============ REPAIR / WORK ORDERS (auto shops, electronics) ============
CREATE TABLE work_orders (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id      TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  wo_number      TEXT NOT NULL,
  customer_id    TEXT REFERENCES customers(id) ON DELETE SET NULL,
  vehicle_plate  TEXT,
  vehicle_info   TEXT,
  equipment_serial TEXT,
  status         TEXT NOT NULL DEFAULT 'quote' CHECK (status IN ('quote','approved','in_progress','waiting_parts','done','delivered','cancelled')),
  diagnosis      TEXT,
  labor_minutes  INTEGER NOT NULL DEFAULT 0,
  labor_rate_cents INTEGER NOT NULL DEFAULT 0,
  parts_cents    INTEGER NOT NULL DEFAULT 0,
  labor_cents    INTEGER NOT NULL DEFAULT 0,
  total_cents    INTEGER NOT NULL DEFAULT 0,
  warranty_ends_at INTEGER,
  sale_id        TEXT,
  created_by     TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (org_id, wo_number)
);
CREATE INDEX idx_wo_org ON work_orders(org_id, status);

CREATE TABLE work_order_parts (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id    TEXT,
  qty_milli     INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL
);

-- ============ AUTOMOTIVE COMPATIBILITY CATALOG ============
-- Compatibility data MUST come from a licensed/imported catalog.
-- Rows are only created via validated imports (source required).
CREATE TABLE vehicle_catalog (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  make        TEXT NOT NULL,
  model       TEXT NOT NULL,
  year_from   INTEGER,
  year_to     INTEGER,
  engine      TEXT,
  source      TEXT NOT NULL DEFAULT 'import'
);
CREATE INDEX idx_vehicle_lookup ON vehicle_catalog(org_id, make, model);

CREATE TABLE part_compatibility (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  vehicle_id     TEXT NOT NULL REFERENCES vehicle_catalog(id) ON DELETE CASCADE,
  oem_reference  TEXT,
  source         TEXT NOT NULL DEFAULT 'import',
  validated_at   INTEGER,
  UNIQUE (product_id, vehicle_id, oem_reference)
);
`);
  },
};
