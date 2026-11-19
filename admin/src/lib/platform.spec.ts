import { describe, expect, it } from "vitest";
import {
  BUILTIN_PLATFORMS,
  hasRealPlace,
  isBuiltinPlatform,
  isPlatformKey,
  platformKeyFor,
  platformOf,
  validatePlatformName,
} from "./platform";

describe("validatePlatformName", () => {
  it("trims and folds spaces", () => {
    expect(validatePlatformName("  Neos   VR ")).toEqual({
      ok: true,
      name: "Neos VR",
    });
  });

  it("refuses empty, too long and non-strings", () => {
    expect(validatePlatformName("   ").ok).toBe(false);
    expect(validatePlatformName("x".repeat(41)).ok).toBe(false);
    expect(validatePlatformName("x".repeat(40)).ok).toBe(true);
    expect(validatePlatformName(undefined).ok).toBe(false);
  });
});

describe("platformKeyFor", () => {
  it("keeps letters and digits, other runs as -", () => {
    expect(platformKeyFor("Neos VR", [])).toBe("Neos-VR");
    expect(platformKeyFor("Resonite", [])).toBe("Resonite");
    expect(platformKeyFor(" cluster (β) ", [])).toBe("cluster");
    expect(platformKeyFor("Résonite", [])).toBe("Resonite");
  });

  it("falls back for names without ASCII letters", () => {
    expect(platformKeyFor("バーチャル", [])).toBe("platform");
  });

  it("numbers past keys taken, case aside", () => {
    expect(platformKeyFor("vrchat", ["Real", "VRChat"])).toBe("vrchat-2");
    expect(platformKeyFor("Neos VR", ["Neos-VR", "neos-vr-2"])).toBe(
      "Neos-VR-3",
    );
  });

  it("makes keys the table accepts", () => {
    for (const name of ["Neos VR", "x".repeat(40), "-a-", "バーチャル"]) {
      expect(isPlatformKey(platformKeyFor(name, []))).toBe(true);
    }
  });
});

describe("isPlatformKey", () => {
  it("takes the shape the table's CHECK allows", () => {
    expect(isPlatformKey("VRChat")).toBe(true);
    expect(isPlatformKey("Neos-VR_2")).toBe(true);
    expect(isPlatformKey("-x")).toBe(false);
    expect(isPlatformKey("Neos VR")).toBe(false);
    expect(isPlatformKey("x".repeat(33))).toBe(false);
    expect(isPlatformKey(null)).toBe(false);
  });
});

describe("platformOf and kinds", () => {
  const list = [
    ...BUILTIN_PLATFORMS,
    { key: "Neos-VR", name: "Neos VR", kind: "virtual" as const },
  ];

  it("finds a platform by key", () => {
    expect(platformOf(list, "Neos-VR").name).toBe("Neos VR");
  });

  it("shows a key missing from the list as itself", () => {
    expect(platformOf([], "VRChat").kind).toBe("virtual");
    expect(platformOf([], "Mars")).toEqual({
      key: "Mars",
      name: "Mars",
      kind: "real",
    });
  });

  it("gives only real platforms a real place", () => {
    expect(hasRealPlace(platformOf(list, "Real").kind)).toBe(true);
    expect(hasRealPlace(platformOf(list, "VRChat").kind)).toBe(false);
    expect(hasRealPlace(platformOf(list, "Neos-VR").kind)).toBe(false);
  });

  it("keeps the built-in ones", () => {
    expect(isBuiltinPlatform("Real")).toBe(true);
    expect(isBuiltinPlatform("VRChat")).toBe(true);
    expect(isBuiltinPlatform("Neos-VR")).toBe(false);
  });
});
