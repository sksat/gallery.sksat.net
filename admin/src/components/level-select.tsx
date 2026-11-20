import type { QRL } from "@builder.io/qwik";
import {
  FIELD_LABELS,
  LEVEL_LABELS,
  METADATA_LEVELS,
  type EditableField,
} from "~/lib/metadata";
import { field, muted } from "./ui";
import { VISIBILITY_STYLE, VisibilityIcon } from "./visibility-style";

/** A field's control with its level beside it (under it on phones). */
export const WithLevel = ({
  children,
  level,
}: {
  children: unknown;
  level: unknown;
}) => (
  <div class="flex flex-wrap items-center gap-2">
    <div class="min-w-0 flex-1 basis-60">{children as never}</div>
    <div class="ml-auto">{level as never}</div>
  </div>
);

/**
 * How much of one field the public site shows, beside the field on the
 * edit page: its level <select> (the first option follows the site,
 * デフォルト（…）), with an icon for its level as saved: a globe when the level
 * lets it out, a lock when hidden. The globe is in the public colour only
 * when the public site really shows something (the photo is not private
 * and the field has a value), muted otherwise.
 */
export const LevelSelect = ({
  field: f,
  value,
  siteDefault,
  live,
  form,
  onChange$,
}: {
  field: EditableField;
  /** The photo's own level; "" = the site's. */
  value: string;
  siteDefault: string;
  /** Whether the photo is visible and the field has a value. */
  live: boolean;
  /** The form it belongs to, when it sits outside it. */
  form?: string;
  onChange$?: QRL<() => void>;
}) => {
  const labels = LEVEL_LABELS[f] as Record<string, string>;
  const effective = value || siteDefault;
  const allowed = effective !== "hidden";
  const shown = allowed && live;
  const id = `mv-mv_${f}`;
  return (
    <div class="flex shrink-0 items-center gap-2">
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
        form={form}
        onChange$={onChange$}
        data-testid={`metadata-${f}`}
        class={[field, "w-auto min-w-0 sm:w-60"]}
      >
        <option value="" selected={value === ""}>
          {`デフォルト（${labels[siteDefault]}）`}
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
