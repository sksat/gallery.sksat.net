import type {
  CameraJSON,
  CameraKind,
  MediaCamera,
  MediaIndex,
  MediaInfo,
} from "./types";
import type { ImageSource } from "./images";

/** Slug of a photo's camera (`/camera/<slug>/`). */
export const cameraSlug = (camera: MediaCamera): string => camera.slug;

/** Display name of a photo's camera. */
export const cameraLabel = (camera: MediaCamera): string =>
  camera.name ||
  [camera.manufacturer, camera.model].filter(Boolean).join(" ") ||
  camera.slug;

export const cameraHref = (slug: string): string =>
  `/camera/${encodeURIComponent(slug)}/`;

/** The camera list page. */
export const CAMERA_LIST_HREF = "/camera/";

/**
 * Minimal camera records from the photos alone, for a camera the camera
 * list does not have: one per slug, name/manufacturer/model only.
 */
export const camerasFromMedia = (media: MediaIndex): CameraJSON[] => {
  const bySlug = new Map<string, CameraJSON>();
  // The camera it was taken with, and the one it was digitised with.
  for (const camera of media.flatMap((m) => [m.camera, m.digitizer ?? null])) {
    if (!camera) continue;
    const slug = cameraSlug(camera);
    if (bySlug.has(slug)) continue;
    bySlug.set(slug, {
      slug,
      name: cameraLabel(camera),
      manufacturer: camera.manufacturer,
      manufacturerUrl: null,
      model: camera.model,
      kind: null,
      description: null,
      productUrl: null,
      images: [],
      tags: [],
    });
  }
  return [...bySlug.values()];
};

const KINDS: readonly CameraKind[] = [
  "digital",
  "film",
  "phone",
  "virtual",
  "scanner",
];

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

// Rendered as a link: only http(s), never javascript: or data:.
const httpUrl = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && /^https?:\/\//i.test(s) ? s : null;
};

/**
 * Parse cameras from the API, dropping malformed entries rather than failing the
 * page. Returns null when the payload is not an array at all.
 */
export const parseCameras = (data: unknown): CameraJSON[] | null => {
  if (!Array.isArray(data)) return null;
  const out: CameraJSON[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const slug = str(o.slug);
    const name = str(o.name);
    if (!slug || !name) continue;
    out.push({
      slug,
      name,
      manufacturer: str(o.manufacturer),
      manufacturerUrl: httpUrl(o.manufacturerUrl),
      model: str(o.model),
      kind: KINDS.includes(o.kind as CameraKind)
        ? (o.kind as CameraKind)
        : null,
      description: str(o.description),
      productUrl: httpUrl(o.productUrl),
      images: Array.isArray(o.images)
        ? o.images.flatMap((img) => {
            if (!img || typeof img !== "object") return [];
            const { file, caption } = img as Record<string, unknown>;
            return isImagePath(file) ? [{ file, caption: str(caption) }] : [];
          })
        : [],
      // An older API has none.
      tags: Array.isArray(o.tags)
        ? [...new Set(o.tags.filter((t): t is string => str(t) !== null))]
        : [],
    });
  }
  return out;
};

/**
 * A bucket path the admin accepts for a camera image (validateImageFile in
 * admin/src/lib/validate.ts): it is appended to image URLs as-is, so
 * anything else is dropped.
 */
export const isImagePath = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length <= 500 &&
  /^(\/[A-Za-z0-9._-]+)+$/.test(v) &&
  !/\/\.{1,2}(\/|$)/.test(v) &&
  /\.(png|jpe?g)$/i.test(v);

/**
 * The camera for `slug`: its record when there is one (it has the
 * description, kind, ...), else what the photos alone tell us.
 */
export const findCamera = (
  cameras: CameraJSON[] | null,
  media: MediaIndex,
  slug: string,
): CameraJSON | null =>
  cameras?.find((c) => c.slug === slug) ??
  camerasFromMedia(media).find((c) => c.slug === slug) ??
  null;

/** Whether a photo was taken with the camera `slug`. */
export const takenWith = (m: MediaInfo, slug: string): boolean =>
  m.camera !== null && cameraSlug(m.camera) === slug;

/**
 * The photos digitised with the device `slug` (スキャン機材), newest
 * first: a camera page lists them apart from the ones taken with it.
 */
export const digitizedWith = (media: MediaIndex, slug: string): MediaIndex =>
  media.filter((m) => m.digitizer && cameraSlug(m.digitizer) === slug);

/** What a camera page says about the camera's photos. */
export type CameraFacts = {
  /** Public photos taken with it. */
  count: number;
  /**
   * The first and last dates they were taken, as public (calendar keys:
   * "2023-12-04", "2023-12" or "2023"); null when none is dated.
   */
  first: string | null;
  last: string | null;
  /** Public photos digitised (スキャン) with it. */
  digitized: number;
};

