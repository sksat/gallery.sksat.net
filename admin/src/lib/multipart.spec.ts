import { describe, expect, it } from "vitest";
import {
  checkParts,
  doneParts,
  isMultipart,
  MAX_PART_BYTES,
  MIN_PART_BYTES,
  missingParts,
  partRange,
  partSizeFor,
  planParts,
  SIGN_BATCH,
  validPartNumbers,
} from "./multipart";

const MiB = 1024 * 1024;

describe("planning parts", () => {
  it("sends a file that fits in one part as a single PUT", () => {
    expect(isMultipart(MIN_PART_BYTES)).toBe(false);
    expect(isMultipart(MIN_PART_BYTES + 1)).toBe(true);
  });

  it("keeps parts 16–64 MiB, whole MiB, about 100 of them", () => {
    expect(partSizeFor(17 * MiB)).toBe(16 * MiB);
    expect(partSizeFor(3000 * MiB)).toBe(30 * MiB);
    expect(partSizeFor(5_000_000_000)).toBe(48 * MiB);
    expect(partSizeFor(100_000 * MiB)).toBe(MAX_PART_BYTES);
    for (const size of [17 * MiB, 1e9, 5e9]) {
      const { partSize, count } = planParts(size);
      expect(partSize % MiB).toBe(0);
      expect(count).toBeLessThanOrEqual(100);
      expect((count - 1) * partSize).toBeLessThan(size);
      expect(count * partSize).toBeGreaterThanOrEqual(size);
    }
  });

  it("cuts every byte exactly once, the last part shorter", () => {
    const size = 40 * MiB + 5;
    const plan = planParts(size);
    expect(plan).toEqual({ partSize: 16 * MiB, count: 3 });
    expect(partRange(plan, size, 1)).toEqual({ start: 0, end: 16 * MiB });
    expect(partRange(plan, size, 3)).toEqual({ start: 32 * MiB, end: size });
    expect(() => partRange(plan, size, 0)).toThrow();
    expect(() => partRange(plan, size, 4)).toThrow();
  });
});

describe("resuming and completing", () => {
  const size = 40 * MiB + 5;
  const plan = planParts(size);
  const part = (n: number, bytes: number) => ({
    partNumber: n,
    etag: `"e${n}"`,
    size: bytes,
  });

  it("skips only the parts the bucket has whole", () => {
    const parts = [part(3, 8 * MiB + 5), part(1, 16 * MiB), part(2, 100)];
    expect(doneParts(plan, size, parts)).toEqual([1, 3]);
    expect(missingParts(plan, [1, 3])).toEqual([2]);
  });

  it("completes only with every part at its size", () => {
    const all = [part(1, 16 * MiB), part(2, 16 * MiB), part(3, 8 * MiB + 5)];
    expect(checkParts(plan, size, all)).toBeNull();
    expect(checkParts(plan, size, all.slice(0, 2))).toEqual([3]);
    expect(checkParts(plan, size, [all[0], part(2, 1), all[2]])).toEqual([2]);
  });

  it("signs a batch of distinct part numbers in range", () => {
    expect(validPartNumbers(plan, [1, 3])).toEqual([1, 3]);
    for (const bad of [[], [0], [4], [1, 1], [1.5], ["1"], "1", null]) {
      expect(validPartNumbers(plan, bad)).toBeNull();
    }
    const many = planParts(2000 * MiB);
    expect(
      validPartNumbers(
        many,
        Array.from({ length: SIGN_BATCH + 1 }, (_, i) => i + 1),
      ),
    ).toBeNull();
  });
});
