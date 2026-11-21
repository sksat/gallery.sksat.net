import { describe, expect, it } from "vitest";
import {
  baseName,
  intoFolder,
  planMoves,
  undoMoves,
  type Tree,
} from "./file-ops";

const tree: Tree = {
  photos: [
    { id: 1, path: "/VRChat/2026-11/a.png" },
    { id: 2, path: "/VRChat/2026-11/b.png" },
    { id: 3, path: "/VRChat/2026-11/sub/c.png" },
    { id: 4, path: "/Real/x.jpg" },
    { id: 5, path: "/top.png" },
  ],
  folders: ["/VRChat/2026-11/sub", "/empty"],
};

const plan = (moves: Parameters<typeof planMoves>[1], t = tree) => {
  const r = planMoves(t, moves);
  if (!r.ok) throw new Error(r.error);
  return r.plan;
};

describe("planMoves of a video", () => {
  const withVideo: Tree = {
    photos: [...tree.photos, { id: 9, path: "/Real/clip.mp4" }],
    folders: [],
  };
  it("renames it, but never into a photo's extension or back", () => {
    expect(
      plan([{ kind: "photo", id: 9, to: "/Real/trip.MOV" }], withVideo),
    ).toMatchObject({
      photos: [{ id: 9, from: "/Real/clip.mp4", to: "/Real/trip.MOV" }],
    });
    expect(
      planMoves(withVideo, [{ kind: "photo", id: 9, to: "/Real/clip.png" }]),
    ).toEqual({ ok: false, error: "/Real/clip.png は拡張子の種類が違います" });
    expect(
      planMoves(withVideo, [{ kind: "photo", id: 4, to: "/Real/x.mp4" }]).ok,
    ).toBe(false);
  });
});

describe("planMoves", () => {
  it("moves photos into another folder and keeps their old folder", () => {
    expect(
      plan(intoFolder(tree, "/Real", { photos: [1, 2], folders: [] })),
    ).toEqual({
      photos: [
        { id: 1, from: "/VRChat/2026-11/a.png", to: "/Real/a.png" },
        { id: 2, from: "/VRChat/2026-11/b.png", to: "/Real/b.png" },
      ],
      folders: [],
      keep: ["/VRChat/2026-11"],
    });
  });

  it("moves a folder with everything in it", () => {
    expect(
      plan(
        intoFolder(tree, "/Real", { photos: [], folders: ["/VRChat/2026-11"] }),
      ),
    ).toEqual({
      photos: [
        { id: 1, from: "/VRChat/2026-11/a.png", to: "/Real/2026-11/a.png" },
        { id: 2, from: "/VRChat/2026-11/b.png", to: "/Real/2026-11/b.png" },
        {
          id: 3,
          from: "/VRChat/2026-11/sub/c.png",
          to: "/Real/2026-11/sub/c.png",
        },
      ],
      folders: [{ from: "/VRChat/2026-11", to: "/Real/2026-11" }],
      // /VRChat would vanish with its only folder gone.
      keep: ["/VRChat"],
    });
  });

  it("refuses a photo under a path that is a photo", () => {
    expect(
      planMoves(tree, [{ kind: "photo", id: 4, to: "/top.png/x.jpg" }]),
    ).toEqual({
      ok: false,
      error: "/top.png は写真なのでフォルダにできません",
    });
    expect(
      planMoves(tree, [{ kind: "folder", from: "/empty", to: "/top.png/e" }])
        .ok,
    ).toBe(false);
  });

  it("renames a photo or a folder in place", () => {
    expect(plan([{ kind: "photo", id: 5, to: "/cover.png" }]).photos).toEqual([
      { id: 5, from: "/top.png", to: "/cover.png" },
    ]);
    expect(
      plan([{ kind: "folder", from: "/empty", to: "/blank" }]).folders,
    ).toEqual([{ from: "/empty", to: "/blank" }]);
  });

  it("ignores moves to where things already are", () => {
    expect(
      plan(intoFolder(tree, "/VRChat/2026-11", { photos: [1], folders: [] })),
    ).toEqual({ photos: [], folders: [], keep: [] });
  });

  it("refuses names that are taken at the destination", () => {
    const t: Tree = {
      photos: [...tree.photos, { id: 6, path: "/Real/a.png" }],
      folders: [...tree.folders, "/Real/2026-11"],
    };
    expect(
      planMoves(t, intoFolder(t, "/Real", { photos: [1], folders: [] })),
    ).toEqual({ ok: false, error: "/Real/a.png はすでにあります" });
    expect(
      planMoves(
        t,
        intoFolder(t, "/Real", { photos: [], folders: ["/VRChat/2026-11"] }),
      ),
    ).toEqual({ ok: false, error: "/Real/2026-11 はすでにあります" });
    // Two moved photos onto one name.
    expect(
      planMoves(tree, [
        { kind: "photo", id: 1, to: "/z.png" },
        { kind: "photo", id: 2, to: "/z.png" },
      ]),
    ).toEqual({ ok: false, error: "/z.png はすでにあります" });
    // A photo onto a folder's name.
    expect(
      planMoves(tree, [{ kind: "photo", id: 5, to: "/VRChat/2026-11/sub" }]).ok,
    ).toBe(false);
  });

  it("refuses moving a folder into itself", () => {
    expect(
      planMoves(tree, [
        { kind: "folder", from: "/VRChat", to: "/VRChat/2026-11/VRChat" },
      ]),
    ).toEqual({ ok: false, error: "/VRChat をその中には移動できません" });
  });

  it("refuses bad names, unknown items and too deep folders", () => {
    expect(planMoves(tree, [{ kind: "photo", id: 5, to: "/a b.png" }]).ok).toBe(
      false,
    );
    expect(planMoves(tree, [{ kind: "photo", id: 5, to: "/a.gif" }]).ok).toBe(
      false,
    );
    expect(planMoves(tree, [{ kind: "photo", id: 99, to: "/a.png" }]).ok).toBe(
      false,
    );
    expect(
      planMoves(tree, [{ kind: "folder", from: "/nope", to: "/x" }]).ok,
    ).toBe(false);
    expect(
      planMoves(tree, [
        { kind: "folder", from: "/VRChat", to: "/a/b/c/d/e/f/g/VRChat" },
      ]).ok,
    ).toBe(false); // .../VRChat/2026-11/sub would be 10 deep
    expect(
      planMoves(tree, [{ kind: "folder", from: "/empty", to: "/camera" }]).ok,
    ).toBe(false);
  });

  it("can be undone", () => {
    const p = plan(
      intoFolder(tree, "/Real", { photos: [5], folders: ["/VRChat/2026-11"] }),
    );
    const moved: Tree = {
      photos: tree.photos.map((ph) => ({
        ...ph,
        path: p.photos.find((x) => x.id === ph.id)?.to ?? ph.path,
      })),
      folders: ["/Real/2026-11/sub", "/empty", ...p.keep],
    };
    const back = plan(undoMoves(p), moved);
    expect(
      back.photos.map((x) => [x.id, x.to]).sort((a, b) => +a[0] - +b[0]),
    ).toEqual([
      [1, "/VRChat/2026-11/a.png"],
      [2, "/VRChat/2026-11/b.png"],
      [3, "/VRChat/2026-11/sub/c.png"],
      [5, "/top.png"],
    ]);
  });
});

describe("baseName", () => {
  it("is the last segment", () => {
    expect(baseName("/a/b.png")).toBe("b.png");
    expect(baseName("/a")).toBe("a");
  });
});
