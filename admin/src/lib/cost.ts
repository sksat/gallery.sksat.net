// The dashboard's cost card: what each service the gallery runs on is
// used for this month (or today, for daily limits), its free tier, and an
// estimate of the month's charge. Usage is measured (D1's file sizes, the
// GraphQL Analytics API); charges are estimates from the prices below.
//
// Analytics come through cachedGraphql (cf-graphql.ts: 5-min cache, never
// throws) with CF_ANALYTICS_API_TOKEN (Account Analytics: Read). Each
// service is its own query, so one dataset the token cannot read (or that
// Cloudflare renames) leaves the other rows alone.

import {
  ANALYTICS_CACHE_SECONDS,
  accountNode,
  cacheKeyUrl,
  cachedGraphql,
  finiteNumber,
  getAnalyticsToken,
  getStringVar,
  type GraphqlDeps,
} from "./cf-graphql";
import {
  D1_FREE_ROWS_READ_PER_DAY,
  D1_FREE_ROWS_WRITTEN_PER_DAY,
  utcDate,
  type D1UsageResult,
} from "./d1-usage";

// --- Prices (USD, checked 2026-11-23) --------------------------------------

// Backblaze B2 (https://www.backblaze.com/cloud-storage/pricing): $6.95
// per TB-month, decimal units. The account's free 10 GB is used elsewhere,
// so every byte is charged. Egress to Cloudflare is free (Bandwidth
// Alliance), so storage is the whole B2 bill.
export const B2_PRICE_USD_PER_GB_MONTH = 0.00695;
export const B2_PRICING_URL = "https://www.backblaze.com/cloud-storage/pricing";

// R2 Standard (https://developers.cloudflare.com/r2/pricing/): 10 GB-month,
// 1M Class A and 10M Class B operations free per month (per account), then
// $0.015/GB-month, $4.50/M Class A, $0.36/M Class B. Egress is free.
export const R2_FREE_GB_MONTH = 10;
export const R2_PRICE_USD_PER_GB_MONTH = 0.015;
export const R2_FREE_CLASS_A = 1_000_000;
export const R2_FREE_CLASS_B = 10_000_000;
export const R2_PRICE_USD_PER_M_CLASS_A = 4.5;
export const R2_PRICE_USD_PER_M_CLASS_B = 0.36;
export const R2_PRICING_URL = "https://developers.cloudflare.com/r2/pricing/";
/** The bucket of resized copies (MEDIA_CACHE in wrangler.jsonc). */
export const R2_BUCKET = "gallery-media-cache";

// Image Transformations (https://developers.cloudflare.com/images/pricing/):
// 5,000 unique transformations per calendar month free, then $0.50 per
// 1,000 (the account has the paid plan, so past the free ones they are
// charged rather than refused with 9422).
export const IMAGES_FREE_PER_MONTH = 5_000;
export const IMAGES_PRICE_USD_PER_1000 = 0.5;
export const IMAGES_PRICING_URL =
  "https://developers.cloudflare.com/images/pricing/";

// Workers Free (https://developers.cloudflare.com/workers/platform/pricing/):
// 100,000 requests per day across Workers and Pages Functions, reset at
// 00:00 UTC. Past it requests fail; nothing is charged. Requests a Worker
// makes to another through a service binding are not charged, but the
// analytics count them as invocations, so the measured number is an upper
// bound.
export const WORKERS_FREE_REQUESTS_PER_DAY = 100_000;
export const WORKERS_PRICING_URL =
  "https://developers.cloudflare.com/workers/platform/pricing/";

// D1 (Workers Free) limits are in d1-usage.ts; past them queries fail and
// nothing is charged.
export const D1_PRICING_URL =
  "https://developers.cloudflare.com/d1/platform/pricing/";

// Pages (https://developers.cloudflare.com/pages/functions/pricing/) and
// GitHub Actions for a public repository
// (https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)
// are free.
export const FREE_PRICING_URL =
  "https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions";

/** Where Cloudflare shows what it bills (the account's billing page). */
export const CLOUDFLARE_BILLING_URL =
  "https://dash.cloudflare.com/?to=/:account/billing";

