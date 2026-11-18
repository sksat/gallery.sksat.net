// Test helper: an in-memory SQLite (node:sqlite) with the admin's real
// migrations applied, behind a minimal D1 stand-in.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const migrationsDir = resolve(__dirname, "../../../admin/migrations");

/** The D1 subset query.ts uses, backed by node:sqlite. */
export const d1 = (db: DatabaseSync): D1Database => {
  const statement = (sql: string, args: SQLInputValue[] = []) => ({
    bind: (...next: SQLInputValue[]) => statement(sql, next),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: { all: () => Promise<unknown> }[]) =>
      Promise.all(stmts.map((s) => s.all())),
  } as unknown as D1Database;
};

/** An empty database with every admin migration applied. */
export const migratedDb = (): DatabaseSync => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(resolve(migrationsDir, f), "utf8"));
  }
  return db;
};
