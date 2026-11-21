import { describe, expect, it } from "vitest";

import { photoContext } from "./detail";
import { sortMedia } from "./sort";
import { transformMediaInfo, type MediaInfoJSON } from "./types";

const photo = (
  id: string,
  timestamp: string,
  tags: string[],
  camera: string | null = null,
): MediaInfoJSON => ({
  id,
  file: null,
  platform: "Real",
  timestamp,
  camera: camera ? { slug: camera, name: camera, manufacturer: null, model: null } : null,
  tags,
});

// Newest first: c, b, a.
const media = [
  photo("cccccccccc", "2023-12-03T00:00:00Z", ["night"], "cam"),
  photo("bbbbbbbbbb", "2023-12-02T00:00:00Z", ["day"]),
  photo("aaaaaaaaaa", "2023-12-01T00:00:00Z", ["night"], "cam"),
].map(transformMediaInfo);

const ctx = (id: string, query = "") =>
  photoContext(media, [], id, new URLSearchParams(query));

describe("photoContext", () => {
  it("steps through every photo, newest first, by default", () => {
    expect(ctx("bbbbbbbbbb")).toMatchObject({
      camera: null,
      backHref: "/",
      prevHref: "/photo/cccccccccc/detail/",
      nextHref: "/photo/aaaaaaaaaa/detail/",
    });
    expect(ctx("cccccccccc").prevHref).toBeNull();
  });

  it("follows the list it came from", () => {
    expect(ctx("cccccccccc", "tag=night")).toMatchObject({
      backHref: "/?tag=night",
      prevHref: null,
      nextHref: "/photo/aaaaaaaaaa/detail/?tag=night",
    });
    expect(ctx("aaaaaaaaaa", "camera=cam&sort=old")).toMatchObject({
      camera: "cam",
      backHref: "/camera/cam/?sort=old",
      prevHref: null,
      nextHref: "/photo/cccccccccc/detail/?camera=cam&sort=old",
    });
  });

  it("drops an unknown camera, and an unlisted photo has no neighbours", () => {
    expect(ctx("bbbbbbbbbb", "camera=nope")).toMatchObject({
      camera: null,
      backHref: "/",
    });
    expect(ctx("uuuuuuuuuu")).toMatchObject({
      prevHref: null,
      nextHref: null,
    });
  });

  it("keeps a random order's seed, in the same order as the list", () => {
    const c = ctx("bbbbbbbbbb", "sort=random&seed=5");
    const [prev, next] = [c.prevHref, c.nextHref];
    expect(c.backHref).toBe("/?sort=random&seed=5");
    for (const href of [prev, next]) {
      if (href !== null) expect(href).toMatch(/\?sort=random&seed=5$/);
    }
    // Walking next from the first photo of that order visits all three.
    const order: string[] = [];
    let id: string | null = ["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc"].find(
      (x) => ctx(x, "sort=random&seed=5").prevHref === null,
    )!;
    while (id) {
      order.push(id);
      const n: string | null = ctx(id, "sort=random&seed=5").nextHref;
      id = n ? /\/photo\/(\w+)\//.exec(n)![1] : null;
    }
    // The gallery's own order for that seed.
    expect(order).toEqual(
      sortMedia(
        media.map((value, index) => ({ index, value })),
        { kind: "random", seed: 5 },
      ).map((m) => m.value.id),
    );
  });

  it("browses everything when the photo is outside the filter", () => {
    expect(ctx("bbbbbbbbbb", "tag=night")).toMatchObject({
      prevHref: "/photo/cccccccccc/detail/?tag=night",
      nextHref: "/photo/aaaaaaaaaa/detail/?tag=night",
    });
  });
});
