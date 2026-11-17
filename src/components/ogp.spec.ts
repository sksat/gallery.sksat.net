import { describe, expect, it } from "vitest";

import type { MediaInfoJSON } from "./gallery/types";
import {
  fallbackOgp,
  formatJst,
  newestMediaIndex,
  ogpHead,
  photoOgp,
  topOgp,
} from "./ogp";

const s3Base = "https://s3.example";
const worker = { s3Base, imageBase: "https://gallery.sksat.net/img" };
const noWorker = { s3Base, imageBase: "" };

const vrchat: MediaInfoJSON = {
  file: "/VRChat/2023-12/VRChat_2023-12-16_23-12-25.684_7680x4320.png",
  world: "VRChat",
  timestamp: "2023-12-16T23:12:25.684+09:00",
  camera: { make: "logilabo", model: "VirtualLens2" },
  tags: ["VRChat"],
};
const real: MediaInfoJSON = {
  file: "/2023-12-comsys2023/DSC1.JPG",
  world: "Real",
  timestamp: "2023-12-01T15:30:00Z",
  camera: null,
  tags: ["film", "night"],
};
const undated: MediaInfoJSON = {
  file: "/misc/a.png",
  world: "Real",
  timestamp: null,
  camera: null,
  tags: [],
};

describe("formatJst", () => {
  it("shows the date and time in JST across the UTC date line", () => {
    expect(formatJst(new Date("2023-12-01T15:30:00Z"))).toEqual({
      date: "2023年12月2日",
      time: "00:30",
    });
  });
});

describe("newestMediaIndex", () => {
  it("picks the latest timestamp, comparing instants not strings", () => {
    // 15:00Z is later than 23:12+09:00 (= 14:12Z) but sorts lower as a string.
    const utc = { ...real, timestamp: "2023-12-16T15:00:00Z" };
    expect(newestMediaIndex([utc, vrchat, undated])).toBe(0);
  });

  it("prefers the later entry on a tie", () => {
    expect(newestMediaIndex([vrchat, vrchat])).toBe(1);
  });

  it("falls back to the last entry without timestamps, null when empty", () => {
    expect(newestMediaIndex([undated, undated])).toBe(1);
    expect(newestMediaIndex([])).toBeNull();
  });
});

describe("photoOgp", () => {
  it("describes a photo with date, tags and camera", () => {
    expect(photoOgp(worker, [real, vrchat], 1)).toEqual({
      title: "2023年12月16日の写真 | sksat gallery",
      description:
        "2023年12月16日 23:12 撮影。タグ: VRChat。カメラ: logilabo VirtualLens2。",
      url: "https://gallery.sksat.net/photo/1/",
      type: "article",
      image: {
        url: "https://gallery.sksat.net/img/og/VRChat/2023-12/VRChat_2023-12-16_23-12-25.684_7680x4320.png",
        alt: "2023年12月16日の写真",
        width: 1200,
        height: 630,
      },
    });
  });

  it("treats the world as a tag and omits a missing camera", () => {
    expect(photoOgp(worker, [real], 0)?.description).toBe(
      "2023年12月2日 00:30 撮影。タグ: Real, film, night。",
    );
  });

  it("uses the photo number when the date is unknown", () => {
    const ogp = photoOgp(worker, [real, undated], 1);
    expect(ogp?.title).toBe("写真 #1 | sksat gallery");
    expect(ogp?.description).toBe("タグ: Real。");
  });

  it("falls back to the original, sized only when the name says so", () => {
    expect(photoOgp(noWorker, [vrchat], 0)?.image).toEqual({
      url: s3Base + vrchat.file,
      alt: "2023年12月16日の写真",
      width: 7680,
      height: 4320,
    });
    expect(photoOgp(noWorker, [real], 0)?.image).toEqual({
      url: s3Base + real.file,
      alt: "2023年12月2日の写真",
    });
  });

  it("is null for an id out of range", () => {
    expect(photoOgp(worker, [real], 1)).toBeNull();
    expect(photoOgp(worker, [real], -1)).toBeNull();
  });
});

describe("topOgp", () => {
  it("uses the newest photo's card", () => {
    const ogp = topOgp(worker, [vrchat, real]);
    expect(ogp.url).toBe("https://gallery.sksat.net/");
    expect(ogp.type).toBe("website");
    expect(ogp.title).toBe("sksat gallery");
    expect(ogp.image?.url).toBe(
      "https://gallery.sksat.net/img/og-site" + vrchat.file,
    );
  });

  it("has no image for an empty index", () => {
    expect(topOgp(worker, []).image).toBeNull();
  });
});

describe("ogpHead", () => {
  const content = (head: ReturnType<typeof ogpHead>, key: string) =>
    head.meta.find((m) => m.property === key || m.name === key)?.content;

  it("emits OGP and a large Twitter card", () => {
    const head = ogpHead(photoOgp(worker, [vrchat], 0)!);
    expect(head.title).toBe("2023年12月16日の写真 | sksat gallery");
    expect(content(head, "og:site_name")).toBe("sksat gallery");
    expect(content(head, "og:type")).toBe("article");
    expect(content(head, "og:url")).toBe("https://gallery.sksat.net/photo/0/");
    expect(content(head, "og:title")).toBe(head.title);
    expect(content(head, "og:description")).toBe(content(head, "description"));
    expect(content(head, "og:image:width")).toBe("1200");
    expect(content(head, "og:image:height")).toBe("630");
    expect(content(head, "og:image:alt")).toBe("2023年12月16日の写真");
    expect(content(head, "twitter:card")).toBe("summary_large_image");
  });

  it("omits the image size when unknown", () => {
    const head = ogpHead(photoOgp(noWorker, [real], 0)!);
    expect(content(head, "og:image")).toBe(s3Base + real.file);
    expect(content(head, "og:image:width")).toBeUndefined();
  });

  it("falls back to a small card without an image", () => {
    const head = ogpHead(fallbackOgp("/"));
    expect(content(head, "og:image")).toBeUndefined();
    expect(content(head, "twitter:card")).toBe("summary");
  });
});
