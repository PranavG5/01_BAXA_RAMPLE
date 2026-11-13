import "server-only";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { normalizeDatabaseUrl } from "../core/db-url";
import { databaseUrl, dataDir } from "./paths";

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Database: a hosted Postgres when DATABASE_URL (or POSTGRES_URL) is set,
 * otherwise an embedded Postgres (PGlite) stored in DATA_DIR/db. Serverless
 * hosts such as Vercel need the hosted one: each instance has its own /tmp.
 * The schema in db/migrations runs on first use. The small query builder
 * below covers exactly what the app needs (select/insert/update/upsert/delete,
 * eq/neq/in/is/not-null/lt filters, order, limit, single, count, rpc).
 */

type Row = Record<string, unknown>;
export interface DbError {
  message: string;
  code?: string;
}
export interface DbResult<T> {
  data: T;
  error: DbError | null;
  count?: number | null;
}

// Type OIDs: keep timestamps/dates as ISO strings, numbers as numbers.
const PARSERS = {
  1184: (v: string) => new Date(v).toISOString(), // timestamptz
  1114: (v: string) => new Date(v + "Z").toISOString(), // timestamp
  1082: (v: string) => v, // date
  1700: (v: string) => Number(v), // numeric
  20: (v: string) => Number(v), // int8
};

/** The few calls the app makes, shared by PGlite and node-postgres. */
interface Driver {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Runs a script that may hold several statements; rolls back an open transaction on error. */
  exec(sql: string): Promise<void>;
}

interface DbState {
  pg: Driver;
  columns: Map<string, Map<string, string>>; // table -> column -> udt_name
}

const g = globalThis as unknown as { __rampleDb?: Promise<DbState> };

// One statement at a time keeps PGlite (single connection) predictable.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function openPglite(): Promise<Driver> {
  const dir = path.join(dataDir(), "db");
  mkdirSync(dir, { recursive: true });
  const lite = await PGlite.create(dir, { parsers: PARSERS });
  return {
    query: <T>(sql: string, params?: unknown[]) => serial(() => lite.query<T>(sql, params)),
    exec: (sql) =>
      serial(async () => {
        try {
          await lite.exec(sql);
        } catch (err) {
          await lite.exec("rollback").catch(() => undefined);
          throw err;
        }
      }),
  };
}

