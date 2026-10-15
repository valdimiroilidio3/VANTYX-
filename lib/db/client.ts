import {
  createClient,
  type Client,
  type InStatement,
  type InValue,
  type ResultSet,
  type Transaction,
} from "@libsql/client";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "fs";
import path from "path";
// Ciclo client <-> migrate: seguro porque ensureMigrations só é chamada em
// runtime (nunca durante a avaliação dos módulos).
import { ensureMigrations } from "./migrate";

/**
 * Camada de base de dados — libSQL (Turso).
 *
 * - Produção (Vercel/serverless): `TURSO_DATABASE_URL` (+ `TURSO_AUTH_TOKEN`)
 *   → base remota libsql://, sem dependência de sistema de ficheiros.
 * - Desenvolvimento/local: ficheiro SQLite em `VANTYX_DB_PATH`
 *   (default `data/vantyx.db`) ou `:memory:` (testes).
 *
 * A API preserva a forma `db.prepare(sql).get/all/run(...)` do driver
 * anterior (better-sqlite3), mas **assíncrona**: todos os métodos devolvem
 * Promises. `tx(db, fn)` abre uma transação de escrita interativa; as
 * statements preparadas dentro de `fn` participam na transação via
 * AsyncLocalStorage (o padrão de closures dos serviços mantém-se).
 * `tx` reentrante participa na transação ativa (sem nesting).
 */

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

function normalizeArgs(args: unknown[]): InValue[] {
  return args.map((a) => {
    if (a === undefined || a === null) return null;
    if (typeof a === "boolean") return a ? 1 : 0;
    if (typeof a === "number" || typeof a === "string" || typeof a === "bigint") return a;
    if (Buffer.isBuffer(a)) return new Uint8Array(a);
    if (a instanceof Uint8Array) return a;
    return String(a);
  });
}

const txAls = new AsyncLocalStorage<Transaction>();

export class Statement {
  constructor(
    private owner: Db,
    private sql: string,
  ) {}

  async run(...args: unknown[]): Promise<RunResult> {
    const rs = await this.owner._execute({ sql: this.sql, args: normalizeArgs(args) });
    const rid = rs.lastInsertRowid;
    return {
      changes: Number(rs.rowsAffected),
      lastInsertRowid: typeof rid === "bigint" ? Number(rid) : Number(rid ?? 0),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async get<T = any>(...args: unknown[]): Promise<T | undefined> {
    const rs = await this.owner._execute({ sql: this.sql, args: normalizeArgs(args) });
    const row = rs.rows[0];
    return row === undefined ? undefined : ({ ...row } as T);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async all<T = any>(...args: unknown[]): Promise<T[]> {
    const rs = await this.owner._execute({ sql: this.sql, args: normalizeArgs(args) });
    return rs.rows.map((r) => ({ ...r }) as T);
  }
}

export class Db {
  readonly client: Client;
  /** Resolvido quando as migrações estiverem aplicadas (1.ª utilização). */
  private readyPromise: Promise<void> | null = null;
  /** true enquanto as migrações correm — evita recursão ready→exec→ready. */
  private migrating = false;

  constructor(client: Client) {
    this.client = client;
  }

  prepare(sql: string): Statement {
    return new Statement(this, sql);
  }

  /** Multi-statement (migrações). Participa na transação ativa, se existir. */
  async exec(sql: string): Promise<void> {
    const t = txAls.getStore();
    if (t) {
      await t.executeMultiple(sql);
      return;
    }
    if (!this.migrating) await this.ready();
    await this.client.executeMultiple(sql);
  }

  /** @internal — usado por Statement/exec com gating de migrações. */
  async _execute(stmt: InStatement): Promise<ResultSet> {
    const t = txAls.getStore();
    if (t) return t.execute(stmt);
    if (!this.migrating) await this.ready();
    return this.client.execute(stmt);
  }

  /** @internal — aplica migrações uma única vez (memoizado). */
  ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        this.migrating = true;
        try {
          await ensureMigrations(this);
        } finally {
          this.migrating = false;
        }
      })();
    }
    return this.readyPromise;
  }
}

/**
 * Transação de escrita SEM gating de migrações (uso exclusivo do migrate).
 * API two-step do libsql 0.18: transaction(mode) → commit/rollback/close.
 */
export async function txRaw<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  if (txAls.getStore()) return fn(); // reentrante: participa na transação ativa
  const t = await db.client.transaction("write");
  try {
    const result = await txAls.run(t, () => fn());
    await t.commit();
    return result;
  } catch (err) {
    try {
      await t.rollback();
    } catch {
      /* rollback best-effort — o erro original é o que importa */
    }
    throw err;
  } finally {
    t.close();
  }
}

/**
 * Corre `fn` numa transação de escrita (lock adquirido no início, como o
 * BEGIN IMMEDIATE anterior). Garante migrações aplicadas antes de começar.
 * Se já estiver dentro de uma transação, participa nela (reentrante).
 */
export async function tx<T>(db: Db, fn: () => T | Promise<T>): Promise<T> {
  await db.ready();
  return txRaw(db, async () => fn());
}

/** Absolute path of the operational SQLite database file (modo local). */
export function dbFilePath(): string {
  const envPath = process.env.VANTYX_DB_PATH;
  if (envPath && envPath !== ":memory:") {
    return path.isAbsolute(envPath)
      ? envPath
      : path.join(process.cwd(), envPath);
  }
  return path.join(process.cwd(), "data", "vantyx.db");
}

function resolveTarget(file?: string): { url: string; authToken?: string } {
  const remote = process.env.TURSO_DATABASE_URL;
  if (remote && file === undefined) {
    return { url: remote, authToken: process.env.TURSO_AUTH_TOKEN || undefined };
  }
  const p = file ?? process.env.VANTYX_DB_PATH ?? "";
  if (p === ":memory:") return { url: ":memory:" };
  const abs = p
    ? path.isAbsolute(p)
      ? p
      : path.join(process.cwd(), p)
    : dbFilePath();
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return { url: `file:${abs}` };
}

function openClient(target: { url: string; authToken?: string }): Db {
  const client = createClient({
    url: target.url,
    authToken: target.authToken,
    intMode: "number",
  });
  const db = new Db(client);
  if (target.url.startsWith("file:")) {
    // FK enforcement é por-conexão no SQLite local; remoto é gerido pelo Turso.
    client.execute("PRAGMA foreign_keys = ON").catch(() => undefined);
  }
  return db;
}

let singleton: Db | null = null;

/**
 * Devolve a conexão partilhada. As migrações são aplicadas de forma
 * transparente na primeira operação (memoizado por conexão).
 */
export function getDb(): Db {
  if (!singleton) {
    singleton = openClient(resolveTarget());
  }
  return singleton;
}

/** Cria uma base isolada (testes/tooling), com migrações no primeiro uso. */
export function createDb(file: string = ":memory:"): Db {
  return openClient(resolveTarget(file));
}
