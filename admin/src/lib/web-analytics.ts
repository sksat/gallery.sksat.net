// Access numbers for the public site from Cloudflare Web Analytics (the
// beacon in the gallery's router-head), read through the GraphQL
// Analytics API (cf-graphql.ts; needs CF_ANALYTICS_API_TOKEN) by the
// site's tag and host, the non-secret vars WEB_ANALYTICS_SITE_TAG and
// WEB_ANALYTICS_HOST. The tag covers the whole sksat.net zone (the admin
// and the blog too), so every query also filters on the host. Only
// aggregate counts per page, country, referrer host and time bucket are
// read: nothing that identifies a visitor. The dataset is sampled, so
// the numbers are estimates (counts over longer ranges come in steps).

import {
  accountNode,
  cacheKeyUrl,
  cachedGraphql,
  finiteNumber,
  getAnalyticsToken,
  getStringVar,
  type GraphqlDeps,
} from "./cf-graphql";
import { PUBLIC_ID_RE } from "./public-id";

export const ACCESS_RANGES = ["24h", "7d", "30d"] as const;
export type AccessRange = (typeof ACCESS_RANGES)[number];
export const DEFAULT_ACCESS_RANGE: AccessRange = "24h";

export const ACCESS_RANGE_LABELS: Record<AccessRange, string> = {
  "24h": "24 時間",
  "7d": "7 日",
  "30d": "30 日",
};

/** The `range` query value; anything else is the default. */
export const parseAccessRange = (
  raw: string | null | undefined,
): AccessRange =>
  (ACCESS_RANGES as readonly string[]).includes(raw ?? "")
    ? (raw as AccessRange)
    : DEFAULT_ACCESS_RANGE;

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** Days start at midnight JST, like the rest of the admin. */
const JST_MS = 9 * HOUR_MS;

/**
 * The query window: the last 24 h, or the last N days (JST) including
 * today (so each daily bucket is a whole day, today's so far).
 */