function openPostgres(url: string): Driver {
  const types = {
    getTypeParser: ((oid: number, format?: "text" | "binary") =>
      PARSERS[oid as keyof typeof PARSERS] ?? pg.types.getTypeParser(oid, format)) as typeof pg.types.getTypeParser,
  };
  const pool = new pg.Pool({ connectionString: normalizeDatabaseUrl(url), max: 5, idleTimeoutMillis: 10_000, types });
  pool.on("error", (e) => console.error("[db] idle client error", e));
  return {
    query: <T>(sql: string, params?: unknown[]) => pool.query(sql, params) as unknown as Promise<{ rows: T[] }>,
    exec: async (sql) => {
      const client = await pool.connect();
      try {
        await client.query(sql);
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

// Held while migrating so several server instances starting at once on a
// hosted database take turns instead of colliding.
const MIGRATION_LOCK = "select pg_advisory_xact_lock(726561)";

async function migrate(pg: Driver) {
  await pg.exec(
    `begin; ${MIGRATION_LOCK}; create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now()); commit;`,
  );
  const done = new Set((await pg.query<{ name: string }>("select name from _migrations")).rows.map((r) => r.name));
  const migDir = path.join(process.cwd(), "db", "migrations");
  for (const file of readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    // Each file and its bookkeeping row commit together. If another instance
    // applied it while this one waited for the lock, this run fails, rolls
    // back, and moves on.
    const name = file.replace(/'/g, "''");
    try {
      await pg.exec(`begin;\n${MIGRATION_LOCK};\n${readFileSync(path.join(migDir, file), "utf8")}\n;insert into _migrations (name) values ('${name}');\ncommit;`);
    } catch (err) {
      const applied = (await pg.query("select 1 from _migrations where name = $1", [file])).rows.length > 0;
      if (!applied) throw err;
    }
  }
}

async function open(): Promise<DbState> {
  const url = databaseUrl();
  const pg = url ? openPostgres(url) : await openPglite();
  await migrate(pg);
  const cols = await pg.query<{ table_name: string; column_name: string; udt_name: string }>(
    "select table_name, column_name, udt_name from information_schema.columns where table_schema = current_schema()",
  );
  const columns = new Map<string, Map<string, string>>();
  for (const c of cols.rows) {
    if (!columns.has(c.table_name)) columns.set(c.table_name, new Map());
    columns.get(c.table_name)!.set(c.column_name, c.udt_name);
  }
  return { pg, columns };
}

function state(): Promise<DbState> {
  if (!g.__rampleDb) g.__rampleDb = open().catch((e) => {
    g.__rampleDb = undefined;
    throw e;
  });
  return g.__rampleDb;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Invalid identifier: ${name}`);
  return `"${name}"`;
}

function selectList(cols: string): string {
  const trimmed = cols.trim();
  if (trimmed === "*" || trimmed === "") return "*";
  return trimmed
    .split(",")
    .map((c) => ident(c.trim()))
    .join(", ");
}

type Filter = { col: string; op: "=" | "<>" | "<" | "in" | "is null" | "is not null"; value?: unknown };
type Mode = "select" | "insert" | "update" | "upsert" | "delete";

class Query<T = unknown> implements PromiseLike<DbResult<T>> {
  private mode: Mode = "select";
  private cols = "*";
  private countOnly = false;
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private rows: Row[] = [];
  private patch: Row = {};
  private conflict: string | null = null;
  private cardinality: "many" | "single" | "maybe" = "many";

  constructor(private table: string) {
    ident(table);
  }

  select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
    if (this.mode === "select") {
      this.cols = cols;
      this.countOnly = !!opts?.head;
    }
    return this;
  }
  insert(values: Row | Row[]) {
    this.mode = "insert";
    this.rows = Array.isArray(values) ? values : [values];
    return this;
  }
  upsert(values: Row | Row[], opts: { onConflict: string }) {
    this.mode = "upsert";
    this.rows = Array.isArray(values) ? values : [values];
    this.conflict = opts.onConflict;
    return this;
  }
  update(values: Row) {
    this.mode = "update";
    this.patch = values;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push({ col, op: "=", value });
    return this;
  }
  neq(col: string, value: unknown) {
    this.filters.push({ col, op: "<>", value });
    return this;
  }
  lt(col: string, value: unknown) {
    this.filters.push({ col, op: "<", value });
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push({ col, op: "in", value: values });
    return this;
  }
  is(col: string, value: null) {
    if (value !== null) throw new Error("is() only supports null");
    this.filters.push({ col, op: "is null" });
    return this;
  }
  not(col: string, op: "is", value: null) {
    if (op !== "is" || value !== null) throw new Error("not() only supports is null");
    this.filters.push({ col, op: "is not null" });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  single(): Query<any> {
    this.cardinality = "single";
    return this as Query<any>;
  }
  maybeSingle(): Query<any> {
    this.cardinality = "maybe";
    return this as Query<any>;
  }

  then<R1 = DbResult<T>, R2 = never>(
    ok?: ((v: DbResult<T>) => R1 | PromiseLike<R1>) | null,
    bad?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(ok, bad);
  }

  private async run(): Promise<DbResult<T>> {
    try {
      const st = await state();
      const types = st.columns.get(this.table);
      if (!types) throw new Error(`Unknown table ${this.table}`);
      const params: unknown[] = [];
      const bind = (col: string, value: unknown) => {
        const udt = types.get(col);
        if (!udt) throw new Error(`Unknown column ${this.table}.${col}`);
        if (value === null || value === undefined) {
          params.push(null);
          return `$${params.length}::${udt === "_text" ? "text[]" : udt === "_int4" ? "int[]" : udt}`;
        }
        if (udt === "jsonb" || udt === "json") {
          params.push(JSON.stringify(value));
          return `$${params.length}::jsonb`;
        }
        if (udt.startsWith("_")) {
          params.push(value);
          return `$${params.length}::${udt.slice(1)}[]`;
        }
        params.push(value);
        return `$${params.length}::${udt}`;
      };
      const where = () => {
        if (!this.filters.length) return "";
        const parts = this.filters.map((f) => {
          const c = ident(f.col);
          if (f.op === "is null" || f.op === "is not null") return `${c} ${f.op}`;
          if (f.op === "in") {
            const vals = f.value as unknown[];
            if (!vals.length) return "false";
            return `${c} in (${vals.map((v) => bind(f.col, v)).join(", ")})`;
          }
          return `${c} ${f.op} ${bind(f.col, f.value)}`;
        });
        return ` where ${parts.join(" and ")}`;
      };

      let sql: string;
      const t = ident(this.table);
      if (this.mode === "select") {
        const tail = `${where()}${this.orders.length ? ` order by ${this.orders.map((o) => `${ident(o.col)} ${o.asc ? "asc" : "desc"}`).join(", ")}` : ""}${this.lim !== null ? ` limit ${Math.floor(this.lim)}` : ""}`;
        if (this.countOnly) {
          const res = await st.pg.query<{ n: number }>(`select count(*)::int as n from ${t}${tail}`, params);
          return { data: null as T, error: null, count: res.rows[0]?.n ?? 0 };
        }
        sql = `select ${selectList(this.cols)} from ${t}${tail}`;
      } else if (this.mode === "insert" || this.mode === "upsert") {
        if (!this.rows.length) return { data: [] as T, error: null };
        const colNames = [...new Set(this.rows.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined)))];
        const values = this.rows
          .map((r) => `(${colNames.map((c) => (r[c] === undefined ? "default" : bind(c, r[c]))).join(", ")})`)
          .join(", ");
        sql = `insert into ${t} (${colNames.map(ident).join(", ")}) values ${values}`;
        if (this.mode === "upsert") {
          const key = ident(this.conflict!);
          const set = colNames.filter((c) => c !== this.conflict).map((c) => `${ident(c)} = excluded.${ident(c)}`);
          sql += ` on conflict (${key}) do ${set.length ? `update set ${set.join(", ")}` : "nothing"}`;
        }
        sql += " returning *";
      } else if (this.mode === "update") {
        const keys = Object.keys(this.patch).filter((k) => this.patch[k] !== undefined);
        if (!keys.length) return { data: [] as T, error: null };
        const set = keys.map((k) => `${ident(k)} = ${bind(k, this.patch[k])}`).join(", ");
        sql = `update ${t} set ${set}${where()} returning *`;
      } else {
        sql = `delete from ${t}${where()} returning *`;
      }

      const res = await st.pg.query<Row>(sql, params);
      const rows = res.rows;
      if (this.cardinality === "single") {
        if (rows.length !== 1) return { data: null as T, error: { message: rows.length ? "Multiple rows returned" : "No rows found", code: "PGRST116" } };
        return { data: rows[0] as T, error: null };
      }
      if (this.cardinality === "maybe") return { data: (rows[0] ?? null) as T, error: null };
      return { data: rows as T, error: null };
    } catch (err) {
      const e = err as { message?: string; code?: string };
      return { data: null as T, error: { message: e.message ?? String(err), code: e.code } };
    }
  }
}

class Db {
  from(table: string): Query<any> {
    return new Query<any>(table);
  }
  async rpc(fn: string, args: Record<string, unknown> = {}): Promise<DbResult<any>> {
    try {
      ident(fn);
      const st = await state();
      const keys = Object.keys(args);
      keys.forEach(ident);
      const sql = `select ${ident(fn)}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
      const res = await st.pg.query<{ r: unknown }>(sql, keys.map((k) => args[k]));
      return { data: res.rows[0]?.r as never, error: null };
    } catch (err) {
      const e = err as { message?: string; code?: string };
      return { data: null as never, error: { message: e.message ?? String(err), code: e.code } };
    }
  }
}

const instance = new Db();
export function db(): Db {
  return instance;
}

/** Throws on a database error, returns data otherwise. */
export function must<T>(res: { data: T; error: { message: string } | null }, context: string): T {
  if (res.error) throw new Error(`${context}: ${res.error.message}`);
  return res.data;
}
