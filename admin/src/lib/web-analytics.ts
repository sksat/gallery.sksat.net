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
export const DEFAULT_ACCESS_RANGE: AccessRange = "7d";

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

/** Hourly buckets for 24 h, daily (UTC) ones for 7 d / 30 d. */
export const bucketUnit = (range: AccessRange): "hour" | "day" =>
  range === "24h" ? "hour" : "day";

/**
 * The query window: the last 24 h, or the last N UTC days including today
 * (so each daily bucket is a whole day, today's so far).
 */
export const rangeWindow = (
  range: AccessRange,
  now: Date,
): { since: string; until: string } => {
  const end = now.getTime();
  const start =
    range === "24h"
      ? Math.floor(end / HOUR_MS) * HOUR_MS - 23 * HOUR_MS
      : Math.floor(end / DAY_MS) * DAY_MS -
        ((range === "7d" ? 7 : 30) - 1) * DAY_MS;
  return {
    since: new Date(start).toISOString().replace(/\.\d{3}Z$/, "Z"),
    until: new Date(end).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
};

/** Bucket keys of the window, oldest first: "2026-11-18T03" or "2026-11-18". */
export const bucketKeys = (range: AccessRange, now: Date): string[] => {
  const { since } = rangeWindow(range, now);
  const start = Date.parse(since);
  const n = range === "24h" ? 24 : range === "7d" ? 7 : 30;
  const step = range === "24h" ? HOUR_MS : DAY_MS;
  const len = range === "24h" ? 13 : 10;
  return Array.from({ length: n }, (_, i) =>
    new Date(start + i * step).toISOString().slice(0, len),
  );
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
// Referrers are read with room for the site's own hosts, which are dropped.
const REFERRER_LIMIT = 20;

// One request, aliased groups over the same filter (scalar variables, the
// filter inline). `count` is page views, `sum.visits` visits. Checked
// against the live API (max range per query 93 days, so 30 d fits).
export const accessQuery = (range: AccessRange): string => {
  const bucket = bucketUnit(range) === "hour" ? "datetimeHour" : "date";
  const f = `filter: { siteTag: $siteTag, requestHost: $host, datetime_geq: $since, datetime_leq: $until }`;
  return `query Access($accountTag: string!, $siteTag: string!, $host: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      total: rumPageloadEventsAdaptiveGroups(limit: 1, ${f}) {
        count
        sum { visits }
      }
      series: rumPageloadEventsAdaptiveGroups(limit: 100, ${f}, orderBy: [${bucket}_ASC]) {
        count
        sum { visits }
        dimensions { bucket: ${bucket} }
      }
      pages: rumPageloadEventsAdaptiveGroups(limit: ${PAGE_LIMIT}, ${f}, orderBy: [count_DESC]) {
        count
        sum { visits }
        dimensions { requestPath }
      }
      countries: rumPageloadEventsAdaptiveGroups(limit: ${TOP_LIMIT}, ${f}, orderBy: [count_DESC]) {
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
  query: accessQuery(range),
  variables: {
    accountTag: cfg.accountId,
    siteTag: cfg.siteTag,
    host: cfg.host,
    ...rangeWindow(range, now),
  },
});

export type Counts = { pageViews: number; visits: number };
export type AccessStats = {
  range: AccessRange;
  total: Counts;
  /** One entry per bucket of the window (zeros where nothing came). */
  series: ({ key: string } & Counts)[];
  pages: ({ path: string } & Counts)[];
  countries: { country: string; pageViews: number }[];
  referrers: { host: string; pageViews: number }[];
};

type Group = {
  count?: unknown;
  sum?: { visits?: unknown } | null;
  dimensions?: Record<string, unknown> | null;
};

const groupsOf = (node: Record<string, unknown>, alias: string) => {
  const g = node[alias];
  return Array.isArray(g) ? (g as (Group | null)[]) : null;
};

const countsOf = (g: Group | null, withVisits: boolean): Counts | null => {
  const pageViews = finiteNumber(g?.count);
  const visits = withVisits ? finiteNumber(g?.sum?.visits) : 0;
  return pageViews === null || visits === null ? null : { pageViews, visits };
};

const dimOf = (g: Group | null, name: string): string | null => {
  const v = g?.dimensions?.[name];
  return typeof v === "string" ? v : null;
};

/**
 * AccessStats from a GraphQL response body, or null when it has errors or
 * another shape. Bucket values may come back as "2026-11-18" or
 * "2026-11-18T03:00:00Z"; they are matched by their prefix.
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
  const seriesG = groupsOf(node, "series");
  const pagesG = groupsOf(node, "pages");
  const countriesG = groupsOf(node, "countries");
  const referrersG = groupsOf(node, "referrers");
  if (!totalG || !seriesG || !pagesG || !countriesG || !referrersG) {
    return null;
  }
  const total =
    totalG.length === 0
      ? { pageViews: 0, visits: 0 }
      : countsOf(totalG[0], true);
  if (!total) return null;

  const keys = bucketKeys(range, now);
  const len = keys[0]?.length ?? 10;
  const byKey = new Map(keys.map((k) => [k, { pageViews: 0, visits: 0 }]));
  for (const g of seriesG) {
    const b = dimOf(g, "bucket");
    const c = countsOf(g, true);
    if (b === null || !c) return null;
    const slot = byKey.get(b.slice(0, len));
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
  const countries: AccessStats["countries"] = [];
  for (const g of countriesG) {
    const country = dimOf(g, "countryName");
    const c = countsOf(g, false);
    if (country === null || !c) return null;
    countries.push({ country, pageViews: c.pageViews });
  }
  const referrers: AccessStats["referrers"] = [];
  for (const g of referrersG) {
    const host = dimOf(g, "refererHost");
    const c = countsOf(g, false);
    if (host === null || !c) return null;
    if (!isSelfReferrer(host, siteHost)) {
      referrers.push({ host, pageViews: c.pageViews });
    }
  }
  return {
    range,
    total,
    series: keys.map((key) => ({ key, ...byKey.get(key)! })),
    pages,
    countries,
    referrers: referrers.slice(0, TOP_LIMIT),
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

/**
 * The public id of a photo page, /photo/<public_id> with or without the
 * trailing slash; null for any other path (including old /photo/<N>
 * URLs).
 */
export const parsePhotoPath = (path: string): string | null => {
  const m = /^\/photo\/([^/?#]+)\/?$/.exec(path);
  return m && PUBLIC_ID_RE.test(m[1]) ? m[1] : null;
};

/** Page views and visits of one photo, adding up both forms of its path. */
export const photoCounts = (
  pages: AccessStats["pages"],
  publicId: string,
): Counts => {
  const out = { pageViews: 0, visits: 0 };
  for (const p of pages) {
    if (parsePhotoPath(p.path) === publicId) {
      out.pageViews += p.pageViews;
      out.visits += p.visits;
    }
  }
  return out;
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
