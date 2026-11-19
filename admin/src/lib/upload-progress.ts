// The upload panel's percentage and time left: how far the batch is, a
// smoothed throughput and what that leaves. Pure; the time is passed in
// (`now`, in ms), so Vitest drives it with a fake clock
// (upload-progress.spec.ts). The panel calls `BatchMeter.update` about
// once a second, which also keeps the text from changing faster than that.

import type { UploadItem } from "./upload-queue";

export type BatchBytes = {
  /** Bytes already in the bucket or on their way. */
  sent: number;
  /** Bytes of every file that is or will be sent. */
  total: number;
};

/**
 * The batch's bytes. Skipped files are never sent and failed ones are not
 * any more (until retried), so neither counts; a done file counts whole,
 * a waiting one as nothing sent yet.
 */
export const batchBytes = (items: readonly UploadItem[]): BatchBytes => {
  let sent = 0;
  let total = 0;
  for (const it of items) {
    if (it.status === "skipped" || it.status === "failed") continue;
    total += it.size;
    // A queued file (perhaps retried) starts over: its old count is stale.
    if (it.status === "done") sent += it.size;
    else if (it.status === "uploading" || it.status === "completing") {
      sent += Math.min(it.loaded, it.size);
    }
  }
  return { sent, total };
};

/** Whole percent, rounded down: 100 only once everything is sent. */
export const percentOf = (sent: number, total: number): number =>
  total <= 0 ? 0 : Math.min(100, Math.floor((sent * 100) / total));

export type RateOptions = {
  /** Time constant of the moving average. */
  tauMs?: number;
  /** No rate before this long after the first byte... */
  warmupMs?: number;
  /** ...nor before this many bytes have been seen sent. */
  warmupBytes?: number;
};

export const RATE_TAU_MS = 10_000;
export const RATE_WARMUP_MS = 3_000;
export const RATE_WARMUP_BYTES = 256 * 1024;

/**
 * Throughput as an exponentially weighted moving average of the bytes sent
 * between samples, weighted by time (so irregular samples are fine). It
 * starts at the first byte, not while the first file is being hashed, and
 * is bias-corrected, so the first seconds are the plain average so far
 * rather than pulled towards zero. Bytes going backwards (a PUT tried
 * again from the start) count as none.
 */
export const createRateMeter = (opts: RateOptions = {}) => {
  const tau = opts.tauMs ?? RATE_TAU_MS;
  const warmupMs = opts.warmupMs ?? RATE_WARMUP_MS;
  const warmupBytes = opts.warmupBytes ?? RATE_WARMUP_BYTES;
  let start: number | null = null;
  let lastT = 0;
  let lastSent = 0;
  /** Running average, not yet bias-corrected (bytes per ms). */
  let avg = 0;
  let counted = 0;
  return {
    sample(now: number, sent: number): void {
      if (start === null) {
        lastSent = sent;
        if (sent <= 0) return;
        start = lastT = now;
        return;
      }
      const dt = now - lastT;
      if (dt <= 0) {
        lastSent = Math.min(lastSent, sent);
        return;
      }
      const bytes = Math.max(0, sent - lastSent);
      avg += (1 - Math.exp(-dt / tau)) * (bytes / dt - avg);
      counted += bytes;
      lastT = now;
      lastSent = sent;
    },
    /** Bytes per second, or null while there is too little to go on. */
    rate(): number | null {
      if (start === null) return null;
      const elapsed = lastT - start;
      if (elapsed < warmupMs || counted < warmupBytes) return null;
      return (avg / (1 - Math.exp(-elapsed / tau))) * 1000;
    },
  };
};

/**
 * Time left in display steps, in minutes: 0 means under a minute, then
 * whole minutes, and from an hour on, ten-minute steps.
 */
export const timeLeftStep = (seconds: number): number => {
  const minutes = seconds / 60;
  if (minutes < 1) return 0;
  if (minutes < 59.5) return Math.max(1, Math.round(minutes));
  return Math.round(minutes / 10) * 10;
};

/** How far above a step the estimate must be before it goes up again. */
const RISE_MARGIN = 1.15;

/**
 * The step to show, given the one shown before: it goes down as soon as
 * the estimate does (that is the countdown), but up only when it is
 * clearly higher, so an estimate near a boundary does not flicker.
 */
export const stableTimeLeftStep = (
  seconds: number,
  shown: number | null,
): number => {
  const next = timeLeftStep(seconds);
  if (shown === null || next <= shown) return next;
  return timeLeftStep(seconds / RISE_MARGIN) > shown ? next : shown;
};

export const formatTimeLeft = (step: number): string => {
  if (step < 1) return "残り 1 分未満";
  if (step < 60) return `残り約 ${step} 分`;
  const h = Math.floor(step / 60);
  const m = step % 60;
  return m === 0 ? `残り約 ${h} 時間` : `残り約 ${h} 時間 ${m} 分`;
};

/** What the panel shows while a batch is in flight. */
export type BatchView = {
  /** The whole batch, 0..100. */
  percent: number;
  /** "残り約 3 分", or null until the rate is known (or nothing is left). */
  timeLeft: string | null;
  /** Per file being sent (by item key), 0..100. */
  files: Record<number, number>;
};

/**
 * One batch's meter: create it when a batch starts, update it each tick.
 * The speed comes from what each file's PUT has sent since the last tick,
 * not from the batch's total: that also moves when a file finishes
 * without sending (its PUT went through before, a retry only completes
 * it), when rows of an earlier batch are still listed, or when a failed
 * file is queued again with its old count.
 */
export const createBatchMeter = (opts: RateOptions = {}) => {
  const meter = createRateMeter(opts);
  let shown: number | null = null;
  /** Bytes each file being sent had sent at the last tick. */
  let seen = new Map<number, number>();
  /** Bytes sent by the PUTs since this meter started. */
  let transferred = 0;
  return {
    update(now: number, items: readonly UploadItem[]): BatchView {
      const { sent, total } = batchBytes(items);
      const next = new Map<number, number>();
      for (const it of items) {
        const before = seen.get(it.key);
        // A PUT starts from 0; a file seen sending may finish its last
        // bytes as it turns to completing.
        if (
          it.status === "uploading" ||
          (it.status === "completing" && before !== undefined)
        ) {
          transferred += Math.max(0, it.loaded - (before ?? 0));
          next.set(it.key, it.loaded);
        }
      }
      seen = next;
      meter.sample(now, transferred);
      const rate = meter.rate();
      const remaining = total - sent;
      let timeLeft: string | null = null;
      if (rate !== null && rate > 0 && remaining > 0) {
        shown = stableTimeLeftStep(remaining / rate, shown);
        timeLeft = formatTimeLeft(shown);
      } else if (remaining <= 0) {
        shown = null;
      }
      const files: Record<number, number> = {};
      for (const it of items) {
        if (it.status === "uploading" || it.status === "completing") {
          files[it.key] = percentOf(it.loaded, it.size);
        }
      }
      return { percent: percentOf(sent, total), timeLeft, files };
    },
  };
};

export type BatchMeter = ReturnType<typeof createBatchMeter>;
