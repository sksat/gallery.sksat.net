import { describe, expect, it } from "vitest";
import {
  applyInfo,
  editTags,
  infoChanged,
  infoProblem,
  KEEP,
  markManual,
  nextTagState,
  shared,
  sourcePatch,
  tagChanges,
  tagCounts,
  takenAtFor,
  validateInfoEdit,
  validateInfoRestore,
  type InfoRow,
  type TakenAtEdit,
} from "./bulk-info";

const row = (over: Partial<InfoRow> = {}): InfoRow => ({
  id: 1,
  tags: '["night","film"]',
  timestamp: "2023-12-01T10:20:30+09:00",
  metadata_visibility: null,
  world_id: "wrld_a",
  world_name: "A",
  world_author_id: "usr_x",
  latitude: 35,
  longitude: 139,
  location_source: "exif",
  exif: '{"lens":"50mm","iso":100}',
  metadata_source: '{"taken_at":"exif","exif":"file","world":"file"}',
  ...over,
});

describe("validateInfoEdit", () => {
  it("normalises tags and checks values with the edit page's validators", () => {
    expect(
      validateInfoEdit({ tagsAdd: [" a ", "a", ""], exif: { iso: "200" } }),
    ).toEqual({ ok: true, value: { tagsAdd: ["a"], exif: { iso: 200 } } });
    expect(validateInfoEdit({ world: { id: "nope" } }).ok).toBe(false);
    expect(
      validateInfoEdit({ location: { latitude: "95", longitude: "0" } }).ok,
    ).toBe(false);
    expect(
      validateInfoEdit({ takenAt: { date: "2023-02-30", time: null } }).ok,
    ).toBe(false);
    expect(
      validateInfoEdit({ takenAt: { date: "2023-02-28", time: "25:00" } }).ok,
    ).toBe(false);
    expect(validateInfoEdit({}).ok).toBe(false);
    expect(validateInfoEdit({ colour: 1 }).ok).toBe(false);
  });
});

describe("editTags", () => {
  it("adds in order, removes, never duplicates", () => {
    expect(editTags(["a", "b"], ["c", "a"], ["b"])).toEqual(["a", "c"]);
  });
});

describe("takenAtFor", () => {
  const at = (cur: string | null, e: Partial<TakenAtEdit>) =>
    takenAtFor(cur, { date: KEEP, time: KEEP, offset: KEEP, ...e })
      ?.timestamp ?? null;

  it("keeps the photo's own offset, or uses the one chosen", () => {
    const edit = { date: "2024-05-06", time: "07:08" };
    expect(at("2023-01-01T00:00:00Z", edit)).toBe("2024-05-06T07:08:00Z");
    expect(at("2023-01-01T00:00:00+0530", edit)).toBe(
      "2024-05-06T07:08:00+05:30",
    );
    expect(at(null, edit)).toBe("2024-05-06T07:08:00+09:00");
    expect(at("2023-01-01T00:00:00Z", { ...edit, offset: "-05:00" })).toBe(
      "2024-05-06T07:08:00-05:00",
    );
  });

  it("keeps each photo's own date or time when not given", () => {
    expect(at("2023-01-01T10:20:30.5+09:00", { date: "1999-08-01" })).toBe(
      "1999-08-01T10:20:30+09:00",
    );
    expect(at("2023-01-01T10:20:30+09:00", { time: "07:00" })).toBe(
      "2023-01-01T07:00:00+09:00",
    );
    // No time yet: a time alone has no date to go with.
    expect(at(null, { time: "07:00" })).toBeNull();
    expect(
      takenAtFor(null, { date: "1999-08-01", time: KEEP, offset: KEEP }),
    ).toEqual({ timestamp: "1999-08-01T00:00:00+09:00", withTime: false });
  });
});

describe("tag states", () => {
  it("cycles some → all → none → some, and all → none → all", () => {
    expect(nextTagState("some", "some")).toBe("all");
    expect(nextTagState("all", "some")).toBe("none");
    expect(nextTagState("none", "some")).toBe("some");
    expect(nextTagState("none", "all")).toBe("all");
  });

  it("adds what became all and removes what became none", () => {
    expect(
      tagChanges([
        { tag: "a", initial: "some", now: "all" },
        { tag: "b", initial: "all", now: "none" },
        { tag: "c", initial: "some", now: "some" },
        { tag: "d", initial: "none", now: "all" },
      ]),
    ).toEqual({ tagsAdd: ["a", "d"], tagsRemove: ["b"] });
  });
});

