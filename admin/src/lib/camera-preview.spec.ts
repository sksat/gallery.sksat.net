import { describe, expect, it } from "vitest";
import {
  cameraPreview,
  parseCameraPreview,
  PREVIEW_PHOTOS,
} from "./camera-preview";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO camera (id, slug, name) VALUES (1, 'gr', 'GR'), (2, 'sp', 'SP'), (3, 'none', 'None');
    INSERT INTO media (id, file, platform, tags, camera_id, timestamp) VALUES
      (1, '/a.jpg', 'Real', '[]', 1, '2023-12-01T00:00:00Z'),
      (2, '/b.jpg', 'Real', '[]', 1, '2023-12-05T00:00:00Z'),
      (3, '/c.jpg', 'Real', '[]', 1, NULL),
      (4, '/d.jpg', 'Real', '[]', 1, '2023-12-03T00:00:00Z'),
      (5, '/e.jpg', 'Real', '[]', 1, '2023-12-04T00:00:00Z'),
      (6, '/f.jpg', 'Real', '[]', 1, '2023-12-09T00:00:00Z'),
      (7, '/g.jpg', 'Real', '[]', 2, '2023-12-02T00:00:00Z');
    UPDATE media SET trashed_at = '2024-01-01T00:00:00Z' WHERE id = 6;
    INSERT INTO camera_image (camera_id, file, position) VALUES
      (1, '/camera/gr/side.png', 1), (1, '/camera/gr/front.png', 0);
    INSERT INTO camera_image (camera_id, media_id, position) VALUES (2, 7, 0);
  `);
  return sqliteD1(raw);
};

describe("cameraPreview", () => {
  it("gives the first picture and the newest listed photos", async () => {
    const db = setup();
    const p = await cameraPreview(db, 1);
    expect(p.picture).toEqual({ file: "/camera/gr/front.png", exact: true });
    // Not the one in the trash; undated last.
    expect(p.photos.map((x) => x.id)).toEqual([2, 5, 4, 1]);
    expect(p.photos).toHaveLength(PREVIEW_PHOTOS);
    expect(p.photos[0]).toEqual({ id: 2, file: "/b.jpg", platform: "Real" });
  });

  it("takes a photo chosen as the picture as its file", async () => {
    const db = setup();
    expect((await cameraPreview(db, 2)).picture).toEqual({
      file: "/g.jpg",
      exact: false,
    });
    expect(await cameraPreview(db, 3)).toEqual({ picture: null, photos: [] });
  });

  it("parses the route's answer", () => {
    expect(
      parseCameraPreview({
        picture: { file: "/p.png", exact: true },
        photos: [{ id: 1, file: "/a.jpg", platform: "Real" }, { id: "x" }],
      }),
    ).toEqual({
      picture: { file: "/p.png", exact: true },
      photos: [{ id: 1, file: "/a.jpg", platform: "Real" }],
    });
    expect(parseCameraPreview({ picture: null })).toBeNull();
    expect(parseCameraPreview(null)).toBeNull();
  });
});
