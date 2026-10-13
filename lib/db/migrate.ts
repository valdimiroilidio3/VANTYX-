import type { Db } from "./client";
import { migration001Core } from "./migrations/001_core";
import { migration002Commerce } from "./migrations/002_commerce";
import { migration003Industry } from "./migrations/003_industry";

export interface Migration {
  /** Ordered, immutable identifier. Never rename or reuse. */
  id: string;
  name: string;
  up(db: Db): void;
}

/**
 * Versioned migrations. Each entry is applied exactly once, in order,
 * inside its own transaction. Applied migrations are never modified;
 * schema changes are always additive via new migration files.
 */
export const MIGRATIONS: Migration[] = [
  migration001Core,
  migration002Commerce,
  migration003Industry,
];

export interface MigrationRecord {
  id: string;
  applied_at: number;
}

export function appliedMigrations(db: Db): MigrationRecord[] {
  const exists = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'`,
    )
    .get();
  if (!exists) return [];
  return db
    .prepare(`SELECT id, applied_at FROM _migrations ORDER BY id`)
    .all() as MigrationRecord[];
}

export function pendingMigrations(db: Db): Migration[] {
  const applied = new Set(appliedMigrations(db).map((m) => m.id));
  return MIGRATIONS.filter((m) => !applied.has(m.id));
}

export function ensureMigrations(db: Db): { applied: string[] } {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied: string[] = [];
  for (const migration of pendingMigrations(db)) {
    const run = db.transaction(() => {
      migration.up(db);
      db.prepare(`INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`).run(
        migration.id,
        Date.now(),
      );
    });
    run.immediate();
    applied.push(migration.id);
  }
  return { applied };
}
