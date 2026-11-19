import { describe, expect, it } from "vitest";
import {
  addPlatform,
  deletePlatform,
  listPlatforms,
  listPlatformsWithCounts,
  movePlatform,
  platformExists,
  restorePlatform,
  updatePlatform,
} from "./db-platform";
import { setPlatforms } from "./db-photo-bulk";
import { setUploadRules } from "./db-upload-rules";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO media (id, file, platform) VALUES
      (1, '/a.png', 'Real'),
      (2, '/b.png', 'VRChat'),
      (3, '/c.png', 'VRChat');
    UPDATE media SET trashed_at = '2026-01-01T00:00:00Z' WHERE id = 3;
  `);
  return { raw, db: sqliteD1(raw) };
};

const version = (raw: ReturnType<typeof setup>["raw"]) =>
  (
    raw
      .prepare("SELECT value FROM setting WHERE key = 'content_version'")
      .get() as { value: string } | undefined
  )?.value;

describe("platforms", () => {
  it("starts with Real and VRChat", async () => {
    const { db } = setup();
    expect(await listPlatforms(db)).toEqual([
      { key: "Real", name: "Real", kind: "real" },
      { key: "VRChat", name: "VRChat", kind: "virtual" },
    ]);
  });

  it("counts listed photos, and every row for delete", async () => {
    const { db } = setup();
    const rows = await listPlatformsWithCounts(db);
    expect(rows.map(({ key, count, used }) => ({ key, count, used }))).toEqual(
      [
        { key: "Real", count: 1, used: 1 },
        { key: "VRChat", count: 1, used: 2 },
      ],
    );
  });

  it("adds one at the end with a key from its name; names are unique", async () => {
    const { db } = setup();
    const r = await addPlatform(db, "Neos VR", "virtual");
    expect(r).toEqual({
      ok: true,
      value: { key: "Neos-VR", name: "Neos VR", kind: "virtual", position: 2 },
    });
    expect(await platformExists(db, "Neos-VR")).toBe(true);
    expect(await addPlatform(db, "neos vr", "real")).toEqual({
      ok: false,
      error: "その名前のプラットフォームはもうあります",
    });
    // A photo can use it now.
    await setPlatforms(db, [1], "Neos-VR");
    expect((await listPlatformsWithCounts(db))[2].count).toBe(1);
  });

  it("renames and changes kind in one batch with the content version", async () => {
    const { db, raw } = setup();
    const before = version(raw);
    const r = await updatePlatform(db, "VRChat", {
      name: "VRChat (PC)",
      kind: "real",
    });
    expect(r).toEqual({
      ok: true,
      value: { key: "VRChat", name: "VRChat", kind: "virtual" },
    });
    expect(version(raw)).not.toBe(before);
    expect((await listPlatforms(db))[1]).toEqual({
      key: "VRChat",
      name: "VRChat (PC)",
      kind: "real",
    });
    // Photos keep the key.
    expect(
      raw.prepare("SELECT platform FROM media WHERE id = 2").get(),
    ).toEqual({ platform: "VRChat" });
    expect(
      await updatePlatform(db, "Real", { name: "vrchat (pc)", kind: "real" }),
    ).toEqual({ ok: false, error: "その名前のプラットフォームはもうあります" });
    expect(
      (await updatePlatform(db, "Nope", { name: "x", kind: "real" })).ok,
    ).toBe(false);
  });

  it("moves one up or down, and not past the ends", async () => {
    const { db } = setup();
    await addPlatform(db, "Resonite", "virtual");
    expect(await movePlatform(db, "Resonite", -1)).toBe(true);
    expect((await listPlatforms(db)).map((p) => p.key)).toEqual([
      "Real",
      "Resonite",
      "VRChat",
    ]);
    expect(await movePlatform(db, "Real", -1)).toBe(false);
    expect(await movePlatform(db, "VRChat", 1)).toBe(false);
    expect(await movePlatform(db, "Resonite", 1)).toBe(true);
    expect((await listPlatforms(db)).map((p) => p.key)).toEqual([
      "Real",
      "VRChat",
      "Resonite",
    ]);
  });

  it("deletes only an unused one that is not built in, and puts it back", async () => {
    const { db, raw } = setup();
    expect(await deletePlatform(db, "VRChat")).toEqual({
      ok: false,
      error: "このプラットフォームは削除できません",
    });
    const added = await addPlatform(db, "Neos VR", "virtual");
    // A photo in the trash still uses it.
    raw.exec("UPDATE media SET platform = 'Neos-VR' WHERE id = 3");
    expect(await deletePlatform(db, "Neos-VR")).toEqual({
      ok: false,
      error: "写真があるプラットフォームは削除できません",
    });
    raw.exec("UPDATE media SET platform = 'VRChat' WHERE id = 3");
    const r = await deletePlatform(db, "Neos-VR");
    expect(r.ok && added.ok && r.value).toEqual(added.ok && added.value);
    expect(await platformExists(db, "Neos-VR")).toBe(false);
    if (!r.ok) throw new Error("not deleted");
    expect((await restorePlatform(db, r.value)).ok).toBe(true);
    expect((await listPlatforms(db)).map((p) => p.key)).toEqual([
      "Real",
      "VRChat",
      "Neos-VR",
    ]);
  });

  it("keeps one an upload rule sets", async () => {
    const { db } = setup();
    await addPlatform(db, "Resonite", "virtual");
    await setUploadRules(db, [
      {
        id: "r",
        name: "Resonite",
        enabled: true,
        conditions: { folder: "/Resonite" },
        actions: { platform: "Resonite" },
      },
    ]);
    expect(await deletePlatform(db, "Resonite")).toEqual({
      ok: false,
      error: "アップロードのルールが使っているプラットフォームは削除できません",
    });
    await setUploadRules(db, []);
    expect((await deletePlatform(db, "Resonite")).ok).toBe(true);
  });

  it("refuses a photo on a platform that does not exist", () => {
    const { raw } = setup();
    expect(() =>
      raw.exec("UPDATE media SET platform = 'Mars' WHERE id = 1"),
    ).toThrow(/FOREIGN KEY/);
    expect(() => raw.exec("DELETE FROM platform WHERE key = 'Real'")).toThrow(
      /FOREIGN KEY/,
    );
  });
});
