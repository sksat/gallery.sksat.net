// Rows read (D1's billing unit) by the admin's hot queries on a local D1
// (Miniflare: the same SQLite and rows_read accounting as wrangler dev)
// with synthetic photos: the schema before migration 0007 with the queries
// before it, and every migration with the queries now. Nothing is
// persisted.
// Run with: pnpm tsx scripts/bench-queries.ts [photos]
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";
import { CREATE_FOLDER_SQL, filesQuery } from "../src/lib/db-files";
import { initLookups, numberedPaths } from "../src/lib/db-upload";
import {
  neighborsStatements,
  type ListQuery,
  type NeighborAnchor,
} from "../src/lib/neighbors";
import { STORAGE_SQL } from "../src/lib/storage";
import { LIVE_PHOTO } from "../src/lib/types";

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const N = Number(process.argv[2] ?? "1000");

type Q = { sql: string; args?: unknown[] };

/** A fresh local D1 with the migrations before `upTo` and N photos. */
const setup = async (upTo: string) => {
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: resolve(adminRoot, "wrangler.jsonc"),
    persist: false,
    remoteBindings: false,
  });
  const db = proxy.env.DB;
  const migrations = readdirSync(resolve(adminRoot, "migrations"))
    .filter((f) => f.endsWith(".sql") && f < upTo)
    .sort();
  for (const f of migrations) {
    const sql = readFileSync(resolve(adminRoot, "migrations", f), "utf8");
    await db.batch(unstable_splitSqlQuery(sql).map((s) => db.prepare(s)));
  }
  // N photos in 10 folders, a few undated / uploading / trashed.
  const rows = Array.from({ length: N }, (_, i) => [
    `/VRChat/2026-${String((i % 10) + 1).padStart(2, "0")}/p${String(i).padStart(5, "0")}.png`,
    i % 3 === 0 ? "Real" : "VRChat",
    i % 50 === 7
      ? null
      : new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString(),
    ["private", "unlisted", "public"][i % 3],
    i % 97 === 5 ? "uploading" : "ready",
    i % 89 === 3 ? "2026-11-01T00:00:00Z" : null,
    JSON.stringify([`t${i % 20}`, `u${i % 7}`]),
    1_000_000 + i,
    1 + (i % 10),
  ]);
  await db.batch(
    Array.from({ length: 10 }, (_, i) =>
      db
        .prepare("INSERT INTO camera (slug, name) VALUES (?, ?)")
        .bind(`c${i}`, `Camera ${i}`),
    ),
  );
  for (let i = 0; i < rows.length; i += 50) {
    await db.batch(
      rows
        .slice(i, i + 50)
        .map((r) =>
          db
            .prepare(
              "INSERT INTO media (file, platform, timestamp, visibility, status, trashed_at, tags, size, camera_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(...r),
        ),
    );
  }
  const rowsRead = async (qs: Q[]): Promise<number> => {
    const res = await db.batch(
      qs.map((q) => db.prepare(q.sql).bind(...(q.args ?? []))),
    );
    return res.reduce((n, r) => n + (r.meta.rows_read ?? 0), 0);
  };
  return { db, rowsRead, dispose: proxy.dispose };
};

const list = (over: Partial<ListQuery> = {}): ListQuery => ({
  view: "list",
  dir: "/",
  platform: null,
  visibility: null,
  q: "",
  page: 1,
  ...over,
});

// The neighbours query before this change (one window over the list).
const windowQuery = (l: ListQuery, id: number): Q => {
  const where = [LIVE_PHOTO];
  const args: unknown[] = [];
  if (l.visibility) {
    where.push("visibility = ?");
    args.push(l.visibility);
  }
  if (l.view === "files") {
    const prefix = `${l.dir}/`;
    where.push(
      "substr(path, 1, length(?)) = ?",
      "instr(substr(path, length(?) + 1), '/') = 0",
    );
    args.push(prefix, prefix, prefix);
  }
  const order =
    l.view === "files" ? "path" : "timestamp IS NULL, timestamp DESC, id DESC";
  return {
    sql:
      `SELECT prev_id, next_id, prev_file, next_file, pos, total FROM (SELECT id,` +
      ` LAG(id) OVER w AS prev_id, LEAD(id) OVER w AS next_id,` +
      ` LAG(file) OVER w AS prev_file, LEAD(file) OVER w AS next_file,` +
      ` ROW_NUMBER() OVER w AS pos, COUNT(*) OVER () AS total` +
      ` FROM media WHERE (${where.join(" AND ")}) OR id = ?` +
      ` WINDOW w AS (ORDER BY ${order})) WHERE id = ?`,
    args: [...args, id, id],
  };
};
const keyset = (l: ListQuery, anchor: NeighborAnchor): Q[] => {
  const s = neighborsStatements(l, anchor);
  return [s.prev, s.next, s.counts];
};

const CAMERAS_WITH_COUNTS = `SELECT c.*, (SELECT COUNT(*) FROM media m WHERE m.camera_id = c.id AND m.status = 'ready' AND m.trashed_at IS NULL) AS photo_count FROM camera c ORDER BY c.name COLLATE NOCASE, c.id`;
const CAMERA_OPTIONS =
  "SELECT id, name, slug FROM camera ORDER BY name COLLATE NOCASE, id";

