/**
 * VANTYX — database migration runner.
 *
 * Uso:
 *   npm run db:migrate                                    (SQLite local)
 *   VANTYX_DB_PATH=/var/lib/vantyx/vantyx.db npm run db:migrate
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:migrate
 *
 * Migrations are versioned, ordered and applied exactly once, each inside its
 * own write transaction (see lib/db/migrate.ts). Applied migrations are
 * never modified — schema evolution is additive only.
 */

import process from "node:process";
import { createDb, dbFilePath, getDb } from "../lib/db/client";
import { appliedMigrations, ensureMigrations, MIGRATIONS } from "../lib/db/migrate";

async function main(): Promise<void> {
  const remote = process.env.TURSO_DATABASE_URL;
  const target = remote ?? dbFilePath();
  // remoto: getDb() resolve TURSO_*; local: createDb com o caminho explícito
  const db = remote ? getDb() : createDb(process.env.VANTYX_DB_PATH || dbFilePath());

  const before = new Set((await appliedMigrations(db)).map((m) => m.id));
  const { applied } = await ensureMigrations(db);
  const after = await appliedMigrations(db);

  console.log(`VANTYX migrate — base de dados: ${target}`);
  if (applied.length === 0) {
    console.log("Nenhuma migração pendente.");
  } else {
    for (const id of applied) console.log(`  aplicada: ${id}`);
  }
  console.log(
    `Estado final: ${after.length}/${MIGRATIONS.length} migrações aplicadas` +
      (before.size ? ` (${before.size} já estavam aplicadas)` : " (base nova)"),
  );
}

main().catch((err) => {
  console.error("Falha na migração:", err instanceof Error ? err.message : err);
  process.exit(1);
});
