// Test helper (imported by *.spec.ts only): an in-memory SQLite
// (node:sqlite) with every D1 migration applied, behind the subset of the
// D1 API that src/lib uses, so queries are checked on the real schema.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const migrationsDir = resolve(__dirname, "../../migrations");

export const migratedSqlite = (): DatabaseSync => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(resolve(migrationsDir, f), "utf8"));
  }
  return db;
};

export const sqliteD1 = (db: DatabaseSync): D1Database => {
  const returnsRows = (sql: string) =>
    /^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
  const statement = (sql: string, args: SQLInputValue[] = []) => {
    const run = async () => {
      const r = db.prepare(sql).run(...args);
      return { results: [], meta: { changes: Number(r.changes) } };
    };
    const all = async () => ({
      results: db.prepare(sql).all(...args),
      meta: { changes: 0 },
    });
    return {
      bind: (...next: SQLInputValue[]) => statement(sql, next),
      all,
      run,
      first: async () => db.prepare(sql).get(...args) ?? null,
      /** What batch() runs: rows for queries, changes for writes. */
      exec: () => (returnsRows(sql) ? all() : run()),
    };
  };
  return {
    prepare: (sql: string) => statement(sql),
    // Sequential, like D1's (but not wrapped in a transaction).
    batch: async (stmts: { exec: () => Promise<unknown> }[]) => {
      const out = [];
      for (const s of stmts) out.push(await s.exec());
      return out;
    },
  } as unknown as D1Database;
};
