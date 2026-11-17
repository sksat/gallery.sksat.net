// Runs the D1 migrations against an in-memory SQLite (node:sqlite) with rows
// in the pre-0002 shape, to pin the camera backfill. E2E only ever applies
// the migrations to an empty database.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { CAMERA_SLUG_RE } from "./validate";

const migration = (name: string) =>
  readFileSync(resolve(__dirname, "../../migrations", name), "utf8");

const migrate = (
  rows: [
    file: string,
    world: string,
    make: string | null,
    model: string | null,
  ][],
) => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(migration("0001_init_media.sql"));
  const insert = db.prepare(
    "INSERT INTO media (file, world, camera_make, camera_model, tags, updated_at) VALUES (?, ?, ?, ?, '[\"t\"]', '2024-01-01T00:00:00.000Z')",
  );
  for (const r of rows) insert.run(...r);
  db.exec(migration("0002_camera.sql"));
  return db;
};

const UPDATED = "2024-01-01T00:00:00.000Z";

describe("0002_camera.sql", () => {
  it("creates one camera per make/model pair and links the photos", () => {
    const db = migrate([
      ["/v1.png", "VRChat", "logilabo", "VirtualLens2"],
      ["/v2.png", "VRChat", "logilabo", "VirtualLens2"],
      ["/r1.jpg", "Real", null, null],
      ["/r2.jpg", "Real", "Canon", "EOS 5D Mark II"],
    ]);
    expect(
      db
        .prepare(
          "SELECT slug, name, manufacturer, manufacturer_url, model, kind FROM camera ORDER BY slug",
        )
        .all(),
    ).toEqual([
      {
        slug: "eos-5d-mark-ii",
        name: "EOS 5D Mark II",
        manufacturer: "Canon",
        manufacturer_url: null,
        model: "EOS 5D Mark II",
        kind: null,
      },
      {
        slug: "virtuallens2",
        name: "VirtualLens2",
        manufacturer: "logilabo",
        manufacturer_url: null,
        model: "VirtualLens2",
        kind: "virtual",
      },
    ]);
    expect(
      db
        .prepare(
          "SELECT m.id, m.file, c.slug, m.tags, m.updated_at FROM media m LEFT JOIN camera c ON c.id = m.camera_id ORDER BY m.id",
        )
        .all(),
    ).toEqual([
      { id: 1, file: "/v1.png", slug: "virtuallens2", tags: '["t"]', updated_at: UPDATED },
      { id: 2, file: "/v2.png", slug: "virtuallens2", tags: '["t"]', updated_at: UPDATED },
      { id: 3, file: "/r1.jpg", slug: null, tags: '["t"]', updated_at: UPDATED },
      { id: 4, file: "/r2.jpg", slug: "eos-5d-mark-ii", tags: '["t"]', updated_at: UPDATED },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("drops the old camera columns", () => {
    const db = migrate([]);
    const cols = db
      .prepare("SELECT name FROM pragma_table_info('media')")
      .all()
      .map((r) => r.name);
    expect(cols).toContain("camera_id");
    expect(cols).not.toContain("camera_make");
    expect(cols).not.toContain("camera_model");
  });

  it("generates slugs the admin accepts, deduplicating shared ones", () => {
    const db = migrate([
      ["/a", "Real", "A", "Foo / Bar"],
      ["/b", "Real", "B", "foo-bar"],
      ["/c", "Real", "C", "カメラ"],
      ["/d", "Real", "D", " .X_Y. "],
    ]);
    const slugs = db
      .prepare("SELECT slug FROM camera ORDER BY manufacturer")
      .all()
      .map((r) => r.slug);
    expect(slugs).toEqual(["foo-bar", "foo-bar-2", "camera", "x-y"]);
    for (const s of slugs) expect(s).toMatch(CAMERA_SLUG_RE);
  });

  it("keeps one row per camera image file and drops them with the camera", () => {
    const db = migrate([]);
    db.exec(
      "INSERT INTO camera (id, slug, name) VALUES (1, 'a', 'A'), (2, 'b', 'B')",
    );
    db.exec(
      "INSERT INTO camera_image (camera_id, file) VALUES (1, '/c/a.png'), (2, '/c/a.png')",
    );
    expect(() =>
      db.exec(
        "INSERT INTO camera_image (camera_id, file) VALUES (1, '/c/a.png')",
      ),
    ).toThrow(/UNIQUE/);
    db.exec("DELETE FROM camera WHERE id = 1");
    expect(db.prepare("SELECT camera_id FROM camera_image").all()).toEqual([
      { camera_id: 2 },
    ]);
  });

  it("rejects deleting a camera that still has photos", () => {
    const db = migrate([["/v1.png", "VRChat", "logilabo", "VirtualLens2"]]);
    expect(() => db.exec("DELETE FROM camera")).toThrow(/FOREIGN KEY/);
  });
});
