// Editing a photo's shooting data (updateMedia with exif / location /
// world) on the real schema.
import { describe, expect, it } from "vitest";
import { getMedia, updateMedia } from "./db";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";
import { validatePatch } from "./validate";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`INSERT INTO media (file, platform, exif, latitude, longitude,
      location_source, world_id, world_name, photographer_id,
      photographer_name)
    VALUES ('/a.jpg', 'Real',
      '{"make":"FUJIFILM","lens":"L","orientation":6}',
      35.5, 139.5, 'exif', 'wrld_a', 'A', 'usr_x', 'X')`);
  return { raw, db: sqliteD1(raw) };
};

const patch = (body: unknown) => {
  const v = validatePatch(body);
  if (!v.ok) throw new Error(v.error);
  return v.patch;
};

describe("updateMedia: shooting data", () => {
  it("edits the camera settings, keeping what the page does not edit", async () => {
    const { db } = setup();
    const row = await updateMedia(
      db,
      1,
      patch({ exif: { make: "Sony", lens: "", iso: "200" } }),
    );
    expect(row?.exif).toEqual({ make: "Sony", iso: 200, orientation: 6 });
  });

  it("keeps an unchanged position from EXIF, marks an edited one manual", async () => {
    const { db } = setup();
    const same = await updateMedia(
      db,
      1,
      patch({ location: { latitude: "35.5", longitude: "139.5" } }),
    );
    expect(same).toMatchObject({ latitude: 35.5, location_source: "exif" });
    const moved = await updateMedia(
      db,
      1,
      patch({ location: { latitude: "35.6", longitude: "139.5" } }),
    );
    expect(moved).toMatchObject({
      latitude: 35.6,
      longitude: 139.5,
      location_source: "manual",
    });
    const cleared = await updateMedia(
      db,
      1,
      patch({ location: { latitude: "", longitude: "" } }),
    );
    // Cleared by hand is manual too: reading the file never brings it back.
    expect(cleared).toMatchObject({
      latitude: null,
      longitude: null,
      location_source: "manual",
    });
  });

  it("marks the world manual only when it changes", async () => {
    const { db } = setup();
    const same = await updateMedia(
      db,
      1,
      patch({ world_id: "wrld_a", world_name: "A" }),
    );
    expect(same?.metadata_source).toEqual({});
  });

  it("keeps the photographer when the world changes or is reset", async () => {
    const { db } = setup();
    const photographer = { id: "usr_x", name: "X" };
    expect(
      await updateMedia(db, 1, patch({ world_id: "wrld_b", world_name: "B" })),
    ).toMatchObject({ world_id: "wrld_b", photographer });
    expect(await getMedia(db, 1)).toMatchObject({ world_id: "wrld_b" });
    expect(
      await updateMedia(db, 1, patch({ reset_from_file: ["world"] })),
    ).toMatchObject({ world_id: null, photographer });
  });

  it("keeps what a partial patch leaves out", async () => {
    const { db } = setup();
    expect(await updateMedia(db, 1, patch({ world_name: "B" }))).toMatchObject({
      world_id: "wrld_a",
      world_name: "B",
      photographer: { id: "usr_x", name: "X" },
    });
    const row = await updateMedia(db, 1, patch({ exif: { model: "X-T5" } }));
    expect(row?.exif).toEqual({
      make: "FUJIFILM",
      model: "X-T5",
      lens: "L",
      orientation: 6,
    });
  });

  it("marks hand edits manual, and sets them back to the file's value", async () => {
    const { raw, db } = setup();
    raw.exec(
      `UPDATE media SET metadata_source = '{"taken_at":"exif","exif":"file","world":"file"}',
         metadata_read_at = '2100-01-01T00:00:00.000Z' WHERE id = 1`,
    );
    const edited = await updateMedia(
      db,
      1,
      patch({ exif: { make: "Sony" }, world_name: "B" }),
    );
    expect(edited?.metadata_source).toEqual({
      taken_at: "exif",
      exif: "manual",
      world: "manual",
    });
    const reset = await updateMedia(
      db,
      1,
      patch({ reset_from_file: ["exif", "world", "location"] }),
    );
    expect(reset).toMatchObject({
      exif: {},
      world_id: null,
      world_name: null,
      latitude: null,
      location_source: null,
      metadata_source: { taken_at: "exif" },
    });
    // Unread again: the reader fills them from the file.
    expect(
      raw.prepare("SELECT metadata_read_at FROM media WHERE id = 1").get(),
    ).toEqual({ metadata_read_at: null });
    expect(
      validatePatch({ exif: { make: "x" }, reset_from_file: ["exif"] }).ok,
    ).toBe(false);
    expect(validatePatch({ reset_from_file: ["timestamp"] }).ok).toBe(false);
  });

  it("refuses bad values before writing", () => {
    expect(
      validatePatch({ location: { latitude: "95", longitude: "0" } }).ok,
    ).toBe(false);
    expect(validatePatch({ world_id: "usr_x" }).ok).toBe(false);
    expect(validatePatch({ exif: { orientation: 1 } }).ok).toBe(false);
    // The world goes by world_id / world_name; a bare `world` is unknown.
    expect(validatePatch({ world: { id: "wrld_a" } })).toEqual({
      ok: false,
      error: "unknown field: world",
    });
  });
});
