import { component$, useSignal, useTask$ } from "@builder.io/qwik";
import {
  Form,
  Link,
  routeAction$,
  routeLoader$,
  z,
  zod$,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { MetadataSelect } from "~/components/metadata-select";
import { MissingBindingError } from "~/components/missing-binding-error";
import { SubmitButton } from "~/components/submit-button";
import { Toast, type ToastState } from "~/components/toast";
import { buttonPrimary, card, field, label, muted } from "~/components/ui";
import {
  getEmbedDefault,
  getSiteDefaults,
  setEmbedDefault,
  setSiteDefaults,
} from "~/lib/db-meta";
import { getDB } from "~/lib/env";
import { resizeMaker, setResizeMaker, type Maker } from "@shared/resized/claim";
import { contentChanged } from "~/lib/last-good";
import {
  EDITABLE_FIELDS,
  EMBED_LABEL,
  isLevel,
  type MetadataLevels,
} from "~/lib/metadata";

// /setting/: site-wide settings. For now the default of how much of each
// photo's metadata the public site shows; a photo can override any field
// on its edit page.

type SettingResult =
  | { kind: "ok"; defaults: MetadataLevels; embed: boolean; maker: Maker }
  | { kind: "missing-binding" };

export const useSettings = routeLoader$<SettingResult>(
  async ({ platform, status }) => {
    try {
      const db = getDB(platform);
      const [defaults, embed, maker] = await Promise.all([
        getSiteDefaults(db),
        getEmbedDefault(db),
        resizeMaker(db),
      ]);
      return { kind: "ok", defaults, embed, maker };
    } catch (err) {
      console.error("/setting loader: getDB failed:", err);
      status(500);
      return { kind: "missing-binding" };
    }
  },
);

export const useSaveDefaults = routeAction$(
  async (data, { platform, fail }) => {
    const db = getDB(platform);
    const next = { ...(await getSiteDefaults(db)) };
    for (const f of EDITABLE_FIELDS) {
      const v = data[f];
      if (!isLevel(f, v)) return fail(400, { message: `${f}: ${v}` });
      (next as Record<string, string>)[f] = v;
    }
    await Promise.all([
      setSiteDefaults(db, next),
      setEmbedDefault(db, data.embed_exif === "on"),
      setResizeMaker(db, data.resize_maker),
    ]);
    await contentChanged(db);
    return { ok: true };
  },
  zod$({
    file_name: z.string().max(20),
    taken_at: z.string().max(20),
    camera: z.string().max(20),
    digitizer: z.string().max(20),
    digitized_at: z.string().max(20),
    embed_exif: z.enum(["on", "off"]),
    resize_maker: z.enum(["worker", "browser"]),
    exif: z.string().max(20),
    world: z.string().max(20),
    location: z.string().max(20),
  }),
);

export default component$(() => {
  const data = useSettings();
  const save = useSaveDefaults();
  const toast = useSignal<ToastState | null>(null);
  useTask$(({ track }) => {
    const v = track(() => save.value);
    if (!v) return;
    toast.value = v.failed
      ? { tone: "error", message: v.message ?? "保存できませんでした" }
      : { tone: "success", message: "保存しました。" };
  });

  if (data.value.kind === "missing-binding") {
    return <MissingBindingError backHref="/" />;
  }
  const { defaults, embed, maker } = data.value;
  return (
    <div class="mx-auto max-w-3xl space-y-6">
      <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">設定</h1>
      <Link
        href="/setting/upload-rule/"
        prefetch="js"
        class={[
          card,
          "flex min-h-11 items-center justify-between gap-3 p-4 font-semibold hover:bg-zinc-50 sm:p-6 dark:hover:bg-zinc-800/50",
        ]}
      >
        アップロード時のルール
        <span aria-hidden="true" class={muted}>
          →
        </span>
      </Link>
      <Form action={save} class={[card, "space-y-4 p-4 sm:p-6"]}>
        <fieldset class="space-y-3">
          <legend class="text-sm font-semibold">
            公開する情報のデフォルト
          </legend>
          <div class="grid gap-3 sm:grid-cols-2">
            {EDITABLE_FIELDS.map((f) => (
              <MetadataSelect key={f} field={f} name={f} value={defaults[f]} />
            ))}
          </div>
        </fieldset>
        <div class="max-w-xs">
          <label for="setting-embed" class={label}>
            {EMBED_LABEL}
          </label>
          <select id="setting-embed" name="embed_exif" class={field}>
            <option value="on" selected={embed}>
              する
            </option>
            <option value="off" selected={!embed}>
              しない
            </option>
          </select>
        </div>
        <div class="max-w-xs">
          <label for="setting-resize-maker" class={label}>
            縮小版の作成
          </label>
          <select id="setting-resize-maker" name="resize_maker" class={field}>
            <option value="worker" selected={maker === "worker"}>
              Cloudflare で作る
            </option>
            <option value="browser" selected={maker === "browser"}>
              管理画面のブラウザで作る
            </option>
          </select>
        </div>
        <SubmitButton running={save.isRunning} class={buttonPrimary}>
          保存
        </SubmitButton>
      </Form>
      <Toast toast={toast} />
    </div>
  );
});

export const head: DocumentHead = { title: "設定 — Admin" };