// --- Cost math --------------------------------------------------------------

const over = (used: number, free: number) => Math.max(0, used - free);

/** B2 storage for `bytes` kept all month. */
export const b2CostUsd = (bytes: number): number =>
  (bytes / 1e9) * B2_PRICE_USD_PER_GB_MONTH;

/** R2 storage for `bytes` kept all month, after the free 10 GB. */
export const r2StorageCostUsd = (bytes: number): number =>
  over(bytes / 1e9, R2_FREE_GB_MONTH) * R2_PRICE_USD_PER_GB_MONTH;

export const r2OpsCostUsd = (classA: number, classB: number): number =>
  (over(classA, R2_FREE_CLASS_A) / 1e6) * R2_PRICE_USD_PER_M_CLASS_A +
  (over(classB, R2_FREE_CLASS_B) / 1e6) * R2_PRICE_USD_PER_M_CLASS_B;

export const imagesCostUsd = (unique: number): number =>
  (over(unique, IMAGES_FREE_PER_MONTH) / 1000) * IMAGES_PRICE_USD_PER_1000;

/** 00:00 UTC on the first of `now`'s month. */
export const monthStart = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * The share of the (UTC) month that has passed at `now`, at least one day,
 * so usage early on the 1st is not blown up into a huge month.
 */
export const monthElapsed = (now: Date): number => {
  const start = monthStart(now).getTime();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const day = 86_400_000;
  return Math.min(1, Math.max(day, now.getTime() - start) / (end - start));
};

/** Month-to-date usage carried on at the same pace to the end of the month. */
export const projectMonth = (used: number, now: Date): number =>
  used / monthElapsed(now);

// --- GraphQL ---------------------------------------------------------------

export type CostConfig = { token: string; accountId: string };

export const getCostConfig = (
  platform: { env?: Record<string, unknown> } | undefined,
): CostConfig | null => {
  const token = getAnalyticsToken(platform);
  const accountId = getStringVar(platform, "CF_ACCOUNT_ID");
  return token && accountId ? { token, accountId } : null;
};

/** A measurement from Analytics, or why there is none. */
export type Measured<T> =
  | { kind: "ok"; value: T }
  | { kind: "no-token" }
  | { kind: "error" };

export type R2Usage = {
  /** The bucket's newest size (payload + metadata), bytes. */
  bytes: number;
  objects: number;
  /** Operations this month (UTC) on the bucket. */
  classA: number;
  classB: number;
};

// R2's operation classes (https://developers.cloudflare.com/r2/pricing/).
// An action type not listed is counted as Class A, the dearer, so a new
// one never makes the estimate lower; the free ones are not counted.
const R2_CLASS_B = new Set([
  "HeadBucket",
  "HeadObject",
  "GetObject",
  "UsageSummary",
  "GetBucketEncryption",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketLifecycleConfiguration",
]);
const R2_FREE_OPS = new Set([
  "DeleteObject",
  "DeleteObjects",
  "DeleteBucket",
  "AbortMultipartUpload",
]);
export const r2OpClass = (actionType: string): "A" | "B" | "free" =>
  R2_FREE_OPS.has(actionType)
    ? "free"
    : R2_CLASS_B.has(actionType)
      ? "B"
      : "A";

// Storage: the newest sample of the last 31 days (the longest range the
// API takes; a bucket that changes nothing may have no recent one, and
// none at all is an empty bucket). Operations: this month so far, by
// action type.
export const R2_USAGE_QUERY = `query R2Usage($accountTag: string!, $bucket: string!, $storageSince: Time!, $monthStart: Time!, $now: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      storage: r2StorageAdaptiveGroups(
        limit: 1
        filter: { bucketName: $bucket, datetime_geq: $storageSince, datetime_leq: $now }
        orderBy: [datetime_DESC]
      ) {
        max { payloadSize metadataSize objectCount }
        dimensions { datetime }
      }
      operations: r2OperationsAdaptiveGroups(
        limit: 1000
        filter: { bucketName: $bucket, datetime_geq: $monthStart, datetime_leq: $now }
      ) {
        sum { requests }
        dimensions { actionType }
      }
    }
  }
}`;

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
/**
 * `now` cut to the cache period (5 minutes), so a request and its cache
 * key stay the same for as long as an answer is reused.
 */
