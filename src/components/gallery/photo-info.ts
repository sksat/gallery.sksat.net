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

/** One shooting setting: 絞り f/2.8. */
export type ExposureSpec = { label: string; value: string };

/**
 * How the photo was exposed, setting by setting (絞り f/2.8, シャッター
 * 1/250 s, ISO 100, 焦点距離 35 mm), with only the values the API gave.
 * Null when there are none.
 */
export const exposureSpecs = (
  exif: MediaExif | null | undefined,
): ExposureSpec[] | null => {
  if (!exif) return null;
  const specs = [
    exif.f_number !== undefined && {
      label: "絞り",
      value: `f/${short(exif.f_number, 2)}`,
    },
    exif.exposure_time !== undefined && {
      label: "シャッター",
      value: `${exif.exposure_time} s`,
    },
    exif.iso !== undefined && {
      label: "ISO 感度",
      value: `ISO ${short(exif.iso, 0)}`,
    },
    exif.focal_length_mm !== undefined && {
      label: "焦点距離",
      value: `${short(exif.focal_length_mm, 1)} mm`,
    },
  ].filter((s): s is ExposureSpec => typeof s === "object");
  return specs.length > 0 ? specs : null;
};

/**
 * The date and the time of a taken-at text, apart, for a title that sets
 * them differently: "2023/12/16 23:12" → 2023/12/16 and 23:12.
 */
export const splitTaken = (
  text: string,
): { date: string; time: string | null } => {
  const at = text.indexOf(" ");
  return at === -1
    ? { date: text, time: null }
    : { date: text.slice(0, at), time: text.slice(at + 1) };
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
  exposure: ExposureSpec[] | null;
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
    exposure: exposureSpecs(m.exif),
    world,
    location: placeOf(m.id, m.location),
    tags: mediaTags(m),
    tagFields: groupTagFields(m.tag_fields),
    file: m.path ?? m.name ?? null,
  };
};

/**
 * The overlay's info: its details open or closed (to a one-line summary),
 * the viewer's last choice. Without one, the screen's default
 * (photo-overlay.tsx).
 */
export const INFO_SHOWN_KEY = "gallery.photo-info";
export const INFO_SHOWN = "shown";
export const INFO_HIDDEN = "hidden";

/** The stored choice: open, closed, or none made. */
export const infoChoiceFrom = (stored: string | null): boolean | null =>
  stored === INFO_SHOWN ? true : stored === INFO_HIDDEN ? false : null;

/**
 * The one-line summary of a photo's info, after its date (the first line
 * of the overlay's info): where (the world, else the place), the camera
 * and the exposure — 「rainshelter · VirtualLens2 · f/1.4 1/120 s」.
 * Null when there is none of them.
 */
export const infoSummary = (info: PhotoInfo): string | null => {
  const parts = [
    info.world?.name ?? info.location?.label,
    info.camera?.label,
    info.exposure?.map((s) => s.value).join(" "),
  ].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" · ") : null;
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
