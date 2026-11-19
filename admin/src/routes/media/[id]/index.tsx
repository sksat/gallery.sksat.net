import { $, component$, useSignal, useTask$, type QRL } from "@builder.io/qwik";
import {
  Form,
  Link,
  routeAction$,
  routeLoader$,
  useLocation,
  usePreventNavigate$,
  zod$,
  z,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { FileMetadata } from "~/components/file-metadata";
import { MissingBindingError } from "~/components/missing-binding-error";
import { PhotoViews } from "~/components/photo-views";
import { StatePanel } from "~/components/state-panel";
import { SubmitButton } from "~/components/submit-button";
import { Toast, type ToastState } from "~/components/toast";
import {
  backLink,
  buttonSecondary,
  buttonPrimary,
  card,
  field,
  label,
  link,
  muted,
  VISIBILITY_LABELS,
  PLATFORM_LABEL,
  platformBadge,
} from "~/components/ui";
import {
  digitizerOptions,
  getCamera,
  getMedia,
  listCameraOptions,
  type CameraOption,
  MAX_BULK_IDS,
  restoreVisibility,
  setVisibility,
  updateMedia,
} from "~/lib/db";
import {
  takenAtFromInput,
  takenAtInputValue,
  takenAtOffset,
} from "~/lib/taken-at-input";
import {
  PhotoPreview,
  type ApplyResult,
  type UndoChange,
} from "~/components/photo-preview";
import { LevelSelect, WithLevel } from "~/components/level-select";
import { ensureTags, getSiteDefaults, publicTags } from "~/lib/db-meta";
import {
  EDITABLE_FIELDS,
  EMBED_LABEL,
  type EditableField,
  type MetadataLevels,
} from "~/lib/metadata";
import type { FileExifJSON } from "~/lib/photo-meta";
import {
  changedGroups,
  EXIF_EDIT_KEYS,
  formGroups,
  type PhotoDataGroups,
} from "~/lib/photo-data";
import { markUnread } from "~/lib/read-state";
import { PhotoDataFields } from "~/components/photo-data-fields";
import { TagFieldInputs } from "~/components/tag-field-inputs";
import { fieldsOfTags, resolveTagValuePatch } from "~/lib/db-tag-field";
import { passedOnBy } from "~/lib/db-camera-tag";
import { inheritedOnly } from "@shared/tag-field/tag-field";
import { tagFieldPatch } from "~/lib/tag-field-form";
import type { TagFieldDef } from "@shared/tag-field/tag-field";
import { withoutViewer } from "~/lib/review-keys";
import { pendingBatches, type Pending } from "~/lib/review-pending";
import { VisibilityBadge } from "~/components/visibility-badge";
import {
  VISIBILITY_STYLE,
  VisibilityIcon,
} from "~/components/visibility-style";
import { getDB, getImageBase } from "~/lib/env";
import { contentChanged } from "~/lib/last-good";
import {
  formatJst,
  publicPhotoUrl,
  mediaAnchor,
  safeBackHref,
  splitPath,
} from "~/lib/format";
import { getNeighbors, parseListHref, type Neighbors } from "~/lib/neighbors";
import {
  moveItems,
  RestoreError,
  restoreItems,
  trashItems,
} from "~/lib/db-ops";
import { undoMoves, type Move } from "~/lib/file-ops";
import { VISIBILITIES, type MediaRow, type Visibility } from "~/lib/types";
import {
  parseCameraIdInput,
  parseTagsInput,
  validatePatch,
} from "~/lib/validate";

type MediaLoaderResult =
  | {
      kind: "ok";
      row: MediaRow;
      /** Previous / next in the list it was opened from; null if not in it. */
      neighbors: Neighbors | null;
      /** Options for the camera <select>, sorted by name. */
      cameras: CameraOption[];
      imageBase: string | null;
      /** The site's metadata visibility defaults (the selects' 既定). */
      defaults: MetadataLevels;
      /** Which of the photo's tags are public. */
      publicTags: string[];
      /** The fields of the photo's tags (0010). */
      tagFields: TagFieldDef[];
      /** Tags it has only through its camera (0011), in order. */
      inheritedTags: string[];
    }
  | { kind: "missing-binding" }
  | { kind: "bad-request" }
  | { kind: "not-found" };

export const useMedia = routeLoader$<MediaLoaderResult>(
  async ({ platform, params, query, status }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      status(400);
      return { kind: "bad-request" };
    }
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      // pnpm dev (vite-only) has no D1 binding. Render a generic message in
      // the UI; the verbose error stays in the worker logs only.
      console.error("/media/[id] loader: getDB failed:", err);
      status(500);
      return { kind: "missing-binding" };
    }
    // Step through the list this page was opened from (the whole list by
    // date without ?back=). The list pages by MAX_BULK_IDS.
    const list = parseListHref(safeBackHref(query.get("back")));
    // The row first: its place in the list is where the neighbours' keyset
    // lookups start.
    const row = await getMedia(db, id);
    if (!row) {
      status(404);
      return { kind: "not-found" };
    }
    // The tags its camera passes on count as its own (0011).
    const inheritedTags = inheritedOnly(
      row.tags,
      await passedOnBy(db, row.camera_id),
    );
    const allTags = [...row.tags, ...inheritedTags];
    const [cameras, neighbors, defaults, rowPublicTags, tagFields] =
      await Promise.all([
        listCameraOptions(db),
        getNeighbors(db, list, row, MAX_BULK_IDS),
        getSiteDefaults(db),
        publicTags(db, allTags),
        fieldsOfTags(db, allTags),
      ]);
    return {
      kind: "ok",
      row,
      neighbors,
      cameras,
      imageBase: getImageBase(platform),
      defaults,
      publicTags: rowPublicTags,
      tagFields,
      inheritedTags,
    };
  },
);

/**
 * The shooting data of the form (photo-data-fields.tsx), only the groups
 * edited since the page was loaded (`photo_data_loaded`): a page opened
 * before the file's metadata was read must not clear it on save.
 */
