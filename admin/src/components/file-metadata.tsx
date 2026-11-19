import { $, component$, useSignal, type JSXOutput } from "@builder.io/qwik";
import { formatUploadSize } from "~/lib/upload";
import type { Json, RawMeta, RawSection } from "~/lib/raw-meta";
import { buttonSecondary, card, muted } from "./ui";

type Loaded = RawMeta & { file: string };

type State =
  | { kind: "idle" | "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; meta: Loaded };

/** Text longer than this is cut, with a button for the rest. */
const SHORT = 160;

const LongText = component$<{ text: string }>(({ text }) => {
  const all = useSignal(false);
  const long = text.length > SHORT;
  return (
    <span class="break-all whitespace-pre-wrap">
      {all.value || !long ? text : `${text.slice(0, SHORT)}…`}
      {long && (
        <button
          type="button"
          class="ml-1 text-sky-700 hover:underline dark:text-sky-400"
          onClick$={() => (all.value = !all.value)}
        >
          {all.value
            ? "閉じる"
            : `すべて表示（${text.length.toLocaleString()} 文字）`}
        </button>
      )}
    </span>
  );
});

const isObject = (v: Json): v is { [k: string]: Json } =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isScalar = (v: Json) => v === null || typeof v !== "object";

/** A value: text, a short list on one line, or nested keys. */
const Value = (v: Json): JSXOutput => {
  if (v === null) return <span class={muted}>—</span>;
  if (typeof v === "string") return <LongText text={v} />;
  if (typeof v !== "object")
    return <span class="tabular-nums">{String(v)}</span>;
  if (Array.isArray(v)) {
    if (v.every(isScalar))
      return <LongText text={v.map((x) => String(x)).join(", ")} />;
    return (
      <ol class="space-y-1">
        {v.map((x, i) => (
          <li key={i}>{Value(x)}</li>
        ))}
      </ol>
    );
  }
  return Tree(v);
};

const Tree = (o: { [k: string]: Json }): JSXOutput => (
  <dl class="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
    {Object.entries(o).map(([k, v]) =>
      isObject(v) || (Array.isArray(v) && !v.every(isScalar)) ? (
        <details key={k} class="col-span-2" open>
          <summary class="cursor-pointer font-medium">{k}</summary>
          <div class="mt-1 ml-3 border-l border-zinc-200 pl-3 dark:border-zinc-800">
            {Value(v)}
          </div>
        </details>
      ) : (
        <div key={k} class="contents">
          <dt class={["break-all", muted]}>{k}</dt>
          <dd class="min-w-0">{Value(v)}</dd>
        </div>
      ),
    )}
  </dl>
);

/** Sections by source, in the order the sources first appear. */
const bySource = (sections: RawSection[]) => {
  const groups = new Map<string, RawSection[]>();
  for (const s of sections) {
    const g = groups.get(s.source) ?? [];
    g.push(s);
    groups.set(s.source, g);
  }
  return [...groups];
};

/**
 * Everything in the photo file's metadata, read from the original when
 * the section is opened (GET /api/media/<id>/file-meta/).
 */
export const FileMetadata = component$<{ id: number; file: string }>(
  ({ id, file }) => {
    const state = useSignal<State>({ kind: "idle" });
    const copied = useSignal<"ok" | "failed" | null>(null);

    const load = $(async () => {
      state.value = { kind: "loading" };
      try {
        const q = new URLSearchParams({ file });
        const res = await fetch(`/api/media/${id}/file-meta/?${q}`);
        if (!res.ok) {
          state.value = {
            kind: "error",
            message:
              res.status === 404
                ? "ファイルが見つかりません"
                : `読めませんでした（${res.status}）`,
          };
          return;
        }
        state.value = { kind: "ok", meta: (await res.json()) as Loaded };
      } catch {
        state.value = { kind: "error", message: "読めませんでした" };
      }
    });

    const copy = $(async () => {
      if (state.value.kind !== "ok") return;
      try {
        await navigator.clipboard.writeText(
          JSON.stringify(state.value.meta, null, 2),
        );
        copied.value = "ok";
      } catch {
        copied.value = "failed";
      }
      setTimeout(() => (copied.value = null), 2000);
    });

    const s = state.value;
    return (
      <section aria-label="ファイルのメタデータ" class={[card, "p-4 sm:p-6"]}>
        <details
          class="group"
          data-testid="file-metadata"
          onToggle$={(_, el) => {
            const st = state.value.kind;
            if (el.open && (st === "idle" || st === "error")) load();
          }}
        >
          <summary class="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-zinc-700 sm:min-h-0 dark:text-zinc-300 [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              class={["transition-transform group-open:rotate-90", muted]}
            >
              ›
            </span>
            ファイルのメタデータ
          </summary>
          <div class="mt-3 space-y-4 text-xs">
            {s.kind === "loading" && (
              <p role="status" class={muted}>
                読み込み中…
              </p>
            )}
            {s.kind === "error" && (
              <p
                role="alert"
                class="flex items-center gap-3 text-red-700 dark:text-red-400"
              >
                {s.message}
                <button type="button" class={buttonSecondary} onClick$={load}>
                  再読み込み
                </button>
              </p>
            )}
            {s.kind === "ok" && (
              <>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span class="font-medium uppercase">{s.meta.format}</span>
                  <span class={["tabular-nums", muted]}>
                    {formatUploadSize(s.meta.size)}
                  </span>
                  {s.meta.truncated && (
                    <span
                      class="text-amber-700 dark:text-amber-400"
                      title={s.meta.truncated}
                    >
                      途中まで
                    </span>
                  )}
                  <button
                    type="button"
                    class={[buttonSecondary, "ml-auto"]}
                    onClick$={copy}
                  >
                    {copied.value === "ok"
                      ? "コピーしました"
                      : copied.value === "failed"
                        ? "コピーできませんでした"
                        : "JSON としてコピー"}
                  </button>
                </div>
                {bySource(s.meta.sections).map(([source, sections]) => (
                  <div key={source} data-source={source} class="space-y-2">
                    <h3 class="text-sm font-semibold">{source}</h3>
                    {sections.map((sec, i) => (
                      <details
                        key={i}
                        open
                        class="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
                      >
                        <summary class={["cursor-pointer", muted]}>
                          {sec.name}
                        </summary>
                        <div class="mt-2">{Value(sec.data)}</div>
                      </details>
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        </details>
      </section>
    );
  },
);
