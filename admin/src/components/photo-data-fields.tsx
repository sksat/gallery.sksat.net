import type { QRL } from "@builder.io/qwik";
import { FIELD_LABELS, type MetadataLevels } from "~/lib/metadata";
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
import { hasRealPlace, type PlatformKind } from "~/lib/platform";
import type { MediaRow } from "~/lib/types";
import { parseInstance, userUrl } from "~/lib/vrcx";
import { LevelSelect } from "./level-select";
import { LocationPicker } from "./location-picker";
import { field, label, link, muted } from "./ui";
import { VisibilityIcon } from "./visibility-style";

// 撮影データ on the edit page: what was read from the file (camera
// settings, VRChat world, where it was taken), each with how much of it
// the public site shows right beside it, and its values editable under
// 編集. Part of the page's one form: Save sends it all. Editing changes
// the row only, never the original file. Who took a VRChat photo and what
// VRCX recorded (instance, players) are shown read-only and never public.

type Field = "exif" | "world" | "location";

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
  manual,
  onReset$,
}: {
  f: Field;
  row: MediaRow;
  defaults: MetadataLevels;
  hasValue: boolean;
  children: unknown;
  edit: unknown;
  /** Entered by hand: a reading of the file never replaces it. */
  manual: boolean;
  onReset$?: QRL<(field: Field) => void>;
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
    {manual && (
      <p
        class={["mt-1 flex flex-wrap items-center gap-x-2 text-xs", muted]}
        data-testid={`manual-${f}`}
      >
        手入力
        {onReset$ && (
          <button
            type="button"
            class={[link, "inline-flex min-h-11 items-center sm:min-h-0"]}
            onClick$={() => onReset$(f)}
          >
            ファイルの値に戻す
          </button>
        )}
      </p>
    )}
    {edit as never}
  </div>
);

const None = () => <span class={muted}>なし</span>;

/** Admin only: never on the public site (no level to choose). */
const Private = () => (
  <span class={["inline-flex", muted]} title="公開サイトには出しません">
    <VisibilityIcon visibility="private" class="size-3.5" />
    <span class="sr-only">非公開</span>
  </span>
);

/** A VRChat user, linked to vrchat.com when the id is known. */
const User = ({ id, name }: { id: string | null; name: string | null }) =>
  id ? (
    <a
      href={userUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
      class={link}
    >
      {name ?? id}
    </a>
  ) : (
    <span>{name}</span>
  );

/** More players than this start folded. */
const PLAYERS_OPEN = 6;

// What VRCX recorded with the photo (media.vrcx), under the world: the
// instance (only while it is the photo's world) and who was there.
const VrcxDetails = ({ row }: { row: MediaRow }) => {
  const instance = parseInstance(row.vrcx?.instance_id ?? null);
  const players = row.vrcx?.players ?? [];
  const shownInstance =
    instance && instance.worldId === row.world_id ? instance : null;
  if (!shownInstance && players.length === 0) return null;
  return (
    <div class="mt-2 space-y-1">
      {shownInstance && (
        <p
          class="flex flex-wrap items-center gap-x-2"
          data-testid="world-instance"
        >
          <span class={["text-xs", muted]}>インスタンス</span>
          <span>
            {shownInstance.region
              ? `${shownInstance.kind} ・ ${shownInstance.region}`
              : shownInstance.kind}
          </span>
          <Private />
        </p>
      )}
      {players.length > 0 && (
        <details
          class="group"
          open={players.length <= PLAYERS_OPEN}
          data-testid="world-players"
        >
          <summary
            class={[
              "inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-xs sm:min-h-0 [&::-webkit-details-marker]:hidden",
              muted,
            ]}
          >
            <span
              aria-hidden="true"
              class="transition-transform group-open:rotate-90"
            >
              ›
            </span>
            {`一緒にいた人（${players.length}人）`}
            <Private />
          </summary>
          <ul class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {players.map((p, i) => (
              <li key={p.id ?? `${i}`}>
                <User id={p.id} name={p.name} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

export const PhotoDataFields = ({
  row,
  kind,
  defaults,
  onReset$,
}: {
  row: MediaRow;
  /** The kind of the photo's platform: a virtual one has no map. */
  kind: PlatformKind;
  defaults: MetadataLevels;
  /** Set a field back to what the file says (reset_from_file). */
  onReset$?: QRL<(field: Field) => void>;
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
        manual={row.metadata_source.exif === "manual"}
        onReset$={onReset$}
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
        manual={row.metadata_source.world === "manual"}
        onReset$={onReset$}
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
        <VrcxDetails row={row} />
      </Row>

      {row.photographer && (
        <div class="py-3" data-testid="photo-data-photographer">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-medium">撮影者</p>
            <Private />
          </div>
          <p class="mt-1 text-sm">
            <User id={row.photographer.id} name={row.photographer.name} />
          </p>
        </div>
      )}

      <Row
        f="location"
        row={row}
        defaults={defaults}
        manual={row.location_source === "manual"}
        onReset$={onReset$}
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
            {row.location_source !== "manual" && (
              <span class={["text-xs", muted]} data-testid="location-source">
                EXIF
              </span>
            )}
          </span>
        ) : (
          <None />
        )}
        {/* A photo on a virtual platform (VRChat, …) has no real-world
            place (the public site never shows one): no map unless a
            position is already set. */}
        {(hasRealPlace(kind) || hasLocation) && (
          <LocationPicker latitude={row.latitude} longitude={row.longitude} />
        )}
      </Row>
    </div>
  );
};
