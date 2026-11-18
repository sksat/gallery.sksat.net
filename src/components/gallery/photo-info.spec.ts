import { describe, expect, it } from "vitest";

import {
  exifBody,
  exposureLine,
  hasDetails,
  infoSummary,
  mapHref,
  photoInfo,
  takenAt,
  worldHref,
} from "./photo-info";
import { transformMediaInfo, type MediaInfoJSON } from "./types";

describe("takenAt", () => {
  it("shows the time to the minute in the photo's own offset", () => {
    // 23:12 in +09:00 is 14:12 UTC; the photo's own clock is kept.
    expect(takenAt("2023-12-16T23:12:53+09:00", "second")).toEqual({
      text: "2023/12/16 23:12",
      datetime: "2023-12-16T23:12+09:00",
    });
    expect(takenAt("2023-12-16T23:12:00-05:00", "minute")).toEqual({
      text: "2023/12/16 23:12",
      datetime: "2023-12-16T23:12-05:00",
    });
    expect(takenAt("2023-12-02T00:00:00Z", null)?.text).toBe(
      "2023/12/02 00:00",
    );
    expect(takenAt("2023-12-02T00:00:00.123Z", "second")?.datetime).toBe(
      "2023-12-02T00:00Z",
    );
  });

  it("says no more than the precision", () => {
    const at = "2023-12-16T00:00:00+09:00";
    expect(takenAt(at, "date")).toEqual({
      text: "2023/12/16",
      datetime: "2023-12-16",
    });
    expect(takenAt(at, "month")).toEqual({
      text: "2023/12",
      datetime: "2023-12",
    });
    expect(takenAt(at, "year")).toEqual({ text: "2023", datetime: "2023" });
  });

  it("is null without a readable time", () => {
    expect(takenAt(null, "date")).toBeNull();
    expect(takenAt("yesterday", "second")).toBeNull();
  });
});

describe("exposureLine", () => {
  it("joins what is known", () => {
    expect(
      exposureLine({
        f_number: 2.8,
        exposure_time: "1/250",
        iso: 100,
        focal_length_mm: 35,
      }),
    ).toBe("f/2.8 · 1/250 s · ISO 100 · 35 mm");
    expect(exposureLine({ iso: 3200 })).toBe("ISO 3200");
    expect(exposureLine({ exposure_time: "2", focal_length_mm: 4.25 })).toBe(
      "2 s · 4.3 mm",
    );
  });

  it("drops trailing zeros", () => {
    expect(exposureLine({ f_number: 8 })).toBe("f/8");
    expect(exposureLine({ f_number: 0.95 })).toBe("f/0.95");
    expect(exposureLine({ focal_length_mm: 50.0 })).toBe("50 mm");
  });

  it("is null when nothing is known", () => {
    expect(exposureLine(null)).toBeNull();
    expect(exposureLine({ lens: "35mm F1.4" })).toBeNull();
  });
});

describe("exifBody", () => {
  it("does not repeat the make", () => {
    expect(exifBody({ make: "Canon", model: "Canon EOS R5" })).toBe(
      "Canon EOS R5",
    );
    expect(exifBody({ make: "SONY", model: "ILCE-7M4" })).toBe(
      "SONY ILCE-7M4",
    );
    expect(exifBody({ model: "X100V" })).toBe("X100V");
    expect(exifBody({ iso: 100 })).toBeNull();
  });
});

describe("worldHref", () => {
  it("links only when the id is given", () => {
    expect(worldHref({ id: "wrld_abc-1", name: "Home" })).toBe(
      "https://vrchat.com/home/world/wrld_abc-1",
    );
    expect(worldHref({ id: null, name: "Home" })).toBeNull();
    expect(worldHref(null)).toBeNull();
  });
});

describe("mapHref", () => {
  it("has no map page yet", () => {
    expect(
      mapHref({ latitude: 35.68, longitude: 139.77, precision: "city" }),
    ).toBeNull();
  });
});

const base: MediaInfoJSON = {
  id: "abcdefghjk",
  file: null,
  path: null,
  name: null,
  platform: "Real",
  timestamp: null,
  timestamp_precision: null,
  camera: null,
  maker: null,
  world: null,
  exif: null,
  location: null,
  tags: [],
};

const info = (m: Partial<MediaInfoJSON>) =>
  photoInfo(transformMediaInfo({ ...base, ...m }));

describe("photoInfo", () => {
  it("shows everything the API gave", () => {
    const i = info({
      platform: "VRChat",
      path: "/2023/a.png",
      name: "a.png",
      timestamp: "2023-12-16T23:12:00+09:00",
      timestamp_precision: "minute",
      camera: {
        slug: "virtuallens2",
        name: "VirtualLens2",
        manufacturer: "logilabo",
        model: "VirtualLens2",
      },
      exif: {
        make: "Canon",
        model: "EOS R5",
        lens: "RF35mm F1.8",
        f_number: 1.8,
      },
      world: { id: "wrld_x", name: "Home" },
      tags: ["VRChat", "night"],
    });
    expect(i).toEqual({
      taken: { text: "2023/12/16 23:12", datetime: "2023-12-16T23:12+09:00" },
      camera: { label: "VirtualLens2", href: "/camera/virtuallens2/" },
      body: "Canon EOS R5",
      lens: "RF35mm F1.8",
      exposure: "f/1.8",
      world: { name: "Home", href: "https://vrchat.com/home/world/wrld_x" },
      location: null,
      tags: ["VRChat", "night"],
      file: "/2023/a.png",
    });
    expect(infoSummary(i)).toBe("2023/12/16 23:12 · VirtualLens2");
  });

  it("leaves out what the API did not give", () => {
    const i = info({ name: "b.png" });
    expect(i).toMatchObject({
      taken: null,
      camera: null,
      body: null,
      lens: null,
      exposure: null,
      world: null,
      location: null,
      file: "b.png",
    });
    // The platform is a tag in the gallery.
    expect(i.tags).toEqual(["Real"]);
    expect(infoSummary(i)).toBeNull();
    expect(hasDetails(info({}))).toBe(false);
    expect(hasDetails(i)).toBe(true);
  });

  it("shows a maker-only camera as text, and a world without a link", () => {
    const i = info({
      maker: "logilabo",
      world: { id: null, name: "Home" },
      location: { latitude: 35.7, longitude: 139.8, precision: "prefecture" },
    });
    expect(i.camera).toEqual({ label: "logilabo", href: null });
    expect(i.world).toEqual({ name: "Home", href: null });
    // No map page yet: the location is left out.
    expect(i.location).toBeNull();
  });

  it("never names a camera the API left out from the EXIF", () => {
    const exif = { make: "FUJIFILM", model: "X100V" };
    expect(info({ exif })).toMatchObject({ camera: null, body: null });
    expect(info({ exif, maker: "FUJIFILM" })).toMatchObject({
      camera: { label: "FUJIFILM", href: null },
      body: null,
    });
  });
});