describe("validateInfoRestore", () => {
  it("takes rows as setInfo returned them", () => {
    const r = row({ exif: '{"iso":100,"lens":"50mm"}' });
    expect(validateInfoRestore([r], 100)).toEqual({
      ok: true,
      rows: [{ ...r, exif: '{"lens":"50mm","iso":100}' }],
    });
  });

  it("refuses anything that is not a stored value", () => {
    const bad = [
      { world_id: "nope" },
      { latitude: 95 },
      { latitude: null },
      { location_source: "guess" },
      { timestamp: "yesterday" },
      { world_author_id: "x" },
      { id: 0 },
      { metadata_source: "not json" },
      { metadata_source: "[]" },
      { metadata_source: '{"exif":1}' },
      { metadata_source: undefined },
    ];
    for (const b of bad) {
      expect(validateInfoRestore([{ ...row(), ...b }], 100).ok).toBe(false);
    }
    expect(validateInfoRestore([row(), row()], 1).ok).toBe(false);
  });

  it("takes metadata_source as stored, or null", () => {
    const odd = '{"digitized_with":"manual","taken_at":"filename"}';
    for (const s of [odd, null]) {
      const r = validateInfoRestore([row({ metadata_source: s })], 100);
      expect(r.ok && r.rows[0].metadata_source).toBe(s);
    }
    expect(
      validateInfoRestore([row({ metadata_source: "x".repeat(1001) })], 100).ok,
    ).toBe(false);
  });

  it("keeps a position cleared by hand, and refuses one read from no file", () => {
    const cleared = row({ latitude: null, longitude: null, location_source: "manual" });
    const r = validateInfoRestore([cleared], 100);
    expect(r.ok && r.rows[0].location_source).toBe("manual");
    expect(
      validateInfoRestore(
        [row({ latitude: null, longitude: null, location_source: "exif" })],
        100,
      ).ok,
    ).toBe(false);
  });
});

describe("sourcePatch", () => {
  it("puts back the sheet's fields only, removing those that had none", () => {
    expect(JSON.parse(sourcePatch('{"taken_at":"exif","digitized_with":"manual"}'))).toEqual({
      taken_at: "exif",
      exif: null,
      world: null,
    });
    expect(JSON.parse(sourcePatch(null))).toEqual({
      taken_at: null,
      exif: null,
      world: null,
    });
  });
});

describe("markManual", () => {
  it("marks the fields, keeps every other key, and leaves nothing to mark alone", () => {
    expect(
      markManual('{"taken_at":"exif","digitized_with":"manual"}', [
        "taken_at",
        "world",
      ]),
    ).toBe('{"taken_at":"manual","digitized_with":"manual","world":"manual"}');
    expect(markManual(null, ["exif"])).toBe('{"exif":"manual"}');
    expect(markManual("garbage", ["exif"])).toBe('{"exif":"manual"}');
    expect(markManual('{"exif":"file"}', [])).toBe('{"exif":"file"}');
    expect(markManual(null, [])).toBeNull();
  });
});