const photoDataPatch = (data: Record<string, string | undefined>) => {
  const raw = data.photo_data_loaded;
  if (raw === undefined) return {};
  let loaded: PhotoDataGroups;
  try {
    loaded = JSON.parse(raw) as PhotoDataGroups;
  } catch {
    return {};
  }
  const get = (name: string) => data[name];
  const changed = changedGroups(loaded, formGroups(get));
  return {
    ...(changed.includes("exif")
      ? {
          exif: Object.fromEntries(
            EXIF_EDIT_KEYS.map((k) => [k, get(`exif_${k}`) ?? ""]),
          ),
        }
      : {}),
    ...(changed.includes("location")
      ? { location: { latitude: get("latitude"), longitude: get("longitude") } }
      : {}),
    ...(changed.includes("world")
      ? { world_id: get("world_id") ?? "", world_name: get("world_name") ?? "" }
      : {}),
  };
};

/**
 * The 撮影日時, スキャン機材 and EXIF choice of the form, each only when
 * the form has it; the taken-at only when it was edited since the page
 * loaded (as typed: an unreadable one is sent as is for validatePatch to
 * reject).
 */
const digitizePatch = (data: {
  camera_id: string;
  camera_loaded?: string;
  digitized_with?: string;
  digitized_with_loaded?: string;
  embed_exif?: "" | "on" | "off";
  taken_at?: string;
  taken_at_loaded?: string;
  taken_at_offset?: string;
}) => {
  const out: Record<string, unknown> = {};
  // The camera and スキャン機材 only when changed on the page: the reader
  // may have set them since it loaded (device.ts), and a stale "(none)"
  // must not clear that and mark it chosen by hand. A form from before the
  // loaded values (an older page) sends a chosen device, never a "(none)".
  const changed = (value: string, loaded: string | undefined) =>
    loaded === undefined ? value !== "" : value !== loaded;
  if (changed(data.camera_id, data.camera_loaded)) {
    out.camera_id = parseCameraIdInput(data.camera_id);
  }
  if (
    data.digitized_with !== undefined &&
    changed(data.digitized_with, data.digitized_with_loaded)
  ) {
    out.digitized_with = parseCameraIdInput(data.digitized_with);
  }
  if (data.embed_exif !== undefined) {
    out.embed_exif = data.embed_exif === "" ? null : data.embed_exif === "on";
  }
  if (data.taken_at !== undefined && data.taken_at !== data.taken_at_loaded) {
    const ts = takenAtFromInput(data.taken_at, data.taken_at_offset ?? "");
    out.timestamp = ts === undefined ? data.taken_at : ts;
  }
  return out;
};

export const useUpdateMedia = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return fail(400, { message: "invalid id" });
    }
    // The flat string fields (the tag fields' objects apart).
    const { tf, tfv, ...flat } = data;
    const form = flat as Record<string, string | undefined>;
    // Route the form data through the same validator the API uses so the
    // contract has a single source of truth. A malformed camera value
    // (undefined here) is passed through as-is for validatePatch to reject.
    const v = validatePatch({
      platform: data.platform,
      tags: parseTagsInput(data.tags ?? ""),
      visibility: data.visibility,
      // "" = the site's default for that field.
      ...(data.mv_file_name !== undefined
        ? {
            metadata_visibility: Object.fromEntries(
              EDITABLE_FIELDS.map((f) => [f, form[`mv_${f}`] ?? ""]),
            ),
          }
        : {}),
      ...photoDataPatch(form),
      ...digitizePatch(data),
      ...tagFieldPatch(data.tag_fields_loaded, tf, tfv),
    });
    if (!v.ok) {
      return fail(400, { message: v.error });
    }
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/media/[id] action: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    if (
      v.patch.camera_id != null &&
      !(await getCamera(db, v.patch.camera_id))
    ) {
      return fail(400, { message: "unknown camera" });
    }
    if (
      v.patch.digitized_with != null &&
      !(await getCamera(db, v.patch.digitized_with))
    ) {
      return fail(400, { message: "unknown スキャン機材" });
    }
    const checked = await resolveTagValuePatch(
      db,
      v.patch.tag_values,
      v.patch.tag_value_visibility,
    );
    if (!checked.ok) return fail(400, { message: checked.error });
    v.patch.tag_values = checked.values;
    v.patch.tag_value_visibility = checked.levels;
    const updated = await updateMedia(db, id, v.patch);
    if (!updated) {
      return fail(404, { message: "not found" });
    }
    await contentChanged(db);
    // Tags seen for the first time get a row, private: say so.
    const newTags = await ensureTags(db, v.patch.tags ?? []);
    return { ok: true, updated_at: updated.updated_at, newTags };
  },
  zod$({
    platform: z.enum(["Real", "VRChat"]),
    // Required (no default): a submission without the field must not
    // silently clear the photo's camera. "" = none.
    camera_id: z.string().max(20),
    camera_loaded: z.string().max(20).optional(),
    digitized_with_loaded: z.string().max(20).optional(),
    tags: z.string().max(2000).default(""),
    // Required: a submission without it must not change who can see the
    // photo.
    visibility: z.enum(VISIBILITIES),
    mv_file_name: z.string().max(20).optional(),
    mv_taken_at: z.string().max(20).optional(),
    mv_camera: z.string().max(20).optional(),
    mv_tags: z.string().max(20).optional(),
    mv_exif: z.string().max(20).optional(),
    mv_world: z.string().max(20).optional(),
    mv_location: z.string().max(20).optional(),
    mv_digitizer: z.string().max(20).optional(),
    mv_digitized_at: z.string().max(20).optional(),
    // Left out: unchanged (an older page, or a form without them).
    digitized_with: z.string().max(20).optional(),
    embed_exif: z.enum(["", "on", "off"]).optional(),
    taken_at: z.string().max(40).optional(),
    taken_at_loaded: z.string().max(40).optional(),
    taken_at_offset: z.string().max(10).optional(),
    exif_make: z.string().max(400).optional(),
    exif_model: z.string().max(400).optional(),
    exif_lens: z.string().max(400).optional(),
    exif_focal_length_mm: z.string().max(40).optional(),
    exif_f_number: z.string().max(40).optional(),
    exif_exposure_time: z.string().max(40).optional(),
    exif_iso: z.string().max(40).optional(),
    world_id: z.string().max(400).optional(),
    world_name: z.string().max(400).optional(),
    latitude: z.string().max(40).optional(),
    longitude: z.string().max(40).optional(),
    photo_data_loaded: z.string().max(4000).optional(),
    // Tag fields (tag-field-inputs.tsx): f<id> → value / level.
    tf: z.record(z.string().max(20), z.string().max(400)).optional(),
    tfv: z.record(z.string().max(20), z.string().max(20)).optional(),
    tag_fields_loaded: z.string().max(40_000).optional(),
  }),
);

