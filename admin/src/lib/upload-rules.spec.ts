import { describe, expect, it } from "vitest";
import {
  actionLabels,
  appliedChips,
  applyScope,
  applyUploadRules,
  conditionLabels,
  DEFAULT_UPLOAD_RULES,
  existingChange,
  FALLBACK_PLATFORM,
  globToRegExp,
  matchesConditions,
  parseStoredRules,
  validateRule,
  validateRules,
  VRCHAT_NAME_RE,
  type RuleFacts,
  type UploadRule,
} from "./upload-rules";
import type { MediaPlatform } from "./types";

const facts = (path: string, more: Partial<RuleFacts> = {}): RuleFacts => ({
  path,
  hasWorld: false,
  exif: null,
  hasGps: false,
  ...more,
});

const rule = (
  id: string,
  conditions: UploadRule["conditions"],
  actions: UploadRule["actions"],
  enabled = true,
): UploadRule => ({ id, name: "", enabled, conditions, actions });

// The platform rule before upload rules existed (fix/vrchat-old-filenames).
const legacyGuessPlatform = (file: string): MediaPlatform =>
  file.startsWith("/VRChat/") ||
  VRCHAT_NAME_RE.test(file.slice(file.lastIndexOf("/") + 1))
    ? "VRChat"
    : "Real";

describe("DEFAULT_UPLOAD_RULES", () => {
  const files = [
    "/x/VRChat_2026-11-18_01-02-03.456_3840x2160.png",
    "/x/VRChat_3840x2160_2022-08-22_02-03-18.591.png",
    "/VRChat_2026-11-18_01-02-03.456_3840x2160.png",
    "/x/VRChat_2026-11-18_01-02-03.456_3840x2160.jpg",
    "/x/vrchat_2026-11-18_01-02-03.456_3840x2160.png",
    "/x/IMG_1.jpg",
    "/VRChat/IMG_1.jpg",
    "/VRChat/2026-11/edited.png",
    "/Trip/VRChat/IMG_1.jpg",
    "/VRChatX/IMG_1.jpg",
    "/VRChat.png",
    "/a.png",
  ];
  it.each(files)("decide the platform as before for %s", (file) => {
    const d = applyUploadRules(DEFAULT_UPLOAD_RULES, facts(file));
    expect(d.platform?.value ?? FALLBACK_PLATFORM).toBe(
      legacyGuessPlatform(file),
    );
  });

  it("are what an absent setting means, and validate", () => {
    expect(parseStoredRules(null)).toEqual(DEFAULT_UPLOAD_RULES);
    expect(validateRules(DEFAULT_UPLOAD_RULES)).toEqual({
      ok: true,
      value: DEFAULT_UPLOAD_RULES,
    });
  });
});

