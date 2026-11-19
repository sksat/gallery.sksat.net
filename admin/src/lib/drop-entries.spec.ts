import { describe, expect, it } from "vitest";
import {
  collectDropped,
  INTERNAL_DRAG_TYPE,
  isUploadDrag,
  uploadDropEffect,
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
