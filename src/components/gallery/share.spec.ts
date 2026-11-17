import { describe, expect, it } from "vitest";
import { shareUrl } from "./share";

describe("shareUrl", () => {
  it("drops the filter, sort and camera query", () => {
    expect(
      shareUrl(
        "https://gallery.sksat.net/photo/3?tag=Real&tag=night&mode=or&sort=random&seed=42",
      ),
    ).toBe("https://gallery.sksat.net/photo/3/");
    expect(
      shareUrl("https://gallery.sksat.net/photo/3/?camera=virtuallens2"),
    ).toBe("https://gallery.sksat.net/photo/3/");
  });

  it("drops a fragment", () => {
    expect(shareUrl("https://gallery.sksat.net/photo/3#x")).toBe(
      "https://gallery.sksat.net/photo/3/",
    );
  });

  it("ends the path in one slash, whatever the id looks like", () => {
    expect(shareUrl("http://127.0.0.1:5174/photo/aB3-xY_9?tag=a")).toBe(
      "http://127.0.0.1:5174/photo/aB3-xY_9/",
    );
    expect(shareUrl("https://gallery.sksat.net/photo/3/")).toBe(
      "https://gallery.sksat.net/photo/3/",
    );
  });
});
