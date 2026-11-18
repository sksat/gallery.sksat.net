import {
  $,
  component$,
  useSignal,
  useVisibleTask$,
  type QRL,
  type Signal,
} from "@builder.io/qwik";
import {
  EDITABLE_FIELDS,
  FIELD_LABELS,
  LEVEL_LABELS,
  METADATA_LEVELS,
} from "~/lib/metadata";
import { PLATFORMS, VISIBILITIES } from "~/lib/types";
import {
  EXTENSIONS,
  NAME_PRESETS,
  ORIENTATIONS,
  ORIENTATION_LABELS,
  ruleTitle,
  validateRule,
  type RuleActions,
  type RuleConditions,
  type UploadRule,
} from "~/lib/upload-rules";
import { parseTagsInput } from "~/lib/validate";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  field,
  label,
  muted,
  platformBadge,
} from "./ui";
import {
  VISIBILITY_LABELS_JA,
  VISIBILITY_STYLE,
  VisibilityIcon,
} from "./visibility-style";

// One upload rule in a sheet (a dialog along the bottom on phones, centred
// from sm up): its name, the conditions (all must hold) and what it sets.
// Conditions and actions are added from a picker, one row each, with the
// same controls as elsewhere (visibility buttons, the camera list,
// platform badges).

type CondKey = keyof RuleConditions;
type ActionKey = keyof RuleActions;

export const CONDITION_LABELS: Record<CondKey, string> = {
  folder: "フォルダ",
  name: "ファイル名",
  ext: "拡張子",
  creatorTool: "作成ソフト (XMP)",
  world: "VRChat ワールド",
  camera: "カメラ (EXIF)",
  orientation: "向き",
  gps: "位置情報",
};

export const ACTION_LABELS: Record<ActionKey, string> = {
  platform: "Platform",
  cameraId: "カメラ",
  tags: "タグ",
  visibility: "公開範囲",
  metadata: "公開する情報",
};

const CONDITION_DEFAULTS: Required<RuleConditions> = {
  folder: "",
  name: { preset: "vrchat" },
  ext: "png",
  creatorTool: "",
  world: true,
  camera: "",
  orientation: "landscape",
  gps: true,
};

/** A rule being edited; tags are kept as typed. */
export type RuleDraft = UploadRule & { tagsText: string };

export const toDraft = (r: UploadRule): RuleDraft => ({
  ...structuredClone(r),
  tagsText: (r.actions.tags ?? []).join(", "),
});

const fromDraft = (d: RuleDraft): unknown => {
  const { tagsText, ...rule } = d;
  const actions = { ...rule.actions };
  if ("tags" in actions) actions.tags = parseTagsInput(tagsText);
  return { ...rule, actions };
};

