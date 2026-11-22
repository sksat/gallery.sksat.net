import { describe, expect, it } from "vitest";

import {
  exifBody,
  exposureSpecs,
  splitTaken,
  groupTagFields,
  hasDetails,
  placeOf,
  photoInfo,
  worldHref,
} from "./photo-info";
import { placeLabel } from "../map/places";
import { transformMediaInfo, type MediaInfoJSON } from "./types";

// The time itself: taken.spec.ts.

describe("groupTagFields", () => {
  it("groups the fields by tag, in order", () => {
    expect(
      groupTagFields([
        { tag: "フィルム", label: "銘柄", value: "Portra 400" },
        { tag: "旅行", label: "行き先", value: "京都" },
        { tag: "フィルム", label: "ISO", value: "400" },
      ]),
    ).toEqual([
      {
        tag: "フィルム",
        fields: [
          { label: "銘柄", value: "Portra 400" },
          { label: "ISO", value: "400" },
        ],
      },
      { tag: "旅行", fields: [{ label: "行き先", value: "京都" }] },
    ]);
    expect(groupTagFields(undefined)).toEqual([]);
  });
});

const values = (exif: Parameters<typeof exposureSpecs>[0]) =>
  exposureSpecs(exif)?.map((s) => s.value) ?? null;

describe("exposureSpecs", () => {
  it("lists what is known, in order, each with its name", () => {
    expect(
      exposureSpecs({
        f_number: 2.8,
        exposure_time: "1/250",
        iso: 100,
        focal_length_mm: 35,
      }),
    ).toEqual([
      { label: "絞り", value: "f/2.8" },
      { label: "シャッター", value: "1/250 s" },
      { label: "ISO 感度", value: "ISO 100" },
      { label: "焦点距離", value: "35 mm" },
    ]);
    expect(values({ iso: 3200 })).toEqual(["ISO 3200"]);
    expect(values({ exposure_time: "2", focal_length_mm: 4.25 })).toEqual([
      "2 s",
      "4.3 mm",
    ]);
  });

  it("drops trailing zeros", () => {
    expect(values({ f_number: 8 })).toEqual(["f/8"]);
    expect(values({ f_number: 0.95 })).toEqual(["f/0.95"]);
    expect(values({ focal_length_mm: 50.0 })).toEqual(["50 mm"]);
  });

  it("is null when nothing is known", () => {
    expect(exposureSpecs(null)).toBeNull();
    expect(exposureSpecs({ lens: "35mm F1.4" })).toBeNull();
  });
});

describe("splitTaken", () => {
  it("sets the time apart from the date", () => {
    expect(splitTaken("2023/12/16 23:12")).toEqual({
      date: "2023/12/16",
      time: "23:12",
    });
    expect(splitTaken("2023/12")).toEqual({ date: "2023/12", time: null });
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

describe("placeOf", () => {
  it("links a public location to the map on the photo", () => {
    expect(
      placeOf("abcdefghjk", {
        latitude: 35.68,
        longitude: 139.77,
        precision: "city",
      }),
    ).toEqual({
      label: placeLabel(35.68, 139.77, "city"),
      href: "/map/?photo=abcdefghjk",
    });
    expect(placeOf("abcdefghjk", null)).toBeNull();
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
      digitizer: null,
      digitized: null,
      body: "Canon EOS R5",
      lens: "RF35mm F1.8",
      exposure: [{ label: "絞り", value: "f/1.8" }],
      world: { name: "Home", href: "https://vrchat.com/home/world/wrld_x" },
      location: null,
      tags: ["VRChat", "night"],
      tagFields: [],
      file: "/2023/a.png",
    });
  });

  it("shows the スキャン機材 and スキャン日時 when the API gives them", () => {
    const i = info({
      camera: { slug: "fm2", name: "FM2", manufacturer: "Nikon", model: "FM2" },
      digitizer: {
        slug: "gcmc-scanner",
        name: "Scanner",
        manufacturer: "GCMC",
        model: "Scanner",
      },
      digitized_at: "2021-01-01T00:31:12+09:00",
      digitized_at_precision: "date",
    });
    expect(i.camera?.href).toBe("/camera/fm2/");
    expect(i.digitizer).toEqual({
      label: "Scanner",
      href: "/camera/gcmc-scanner/",
    });
    expect(i.digitized?.text).toBe("2021/01/01");
    expect(info({ digitizerMaker: "GCMC" }).digitizer).toEqual({
      label: "GCMC",
      href: null,
    });
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
    // The place as rounded to its level, on the map.
    expect(i.location).toEqual({
      label: placeLabel(35.7, 139.8, "prefecture"),
      href: "/map/?photo=abcdefghjk",
    });
  });

  it("takes the time in the photo's own offset", () => {
    expect(
      info({ timestamp: "2023-12-02T00:00:00Z", timestamp_precision: "second" })
        .taken?.text,
    ).toBe("2023/12/02 00:00");
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
