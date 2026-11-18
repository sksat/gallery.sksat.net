import {
  FIELD_LABELS,
  LEVEL_LABELS,
  METADATA_LEVELS,
  type MetadataLevels,
} from "~/lib/metadata";
import {
  EXIF_EDIT_KEYS,
  EXIF_LABELS,
  formatExposureLine,
  formatGear,
  formGroups,
  mapUrl,
  rowFormValues,
  worldUrl,
} from "~/lib/photo-data";
import type { MediaRow } from "~/lib/types";
import { field, label, link, muted } from "./ui";
import { VISIBILITY_STYLE, VisibilityIcon } from "./visibility-style";

// 撮影データ on the edit page: what was read from the file (camera
// settings, VRChat world, where it was taken), each with how much of it
// the public site shows right beside it, and its values editable under
// 編集. Part of the page's one form: Save sends it all. Editing changes
// the row only, never the original file.

type Field = "exif" | "world" | "location";

/**
 * The level <select> of one field, with an icon for its level as saved: a
 * globe when the level lets it out, a lock when hidden. The globe is in
 * the public colour only when the public site really shows something
 * (the photo is not private and the field has a value), muted otherwise.
 */
const LevelSelect = ({
  field: f,
  value,
  siteDefault,
  live,
}: {
  field: Field;
  /** The photo's own level; "" = the site's. */
  value: string;
  siteDefault: string;
  /** Whether the photo is visible and the field has a value. */
  live: boolean;
}) => {
  const labels = LEVEL_LABELS[f] as Record<string, string>;
  const effective = value || siteDefault;
  const allowed = effective !== "hidden";
  const shown = allowed && live;
  const id = `mv-mv_${f}`;
  return (
    <div class="flex items-center gap-2">
      <span
        class={["inline-flex", shown ? VISIBILITY_STYLE.public.accent : muted]}
        data-testid={`public-${f}`}
        data-public={allowed ? "true" : "false"}
        data-shown={shown ? "true" : "false"}
        title={
          shown
            ? "公開サイトに出ます"
            : allowed
              ? "公開する設定です (今は出ていません)"
              : "公開サイトには出しません"
        }
      >
        <VisibilityIcon visibility={allowed ? "public" : "private"} />
        <span class="sr-only">{allowed ? "公開" : "非公開"}</span>
      </span>
      <label for={id} class="sr-only">
        {`${FIELD_LABELS[f]}の公開`}
      </label>
      <select
        id={id}
        name={`mv_${f}`}
        data-testid={`metadata-${f}`}
        class={[field, "w-auto min-w-0 sm:w-48"]}
      >
        <option value="" selected={value === ""}>
          {`既定（${labels[siteDefault]}）`}
        </option>
        {(METADATA_LEVELS[f] as readonly string[]).map((level) => (
          <option key={level} value={level} selected={value === level}>
            {labels[level]}
          </option>
        ))}
      </select>
    </div>
  );
};

const Edit = ({ children, testId }: { children: unknown; testId: string }) => (
  <details class="group mt-2" data-testid={testId}>
    <summary
      class={[
        "inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium sm:min-h-0 [&::-webkit-details-marker]:hidden",
        link,
      ]}
    >
      <span
        aria-hidden="true"
        class="transition-transform group-open:rotate-90"
      >
        ›
      </span>
      編集
    </summary>
    <div class="mt-2 grid gap-3 sm:grid-cols-2">{children as never}</div>
  </details>
);

const Input = ({
  name,
  text,
  value,
  inputMode,
  placeholder,
}: {
  name: string;
  text: string;
  value: string | number | null | undefined;
  inputMode?: "decimal" | "numeric" | "text";
  placeholder?: string;
}) => (
  <div>
    <label for={`edit-${name}`} class={label}>
      {text}
    </label>
    <input
      id={`edit-${name}`}
      type="text"
      name={name}
      value={value === null || value === undefined ? "" : String(value)}
      inputMode={inputMode}
      placeholder={placeholder}
      autoCapitalize="off"
      autoCorrect="off"
      spellcheck={false}
      class={field}
    />
  </div>
);

