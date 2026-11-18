import { $, component$, useSignal } from "@builder.io/qwik";
import { Spinner } from "./submit-button";
import { buttonSecondary, card, muted } from "./ui";

// /setting/: read the EXIF / VRChat world of photos uploaded before the
// uploader did (POST /api/metadata/backfill, a batch per call until done).

type Batch = {
  read: number;
  found: number;
  failed: number;
  next: number | null;
  remaining: number;
};

export const MetadataBackfill = component$<{ unread: number }>(({ unread }) => {
  const remaining = useSignal(unread);
  const running = useSignal(false);
  const found = useSignal(0);
  const failed = useSignal(0);
  const error = useSignal<string | null>(null);

  const run = $(async () => {
    running.value = true;
    error.value = null;
    found.value = 0;
    failed.value = 0;
    try {
      let after: number | null = 0;
      while (after !== null) {
        const res = await fetch("/api/metadata/backfill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ after }),
        });
        const body = (await res.json().catch(() => null)) as
          (Batch & { error?: string }) | null;
        if (!res.ok || !body) {
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        found.value += body.found;
        failed.value += body.failed;
        remaining.value = body.remaining;
        after = body.next;
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      running.value = false;
    }
  });

  return (
    <section
      class={[card, "space-y-3 p-4 sm:p-6"]}
      data-testid="metadata-backfill"
    >
      <h2 class="text-sm font-semibold">元ファイルのメタデータ</h2>
      <p class="text-sm" aria-live="polite">
        {remaining.value === 0
          ? "すべて読み込み済みです"
          : `未読み込み ${remaining.value} 枚`}
        {(found.value > 0 || failed.value > 0) && (
          <span class={muted}>
            {` · 見つかった ${found.value} 枚`}
            {failed.value > 0 && ` · 失敗 ${failed.value} 枚`}
          </span>
        )}
      </p>
      {error.value && (
        <p class="text-sm text-red-700 dark:text-red-400" role="alert">
          {error.value}
        </p>
      )}
      {remaining.value > 0 && (
        <button
          type="button"
          class={buttonSecondary}
          disabled={running.value}
          onClick$={run}
        >
          {running.value && <Spinner />}
          {running.value ? "読み込み中…" : "読み込む"}
        </button>
      )}
    </section>
  );
});
