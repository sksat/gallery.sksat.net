// How a large upload is cut into parts (multipart.spec.ts). Shared by the
// browser (which sends the parts) and the admin (which signs them and
// checks the result), so both cut the same file the same way.
//
// S3 (B2 and R2 alike) wants every part but the last at least 5 MiB, at
// most 10,000 parts, and R2 wants every part but the last the same size.
// Parts here are 16–64 MiB: few enough that signing them is a handful of
// requests, small enough that a failed part costs little to send again and
// that a part sent through the admin (the playback copy, R2 binding) stays
// under the 100 MB request body limit of Pages Functions.

const MiB = 1024 * 1024;

export const MIN_PART_BYTES = 16 * MiB;
export const MAX_PART_BYTES = 64 * MiB;
/** Aim for at most this many parts (more only past 6.4 GiB). */
const TARGET_PARTS = 100;

/** Part URLs signed per request (each is a few HMACs of CPU time). */
export const SIGN_BATCH = 10;

/**
 * Whether a file of `size` bytes goes up in parts. A file that fits in one
 * part is a single PUT (B2's large files need at least two parts anyway).
 */
export const isMultipart = (size: number): boolean => size > MIN_PART_BYTES;

/** The part size for a file: a whole number of MiB, 16–64 MiB. */
export const partSizeFor = (size: number): number => {
  const wanted = Math.ceil(size / TARGET_PARTS / MiB) * MiB;
  return Math.min(MAX_PART_BYTES, Math.max(MIN_PART_BYTES, wanted));
};

export type PartPlan = { partSize: number; count: number };

export const planParts = (size: number): PartPlan => {
  const partSize = partSizeFor(size);
  return { partSize, count: Math.max(1, Math.ceil(size / partSize)) };
};

/** Bytes [start, end) of part `n` (1-based). */
export const partRange = (
  plan: PartPlan,
  size: number,
  n: number,
): { start: number; end: number } => {
  if (!Number.isInteger(n) || n < 1 || n > plan.count) {
    throw new RangeError(`no part ${n}`);
  }
  const start = (n - 1) * plan.partSize;
  return { start, end: Math.min(size, start + plan.partSize) };
};

/** Part numbers still to send, given the ones the bucket has. */
export const missingParts = (
  plan: PartPlan,
  done: Iterable<number>,
): number[] => {
  const have = new Set(done);
  const out: number[] = [];
  for (let n = 1; n <= plan.count; n++) if (!have.has(n)) out.push(n);
  return out;
};

/** A part the bucket has, as ListParts (or the R2 binding) reports it. */
export type UploadedPart = { partNumber: number; etag: string; size: number };

/** A part as the browser reports it after its PUT (no size: B2 checks). */
export type SentPart = Pick<UploadedPart, "partNumber" | "etag">;

/**
 * The browser's report of every part of the plan, in order, or null when
 * it is not exactly parts 1..count with an ETag each.
 */
export const sentParts = (
  plan: PartPlan,
  input: unknown,
): SentPart[] | null => {
  if (!Array.isArray(input) || input.length !== plan.count) return null;
  const out: SentPart[] = [];
  for (const [i, p] of input.entries()) {
    const o = p as Record<string, unknown> | null;
    if (
      !o ||
      o.partNumber !== i + 1 ||
      typeof o.etag !== "string" ||
      o.etag.length === 0 ||
      o.etag.length > 200
    ) {
      return null;
    }
    out.push({ partNumber: i + 1, etag: o.etag });
  }
  return out;
};

/**
 * Whether `parts` are exactly the plan's parts with the plan's sizes (what
 * must hold before CompleteMultipartUpload): null when they are, else the
 * part numbers that are missing or the wrong size.
 */
export const checkParts = (
  plan: PartPlan,
  size: number,
  parts: readonly UploadedPart[],
): number[] | null => {
  const byNumber = new Map(parts.map((p) => [p.partNumber, p]));
  const bad: number[] = [];
  for (let n = 1; n <= plan.count; n++) {
    const p = byNumber.get(n);
    const { start, end } = partRange(plan, size, n);
    if (!p || p.size !== end - start) bad.push(n);
  }
  return bad.length === 0 ? null : bad;
};

/** The plan's parts that the bucket has whole (a resume skips them). */
export const doneParts = (
  plan: PartPlan,
  size: number,
  parts: readonly UploadedPart[],
): number[] =>
  parts
    .filter((p) => {
      if (p.partNumber < 1 || p.partNumber > plan.count) return false;
      const { start, end } = partRange(plan, size, p.partNumber);
      return p.size === end - start;
    })
    .map((p) => p.partNumber)
    .sort((a, b) => a - b);

/** Valid part numbers for a sign request: 1..count, at most SIGN_BATCH. */
export const validPartNumbers = (
  plan: PartPlan,
  input: unknown,
): number[] | null => {
  if (!Array.isArray(input) || input.length === 0) return null;
  if (input.length > SIGN_BATCH) return null;
  const out: number[] = [];
  for (const n of input) {
    if (typeof n !== "number" || !Number.isInteger(n)) return null;
    if (n < 1 || n > plan.count || out.includes(n)) return null;
    out.push(n);
  }
  return out;
};
