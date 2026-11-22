// The photo's detail page (/photo/<id>/detail/): where its back link and previous / next
// go, from the list it was opened from (carried in its query).
import { findCamera } from "./cameras";
import {
  dateParam,
  galleryUrl,
  neighborIds,
  photoDetailUrl,
  visibleMedia,
} from "./logic";
import { parseSort, sortMedia, type SortOrder } from "./sort";
import { parseTagFilter, type TagFilter } from "./tags";
import type { CameraJSON, MediaIndex } from "./types";

export type PhotoContext = {
  filter: TagFilter;
  sort: SortOrder;
  /** The list's camera filter; an unknown `?camera=` is dropped. */
  camera: string | null;
  /** The list's calendar date (`?date=`). */
  date: string | null;
  /** The list itself. */
  backHref: string;
  prevHref: string | null;
  nextHref: string | null;
};

/**
 * The list a photo page belongs to, read from its query like the gallery
 * reads its own: the tag filter, sort order, `?camera=` and `?date=`. Previous and
 * next step through that list as the gallery's arrows do (every photo of
 * the camera, or every photo, when this one is not in the filter); an
 * unlisted photo is in no list, so it has neither.
 */
export const photoContext = (
  media: MediaIndex,
  cameras: CameraJSON[],
  id: string,
  params: URLSearchParams,
): PhotoContext => {
  const filter = parseTagFilter(params);
  const sort = parseSort(params);
  const slug = params.get("camera");
  const camera =
    slug && findCamera(cameras, media, slug) !== null ? slug : null;
  // A calendar date, as the gallery reads it.
  const date = dateParam(params);
  const ids = (f: TagFilter, d: string | null) =>
    sortMedia(visibleMedia(media, f, camera, d), sort).map((m) => m.value.id);
  // The arrows' fallback, as in the gallery: the date's photos when this
  // one is among them, else every photo (of the camera).
  const ofDate = ids({ tags: [], mode: filter.mode }, date);
  const around = neighborIds(
    id,
    ids(filter, date),
    ofDate.includes(id) ? ofDate : ids({ tags: [], mode: filter.mode }, null),
  );
  const href = (other: string | null) =>
    other === null ? null : photoDetailUrl(other, filter, sort, camera, date);
  return {
    filter,
    sort,
    camera,
    date,
    backHref: galleryUrl(filter, sort, camera, date),
    prevHref: href(around.prev),
    nextHref: href(around.next),
  };
};
