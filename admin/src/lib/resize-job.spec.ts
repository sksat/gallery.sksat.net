import { describe, expect, it, vi } from "vitest";
import type { ClaimedPhoto, WantedCard } from "./resized";
import {
  runCards,
  runResize,
  type CardDeps,
  type ResizeDeps,
} from "./resize-job";
import { ResizeError, type MadeCopy } from "./resize-make";

const photo = (id: number, role = "original"): ClaimedPhoto => ({
  id,
  publicId: `p${id}`,
  claim: "making:t",
  source: { id: id * 10, storage: "b2", key: `/a/${id}.png`, role },
  caption: { primary: `caption ${id}` },
});

const COPIES: MadeCopy[] = [];

/** A server with `waiting` photos, claimed `batch` at a time. */
const fakeDeps = (waiting: number[], batch = 2) => {
  const left = [...waiting];
  const log: string[] = [];
  const deps: ResizeDeps = {
    claim: vi.fn(async (ids?: number[]) => {
      if (ids) {
        log.push(`claim ${ids.join(",")}`);
        return { photos: ids.map((id) => photo(id)), more: false };
      }
      const photos = left.splice(0, batch).map((id) => photo(id));
      log.push(`claim any: ${photos.map((p) => p.id).join(",")}`);
      return { photos, more: photos.length === batch };
    }),
    fetchFile: vi.fn(async (p: ClaimedPhoto) => {
      log.push(`fetch ${p.id}`);
      return new Blob([`file ${p.id}`]);
    }),
    make: vi.fn(async (b: Blob) => {
      log.push(`make ${await b.text()}`);
      return COPIES;
    }),
    store: vi.fn(async (p: ClaimedPhoto) => {
      log.push(`store ${p.id}`);
      return true;
    }),
    fail: vi.fn(async (p: ClaimedPhoto) => {
      log.push(`fail ${p.id}`);
    }),
    pace: vi.fn(async () => {}),
  };
  return { deps, log };
};

describe("runResize", () => {
  it("makes the uploads from their files first, then fetches the waiting ones", async () => {
    const { deps, log } = fakeDeps([7, 8, 9]);
    const pending = new Map([[5, new Blob(["upload 5"])]]);
    expect(await runResize(deps, pending)).toEqual({ made: 4, failed: 0 });
    expect(pending.size).toBe(0);
    expect(log).toEqual([
      "claim 5",
      "make upload 5",
      "store 5",
      "claim any: 7,8",
      "fetch 7",
      "make file 7",
      "store 7",
      "fetch 8",
      "make file 8",
      "store 8",
      "claim any: 9",
      "fetch 9",
      "make file 9",
      "store 9",
    ]);
    expect(deps.pace).toHaveBeenCalledTimes(4);
  });

  it("only makes uploads when not asked for the waiting ones", async () => {
    const { deps, log } = fakeDeps([7]);
    const pending = new Map([[5, new Blob(["upload 5"])]]);
    await runResize(deps, pending, { waiting: false });
    expect(log).toEqual(["claim 5", "make upload 5", "store 5"]);
  });

  it("fetches the file when the photo is resized from another (a display copy)", async () => {
    const { deps, log } = fakeDeps([]);
    deps.claim = vi.fn(async (ids?: number[]) => ({
      photos: (ids ?? []).map((id) => photo(id, "display")),
      more: false,
    }));
    await runResize(deps, new Map([[5, new Blob(["upload 5"])]]));
    expect(log).toEqual(["fetch 5", "make file 5", "store 5"]);
  });

  it("skips an upload another tab claimed", async () => {
    const { deps, log } = fakeDeps([]);
    deps.claim = vi.fn(async () => ({ photos: [], more: false }));
    expect(
      await runResize(deps, new Map([[5, new Blob(["upload 5"])]])),
    ).toEqual({ made: 0, failed: 0 });
    expect(log).toEqual([]);
  });

  it("marks a photo it cannot make failed and goes on", async () => {
    const { deps, log } = fakeDeps([7, 8], 3);
    deps.make = vi.fn(async (b: Blob) => {
      if ((await b.text()) === "file 7") throw new ResizeError("too large");
      return COPIES;
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await runResize(deps, new Map())).toEqual({ made: 1, failed: 1 });
    expect(log).toEqual([
      "claim any: 7,8",
      "fetch 7",
      "fail 7",
      "fetch 8",
      "store 8",
    ]);
  });

  it("stops at a network or server error", async () => {
    const { deps } = fakeDeps([7, 8]);
    deps.store = vi.fn(async () => {
      throw new Error("store: HTTP 500");
    });
    await expect(runResize(deps, new Map())).rejects.toThrow("HTTP 500");
    expect(deps.fail).not.toHaveBeenCalled();
    expect(deps.claim).toHaveBeenCalledTimes(1);
  });

  it("does not count a store whose claim was lost", async () => {
    const { deps } = fakeDeps([7]);
    deps.store = vi.fn(async () => false);
    expect(await runResize(deps, new Map())).toEqual({ made: 0, failed: 0 });
  });

  it("makes the cards with the photo's caption", async () => {
    const { deps } = fakeDeps([7]);
    await runResize(deps, new Map());
    expect(deps.make).toHaveBeenCalledWith(expect.any(Blob), {
      primary: "caption 7",
    });
  });
});

describe("runCards", () => {
  const card = (id: number): WantedCard => ({
    id,
    publicId: `p${id}`,
    file: `/a/${id}.png`,
    sourceFileId: id * 10,
    caption: { primary: `c${id}` },
  });

  it("draws the cards asked for, page by page, until a pass makes none", async () => {
    // Pass 1: two pages; pass 2 finds only 2, which still has no copy.
    const pages = [
      { cards: [card(1), card(2), card(3)], cursor: "p2" },
      { cards: [card(4)], cursor: null },
      { cards: [card(2)], cursor: null },
    ];
    const cursors: (string | null)[] = [];
    const log: string[] = [];
    const deps: CardDeps = {
      wanted: vi.fn(async (cursor: string | null) => {
        cursors.push(cursor);
        return pages.shift() ?? { cards: [], cursor: null };
      }),
      // 2 has no copy (yet): skipped, asked for again later.
      fetchCopy: vi.fn(async (c) =>
        c.id === 2 ? null : new Blob([`copy ${c.id}`]),
      ),
      draw: vi.fn(async (copy, c) => {
        if (c.id === 3) throw new Error("decode");
        return new Blob([`og of ${await copy.text()} ${c.caption.primary}`]);
      }),
      store: vi.fn(async (c, og) => {
        log.push(`${c.id}: ${await og.text()}`);
        return true;
      }),
      pace: vi.fn(async () => {}),
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await runCards(deps)).toBe(2);
    expect(log).toEqual(["1: og of copy 1 c1", "4: og of copy 4 c4"]);
    expect(cursors).toEqual([null, "p2", null]);
  });

  it("stops after a pass that makes nothing", async () => {
    const deps: CardDeps = {
      wanted: vi.fn(async () => ({ cards: [card(2)], cursor: null })),
      fetchCopy: vi.fn(async () => null),
      draw: vi.fn(),
      store: vi.fn(),
      pace: vi.fn(async () => {}),
    };
    expect(await runCards(deps)).toBe(0);
    expect(deps.wanted).toHaveBeenCalledTimes(1);
  });
});
