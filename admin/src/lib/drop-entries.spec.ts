import { describe, expect, it } from "vitest";
import {
  collectDropped,
  INTERNAL_DRAG_TYPE,
  isUploadDrag,
  readDrop,
  uploadDropEffect,
  type DropItemLike,
  type DirectoryEntryLike,
  type EntryLike,
  type FileEntryLike,
} from "./drop-entries";

const file = (name: string): FileEntryLike => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (ok) => ok(new File(["x"], name)),
});

/** A folder whose reader returns its children two at a time. */
const dir = (name: string, children: EntryLike[]): DirectoryEntryLike => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader: () => {
    let i = 0;
    return {
      readEntries: (ok) => {
        const batch = children.slice(i, i + 2);
        i += 2;
        ok(batch);
      },
    };
  },
});

describe("collectDropped", () => {
  it("flattens folders into relative paths, sorted, without hidden files", async () => {
    const got = await collectDropped([
      file("loose.png"),
      dir("Trip", [
        file("b.jpg"),
        file(".DS_Store"),
        dir("day1", [file("c.png"), file("a.png")]),
        dir(".git", [file("x.png")]),
        file("a.jpg"),
      ]),
      // A dropped folder is taken whatever its own name.
      dir(".photos", [file("p.png")]),
    ]);
    expect(got.files.map((d) => d.relativePath)).toEqual([
      "loose.png",
      "Trip/a.jpg",
      "Trip/b.jpg",
      "Trip/day1/a.png",
      "Trip/day1/c.png",
      ".photos/p.png",
    ]);
    expect(got.files[1].file.name).toBe("a.jpg");
    expect(got.failed).toEqual([]);
    expect(got.truncated).toBe(false);
  });

  it("stops at the limit and says so", async () => {
    const many = dir(
      "big",
      Array.from({ length: 10 }, (_, i) => file(`${i}.png`)),
    );
    const got = await collectDropped([many], 3);
    expect(got.files).toHaveLength(3);
    expect(got.truncated).toBe(true);
  });

  it("skips what cannot be read and keeps the rest", async () => {
    const broken: DirectoryEntryLike = {
      isFile: false,
      isDirectory: true,
      name: "broken",
      createReader: () => ({
        readEntries: (_ok, err) => err?.(new Error("NotReadableError")),
      }),
    };
    const gone: FileEntryLike = {
      isFile: true,
      isDirectory: false,
      name: "gone.png",
      file: (_ok, err) => err?.(new Error("NotFoundError")),
    };
    const got = await collectDropped([
      dir("A", [broken, gone, file("ok.png")]),
    ]);
    expect(got.files.map((d) => d.relativePath)).toEqual(["A/ok.png"]);
    expect(got.failed).toEqual(["A/broken", "A/gone.png"]);
  });
});

describe("isUploadDrag", () => {
  it("takes a drag from outside whatever the browser lists", () => {
    // Chromium; Firefox with and without "Files" before the drop.
    expect(isUploadDrag(["Files"])).toBe(true);
    expect(isUploadDrag(["application/x-moz-file", "Files"])).toBe(true);
    expect(isUploadDrag(["application/x-moz-file"])).toBe(true);
    expect(isUploadDrag(["text/uri-list", "text/x-moz-url"])).toBe(true);
    expect(isUploadDrag(["text/plain"])).toBe(true);
    expect(isUploadDrag([])).toBe(true);
  });

  it("leaves the page's own drags to the move", () => {
    expect(isUploadDrag([INTERNAL_DRAG_TYPE, "Files"])).toBe(false);
    expect(
      isUploadDrag(["application/x-gallery-items", INTERNAL_DRAG_TYPE]),
    ).toBe(false);
  });
});

describe("uploadDropEffect", () => {
  it("copies when the drag allows it", () => {
    for (const a of [undefined, "", "all", "uninitialized", "copy"]) {
      expect(uploadDropEffect(a)).toBe("copy");
    }
    expect(uploadDropEffect("copyMove")).toBe("copy");
    expect(uploadDropEffect("copyLink")).toBe("copy");
  });

  it("takes what the source allows otherwise", () => {
    expect(uploadDropEffect("move")).toBe("move");
    expect(uploadDropEffect("linkMove")).toBe("move");
    expect(uploadDropEffect("link")).toBe("link");
  });
});

describe("readDrop", () => {
  const f = (name: string) => new File(["x"], name);
  const item = (
    kind: string,
    type: string,
    got: { file?: File; entry?: EntryLike } = {},
  ): DropItemLike => ({
    kind,
    type,
    getAsFile: () => got.file ?? null,
    webkitGetAsEntry: () => got.entry ?? null,
  });

  it("takes entries, and files that have none", () => {
    const a = file("a.png");
    const b = f("b.png");
    const got = readDrop({
      types: ["Files"],
      items: [
        item("file", "image/png", { entry: a }),
        item("file", "image/png", { file: b }),
        item("string", "text/uri-list"),
      ],
      files: [f("a.png"), b],
    });
    expect(got.entries).toEqual([a]);
    expect(got.loose).toEqual([b]);
    expect(got.unread).toBe(0);
    expect(got.items).toEqual([
      "file:image/png",
      "file:image/png",
      "string:text/uri-list",
    ]);
  });

  it("counts file items that give no file", () => {
    const a = file("a.png");
    const got = readDrop({
      types: ["Files"],
      items: [item("file", "image/png", { entry: a }), item("file", "")],
      files: [],
    });
    expect(got.entries).toEqual([a]);
    expect(got.unread).toBe(1);
  });

  it("takes the file list when it has more than the items gave", () => {
    const list = [f("a.png"), f("b.png")];
    const got = readDrop({
      types: ["Files"],
      items: [item("file", "image/png"), item("file", "image/png")],
      files: list,
    });
    expect(got.entries).toEqual([]);
    expect(got.loose).toEqual(list);
    expect(got.unread).toBe(0);
    // An older engine: no items at all.
    expect(readDrop({ types: ["Files"], files: list }).loose).toEqual(list);
  });

  it("keeps a dropped folder's entry over the file list", () => {
    const d = dir("Trip", [file("a.png")]);
    const got = readDrop({
      types: ["Files"],
      items: [item("file", "", { entry: d })],
      files: [f("Trip"), f("x.png")],
    });
    expect(got.entries).toEqual([d]);
    expect(got.loose).toEqual([]);
  });

  it("finds nothing in a drag of text or links", () => {
    const got = readDrop({
      types: ["text/uri-list", "text/x-moz-url"],
      items: [
        item("string", "text/uri-list"),
        item("string", "text/x-moz-url"),
      ],
      files: [],
    });
    expect(got.entries).toEqual([]);
    expect(got.loose).toEqual([]);
    expect(got.unread).toBe(0);
    expect(got.types).toEqual(["text/uri-list", "text/x-moz-url"]);
    expect(readDrop(null).loose).toEqual([]);
  });
});