/** Most pending choices one 反映 applies. */
const MAX_PENDING = 2000;

const changeSchema = z
  .array(
    z.object({
      id: z.number().int().positive(),
      visibility: z.enum(VISIBILITIES),
    }),
  )
  .min(1)
  .max(MAX_PENDING);

/**
 * 反映 of the viewer's pending choices: the same bulk update as /media
 * (setVisibility, at most MAX_BULK_IDS ids at a time), grouped by the new
 * visibility. Returns, for undo, each changed photo's new and previous
 * visibility.
 */
export const useApplyPending = routeAction$(
  async (data, { platform, fail }) => {
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/media/[id] apply: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    const pending: Pending = {};
    for (const c of data.changes) {
      // from/file are only for the viewer; the update needs id and target.
      pending[c.id] = { to: c.visibility, from: c.visibility, file: "" };
    }
    const undo: { id: number; from: Visibility; to: Visibility }[] = [];
    try {
      for (const batch of pendingBatches(pending, MAX_BULK_IDS)) {
        const { previous } = await setVisibility(
          db,
          batch.ids,
          batch.visibility,
        );
        for (const p of previous) {
          undo.push({ id: p.id, from: batch.visibility, to: p.visibility });
        }
      }
    } catch (err) {
      // Each chunk commits on its own: the ones before stay applied, and
      // their undo goes back with the error.
      console.error("/media/[id] apply failed:", err);
      await contentChanged(db);
      return fail(500, { message: "update failed", undo });
    }
    await contentChanged(db);
    return { ok: true, changed: undo.length, undo };
  },
  zod$({ changes: changeSchema }),
);

/**
 * Undo of a 反映: each photo back to its previous visibility, if it still
 * has the one 反映 set (restoreVisibility), grouped and capped like it.
 */
/**
 * Set one shooting-data field back to what the file says: emptied, no
 * longer 'manual', and read again by the metadata reader.
 */
export const useResetFromFile = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return fail(400, { message: "invalid id" });
    }
    const v = validatePatch({ reset_from_file: [data.field] });
    if (!v.ok) return fail(400, { message: v.error });
    const db = getDB(platform);
    const updated = await updateMedia(db, id, v.patch);
    if (!updated) return fail(404, { message: "not found" });
    await contentChanged(db);
    return { ok: true };
  },
  zod$({ field: z.enum(["exif", "world", "location"]) }),
);

export const useUndoPending = routeAction$(
  async (data, { platform, fail }) => {
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/media/[id] undo: getDB failed:", err);
      return fail(500, { message: "D1 binding unavailable" });
    }
    let changed = 0;
    try {
      for (const from of VISIBILITIES) {
        for (const to of VISIBILITIES) {
          const ids = data.changes
            .filter((c) => c.from === from && c.to === to)
            .map((c) => c.id);
          for (let i = 0; i < ids.length; i += MAX_BULK_IDS) {
            changed += await restoreVisibility(db, from, [
              { visibility: to, ids: ids.slice(i, i + MAX_BULK_IDS) },
            ]);
          }
        }
      }
    } catch (err) {
      console.error("/media/[id] undo failed:", err);
      await contentChanged(db);
      return fail(500, { message: "undo failed" });
    }
    await contentChanged(db);
    return { ok: true, changed };
  },
  zod$({
    changes: z
      .array(
        z.object({
          id: z.number().int().positive(),
          from: z.enum(VISIBILITIES),
          to: z.enum(VISIBILITIES),
        }),
      )
      .min(1)
      .max(MAX_PENDING),
  }),
);

const actionId = (raw: string): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/**
 * Move or rename the photo: a new display path (folder + name). The B2
 * object keeps its key. A taken name is refused.
 */
export const useMovePhoto = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = actionId(params.id);
    if (id === null) return fail(400, { message: "invalid id" });
    const db = getDB(platform);
    const r = await moveItems(db, [
      { kind: "photo", id, to: data.path.trim() },
    ]);
    if (!r.ok) return fail(409, { message: r.error });
    await contentChanged(db);
    return { ok: true, undo: undoMoves(r.plan) };
  },
  zod$({ path: z.string().max(600) }),
);

/** Undo of a move: the moves the move action returned. */
export const useUndoMove = routeAction$(
  async (data, { platform, fail }) => {
    const db = getDB(platform);
    const r = await moveItems(db, data.moves);
    if (!r.ok) return fail(409, { message: r.error });
    await contentChanged(db);
    return { ok: true };
  },
  zod$({
    moves: z
      .array(
        z.union([
          z.object({
            kind: z.literal("photo"),
            id: z.number().int().positive(),
            to: z.string().max(600),
          }),
          z.object({
            kind: z.literal("folder"),
            from: z.string().max(600),
            to: z.string().max(600),
          }),
        ]),
      )
      .max(10_000),
  }),
);

/** Put the photo in the trash, or take it out. */
export const useTrashPhoto = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = actionId(params.id);
    if (id === null) return fail(400, { message: "invalid id" });
    const db = getDB(platform);
    if (data.restore === "true") {
      try {
        const r = await restoreItems(db, [id]);
        await contentChanged(db);
        return { ok: true, restored: r.restored[0]?.path ?? null };
      } catch (err) {
        if (err instanceof RestoreError) {
          return fail(409, { message: err.message });
        }
        throw err;
      }
    }
    await trashItems(db, { photos: [id], folders: [] });
    await contentChanged(db);
    return { ok: true, restored: null };
  },
  zod$({ restore: z.string().max(5).optional() }),
);

