import { txRaw, type Db } from "./client";
import { migration001Core } from "./migrations/001_core";
import { migration002Commerce } from "./migrations/002_commerce";
import { migration003Industry } from "./migrations/003_industry";
import { migration004FiscalAt } from "./migrations/004_fiscal_at";

export interface Migration {
  /** Ordered, immutable identifier. Never rename or reuse. */
  id: string;
  name: string;
  up(db: Db): void | Promise<void>;
}

/**
 * Versioned migrations. Each entry is applied exactly once, in order,
 * inside its own write transaction. Applied migrations are never modified;
 * schema changes are always additive via new migration files.
 */
export const MIGRATIONS: Migration[] = [
  migration001Core,
  migration002Commerce,
  migration003Industry,
  migration004FiscalAt,
];

export interface MigrationRecord {
  id: string;
  applied_at: number;
}

export async function appliedMigrations(db: Db): Promise<MigrationRecord[]> {
  const exists = await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'`,
    )
    .get();
  if (!exists) return [];
  return (await db
    .prepare(`SELECT id, applied_at FROM _migrations ORDER BY id`)
    .all()) as MigrationRecord[];
}

export async function pendingMigrations(db: Db): Promise<Migration[]> {
  const applied = new Set((await appliedMigrations(db)).map((m) => m.id));
  return MIGRATIONS.filter((m) => !applied.has(m.id));
}

export async function ensureMigrations(db: Db): Promise<{ applied: string[] }> {
  await db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied: string[] = [];
  for (const migration of await pendingMigrations(db)) {
    await txRaw(db, async () => {
      await migration.up(db);
      await db
        .prepare(`INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`)
        .run(migration.id, Date.now());
    });
    applied.push(migration.id);
  }
  return { applied };
}
