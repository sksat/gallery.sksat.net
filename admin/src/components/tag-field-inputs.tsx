import { Link } from "@builder.io/qwik-city";
import {
  levelOf,
  readValue,
  TAG_FIELD_LEVEL_LABELS,
  TAG_FIELD_LEVELS,
  TAG_FIELD_LIMITS,
  type TagFieldDef,
} from "@shared/tag-field/tag-field";
import { tagFieldFormValues } from "~/lib/tag-field-form";
import type { MetadataLevels } from "~/lib/metadata";
import type { MediaRow } from "~/lib/types";
import { field as fieldClass, link, muted } from "./ui";
import { VISIBILITY_STYLE, VisibilityIcon } from "./visibility-style";

// The fields of the photo's tags on its edit page (migration 0010): one
// group per tag that has fields, each field an input with its public
// level beside it (既定 follows the field), like 撮影データ. Part of the
// page's form: only the fields edited since the page loaded are saved
// (tag_fields_loaded, lib/tag-field-form.ts).

const legend = "text-sm font-semibold text-zinc-900 dark:text-zinc-100";

export const TagFieldInputs = ({
  row,
  tags: photoTags,
  fields,
  publicTags,
  defaults,
}: {
  row: MediaRow;
  /** Its tags: its own and those its camera passes on (0011). */
  tags: string[];
  /** The fields of the photo's tags. */
  fields: TagFieldDef[];
  publicTags: string[];
  defaults: MetadataLevels;
}) => {
  const tags = photoTags.filter((t) => fields.some((f) => f.tag === t));
  if (tags.length === 0) return null;
  const loaded = tagFieldFormValues(row, fields);
  return (
    <>
      <input
        type="hidden"
        name="tag_fields_loaded"
        value={JSON.stringify(loaded)}
      />
      {tags.map((tag) => {
        const tagPublic = publicTags.includes(tag);
        return (
          <fieldset key={tag} class="space-y-3" data-testid="tag-field-group">
            <legend class={legend}>
              {tag}
              <Link
                prefetch="js"
                href={`/tag/?tag=${encodeURIComponent(tag)}`}
                class={[link, "ml-2 text-xs font-normal"]}
              >
                項目を編集
              </Link>
            </legend>
            <div class="grid gap-3 sm:grid-cols-2">
              {fields
                .filter((f) => f.tag === tag)
                .map((f) => {
                  const key = `f${f.id}`;
                  const id = `edit-tf-${f.id}`;
                  const value = loaded.values[key] ?? "";
                  const own = loaded.levels[key] ?? "";
                  const stored = readValue(
                    f.type,
                    row.tag_values[String(f.id)],
                  );
                  // The globe only when the public site shows it now.
                  const allowed =
                    levelOf(f, row.tag_value_visibility) === "shown";
                  const shown =
                    allowed &&
                    tagPublic &&
                    (row.metadata_visibility.tags ?? defaults.tags) ===
                      "public" &&
                    row.visibility !== "private" &&
                    stored !== null;
                  const stale =
                    f.type === "select" &&
                    value !== "" &&
                    !(f.options ?? []).includes(value);
                  return (
                    <div key={f.id} data-testid="tag-field-input">
                      <div class="mb-1 flex items-center justify-between gap-2">
                        <label
                          for={id}
                          class="text-sm font-medium text-zinc-700 dark:text-zinc-300"
                        >
                          {f.label}
                        </label>
                        <span
                          class={[
                            "inline-flex",
                            shown ? VISIBILITY_STYLE.public.accent : muted,
                          ]}
                          data-testid={`tag-field-public-${f.id}`}
                          data-shown={shown ? "true" : "false"}
                          title={
                            shown
                              ? "公開サイトに出ます"
                              : allowed
                                ? "公開する設定です (今は出ていません)"
                                : "公開サイトには出しません"
                          }
                        >
                          <VisibilityIcon
                            visibility={allowed ? "public" : "private"}
                          />
                          <span class="sr-only">
                            {allowed ? "公開" : "非公開"}
                          </span>
                        </span>
                      </div>
                      <div class="flex gap-2">
                        {f.type === "select" ? (
                          <select
                            id={id}
                            name={`tf.${key}`}
                            class={[fieldClass, "min-w-0 flex-1"]}
                          >
                            <option value="" selected={value === ""}>
                              —
                            </option>
                            {stale && (
                              // Saved before its option was removed: kept
                              // unless another is picked.
                              <option value={value} selected>
                                {value}
                              </option>
                            )}
                            {(f.options ?? []).map((o) => (
                              <option key={o} value={o} selected={value === o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            id={id}
                            name={`tf.${key}`}
                            type={f.type === "date" ? "date" : "text"}
                            value={value}
                            inputMode={
                              f.type === "number" ? "decimal" : undefined
                            }
                            maxLength={TAG_FIELD_LIMITS.text}
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellcheck={false}
                            class={[fieldClass, "min-w-0 flex-1"]}
                          />
                        )}
                        <label for={`${id}-level`} class="sr-only">
                          {`${f.label}の公開`}
                        </label>
                        <select
                          id={`${id}-level`}
                          name={`tfv.${key}`}
                          class={[fieldClass, "w-36! shrink-0"]}
                        >
                          <option value="" selected={own === ""}>
                            {`既定（${TAG_FIELD_LEVEL_LABELS[f.visibility]}）`}
                          </option>
                          {TAG_FIELD_LEVELS.map((level) => (
                            <option
                              key={level}
                              value={level}
                              selected={own === level}
                            >
                              {TAG_FIELD_LEVEL_LABELS[level]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
            </div>
          </fieldset>
        );
      })}
    </>
  );
};
