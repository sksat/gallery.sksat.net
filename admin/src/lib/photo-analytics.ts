// One photo's access numbers for its edit page (components/photo-access.tsx),
// from the same Web Analytics dataset as the dashboard (web-analytics.ts)
// but filtered on the photo's own paths: /photo/<public_id>/ (the viewer
// over a list, which the beacon counts on SPA navigation too) and
// /photo/<public_id>/detail/ (its detail page), each with and without the
// trailing slash. One request per photo and range, cached like the
// dashboard's (cf-graphql.ts), asked only when the card is on screen.

import {
  accountNode,
  cacheKeyUrl,
  cachedGraphql,
  type GraphqlDeps,
} from "./cf-graphql";
import { PUBLIC_ID_RE } from "./public-id";
import {
  bucketKeys,
  bucketUnit,
  countriesOf,
  countsOf,
  dimOf,
  groupsOf,
  previousWindow,
  rangeWindow,
  referrersOf,
  TOP_LIMIT,
  totalOf,
  type AccessConfigResult,
  type AccessRange,
  type AccessStats,
  type Counts,
  type WebAnalyticsConfig,
} from "./web-analytics";

/** The viewer's and the detail page's paths, each in both forms. */
export const photoPaths = (publicId: string) => ({
  viewer: [`/photo/${publicId}`, `/photo/${publicId}/`],
  detail: [`/photo/${publicId}/detail`, `/photo/${publicId}/detail/`],
});

/** Which of the photo's pages a path is; null for any other path. */
export const photoPageOf = (
  path: string,
  publicId: string,
): "viewer" | "detail" | null => {
  const p = photoPaths(publicId);
  return p.viewer.includes(path)
    ? "viewer"
    : p.detail.includes(path)
      ? "detail"
      : null;
};

// Series rows: one per bucket and path (up to 30 × 4).
const SERIES_LIMIT = 200;
const REFERRER_LIMIT = 20;

/**
 * The paths go into the filter inline (like the dashboard's, only scalar
 * variables): a public id is 10 letters and digits (checked by the
 * caller), so JSON quoting is all it needs.
 */
export const photoAccessQuery = (range: AccessRange, publicId: string) => {
  const p = photoPaths(publicId);
  const paths = JSON.stringify([...p.viewer, ...p.detail]);
  const bucket = bucketUnit(range) === "hour" ? "datetimeHour" : "date";
  const base = `siteTag: $siteTag, requestHost: $host, requestPath_in: ${paths}`;
  const f = `filter: { ${base}, datetime_geq: $since, datetime_leq: $until }`;
  return `query PhotoAccess($accountTag: string!, $siteTag: string!, $host: string!, $since: Time!, $until: Time!, $prevSince: Time!, $prevUntil: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      total: rumPageloadEventsAdaptiveGroups(limit: 1, ${f}) {
        count
        sum { visits }
      }
      previous: rumPageloadEventsAdaptiveGroups(limit: 1, filter: { ${base}, datetime_geq: $prevSince, datetime_leq: $prevUntil }) {
        count
        sum { visits }
      }
      series: rumPageloadEventsAdaptiveGroups(limit: ${SERIES_LIMIT}, ${f}, orderBy: [${bucket}_ASC]) {
        count
        dimensions { bucket: ${bucket} requestPath }
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

export type PhotoAccessStats = {
  range: AccessRange;
  total: Counts;
  previous: Counts;
  /** Page views per bucket, of the viewer and of the detail page. */
  series: { key: string; viewer: number; detail: number }[];
  /** Page views of the whole window, per page. */
  viewer: number;
  detail: number;
  countries: AccessStats["countries"];
  referrers: AccessStats["referrers"];
};

/** PhotoAccessStats from a response body, or null on errors or another shape. */
export const parsePhotoAccess = (
  body: unknown,
  range: AccessRange,
  now: Date,
  publicId: string,
  siteHost: string,
): PhotoAccessStats | null => {
  const node = accountNode(body);
  if (!node) return null;
  const totalG = groupsOf(node, "total");
  const previousG = groupsOf(node, "previous");
  const seriesG = groupsOf(node, "series");
  const countriesG = groupsOf(node, "countries");
  const referrersG = groupsOf(node, "referrers");
  if (!totalG || !previousG || !seriesG || !countriesG || !referrersG) {
    return null;
  }
  const total = totalOf(totalG);
  const previous = totalOf(previousG);
  const countries = countriesOf(countriesG);
  const referrers = referrersOf(referrersG, siteHost);
  if (!total || !previous || !countries || !referrers) return null;

  const keys = bucketKeys(range, now);
  const len = keys[0]?.length ?? 10;
  const byKey = new Map(keys.map((k) => [k, { viewer: 0, detail: 0 }]));
  for (const g of seriesG) {
    const b = dimOf(g, "bucket");
    const path = dimOf(g, "requestPath");
    const c = countsOf(g, false);
    if (b === null || path === null || !c) return null;
    const page = photoPageOf(path, publicId);
    const slot = byKey.get(b.slice(0, len));
    if (page && slot) slot[page] += c.pageViews;
  }
  const series = keys.map((key) => ({ key, ...byKey.get(key)! }));
  return {
    range,
    total,
    previous,
    series,
    viewer: series.reduce((s, b) => s + b.viewer, 0),
    detail: series.reduce((s, b) => s + b.detail, 0),
    countries,
    referrers,
  };
};

export type PhotoAccessResult =
  | { kind: "ok"; stats: PhotoAccessStats }
  | { kind: "no-token" }
  | { kind: "no-site-tag" }
  | { kind: "error" };

export const photoAccessRequestBody = (
  cfg: Pick<WebAnalyticsConfig, "accountId" | "siteTag" | "host">,
  range: AccessRange,
  publicId: string,
  now: Date,
) => ({
  query: photoAccessQuery(range, publicId),
  variables: {
    accountTag: cfg.accountId,
    siteTag: cfg.siteTag,
    host: cfg.host,
    ...rangeWindow(range, now),
    ...previousWindow(range, now),
  },
});

/**
 * One photo's access stats. Never throws (failures are `error`). Cached
 * per photo, range and window start, like fetchAccess.
 */
export const fetchPhotoAccess = async (
  config: AccessConfigResult,
  publicId: string,
  range: AccessRange,
  deps: GraphqlDeps,
): Promise<PhotoAccessResult> => {
  if (config.kind !== "ok") return config;
  if (!PUBLIC_ID_RE.test(publicId)) return { kind: "error" };
  const { cfg } = config;
  const stats = await cachedGraphql(
    {
      token: cfg.token,
      key: cacheKeyUrl(
        "photo-access",
        cfg.accountId,
        cfg.siteTag,
        cfg.host,
        publicId,
        range,
        rangeWindow(range, deps.now).since,
      ),
      body: photoAccessRequestBody(cfg, range, publicId, deps.now),
      parse: (json) =>
        parsePhotoAccess(json, range, deps.now, publicId, cfg.host),
      label: `photo access ${publicId} ${range}`,
    },
    deps,
  );
  return stats ? { kind: "ok", stats } : { kind: "error" };
};
