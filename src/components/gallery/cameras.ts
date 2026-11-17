import type {
  CameraJSON,
  CameraKind,
  MediaCamera,
  MediaIndex,
  MediaInfo,
} from "./types";

/**
 * Slug of a photo's camera. media.json written by the admin carries it;
 * older files only have make/model, so derive it the same way the admin's
 * migration did (lowercased model, ' ', '/', '_', '.' → '-').
 */
export const cameraSlug = (camera: MediaCamera): string => {
  if (camera.slug) return camera.slug;
  const base = camera.model
    .trim()
    .toLowerCase()
    .replace(/[ /_.]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base === "" || /[^a-z0-9-]/.test(base) ? "camera" : base;
};

/** Display name of a photo's camera. */
export const cameraLabel = (camera: MediaCamera): string =>
  camera.name || [camera.make, camera.model].filter(Boolean).join(" ");

export const cameraHref = (slug: string): string =>
  `/camera/${encodeURIComponent(slug)}/`;

/** The camera list page. */
export const CAMERA_LIST_HREF = "/camera/";

/**
 * Minimal camera records from media.json alone, for when cameras.json is
 * not published (yet): one per slug, name/manufacturer/model only.
 */
export const camerasFromMedia = (media: MediaIndex): CameraJSON[] => {
  const bySlug = new Map<string, CameraJSON>();
  for (const { camera } of media) {
    if (!camera) continue;
    const slug = cameraSlug(camera);
    if (bySlug.has(slug)) continue;
    bySlug.set(slug, {
      slug,
      name: cameraLabel(camera),
      manufacturer: camera.make || null,
      manufacturerUrl: null,
      model: camera.model || null,
      kind: null,
      description: null,
      productUrl: null,
      images: [],
    });
  }
  return [...bySlug.values()];
};

const KINDS: readonly CameraKind[] = ["digital", "film", "phone", "virtual"];

const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;

// Rendered as a link: only http(s), never javascript: or data:.
const httpUrl = (v: unknown): string | null => {
  const s = str(v);
  return s !== null && /^https?:\/\//i.test(s) ? s : null;
};

/**
 * Parse cameras.json, dropping malformed entries rather than failing the
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
 * The camera for `slug`: the cameras.json entry when there is one (it has
 * the description, kind, ...), else what media.json alone tells us.
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

export type CameraSummary = {
  camera: CameraJSON;
  /** Photos taken with it. */
  count: number;
  /** Card image: the camera's first picture, else its newest photo. */
  cover: string | null;
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
  for (const m of media) {
    if (!m.camera) continue;
    const slug = cameraSlug(m.camera);
    const own = photos.get(slug);
    if (own) own.push(m);
    else photos.set(slug, [m]);
  }
  const bySlug = new Map(
    [...camerasFromMedia(media), ...(cameras ?? [])].map((c) => [c.slug, c]),
  );
  const out: CameraSummary[] = [];
  for (const [slug, own] of photos) {
    // cameras.json wins over what media.json alone says (later in the map).
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
      cover: camera.images.at(0)?.file ?? newest?.file ?? null,
    });
  }
  return out.sort(
    (a, b) =>
      b.count - a.count ||
      a.camera.name.localeCompare(b.camera.name, "ja") ||
      (a.camera.slug < b.camera.slug ? -1 : 1),
  );
};

export const CAMERA_KIND_LABELS: Record<CameraKind, string> = {
  digital: "デジタルカメラ",
  film: "フィルムカメラ",
  phone: "スマートフォン",
  virtual: "バーチャルカメラ",
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
