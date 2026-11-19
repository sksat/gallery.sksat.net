import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashBlob, HASH_CHUNK, Sha256 } from "./sha256";

const node = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Deterministic bytes (no Math.random). */
const bytes = (n: number) => {
  const out = new Uint8Array(n);
  let x = 0x12345678;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
};

describe("Sha256", () => {
  it("matches node:crypto around every padding boundary", () => {
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000]) {
      const b = bytes(n);
      expect(new Sha256().update(b).hex(), `${n} bytes`).toBe(node(b));
    }
  });

  it("gives the same digest however the input is cut", () => {
    const b = bytes(5000);
    const h = new Sha256();
    for (const [s, e] of [
      [0, 1],
      [1, 70],
      [70, 64 * 10],
      [640, 641],
      [641, 5000],
    ]) {
      h.update(b.subarray(s, e));
    }
    expect(h.hex()).toBe(node(b));
  });

  it("hashes a Blob in chunks", async () => {
    const b = bytes(HASH_CHUNK + 1234);
    const seen: number[] = [];
    expect(await hashBlob(new Blob([b]), (n) => seen.push(n))).toBe(node(b));
    expect(seen).toEqual([HASH_CHUNK, HASH_CHUNK + 1234]);
  });
});
