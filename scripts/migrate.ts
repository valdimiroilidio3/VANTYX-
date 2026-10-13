/**
 * VANTYX — database migration runner.
 *
 * Usage:
 *   npm run db:migrate
 *   VANTYX_DB_PATH=/var/lib/vantyx/vantyx.db npm run db:migrate
 *
 * Migrations are versioned, ordered and applied exactly once, each inside its
 * own IMMEDIATE transaction (see lib/db/migrate.ts). Applied migrations are
 * never modified — schema evolution is additive only.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import { appliedMigrations, ensureMigrations, MIGRATIONS } from "../lib/db/migrate";

function dbFilePath(): string {
  const envPath = process.env.VANTYX_DB_PATH;
  if (envPath && envPath !== ":memory:") {
    return path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
  }
  return path.join(process.cwd(), "data", "vantyx.db");
}

function main(): void {
  const file = dbFilePath();
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const before = new Set(appliedMigrations(db).map((m) => m.id));
  const { applied } = ensureMigrations(db);
  const after = appliedMigrations(db);

  console.log(`VANTYX migrate — base de dados: ${file}`);
  if (applied.length === 0) {
    console.log("Nenhuma migração pendente.");
  } else {
    for (const id of applied) console.log(`  aplicada: ${id}`);
  }
  console.log(
    `Estado final: ${after.length}/${MIGRATIONS.length} migrações aplicadas` +
      (before.size ? ` (${before.size} já estavam aplicadas)` : " (base nova)"),
  );
  db.close();
}

try {
  main();
} catch (err) {
  console.error("Falha na migração:", err instanceof Error ? err.message : err);
  process.exit(1);
}
