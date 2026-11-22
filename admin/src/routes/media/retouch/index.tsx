import { $, component$, useSignal } from "@builder.io/qwik";
import {
  Link,
  routeAction$,
  routeLoader$,
  z,
  zod$,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { MissingBindingError } from "~/components/missing-binding-error";
import { StatePanel } from "~/components/state-panel";
import { Thumb } from "~/components/thumb";
import { Toast, type ToastState } from "~/components/toast";
import {
  backLink,
  buttonPrimary,
  card,
  muted,
  tagChip,
  VISIBILITY_LABELS,
} from "~/components/ui";
import { VisibilityBadge } from "~/components/visibility-badge";
import {
  listMergeCandidates,
  MergeError,
  mergePhotos,
  unmergePhoto,
  type CandidatePhoto,
  type MergeCandidate,
} from "~/lib/db-merge";
import { getDB, getImageBase } from "~/lib/env";
import { formatJst } from "~/lib/format";
import { formatUploadSize } from "~/lib/upload";
import { VISIBILITIES, type Visibility } from "~/lib/types";

// Photos uploaded on their own that look like a retouch of another photo
// (the same name in the same folder with "_DxO", "-Edit", ...): side by
// side, to merge into one photo with the retouch as its retouched version.

type PageData =
  | {
      kind: "ok";
      candidates: MergeCandidate[];
      imageBase: string | null;
    }
  | { kind: "missing-binding" };

export const useCandidates = routeLoader$<PageData>(
  async ({ platform, status }) => {
    let db: D1Database;
    try {
      db = getDB(platform);
    } catch (err) {
      console.error("/media/retouch loader: getDB failed:", err);
      status(500);
      return { kind: "missing-binding" };
    }
    return {
      kind: "ok",
      candidates: await listMergeCandidates(db),
      imageBase: getImageBase(platform),
    };
  },
);

/** Merges per request (each is a few D1 statements). */
const MAX_MERGES = 20;

export const useMerge = routeAction$(
  async (data, { platform }) => {
    const db = getDB(platform);
    const aliases: string[] = [];
    const problems: string[] = [];
    for (const m of data.merges) {
      try {
        aliases.push((await mergePhotos(db, m)).alias);
      } catch (err) {
        if (!(err instanceof MergeError)) throw err;
        problems.push(err.message);
      }
    }
    return { ok: true, aliases, problems };
  },
  zod$({
    merges: z
      .array(
        z.object({
          into: z.number().int().positive(),
          from: z.number().int().positive(),
          visibility: z.enum(VISIBILITIES),
          show: z.boolean(),
        }),
      )
      .min(1)
      .max(MAX_MERGES),
  }),
);

export const useUnmerge = routeAction$(
  async (data, { platform }) => {
    const db = getDB(platform);
    let restored = 0;
    const problems: string[] = [];
    // The last merge first (a photo merged on is undone after).
    for (const alias of [...data.aliases].reverse()) {
      try {
        await unmergePhoto(db, alias);
        restored++;
      } catch (err) {
        if (!(err instanceof MergeError)) throw err;
        problems.push(err.message);
      }
    }
    return { ok: true, restored, problems };
  },
  zod$({ aliases: z.array(z.string().max(20)).min(1).max(MAX_MERGES) }),
);

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const PhotoSide = ({
  photo,
  role,
  imageBase,
}: {
  photo: CandidatePhoto;
  role: string;
  imageBase: string | null;
}) => (
  <div class="min-w-0 space-y-1.5">
    <Thumb
      file={photo.file}
      platform={photo.platform}
      imageBase={imageBase}
      variant="list"
      class="w-full rounded-md"
    />
    <p class={["text-xs font-medium", muted]}>{role}</p>
    <Link
      prefetch="js"
      href={`/media/${photo.id}/`}
      class="block text-sm font-medium break-all hover:underline"
    >
      {nameOf(photo.path)}
    </Link>
    <div class="flex flex-wrap items-center gap-1.5">
      <VisibilityBadge visibility={photo.visibility} />
      {photo.creatorTool && <span class={tagChip}>{photo.creatorTool}</span>}
    </div>
    <p class={["text-xs tabular-nums", muted]}>
      {[
        formatJst(photo.timestamp),
        photo.width && photo.height ? `${photo.width} × ${photo.height}` : null,
        photo.size !== null ? formatUploadSize(photo.size) : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    </p>
  </div>
);

export default component$(() => {
  const data = useCandidates();
  const merge = useMerge();
  const unmerge = useUnmerge();
  const toast = useSignal<ToastState | null>(null);
  /** Picked candidates, by the retouch's id. */
  const picked = useSignal<number[]>([]);
  /** Choices changed from the defaults, by the retouch's id. */
  const choices = useSignal<
    Record<number, { visibility?: Visibility; show?: boolean }>
  >({});
  const lastAliases = useSignal<string[]>([]);

  const mergePicked = $(async () => {
    if (data.value.kind !== "ok") return;
    const merges = data.value.candidates
      .filter((c) => picked.value.includes(c.retouch.id))
      .slice(0, MAX_MERGES)
      .map((c) => ({
        into: c.original.id,
        from: c.retouch.id,
        visibility:
          choices.value[c.retouch.id]?.visibility ?? c.defaults.visibility,
        show: choices.value[c.retouch.id]?.show ?? c.defaults.show,
      }));
    // Two visibilities: the owner picks one (no default).
    const ready = merges.flatMap((m) =>
      m.visibility === null ? [] : [{ ...m, visibility: m.visibility }],
    );
    if (ready.length === 0 || ready.length < merges.length) return;
    const { value } = await merge.submit({ merges: ready });
    if (value.failed) {
      toast.value = { tone: "error", message: "統合できませんでした" };
      return;
    }
    picked.value = [];
    choices.value = {};
    lastAliases.value = value.aliases;
    const done = value.aliases.length;
    const failed = value.problems;
    toast.value =
      failed.length > 0
        ? {
            tone: "error",
            message: `${done} 組を統合、${failed.length} 組はできませんでした: ${failed[0]}`,
            ...(done > 0 ? { actionLabel: "元に戻す" } : {}),
          }
        : {
            tone: "success",
            message: `${done} 組を統合しました。`,
            actionLabel: "元に戻す",
          };
  });
  const undo = $(async () => {
    const aliases = lastAliases.value;
    lastAliases.value = [];
    if (aliases.length === 0) return;
    const { value } = await unmerge.submit({ aliases });
    const failed = value.failed ? [""] : value.problems;
    toast.value =
      failed.length > 0
        ? { tone: "error", message: `元に戻せませんでした: ${failed[0]}` }
        : { tone: "success", message: "元に戻しました。" };
  });

  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/media/" />;
  }
  const { candidates, imageBase } = data.value;
  const count = picked.value.length;
  /** Picked ones whose visibility is still to be chosen. */
  const unchosen = candidates.filter(
    (c) =>
      picked.value.includes(c.retouch.id) &&
      (choices.value[c.retouch.id]?.visibility ?? c.defaults.visibility) ===
        null,
  ).length;

  return (
    <div class="mx-auto max-w-4xl space-y-6">
      <div>
        <Link prefetch="js" href="/media/?view=files" class={backLink}>
          ← Files
        </Link>
        <h1 class="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          レタッチ版の候補{" "}
          <span class={["font-normal", muted]}>({candidates.length})</span>
        </h1>
      </div>

      {candidates.length === 0 ? (
        <StatePanel tone="empty" level={2} title="候補はありません">
          <p>
            同じフォルダに、名前に _DxO や -Edit
            などを付けた写真があると、ここに並びます。
          </p>
        </StatePanel>
      ) : (
        <ul class="space-y-4">
          {candidates.map((c) => {
            const id = c.retouch.id;
            const visibility =
              choices.value[id]?.visibility ?? c.defaults.visibility;
            const show = choices.value[id]?.show ?? c.defaults.show;
            const on = picked.value.includes(id);
            const shared = [
              c.signals.sameTime && "撮影日時が同じ",
              c.signals.sameCamera && "カメラが同じ",
            ].filter((s): s is string => !!s);
            const options = [
              ...new Set([c.original.visibility, c.retouch.visibility]),
            ];
            return (
              <li
                key={`${c.original.id}-${id}`}
                data-testid="merge-candidate"
                class={[card, "space-y-3 p-4", on && "ring-2 ring-sky-500"]}
              >
                <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium sm:min-h-0">
                  <input
                    type="checkbox"
                    checked={on}
                    aria-label={`${nameOf(c.retouch.path)} を ${nameOf(c.original.path)} に統合する`}
                    onChange$={(_, el) => {
                      picked.value = el.checked
                        ? [...picked.value, id]
                        : picked.value.filter((x) => x !== id);
                    }}
                    class="size-5 accent-sky-600"
                  />
                  統合する
                  {shared.length > 0 && (
                    <span class={["ml-auto text-xs font-normal", muted]}>
                      {shared.join(" · ")}
                    </span>
                  )}
                </label>
                <div class="grid grid-cols-2 gap-3 sm:gap-4">
                  <PhotoSide
                    photo={c.original}
                    role="元の写真"
                    imageBase={imageBase}
                  />
                  <PhotoSide
                    photo={c.retouch}
                    role="レタッチ版"
                    imageBase={imageBase}
                  />
                </div>
                <div class="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
                  {options.length > 1 && (
                    <fieldset class="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <legend class="float-left mr-2 font-medium">
                        公開範囲
                      </legend>
                      {options.map((v) => (
                        <label
                          key={v}
                          class="inline-flex min-h-11 items-center gap-1.5 sm:min-h-0"
                        >
                          <input
                            type="radio"
                            name={`visibility-${id}`}
                            checked={visibility === v}
                            onChange$={() => {
                              choices.value = {
                                ...choices.value,
                                [id]: { ...choices.value[id], visibility: v },
                              };
                            }}
                            class="size-4 accent-sky-600"
                          />
                          {VISIBILITY_LABELS[v]}
                          <span class={["text-xs", muted]}>
                            （
                            {v === c.retouch.visibility
                              ? "レタッチ版"
                              : "元の写真"}
                            と同じ）
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <label class="inline-flex min-h-11 items-center gap-1.5 sm:min-h-0">
                    <input
                      type="checkbox"
                      checked={show}
                      onChange$={(_, el) => {
                        choices.value = {
                          ...choices.value,
                          [id]: { ...choices.value[id], show: el.checked },
                        };
                      }}
                      class="size-4 accent-sky-600"
                    />
                    レタッチ版を公開サイトに表示
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {candidates.length > 0 && (
        <div
          // Phones: in place of the tab bar, like the edit page's bar.
          data-bottom-bar="short"
          class="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-zinc-200 bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur sm:sticky sm:rounded-xl sm:border sm:px-4 sm:pb-3 dark:border-zinc-800 dark:bg-zinc-900/95"
        >
          <p class={["mr-auto text-sm", muted]}>
            {count === 0
              ? "統合する組を選んでください"
              : unchosen > 0
                ? `${unchosen} 組の公開範囲を選んでください`
                : `${count} 組を選択中`}
          </p>
          <button
            type="button"
            disabled={count === 0 || unchosen > 0 || merge.isRunning}
            onClick$={mergePicked}
            class={buttonPrimary}
          >
            {merge.isRunning ? "統合中…" : "統合"}
          </button>
        </div>
      )}
      <Toast toast={toast} onAction$={undo} />
    </div>
  );
});

export const head: DocumentHead = {
  title: "レタッチ版の候補 — Admin",
};
