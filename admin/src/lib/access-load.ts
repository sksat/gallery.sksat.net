// Loads the site's access numbers for a page (the dashboard's summary and
// /analytics/): the cached Web Analytics answer (web-analytics.ts) and its
// most viewed photos and pages, named from D1 with one IN lookup for the
// shown photos and one for the shown cameras. Without D1 (or if a lookup
// fails) the rows still show, photos and cameras by their path.

import {
  lookupsOf,
  rankingCameras,
  rankingPhotos,
  resolveRanking,
  splitRanking,
  type RankedPage,
} from "./page-ranking";
import {
  fetchAccess,
  getWebAnalyticsConfig,
  type AccessRange,
  type AccessResult,
} from "./web-analytics";
import type { GraphqlDeps } from "./cf-graphql";

export type AccessData = {
  range: AccessRange;
  /** Without its raw pages (up to PAGE_LIMIT): the lists below show them. */
  access: AccessResult;
  photos: RankedPage[];
  pages: RankedPage[];
};

export const loadAccess = async (
  platform: { env?: Record<string, unknown> } | undefined,
  db: D1Database | null,
  range: AccessRange,
  deps: GraphqlDeps,
  limits: { photos: number; pages: number },
  label: string,
): Promise<AccessData> => {
  const access = await fetchAccess(
    getWebAnalyticsConfig(platform),
    range,
    deps,
  );
  if (access.kind !== "ok") return { range, access, photos: [], pages: [] };
  const { photos: photosR, others: pagesR } = splitRanking(
    access.stats.pages,
    limits,
  );
  const { publicIds, slugs } = lookupsOf([...photosR, ...pagesR]);
  const [photos, cameras] = db
    ? await Promise.all([
        rankingPhotos(db, publicIds).catch((err) => {
          console.error(`${label}: photo lookup failed:`, err);
          return null;
        }),
        rankingCameras(db, slugs).catch((err) => {
          console.error(`${label}: camera lookup failed:`, err);
          return [];
        }),
      ])
    : [null, []];
  return {
    range,
    access: { kind: "ok", stats: { ...access.stats, pages: [] } },
    photos: resolveRanking(photosR, photos, cameras),
    pages: resolveRanking(pagesR, photos, cameras),
  };
};