describe("matchesConditions", () => {
  it("needs every condition and at least one", () => {
    expect(matchesConditions({}, facts("/a.png"))).toBe(false);
    const c = { folder: "/VRChat", ext: "png" as const };
    expect(matchesConditions(c, facts("/VRChat/a.png"))).toBe(true);
    expect(matchesConditions(c, facts("/VRChat/a.jpg"))).toBe(false);
    expect(matchesConditions(c, facts("/Other/a.png"))).toBe(false);
  });

  it("matches folders with their subfolders only", () => {
    const c = { folder: "/VRChat/2026" };
    expect(matchesConditions(c, facts("/VRChat/2026/a.png"))).toBe(true);
    expect(matchesConditions(c, facts("/VRChat/2026/11/a.png"))).toBe(true);
    expect(matchesConditions(c, facts("/VRChat/2026-11/a.png"))).toBe(false);
  });

  it("globs file names in any case", () => {
    expect(globToRegExp("IMG_*.jpg").test("img_0001.JPG")).toBe(true);
    expect(globToRegExp("a?.png").test("ab.png")).toBe(true);
    expect(globToRegExp("a?.png").test("abc.png")).toBe(false);
    // Regex characters are literal.
    expect(globToRegExp("a.(1).png").test("a.(1).png")).toBe(true);
    expect(globToRegExp("a.png").test("aXpng")).toBe(false);
    const c = { name: { glob: "DSCF*" } };
    expect(matchesConditions(c, facts("/DSCF/x.jpg"))).toBe(false);
    expect(matchesConditions(c, facts("/x/DSCF0001.JPG"))).toBe(true);
  });

  it("treats .jpeg as jpg", () => {
    expect(matchesConditions({ ext: "jpg" }, facts("/a.JPEG"))).toBe(true);
  });

  it("reads the file's own data, case-insensitively", () => {
    const f = facts("/a.jpg", {
      creatorTool: "VRChat",
      hasWorld: true,
      hasGps: true,
      exif: { make: "FUJIFILM", model: "X-T5" },
    });
    expect(matchesConditions({ creatorTool: "vrchat" }, f)).toBe(true);
    expect(matchesConditions({ world: true }, f)).toBe(true);
    expect(matchesConditions({ world: false }, f)).toBe(false);
    expect(matchesConditions({ camera: "x-t5" }, f)).toBe(true);
    expect(matchesConditions({ camera: "fujifilm x-t5" }, f)).toBe(true);
    expect(matchesConditions({ camera: "Sony" }, f)).toBe(false);
    expect(matchesConditions({ gps: true }, f)).toBe(true);
  });

  it("does not match on what is unknown", () => {
    // Metadata not read yet: neither "with" nor "without" a world or GPS.
    const unread = facts("/a.png", { hasWorld: undefined, hasGps: undefined });
    expect(matchesConditions({ world: false }, unread)).toBe(false);
    expect(matchesConditions({ gps: false }, unread)).toBe(false);
    const f = facts("/a.png");
    expect(matchesConditions({ creatorTool: "VRChat" }, f)).toBe(false);
    expect(matchesConditions({ orientation: "landscape" }, f)).toBe(false);
  });

  it("tells the orientation as the photo is shown", () => {
    const d = { width: 4000, height: 3000 };
    const c = (o: "landscape" | "portrait" | "square") => ({ orientation: o });
    expect(
      matchesConditions(c("landscape"), facts("/a", { dimensions: d })),
    ).toBe(true);
    // EXIF orientation 6: turned a quarter.
    const turned = facts("/a", { dimensions: d, exif: { orientation: 6 } });
    expect(matchesConditions(c("portrait"), turned)).toBe(true);
    const sq = facts("/a", { dimensions: { width: 8, height: 8 } });
    expect(matchesConditions(c("square"), sq)).toBe(true);
  });
});

describe("applyUploadRules", () => {
  const rules = [
    rule("a", { folder: "/VRChat" }, { platform: "VRChat", tags: ["vr"] }),
    rule(
      "b",
      { name: { preset: "vrchat" } },
      {
        platform: "Real",
        cameraId: 3,
        tags: ["vr", "shot"],
        metadata: { location: "hidden" },
      },
    ),
    rule(
      "c",
      { ext: "png" },
      {
        cameraId: 4,
        visibility: "unlisted",
        metadata: { location: "city", world: "name" },
      },
    ),
    rule("off", { ext: "png" }, { visibility: "public" }, false),
  ];
  const name = "/VRChat/VRChat_2026-11-18_01-02-03.456_3840x2160.png";

  it("lets the first matching rule win per field and adds up tags", () => {
    const d = applyUploadRules(rules, facts(name));
    expect(d.platform).toEqual({ value: "VRChat", ruleId: "a" });
    expect(d.cameraId).toEqual({ value: 3, ruleId: "b" });
    expect(d.tags).toEqual([
      { value: "vr", ruleId: "a" },
      { value: "shot", ruleId: "b" },
    ]);
    expect(d.visibility).toEqual({ value: "unlisted", ruleId: "c" });
    expect(d.metadata).toEqual({
      location: { value: "hidden", ruleId: "b" },
      world: { value: "name", ruleId: "c" },
    });
  });

  it("skips disabled rules and decides nothing when none match", () => {
    const d = applyUploadRules(rules, facts("/a.jpg"));
    expect(d).toEqual({
      platform: null,
      cameraId: null,
      tags: [],
      visibility: null,
      metadata: {},
    });
  });

  it("is labelled for the upload panel", () => {
    const named = rules.map((r) =>
      r.id === "a" ? { ...r, name: "VR フォルダ" } : r,
    );
    const d = applyUploadRules(named, facts(name));
    const chips = appliedChips(d, named, new Map([[3, "VirtualLens2"]]));
    expect(chips).toContainEqual({
      field: "platform",
      value: "VRChat",
      rule: "VR フォルダ",
    });
    expect(chips).toContainEqual({
      field: "camera",
      value: "VirtualLens2",
      rule: "VRChat のファイル名",
    });
    expect(chips).toContainEqual({
      field: "visibility",
      value: "限定公開",
      rule: ".png",
    });
    expect(chips).toContainEqual({
      field: "metadata.location",
      value: "撮影場所: 出さない",
      rule: "VRChat のファイル名",
    });
  });
});

