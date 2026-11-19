// Photos digitised from an analog original (0009) on the real schema: the
// taken-at, スキャン機材 and EXIF choice of updateMedia, and 機材を登録.
import { describe, expect, it } from "vitest";
import {
  digitizerOptions,
  getMedia,
  listCameras,
  registerScanner,
  slugFromModel,
  updateMedia,
} from "./db";
import { linkDigitizerSql, scannerOf } from "./digitizer";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";
import { validatePatch } from "./validate";

const GCMC = JSON.stringify({
  make: "GCMC",
  model: "Scanner",
  taken_at_original: "2021-01-01T00:31:12",
});

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`INSERT INTO media (file, platform, timestamp, file_exif, digitized_at, metadata_source)
    VALUES ('/2024/a.jpg', 'Real', NULL, '${GCMC}', '2021-01-01T00:31:12+09:00', NULL),
           ('/2024/b.jpg', 'Real', NULL, '${GCMC}', '2021-01-01T00:32:00+09:00', NULL),
           ('/2024/c.jpg', 'Real', NULL, '${GCMC}', NULL, '{"digitized_with":"manual"}'),
           ('/x.jpg', 'Real', '2023-12-11T01:21:32+09:00',
             '{"make":"FUJIFILM","model":"X-T5"}', NULL, NULL)`);
  return { raw, db: sqliteD1(raw) };
};

const patch = (body: unknown) => {
  const v = validatePatch(body);
  if (!v.ok) throw new Error(v.error);
  return v.patch;
};

describe("updateMedia: taken-at, スキャン機材, EXIF", () => {
  it("sets the taken-at by hand, as manual, and only when it changes", async () => {
    const { db } = setup();
    const row = await updateMedia(
      db,
      1,
      patch({ timestamp: "2024-02-01T00:00:00+09:00" }),
    );
    expect(row).toMatchObject({
      timestamp: "2024-02-01T00:00:00+09:00",
      metadata_source: { taken_at: "manual" },
    });
    // The same value again: no new mark on another photo.
    const same = await updateMedia(
      db,
      4,
      patch({ timestamp: "2023-12-11T01:21:32+09:00" }),
    );
    expect(same?.metadata_source).toEqual({});
    expect(validatePatch({ timestamp: "2024-02-30T00:00:00+09:00" }).ok).toBe(
      false,
    );
    expect(validatePatch({ timestamp: "2024-02-01T00:00" }).ok).toBe(false);
  });

  it("sets or clears the スキャン機材 as manual, and the EXIF choice", async () => {
    const { raw, db } = setup();
    raw.exec(
      "INSERT INTO camera (slug, name, kind) VALUES ('ls-50', 'LS-50', 'scanner')",
    );
    const set = await updateMedia(
      db,
      1,
      patch({ digitized_with: 1, embed_exif: false }),
    );
    expect(set).toMatchObject({
      digitized_with: 1,
      embed_exif: false,
      metadata_source: { digitized_with: "manual" },
    });
    const cleared = await updateMedia(
      db,
      1,
      patch({ digitized_with: null, embed_exif: null }),
    );
    expect(cleared).toMatchObject({ digitized_with: null, embed_exif: null });
    expect(validatePatch({ embed_exif: "yes" }).ok).toBe(false);
    expect(validatePatch({ digitized_with: 0 }).ok).toBe(false);
  });
});

describe("registerScanner (機材を登録)", () => {
  it("creates a scanner camera and links the photos that name it", async () => {
    const { db } = setup();
    const scanner = scannerOf((await getMedia(db, 1))?.file_exif);
    expect(scanner).toEqual({ make: "GCMC", model: "Scanner" });
    const first = await registerScanner(db, scanner!);
    expect(first).toMatchObject({
      camera: { name: "Scanner", slug: "scanner", kind: "scanner" },
      created: true,
      // a and b; c was cleared by hand, the X-T5 is a camera.
      linked: 2,
    });
    expect((await getMedia(db, 3))?.digitized_with).toBeNull();
    // Again (another tab): the same row, nothing new.
    const again = await registerScanner(db, {
      make: "gcmc",
      model: "SCANNER",
    });
    expect(again).toMatchObject({ created: false, linked: 0 });
    expect(again.camera.id).toBe(first.camera.id);
    const cams = await listCameras(db);
    expect(cams.map((c) => [c.slug, c.digitized_count])).toEqual([
      ["scanner", 2],
    ]);
  });

  it("takes the next free slug", async () => {
    const { raw, db } = setup();
    raw.exec("INSERT INTO camera (slug, name) VALUES ('scanner', 'Other')");
    const { camera } = await registerScanner(db, {
      make: "GCMC",
      model: "Scanner",
    });
    expect(camera.slug).toBe("scanner-2");
    expect(slugFromModel("Nikon SUPER COOLSCAN 5000 ED")).toBe(
      "nikon-super-coolscan-5000-ed",
    );
    expect(slugFromModel("—")).toBe("camera");
  });

  it("is never a scanner for a camera's file", () => {
    expect(scannerOf({ make: "FUJIFILM", model: "X-T5" })).toBeNull();
    expect(scannerOf({ make: "GCMC" })).toBeNull();
    expect(scannerOf(null)).toBeNull();
  });
});

describe("linkDigitizerSql (reading and uploads)", () => {
  it("links an existing row only when none is set and none was chosen", async () => {
    const { raw } = setup();
    raw.exec(
      "INSERT INTO camera (slug, name, manufacturer, model) VALUES ('s', 'S', 'GCMC', 'Scanner')",
    );
    raw.exec(`UPDATE media SET ${linkDigitizerSql("'gcmc'", "'scanner'")}`);
    const linked = raw
      .prepare("SELECT file, digitized_with FROM media ORDER BY id")
      .all();
    expect(linked).toEqual([
      { file: "/2024/a.jpg", digitized_with: 1 },
      { file: "/2024/b.jpg", digitized_with: 1 },
      { file: "/2024/c.jpg", digitized_with: null },
      { file: "/x.jpg", digitized_with: 1 },
    ]);
    // NULL make / model (a camera's reading): nothing.
    raw.exec("UPDATE media SET digitized_with = NULL");
    raw.exec(`UPDATE media SET ${linkDigitizerSql("NULL", "NULL")}`);
    expect(
      raw.prepare("SELECT COUNT(digitized_with) AS n FROM media").get(),
    ).toEqual({ n: 0 });
  });
});

describe("digitizerOptions", () => {
  it("lists scanners first", () => {
    expect(
      digitizerOptions([
        { id: 1, name: "A", slug: "a", kind: "digital" },
        { id: 2, name: "B", slug: "b", kind: "scanner" },
        { id: 3, name: "C", slug: "c", kind: null },
      ]).map((c) => c.id),
    ).toEqual([2, 1, 3]);
  });
});
