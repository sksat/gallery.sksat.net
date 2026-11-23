import { describe, expect, it } from "vitest";
import { cameraKind, deviceOf, normalizeDevice, slugFromModel } from "./device";

describe("normalizeDevice", () => {
  it("drops company words from the make and the make from the model", () => {
    expect(normalizeDevice("Canon", "Canon EOS R5")).toEqual({
      make: "Canon",
      model: "EOS R5",
    });
    expect(
      normalizeDevice("RICOH IMAGING COMPANY, LTD.", "RICOH GR III"),
    ).toEqual({ make: "RICOH", model: "GR III" });
    expect(normalizeDevice("NIKON CORPORATION", "NIKON Z 6_2")).toEqual({
      make: "NIKON",
      model: "Z 6_2",
    });
    expect(normalizeDevice("FUJI PHOTO FILM CO., LTD.", "SP-2000")).toEqual({
      make: "FUJI PHOTO FILM",
      model: "SP-2000",
    });
    expect(normalizeDevice(" FUJIFILM ", " X-T5 ")).toEqual({
      make: "FUJIFILM",
      model: "X-T5",
    });
    expect(normalizeDevice("Apple", "iPhone 15 Pro")).toEqual({
      make: "Apple",
      model: "iPhone 15 Pro",
    });
    // A model that is only the make stays.
    expect(normalizeDevice("GCMC", "GCMC")).toEqual({
      make: "GCMC",
      model: "GCMC",
    });
  });
});

describe("cameraKind", () => {
  it("tells the phones that EXIF names reliably", () => {
    expect(cameraKind("Apple", "iPhone 15 Pro")).toBe("phone");
    expect(cameraKind("Google", "Pixel 8")).toBe("phone");
    expect(cameraKind("samsung", "SM-S918B")).toBe("phone");
    expect(cameraKind("SAMSUNG", "NX500")).toBe("digital");
    expect(cameraKind("Sony", "XQ-DQ54")).toBe("phone");
    expect(cameraKind("SONY", "ILCE-7M4")).toBe("digital");
    expect(cameraKind("Xiaomi", "2201123G")).toBe("phone");
    expect(cameraKind("FUJIFILM", "X-T5")).toBe("digital");
    expect(cameraKind("Canon", "Canon EOS R5")).toBe("digital");
  });
});

describe("deviceOf", () => {
  it("is the scanner of a scanner's file, the camera of any other", () => {
    expect(
      deviceOf(
        { exif: null, fileExif: { make: "GCMC", model: "Scanner" } },
        "Real",
      ),
    ).toMatchObject({ role: "digitizer", kind: "scanner", create: true });
    const x = { make: "FUJIFILM", model: "X-T5" };
    expect(deviceOf({ exif: x, fileExif: x }, "Real")).toMatchObject({
      role: "camera",
      make: "FUJIFILM",
      model: "X-T5",
      kind: "digital",
      create: true,
    });
    // VRChat: only an existing row (its camera is a virtual one).
    expect(deviceOf({ exif: x, fileExif: x }, "VRChat")).toMatchObject({
      role: "camera",
      create: false,
    });
    // Any virtual platform the caller names (the reader reads them).
    const virtual = new Set(["VRChat", "Neos-VR"]);
    expect(
      deviceOf({ exif: x, fileExif: x }, "Neos-VR", virtual),
    ).toMatchObject({ create: false });
    expect(deviceOf({ exif: x, fileExif: x }, "Real", virtual)).toMatchObject({
      create: true,
    });
    expect(deviceOf({ exif: { make: "FUJIFILM" } }, "Real")).toBeNull();
    expect(
      deviceOf({ exif: null, fileExif: { make: "GCMC" } }, "Real"),
    ).toBeNull();
    expect(deviceOf({}, "Real")).toBeNull();
  });

  it("makes a slug from the model", () => {
    expect(slugFromModel("Nikon SUPER COOLSCAN 5000 ED")).toBe(
      "nikon-super-coolscan-5000-ed",
    );
    expect(slugFromModel("—")).toBe("camera");
  });
});
