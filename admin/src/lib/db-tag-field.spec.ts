import { describe, expect, it } from "vitest";
import { getMedia, updateMedia } from "./db";
import {
  addTagField,
  countTagValues,
  editTagField,
  fieldsOfTags,
  listTagFields,
  moveTagField,
  removeTagField,
  resolveTagValuePatch,
  restoreTagField,
  restoreTagValues,
  setTagValues,
} from "./db-tag-field";
import { CONTENT_VERSION_KEY } from "./last-good";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

const setup = () => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO media (id, file, platform, tags) VALUES
      (1, '/a.jpg', 'Real', '["フィルム"]'),
      (2, '/b.jpg', 'Real', '["フィルム", "旅行"]'),
      (3, '/c.jpg', 'Real', '[]'),
      (4, '/d.jpg', 'Real', '["フィルム"]');
    UPDATE media SET trashed_at = '2026-01-01T00:00:00Z' WHERE id = 4;
  `);
  return { raw, db: sqliteD1(raw) };
};

const values = (raw: ReturnType<typeof setup>["raw"]) =>
  raw
    .prepare(
      "SELECT id, tag_values AS v, tag_value_visibility AS l FROM media ORDER BY id",
    )
    .all();

const film = async (db: D1Database) => {
  const brand = await addTagField(db, "フィルム", {
    label: "銘柄",
    type: "select",
    options: ["Portra 400", "HP5"],
  });
  const iso = await addTagField(db, "フィルム", {
    label: "ISO",
    type: "number",
    options: null,
  });
  if (!brand.ok || !iso.ok) throw new Error("setup");
  return { brand: brand.value, iso: iso.value };
};

describe("tag fields", () => {
  it("adds fields in order, creating a private tag row", async () => {
    const { raw, db } = setup();
    const { brand, iso } = await film(db);
    expect(brand).toMatchObject({
      tag: "フィルム",
      label: "銘柄",
      type: "select",
      options: ["Portra 400", "HP5"],
      visibility: "shown",
      position: 0,
    });
    expect(iso.position).toBe(1);
    expect(raw.prepare("SELECT name, public FROM tag").all()).toEqual([
      { name: "フィルム", public: 0 },
    ]);
    expect((await fieldsOfTags(db, ["旅行"])).length).toBe(0);
    expect((await listTagFields(db)).map((f) => f.label)).toEqual([
      "銘柄",
      "ISO",
    ]);
  });

  it("refuses a label the tag already has", async () => {
    const { db } = setup();
    await film(db);
    expect(
      await addTagField(db, "フィルム", {
        label: "ISO",
        type: "text",
        options: null,
      }),
    ).toEqual({ ok: false, error: "『ISO』はもうあります" });
    // Another tag may use it.
    expect(
      (
        await addTagField(db, "旅行", {
          label: "ISO",
          type: "text",
          options: null,
        })
      ).ok,
    ).toBe(true);
  });

  it("renames, edits options and levels, returning the old values", async () => {
    const { db } = setup();
    const { brand } = await film(db);
    const r = await editTagField(db, brand.id, {
      label: "フィルム銘柄",
      options: ["Portra 400", "HP5", "Tri-X"],
      visibility: "hidden",
    });
    expect(r.ok && r.value.before).toEqual({
      label: "銘柄",
      options: ["Portra 400", "HP5"],
      visibility: "shown",
    });
    expect(r.ok && r.value.field).toMatchObject({
      label: "フィルム銘柄",
      options: ["Portra 400", "HP5", "Tri-X"],
      visibility: "hidden",
    });
  });

  it("reorders", async () => {
    const { db } = setup();
    const { iso } = await film(db);
    expect(await moveTagField(db, iso.id, -1)).toBe(true);
    expect((await listTagFields(db)).map((f) => f.label)).toEqual([
      "ISO",
      "銘柄",
    ]);
    expect(await moveTagField(db, iso.id, -1)).toBe(false);
  });
});

describe("values", () => {
  it("checks a photo's change against its fields and stores it", async () => {
    const { raw, db } = setup();
    const { brand, iso } = await film(db);
    expect(
      await resolveTagValuePatch(db, { [brand.id]: "Tri-X" }, undefined),
    ).toEqual({ ok: false, error: "銘柄は選択肢から選んでください" });
    expect(await resolveTagValuePatch(db, { 999: "x" }, undefined)).toEqual({
      ok: false,
      error: "削除された項目があります。ページを読み込み直してください",
    });
    const r = await resolveTagValuePatch(
      db,
      { [brand.id]: "HP5", [iso.id]: "４００" },
      { [iso.id]: "hidden" },
    );
    expect(r).toEqual({
      ok: true,
      values: { [brand.id]: "HP5", [iso.id]: 400 },
      levels: { [iso.id]: "hidden" },
    });
    if (!r.ok) return;
    await updateMedia(db, 1, {
      tag_values: r.values,
      tag_value_visibility: r.levels,
    });
    expect((await getMedia(db, 1))?.tag_values).toEqual({
      [brand.id]: "HP5",
      [iso.id]: 400,
    });
    // Clearing one keeps the other; clearing all leaves NULL.
    await updateMedia(db, 1, {
      tag_values: { [brand.id]: null },
      tag_value_visibility: { [iso.id]: null },
    });
    expect(values(raw)[0]).toEqual({
      id: 1,
      v: JSON.stringify({ [iso.id]: 400 }),
      l: null,
    });
    await updateMedia(db, 1, { tag_values: { [iso.id]: null } });
    expect(values(raw)[0]).toEqual({ id: 1, v: null, l: null });
  });

  it("sets in bulk only on photos with the tag, and undoes", async () => {
    const { raw, db } = setup();
    const { brand, iso } = await film(db);
    await updateMedia(db, 2, { tag_values: { [iso.id]: 100 } });
    const r = await setTagValues(db, [1, 2, 3], {
      [brand.id]: "Portra 400",
      [iso.id]: "400",
    });
    expect(r.ok && r.value).toEqual([
      [1, { [brand.id]: null, [iso.id]: null }],
      [2, { [brand.id]: null, [iso.id]: 100 }],
    ]);
    expect(values(raw).map((r) => r.v)).toEqual([
      JSON.stringify({ [brand.id]: "Portra 400", [iso.id]: 400 }),
      // (It had ISO first; JS would sort integer keys.)
      `{"${iso.id}":400,"${brand.id}":"Portra 400"}`,
      null,
      null,
    ]);
    // Nothing to change: no undo either.
    const again = await setTagValues(db, [1], { [iso.id]: 400 });
    expect(again.ok && again.value).toEqual([]);
    if (r.ok) await restoreTagValues(db, r.value);
    expect(values(raw).map((r) => r.v)).toEqual([
      null,
      JSON.stringify({ [iso.id]: 100 }),
      null,
      null,
    ]);
    expect((await setTagValues(db, [1], { [brand.id]: "nope" })).ok).toBe(
      false,
    );
  });

  it("restores only what fits the field", async () => {
    const { raw, db } = setup();
    const { iso } = await film(db);
    await restoreTagValues(db, [[1, { [iso.id]: "not a number" }]]);
    expect(values(raw)[0].v).toBeNull();
    await restoreTagValues(db, [[1, { [iso.id]: 200 }]]);
    expect(values(raw)[0].v).toBe(JSON.stringify({ [iso.id]: 200 }));
  });
});

describe("the API's content version", () => {
  it("changes with every write (fields, values and their undos)", async () => {
    const { raw, db } = setup();
    const version = () =>
      (
        raw
          .prepare("SELECT value FROM setting WHERE key = ?")
          .get(CONTENT_VERSION_KEY) as { value: string } | undefined
      )?.value;
    const seen = new Set<string | undefined>([version()]);
    const bumped = async (label: string, write: () => Promise<unknown>) => {
      await write();
      const v = version();
      expect(seen.has(v), label).toBe(false);
      seen.add(v);
    };
    const { brand, iso } = await film(db);
    await bumped("add", () =>
      addTagField(db, "フィルム", {
        label: "ラボ",
        type: "text",
        options: null,
      }),
    );
    await bumped("rename", () => editTagField(db, iso.id, { label: "感度" }));
    await bumped("no change", () => editTagField(db, iso.id, {}));
    await bumped("level", () =>
      editTagField(db, iso.id, { visibility: "hidden" }),
    );
    await bumped("move", () => moveTagField(db, iso.id, -1));
    let previous: Awaited<ReturnType<typeof setTagValues>> | null = null;
    await bumped("bulk", async () => {
      previous = await setTagValues(db, [1], { [brand.id]: "HP5" });
    });
    await bumped("bulk undo", () =>
      restoreTagValues(db, previous?.ok ? previous.value : []),
    );
    let removed: Awaited<ReturnType<typeof removeTagField>> = null;
    await bumped("remove", async () => {
      removed = await removeTagField(db, iso.id);
    });
    await bumped("remove undo", () => restoreTagField(db, removed!));
  });
});

describe("removing a field", () => {
  it("takes its values off every photo and puts them back on undo", async () => {
    const { raw, db } = setup();
    const { brand, iso } = await film(db);
    await updateMedia(db, 1, {
      tag_values: { [brand.id]: "HP5", [iso.id]: 400 },
      tag_value_visibility: { [iso.id]: "hidden" },
    });
    await updateMedia(db, 4, { tag_values: { [iso.id]: 800 } });
    // The trashed photo 4 is not counted.
    expect(await countTagValues(db)).toEqual({
      [brand.id]: 1,
      [iso.id]: 1,
    });
    const removed = await removeTagField(db, iso.id);
    expect(removed?.values).toEqual([
      [1, 400, "hidden"],
      [4, 800, null],
    ]);
    expect(values(raw).map((r) => [r.v, r.l])).toEqual([
      [JSON.stringify({ [brand.id]: "HP5" }), null],
      [null, null],
      [null, null],
      [null, null],
    ]);
    expect((await listTagFields(db)).map((f) => f.label)).toEqual(["銘柄"]);

    expect(await restoreTagField(db, removed!)).toEqual({ ok: true });
    expect((await listTagFields(db)).map((f) => [f.id, f.label])).toEqual([
      [brand.id, "銘柄"],
      [iso.id, "ISO"],
    ]);
    expect((await getMedia(db, 1))?.tag_values).toEqual({
      [brand.id]: "HP5",
      [iso.id]: 400,
    });
    expect((await getMedia(db, 1))?.tag_value_visibility).toEqual({
      [iso.id]: "hidden",
    });
    expect((await getMedia(db, 4))?.tag_values).toEqual({ [iso.id]: 800 });
  });

  it("restores only a free id that was given out, with checked values", async () => {
    const { raw, db } = setup();
    const { brand, iso } = await film(db);
    const removed = await removeTagField(db, iso.id);
    // An id never given out, or one in use, is refused.
    expect(
      await restoreTagField(db, {
        ...removed!,
        field: { ...removed!.field, id: 99 },
      }),
    ).toEqual({ ok: false, error: "この項目は戻せません" });
    expect(
      await restoreTagField(db, {
        ...removed!,
        field: { ...removed!.field, id: brand.id },
      }),
    ).toEqual({ ok: false, error: "この項目は戻せません" });
    // Values that do not fit are left out; the tag gets its row back.
    raw.exec("DELETE FROM tag WHERE name = 'フィルム'");
    expect(
      await restoreTagField(db, {
        field: { ...removed!.field, tag: "フィルム" },
        values: [
          [1, "not a number" as unknown as number, null],
          [2, 200, "hidden"],
        ],
      }),
    ).toEqual({ ok: true });
    expect(values(raw).map((r) => [r.v, r.l])).toEqual([
      [null, null],
      [
        JSON.stringify({ [iso.id]: 200 }),
        JSON.stringify({ [iso.id]: "hidden" }),
      ],
      [null, null],
      [null, null],
    ]);
    expect((await listTagFields(db)).map((f) => f.label)).toEqual(["ISO"]);
  });

  it("never gives a removed field's id to a new one", async () => {
    const { db } = setup();
    const { iso } = await film(db);
    await removeTagField(db, iso.id);
    const next = await addTagField(db, "フィルム", {
      label: "ISO",
      type: "number",
      options: null,
    });
    expect(next.ok && next.value.id).toBeGreaterThan(iso.id);
  });
});
