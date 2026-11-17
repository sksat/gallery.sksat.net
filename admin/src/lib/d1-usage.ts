// D1 usage for the dashboard: the database size (from any query's
// meta.size_after, no token needed) and today's rows read / written from
// Cloudflare's GraphQL Analytics API, which needs the optional secret
// CF_ANALYTICS_API_TOKEN (an account API token with only "Account
// Analytics: Read"). Fetch and the cache are injected so the parsing is
// covered by Vitest.

// Workers Free plan limits (https://developers.cloudflare.com/d1/platform/limits/).
// Sizes are counted in decimal units like the rest of the dashboard.
export const D1_FREE_MAX_DB_BYTES = 500_000_000; // 500 MB per database
// Daily limits, reset at 00:00 UTC; hence "today (UTC)" below rather than
// the last 24 hours.
export const D1_FREE_ROWS_READ_PER_DAY = 5_000_000;
export const D1_FREE_ROWS_WRITTEN_PER_DAY = 100_000;

export const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
/** How long a GraphQL answer is reused, so dashboard loads do not hammer it. */
export const ANALYTICS_CACHE_SECONDS = 300;

export type D1DailyUsage = {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  readQueries: number;
  writeQueries: number;
  rowsRead: number;
  rowsWritten: number;
};

export type D1UsageResult =
  | { kind: "ok"; usage: D1DailyUsage }
  | { kind: "no-token" }
  | { kind: "error" };

export type AnalyticsConfig = {
  token: string;
  accountId: string;
  databaseId: string;
};

/** The Analytics settings, or null when the token (or ids) are not set. */
export const getAnalyticsConfig = (
  platform: { env?: Record<string, unknown> } | undefined,
): AnalyticsConfig | null => {
  const env = platform?.env ?? {};
  const token = env.CF_ANALYTICS_API_TOKEN;
  const accountId = env.CF_ACCOUNT_ID;
  const databaseId = env.D1_DATABASE_ID;
  return typeof token === "string" &&
    token &&
    typeof accountId === "string" &&
    accountId &&
    typeof databaseId === "string" &&
    databaseId
    ? { token, accountId, databaseId }
    : null;
};

export const utcDate = (now: Date): string => now.toISOString().slice(0, 10);

// The filter is written inline with scalar variables (no input type name
// to get wrong).
export const D1_USAGE_QUERY = `query D1Usage($accountTag: string!, $databaseId: string!, $date: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(
        limit: 10000
        filter: { databaseId: $databaseId, date_geq: $date, date_leq: $date }
      ) {
        sum { readQueries writeQueries rowsRead rowsWritten }
      }
    }
  }
}`;

export const d1UsageRequestBody = (
  cfg: Pick<AnalyticsConfig, "accountId" | "databaseId">,
  date: string,
) => ({
  query: D1_USAGE_QUERY,
  variables: {
    accountTag: cfg.accountId,
    databaseId: cfg.databaseId,
    date,
  },
});

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * The day's totals from a GraphQL response body, or null when it carries
 * errors or not the expected shape. No groups means no queries that day.
 */
export const parseD1Usage = (
  body: unknown,
  date: string,
): D1DailyUsage | null => {
  if (!body || typeof body !== "object") return null;
  const b = body as {
    errors?: unknown;
    data?: { viewer?: { accounts?: unknown } } | null;
  };
  if (Array.isArray(b.errors) && b.errors.length > 0) return null;
  const accounts = b.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) return null;
  const groups = (accounts[0] as { d1AnalyticsAdaptiveGroups?: unknown })
    ?.d1AnalyticsAdaptiveGroups;
  if (!Array.isArray(groups)) return null;
  const usage: D1DailyUsage = {
    date,
    readQueries: 0,
    writeQueries: 0,
    rowsRead: 0,
    rowsWritten: 0,
  };
  for (const g of groups) {
    const sum = (g as { sum?: Record<string, unknown> } | null)?.sum;
    if (!sum) return null;
    for (const k of [
      "readQueries",
      "writeQueries",
      "rowsRead",
      "rowsWritten",
    ] as const) {
      const v = num(sum[k]);
      if (v === null) return null;
      usage[k] += v;
    }
  }
  return usage;
};

/** The subset of the Workers Cache API used here (caches.default). */
export type SimpleCache = {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
};

type Deps = {
  fetch: typeof fetch;
  cache: SimpleCache | null;
  now: Date;
};

// The cache key is a URL of our own (never fetched), per account,
// database and day. The token is not part of it.
const cacheKey = (cfg: AnalyticsConfig, date: string) =>
  `https://admin-cache.invalid/d1-usage/${encodeURIComponent(cfg.accountId)}/${encodeURIComponent(cfg.databaseId)}/${date}`;

/**
 * Today's (UTC) D1 usage. Never throws: any failure is `{ kind: "error" }`
 * (logged), so the dashboard still renders. Only successful answers are
 * cached, for ANALYTICS_CACHE_SECONDS.
 */
export const fetchD1Usage = async (
  cfg: AnalyticsConfig | null,
  { fetch: doFetch, cache, now }: Deps,
): Promise<D1UsageResult> => {
  if (!cfg) return { kind: "no-token" };
  const date = utcDate(now);
  const key = cacheKey(cfg, date);
  try {
    const hit = await cache?.match(key);
    if (hit) {
      const usage = parseD1Usage(await hit.json(), date);
      if (usage) return { kind: "ok", usage };
    }
  } catch (err) {
    console.error("d1 usage: cache read failed:", err);
  }
  try {
    const res = await doFetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(d1UsageRequestBody(cfg, date)),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error("d1 usage: GraphQL HTTP", res.status);
      return { kind: "error" };
    }
    const text = await res.text();
    const usage = parseD1Usage(JSON.parse(text), date);
    if (!usage) {
      console.error(
        "d1 usage: unexpected GraphQL response:",
        text.slice(0, 500),
      );
      return { kind: "error" };
    }
    try {
      await cache?.put(
        key,
        new Response(text, {
          headers: {
            "content-type": "application/json",
            "cache-control": `max-age=${ANALYTICS_CACHE_SECONDS}`,
          },
        }),
      );
    } catch (err) {
      console.error("d1 usage: cache write failed:", err);
    }
    return { kind: "ok", usage };
  } catch (err) {
    console.error("d1 usage: GraphQL request failed:", err);
    return { kind: "error" };
  }
};

/** "12,345": thousands separators by hand (no Intl, as in format.ts). */
export const formatCount = (n: number): string =>
  Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