const slot = (now: Date) => {
  const ms = ANALYTICS_CACHE_SECONDS * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
};

export const r2UsageRequestBody = (accountId: string, now: Date) => ({
  query: R2_USAGE_QUERY,
  variables: {
    accountTag: accountId,
    bucket: R2_BUCKET,
    storageSince: iso(new Date(slot(now).getTime() - 31 * 86_400_000)),
    monthStart: iso(monthStart(now)),
    now: iso(slot(now)),
  },
});

const objectOf = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : null;

export const parseR2Usage = (body: unknown): R2Usage | null => {
  const a = accountNode(body);
  if (!a) return null;
  const { storage, operations } = a;
  if (!Array.isArray(storage) || !Array.isArray(operations)) return null;
  const usage: R2Usage = { bytes: 0, objects: 0, classA: 0, classB: 0 };
  if (storage.length > 0) {
    const max = objectOf(objectOf(storage[0])?.max);
    const payload = finiteNumber(max?.payloadSize);
    const meta = finiteNumber(max?.metadataSize);
    const objects = finiteNumber(max?.objectCount);
    if (payload === null || objects === null) return null;
    usage.bytes = payload + (meta ?? 0);
    usage.objects = objects;
  }
  for (const g of operations) {
    const o = objectOf(g);
    const n = finiteNumber(objectOf(o?.sum)?.requests);
    const type = objectOf(o?.dimensions)?.actionType;
    if (n === null || typeof type !== "string") return null;
    const c = r2OpClass(type);
    if (c === "A") usage.classA += n;
    else if (c === "B") usage.classB += n;
  }
  return usage;
};

// Unique transformations of the account counted since the 1st (UTC), one
// row per day, each the running total: the newest (largest) is the month's.
// Not in Cloudflare's documentation (it is the dataset the dashboard's
// Images usage reads), so its absence is an error state, not a crash.
export const IMAGES_USAGE_QUERY = `query ImagesUsage($accountTag: string!, $monthStart: Date!, $today: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      imagesUniqueTransformationsAccumulatedSinceStartOfMonth(
        limit: 40
        filter: { date_geq: $monthStart, date_leq: $today }
        orderBy: [date_DESC]
      ) {
        date
        transformations
      }
    }
  }
}`;

export const imagesUsageRequestBody = (accountId: string, now: Date) => ({
  query: IMAGES_USAGE_QUERY,
  variables: {
    accountTag: accountId,
    monthStart: utcDate(monthStart(now)),
    today: utcDate(now),
  },
});

/** The month's unique transformations so far; no rows is none. */
export const parseImagesUsage = (body: unknown): number | null => {
  const rows =
    accountNode(body)?.imagesUniqueTransformationsAccumulatedSinceStartOfMonth;
  if (!Array.isArray(rows)) return null;
  let most = 0;
  for (const r of rows) {
    const n = finiteNumber(objectOf(r)?.transformations);
    if (n === null) return null;
    most = Math.max(most, n);
  }
  return most;
};

// Every Worker and Pages Function of the account today (UTC): the Free
// plan's limit is per account.
export const WORKERS_USAGE_QUERY = `query WorkersUsage($accountTag: string!, $dayStart: Time!, $now: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(
        limit: 10000
        filter: { datetime_geq: $dayStart, datetime_leq: $now }
      ) {
        sum { requests }
      }
    }
  }
}`;

export const workersUsageRequestBody = (accountId: string, now: Date) => ({
  query: WORKERS_USAGE_QUERY,
  variables: {
    accountTag: accountId,
    dayStart: `${utcDate(now)}T00:00:00Z`,
    now: iso(slot(now)),
  },
});

export const parseWorkersUsage = (body: unknown): number | null => {
  const groups = accountNode(body)?.workersInvocationsAdaptive;
  if (!Array.isArray(groups)) return null;
  let total = 0;
  for (const g of groups) {
    const n = finiteNumber(objectOf(objectOf(g)?.sum)?.requests);
    if (n === null) return null;
    total += n;
  }
  return total;
};

