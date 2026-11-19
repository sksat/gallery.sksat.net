import { describe, expect, it } from "vitest";
import { shareUrl } from "./share";

describe("shareUrl", () => {
  it("is the photo's own page, ending in one slash", () => {
    expect(shareUrl("https://gallery.sksat.net", "abcdefghjk")).toBe(
      "https://gallery.sksat.net/photo/abcdefghjk/",
    );
    expect(shareUrl("http://127.0.0.1:5174", "abcdefghjk")).toBe(
      "http://127.0.0.1:5174/photo/abcdefghjk/",
    );
  });
});
