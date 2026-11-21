import { describe, expect, it } from "vitest";

import type { CameraJSON, MediaInfoJSON } from "./gallery/types";
import {
  cameraListOgp,
  cameraOgp,
  fallbackOgp,
  newestMediaIndex,
  ogpHead,
  photoOgp,
  topOgp,
} from "./ogp";

const s3Base = "https://s3.example";
const worker = { s3Base, imageBase: "https://gallery.sksat.net/img" };
const noWorker = { s3Base, imageBase: "" };

const vrchat: MediaInfoJSON = {
  id: "vrcxxxxxxa",
  file: "/VRChat/2023-12/VRChat_2023-12-16_23-12-25.684_7680x4320.png",
  platform: "VRChat",
  timestamp: "2023-12-16T23:12:25.684+09:00",
  camera: {
    slug: "virtuallens2",
    name: "VirtualLens2",
    manufacturer: "logilabo",
    model: "VirtualLens2",
  },
  tags: ["VRChat"],
};
const real: MediaInfoJSON = {
  id: "reaxxxxxxa",
  file: "/2023-12-comsys2023/DSC1.JPG",
  platform: "Real",
  timestamp: "2023-12-01T15:30:00Z",
  camera: null,
  tags: ["film", "night"],
};
const undated: MediaInfoJSON = {
  id: "undatedxxx",
  file: "/misc/a.png",
  platform: "Real",
  timestamp: null,
  camera: null,
  tags: [],
};

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
    expect(photoOgp(worker, vrchat)).toEqual({
      title: "2023年12月16日 📷 VirtualLens2 | sksat gallery",
      description:
        "2023年12月16日 23:12 撮影。タグ: VRChat。カメラ: VirtualLens2。",
      url: "https://gallery.sksat.net/photo/vrcxxxxxxa/",
      type: "article",
      image: {
        url: "https://gallery.sksat.net/img/vrcxxxxxxa?size=og",
        alt: "2023年12月16日 📷 VirtualLens2",
        width: 1200,
        height: 630,
      },
    });
  });

  it("treats the platform as a tag and omits a missing camera", () => {
    // In the photo's own offset (here UTC), like the gallery and the page.
    expect(photoOgp(worker, real).description).toBe(
      "2023年12月1日 15:30 撮影。タグ: Real, film, night。",
    );
  });

  it("adds the world's name when it is public", () => {
    const ogp = photoOgp(worker, {
      ...vrchat,
      world: { id: "wrld_x", name: "Re․Aurora" },
    });
    expect(ogp.title).toBe("2023年12月16日 @ Re․Aurora 📷 VirtualLens2 | sksat gallery");
    expect(ogp.image?.alt).toBe("2023年12月16日 @ Re․Aurora 📷 VirtualLens2");
    const undatedWorld = { ...undated, world: { id: null, name: "Re․Aurora" } };
    expect(photoOgp(worker, undatedWorld).title).toBe(
      "@ Re․Aurora | sksat gallery",
    );
    const undatedBoth = { ...undatedWorld, camera: vrchat.camera };
    expect(photoOgp(worker, undatedBoth).title).toBe(
      "@ Re․Aurora 📷 VirtualLens2 | sksat gallery",
    );
    expect(photoOgp(worker, undatedBoth).image?.alt).toBe(
      "@ Re․Aurora 📷 VirtualLens2",
    );
    // An id alone (no name) is not a title.
    const idOnly = { ...vrchat, world: { id: "wrld_x", name: null } };
    expect(photoOgp(worker, idOnly).title).toBe("2023年12月16日 📷 VirtualLens2 | sksat gallery");
  });

  it("names an undated photo by its camera, else just the site", () => {
    const withCamera = photoOgp(worker, { ...undated, camera: vrchat.camera });
    expect(withCamera.title).toBe("📷 VirtualLens2 | sksat gallery");
    expect(withCamera.image?.alt).toBe("📷 VirtualLens2");
    const withMaker = photoOgp(worker, { ...undated, maker: "Nikon" });
    expect(withMaker.title).toBe("📷 Nikon | sksat gallery");

    const ogp = photoOgp(worker, undated);
    expect(ogp.title).toBe("sksat gallery");
    expect(ogp.image?.alt).toBe("写真");
    expect(ogp.description).toBe("タグ: Real。");
  });

  it("falls back to the original, sized only when the name says so", () => {
    expect(photoOgp(noWorker, vrchat).image).toEqual({
      url: s3Base + vrchat.file,
      alt: "2023年12月16日 📷 VirtualLens2",
      width: 7680,
      height: 4320,
    });
    expect(photoOgp(noWorker, real).image).toEqual({
      url: s3Base + real.file,
      alt: "2023年12月1日",
    });
  });
});