export type CostUsage = {
  r2: Measured<R2Usage>;
  images: Measured<number>;
  workers: Measured<number>;
};

/**
 * This month's R2 and Image Transformations usage and today's Workers
 * requests. Never throws: a failed query is that row's `error`.
 */
export const fetchCostUsage = async (
  cfg: CostConfig | null,
  deps: GraphqlDeps,
): Promise<CostUsage> => {
  if (!cfg) {
    const none = { kind: "no-token" } as const;
    return { r2: none, images: none, workers: none };
  }
  const { now } = deps;
  const ask = async <T>(
    name: string,
    body: unknown,
    parse: (json: unknown) => T | null,
    period: string,
  ): Promise<Measured<T>> => {
    const value = await cachedGraphql(
      {
        token: cfg.token,
        key: cacheKeyUrl("cost", name, cfg.accountId, period),
        body,
        parse,
        label: `cost ${name}`,
      },
      deps,
    );
    return value === null ? { kind: "error" } : { kind: "ok", value };
  };
  // Keyed by the period the request covers (its end is cut to 5 minutes).
  const at = iso(slot(now));
  const [r2, images, workers] = await Promise.all([
    ask("r2", r2UsageRequestBody(cfg.accountId, now), parseR2Usage, at),
    ask(
      "images",
      imagesUsageRequestBody(cfg.accountId, now),
      parseImagesUsage,
      utcDate(now),
    ),
    ask(
      "workers",
      workersUsageRequestBody(cfg.accountId, now),
      parseWorkersUsage,
      at,
    ),
  ]);
  return { r2, images, workers };
};

/**
 * The card's summary: B2 from `db` (null without a binding), the rest from
 * Analytics, D1 from the D1 card's `d1` (asked once). Never throws.
 */
export const loadCost = async (
  platform: { env?: Record<string, unknown> } | undefined,
  db: D1Database | null,
  d1: Promise<D1UsageResult>,
  deps: GraphqlDeps,
  label: string,
): Promise<CostSummary> => {
  const [b2, usage, d1Usage] = await Promise.all([
    db
      ? fetchB2Usage(db).catch((err) => {
          console.error(`${label}: B2 size query failed:`, err);
          return "error" as const;
        })
      : null,
    fetchCostUsage(getCostConfig(platform), deps),
    d1,
  ]);
  return summarizeCost({ b2, usage, d1: d1Usage }, deps.now);
};

// --- B2 from D1 --------------------------------------------------------------

/**
 * Every file the gallery keeps in B2 (originals, edits, display copies;
 * photos in the trash too, which B2 still stores), from the sizes D1 has.
 * Not B2's own count: old versions and unfinished uploads (whose rows
 * carry only the announced size) are missing, and camera pictures have no
 * size in D1.
 */
export const B2_BYTES_SQL = `SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS files
FROM media_file WHERE storage = 'b2' AND status = 'ready'`;

export type B2Usage = { bytes: number; files: number };

export const fetchB2Usage = async (db: D1Database): Promise<B2Usage> => {
  const r = await db.prepare(B2_BYTES_SQL).first<B2Usage>();
  return { bytes: Number(r?.bytes ?? 0), files: Number(r?.files ?? 0) };
};

// --- Rows -------------------------------------------------------------------

/** One measured amount against its free tier (null: none). */
export type Meter = {
  label: string;
  used: number;
  free: number | null;
  unit: "bytes" | "count";
};

export type CostRow = {
  key: "b2" | "r2" | "images" | "d1" | "workers" | "free";
  name: string;
  /** When the usage is counted. */
  period: "month" | "today" | "now" | null;
  /** Measured, or why not ("no-db": no D1 binding). */
  state: "ok" | "no-token" | "error" | "no-db";
  meters: Meter[];
  /** The month's estimated charge; null when unknown. */
  costUsd: number | null;
  /** The month's charge cannot go above zero (a free plan's hard limit). */
  alwaysFree: boolean;
  pricingUrl: string;
};