/** What each visibility means on the public site. */
const VISIBILITY_HELP: Record<Visibility, string> = {
  private: "Only in the admin. The public site answers 404.",
  unlisted: "Opens from its URL, but never shown in the gallery list.",
  public: "Listed in the gallery.",
};

const legend = "text-sm font-semibold text-zinc-900 dark:text-zinc-100";

/** A small camera: a tag that comes from the photo's camera. */
const CameraGlyph = () => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    class="size-3.5 shrink-0"
  >
    <path
      fill-rule="evenodd"
      d="M1 8a2 2 0 0 1 2-2h.93a2 2 0 0 0 1.66-.89l.82-1.22A2 2 0 0 1 8.07 3h3.86a2 2 0 0 1 1.66.89l.82 1.22a2 2 0 0 0 1.66.89H17a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8Zm13.5 3.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10 14a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
      clip-rule="evenodd"
    />
  </svg>
);

/** Whether the public site shows a field that has (or lacks) a value. */
const shows = (row: MediaRow, hasValue: boolean) =>
  hasValue && row.visibility !== "private";

/** The form's id, for the ファイル名 level that sits by 場所と名前. */
const MEDIA_FORM = "media-form";

/**
 * スキャン機材: the camera row it was digitised with (scanners first).
 * Uploads and the metadata reader fill it from a scanner's file
 * (device.ts), creating the row when needed.
 */
const DigitizerField = component$<{
  row: MediaRow;
  cameras: CameraOption[];
  defaults: MetadataLevels;
}>(({ row, cameras, defaults }) => {
  return (
    <div>
      <label for="edit-digitizer" class={label}>
        スキャン機材
      </label>
      <input
        type="hidden"
        name="digitized_with_loaded"
        value={row.digitized_with === null ? "" : String(row.digitized_with)}
      />
      <WithLevel
        level={
          <LevelSelect
            field="digitizer"
            value={row.metadata_visibility.digitizer ?? ""}
            siteDefault={defaults.digitizer}
            live={shows(row, row.digitized_with !== null)}
          />
        }
      >
        <select id="edit-digitizer" name="digitized_with" class={field}>
          <option value="" selected={row.digitized_with === null}>
            (none)
          </option>
          {digitizerOptions(cameras).map((c) => (
            <option
              key={c.id}
              value={String(c.id)}
              selected={row.digitized_with === c.id}
            >
              {c.name}
            </option>
          ))}
        </select>
      </WithLevel>
    </div>
  );
});

/** A level with no control on the page: saved as it is. */
const KeptLevel = ({
  row,
  field: f,
}: {
  row: MediaRow;
  field: EditableField;
}) => (
  <input
    type="hidden"
    name={`mv_${f}`}
    value={row.metadata_visibility[f] ?? ""}
  />
);

/**
 * The ファイル名 level, by 場所と名前 (outside the form, but saved with
 * it). A component of its own for the same reason as MediaFields.
 */
const FileNameLevel = component$<{
  row: MediaRow;
  defaults: MetadataLevels;
  onChange$: QRL<() => void>;
}>(({ row, defaults, onChange$ }) => (
  <LevelSelect
    field="file_name"
    value={row.metadata_visibility.file_name ?? ""}
    siteDefault={defaults.file_name}
    live={shows(row, true)}
    form={MEDIA_FORM}
    onChange$={onChange$}
  />
));

/** The file's own EXIF as read (admin only), folded. */
const FileExifDetails = component$<{ exif: FileExifJSON }>(({ exif }) => (
  <details class="text-sm" data-testid="file-exif">
    <summary class={["cursor-pointer", muted]}>ファイルの EXIF</summary>
    <dl class="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
      {Object.entries(exif).map(([k, v]) => (
        <div key={k} class="contents">
          <dt class={muted}>{k}</dt>
          <dd class="break-all">{String(v)}</dd>
        </div>
      ))}
    </dl>
  </details>
));

/**
 * The editable fields. A component of its own so that the page re-rendering
 * (unsaved mark, busy state, folding) never re-applies the saved values'
 * `checked` / `selected` / `value` over what the user just picked; it
 * re-renders only when the row itself changes (saved, or another photo).
 */