describe("cameraOgp", () => {
  const vl2: CameraJSON = {
    slug: "virtuallens2",
    name: "VirtualLens2",
    manufacturer: "logilabo",
    manufacturerUrl: null,
    model: "VirtualLens2",
    kind: "virtual",
    description: null,
    productUrl: null,
    images: [],
  };

  it("uses the camera's first picture as the card", () => {
    const ogp = cameraOgp(worker, [vrchat, real], {
      ...vl2,
      description: "First line\nsecond line",
      images: [
        { file: "/camera/virtuallens2/a.png", caption: null },
        { file: "/camera/virtuallens2/b.png", caption: null },
      ],
    });
    expect(ogp.title).toBe("VirtualLens2 | sksat gallery");
    expect(ogp.description).toBe("First line");
    expect(ogp.url).toBe("https://gallery.sksat.net/camera/virtuallens2/");
    expect(ogp.image?.url).toBe(
      "https://gallery.sksat.net/img/camera/virtuallens2/a.png?size=og-site",
    );
  });

  it("falls back to the newest photo taken with it", () => {
    const ogp = cameraOgp(worker, [vrchat, real], vl2);
    expect(ogp.description).toBe("VirtualLens2 で撮った写真 (1 枚)。");
    expect(ogp.image?.url).toBe(
      "https://gallery.sksat.net/img/vrcxxxxxxa?size=og-site",
    );
  });

  it("has no image when there is nothing to show", () => {
    expect(cameraOgp(worker, [real], vl2).image).toBeNull();
  });
});

describe("cameraListOgp", () => {
  it("is the site badge card with its own title and URL", () => {
    const ogp = cameraListOgp(worker, [vrchat, real]);
    expect(ogp.title).toBe("カメラ | sksat gallery");
    expect(ogp.url).toBe("https://gallery.sksat.net/camera/");
    expect(ogp.image?.url).toBe(
      "https://gallery.sksat.net/img/vrcxxxxxxa?size=og-site",
    );
  });
});

describe("topOgp", () => {
  it("uses the newest photo's card", () => {
    const ogp = topOgp(worker, [vrchat, real]);
    expect(ogp.url).toBe("https://gallery.sksat.net/");
    expect(ogp.type).toBe("website");
    expect(ogp.title).toBe("sksat gallery");
    expect(ogp.image?.url).toBe(
      "https://gallery.sksat.net/img/vrcxxxxxxa?size=og-site",
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
    const head = ogpHead(photoOgp(worker, vrchat));
    expect(head.title).toBe("2023年12月16日 📷 VirtualLens2 | sksat gallery");
    expect(content(head, "og:site_name")).toBe("sksat gallery");
    expect(content(head, "og:type")).toBe("article");
    expect(content(head, "og:url")).toBe(
      "https://gallery.sksat.net/photo/vrcxxxxxxa/",
    );
    expect(content(head, "og:title")).toBe(head.title);
    expect(content(head, "og:description")).toBe(content(head, "description"));
    expect(content(head, "og:image:width")).toBe("1200");
    expect(content(head, "og:image:height")).toBe("630");
    expect(content(head, "og:image:alt")).toBe("2023年12月16日 📷 VirtualLens2");
    expect(content(head, "twitter:card")).toBe("summary_large_image");
  });

  it("omits the image size when unknown", () => {
    const head = ogpHead(photoOgp(noWorker, real));
    expect(content(head, "og:image")).toBe(s3Base + real.file);
    expect(content(head, "og:image:width")).toBeUndefined();
  });

  it("falls back to a small card without an image", () => {
    const head = ogpHead(fallbackOgp("/"));
    expect(content(head, "og:image")).toBeUndefined();
    expect(content(head, "twitter:card")).toBe("summary");
  });
});