type Case = (anchor: NeighborAnchor) => { before: Q[]; after: Q[] };
const neighbours =
  (l: (a: NeighborAnchor) => ListQuery): Case =>
  (a) => ({ before: [windowQuery(l(a), a.id)], after: keyset(l(a), a) });
const same =
  (qs: Q[], now: Q[] = qs): Case =>
  () => ({ before: qs, after: now });
const dirOf = (a: NeighborAnchor) => a.path.slice(0, a.path.lastIndexOf("/"));

const cases: [string, Case][] = [
  ["prev/next: list view", neighbours(() => list())],
  [
    "prev/next: list view, private only",
    neighbours(() => list({ visibility: "private" })),
  ],
  [
    "prev/next: files view (a folder)",
    neighbours((a) => list({ view: "files", dir: dirOf(a) })),
  ],
  [
    "edit page camera select",
    same([{ sql: CAMERAS_WITH_COUNTS }], [{ sql: CAMERA_OPTIONS }]),
  ],
  [
    "media list page (rows + count)",
    same([
      {
        sql: `SELECT * FROM media WHERE ${LIVE_PHOTO} ORDER BY timestamp IS NULL, timestamp DESC, id DESC LIMIT 100 OFFSET 0`,
      },
      { sql: `SELECT COUNT(*) AS c FROM media WHERE ${LIVE_PHOTO}` },
    ]),
  ],
  ["files view rows", same([filesQuery({ limit: 10_000 })])],
  [
    "incomplete uploads",
    same(
      [
        {
          sql: "SELECT path FROM media WHERE status <> 'ready' AND trashed_at IS NULL",
        },
      ],
      [
        {
          sql: "SELECT path FROM media WHERE status = 'uploading' AND trashed_at IS NULL",
        },
      ],
    ),
  ],
  ["camera list (/camera)", same([{ sql: CAMERAS_WITH_COUNTS }])],
  ["dashboard storage", same([{ sql: STORAGE_SQL }])],
];

// The upload init's duplicate and name check before it was split into
// ranges (initLookups): one OR over sha256, file and path, the 51 numbered
// names as json_each lists.
const oldInitLookup = (sha256: string, file: string): Q => ({
  sql: `SELECT id, file, path, status, sha256, trashed_at FROM media
    WHERE sha256 = ?1 OR file IN (SELECT value FROM json_each(?2))
       OR (trashed_at IS NULL AND path IN (SELECT value FROM json_each(?2)))`,
  args: [sha256, JSON.stringify(numberedPaths(file))],
});
const initCase =
  (sha256: string, file: (a: NeighborAnchor) => string): Case =>
  (a) => ({
    before: [oldInitLookup(sha256, file(a))],
    after: initLookups(sha256, file(a)),
  });
const NEW_SHA = "f".repeat(64);
// createFolder before its "below the folder" checks were path ranges.
const OLD_CREATE_FOLDER_SQL = `INSERT INTO folder (path) SELECT ?1
  WHERE NOT EXISTS (
    SELECT 1 FROM media WHERE trashed_at IS NULL
      AND substr(path, 1, length(?1) + 1) = ?1 || '/'
  ) AND NOT EXISTS (
    SELECT 1 FROM folder WHERE substr(path, 1, length(?1) + 1) = ?1 || '/'
  )
  ON CONFLICT (path) DO NOTHING`;
const createFolderCase =
  (folder: string): Case =>
  () => ({
    before: [{ sql: OLD_CREATE_FOLDER_SQL, args: [folder] }],
    after: [{ sql: CREATE_FOLDER_SQL, args: [folder] }],
  });

// Changes since 0007, both columns on every migration.
const nowCases: [string, Case][] = [
  [
    "upload init: new name in a folder",
    initCase(NEW_SHA, (a) => `${dirOf(a)}/new.png`),
  ],
  ["upload init: name taken (numbered)", initCase(NEW_SHA, (a) => a.path)],
  ["create folder (empty name check)", createFolderCase("/VRChat/new")],
];

const run = async (
  upTo: string,
  which: "before" | "after",
  list: [string, Case][],
) => {
  const { db, rowsRead, dispose } = await setup(upTo);
  const anchor = (await db
    .prepare("SELECT id, path, timestamp FROM media WHERE id = ?")
    .bind(Math.floor(N / 2))
    .first()) as NeighborAnchor;
  const out: number[] = [];
  for (const [, c] of list) out.push(await rowsRead(c(anchor)[which]));
  await dispose();
  return out;
};

const table = (list: [string, Case][], before: number[], after: number[]) => {
  console.log("| query | before | after |");
  console.log("| --- | ---: | ---: |");
  list.forEach(([name], i) => {
    console.log(`| ${name} | ${before[i]} | ${after[i]} |`);
  });
};

console.log(`${N} photos: rows read per call (local D1)\n`);
console.log("Migration 0007 (before: the schema and queries before it):\n");
table(
  cases,
  await run("0007", "before", cases),
  await run("9999", "after", cases),
);
console.log("\nSince 0007 (both on every migration):\n");
table(
  nowCases,
  await run("9999", "before", nowCases),
  await run("9999", "after", nowCases),
);
