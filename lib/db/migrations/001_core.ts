import type { Migration } from "../migrate";

/**
 * 001 — Platform core: organizations, profiles, structure (branches,
 * warehouses, terminals), identity (users, roles, sessions, invites),
 * module activation, rules engine, approvals, notifications, audit,
 * idempotency and integration configuration.
 *
 * Conventions:
 *  - ids: TEXT (prefixed UUIDs, e.g. "org_…", "usr_…") — safe for
 *    offline/client-generated references.
 *  - timestamps: INTEGER unix epoch milliseconds.
 *  - money: INTEGER minor units (cents). Never floats.
 *  - quantities: INTEGER milli-units (qty_milli; 1 unit = 1000,
 *    1.25 kg = 1250). Exact arithmetic for weight/volume sales.
 *  - tax rates: INTEGER basis points (2300 = 23.00%).
 *  - every operational table carries org_id (multi-tenant isolation).
 */
export const migration001Core: Migration = {
  id: "001_core",
  name: "Platform core: orgs, identity, modules, governance",
  async up(db) {
    await db.exec(`
CREATE TABLE organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  legal_name    TEXT,
  tax_id        TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  demo          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE org_profiles (
  org_id              TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  industry            TEXT NOT NULL,
  sub_industry        TEXT,
  country             TEXT NOT NULL DEFAULT 'PT',
  currency            TEXT NOT NULL DEFAULT 'EUR',
  locale              TEXT NOT NULL DEFAULT 'pt-PT',
  timezone            TEXT NOT NULL DEFAULT 'Europe/Lisbon',
  tax_regime          TEXT NOT NULL DEFAULT 'standard',
  prices_include_tax  INTEGER NOT NULL DEFAULT 1,
  default_tax_bps     INTEGER NOT NULL DEFAULT 2300,
  settings            TEXT NOT NULL DEFAULT '{}',
  onboarded_at        INTEGER,
  updated_at          INTEGER NOT NULL
);

CREATE TABLE branches (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL,
  address     TEXT,
  city        TEXT,
  phone       TEXT,
  timezone    TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  settings    TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  UNIQUE (org_id, code)
);
CREATE INDEX idx_branches_org ON branches(org_id);

CREATE TABLE warehouses (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id   TEXT REFERENCES branches(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  UNIQUE (org_id, code)
);
CREATE INDEX idx_warehouses_org ON warehouses(org_id);

CREATE TABLE terminals (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id   TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'pos' CHECK (kind IN ('pos','kds','tablet','backoffice')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  INTEGER NOT NULL,
  UNIQUE (org_id, code)
);
CREATE INDEX idx_terminals_org ON terminals(org_id);

CREATE TABLE roles (
  id           TEXT PRIMARY KEY,
  org_id       TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  is_system    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  UNIQUE (org_id, key)
);

CREATE TABLE role_permissions (
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  pin_hash       TEXT,
  role_id        TEXT REFERENCES roles(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','suspended')),
  mfa_enabled    INTEGER NOT NULL DEFAULT 0,
  last_login_at  INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (org_id, email)
);
CREATE INDEX idx_users_org ON users(org_id);

CREATE TABLE user_branches (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id  TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, branch_id)
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  terminal_id   TEXT REFERENCES terminals(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  user_agent    TEXT,
  ip            TEXT,
  revoked_at    INTEGER
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE invites (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role_key     TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  invited_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  accepted_at  INTEGER
);

CREATE TABLE org_modules (
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_id    TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  version      TEXT NOT NULL DEFAULT '1.0.0',
  config       TEXT NOT NULL DEFAULT '{}',
  enabled_at   INTEGER,
  disabled_at  INTEGER,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (org_id, module_id)
);

CREATE TABLE business_rules (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  scope        TEXT NOT NULL DEFAULT '{}',
  condition    TEXT NOT NULL,
  action       TEXT NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 100,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (org_id, key)
);
CREATE INDEX idx_rules_org ON business_rules(org_id, enabled, priority);

CREATE TABLE rule_executions (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  rule_id      TEXT NOT NULL REFERENCES business_rules(id) ON DELETE CASCADE,
  context      TEXT NOT NULL DEFAULT '{}',
  result       TEXT NOT NULL CHECK (result IN ('allowed','blocked','approval_required','applied','skipped')),
  detail       TEXT,
  ref_type     TEXT,
  ref_id       TEXT,
  executed_by  TEXT,
  executed_at  INTEGER NOT NULL
);
CREATE INDEX idx_rule_exec_org ON rule_executions(org_id, executed_at);

CREATE TABLE approvals (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  ref_type      TEXT,
  ref_id        TEXT,
  params        TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  decided_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  reason        TEXT,
  created_at    INTEGER NOT NULL,
  decided_at    INTEGER
);
CREATE INDEX idx_approvals_org ON approvals(org_id, status);

CREATE TABLE notifications (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  title       TEXT NOT NULL,
  body        TEXT,
  ref_type    TEXT,
  ref_id      TEXT,
  dedupe_key  TEXT,
  read_at     INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_notifications_org ON notifications(org_id, read_at, created_at);

CREATE TABLE automation_runs (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  task_key        TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('running','success','failed')),
  idempotency_key TEXT,
  result          TEXT,
  error           TEXT,
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  UNIQUE (org_id, task_key, idempotency_key)
);

CREATE TABLE audit_logs (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  actor_user_id   TEXT,
  actor_label     TEXT,
  action          TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  resource_id     TEXT,
  branch_id       TEXT,
  before          TEXT,
  after           TEXT,
  result          TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure')),
  detail          TEXT,
  ip              TEXT,
  user_agent      TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_audit_org ON audit_logs(org_id, created_at);
CREATE INDEX idx_audit_resource ON audit_logs(org_id, resource_type, resource_id);

CREATE TABLE idempotency_keys (
  org_id        TEXT NOT NULL,
  endpoint      TEXT NOT NULL,
  key           TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  status_code   INTEGER NOT NULL,
  response      TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (org_id, endpoint, key)
);

CREATE TABLE integrations (
  org_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key              TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured','configured','error','disabled')),
  config           TEXT NOT NULL DEFAULT '{}',
  credentials_set  INTEGER NOT NULL DEFAULT 0,
  last_test_at     INTEGER,
  last_error       TEXT,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (org_id, key)
);

CREATE TABLE dashboard_preferences (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  layout      TEXT NOT NULL DEFAULT '{}',
  updated_at  INTEGER NOT NULL,
  UNIQUE (org_id, user_id)
);
`);
  },
};