export type CostSummary = {
  rows: CostRow[];
  /** Sum of the known charges. */
  totalUsd: number;
  /** Some row's charge is unknown, so the total may be low. */
  partial: boolean;
};

export const summarizeCost = (
  input: {
    /** null without a D1 binding. */
    b2: B2Usage | null | "error";
    usage: CostUsage;
    /** Today's D1 usage, as the D1 card has it. */
    d1: D1UsageResult;
  },
  now: Date,
): CostSummary => {
  const { b2, usage, d1 } = input;
  const rows: CostRow[] = [];

  rows.push({
    key: "b2",
    name: "Backblaze B2",
    period: "now",
    state: b2 === null ? "no-db" : b2 === "error" ? "error" : "ok",
    meters:
      b2 && b2 !== "error"
        ? [{ label: "保存", used: b2.bytes, free: null, unit: "bytes" }]
        : [],
    costUsd: b2 && b2 !== "error" ? b2CostUsd(b2.bytes) : null,
    alwaysFree: false,
    pricingUrl: B2_PRICING_URL,
  });

  const r2 = usage.r2;
  rows.push({
    key: "r2",
    name: "R2",
    period: "month",
    state: r2.kind,
    meters:
      r2.kind === "ok"
        ? [
            {
              label: "保存",
              used: r2.value.bytes,
              free: R2_FREE_GB_MONTH * 1e9,
              unit: "bytes",
            },
            {
              label: "Class A",
              used: r2.value.classA,
              free: R2_FREE_CLASS_A,
              unit: "count",
            },
            {
              label: "Class B",
              used: r2.value.classB,
              free: R2_FREE_CLASS_B,
              unit: "count",
            },
          ]
        : [],
    costUsd:
      r2.kind === "ok"
        ? r2StorageCostUsd(r2.value.bytes) +
          r2OpsCostUsd(
            projectMonth(r2.value.classA, now),
            projectMonth(r2.value.classB, now),
          )
        : null,
    alwaysFree: false,
    pricingUrl: R2_PRICING_URL,
  });

  const images = usage.images;
  rows.push({
    key: "images",
    name: "Image Transformations",
    period: "month",
    state: images.kind,
    meters:
      images.kind === "ok"
        ? [
            {
              label: "変換",
              used: images.value,
              free: IMAGES_FREE_PER_MONTH,
              unit: "count",
            },
          ]
        : [],
    costUsd:
      images.kind === "ok"
        ? imagesCostUsd(projectMonth(images.value, now))
        : null,
    alwaysFree: false,
    pricingUrl: IMAGES_PRICING_URL,
  });

  rows.push({
    key: "d1",
    name: "D1",
    period: "today",
    state: d1.kind,
    meters:
      d1.kind === "ok"
        ? [
            {
              label: "読み取り",
              used: d1.usage.rowsRead,
              free: D1_FREE_ROWS_READ_PER_DAY,
              unit: "count",
            },
            {
              label: "書き込み",
              used: d1.usage.rowsWritten,
              free: D1_FREE_ROWS_WRITTEN_PER_DAY,
              unit: "count",
            },
          ]
        : [],
    costUsd: 0,
    alwaysFree: true,
    pricingUrl: D1_PRICING_URL,
  });

  const workers = usage.workers;
  rows.push({
    key: "workers",
    name: "Workers",
    period: "today",
    state: workers.kind,
    meters:
      workers.kind === "ok"
        ? [
            {
              label: "リクエスト",
              used: workers.value,
              free: WORKERS_FREE_REQUESTS_PER_DAY,
              unit: "count",
            },
          ]
        : [],
    costUsd: 0,
    alwaysFree: true,
    pricingUrl: WORKERS_PRICING_URL,
  });

  rows.push({
    key: "free",
    name: "Pages · GitHub Actions",
    period: null,
    state: "ok",
    meters: [],
    costUsd: 0,
    alwaysFree: true,
    pricingUrl: FREE_PRICING_URL,
  });

  return {
    rows,
    totalUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0),
    partial: rows.some((r) => r.costUsd === null),
  };
};
