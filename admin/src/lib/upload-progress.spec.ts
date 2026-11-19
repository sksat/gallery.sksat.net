import { describe, expect, it } from "vitest";
import type { UploadItem, UploadStatus } from "./upload-queue";
import {
  batchBytes,
  createBatchMeter,
  createRateMeter,
  formatTimeLeft,
  percentOf,
  stableTimeLeftStep,
  timeLeftStep,
} from "./upload-progress";

let nextKey = 1;
const item = (status: UploadStatus, size: number, loaded = 0): UploadItem => ({
  key: nextKey++,
  name: `f${nextKey}.png`,
  file: `/f${nextKey}.png`,
  size,
  status,
  loaded,
  message: null,
  mediaId: null,
  attempts: 0,
  applied: [],
});

const MB = 1_000_000;

describe("batchBytes", () => {
  it("counts done files whole and the rest by what was sent", () => {
    expect(
      batchBytes([
        item("done", 100),
        item("uploading", 200, 50),
        item("completing", 300, 300),
        item("queued", 400),
        item("preparing", 500),
      ]),
    ).toEqual({ sent: 450, total: 1500 });
  });

  it("leaves out skipped and failed files", () => {
    expect(
      batchBytes([
        item("done", 100),
        item("skipped", 1000),
        item("failed", 1000, 600),
      ]),
    ).toEqual({ sent: 100, total: 100 });
  });

  it("counts a file queued again as nothing sent", () => {
    expect(batchBytes([item("queued", 100, 60)])).toEqual({
      sent: 0,
      total: 100,
    });
  });

  it("never counts more than a file's size", () => {
    expect(batchBytes([item("uploading", 100, 150)])).toEqual({
      sent: 100,
      total: 100,
    });
  });
});

