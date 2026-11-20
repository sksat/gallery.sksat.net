import { describe, expect, it, vi } from "vitest";
import {
  COPY_FAILED,
  COPY_READ_FAILED,
  COPY_TOO_LARGE,
  ImageDecodeError,
  makeDisplayCopyWith,
  orientedSize,
  withComment,
  type Rendered,
} from "./display-copy";
import { UploadError } from "./upload-queue";

describe("orientedSize", () => {
  it("turns the header's size for a quarter-turn orientation", () => {
    const stored = { width: 13_000, height: 200 };
    for (const o of [undefined, 1, 2, 3, 4]) {
      expect(orientedSize(stored, o)).toEqual(stored);
    }
    for (const o of [5, 6, 7, 8]) {
      expect(orientedSize(stored, o)).toEqual({ width: 200, height: 13_000 });
    }
  });
});

describe("withComment", () => {
  it("puts a COM segment right after the SOI", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 1, 2]);
    expect([...withComment(jpeg, "ab")]).toEqual([
      0xff, 0xd8, 0xff, 0xfe, 0, 4, 0x61, 0x62, 0xff, 0xdb, 1, 2,
    ]);
  });

  it("gives copies of different originals different bytes", () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    expect(withComment(jpeg, "original sha256 a")).not.toEqual(
      withComment(jpeg, "original sha256 b"),
    );
  });

  it("leaves anything that is not a JPEG alone", () => {
    const png = Uint8Array.from([0x89, 0x50]);
    expect(withComment(png, "x")).toBe(png);
  });
});

const jpeg = (bytes: number, width: number, height: number): Rendered => ({
  blob: new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
  width,
  height,
});
const hash = async () => "d".repeat(64);

describe("makeDisplayCopyWith", () => {
  it("makes the 8,192 px copy when it can", async () => {
    const render = vi.fn(async () => jpeg(10, 8192, 126));
    await expect(makeDisplayCopyWith(render, hash)).resolves.toMatchObject({
      size: 10,
      width: 8192,
      height: 126,
      sha256: "d".repeat(64),
    });
    expect(render.mock.calls).toEqual([[8192]]);
  });

  it("tries 4,096 px where the larger canvas cannot be made", async () => {
    for (const first of [
      async () => null,
      async () => {
        throw new RangeError("out of memory");
      },
    ]) {
      const render = vi.fn(async (side: number): Promise<Rendered | null> =>
        side === 8192 ? first() : jpeg(10, 4096, 63),
      );
      await expect(makeDisplayCopyWith(render, hash)).resolves.toMatchObject({
        width: 4096,
        height: 63,
      });
      expect(render.mock.calls).toEqual([[8192], [4096]]);
    }
  });

  it("never returns a copy still over the resize limits", async () => {
    const render = async (side: number) =>
      side === 8192 ? jpeg(10, 12_001, 100) : jpeg(10, 4096, 34);
    await expect(makeDisplayCopyWith(render, hash)).resolves.toMatchObject({
      width: 4096,
    });
  });

  it("refuses the file for good, saying what went wrong", async () => {
    const refusal = (render: (side: number) => Promise<Rendered | null>) =>
      makeDisplayCopyWith(render, hash).catch((e: unknown) => e);
    // The image did not decode: no cause claimed.
    const err = await refusal(async () => {
      throw new ImageDecodeError(new Error("decode failed"));
    });
    expect(err).toBeInstanceOf(UploadError);
    expect(err).toMatchObject({
      message: COPY_READ_FAILED,
      retryable: false,
    });
    // Not even a 4,096 px canvas: the browser's size limit.
    expect(await refusal(async () => null)).toMatchObject({
      message: COPY_TOO_LARGE,
    });
    // Anything else.
    expect(await refusal(async () => jpeg(0, 10, 10))).toMatchObject({
      message: COPY_FAILED,
    });
    expect(
      await refusal(async () => {
        throw new Error("encode failed");
      }),
    ).toMatchObject({ message: COPY_FAILED });
  });

  it("speaks of the file and what to do, never of the copy", () => {
    for (const m of [COPY_READ_FAILED, COPY_TOO_LARGE, COPY_FAILED]) {
      expect(m).not.toMatch(/コピー/);
      expect(m).toMatch(/縮小した画像なら追加できます。$/);
    }
    expect(COPY_READ_FAILED).toBe(
      "この画像をこのブラウザでは読み込めませんでした。100 MB、1 辺 12,000 px、1 億画素までに縮小した画像なら追加できます。",
    );
  });
});