describe("validateRule", () => {
  const ok = rule("r1", { folder: "/VRChat" }, { platform: "VRChat" });

  it("accepts a rule and normalises its text", () => {
    const res = validateRule({
      ...ok,
      name: "  名前 ",
      conditions: {
        camera: " X-T5 ",
        name: { glob: " DSCF* " },
        folder: "VRChat/2026/",
      },
      actions: {
        tags: [" a ", "a", ""],
        metadata: { location: "", world: "name" },
      },
    });
    expect(res).toEqual({
      ok: true,
      value: {
        ...ok,
        name: "名前",
        conditions: {
          folder: "/VRChat/2026",
          name: { glob: "DSCF*" },
          camera: "X-T5",
        },
        actions: { tags: ["a"], metadata: { world: "name" } },
      },
    });
  });

  it.each([
    ["no condition", { ...ok, conditions: {} }],
    ["no action", { ...ok, actions: {} }],
    ["a bad folder", { ...ok, conditions: { folder: "VR Chat" } }],
    ["an empty folder", { ...ok, conditions: { folder: " / " } }],
    ["a bad preset", { ...ok, conditions: { name: { preset: "x" } } }],
    ["too many stars", { ...ok, conditions: { name: { glob: "*a*a*a*a*b" } } }],
    ["a bad level", { ...ok, actions: { metadata: { location: "street" } } }],
    ["a bad camera id", { ...ok, actions: { cameraId: 0 } }],
    ["a bad id", { ...ok, id: "a b" }],
    ["a bad visibility", { ...ok, actions: { visibility: "everyone" } }],
  ])("refuses %s", (_, v) => {
    expect(validateRule(v).ok).toBe(false);
  });

  it("refuses duplicate ids in a list", () => {
    expect(validateRules([ok, ok]).ok).toBe(false);
  });

  it("reads stored rules leniently", () => {
    expect(parseStoredRules("[]")).toEqual([]);
    expect(parseStoredRules("not json")).toEqual([]);
    expect(parseStoredRules(JSON.stringify([ok, { id: "bad" }]))).toEqual([ok]);
  });
});

describe("labels", () => {
  it("describe conditions and actions", () => {
    expect(
      conditionLabels({
        folder: "/VRChat",
        name: { preset: "vrchat" },
        gps: false,
      }),
    ).toEqual(["/VRChat/ フォルダ", "VRChat のファイル名", "位置情報なし"]);
    expect(
      actionLabels(
        { platform: "VRChat", cameraId: 9, tags: ["a"], visibility: "public" },
        new Map(),
      ),
    ).toEqual(["VRChat", "カメラ #9", "#a", "公開"]);
  });
});

describe("applyScope", () => {
  it("is every photo only when chosen", () => {
    expect(applyScope(true, "")).toEqual({ ok: true, folder: "/" });
    expect(applyScope(false, "/VRChat")).toEqual({
      ok: true,
      folder: "/VRChat",
    });
    expect(applyScope(false, " VRChat/2026/ ")).toEqual({
      ok: true,
      folder: "/VRChat/2026",
    });
  });

  it.each([
    "",
    "  ",
    "/",
    "//",
    ".",
    "..",
    "/.",
    "/..",
    "/a/../b",
    "a//b",
    "/a b",
  ])("refuses %j instead of falling back to every photo", (raw) => {
    expect(applyScope(false, raw).ok).toBe(false);
  });
});

describe("existingChange", () => {
  const photo = {
    id: 1,
    platform: "Real" as const,
    camera_id: null,
    tags: ["x"],
    metadata_visibility: {},
  };
  const decide = (r: UploadRule["actions"]) =>
    applyUploadRules([rule("r", { ext: "png" }, r)], facts("/a.png"));

  it("fills in what is empty or the fallback", () => {
    expect(
      existingChange(
        photo,
        decide({
          platform: "VRChat",
          cameraId: 2,
          tags: ["x", "y"],
          metadata: { location: "hidden" },
        }),
      ),
    ).toEqual({
      id: 1,
      platform: "VRChat",
      camera_id: 2,
      tags: ["x", "y"],
      metadata_visibility: { location: "hidden" },
      ruleIds: ["r"],
    });
  });

  it("keeps what may have been chosen by hand, and never touches visibility", () => {
    const set = {
      ...photo,
      platform: "VRChat" as const,
      camera_id: 5,
      metadata_visibility: { location: "exact" as const },
    };
    expect(
      existingChange(
        set,
        decide({
          platform: "Real",
          cameraId: 2,
          tags: ["x"],
          visibility: "public",
          metadata: { location: "hidden" },
        }),
      ),
    ).toBeNull();
  });
});
