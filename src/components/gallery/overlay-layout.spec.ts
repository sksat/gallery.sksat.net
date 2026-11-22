import { describe, expect, it } from "vitest";

import { wideInfoPlace } from "./overlay-layout";

describe("wideInfoPlace", () => {
  it("puts the info beside a photo that leaves room at its sides", () => {
    // 3:4 at 1440×900: (900 - 112) × 3/4 = 591px wide, 424px each side.
    expect(wideInfoPlace(1440, 900, 3 / 4)).toBe("side");
    expect(wideInfoPlace(1920, 1080, 1)).toBe("side");
    // 3:2 at 1920×1080: 1452px wide, 234px each side: too narrow.
    expect(wideInfoPlace(1920, 1080, 3 / 2)).toBe("below");
  });

  it("puts it under wide photos", () => {
    expect(wideInfoPlace(1440, 900, 3 / 2)).toBe("below");
    expect(wideInfoPlace(1440, 900, 16 / 9)).toBe("below");
    expect(wideInfoPlace(1920, 1080, 3)).toBe("below");
    // A square on a small screen: 656px of 1024, 184px each side.
    expect(wideInfoPlace(1024, 768, 1)).toBe("below");
    // 3:4 there: 492px, 266px each side.
    expect(wideInfoPlace(1024, 768, 3 / 4)).toBe("below");
    // A square at 1280×800: 688px, 296px each side.
    expect(wideInfoPlace(1280, 800, 1)).toBe("below");
  });

  it("puts it under a photo of unknown shape", () => {
    expect(wideInfoPlace(1920, 1080, null)).toBe("below");
    expect(wideInfoPlace(1920, 1080, 0)).toBe("below");
  });
});
