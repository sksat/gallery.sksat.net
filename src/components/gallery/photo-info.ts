// What the photo info panel (info-panel.tsx) shows, as plain values. Every
// function reads only what the API returned for the photo: a field it left
// out (null) stays out, and nothing is guessed from another field.
import { mapHrefFor, placeLabel } from "../map/places";
import { cameraHref, cameraLabel, cameraSlug } from "./cameras";
import { mediaTags } from "./tags";
import { takenAt, type TakenAt } from "./taken";
import type {
  MediaExif,
  MediaInfo,
  MediaLocation,
  MediaTagField,
  MediaWorld,
} from "./types";

/** A number without trailing zeros, to at most `digits` decimals. */
const short = (n: number, digits: number) => {
  const f = 10 ** digits;
  return String(Math.round(n * f) / f);
};

/**
 * How the photo was exposed, as one line: 「f/2.8 · 1/250 s · ISO 100 ·
 * 35 mm」, with only the values the API gave. Null when there are none.
 */
export const exposureLine = (
  exif: MediaExif | null | undefined,
): string | null => {
  if (!exif) return null;
  const parts = [
    exif.f_number !== undefined && `f/${short(exif.f_number, 2)}`,
    exif.exposure_time !== undefined && `${exif.exposure_time} s`,
    exif.iso !== undefined && `ISO ${short(exif.iso, 0)}`,
    exif.focal_length_mm !== undefined &&
      `${short(exif.focal_length_mm, 1)} mm`,
  ].filter((p): p is string => typeof p === "string");
  return parts.length > 0 ? parts.join(" · ") : null;
};

/**
 * The camera body as EXIF names it ("all" level): make and model, without
 * repeating the make when the model already starts with it ("Canon" +
 * "Canon EOS R5" → "Canon EOS R5").
 */
export const exifBody = (exif: MediaExif | null | undefined): string | null => {
  if (!exif) return null;
  const { make, model } = exif;
  if (make && model) {
    return model.toLowerCase().startsWith(make.toLowerCase())
      ? model
      : `${make} ${model}`;
  }
  return make ?? model ?? null;
};

/** The world's page on vrchat.com, when the API gave its id. */
export const worldHref = (world: MediaWorld | null | undefined) =>
  world?.id
    ? `https://vrchat.com/home/world/${encodeURIComponent(world.id)}`
    : null;

/**
 * Where a photo was taken, when its location is public: the place as
 * /map/ writes it (rounded to its level) and a link to the map on it.
 */
export const placeOf = (
  photoId: string,
  location: MediaLocation | null | undefined,
): { label: string; href: string } | null =>
  location
    ? {
        label: placeLabel(
          location.latitude,
          location.longitude,
          location.precision,
        ),
        href: mapHrefFor(photoId),
      }
    : null;

/**
 * The camera row: a link to its page, or the maker as text. Never the
 * EXIF body: when the API leaves the camera out, so does the panel.
 */
export type CameraInfo = { label: string; href: string | null };

export const cameraInfo = (m: MediaInfo): CameraInfo | null => {
  if (m.camera) {
    return {
      label: cameraLabel(m.camera),
      href: cameraHref(cameraSlug(m.camera)),
    };
  }
  return m.maker ? { label: m.maker, href: null } : null;
};

/** The スキャン機材 row, like the camera's. */
export const digitizerInfo = (m: MediaInfo): CameraInfo | null => {
  if (m.digitizer) {
    return {
      label: cameraLabel(m.digitizer),
      href: cameraHref(cameraSlug(m.digitizer)),
    };
  }
  return m.digitizerMaker ? { label: m.digitizerMaker, href: null } : null;
};

/** Everything the panel shows for a photo; null fields are left out. */
export type PhotoInfo = {
  taken: TakenAt | null;
  camera: CameraInfo | null;
  /** Digitised from an analog original: with what, and when. */
  digitizer: CameraInfo | null;
  digitized: TakenAt | null;
  /** The EXIF body, when it is not already the camera row. */
  body: string | null;
  lens: string | null;
  exposure: string | null;
  world: { name: string; href: string | null } | null;
  location: { label: string; href: string } | null;
  tags: string[];
  /** Each tag's fields with their values, in the API's order. */
  tagFields: TagFieldGroup[];
  /** The display path, else the file name. */
  file: string | null;
};

export type TagFieldGroup = {
  tag: string;
  fields: { label: string; value: string }[];
};

/** The API's tag_fields grouped by tag, keeping their order. */
export const groupTagFields = (
  fields: readonly MediaTagField[] | null | undefined,
): TagFieldGroup[] => {
  const groups: TagFieldGroup[] = [];
  for (const f of fields ?? []) {
    let g = groups.find((x) => x.tag === f.tag);
    if (!g) {
      g = { tag: f.tag, fields: [] };
      groups.push(g);
    }
    g.fields.push({ label: f.label, value: f.value });
  }
  return groups;
};

export const photoInfo = (m: MediaInfo): PhotoInfo => {
  const camera = cameraInfo(m);
  const body = exifBody(m.exif);
  const world =
    m.world && (m.world.name || m.world.id)
      ? {
          name: (m.world.name ?? m.world.id) as string,
          href: worldHref(m.world),
        }
      : null;
  return {
    taken: takenAt(m.takenIso ?? null, m.timestamp_precision),
    camera,
    digitizer: digitizerInfo(m),
    digitized: takenAt(m.digitized_at ?? null, m.digitized_at_precision),
    // Only next to a camera shown as a model (the API gives the body only
    // then, too).
    body: m.camera && body !== null && body !== camera?.label ? body : null,
    lens: m.exif?.lens ?? null,
    exposure: exposureLine(m.exif),
    world,
    location: placeOf(m.id, m.location),
    tags: mediaTags(m),
    tagFields: groupTagFields(m.tag_fields),
    file: m.path ?? m.name ?? null,
  };
};

/** Whether the panel has anything besides the tags to show. */
export const hasDetails = (info: PhotoInfo): boolean =>
  Boolean(
    info.taken ||
    info.camera ||
    info.digitizer ||
    info.digitized ||
    info.body ||
    info.lens ||
    info.exposure ||
    info.world ||
    info.location ||
    info.tagFields.length > 0 ||
    info.file,
  );

/**
 * The one-line summary at the overlay's bottom edge:
 * 「2023/12/16 23:12 · VirtualLens2 · Home」 (what of it is public).
 */
export const infoSummary = (info: PhotoInfo): string | null => {
  const parts = [info.taken?.text, info.camera?.label, info.world?.name].filter(
    (p): p is string => Boolean(p),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
};