describe("percentOf", () => {
  it("rounds down, so 100 means everything is sent", () => {
    expect(percentOf(0, 100)).toBe(0);
    expect(percentOf(999, 1000)).toBe(99);
    expect(percentOf(1000, 1000)).toBe(100);
    expect(percentOf(1, 3)).toBe(33);
  });

  it("is 0 for an empty batch", () => {
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe("createRateMeter", () => {
  const opts = { tauMs: 10_000, warmupMs: 3_000, warmupBytes: 1000 };

  it("waits for the first byte, then for the warm-up", () => {
    const m = createRateMeter(opts);
    // Hashing the first file: nothing sent yet, no clock running.
    m.sample(0, 0);
    m.sample(5_000, 0);
    expect(m.rate()).toBeNull();
    m.sample(6_000, 100_000); // the first byte: the meter starts here
    m.sample(7_000, 200_000);
    m.sample(8_000, 300_000);
    expect(m.rate()).toBeNull(); // 2 s in
    m.sample(9_000, 400_000);
    expect(m.rate()).toBeCloseTo(100_000);
  });

  it("is the plain average during the first seconds (no pull to zero)", () => {
    const m = createRateMeter(opts);
    m.sample(0, 1);
    m.sample(1_000, 1 + 100_000);
    m.sample(2_000, 1 + 300_000);
    m.sample(3_000, 1 + 300_000);
    // 300 kB in 3 s, weighted towards the recent second (which sent none).
    const r = m.rate() as number;
    expect(r).toBeGreaterThan(80_000);
    expect(r).toBeLessThan(110_000);
  });

  it("needs enough bytes too", () => {
    const m = createRateMeter({ ...opts, warmupBytes: 1_000_000 });
    for (let t = 0; t <= 10_000; t += 1_000) m.sample(t, 1 + t * 10);
    expect(m.rate()).toBeNull();
  });

  it("follows a change of speed smoothly", () => {
    const m = createRateMeter(opts);
    let sent = 1;
    m.sample(0, sent);
    for (let t = 1_000; t <= 30_000; t += 1_000) m.sample(t, (sent += 1 * MB));
    expect(m.rate()).toBeCloseTo(1 * MB, -3);
    const rates: number[] = [];
    for (let t = 31_000; t <= 90_000; t += 1_000) {
      m.sample(t, (sent += 0.5 * MB));
      rates.push(m.rate() as number);
    }
    // One second after the drop it has moved only a little...
    expect(rates[0]).toBeGreaterThan(0.9 * MB);
    // ...always downwards, and a minute later it is there.
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeLessThanOrEqual(rates[i - 1]);
    }
    expect(rates.at(-1)).toBeCloseTo(0.5 * MB, -4);
  });

  it("does not count bytes going backwards (a retried PUT)", () => {
    const m = createRateMeter(opts);
    m.sample(0, 1);
    m.sample(1_000, 100_001);
    m.sample(2_000, 200_001);
    m.sample(3_000, 0); // the PUT starts over
    m.sample(4_000, 100_000);
    const r = m.rate() as number;
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(100_000);
  });

  it("ignores a sample at the same time", () => {
    const m = createRateMeter(opts);
    m.sample(0, 1);
    m.sample(3_000, 300_001);
    m.sample(3_000, 900_001);
    m.sample(4_000, 1_000_001);
    expect(Number.isFinite(m.rate())).toBe(true);
  });
});

describe("timeLeftStep / formatTimeLeft", () => {
  const label = (s: number) => formatTimeLeft(timeLeftStep(s));

  it("says under a minute below 60 s", () => {
    expect(label(0)).toBe("残り 1 分未満");
    expect(label(59)).toBe("残り 1 分未満");
  });

  it("rounds to whole minutes up to an hour", () => {
    expect(label(60)).toBe("残り約 1 分");
    expect(label(89)).toBe("残り約 1 分");
    expect(label(91)).toBe("残り約 2 分");
    expect(label(3 * 60 + 10)).toBe("残り約 3 分");
    expect(label(59 * 60)).toBe("残り約 59 分");
  });

  it("uses hours and ten-minute steps from an hour", () => {
    expect(label(59 * 60 + 40)).toBe("残り約 1 時間");
    expect(label(83 * 60)).toBe("残り約 1 時間 20 分");
    expect(label(2 * 3600 + 4 * 60)).toBe("残り約 2 時間");
    expect(label(26 * 3600)).toBe("残り約 26 時間");
  });
});

describe("stableTimeLeftStep", () => {
  it("counts down as soon as the estimate does", () => {
    expect(stableTimeLeftStep(150, 3)).toBe(3); // 2.5 min rounds to 3
    expect(stableTimeLeftStep(140, 3)).toBe(2);
    expect(stableTimeLeftStep(50, 1)).toBe(0);
  });

  it("goes up only when the estimate is clearly higher", () => {
    expect(stableTimeLeftStep(3.6 * 60, 3)).toBe(3); // would round to 4
    expect(stableTimeLeftStep(4.4 * 60, 3)).toBe(4);
    expect(stableTimeLeftStep(65, 0)).toBe(0); // just over a minute
    expect(stableTimeLeftStep(80, 0)).toBe(1);
  });

  it("starts from the plain step", () => {
    expect(stableTimeLeftStep(3.6 * 60, null)).toBe(4);
  });
});

describe("createBatchMeter", () => {
  const opts = { tauMs: 10_000, warmupMs: 3_000, warmupBytes: 1000 };

  it("shows the percentage at once and the time left after the warm-up", () => {
    const meter = createBatchMeter(opts);
    const a = item("uploading", 60 * MB, 0);
    const b = item("queued", 60 * MB);
    const skipped = item("skipped", 5 * MB);
    const at = (t: number, loaded: number) =>
      meter.update(t, [{ ...a, loaded }, b, skipped]);
    expect(at(0, 0)).toEqual({
      percent: 0,
      timeLeft: null,
      files: { [a.key]: 0 },
    });
    // 1 MB/s: 120 MB in two minutes.
    expect(at(1_000, 1 * MB).timeLeft).toBeNull();
    expect(at(2_000, 2 * MB).timeLeft).toBeNull();
    expect(at(3_000, 3 * MB).timeLeft).toBeNull();
    const v = at(4_000, 4 * MB);
    expect(v.percent).toBe(3);
    expect(v.files).toEqual({ [a.key]: 6 });
    expect(v.timeLeft).toBe("残り約 2 分"); // 116 s
    expect(at(64_000, 60 * MB).timeLeft).toBe("残り約 1 分");
  });

  it("says nothing about time once everything is sent", () => {
    const meter = createBatchMeter(opts);
    const a = item("uploading", 10 * MB, 0);
    for (let t = 0; t <= 5_000; t += 1_000) {
      meter.update(t, [{ ...a, loaded: (t / 1_000) * MB }]);
    }
    const v = meter.update(6_000, [
      { ...a, status: "completing", loaded: a.size },
    ]);
    expect(v.percent).toBe(100);
    expect(v.timeLeft).toBeNull();
  });

  /** 1 MB/s on `a` for 10 s, then whatever `jump` does at 11 s. */
  const timeLeftAfter = (jump: UploadItem) => {
    const meter = createBatchMeter(opts);
    const a = item("uploading", 100 * MB, 0);
    const before = { ...jump };
    for (let t = 0; t <= 10_000; t += 1_000) {
      meter.update(t, [{ ...a, loaded: (t / 1_000) * MB }, before]);
    }
    const queued = { ...jump, status: "queued" as const };
    return meter.update(11_000, [{ ...a, loaded: 11 * MB }, queued]).timeLeft;
  };

  it("is not sped up by a file that finishes without sending", () => {
    // 89 MB left at 1 MB/s, plus 50 MB queued again: about 2 min 19 s.
    const stored = item("failed", 50 * MB, 50 * MB);
    expect(timeLeftAfter(stored)).toBe("残り約 2 分");
    const meter = createBatchMeter(opts);
    const a = item("uploading", 100 * MB, 0);
    for (let t = 0; t <= 10_000; t += 1_000) {
      meter.update(t, [{ ...a, loaded: (t / 1_000) * MB }]);
    }
    // A retried file whose PUT went through only completes: 50 MB at once.
    const b = item("completing", 50 * MB, 50 * MB);
    expect(meter.update(11_000, [{ ...a, loaded: 11 * MB }, b]).timeLeft).toBe(
      "残り約 1 分",
    ); // 89 MB at ~1 MB/s, not ~0.2 min
  });

  it("is not slowed by rows of an earlier batch", () => {
    const meter = createBatchMeter(opts);
    const old = item("done", 50 * MB);
    const a = item("preparing", 60 * MB);
    // Hashing for 10 s: the clock has not started.
    for (let t = 0; t <= 10_000; t += 1_000) meter.update(t, [old, a]);
    for (let t = 11_000; t <= 15_000; t += 1_000) {
      meter.update(t, [
        old,
        { ...a, status: "uploading", loaded: ((t - 10_000) / 1_000) * MB },
      ]);
    }
    const v = meter.update(16_000, [
      old,
      { ...a, status: "uploading", loaded: 6 * MB },
    ]);
    expect(v.timeLeft).toBe("残り 1 分未満"); // 54 MB at 1 MB/s
  });
});
