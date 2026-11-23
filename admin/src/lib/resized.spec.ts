import { describe, expect, it, vi } from "vitest";
import {
  claimCopies,
  finishCopies,
  setResizeMaker,
  waitingSql,
} from "@shared/resized/claim";
import { planResized, type CardCaption } from "@shared/resized/resized";
import { purgeItems, trashItems } from "./db-ops";
import {
  checkResizedItems,
  CLAIM_STALE_MS,
  claimedSource,
  claimResized,
  countWaitingResized,
  failResized,
  FAILED_RETRY_MS,
  RESIZED_DATE,
  storeCard,
  storeResized,
  wantedCards,
  waitingArgs,
  type ResizedItem,
} from "./resized";
import { migratedSqlite, sqliteD1 } from "./sqlite-d1";

/** A fixed "now", after RESIZED_DATE. */
const NOW = Date.parse(RESIZED_DATE) + 24 * 3600 * 1000;

/** Four photos; the site makes the copies in the browser unless `worker`. */
const setup = async (maker: "worker" | "browser" = "browser") => {
  const raw = migratedSqlite();
  raw.exec(`
    INSERT INTO media (id, file, platform, visibility, public_id) VALUES
      (1, '/a/private.png', 'Real', 'private', '2222222222'),
      (2, '/a/public.png', 'Real', 'public', '3333333333'),
      (3, '/a/unlisted.png', 'Real', 'unlisted', '4444444444'),
      (4, '/a/public2.png', 'Real', 'public', '5555555555');
  `);
  const db = sqliteD1(raw);
  if (maker === "browser") await setResizeMaker(db, "browser");
  return { raw, db };
};

type Raw = ReturnType<typeof migratedSqlite>;

const stateOf = (raw: Raw, id: number) =>
  (
    raw.prepare("SELECT resized_at FROM media WHERE id = ?").get(id) as {
      resized_at: string | null;
    }
  ).resized_at;

const originalOf = (raw: Raw, id: number) =>
  (
    raw
      .prepare(
        "SELECT id FROM media_file WHERE media_id = ? AND role = 'original'",
      )
      .get(id) as { id: number }
  ).id;

/** A bucket in memory (put / delete / list). */
const bucket = () => {
  const objects = new Map<
    string,
    { bytes: Uint8Array; type?: string; meta?: Record<string, string> }
  >();
  return {
    objects,
    /** The keys under a photo's public id. */
    copies: (publicId: string) =>
      [...objects.keys()].filter((k) => k.startsWith(`img/${publicId}/`)),
    put: vi.fn(
      async (
        key: string,
        bytes: Uint8Array,
        opts?: {
          httpMetadata?: { contentType?: string };
          customMetadata?: Record<string, string>;
        },
      ) => {
        objects.set(key, {
          bytes,
          type: opts?.httpMetadata?.contentType,
          meta: opts?.customMetadata,
        });
        return null;
      },
    ),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const k of [keys].flat()) objects.delete(k);
    }),
    // Keys in order, the cursor being the index of the next.
    list: vi.fn(
      async ({
        prefix,
        limit = 1000,
        cursor,
      }: {
        prefix: string;
        limit?: number;
        cursor?: string;
      }) => {
        const keys = [...objects.keys()]
          .filter((k) => k.startsWith(prefix))
          .sort();
        const from = Number(cursor ?? 0);
        const page = keys
          .slice(from, from + limit)
          .map((key) => ({ key, customMetadata: objects.get(key)!.meta }));
        return from + limit < keys.length
          ? {
              objects: page,
              truncated: true as const,
              cursor: String(from + limit),
            }
          : { objects: page, truncated: false as const };
      },
    ),
  };
};

