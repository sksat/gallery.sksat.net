import {
  $,
  component$,
  sync$,
  useSignal,
  useStore,
  type QRL,
} from "@builder.io/qwik";
import { CameraGlyph } from "./camera-label";
import { VisibilityIcon } from "./visibility-style";
import { buttonSecondary, field } from "./ui";
import { validateTagName } from "~/lib/tag-rename";

// The edit page's tags (migration 0021), one editor: each tag a chip,
// removable with ×, and a box to add one at a time (Enter, 追加, or a
// suggestion from the site's tags picked; the same checks as everywhere,
// validateTagName).
// A chip says whether the public site shows the tag on this photo: an
// eye button on a public tag switches it (eye: shown; eye with a slash,
// the chip dimmed and struck: hidden on this photo); a private tag has a
// lock (「非公開タグ」) and no switch, as it is never shown. Tags its
// camera passes on carry the camera mark and cannot be removed here.
//
// Part of the page's form: `tags` (the photo's own, comma-separated, as
// before, with one typed but not added yet), `tag_hidden[]` (the public tags hidden now) and
// `tag_hidden_loaded` (those hidden when the page loaded), so only what
// was switched is saved (lib/tag-visibility.ts chipPatch). Every change
// fires an input event on the editor, so the page sees an unsaved edit.

export type EditorTag = {
  tag: string;
  /** From the camera (0011), not the photo's own. */
  inherited: boolean;
  /** Hidden on this photo (a public tag only). */
  hidden: boolean;
};

type SiteTag = { name: string; public: boolean };

/** Eye and eye with a slash (20×20, filled, evenodd). */
const EYE = [
  "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  "M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
];
const EYE_SLASH = [
  "M3.28 2.22a.75.75 0 0 0-1.06 1.06l14.5 14.5a.75.75 0 1 0 1.06-1.06l-1.745-1.745a10.029 10.029 0 0 0 3.3-4.38 1.651 1.651 0 0 0 0-1.185A10.004 10.004 0 0 0 9.999 3a9.956 9.956 0 0 0-4.744 1.194L3.28 2.22ZM7.752 6.69l1.092 1.092a2.5 2.5 0 0 1 3.374 3.373l1.091 1.092a4 4 0 0 0-5.557-5.557Z",
  "M10.748 13.93l2.523 2.523a9.987 9.987 0 0 1-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 0 1 0-1.186A10.007 10.007 0 0 1 2.839 6.02L6.07 9.252a4 4 0 0 0 4.678 4.678Z",
];

const Icon = ({ paths }: { paths: string[] }) => (
  <svg
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    class="size-4 shrink-0"
  >
    {paths.map((d) => (
      <path key={d} fill-rule="evenodd" clip-rule="evenodd" d={d} />
    ))}
  </svg>
);

const chipButton =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-sky-500 sm:size-6 dark:hover:bg-white/10";