const Row = ({
  f,
  row,
  defaults,
  hasValue,
  children,
  edit,
}: {
  f: Field;
  row: MediaRow;
  defaults: MetadataLevels;
  hasValue: boolean;
  children: unknown;
  edit: unknown;
}) => (
  <div class="py-3 first:pt-0 last:pb-0" data-testid={`photo-data-${f}`}>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm font-medium">{FIELD_LABELS[f]}</p>
      <LevelSelect
        field={f}
        value={row.metadata_visibility[f] ?? ""}
        siteDefault={defaults[f]}
        live={hasValue && row.visibility !== "private"}
      />
    </div>
    <div class="mt-1 text-sm">{children as never}</div>
    {edit as never}
  </div>
);

const None = () => <span class={muted}>なし</span>;

export const PhotoDataFields = ({
  row,
  defaults,
}: {
  row: MediaRow;
  defaults: MetadataLevels;
}) => {
  const gear = formatGear(row.exif);
  const exposure = formatExposureLine(row.exif);
  const hasLocation = row.latitude !== null && row.longitude !== null;
  const values = rowFormValues(row);
  return (
    <div class="divide-y divide-zinc-200 dark:divide-zinc-800">
      {/* What the inputs were loaded with: only edited groups are saved. */}
      <input
        type="hidden"
        name="photo_data_loaded"
        value={JSON.stringify(formGroups((n) => values[n]))}
      />
      <Row
        f="exif"
        row={row}
        defaults={defaults}
        hasValue={Object.keys(row.exif).length > 0}
        edit={
          <Edit testId="edit-exif">
            {EXIF_EDIT_KEYS.map((k) => (
              <Input
                key={k}
                name={`exif_${k}`}
                text={EXIF_LABELS[k]}
                value={values[`exif_${k}`]}
                inputMode={
                  k === "iso"
                    ? "numeric"
                    : k === "f_number" || k === "focal_length_mm"
                      ? "decimal"
                      : "text"
                }
                placeholder={k === "exposure_time" ? "1/250" : undefined}
              />
            ))}
          </Edit>
        }
      >
        {gear || exposure ? (
          <>
            {gear && <p data-testid="exif-gear">{gear}</p>}
            {exposure && (
              <p data-testid="exif-exposure" class="tabular-nums">
                {exposure}
              </p>
            )}
          </>
        ) : (
          <None />
        )}
      </Row>

      <Row
        f="world"
        row={row}
        defaults={defaults}
        hasValue={row.world_id !== null || row.world_name !== null}
        edit={
          <Edit testId="edit-world">
            <Input name="world_name" text="名前" value={values.world_name} />
            <Input
              name="world_id"
              text="ID"
              value={values.world_id}
              placeholder="wrld_…"
            />
          </Edit>
        }
      >
        {row.world_id ? (
          <a
            href={worldUrl(row.world_id)}
            target="_blank"
            rel="noopener noreferrer"
            class={link}
            data-testid="world-link"
          >
            {row.world_name ?? row.world_id}
          </a>
        ) : row.world_name ? (
          <span>{row.world_name}</span>
        ) : (
          <None />
        )}
      </Row>

      <Row
        f="location"
        row={row}
        defaults={defaults}
        hasValue={hasLocation}
        edit={
          <Edit testId="edit-location">
            <Input
              name="latitude"
              text="緯度"
              value={values.latitude}
              inputMode="decimal"
              placeholder="35.6586"
            />
            <Input
              name="longitude"
              text="経度"
              value={values.longitude}
              inputMode="decimal"
              placeholder="139.7454"
            />
          </Edit>
        }
      >
        {hasLocation ? (
          <span class="flex flex-wrap items-center gap-x-2">
            <a
              href={mapUrl(row.latitude!, row.longitude!)}
              target="_blank"
              rel="noopener noreferrer"
              class={[link, "tabular-nums"]}
              data-testid="location-link"
            >
              {`${row.latitude}, ${row.longitude}`}
            </a>
            <span class={["text-xs", muted]} data-testid="location-source">
              {row.location_source === "manual" ? "手入力" : "EXIF"}
            </span>
          </span>
        ) : (
          <None />
        )}
      </Row>
    </div>
  );
};
