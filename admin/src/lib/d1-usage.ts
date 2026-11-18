// D1 usage for the dashboard: the database size (from any query's
// meta.size_after, no token needed) and today's rows read / written from
// the GraphQL Analytics API (cf-graphql.ts; needs CF_ANALYTICS_API_TOKEN).

import {
  accountNode,
  cacheKeyUrl,
  cachedGraphql,
  finiteNumber,
  getAnalyticsToken,
  getStringVar,
  type GraphqlDeps,
} from "./cf-graphql";

// Workers Free plan limits (https://developers.cloudflare.com/d1/platform/limits/).
// Sizes are counted in decimal units like the rest of the dashboard.
export const D1_FREE_MAX_DB_BYTES = 500_000_000; // 500 MB per database
// Daily limits, reset at 00:00 UTC; hence "today (UTC)" below rather than
// the last 24 hours.
export const D1_FREE_ROWS_READ_PER_DAY = 5_000_000;
export const D1_FREE_ROWS_WRITTEN_PER_DAY = 100_000;

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
  const token = getAnalyticsToken(platform);
  const accountId = getStringVar(platform, "CF_ACCOUNT_ID");
  const databaseId = getStringVar(platform, "D1_DATABASE_ID");
  return token && accountId && databaseId
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

/**
 * The day's totals from a GraphQL response body, or null when it carries
 * errors or not the expected shape. No groups means no queries that day.
 */
export const parseD1Usage = (
  body: unknown,
  date: string,
): D1DailyUsage | null => {
  const groups = accountNode(body)?.d1AnalyticsAdaptiveGroups;
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
      const v = finiteNumber(sum[k]);
      if (v === null) return null;
      usage[k] += v;
    }
  }
  return usage;
};

/**
 * Today's (UTC) D1 usage. Never throws: any failure is `{ kind: "error" }`
 * (logged), so the dashboard still renders.
 */
export const fetchD1Usage = async (
  cfg: AnalyticsConfig | null,
  deps: GraphqlDeps,
): Promise<D1UsageResult> => {
  if (!cfg) return { kind: "no-token" };
  const date = utcDate(deps.now);
  const usage = await cachedGraphql(
    {
      token: cfg.token,
      // Per account, database and day.
      key: cacheKeyUrl("d1-usage", cfg.accountId, cfg.databaseId, date),
      body: d1UsageRequestBody(cfg, date),
      parse: (json) => parseD1Usage(json, date),
      label: "d1 usage",
    },
    deps,
  );
  return usage ? { kind: "ok", usage } : { kind: "error" };
};
