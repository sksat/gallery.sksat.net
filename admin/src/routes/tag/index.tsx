import { component$, useSignal, useTask$ } from "@builder.io/qwik";
import {
  Form,
  routeAction$,
  routeLoader$,
  z,
  zod$,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { MissingBindingError } from "~/components/missing-binding-error";
import { StatePanel } from "~/components/state-panel";
import { Toast, type ToastState } from "~/components/toast";
import { card, muted } from "~/components/ui";
import { listTags, setTagPublic, type TagRow } from "~/lib/db-meta";
import { getDB } from "~/lib/env";
import { contentChanged } from "~/lib/last-good";

// /tag/: every tag, how many photos have it, and whether it is public.
// The public site only ever shows public tags; new ones start private.

type TagResult = { kind: "ok"; tags: TagRow[] } | { kind: "missing-binding" };

export const useTags = routeLoader$<TagResult>(async ({ platform, status }) => {
  try {
    return { kind: "ok", tags: await listTags(getDB(platform)) };
  } catch (err) {
    console.error("/tag loader: getDB failed:", err);
    status(500);
    return { kind: "missing-binding" };
  }
});

export const useSetTagPublic = routeAction$(
  async (data, { platform }) => {
    const db = getDB(platform);
    await setTagPublic(db, data.name, data.public === "1");
    await contentChanged(platform, db, { hide: data.public !== "1" });
    return { ok: true, name: data.name, public: data.public === "1" };
  },
  zod$({ name: z.string().min(1).max(200), public: z.enum(["0", "1"]) }),
);

export default component$(() => {
  const data = useTags();
  const toggle = useSetTagPublic();
  const toast = useSignal<ToastState | null>(null);
  /** The last change, for 元に戻す. */
  const last = useSignal<{ name: string; public: boolean } | null>(null);
  useTask$(({ track }) => {
    const v = track(() => toggle.value);
    if (!v) return;
    if (v.failed) {
      toast.value = { tone: "error", message: "変更できませんでした" };
      return;
    }
    last.value = { name: v.name, public: !v.public };
    toast.value = {
      tone: "success",
      message: `『${v.name}』を${v.public ? "公開" : "非公開"}にしました。`,
      actionLabel: "元に戻す",
    };
  });

  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/" />;
  }
  const { tags } = data.value;
  return (
    <div class="mx-auto max-w-3xl space-y-6">
      <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">
        タグ <span class={["font-normal", muted]}>({tags.length})</span>
      </h1>
      {tags.length === 0 ? (
        <StatePanel tone="empty" level={2} title="タグはまだありません" />
      ) : (
        <ul
          class={[
            card,
            "divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800",
          ]}
        >
          {tags.map((t) => (
            <li
              key={t.name}
              data-testid="tag-row"
              class="flex items-center gap-3 px-4 py-2"
            >
              <span class="min-w-0 flex-1 truncate font-medium">{t.name}</span>
              <span class={["text-xs tabular-nums", muted]}>{t.count} 枚</span>
              <Form action={toggle}>
                <input type="hidden" name="name" value={t.name} />
                <input
                  type="hidden"
                  name="public"
                  value={t.public ? "0" : "1"}
                />
                {/* A switch: its state is the tag's. */}
                <button
                  type="submit"
                  role="switch"
                  aria-checked={t.public}
                  aria-label={`${t.name} を公開`}
                  disabled={toggle.isRunning}
                  class="group flex h-11 items-center gap-2 text-sm sm:h-9"
                >
                  <span
                    class={[
                      "relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors",
                      t.public ? "bg-sky-600" : "bg-zinc-300 dark:bg-zinc-700",
                    ]}
                  >
                    <span
                      class={[
                        "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
                        t.public ? "translate-x-4.5" : "translate-x-0.5",
                      ]}
                    />
                  </span>
                  <span class="w-12 text-left">
                    {t.public ? "公開" : "非公開"}
                  </span>
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}
      <Toast
        toast={toast}
        onAction$={async () => {
          const l = last.value;
          if (!l) return;
          last.value = null;
          await toggle.submit({ name: l.name, public: l.public ? "1" : "0" });
        }}
      />
    </div>
  );
});

export const head: DocumentHead = { title: "タグ — Admin" };
