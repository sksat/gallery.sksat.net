import { describe, expect, it } from "vitest";
import {
  generatePublicId,
  PUBLIC_ID_ALPHABET,
  PUBLIC_ID_RE,
} from "./public-id";

describe("PUBLIC_ID_ALPHABET", () => {
  it("has no look-alike characters", () => {
    for (const c of "01oli") expect(PUBLIC_ID_ALPHABET).not.toContain(c);
    expect(new Set(PUBLIC_ID_ALPHABET).size).toBe(PUBLIC_ID_ALPHABET.length);
  });
});

describe("generatePublicId", () => {
  it("returns 10 symbols from the alphabet", () => {
    for (let i = 0; i < 100; i++) {
      expect(generatePublicId()).toMatch(PUBLIC_ID_RE);
    }
  });

  it("maps bytes onto the alphabet", () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 30]);
    expect(generatePublicId(() => bytes)).toBe("23456789az");
  });

  it("skips bytes that would bias the result", () => {
    // 248..255 are dropped (248 = 8 * 31); the next call fills the rest.
    const calls = [
      Uint8Array.from([255, 248, 0, 0, 0, 0, 0, 0, 0, 0]),
      Uint8Array.from([31, 62, 9, 9, 9, 9, 9, 9, 9, 9]),
    ];
    expect(generatePublicId(() => calls.shift()!)).toBe("2222222222");
  });
});

describe("PUBLIC_ID_RE", () => {
  it("rejects other shapes", () => {
    expect("abcdefghjk").toMatch(PUBLIC_ID_RE);
    expect("abcdefghj").not.toMatch(PUBLIC_ID_RE);
    expect("abcdefghjkm").not.toMatch(PUBLIC_ID_RE);
    expect("abcdefghjo").not.toMatch(PUBLIC_ID_RE);
    expect("ABCDEFGHJK").not.toMatch(PUBLIC_ID_RE);
  });
});