export const TagEditor = component$<{
  tags: EditorTag[];
  siteTags: SiteTag[];
  /** Every tag the photo's camera passes on (0011). */
  cameraTags: string[];
  onChange$?: QRL<() => void>;
}>(({ tags: initial, siteTags, cameraTags, onChange$ }) => {
  const state = useStore({ tags: initial.map((t) => ({ ...t })) });
  const draft = useSignal("");
  const root = useSignal<HTMLElement>();
  const box = useSignal<HTMLInputElement>();
  const isPublic = (name: string) =>
    siteTags.some((t) => t.name === name && t.public);

  /** Tell the form (it listens for input events) that something changed. */
  const changed = $(() => {
    root.value?.dispatchEvent(new Event("input", { bubbles: true }));
    return onChange$?.();
  });

  const add = $(() => {
    // The box itself: what was typed just now may not have reached
    // `draft` yet.
    const el = box.value;
    const v = validateTagName(el ? el.value : draft.value);
    if (!v.ok) return;
    draft.value = "";
    if (el) el.value = "";
    const name = v.value;
    const at = state.tags.findIndex((t) => t.tag === name);
    if (at >= 0 && !state.tags[at].inherited) return;
    // A camera's tag typed as the photo's own: now its own too, shown or
    // hidden as it was.
    const hidden = at >= 0 && state.tags[at].hidden;
    if (at >= 0) state.tags.splice(at, 1);
    const own = state.tags.filter((t) => !t.inherited).length;
    state.tags.splice(own, 0, { tag: name, inherited: false, hidden });
    void changed();
  });

  // What is typed: added with Enter or 追加, and saved with the form even
  // when not added yet; one that cannot be a tag says why.
  const typed = draft.value.trim() === "" ? null : validateTagName(draft.value);
  const own = [
    ...state.tags.filter((t) => !t.inherited).map((t) => t.tag),
    ...(typed?.ok && !state.tags.some((t) => t.tag === typed.value)
      ? [typed.value]
      : []),
  ];
  const hiddenNow = state.tags
    .filter((t) => t.hidden && isPublic(t.tag))
    .map((t) => t.tag);

  return (
    <div ref={root} data-testid="tag-editor">
      <input type="hidden" id="edit-tags" name="tags" value={own.join(", ")} />
      <input
        type="hidden"
        name="tag_hidden_loaded"
        value={JSON.stringify(
          initial.filter((t) => t.hidden).map((t) => t.tag),
        )}
      />
      {hiddenNow.map((t) => (
        <input key={t} type="hidden" name="tag_hidden[]" value={t} />
      ))}
      {state.tags.length > 0 && (
        <ul class="mb-2 flex flex-wrap gap-1.5" aria-label="タグ">
          {state.tags.map((t) => {
            const pub = isPublic(t.tag);
            const shown = pub && !t.hidden;
            return (
              <li
                key={`${t.inherited}:${t.tag}`}
                data-testid="tag-chip"
                data-tag={t.tag}
                data-public={shown ? "true" : "false"}
                data-hidden={pub && t.hidden ? "true" : undefined}
                data-locked={pub ? undefined : "true"}
                data-inherited={t.inherited ? "true" : undefined}
                class={[
                  "inline-flex h-11 items-center gap-1 rounded-full pl-3 text-sm ring-1 ring-inset sm:h-7 sm:pl-2.5",
                  t.inherited ? "pr-3 sm:pr-2.5" : "pr-0.5",
                  shown
                    ? "bg-sky-50 text-sky-900 ring-sky-200 dark:bg-sky-950 dark:text-sky-100 dark:ring-sky-800"
                    : "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700",
                ]}
              >
                {pub ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shown ? "true" : "false"}
                    aria-label={`${t.tag}をサイトに表示`}
                    title={shown ? "サイトに表示" : "この写真では非表示"}
                    onClick$={() => {
                      t.hidden = !t.hidden;
                      void changed();
                    }}
                    class={[chipButton, "-ml-2 sm:-ml-1.5"]}
                  >
                    <Icon paths={shown ? EYE : EYE_SLASH} />
                  </button>
                ) : (
                  <span
                    title="非公開タグ"
                    aria-label="非公開タグ"
                    role="img"
                    class="inline-flex"
                  >
                    <VisibilityIcon visibility="private" />
                  </span>
                )}
                {t.inherited && (
                  <span title="カメラのタグ" class="inline-flex">
                    <CameraGlyph class="size-3.5 opacity-80" />
                    <span class="sr-only">（カメラのタグ）</span>
                  </span>
                )}
                <span class={pub && t.hidden ? "line-through" : undefined}>
                  {t.tag}
                </span>
                {!t.inherited && (
                  <button
                    type="button"
                    aria-label={`${t.tag}を外す`}
                    title="外す"
                    onClick$={() => {
                      const at = state.tags.indexOf(t);
                      if (at < 0) return;
                      state.tags.splice(at, 1);
                      // Its camera passes it on: it stays, as the
                      // camera's, shown or hidden as it was.
                      if (cameraTags.includes(t.tag)) {
                        state.tags.push({ ...t, inherited: true });
                      }
                      void changed();
                    }}
                    class={chipButton}
                  >
                    <span aria-hidden="true" class="text-base leading-none">
                      ×
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div class="flex gap-2">
        <label for="edit-tag-add" class="sr-only">
          タグを追加
        </label>
        <input
          id="edit-tag-add"
          ref={box}
          {...{ list: "edit-tag-options" }}
          placeholder="タグを追加"
          value={draft.value}
          maxLength={200}
          autoComplete="off"
          autoCapitalize="off"
          spellcheck={false}
          enterKeyHint="done"
          aria-invalid={typed && !typed.ok ? "true" : undefined}
          aria-describedby={typed && !typed.ok ? "edit-tag-error" : undefined}
          // (Not bind:value, which this handler would replace.) A
          // suggestion picked from the list is added at once.
          onInput$={(e, el) => {
            draft.value = el.value;
            if ((e as InputEvent).inputType === "insertReplacementText") {
              void add();
            }
          }}
          onKeyDown$={[
            sync$((e: KeyboardEvent) => {
              // Enter adds the tag instead of saving the form.
              if (e.key === "Enter" && !e.isComposing) e.preventDefault();
            }),
            $((e: KeyboardEvent) => {
              if (e.key === "Enter" && !e.isComposing) void add();
            }),
          ]}
          class={[field, "min-w-0"]}
        />
        <datalist id="edit-tag-options">
          {siteTags.map((t) => (
            <option
              key={t.name}
              value={t.name}
              label={t.public ? undefined : "非公開タグ"}
            />
          ))}
        </datalist>
        <button
          type="button"
          onClick$={add}
          disabled={!typed?.ok}
          class={[buttonSecondary, "shrink-0 whitespace-nowrap"]}
        >
          追加
        </button>
      </div>
      {typed && !typed.ok && (
        <p
          id="edit-tag-error"
          role="alert"
          class="mt-1 text-xs text-red-700 dark:text-red-400"
        >
          {typed.error}
        </p>
      )}
    </div>
  );
});
