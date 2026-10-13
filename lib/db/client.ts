import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { ensureMigrations } from "./migrate";

export type Db = Database.Database;

let singleton: Db | null = null;

/** Absolute path of the operational SQLite database file. */
export function dbFilePath(): string {
  const envPath = process.env.VANTYX_DB_PATH;
  if (envPath && envPath !== ":memory:") {
    return path.isAbsolute(envPath)
      ? envPath
      : path.join(process.cwd(), envPath);
  }
  return path.join(process.cwd(), "data", "vantyx.db");
}

function openDatabase(file: string): Db {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  return db;
}

/**
 * Returns the shared database connection, applying pending versioned
 * migrations on first use inside the process.
 */
export function getDb(): Db {
  if (!singleton) {
    const file = process.env.VANTYX_DB_PATH || dbFilePath();
    singleton = openDatabase(file);
    ensureMigrations(singleton);
  }
  return singleton;
}

/**
 * Creates an isolated database (used by tests and tooling).
 * Migrations are applied immediately.
 */
export function createDb(file: string = ":memory:"): Db {
  const db = openDatabase(file);
  ensureMigrations(db);
  return db;
}

/** Runs `fn` inside an IMMEDIATE transaction (write lock up-front). */
export function tx<T>(db: Db, fn: () => T): T {
  const wrapped = db.transaction(fn);
  return wrapped.immediate();
}