/** A fresh id for a new rule. */
export const newRuleId = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return `r${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
};

/** Buttons for one value out of a few (a radio group). */
const Choice = <T extends string>({
  name,
  legend,
  options,
  value,
  onPick$,
  styleOf,
}: {
  name: string;
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onPick$: QRL<(v: T) => void>;
  styleOf?: (v: T) => string;
}) => (
  <fieldset>
    <legend class="sr-only">{legend}</legend>
    <div class="flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={o.value}
          class={[
            "inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-sm sm:h-10 dark:border-zinc-700",
            "has-checked:border-sky-500 has-checked:ring-1 has-checked:ring-sky-500 has-focus-visible:ring-2",
            styleOf?.(o.value),
          ]}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange$={() => onPick$(o.value)}
            class="sr-only"
          />
          {o.label}
        </label>
      ))}
    </div>
  </fieldset>
);

const RemoveButton = ({
  what,
  onClick$,
}: {
  what: string;
  onClick$: QRL<() => void>;
}) => (
  <button
    type="button"
    aria-label={`${what}を外す`}
    onClick$={onClick$}
    class="grid size-11 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 sm:size-9 dark:hover:bg-zinc-800"
  >
    <span aria-hidden="true">✕</span>
  </button>
);

type Props = {
  draft: Signal<RuleDraft>;
  isNew: boolean;
  cameras: { id: number; name: string }[];
  busy: boolean;
  onSave$: QRL<(rule: UploadRule) => Promise<void>>;
  onClose$: QRL<() => void>;
};

export const UploadRuleEditor = component$<Props>(
  ({ draft, isNew, cameras, busy, onSave$, onClose$ }) => {
    const ref = useSignal<HTMLDialogElement>();
    const error = useSignal<string | null>(null);
    // Rendered only while open: open it as a modal once it is in the DOM.
    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(() => {
      ref.value?.showModal();
    });

    const d = draft.value;
    const conds = Object.keys(d.conditions) as CondKey[];
    const acts = Object.keys(d.actions) as ActionKey[];
    const setCond = $((k: CondKey, v: unknown) => {
      draft.value = {
        ...draft.value,
        conditions: { ...draft.value.conditions, [k]: v },
      };
    });
    const dropCond = $((k: CondKey) => {
      const next = { ...draft.value.conditions };
      delete next[k];
      draft.value = { ...draft.value, conditions: next };
    });
    const setAction = $((k: ActionKey, v: unknown) => {
      draft.value = {
        ...draft.value,
        actions: { ...draft.value.actions, [k]: v },
      };
    });
    const dropAction = $((k: ActionKey) => {
      const next = { ...draft.value.actions };
      delete next[k];
      draft.value = { ...draft.value, actions: next };
    });
    const save = $(async () => {
      const v = validateRule(fromDraft(draft.value));
      if (!v.ok) {
        error.value = v.error;
        return;
      }
      error.value = null;
      await onSave$(v.value);
    });

    const condRow = (k: CondKey) => {
      const c = d.conditions;
      const id = `rule-cond-${k}`;
      let control;
      switch (k) {
        case "folder":
        case "creatorTool":
        case "camera":
          control = (
            <input
              id={id}
              type="text"
              value={c[k] as string}
              placeholder={
                k === "folder" ? "/VRChat" : k === "camera" ? "X-T5" : "VRChat"
              }
              autoCapitalize="off"
              autoCorrect="off"
              spellcheck={false}
              onInput$={(_, el) => setCond(k, el.value)}
              class={field}
            />
          );
          break;
        case "name": {
          const n = c.name!;
          const preset = "preset" in n ? n.preset : "";
          control = (
            <div class="flex flex-col gap-2 sm:flex-row">
              <select
                id={id}
                onChange$={(_, el) =>
                  setCond(
                    "name",
                    el.value === "" ? { glob: "" } : { preset: el.value },
                  )
                }
                class={[field, "sm:w-auto"]}
              >
                {Object.entries(NAME_PRESETS).map(([key, p]) => (
                  <option key={key} value={key} selected={preset === key}>
                    {p.label}
                  </option>
                ))}
                <option value="" selected={preset === ""}>
                  パターン (* と ?)
                </option>
              </select>
              {"glob" in n && (
                <input
                  type="text"
                  aria-label="ファイル名のパターン"
                  value={n.glob}
                  placeholder="DSCF*.jpg"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellcheck={false}
                  onInput$={(_, el) => setCond("name", { glob: el.value })}
                  class={field}
                />
              )}
            </div>
          );
          break;
        }
        case "ext":
          control = (
            <Choice
              name={id}
              legend={CONDITION_LABELS.ext}
              options={EXTENSIONS.map((e) => ({
                value: e,
                label: e === "jpg" ? "JPEG" : "PNG",
              }))}
              value={c.ext!}
              onPick$={$((v: string) => setCond("ext", v))}
            />
          );
          break;
        case "world":
        case "gps":
          control = (
            <Choice
              name={id}
              legend={CONDITION_LABELS[k]}
              options={[
                { value: "yes", label: "あり" },
                { value: "no", label: "なし" },
              ]}
              value={c[k] ? "yes" : "no"}
              onPick$={$((v: string) => setCond(k, v === "yes"))}
            />
          );
          break;
        case "orientation":
          control = (
            <Choice
              name={id}
              legend={CONDITION_LABELS.orientation}
              options={ORIENTATIONS.map((o) => ({
                value: o,
                label: ORIENTATION_LABELS[o],
              }))}
              value={c.orientation!}
              onPick$={$((v: string) => setCond("orientation", v))}
            />
          );
          break;
      }
      return (
        <li key={k} data-condition={k} class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            {/* The button groups are fieldsets with their own legend. */}
            {k === "ext" ||
            k === "world" ||
            k === "gps" ||
            k === "orientation" ? (
              <p class={label} aria-hidden="true">
                {CONDITION_LABELS[k]}
              </p>
            ) : (
              <label for={id} class={label}>
                {CONDITION_LABELS[k]}
              </label>
            )}
            {control}
          </div>
          <RemoveButton
            what={CONDITION_LABELS[k]}
            onClick$={$(() => dropCond(k))}
          />
        </li>
      );
    };

    const actionRow = (k: ActionKey) => {
      const a = d.actions;
      const id = `rule-action-${k}`;
      let control;
      switch (k) {
        case "platform":
          control = (
            <Choice
              name={id}
              legend="Platform"
              options={PLATFORMS.map((p) => ({ value: p, label: p }))}
              value={a.platform!}
              onPick$={$((v: string) => setAction("platform", v))}
              styleOf={(p) => platformBadge(p) + " h-11! rounded-lg! px-3!"}
            />
          );
          break;
        case "cameraId":
          control = (
            <select
              id={id}
              onChange$={(_, el) => setAction("cameraId", Number(el.value))}
              class={field}
            >
              {cameras.map((c) => (
                <option key={c.id} value={c.id} selected={a.cameraId === c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          );
          break;
        case "tags":
          control = (
            <input
              id={id}
              type="text"
              value={d.tagsText}
              placeholder="VRChat, night"
              autoCapitalize="off"
              autoCorrect="off"
              spellcheck={false}
              onInput$={(_, el) =>
                (draft.value = { ...draft.value, tagsText: el.value })
              }
              class={field}
            />
          );
          break;
        case "visibility":
          control = (
            <fieldset>
              <legend class="sr-only">公開範囲</legend>
              <div class="grid grid-cols-3 gap-2">
                {VISIBILITIES.map((v) => (
                  <label
                    key={v}
                    class={[
                      "flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-zinc-200 px-2 text-sm font-medium has-focus-visible:ring-2 sm:h-10 dark:border-zinc-800",
                      VISIBILITY_STYLE[v].card,
                      VISIBILITY_STYLE[v].accent,
                    ]}
                  >
                    <input
                      type="radio"
                      name={id}
                      value={v}
                      checked={a.visibility === v}
                      onChange$={() => setAction("visibility", v)}
                      class="sr-only"
                    />
                    <VisibilityIcon visibility={v} />
                    {VISIBILITY_LABELS_JA[v]}
                  </label>
                ))}
              </div>
            </fieldset>
          );
          break;
        case "metadata":
          control = (
            <div class="grid gap-2 sm:grid-cols-2">
              {EDITABLE_FIELDS.map((f) => {
                const labels = LEVEL_LABELS[f] as Record<string, string>;
                const cur = a.metadata?.[f] ?? "";
                return (
                  <div key={f}>
                    <label for={`${id}-${f}`} class={["text-xs", muted]}>
                      {FIELD_LABELS[f]}
                    </label>
                    <select
                      id={`${id}-${f}`}
                      data-testid={`rule-metadata-${f}`}
                      onChange$={(_, el) => {
                        const m: Record<string, string> = {
                          ...(draft.value.actions.metadata ?? {}),
                        };
                        if (el.value === "") delete m[f];
                        else m[f] = el.value;
                        setAction("metadata", m);
                      }}
                      class={field}
                    >
                      <option value="" selected={cur === ""}>
                        そのまま
                      </option>
                      {(METADATA_LEVELS[f] as readonly string[]).map(
                        (level) => (
                          <option
                            key={level}
                            value={level}
                            selected={cur === level}
                          >
                            {labels[level]}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                );
              })}
            </div>
          );
          break;
      }
      return (
        <li key={k} data-action={k} class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            {k === "visibility" || k === "platform" || k === "metadata" ? (
              <p class={label}>{ACTION_LABELS[k]}</p>
            ) : (
              <label for={id} class={label}>
                {ACTION_LABELS[k]}
              </label>
            )}
            {control}
          </div>
          <RemoveButton
            what={ACTION_LABELS[k]}
            onClick$={$(() => dropAction(k))}
          />
        </li>
      );
    };

    const freeConds = (Object.keys(CONDITION_LABELS) as CondKey[]).filter(
      (k) => !conds.includes(k),
    );
    const freeActions = (Object.keys(ACTION_LABELS) as ActionKey[]).filter(
      (k) => !acts.includes(k) && (k !== "cameraId" || cameras.length > 0),
    );

    return (
      <dialog
        ref={ref}
        aria-labelledby="rule-editor-title"
        onClose$={onClose$}
        onClick$={(ev, el) => {
          if (ev.target === el) el.close();
        }}
        class={[
          "m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl bg-transparent p-0 text-inherit backdrop:bg-black/40",
          "max-sm:fixed max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:m-0 max-sm:max-h-[90dvh] max-sm:w-full max-sm:rounded-b-none",
        ]}
      >
        <form
          preventdefault:submit
          onSubmit$={save}
          data-testid="rule-editor"
          class={[card, "space-y-5 p-4 pb-0! max-sm:rounded-b-none sm:p-6"]}
        >
          <h2
            id="rule-editor-title"
            tabIndex={-1}
            autofocus
            class="text-base font-semibold outline-none"
          >
            {isNew ? "ルールを追加" : "ルールを編集"}
          </h2>

          <div>
            <label for="rule-name" class={label}>
              名前
            </label>
            <input
              id="rule-name"
              type="text"
              value={d.name}
              maxLength={60}
              placeholder={ruleTitle({ ...d, name: "" })}
              onInput$={(_, el) =>
                (draft.value = { ...draft.value, name: el.value })
              }
              class={field}
            />
          </div>

          <section aria-labelledby="rule-conds" class="space-y-3">
            <h3 id="rule-conds" class="text-sm font-semibold">
              条件{" "}
              <span class={["font-normal", muted]}>(すべて満たすとき)</span>
            </h3>
            {conds.length > 0 && (
              <ul class="space-y-3">{conds.map(condRow)}</ul>
            )}
            {freeConds.length > 0 && (
              <select
                aria-label="条件を追加"
                data-testid="add-condition"
                onChange$={(_, el) => {
                  const k = el.value as CondKey;
                  el.value = "";
                  if (k) setCond(k, structuredClone(CONDITION_DEFAULTS[k]));
                }}
                class={[field, "sm:w-auto"]}
              >
                <option value="" selected>
                  ＋ 条件を追加
                </option>
                {freeConds.map((k) => (
                  <option key={k} value={k}>
                    {CONDITION_LABELS[k]}
                  </option>
                ))}
              </select>
            )}
          </section>

          <section aria-labelledby="rule-actions" class="space-y-3">
            <h3 id="rule-actions" class="text-sm font-semibold">
              決めること
            </h3>
            {acts.length > 0 && (
              <ul class="space-y-3">{acts.map(actionRow)}</ul>
            )}
            {freeActions.length > 0 && (
              <select
                aria-label="決めることを追加"
                data-testid="add-action"
                onChange$={(_, el) => {
                  const k = el.value as ActionKey;
                  el.value = "";
                  if (!k) return;
                  const initial: Record<ActionKey, unknown> = {
                    platform: "VRChat",
                    cameraId: cameras[0]?.id,
                    tags: [],
                    visibility: "private",
                    metadata: {},
                  };
                  setAction(k, initial[k]);
                }}
                class={[field, "sm:w-auto"]}
              >
                <option value="" selected>
                  ＋ 決めることを追加
                </option>
                {freeActions.map((k) => (
                  <option key={k} value={k}>
                    {ACTION_LABELS[k]}
                  </option>
                ))}
              </select>
            )}
          </section>

          {error.value && (
            <p role="alert" class="text-sm text-red-700 dark:text-red-400">
              {error.value}
            </p>
          )}

          {/* The buttons stay at the bottom of the sheet while it
              scrolls; they carry the form's bottom padding. */}
          <div class="sticky bottom-0 -mx-4 flex justify-end gap-2 rounded-b-xl border-t border-zinc-200 bg-white px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] max-sm:rounded-b-none sm:-mx-6 sm:px-6 sm:pb-6 dark:border-zinc-800 dark:bg-zinc-900">
            <button
              type="button"
              onClick$={() => ref.value?.close()}
              class={[buttonSecondary, "max-sm:flex-1"]}
            >
              やめる
            </button>
            <button
              type="submit"
              disabled={busy}
              class={[buttonPrimary, "max-sm:flex-1"]}
            >
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </dialog>
    );
  },
);