export const cameraFacts = (media: MediaIndex, slug: string): CameraFacts => {
  let count = 0;
  let first: string | null = null;
  let last: string | null = null;
  for (const m of media) {
    if (!takenWith(m, slug)) continue;
    count++;
    const key = m.takenDate ?? null;
    if (key === null) continue;
    // Keys of one shape order as text; a coarser key ("2023-12") sorts
    // before the days in it, and after the days of the months before.
    if (first === null || key < first) first = key;
    if (last === null || key > last) last = key;
  }
  return { count, first, last, digitized: digitizedWith(media, slug).length };
};

export type CameraSummary = {
  camera: CameraJSON;
  /** Photos taken or digitised (スキャン) with it. */
  count: number;
  /** Card image: the camera's first picture, else its newest photo. */
  cover: ImageSource | null;
};

/**
 * Cards for the camera list: every camera with at least one photo, most
 * photos first, then by name (Japanese order) and slug. Cameras with no
 * photos are left out — their page would be an empty grid.
 */
export const cameraSummaries = (
  media: MediaIndex,
  cameras: CameraJSON[] | null,
): CameraSummary[] => {
  const photos = new Map<string, MediaInfo[]>();
  // A photo counts for its camera and for its スキャン機材 (a scanner has
  // only those).
  for (const m of media) {
    // Once per device, even when both are the same row.
    const slugs = new Set(
      [m.camera, m.digitizer].flatMap((c) => (c ? [cameraSlug(c)] : [])),
    );
    for (const slug of slugs) {
      const own = photos.get(slug);
      if (own) own.push(m);
      else photos.set(slug, [m]);
    }
  }
  const bySlug = new Map(
    [...camerasFromMedia(media), ...(cameras ?? [])].map((c) => [c.slug, c]),
  );
  const out: CameraSummary[] = [];
  for (const [slug, own] of photos) {
    // The record wins over what the photos alone say (later in the map).
    const camera = bySlug.get(slug);
    if (!camera) continue;
    // Newest by timestamp; undated photos only when nothing is dated.
    let newest: MediaInfo | null = null;
    for (const m of own) {
      const t = m.timestamp?.getTime() ?? -Infinity;
      if (newest === null || t > (newest.timestamp?.getTime() ?? -Infinity)) {
        newest = m;
      }
    }
    out.push({
      camera,
      count: own.length,
      cover:
        camera.images.at(0)?.file ??
        (newest ? { id: newest.id, file: newest.file } : null),
    });
  }
  return out.sort(
    (a, b) =>
      b.count - a.count ||
      a.camera.name.localeCompare(b.camera.name, "ja") ||
      (a.camera.slug < b.camera.slug ? -1 : 1),
  );
};

/** What a camera link's card shows (camera-link.tsx). */
export type CameraPreview = {
  name: string;
  manufacturer: string | null;
  kind: CameraKind | null;
  /** Public photos taken or digitised with it, as the camera list counts. */
  count: number;
  /** Its first picture (a bucket path), if it has one. */
  picture: string | null;
  /** Its newest photos, newest first. */
  recent: { id: string; file: string | null }[];
};

/** How many of a camera's newest photos its card shows. */
export const PREVIEW_PHOTOS = 4;

/**
 * Every listed camera's card, by slug, from the lists the layout loaded
 * (no request of its own): the camera list's numbers (cameraSummaries)
 * and its newest photos, undated ones last.
 */
export const cameraPreviews = (
  media: MediaIndex,
  cameras: CameraJSON[] | null,
): Record<string, CameraPreview> => {
  const time = (m: MediaInfo) => m.timestamp?.getTime() ?? -Infinity;
  const out: Record<string, CameraPreview> = {};
  for (const { camera, count } of cameraSummaries(media, cameras)) {
    const recent = media
      .filter(
        (m) =>
          takenWith(m, camera.slug) ||
          (m.digitizer != null && cameraSlug(m.digitizer) === camera.slug),
      )
      .sort((a, b) => time(b) - time(a))
      .slice(0, PREVIEW_PHOTOS)
      .map((m) => ({ id: m.id, file: m.file }));
    out[camera.slug] = {
      name: camera.name,
      manufacturer: camera.manufacturer,
      kind: camera.kind,
      count,
      picture: camera.images.at(0)?.file ?? null,
      recent,
    };
  }
  return out;
};

export const CAMERA_KIND_LABELS: Record<CameraKind, string> = {
  digital: "デジタルカメラ",
  film: "フィルムカメラ",
  phone: "スマートフォン",
  virtual: "バーチャルカメラ",
  scanner: "スキャナー",
};

/** Camera slug from a `/camera/{slug}` path (trailing slash allowed). */
export const cameraSlugFromPath = (pathname: string): string | null => {
  const match = /^\/camera\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};
