import { describe, expect, it } from "vitest";
import {
  takenAtFromInput,
  takenAtInputValue,
  takenAtOffset,
} from "./taken-at-input";

describe("taken-at input", () => {
  it("shows the time in the photo's own offset", () => {
    // As the browser serialises it: no ":00" seconds.
    expect(takenAtInputValue("2024-03-08T00:00:00.000+09:00")).toBe(
      "2024-03-08T00:00",
    );
    expect(takenAtInputValue("2026-11-02T11:31:36.959+09:00")).toBe(
      "2026-11-02T11:31:36",
    );
    // Stored in UTC: shown in JST, like the rest of the admin.
    expect(takenAtInputValue("2023-12-02T00:00:00Z")).toBe("2023-12-02T09:00");
    expect(takenAtInputValue("2023-12-31T20:30:15Z")).toBe(
      "2024-01-01T05:30:15",
    );
    expect(takenAtInputValue(null)).toBe("");
    expect(takenAtInputValue("garbage")).toBe("");
  });

  it("keeps the offset, JST when there was none", () => {
    expect(takenAtOffset("2024-03-08T00:00:00-05:00")).toBe("-05:00");
    expect(takenAtOffset("2024-03-08T00:00:00Z")).toBe("+09:00");
    expect(takenAtOffset("2023-12-11T01:21:32")).toBe("+09:00");
    expect(takenAtOffset(null)).toBe("+09:00");
  });

  it("turns what was typed into a timestamp", () => {
    expect(takenAtFromInput("2024-02-01T00:00", "+09:00")).toBe(
      "2024-02-01T00:00:00+09:00",
    );
    expect(takenAtFromInput("2024-02-01T12:34:56", "-05:00")).toBe(
      "2024-02-01T12:34:56-05:00",
    );
    expect(takenAtFromInput("", "+09:00")).toBeNull();
    expect(takenAtFromInput("2024-02-01", "+09:00")).toBeUndefined();
    expect(takenAtFromInput("2024-02-01T00:00", "JST")).toBeUndefined();
  });
});