export const rangeWindow = (
  range: AccessRange,
  now: Date,
): { since: string; until: string } => {
  const end = now.getTime();
  const start =
    range === "24h"
      ? Math.floor(end / HOUR_MS) * HOUR_MS - 23 * HOUR_MS
      : Math.floor((end + JST_MS) / DAY_MS) * DAY_MS -
        JST_MS -
        ((range === "7d" ? 7 : 30) - 1) * DAY_MS;
  return {
    since: new Date(start).toISOString().replace(/\.\d{3}Z$/, "Z"),
    until: new Date(end).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
};

/**
 * The window just before rangeWindow, as long as it: the 7 d window at
 * 10:00 (6 days and 10 hours) is compared with the 6 days and 10 hours
 * before it, so today's partial day is not set against a whole one.
 * Both ends inclusive (datetime_leq), so it ends a second before `since`.
 */
export const previousWindow = (
  range: AccessRange,
  now: Date,
): { prevSince: string; prevUntil: string } => {
  const { since, until } = rangeWindow(range, now);
  const s = Date.parse(since);
  const len = Date.parse(until) - s;
  const iso = (t: number) =>
    new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  return { prevSince: iso(s - len), prevUntil: iso(s - 1000) };
};

/**
 * The change from `prev` to `cur` as a ratio (0.12 = +12%), or null when
 * there is nothing to compare with (prev is 0).
 */
export const changeRatio = (cur: number, prev: number): number | null =>
  prev > 0 ? (cur - prev) / prev : null;

/**
 * The bucket a time falls in: its UTC hour "2026-11-18T03" for 24 h, its
 * JST day "2026-11-18" otherwise.
 */
export const bucketKeyOf = (range: AccessRange, t: number): string =>
  range === "24h"
    ? new Date(t).toISOString().slice(0, 13)
    : new Date(t + JST_MS).toISOString().slice(0, 10);

/** Bucket keys of the window, oldest first: "2026-11-18T03" or "2026-11-18". */
export const bucketKeys = (range: AccessRange, now: Date): string[] => {
  const { since } = rangeWindow(range, now);
  const start = Date.parse(since);
  const n = range === "24h" ? 24 : range === "7d" ? 7 : 30;
  const step = range === "24h" ? HOUR_MS : DAY_MS;
  return Array.from({ length: n }, (_, i) =>
    bucketKeyOf(range, start + i * step),
  );
};

/**
 * Series rows are read per hour (datetimeHour) for every range: the API's
 * `date` is a UTC day, so JST days are added up from hours. 30 days is
 * 720 rows (per path for a photo), well inside a query's 10,000.
 */
export const SERIES_ROWS = 30 * 24;

/** The bucket of a datetimeHour value, null when it is not a time. */
export const bucketOfValue = (
  range: AccessRange,
  value: string,
): string | null => {
  const t = Date.parse(value);
  return Number.isFinite(t) ? bucketKeyOf(range, t) : null;
};

export type WebAnalyticsConfig = {
  token: string;
  accountId: string;
  siteTag: string;
  /** requestHost of the public site, e.g. "gallery.sksat.net". */
  host: string;
};

export type AccessConfigResult =
  | { kind: "ok"; cfg: WebAnalyticsConfig }
  | { kind: "no-token" }
  | { kind: "no-site-tag" };

export const getWebAnalyticsConfig = (
  platform: { env?: Record<string, unknown> } | undefined,
): AccessConfigResult => {
  const token = getAnalyticsToken(platform);
  const accountId = getStringVar(platform, "CF_ACCOUNT_ID");
  if (!token || !accountId) return { kind: "no-token" };
  const siteTag = getStringVar(platform, "WEB_ANALYTICS_SITE_TAG");
  const host = getStringVar(platform, "WEB_ANALYTICS_HOST");
  if (!siteTag || !host) return { kind: "no-site-tag" };
  return { kind: "ok", cfg: { token, accountId, siteTag, host } };
};

/** How many pages are read per range (the ranking adds up their forms). */
export const PAGE_LIMIT = 1000;
export const TOP_LIMIT = 10;
/** Countries are read in full (there are fewer than 250) for the map. */
export const COUNTRY_LIMIT = 250;
// Referrers are read with room for the site's own hosts, which are dropped.
const REFERRER_LIMIT = 20;

// One request, aliased groups over the same filter (scalar variables, the
// filter inline). `count` is page views, `sum.visits` visits. Checked
// against the live API (max range per query 93 days, so 30 d fits).
export const accessQuery = (): string => {
  const f = `filter: { siteTag: $siteTag, requestHost: $host, datetime_geq: $since, datetime_leq: $until }`;
  return `query Access($accountTag: string!, $siteTag: string!, $host: string!, $since: Time!, $until: Time!, $prevSince: Time!, $prevUntil: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      total: rumPageloadEventsAdaptiveGroups(limit: 1, ${f}) {
        count
        sum { visits }
      }
      previous: rumPageloadEventsAdaptiveGroups(limit: 1, filter: { siteTag: $siteTag, requestHost: $host, datetime_geq: $prevSince, datetime_leq: $prevUntil }) {
        count
        sum { visits }
      }
      series: rumPageloadEventsAdaptiveGroups(limit: ${SERIES_ROWS}, ${f}, orderBy: [datetimeHour_ASC]) {
        count
        sum { visits }
        dimensions { bucket: datetimeHour }
      }
      pages: rumPageloadEventsAdaptiveGroups(limit: ${PAGE_LIMIT}, ${f}, orderBy: [count_DESC]) {
        count
        sum { visits }
        dimensions { requestPath }
      }
      countries: rumPageloadEventsAdaptiveGroups(limit: ${COUNTRY_LIMIT}, ${f}, orderBy: [count_DESC]) {
        count
        dimensions { countryName }
      }
      referrers: rumPageloadEventsAdaptiveGroups(limit: ${REFERRER_LIMIT}, ${f}, orderBy: [count_DESC]) {
        count
        dimensions { refererHost }
      }
    }
  }
}`;
};

export const accessRequestBody = (
  cfg: Pick<WebAnalyticsConfig, "accountId" | "siteTag" | "host">,
  range: AccessRange,
  now: Date,
) => ({
  query: accessQuery(),
  variables: {
    accountTag: cfg.accountId,
    siteTag: cfg.siteTag,
    host: cfg.host,
    ...rangeWindow(range, now),
    ...previousWindow(range, now),
  },
});

export type Counts = { pageViews: number; visits: number };
export type AccessStats = {
  range: AccessRange;
  total: Counts;
  /** The same counts over previousWindow. */
  previous: Counts;
  /** One entry per bucket of the window (zeros where nothing came). */
  series: ({ key: string } & Counts)[];
  pages: ({ path: string } & Counts)[];
  countries: { country: string; pageViews: number }[];
  referrers: { host: string; pageViews: number }[];
};

// Helpers shared with photo-analytics.ts, which reads the same dataset.

export type Group = {
  count?: unknown;
  sum?: { visits?: unknown } | null;
  dimensions?: Record<string, unknown> | null;
};

export const groupsOf = (node: Record<string, unknown>, alias: string) => {
  const g = node[alias];
  return Array.isArray(g) ? (g as (Group | null)[]) : null;
};

export const countsOf = (
  g: Group | null,
  withVisits: boolean,
): Counts | null => {
  const pageViews = finiteNumber(g?.count);
  const visits = withVisits ? finiteNumber(g?.sum?.visits) : 0;
  return pageViews === null || visits === null ? null : { pageViews, visits };
};

export const dimOf = (g: Group | null, name: string): string | null => {
  const v = g?.dimensions?.[name];
  return typeof v === "string" ? v : null;
};

/** A `limit: 1` total: no group is no traffic. */
export const totalOf = (groups: (Group | null)[]): Counts | null =>
  groups.length === 0 ? { pageViews: 0, visits: 0 } : countsOf(groups[0], true);

export const countriesOf = (
  groups: (Group | null)[],
): AccessStats["countries"] | null => {
  const out: AccessStats["countries"] = [];
  for (const g of groups) {
    const country = dimOf(g, "countryName");
    const c = countsOf(g, false);
    if (country === null || !c) return null;
    out.push({ country, pageViews: c.pageViews });
  }
  return out;
};

/** Referrers without the site's own hosts, the first TOP_LIMIT. */
export const referrersOf = (
  groups: (Group | null)[],
  siteHost: string,
): AccessStats["referrers"] | null => {
  const out: AccessStats["referrers"] = [];
  for (const g of groups) {
    const host = dimOf(g, "refererHost");
    const c = countsOf(g, false);
    if (host === null || !c) return null;
    if (!isSelfReferrer(host, siteHost)) {
      out.push({ host, pageViews: c.pageViews });
    }
  }
  return out.slice(0, TOP_LIMIT);
};

/**
 * AccessStats from a GraphQL response body, or null when it has errors or
 * another shape. Hourly rows ("2026-11-18T03:00:00Z") are added up into
 * the window's buckets (bucketOfValue); rows outside it are dropped.
 */
export const parseAccess = (
  body: unknown,
  range: AccessRange,
  now: Date,
  siteHost: string,
): AccessStats | null => {
  const node = accountNode(body);
  if (!node) return null;
  const totalG = groupsOf(node, "total");
  const previousG = groupsOf(node, "previous");
  const seriesG = groupsOf(node, "series");
  const pagesG = groupsOf(node, "pages");
  const countriesG = groupsOf(node, "countries");
  const referrersG = groupsOf(node, "referrers");
  if (
    !totalG ||
    !previousG ||
    !seriesG ||
    !pagesG ||
    !countriesG ||
    !referrersG
  ) {
    return null;
  }
  const total = totalOf(totalG);
  const previous = totalOf(previousG);
  if (!total || !previous) return null;

  const keys = bucketKeys(range, now);
  const byKey = new Map(keys.map((k) => [k, { pageViews: 0, visits: 0 }]));
  for (const g of seriesG) {
    const v = dimOf(g, "bucket");
    const b = v === null ? null : bucketOfValue(range, v);
    const c = countsOf(g, true);
    if (b === null || !c) return null;
    const slot = byKey.get(b);
    if (slot) {
      slot.pageViews += c.pageViews;
      slot.visits += c.visits;
    }
  }

  const pages: AccessStats["pages"] = [];
  for (const g of pagesG) {
    const path = dimOf(g, "requestPath");
    const c = countsOf(g, true);
    if (path === null || !c) return null;
    pages.push({ path, ...c });
  }
  const countries = countriesOf(countriesG);
  const referrers = referrersOf(referrersG, siteHost);
  if (!countries || !referrers) return null;
  return {
    range,
    total,
    previous,
    series: keys.map((key) => ({ key, ...byKey.get(key)! })),
    pages,
    countries,
    referrers,
  };
};

/**
 * Referrers that are the site itself: its host, its subdomains (the admin)
 * and Cloudflare Access's login pages.
 */
export const isSelfReferrer = (host: string, siteHost: string): boolean =>
  host === siteHost ||
  host.endsWith(`.${siteHost}`) ||
  host.endsWith(".cloudflareaccess.com");

export type AccessResult =
  | { kind: "ok"; stats: AccessStats }
  | { kind: "no-token" }
  | { kind: "no-site-tag" }
  | { kind: "error" };

/**
 * Access stats for `range`. Never throws: failures are `{ kind: "error" }`
 * (logged). Cached per site and range for ANALYTICS_CACHE_SECONDS, so a
 * cached answer is up to that much older than `now`.
 */
export const fetchAccess = async (
  config: AccessConfigResult,
  range: AccessRange,
  deps: GraphqlDeps,
): Promise<AccessResult> => {
  if (config.kind !== "ok") return config;
  const { cfg } = config;
  const stats = await cachedGraphql(
    {
      token: cfg.token,
      // The window's start is in the key, so a new hour/day starts afresh.
      key: cacheKeyUrl(
        "access",
        cfg.accountId,
        cfg.siteTag,
        cfg.host,
        range,
        rangeWindow(range, deps.now).since,
      ),
      body: accessRequestBody(cfg, range, deps.now),
      parse: (json) => parseAccess(json, range, deps.now, cfg.host),
      label: `access ${range}`,
    },
    deps,
  );
  return stats ? { kind: "ok", stats } : { kind: "error" };
};

/** Referrer host for display: "" is a direct visit (no referrer). */
export const referrerLabel = (host: string): string => host || "(直接)";

/**
 * Country name in Japanese for the ISO 3166-1 alpha-2 code Web Analytics
 * reports ("JP" -> "日本"), the code itself where the runtime cannot name
 * it.
 */
export const countryLabel = (code: string): string => {
  if (!/^[A-Z]{2}$/.test(code)) return code || "(不明)";
  try {
    const name = new Intl.DisplayNames(["ja"], { type: "region" }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
};