describe("applyInfo", () => {
  it("changes only what the edit touches", () => {
    const after = applyInfo(row(), {
      tagsAdd: ["roll1"],
      tagsRemove: ["film"],
      exif: { lens: null, f_number: 2.8 },
    });
    expect(after.tags).toBe('["night","roll1"]');
    expect(JSON.parse(after.exif ?? "")).toEqual({ iso: 100, f_number: 2.8 });
    expect(after.timestamp).toBe(row().timestamp);
    expect(after.world_id).toBe("wrld_a");
  });

  it("a date alone shows the date only on the public site", () => {
    const after = applyInfo(row({ metadata_visibility: '{"camera":"hidden"}' }), {
      takenAt: { date: "1999-08-01", time: null, offset: "keep" },
    });
    expect(after.timestamp).toBe("1999-08-01T00:00:00+09:00");
    expect(JSON.parse(after.metadata_visibility ?? "")).toEqual({
      camera: "hidden",
      taken_at: "date",
    });
  });

  it("a new world drops the file's author; a moved position becomes manual", () => {
    const after = applyInfo(row(), {
      world: { id: "wrld_b" },
      location: { latitude: 1, longitude: 2 },
    });
    expect(after).toMatchObject({
      world_id: "wrld_b",
      world_name: "A",
      world_author_id: null,
      latitude: 1,
      longitude: 2,
      location_source: "manual",
    });
    const cleared = applyInfo(row(), { location: null });
    // Cleared by hand, as on the edit page: the reader must not refill it.
    expect(cleared).toMatchObject({
      latitude: null,
      longitude: null,
      location_source: "manual",
    });
  });

  it("a date alone sets the level even when the stored time stays", () => {
    const r = row({ timestamp: "1999-08-01T00:00:00+09:00" });
    const after = applyInfo(r, {
      takenAt: { date: "1999-08-01", time: null, offset: KEEP },
    });
    expect(after.timestamp).toBe(r.timestamp);
    expect(after.metadata_visibility).toBe('{"taken_at":"date"}');
    // A photo with no time yet keeps none: a date alone there too.
    const undated = applyInfo(row({ timestamp: null }), {
      takenAt: { date: "1999-08-01", time: KEEP, offset: KEEP },
    });
    expect(undated.metadata_visibility).toBe('{"taken_at":"date"}');
  });

  it("finds a photo that would have more tags than one may", () => {
    const many = JSON.stringify(Array.from({ length: 100 }, (_, i) => `t${i}`));
    expect(infoProblem(applyInfo(row({ tags: many }), { tagsRemove: ["t0"] })))
      .toBeNull();
    expect(
      infoProblem(applyInfo(row({ tags: many }), { tagsAdd: ["one more"] })),
    ).toMatch(/100/);
  });

  it("an edit that changes nothing is not a change (nothing to undo)", () => {
    const r = row();
    expect(infoChanged(r, applyInfo(r, { tagsAdd: ["night"] }))).toBe(false);
    expect(
      infoChanged(r, applyInfo(r, { location: { latitude: 35, longitude: 139 } })),
    ).toBe(false);
    expect(infoChanged(r, applyInfo(r, { tagsAdd: ["x"] }))).toBe(true);
  });

  it("marks each sourced field it changes as manual, and only those", () => {
    const src = (e: Parameters<typeof applyInfo>[1], r = row()) =>
      JSON.parse(applyInfo(r, e).metadata_source ?? "null");
    expect(
      src({ takenAt: { date: "1999-08-01", time: KEEP, offset: KEEP } }),
    ).toEqual({ taken_at: "manual", exif: "file", world: "file" });
    expect(src({ exif: { iso: 400 } })).toEqual({
      taken_at: "exif",
      exif: "manual",
      world: "file",
    });
    expect(src({ world: { name: "B" } })).toEqual({
      taken_at: "exif",
      exif: "file",
      world: "manual",
    });
    // Tags and the position have no entry; the same values change nothing.
    const r = row();
    for (const e of [
      { tagsAdd: ["x"] },
      { location: { latitude: 1, longitude: 2 } },
      { exif: { iso: 100 } },
      { world: { id: "wrld_a", name: "A" } },
    ]) {
      expect(applyInfo(r, e).metadata_source).toBe(r.metadata_source);
    }
    expect(
      src({ exif: { iso: 400 } }, row({ metadata_source: null })),
    ).toEqual({ exif: "manual" });
  });
});

describe("tagCounts / shared", () => {
  it("counts each tag over the selection", () => {
    expect(
      tagCounts([{ tags: ["a", "b"] }, { tags: ["a"] }, { tags: [] }]),
    ).toEqual([
      { tag: "a", count: 2, state: "some" },
      { tag: "b", count: 1, state: "some" },
    ]);
    expect(tagCounts([{ tags: ["a"] }])).toEqual([
      { tag: "a", count: 1, state: "all" },
    ]);
  });

  it("is the value all share, else undefined", () => {
    expect(shared(["x", "x"])).toBe("x");
    expect(shared([null, null])).toBeNull();
    expect(shared(["x", null])).toBeUndefined();
  });
});