const MediaFields = component$<{
  row: MediaRow;
  cameras: CameraOption[];
  defaults: MetadataLevels;
  publicTags: string[];
  onReset$: QRL<(field: "exif" | "world" | "location") => void>;
  tagFields: TagFieldDef[];
  inheritedTags: string[];
}>(
  ({
    row,
    cameras,
    defaults,
    publicTags,
    onReset$,
    tagFields,
    inheritedTags,
  }) => (
    <>
      <fieldset class="space-y-3">
        <legend class={legend}>Visibility</legend>
        <div class="grid gap-2 sm:grid-cols-3">
          {VISIBILITIES.map((v) => (
            <label
              key={v}
              // The level's icon and colour (visibility-style.tsx), tinted
              // once checked.
              class={[
                "flex cursor-pointer gap-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800",
                VISIBILITY_STYLE[v].card,
              ]}
            >
              <input
                type="radio"
                name="visibility"
                value={v}
                checked={row.visibility === v}
                class="mt-0.5"
              />
              <span>
                <span
                  class={[
                    "flex items-center gap-1.5 font-medium",
                    VISIBILITY_STYLE[v].accent,
                  ]}
                >
                  <VisibilityIcon visibility={v} />
                  {VISIBILITY_LABELS[v]}
                </span>
                <span class={["block text-xs", muted]}>
                  {VISIBILITY_HELP[v]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Levels whose control is not shown keep their value. */}
      {row.trashed_at && <KeptLevel row={row} field="file_name" />}
      {!row.digitized_at && <KeptLevel row={row} field="digitized_at" />}

      <fieldset class="space-y-3" data-testid="photo-data">
        <legend class={legend}>撮影データ</legend>
        <PhotoDataFields row={row} defaults={defaults} onReset$={onReset$} />
      </fieldset>

      <fieldset class="space-y-3">
        <legend class={legend}>Category</legend>
        <div class="max-w-xs">
          <label for="edit-platform" class={label}>
            {PLATFORM_LABEL}
          </label>
          <select id="edit-platform" name="platform" class={field}>
            <option value="Real" selected={row.platform === "Real"}>
              Real
            </option>
            <option value="VRChat" selected={row.platform === "VRChat"}>
              VRChat
            </option>
          </select>
        </div>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class={legend}>Camera</legend>
        <div>
          {/* The fieldset legend already says "Camera". */}
          <label for="edit-camera" class="sr-only">
            Camera
          </label>
          {/* What it was loaded with: only a change is saved (digitizePatch). */}
          <input
            type="hidden"
            name="camera_loaded"
            value={row.camera_id === null ? "" : String(row.camera_id)}
          />
          <WithLevel
            level={
              <LevelSelect
                field="camera"
                value={row.metadata_visibility.camera ?? ""}
                siteDefault={defaults.camera}
                live={shows(row, row.camera_id !== null)}
              />
            }
          >
            <select
              id="edit-camera"
              name="camera_id"
              aria-describedby="edit-camera-help"
              class={field}
            >
              <option value="" selected={row.camera_id === null}>
                (none)
              </option>
              {cameras.map((c) => (
                <option
                  key={c.id}
                  value={String(c.id)}
                  selected={row.camera_id === c.id}
                >
                  {c.name}
                </option>
              ))}
            </select>
          </WithLevel>
          <p id="edit-camera-help" class={["mt-1 text-xs", muted]}>
            Not listed?{" "}
            <Link prefetch="js" href="/camera/new/" class={link}>
              Add a camera
            </Link>{" "}
            first.
          </p>
        </div>
        <DigitizerField row={row} cameras={cameras} defaults={defaults} />
      </fieldset>

      <fieldset class="space-y-3">
        <legend class={legend}>日時</legend>
        <div>
          <label for="edit-taken-at" class={label}>
            撮影日時
          </label>
          <WithLevel
            level={
              <LevelSelect
                field="taken_at"
                value={row.metadata_visibility.taken_at ?? ""}
                siteDefault={defaults.taken_at}
                live={shows(row, row.timestamp !== null)}
              />
            }
          >
            <input
              id="edit-taken-at"
              type="datetime-local"
              step="1"
              name="taken_at"
              value={takenAtInputValue(row.timestamp)}
              class={field}
            />
          </WithLevel>
          <input
            type="hidden"
            name="taken_at_loaded"
            value={takenAtInputValue(row.timestamp)}
          />
          <input
            type="hidden"
            name="taken_at_offset"
            value={takenAtOffset(row.timestamp)}
          />
        </div>
        {row.digitized_at && (
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm">
              <span class={muted}>スキャン日時</span>{" "}
              <span class="tabular-nums" data-testid="digitized-at">
                {formatJst(row.digitized_at)}
              </span>{" "}
              <span class={["text-xs", muted]}>JST</span>
            </p>
            <LevelSelect
              field="digitized_at"
              value={row.metadata_visibility.digitized_at ?? ""}
              siteDefault={defaults.digitized_at}
              live={shows(row, true)}
            />
          </div>
        )}
        <div class="max-w-xs">
          <label for="edit-embed-exif" class={label}>
            {EMBED_LABEL}
          </label>
          <select id="edit-embed-exif" name="embed_exif" class={field}>
            <option value="" selected={row.embed_exif === null}>
              既定
            </option>
            <option value="on" selected={row.embed_exif === true}>
              する
            </option>
            <option value="off" selected={row.embed_exif === false}>
              しない
            </option>
          </select>
        </div>
        {row.file_exif && <FileExifDetails exif={row.file_exif} />}
      </fieldset>

      <fieldset class="space-y-3">
        <legend class={legend}>Tags</legend>
        <div>
          <label for="edit-tags" class={label}>
            Tags (comma-separated)
          </label>
          <WithLevel
            level={
              <LevelSelect
                field="tags"
                value={row.metadata_visibility.tags ?? ""}
                siteDefault={defaults.tags}
                // Only public tags ever leave.
                live={shows(
                  row,
                  row.tags.some((t) => publicTags.includes(t)),
                )}
              />
            }
          >
            <input
              id="edit-tags"
              type="text"
              name="tags"
              value={row.tags.join(", ")}
              maxLength={2000}
              aria-describedby="edit-tags-help"
              autoCapitalize="off"
              autoCorrect="off"
              spellcheck={false}
              enterKeyHint="done"
              class={field}
            />
          </WithLevel>
          <p id="edit-tags-help" class={["mt-1 text-xs", muted]}>
            e.g. <code>VRChat, night</code>. Saved to D1 immediately; the public
            gallery shows it within about a minute.
          </p>
          {row.tags.length + inheritedTags.length > 0 && (
            <ul class="mt-2 flex flex-wrap gap-1.5" aria-label="タグの公開">
              {[
                ...row.tags.map((t) => ({ t, inherited: false })),
                ...inheritedTags.map((t) => ({ t, inherited: true })),
              ].map(({ t, inherited }) => {
                const isPublic = publicTags.includes(t);
                const chip = [
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset",
                  isPublic
                    ? "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800"
                    : "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700",
                ];
                const body = (
                  <>
                    {inherited && <CameraGlyph />}
                    {!isPublic && <span aria-hidden="true">🔒</span>}
                    {t}
                    <span class="sr-only">
                      （{isPublic ? "公開" : "非公開"}
                      {inherited && "・カメラから"}）
                    </span>
                  </>
                );
                return (
                  <li
                    key={`${inherited}:${t}`}
                    data-testid="tag-chip"
                    data-public={isPublic ? "true" : "false"}
                    data-inherited={inherited ? "true" : undefined}
                  >
                    {inherited ? (
                      // From the camera: changed there, not here.
                      <Link
                        prefetch="js"
                        href={`/camera/${row.camera_id}/`}
                        title="カメラのタグ"
                        class={[chip, "hover:underline"]}
                      >
                        {body}
                      </Link>
                    ) : (
                      <span class={chip}>{body}</span>
                    )}
                  </li>
                );
              })}
              <li>
                <Link prefetch="js" href="/tag/" class={[link, "text-xs"]}>
                  タグ一覧
                </Link>
              </li>
            </ul>
          )}
        </div>
      </fieldset>

      <TagFieldInputs
        row={row}
        tags={[...row.tags, ...inheritedTags]}
        fields={tagFields}
        publicTags={publicTags}
        defaults={defaults}
      />
    </>
  ),
);

const UNSAVED_CONFIRM = "保存していない変更があります。破棄して移動しますか？";
const PENDING_CONFIRM =
  "反映していない公開範囲の変更があります。このまま移動しますか？";

const navButton =
  "inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 sm:h-10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

export default component$(() => {
  const media = useMedia();
  const action = useUpdateMedia();
  const apply = useApplyPending();
  const undoApply = useUndoPending();
  const reset = useResetFromFile();
  /** The viewer's 反映 of its pending choices. */
  const applyPending = $(
    async (
      changes: { id: number; visibility: Visibility }[],
    ): Promise<ApplyResult> => {
      const { value } = await apply.submit({ changes });
      return value.failed
        ? {
            ok: false,
            message: value.message ?? "unknown error",
            undo: value.undo,
          }
        : { ok: true, undo: value.undo };
    },
  );
  /** ...and its 元に戻す. */
  const undoPending = $(async (changes: UndoChange[]): Promise<ApplyResult> => {
    const { value } = await undoApply.submit({ changes });
    return value.failed
      ? { ok: false, message: value.message ?? "unknown error" }
      : { ok: true, undo: [] };
  });
  /** Pending choices in the viewer (they too ask before leaving). */
  const pendingCount = useSignal(0);
  const viewerOpen = useSignal(false);
  const move = useMovePhoto();
  const undoMove = useUndoMove();
  const trash = useTrashPhoto();
  // The list this page was opened from (view, folder, filter, page).
  const backHref = safeBackHref(useLocation().url.searchParams.get("back"));
  const toast = useSignal<ToastState | null>(null);
  /** The last move, for the toast's 元に戻す. */
  const lastMove = useSignal<Move[] | null>(null);
  useTask$(({ track }) => {
    const v = track(() => move.value);
    if (!v) return;
    if (v.failed) {
      toast.value = {
        tone: "error",
        message: v.message ?? "移動できませんでした",
      };
      return;
    }
    lastMove.value = v.undo;
    toast.value = {
      tone: "success",
      message: "移動しました。",
      actionLabel: v.undo.length > 0 ? "元に戻す" : undefined,
    };
  });
  useTask$(({ track }) => {
    const v = track(() => undoMove.value);
    if (!v) return;
    toast.value = v.failed
      ? { tone: "error", message: `元に戻せませんでした: ${v.message ?? ""}` }
      : { tone: "success", message: "元に戻しました。" };
  });
  useTask$(({ track }) => {
    const v = track(() => trash.value);
    if (!v) return;
    toast.value = v.failed
      ? { tone: "error", message: v.message ?? "失敗しました" }
      : v.restored
        ? { tone: "success", message: `${v.restored} に戻しました。` }
        : { tone: "success", message: "ゴミ箱に入れました。" };
  });
  const undoLastMove = $(async () => {
    const moves = lastMove.value;
    if (!moves || moves.length === 0) return;
    lastMove.value = null;
    await undoMove.submit({ moves });
  });
  /** ファイルの値に戻す: the value comes back once the reader has read it. */
  const resetFromFile = $(async (field: "exif" | "world" | "location") => {
    const { value } = await reset.submit({ field });
    if (!value.failed) markUnread({ now: true });
    toast.value = value.failed
      ? { tone: "error", message: value.message ?? "戻せませんでした" }
      : {
          tone: "success",
          message: "ファイルの値に戻します。読み込み後に反映されます。",
        };
  });
  useTask$(({ track }) => {
    const v = track(() => action.value);
    if (!v) return;
    toast.value = v.failed
      ? {
          tone: "error",
          message: `Save failed: ${v.message ?? "unknown error"}`,
        }
      : {
          tone: "success",
          message:
            `Saved at ${formatJst(v.updated_at)} JST.` +
            (v.newTags.length > 0
              ? ` 新しいタグ${v.newTags.map((t) => `『${t}』`).join("")}は非公開です。`
              : ""),
        };
  });

  // Unsaved edits: shown next to Save, and leaving the page (prev/next,
  // back, reload, closing the tab) asks first.
  const dirty = useSignal(false);
  // Edits so far, and how many of them the running save sent: a change
  // typed while it is in flight keeps the form dirty.
  const edits = useSignal(0);
  const editsSent = useSignal(0);
  const markEdited = $(() => {
    dirty.value = true;
    edits.value++;
  });
  useTask$(({ track }) => {
    // Another photo (prev/next reuse this component): a fresh form.
    track(() => (media.value.kind === "ok" ? media.value.row.id : null));
    dirty.value = false;
  });
  usePreventNavigate$((url) => {
    // (The action's own reload does not navigate, so it never gets here.)
    // Pending choices go along to the next photo's edit page (they are
    // kept for the list), but not anywhere else.
    const toPhoto = url instanceof URL && /^\/media\/\d+\/$/.test(url.pathname);
    const pendingLeft = pendingCount.value > 0 && !toPhoto;
    if (!dirty.value && !pendingLeft) return false;
    // A link inside the app can ask; a browser navigation (reload, close)
    // only gets the browser's own dialog.
    if (!url) return true;
    if (confirm(dirty.value ? UNSAVED_CONFIRM : PENDING_CONFIRM)) return false;
    // Staying after a browser Back: Qwik City puts its last address back,
    // which still says fs=1 if that was a step in the viewer, closed since
    // (closing only drops it from the address bar). A reload would then
    // reopen the viewer, so drop it again once that address is back.
    setTimeout(() => {
      if (viewerOpen.value) return;
      const here = location.pathname + location.search;
      const clean = withoutViewer(here);
      if (clean !== here) {
        history.replaceState(history.state, "", clean + location.hash);
      }
    }, 0);
    return true;
  });
  // Phones: File / Last updated are folded away.
  const showMeta = useSignal(false);
  // 「リンクをコピー」: the share sheet on touch devices that have one,
  // else the clipboard; if that is refused, a selected field to copy from.
  const copyFallback = useSignal(false);
  const copyField = useSignal<HTMLInputElement>();
  useTask$(({ track }) => {
    // Another photo or visibility: its own link, not the old field.
    track(() =>
      media.value.kind === "ok"
        ? `${media.value.row.id}:${media.value.row.visibility}`
        : null,
    );
    copyFallback.value = false;
  });
  const shareLink = $(async (url: string) => {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ url });
        return;
      } catch (err) {
        // Closed by the user: done. Anything else: fall back to copying.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      copyFallback.value = false;
      toast.value = { tone: "success", message: "コピーしました" };
    } catch {
      copyFallback.value = true;
      toast.value = {
        tone: "error",
        message: "コピーできませんでした。選択したリンクをコピーしてください。",
      };
      // Once the field is rendered.
      requestAnimationFrame(() => copyField.value?.focus());
    }
  });

  if (media.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/media/" />;
  }
  if (media.value.kind === "bad-request") {
    return (
      <StatePanel
        tone="error"
        title="Invalid id"
        action={{ href: "/media/", label: "← Back to media" }}
      >
        <p>
          The id in the URL must be a positive integer, like{" "}
          <code>/media/12/</code>. Pick a photo from the list instead.
        </p>
      </StatePanel>
    );
  }
  if (media.value.kind === "not-found") {
    return (
      <StatePanel
        tone="error"
        title="Not found"
        action={{ href: "/media/", label: "← Back to media" }}
      >
        <p>
          No media row has this id. It may have been removed from D1, or the
          link is out of date.
        </p>
      </StatePanel>
    );
  }

  const { row, cameras, neighbors } = media.value;
  const { dir, base } = splitPath(row.path);
  const previewBase = media.value.imageBase;
  const publicUrl = publicPhotoUrl(row.public_id);
  // Folded on phones unless opened ("max-sm": below sm only).
  const meta = showMeta.value ? "" : "max-sm:hidden";

  return (
    <div class="mx-auto max-w-3xl space-y-6">
      <div>
        <nav
          aria-label="Breadcrumb"
          class="flex items-center justify-between gap-3 text-sm"
        >
          {/* The list scrolls back to this photo (#m-<id>). */}
          <Link
            prefetch="js"
            href={backHref + mediaAnchor(row.id)}
            class={backLink}
          >
            ← Media
          </Link>
          {neighbors && (
            <span class={["tabular-nums", muted]} data-testid="position">
              {neighbors.pos} / {neighbors.total}
            </span>
          )}
        </nav>
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
            Edit #{row.id}
          </h1>
          <span class={platformBadge(row.platform)}>{row.platform}</span>
          <VisibilityBadge visibility={row.visibility} />
        </div>
        <PhotoViews public_id={row.public_id} />
      </div>

      {/* A tap opens the photo full screen (shared/overlay/ look). */}
      <PhotoPreview
        id={row.id}
        file={row.file}
        platform={row.platform}
        timestamp={row.timestamp}
        visibility={row.visibility}
        imageBase={previewBase}
        neighbors={neighbors}
        listHref={backHref}
        dirty={dirty.value}
        saving={action.isRunning || move.isRunning || trash.isRunning}
        pendingCount={pendingCount}
        viewerOpen={viewerOpen}
        onApply$={applyPending}
        onUndo$={undoPending}
      />

      <div class={[card, "p-5 text-sm"]}>
        <dl
          id="media-meta"
          class="grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_1fr] sm:gap-y-4 [&>dd]:mb-3 sm:[&>dd]:mb-0 [&>dd:last-of-type]:mb-0"
        >
          <dt class={["font-medium", muted]}>Taken</dt>
          <dd title={row.timestamp ?? undefined} class="tabular-nums">
            {row.timestamp ? (
              <>
                {formatJst(row.timestamp)}{" "}
                <span class={["text-xs", muted]}>JST</span>
              </>
            ) : (
              <span class={muted}>(none)</span>
            )}
          </dd>
          <dt class={["font-medium", muted]}>Public URL</dt>
          <dd class="min-w-0 break-all">
            {/* Private photos have no working public URL; show it as text. */}
            {row.visibility === "private" ? (
              <span data-testid="public-url" class={muted}>
                {publicUrl}
              </span>
            ) : (
              <span class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <a
                  data-testid="public-url"
                  href={publicUrl}
                  target="_blank"
                  rel="noopener"
                  class={link}
                >
                  {publicUrl}
                </a>
                <button
                  type="button"
                  onClick$={() => shareLink(publicUrl)}
                  class={buttonSecondary}
                >
                  リンクをコピー
                </button>
              </span>
            )}
            {copyFallback.value && (
              // Clipboard refused: the link selected, to copy by hand.
              <input
                ref={copyField}
                type="text"
                readOnly
                value={publicUrl}
                aria-label="Public URL"
                onFocus$={(_, el) => el.select()}
                class={[field, "mt-2"]}
              />
            )}
          </dd>
          <dt class={["font-medium", muted, meta]}>File</dt>
          <dd class={["min-w-0", meta]} title={row.path}>
            <span class="block font-medium break-all">{base}</span>
            <span class={["block text-xs break-all", muted]}>{dir}</span>
          </dd>
          {/* Moved or renamed: the file in B2 keeps its first name. */}
          {row.file !== row.path && (
            <>
              <dt class={["font-medium", muted, meta]}>B2 key</dt>
              <dd
                class={["min-w-0 text-xs break-all", muted, meta]}
                data-testid="bucket-key"
              >
                {row.file}
              </dd>
            </>
          )}
          <dt class={["font-medium", muted, meta]}>Last updated</dt>
          <dd title={row.updated_at} class={["tabular-nums", meta]}>
            {formatJst(row.updated_at)}{" "}
            <span class={["text-xs", muted]}>JST</span>
          </dd>
        </dl>
        <button
          type="button"
          aria-expanded={showMeta.value}
          aria-controls="media-meta"
          onClick$={() => (showMeta.value = !showMeta.value)}
          class={[
            "-mx-2 mt-1 -mb-2 flex h-11 items-center gap-1 rounded-md px-2 text-left font-medium sm:hidden",
            muted,
          ]}
        >
          <span
            aria-hidden="true"
            class={["transition-transform", showMeta.value && "rotate-90"]}
          >
            ›
          </span>
          {showMeta.value ? "詳細を閉じる" : "ファイル・更新日時"}
        </button>
      </div>

      <Form
        // A fresh form (and dirty state) per photo when prev/next reuse
        // this component.
        key={row.id}
        id={MEDIA_FORM}
        action={action}
        aria-busy={action.isRunning}
        onInput$={markEdited}
        onChange$={markEdited}
        onSubmit$={() => {
          editsSent.value = edits.value;
        }}
        onSubmitCompleted$={(ev) => {
          const { value } = ev.detail as { value?: { ok?: boolean } };
          if (value?.ok && edits.value === editsSent.value) {
            dirty.value = false;
          }
        }}
        class={[card, "space-y-6 p-5"]}
      >
        <MediaFields
          row={row}
          cameras={cameras}
          defaults={media.value.defaults}
          publicTags={media.value.publicTags}
          onReset$={resetFromFile}
          tagFields={media.value.tagFields}
          inheritedTags={media.value.inheritedTags}
        />

        {/* Phones: fixed to the bottom of the screen, so Save and stepping
            through the list are always in reach. sm and up: the form's
            footer. */}
        <div
          data-bottom-bar="short"
          class="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-zinc-200 bg-white/95 pt-3 pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] shadow-[0_-4px_12px_rgb(0_0_0/0.06)] backdrop-blur sm:static sm:z-auto sm:gap-3 sm:bg-transparent sm:p-0 sm:pt-5 sm:shadow-none sm:backdrop-blur-none dark:border-zinc-800 dark:bg-zinc-900/95 sm:dark:bg-transparent"
        >
          {neighbors?.prev ? (
            <Link
              prefetch="js"
              href={neighbors.prev}
              rel="prev"
              class={navButton}
            >
              ‹ 前へ
            </Link>
          ) : (
            // At the start of the list: a placeholder keeping the layout.
            <span aria-hidden="true" class={[navButton, "opacity-40"]}>
              ‹ 前へ
            </span>
          )}
          <SubmitButton
            running={action.isRunning}
            pendingLabel="保存中…"
            class={[buttonPrimary, "flex-1 sm:flex-none"]}
          >
            Save
          </SubmitButton>
          {dirty.value && (
            <span
              data-testid="dirty"
              class="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400"
            >
              <span
                aria-hidden="true"
                class="size-2 rounded-full bg-amber-500"
              />
              未保存
            </span>
          )}
          {neighbors?.next ? (
            <Link
              prefetch="js"
              href={neighbors.next}
              rel="next"
              class={[navButton, "sm:ml-auto"]}
            >
              次へ ›
            </Link>
          ) : (
            <span
              aria-hidden="true"
              class={[navButton, "opacity-40 sm:ml-auto"]}
            >
              次へ ›
            </span>
          )}
        </div>
      </Form>

      {/* Where it is shown, and the trash: actions of their own, apart
          from the metadata form (and its unsaved-changes guard). */}
      <section aria-label="場所とゴミ箱" class={[card, "space-y-4 p-4 sm:p-6"]}>
        {row.trashed_at ? (
          <div
            role="status"
            class="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <span class="mr-auto">
              ゴミ箱にあります（公開サイトには出ません）。
            </span>
            <Form action={trash}>
              <input type="hidden" name="restore" value="true" />
              <SubmitButton running={trash.isRunning} class={buttonSecondary}>
                元に戻す
              </SubmitButton>
            </Form>
          </div>
        ) : (
          <>
            <div>
              <div class="flex flex-wrap items-center justify-between gap-x-2">
                <label for="move-path" class={label}>
                  場所と名前
                </label>
                {/* Part of the form above: Save sends it. Keyed like
                    the form: a fresh choice per photo. */}
                <FileNameLevel
                  key={row.id}
                  row={row}
                  defaults={media.value.defaults}
                  onChange$={markEdited}
                />
              </div>
              <Form
                action={move}
                aria-label="移動・名前の変更"
                class="flex flex-wrap items-end gap-2"
              >
                <div class="min-w-0 flex-1">
                  <input
                    // Keyed: a successful move shows the new path.
                    key={row.path}
                    id="move-path"
                    name="path"
                    value={row.path}
                    required
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellcheck={false}
                    class={field}
                  />
                </div>
                <SubmitButton running={move.isRunning} class={buttonSecondary}>
                  移動・名前を変更
                </SubmitButton>
              </Form>
            </div>
            <Form action={trash}>
              <SubmitButton
                running={trash.isRunning}
                class={[buttonSecondary, "text-red-700 dark:text-red-400"]}
              >
                ゴミ箱へ
              </SubmitButton>
            </Form>
          </>
        )}
      </section>
      {/* Keyed: prev/next start closed, on the other photo's file. */}
      <FileMetadata key={row.id} id={row.id} file={row.file} />
      <Toast toast={toast} onAction$={undoLastMove} />
    </div>
  );
});

export const head: DocumentHead = ({ resolveValue }) => {
  const result = resolveValue(useMedia);
  if (result.kind === "ok") {
    return { title: `Edit ${result.row.path} — Admin` };
  }
  if (result.kind === "missing-binding") {
    return { title: "Configuration error — Admin" };
  }
  if (result.kind === "bad-request") {
    return { title: "Invalid id — Admin" };
  }
  return { title: "Not found — Admin" };
};
