// updateMedia's tag_visibility (0021) on the real schema.
import { describe, expect, it } from "vitest";
import { getMedia, updateMedia } from "./db";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO camera (id, slug, name) VALUES (1, 'a', 'A'), (2, 'b', 'B');
    INSERT INTO camera_tag (camera_id, tag, propagate) VALUES
      (1, 'VRChat', 1), (2, 'film', 1);
    INSERT INTO media (id, file, platform, tags, camera_id) VALUES
      (1, '/a.png', 'Real', '["night","secret"]', 1);
  `);
  const tv = () =>
    (raw.prepare("SELECT tag_visibility AS tv FROM media").get() as {
      tv: string | null;
    }).tv;
  return { db: sqliteD1(raw), tv };
};

describe("updateMedia tag_visibility", () => {
  it("merges choices; null takes one off, none left is NULL", async () => {
    const { db, tv } = setup();
    await updateMedia(db, 1, {
      tag_visibility: { night: "hidden", secret: "hidden" },
    });
    expect(JSON.parse(tv() ?? "")).toEqual({
      night: "hidden",
      secret: "hidden",
    });
    expect((await getMedia(db, 1))?.tag_visibility).toEqual({
      night: "hidden",
      secret: "hidden",
    });
    await updateMedia(db, 1, { tag_visibility: { night: null } });
    expect(tv()).toBe('{"secret":"hidden"}');
    await updateMedia(db, 1, { tag_visibility: { secret: null } });
    expect(tv()).toBeNull();
  });

  it("keeps only the choices of tags the photo still has, its camera's too", async () => {
    const { db, tv } = setup();
    await updateMedia(db, 1, {
      tag_visibility: { night: "hidden", secret: "hidden", VRChat: "hidden" },
    });
    await updateMedia(db, 1, { tags: ["night"] });
    expect(JSON.parse(tv() ?? "")).toEqual({
      night: "hidden",
      VRChat: "hidden",
    });
    // With another camera in the same save: the new camera's tags count.
    await updateMedia(db, 1, {
      tags: ["night"],
      camera_id: 2,
      tag_visibility: { film: "hidden" },
    });
    expect(JSON.parse(tv() ?? "")).toEqual({
      night: "hidden",
      film: "hidden",
    });
    await updateMedia(db, 1, { tags: [], camera_id: null });
    expect(tv()).toBeNull();
  });
});
