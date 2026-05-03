import { $, component$, useSignal } from "@builder.io/qwik";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "success";
      count: number;
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
      !confirm("Regenerate media.json from D1 and upload to the public bucket?")
    ) {
      return;
    }
    status.value = { kind: "loading" };
    try {
      const res = await fetch("/api/publish/", { method: "POST" });
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
    <div style={{ marginTop: "0.5rem" }}>
      <button
        type="button"
        onClick$={onClick}
        disabled={status.value.kind === "loading"}
      >
        {status.value.kind === "loading" ? "Publishing…" : "Publish media.json"}
      </button>
      {status.value.kind === "success" && (
        <p style={{ color: "green", marginTop: "0.5rem" }}>
          Published {status.value.count} items ({status.value.bytes} bytes) at{" "}
          {status.value.uploadedAt}
          {status.value.etag ? ` — etag ${status.value.etag}` : ""}.
        </p>
      )}
      {status.value.kind === "error" && (
        <p style={{ color: "crimson", marginTop: "0.5rem" }}>
          Publish failed: {status.value.message}
        </p>
      )}
    </div>
  );
});
