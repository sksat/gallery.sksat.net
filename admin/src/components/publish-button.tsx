import { $, component$, useSignal } from "@builder.io/qwik";
import { buttonPrimary } from "./ui";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "success";
      count: number;
      cameraCount: number;
      bytes: number;
      uploadedAt: string;
      etag: string | null;
    }
  | { kind: "error"; message: string };

export const PublishButton = component$(() => {
  const status = useSignal<Status>({ kind: "idle" });

  const onClick = $(async () => {
    if (status.value.kind === "loading") return;
    if (
      !confirm(
        "Regenerate media.json and cameras.json from D1 and upload them to the public bucket?",
      )
    ) {
      return;
    }
    status.value = { kind: "loading" };
    try {
      const res = await fetch("/api/publish/", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        status.value = {
          kind: "error",
          message:
            typeof body.error === "string" ? body.error : `HTTP ${res.status}`,
        };
        return;
      }
      status.value = {
        kind: "success",
        count: Number(body.count) || 0,
        cameraCount: Number(body.cameraCount) || 0,
        bytes: Number(body.bytes) || 0,
        uploadedAt: String(body.uploadedAt ?? ""),
        etag: typeof body.etag === "string" ? body.etag : null,
      };
    } catch (err) {
      status.value = {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  });

  return (
    <div class="space-y-3">
      <button
        type="button"
        class={buttonPrimary}
        onClick$={onClick}
        disabled={status.value.kind === "loading"}
      >
        {status.value.kind === "loading" ? "Publishing…" : "Publish media.json"}
      </button>
      {/* Always rendered so screen readers pick up the live-region updates. */}
      <div role="status" aria-live="polite">
        {status.value.kind === "success" && (
          <p class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            Published {status.value.count} items ({status.value.bytes} bytes)
            and {status.value.cameraCount} cameras at {status.value.uploadedAt}
            {status.value.etag ? ` — etag ${status.value.etag}` : ""}.
          </p>
        )}
        {status.value.kind === "error" && (
          <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            Publish failed: {status.value.message}
          </p>
        )}
      </div>
    </div>
  );
});