const WEBP = new Uint8Array([
  ...new TextEncoder().encode("RIFF"),
  4,
  0,
  0,
  0,
  ...new TextEncoder().encode("WEBP"),
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

/** A card as the browser would post it. */
const card = (
  preset: "og" | "og-site",
  caption?: CardCaption,
): ResizedItem => ({
  preset,
  width: 1200,
  height: 630,
  sameAs: null,
  type: "image/jpeg",
  bytes: JPEG,
  ...(caption ? { caption } : {}),
});

/** The copies of a `w` x `h` photo and its og-site card. */
const itemsFor = (w: number, h: number): ResizedItem[] => [
  ...planResized(w, h).map((p): ResizedItem => ({
    ...p,
    type: "image/webp",
    bytes: p.sameAs ? new Uint8Array() : WEBP,
  })),
  card("og-site"),
];

describe("the claim", () => {
  it("is the image Worker's by default, public photos first, a batch at a time", async () => {
    const { raw, db } = await setup("worker");
    const first = await claimCopies(db, {
      maker: "worker",
      limit: 2,
      nowMs: NOW,
    });
    expect(first.rows.map((r) => r.id).sort()).toEqual([2, 4]);
    expect(first.more).toBe(true);
    expect(stateOf(raw, 2)).toBe(first.claim);
    // The browser maker takes none of these.
    expect((await claimResized(db, { nowMs: NOW })).photos).toEqual([]);
    const second = await claimCopies(db, {
      maker: "worker",
      limit: 2,
      nowMs: NOW,
    });
    expect(second.rows.map((r) => r.id).sort()).toEqual([1, 3]);
  });

  it("leaves to the browser what Image Transformations cannot make", async () => {
    const { raw, db } = await setup("worker");
    const { claim } = await claimCopies(db, {
      maker: "worker",
      ids: [2],
      limit: 1,
      nowMs: NOW,
    });
    expect(await finishCopies(db, 2, claim, "browser", NOW)).toBe(true);
    expect(stateOf(raw, 2)).toMatch(/^browser:/);
    // Never the Worker's again, the browser's at once.
    expect(await countWaitingResized(db, NOW + FAILED_RETRY_MS * 9)).toBe(3);
    const { photos } = await claimResized(db, { nowMs: NOW });
    expect(photos.map((p) => p.id)).toEqual([2]);
  });

  it("is the browser's alone while the site makes them there", async () => {
    const { db } = await setup("browser");
    expect(
      (await claimCopies(db, { maker: "worker", limit: 5, nowMs: NOW })).rows,
    ).toEqual([]);
    const { photos, more } = await claimResized(db, { limit: 2, nowMs: NOW });
    expect(photos.map((p) => p.id).sort()).toEqual([2, 4]);
    expect(more).toBe(true);
    expect(photos[0]).toMatchObject({
      claim: `making:${new Date(NOW).toISOString()}`,
      source: { storage: "b2", role: "original" },
      caption: null,
    });
  });

  it("claims only the given photos when asked for them", async () => {
    const { db } = await setup();
    const got = await claimResized(db, { ids: [1, 99], nowMs: NOW });
    expect(got.photos.map((p) => p.id)).toEqual([1]);
    // Already claimed: not again.
    expect((await claimResized(db, { ids: [1], nowMs: NOW })).photos).toEqual(
      [],
    );
  });

  it("takes an abandoned claim and a day-old failure again, never a fresh one", async () => {
    const { raw, db } = await setup("worker");
    const { claim } = await claimCopies(db, {
      maker: "worker",
      ids: [1, 2],
      limit: 2,
      nowMs: NOW,
    });
    await finishCopies(db, 2, claim, "failed", NOW);
    expect(stateOf(raw, 2)).toMatch(/^failed:/);
    raw.exec(
      "UPDATE media SET resized_at = '2100-01-01T00:00:00.000Z' WHERE id IN (3, 4)",
    );
    expect(await countWaitingResized(db, NOW + 1000)).toBe(0);
    expect(await countWaitingResized(db, NOW + CLAIM_STALE_MS + 1)).toBe(1);
    expect(await countWaitingResized(db, NOW + FAILED_RETRY_MS + 1)).toBe(2);
  });

  it("leaves photos in the trash and unfinished uploads alone", async () => {
    const { raw, db } = await setup("worker");
    raw.exec("UPDATE media SET trashed_at = '2026-01-01' WHERE id = 1");
    raw.exec("UPDATE media SET status = 'uploading' WHERE id = 2");
    expect(await countWaitingResized(db, NOW)).toBe(2);
  });

  it("makes copies older than RESIZED_DATE again", async () => {
    const { raw, db } = await setup("worker");
    raw.exec("UPDATE media SET resized_at = '2026-01-01T00:00:00.000Z'");
    raw.exec(`UPDATE media SET resized_at = '${RESIZED_DATE}' WHERE id = 4`);
    expect(await countWaitingResized(db, NOW)).toBe(3);
  });

  it("reads the waiting photos through idx_media_resized_at", async () => {
    const { raw } = await setup();
    for (const [maker, setting] of [
      ["worker", "worker"],
      ["browser", "browser"],
      ["browser", "worker"],
    ] as const) {
      const sql = waitingSql(maker, setting)!;
      const plan = (
        raw
          .prepare(
            `EXPLAIN QUERY PLAN SELECT id FROM media WHERE ${sql} LIMIT 3`,
          )
          .all(...(sql.includes("?1") ? waitingArgs(NOW) : [])) as {
          detail: string;
        }[]
      ).map((p) => p.detail);
      expect(plan.join("\n")).toMatch(/idx_media_resized_at/);
      expect(plan.join("\n")).not.toMatch(/SCAN media|idx_media_status/);
    }
  });

  it("names the file a photo shows, or its display copy, as the source", async () => {
    const { raw, db } = await setup();
    raw.exec(`
      INSERT INTO media_file (id, media_id, role, object_key, status) VALUES
        (50, 2, 'edit', '/a/public_edit.jpg', 'ready');
      UPDATE media SET active_file_id = 50 WHERE id = 2;
    `);
    let { photos } = await claimResized(db, { ids: [2], nowMs: NOW });
    expect(photos[0].source).toEqual({
      id: 50,
      storage: "b2",
      key: "/a/public_edit.jpg",
      role: "edit",
    });
    raw.exec(`
      INSERT INTO media_file (id, media_id, role, object_key, source_file_id, status)
        VALUES (51, 2, 'display', '/a/public_edit_display.jpg', 50, 'ready');
    `);
    // The display copy put the photo back to waiting (a new source).
    expect(stateOf(raw, 2)).toBeNull();
    ({ photos } = await claimResized(db, { ids: [2], nowMs: NOW }));
    expect(photos[0].source.id).toBe(51);
  });

  it("is finished only while it holds", async () => {
    const { raw, db } = await setup();
    const [p] = (await claimResized(db, { ids: [2], nowMs: NOW })).photos;
    expect(await claimedSource(db, 2, p.claim)).toEqual(p.source);
    expect(await claimedSource(db, 2, "making:other")).toBeNull();
    expect(await failResized(db, 2, "making:other", NOW)).toBe(false);
    expect(await failResized(db, 2, p.claim, NOW)).toBe(true);
    expect(stateOf(raw, 2)).toMatch(/^failed:/);
  });
});

describe("the file to resize changing", () => {
  it("puts a photo back to waiting", async () => {
    const { raw } = await setup();
    raw.exec("UPDATE media SET resized_at = '2100-01-01T00:00:00.000Z'");
    raw.exec(`
      INSERT INTO media_file (id, media_id, role, object_key, status) VALUES
        (60, 1, 'edit', '/a/e.jpg', 'ready');
      INSERT INTO media_file (id, media_id, role, object_key, source_file_id, status)
        VALUES (61, 3, 'display', '/a/d.jpg', ${originalOf(raw, 3)}, 'uploading');
    `);
    // An edit added, or a display copy still uploading: nothing changes.
    expect([stateOf(raw, 1), stateOf(raw, 3)]).toEqual([
      "2100-01-01T00:00:00.000Z",
      "2100-01-01T00:00:00.000Z",
    ]);
    raw.exec("UPDATE media SET active_file_id = 60 WHERE id = 1");
    expect(stateOf(raw, 1)).toBeNull();
    raw.exec(
      "UPDATE media SET resized_at = '2100-01-01T00:00:00.000Z' WHERE id = 1",
    );
    // The same choice again: nothing.
    raw.exec("UPDATE media SET active_file_id = 60 WHERE id = 1");
    expect(stateOf(raw, 1)).toBe("2100-01-01T00:00:00.000Z");
    // A display copy that becomes ready, then fails, then goes.
    raw.exec("UPDATE media_file SET status = 'ready' WHERE id = 61");
    expect(stateOf(raw, 3)).toBeNull();
    raw.exec(
      "UPDATE media SET resized_at = '2100-01-01T00:00:00.000Z' WHERE id = 3",
    );
    raw.exec("UPDATE media_file SET size = 5 WHERE id = 61");
    expect(stateOf(raw, 3)).toBe("2100-01-01T00:00:00.000Z");
    raw.exec("DELETE FROM media_file WHERE id = 61");
    expect(stateOf(raw, 3)).toBeNull();
  });
});

describe("checkResizedItems", () => {
  const manifest = (items: ResizedItem[]) =>
    items.map(({ bytes: _, caption: __, ...rest }) => rest);
  const filesOf = (items: ResizedItem[]) =>
    new Map(
      items.filter((i) => i.bytes.length > 0).map((i) => [i.preset, i.bytes]),
    );

  it("takes every preset, aliases included", () => {
    const items = itemsFor(1920, 1080);
    expect(checkResizedItems(manifest(items), filesOf(items))).toEqual(items);
  });

  it("refuses a missing or repeated preset, a box overrun, a bad alias or image", () => {
    const items = itemsFor(7680, 4320);
    const check = (m: unknown, f = filesOf(items)) => checkResizedItems(m, f);
    expect(check(manifest(items).slice(1))).toBe("a preset is missing");
    expect(check([...manifest(items), manifest(items)[0]])).toBe("h240 twice");
    expect(check("x")).toBe("manifest must be an array");
    const big = manifest(items).map((i) =>
      i.preset === "h240" ? { ...i, height: 241 } : i,
    );
    expect(check(big)).toBe("h240: larger than its box");
    const alias = manifest(items).map((i) =>
      i.preset === "w3840" ? { ...i, sameAs: "w1920" } : i,
    );
    expect(check(alias)).toBe("w3840: not the size of w1920");
    const notWebp = new Map(filesOf(items));
    notWebp.set("w1200", new Uint8Array([0xff, 0xd8, 0xff, 0]));
    expect(check(manifest(items), notWebp)).toBe("w1200: not image/webp");
    const none = new Map(filesOf(items));
    none.delete("h480");
    expect(check(manifest(items), none)).toBe("h480: no image");
    expect(
      check(manifest(items).map((i) => ({ ...i, preset: "og-large" }))),
    ).toBe("unknown preset");
    expect(
      check(manifest(items).map((i) => ({ ...i, type: "image/png" }))),
    ).toBe("h240: bad type");
  });

  it("refuses an alias of an alias, and an alias with an image", () => {
    const items = itemsFor(1000, 500);
    const m = manifest(items).map((i) =>
      i.preset === "w3840" ? { ...i, sameAs: "w2560" } : i,
    );
    expect(checkResizedItems(m, filesOf(items))).toBe("w3840: bad sameAs");
    const f = filesOf(items);
    f.set("w3840", WEBP);
    expect(checkResizedItems(manifest(items), f)).toBe(
      "w3840: an alias has no image",
    );
  });

  it("takes an og card only with its caption, and needs og-site", () => {
    const caption = { primary: "2023-12-16 23:12 JST" };
    const items = [...itemsFor(800, 600), card("og")];
    const files = filesOf(items);
    expect(checkResizedItems(manifest(items), files, null)).toBe(
      "og: bad caption",
    );
    expect(
      checkResizedItems(manifest(items), files, { primary: "日本語" }),
    ).toBe("og: bad caption");
    const got = checkResizedItems(manifest(items), files, caption);
    expect(typeof got !== "string" && got.at(-1)?.caption).toEqual(caption);
    const noSite = manifest(items).filter((m) => m.preset !== "og-site");
    expect(checkResizedItems(noSite, files, caption)).toBe(
      "a preset is missing",
    );
    const wrong = manifest(items).map((m) =>
      m.preset === "og-site" ? { ...m, width: 1000 } : m,
    );
    expect(checkResizedItems(wrong, files, caption)).toBe(
      "og-site: not 1200x630",
    );
  });
});

describe("storeResized", () => {
  const CAPTION = { primary: "2023-12-16 23:12 JST", secondary: "#VRChat" };

  it("puts the objects, then marks the photo made", async () => {
    const { raw, db } = await setup();
    const b = bucket();
    const [p] = (await claimResized(db, { ids: [2], nowMs: NOW })).photos;
    await b.put("og-wanted/3333333333", new Uint8Array());
    expect(
      await storeResized(
        db,
        b,
        {
          id: 2,
          claim: p.claim,
          sourceFileId: p.source.id,
          items: [...itemsFor(1920, 1080), card("og", CAPTION)],
        },
        NOW,
      ),
    ).toEqual({ ok: true, stored: 8, removed: 0 });
    expect(stateOf(raw, 2)).toBe(new Date(NOW).toISOString());
    const key = (preset: string) => `img/3333333333/a/public.png/${preset}`;
    expect(b.copies("3333333333").sort()).toEqual(
      ["h240", "h480", "og", "og-site", "w1200", "w1920", "w2560", "w3840"]
        .map(key)
        .sort(),
    );
    expect(b.objects.get(key("w1920"))).toEqual({
      bytes: WEBP,
      type: "image/webp",
      meta: undefined,
    });
    expect(b.objects.get(key("w3840"))?.meta).toEqual({ "same-as": "w1920" });
    expect(b.objects.get(key("og"))?.meta).toEqual({
      caption: JSON.stringify(["2023-12-16 23:12 JST", "#VRChat"]),
    });
    // The Worker's request for its card is answered.
    expect(b.objects.has("og-wanted/3333333333")).toBe(false);
  });

  it("stores nothing for a lost claim, and leaves a newer claim's objects", async () => {
    const { raw, db } = await setup();
    const b = bucket();
    const [p] = (await claimResized(db, { ids: [2], nowMs: NOW })).photos;
    const items = itemsFor(800, 600);
    // Claimed again by another tab after it went stale.
    await claimResized(db, { ids: [2], nowMs: NOW + CLAIM_STALE_MS + 1 });
    expect(
      await storeResized(db, b, {
        id: 2,
        claim: p.claim,
        sourceFileId: p.source.id,
        items,
      }),
    ).toEqual({ ok: false });
    expect(b.put).not.toHaveBeenCalled();
    // Lost between the check and the mark, to a newer claim that stores
    // first under the same keys: its objects stay.
    const old = (await claimResized(db, { ids: [4], nowMs: NOW })).photos[0];
    let raced = false;
    const racing = {
      ...b,
      put: vi.fn(async (...args: Parameters<typeof b.put>) => {
        await b.put(...args);
        if (raced) return null;
        raced = true;
        const later = NOW + CLAIM_STALE_MS + 1;
        const newer = (await claimResized(db, { ids: [4], nowMs: later }))
          .photos[0];
        await storeResized(
          db,
          b,
          { id: 4, claim: newer.claim, sourceFileId: newer.source.id, items },
          later,
        );
        return null;
      }),
    };
    expect(
      await storeResized(db, racing, {
        id: 4,
        claim: old.claim,
        sourceFileId: old.source.id,
        items,
      }),
    ).toEqual({ ok: false });
    expect(b.copies("5555555555")).toHaveLength(7);
    expect(stateOf(raw, 4)).toBe(
      new Date(NOW + CLAIM_STALE_MS + 1).toISOString(),
    );
  });

  it("refuses copies of a file the photo is no longer resized from", async () => {
    const { db } = await setup();
    const b = bucket();
    const [p] = (await claimResized(db, { ids: [2], nowMs: NOW })).photos;
    expect(
      await storeResized(db, b, {
        id: 2,
        claim: p.claim,
        sourceFileId: p.source.id + 1000,
        items: itemsFor(800, 600),
      }),
    ).toEqual({ ok: false });
    expect(b.objects.size).toBe(0);
  });

  it("removes the copies of a file no longer shown", async () => {
    const { raw, db } = await setup();
    const b = bucket();
    const make = async (w: number, h: number) => {
      const [p] = (await claimResized(db, { ids: [2], nowMs: NOW })).photos;
      return storeResized(
        db,
        b,
        {
          id: 2,
          claim: p.claim,
          sourceFileId: p.source.id,
          items: itemsFor(w, h),
        },
        NOW,
      );
    };
    await make(1920, 1080);
    raw.exec(`
      INSERT INTO media_file (id, media_id, role, object_key, status) VALUES
        (70, 2, 'edit', '/a/public_edit.jpg', 'ready');
      UPDATE media SET active_file_id = 70 WHERE id = 2;
    `);
    expect(await make(800, 600)).toEqual({ ok: true, stored: 7, removed: 7 });
    expect(b.copies("3333333333").every((k) => k.includes("public_edit"))).toBe(
      true,
    );
  });
});

describe("og cards asked for again", () => {
  const CAPTION = { primary: "2023-12-16 23:12 JST", secondary: "#VRChat" };

  it("are listed for photos with copies, and stored with their caption", async () => {
    const { raw, db } = await setup();
    const b = bucket();
    const [p] = (await claimResized(db, { ids: [2], nowMs: NOW })).photos;
    await storeResized(db, b, {
      id: 2,
      claim: p.claim,
      sourceFileId: p.source.id,
      items: itemsFor(800, 600),
    });
    // 2 has copies; 4 waits for them; 1 is private (no card); one is gone.
    for (const id of ["3333333333", "5555555555", "2222222222", "9999999999"]) {
      await b.put(`og-wanted/${id}`, new Uint8Array());
    }
    const captionOf = vi.fn(async (id: string) =>
      id === "2222222222" ? null : CAPTION,
    );
    raw.exec(
      "UPDATE media SET resized_at = '2100-01-01T00:00:00.000Z' WHERE id = 1",
    );
    expect(await wantedCards(db, b, captionOf)).toEqual({
      cards: [
        {
          id: 2,
          publicId: "3333333333",
          file: "/a/public.png",
          sourceFileId: p.source.id,
          caption: CAPTION,
        },
      ],
      cursor: null,
    });
    expect(
      [...b.objects.keys()].filter((k) => k.startsWith("og-wanted/")).sort(),
    ).toEqual(["og-wanted/3333333333", "og-wanted/5555555555"]);
    expect(
      await storeCard(db, b, {
        id: 2,
        sourceFileId: p.source.id,
        caption: CAPTION,
        bytes: JPEG,
      }),
    ).toBe(true);
    expect(b.objects.has("og-wanted/3333333333")).toBe(false);
    expect(b.objects.get("img/3333333333/a/public.png/og")?.meta).toEqual({
      caption: JSON.stringify(["2023-12-16 23:12 JST", "#VRChat"]),
    });
    // Not for a file the photo no longer shows.
    expect(
      await storeCard(db, b, {
        id: 2,
        sourceFileId: p.source.id + 1000,
        caption: CAPTION,
        bytes: JPEG,
      }),
    ).toBe(false);
  });

  it("are only the ones the Worker could not draw while it makes them", async () => {
    const { raw, db } = await setup();
    const b = bucket();
    raw.exec(
      "UPDATE media SET resized_at = '2100-01-01T00:00:00.000Z' WHERE id IN (2, 4)",
    );
    await b.put("og-wanted/3333333333", new Uint8Array());
    await b.put("og-wanted/5555555555", new Uint8Array(), {
      customMetadata: { "for-browser": "1" },
    });
    const captionOf = async () => ({ primary: "x" });
    const { cards } = await wantedCards(db, b, captionOf, {
      onlyForBrowser: true,
    });
    expect(cards.map((c) => c.publicId)).toEqual(["5555555555"]);
  });

  it("reach requests past a page of ones that wait for their copies", async () => {
    const { raw, db } = await setup();
    const b = bucket();
    // Photo 4 (5555555555, last in key order) has copies; 1, 2 and 3 wait.
    raw.exec(
      "UPDATE media SET resized_at = '2100-01-01T00:00:00.000Z' WHERE id = 4",
    );
    for (const id of ["2222222222", "3333333333", "4444444444", "5555555555"]) {
      await b.put(`og-wanted/${id}`, new Uint8Array());
    }
    const captionOf = async () => ({ primary: "x" });
    const first = await wantedCards(db, b, captionOf, { limit: 2 });
    expect(first).toEqual({ cards: [], cursor: "2" });
    const second = await wantedCards(db, b, captionOf, {
      limit: 2,
      cursor: first.cursor!,
    });
    expect(second.cards.map((c) => c.publicId)).toEqual(["5555555555"]);
    expect(second.cursor).toBeNull();
  });
});

describe("deleting a photo for good", () => {
  it("removes its copies first, and keeps a photo whole without the bucket", async () => {
    const { raw, db } = await setup();
    const b = bucket();
    for (const id of [2, 4]) {
      const [p] = (await claimResized(db, { ids: [id], nowMs: NOW })).photos;
      await storeResized(db, b, {
        id,
        claim: p.claim,
        sourceFileId: p.source.id,
        items: itemsFor(800, 600),
      });
    }
    await trashItems(db, { photos: [2, 4], folders: [] });
    const remove = vi.fn(async () => {});
    expect(await purgeItems(db, [4], remove)).toEqual({
      deleted: [],
      failed: [
        { id: 4, error: "縮小版の置き場が設定されていないので削除できません" },
      ],
    });
    expect(remove).not.toHaveBeenCalled();
    expect(await purgeItems(db, [2, 4], remove, ["b2"], b)).toEqual({
      deleted: [2, 4],
      failed: [],
    });
    expect(b.objects.size).toBe(0);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM media").get()).toEqual({
      c: 2,
    });
  });

  it("marks a photo waiting again when the rest of its delete fails", async () => {
    const { raw, db } = await setup();
    const b = bucket();
    const [p] = (await claimResized(db, { ids: [2], nowMs: NOW })).photos;
    await storeResized(db, b, {
      id: 2,
      claim: p.claim,
      sourceFileId: p.source.id,
      items: itemsFor(800, 600),
    });
    await trashItems(db, { photos: [2], folders: [] });
    const failing = vi.fn(async () => {
      throw new Error("削除の権限がありません");
    });
    const r = await purgeItems(db, [2], failing, ["b2"], b);
    expect(r.failed).toHaveLength(1);
    expect(stateOf(raw, 2)).toBeNull();
    expect(b.objects.size).toBe(0);
  });
});
