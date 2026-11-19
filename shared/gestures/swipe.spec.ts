import { describe, expect, it } from "vitest";

import {
  canStartSwipe,
  dragOffset,
  lockAxis,
  swipe,
  swipeOrFlick,
} from "./swipe";

describe("swipe", () => {
  it("left is next, right is previous", () => {
    expect(swipe(-80, 10)).toBe("next");
    expect(swipe(80, -10)).toBe("prev");
  });

  it("ignores short and mostly vertical moves", () => {
    expect(swipe(-30, 0)).toBeNull();
    expect(swipe(-80, 70)).toBeNull();
    expect(swipe(0, 300)).toBeNull();
  });
});

describe("swipeOrFlick", () => {
  it("takes a long swipe whatever its speed", () => {
    expect(swipeOrFlick(-80, 0, 2000)).toBe("next");
  });

  it("takes a short, fast flick", () => {
    // 30 px in 40 ms = 0.75 px/ms
    expect(swipeOrFlick(-30, 2, 40)).toBe("next");
    expect(swipeOrFlick(30, 2, 40)).toBe("prev");
  });

  it("ignores slow or tiny or vertical ones", () => {
    expect(swipeOrFlick(-30, 0, 200)).toBeNull();
    expect(swipeOrFlick(-10, 0, 5)).toBeNull();
    expect(swipeOrFlick(-30, 40, 40)).toBeNull();
    expect(swipeOrFlick(-30, 0, 0)).toBeNull();
  });
});

describe("canStartSwipe", () => {
  const t = { fingers: 1, x: 200, width: 390, scale: 1 };

  it("starts with one finger away from the edges", () => {
    expect(canStartSwipe(t)).toBe(true);
  });

  it("not when pinching, zoomed in or at an edge", () => {
    expect(canStartSwipe({ ...t, fingers: 2 })).toBe(false);
    expect(canStartSwipe({ ...t, scale: 1.5 })).toBe(false);
    expect(canStartSwipe({ ...t, x: 10 })).toBe(false);
    expect(canStartSwipe({ ...t, x: 380 })).toBe(false);
  });
});

describe("lockAxis", () => {
  it("waits for some travel, then picks the main axis", () => {
    expect(lockAxis(3, 4)).toBeNull();
    expect(lockAxis(-12, 3)).toBe("x");
    expect(lockAxis(4, 15)).toBe("y");
  });
});

describe("dragOffset", () => {
  it("follows the finger, resisting where there is no photo", () => {
    expect(dragOffset(-90, true)).toBe(-90);
    expect(dragOffset(-90, false)).toBe(-30);
  });
});
