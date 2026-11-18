// Editing a photo's shooting data (updateMedia with exif / location /
// world) on the real schema.
import { describe, expect, it } from "vitest";
import { getMedia, updateMedia } from "./db";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";
import { validatePatch } from "./validate";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`INSERT INTO media (file, platform, exif, latitude, longitude,
      location_source, world_id, world_name, world_author_id)
    VALUES ('/a.jpg', 'Real',
      '{"make":"FUJIFILM","lens":"L","orientation":6}',
      35.5, 139.5, 'exif', 'wrld_a', 'A', 'usr_x')`);
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
    expect(cleared).toMatchObject({
      latitude: null,
      longitude: null,
      location_source: null,
    });
  });

  it("drops the file's author when the world changes", async () => {
    const { db } = setup();
    expect(
      await updateMedia(db, 1, patch({ world_id: "wrld_a", world_name: "B" })),
    ).toMatchObject({
      world_id: "wrld_a",
      world_name: "B",
      world_author_id: "usr_x",
    });
    expect(
      await updateMedia(db, 1, patch({ world_id: "wrld_b", world_name: "B" })),
    ).toMatchObject({ world_id: "wrld_b", world_author_id: null });
    expect(await getMedia(db, 1)).toMatchObject({ world_id: "wrld_b" });
  });

  it("keeps what a partial patch leaves out", async () => {
    const { db } = setup();
    expect(await updateMedia(db, 1, patch({ world_name: "B" }))).toMatchObject({
      world_id: "wrld_a",
      world_name: "B",
      world_author_id: "usr_x",
    });
    const row = await updateMedia(db, 1, patch({ exif: { model: "X-T5" } }));
    expect(row?.exif).toEqual({
      make: "FUJIFILM",
      model: "X-T5",
      lens: "L",
      orientation: 6,
    });
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
