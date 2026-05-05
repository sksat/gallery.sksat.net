import { component$ } from "@builder.io/qwik";
import {
  Form,
  Link,
  routeAction$,
  routeLoader$,
  zod$,
  z,
  type DocumentHead,
} from "@builder.io/qwik-city";
import { getMedia, updateMedia } from "~/lib/db";
import { getDB } from "~/lib/env";
import { parseTagsInput, validatePatch } from "~/lib/validate";

export const useMedia = routeLoader$(async ({ platform, params, status }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    status(400);
    return null;
  }
  const db = getDB(platform);
  const row = await getMedia(db, id);
  if (!row) {
    status(404);
    return null;
  }
  return row;
});

export const useUpdateMedia = routeAction$(
  async (data, { platform, params, fail }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return fail(400, { message: "invalid id" });
    }
    // Route the form data through the same validator the API uses so the
    // empty-string→null + paired-camera contract has a single source of truth.
    const v = validatePatch({
      world: data.world,
      camera_make: data.camera_make,
      camera_model: data.camera_model,
      tags: parseTagsInput(data.tags ?? ""),
    });
    if (!v.ok) {
      return fail(400, { message: v.error });
    }
    const db = getDB(platform);
    const updated = await updateMedia(db, id, v.patch);
    if (!updated) {
      return fail(404, { message: "not found" });
    }
    return { ok: true, updated_at: updated.updated_at };
  },
  zod$({
    world: z.enum(["Real", "VRChat"]),
    camera_make: z.string().max(200).default(""),
    camera_model: z.string().max(200).default(""),
    tags: z.string().max(2000).default(""),
  }),
);

export default component$(() => {
  const media = useMedia();
  const action = useUpdateMedia();

  if (!media.value) {
    return (
      <div style={{ padding: "1.5rem", fontFamily: "sans-serif" }}>
        <p>
          <Link href="/media/">← Back</Link>
        </p>
        <h1>Not found</h1>
      </div>
    );
  }

  const row = media.value;

  return (
    <div
      style={{ padding: "1.5rem", fontFamily: "sans-serif", maxWidth: "60rem" }}
    >
      <p>
        <Link href="/media/">← Media</Link>
      </p>
      <h1>Edit #{row.id}</h1>

      <dl
        style={{
          background: "#f5f5f5",
          padding: "0.8rem",
          borderRadius: "4px",
        }}
      >
        <dt>File</dt>
        <dd
          style={{
            fontFamily: "monospace",
            fontSize: "0.9em",
            wordBreak: "break-all",
          }}
        >
          {row.file}
        </dd>
        <dt style={{ marginTop: "0.6rem" }}>Timestamp</dt>
        <dd>
          {row.timestamp ?? <span style={{ color: "#888" }}>(none)</span>}
        </dd>
      </dl>

      <Form
        action={action}
        style={{
          marginTop: "1rem",
          display: "grid",
          gap: "0.8rem",
          maxWidth: "30rem",
        }}
      >
        <label>
          World
          <br />
          <select name="world">
            <option value="Real" selected={row.world === "Real"}>
              Real
            </option>
            <option value="VRChat" selected={row.world === "VRChat"}>
              VRChat
            </option>
          </select>
        </label>
        <label>
          Camera make
          <br />
          <input
            type="text"
            name="camera_make"
            value={row.camera_make ?? ""}
            placeholder="(empty for none)"
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Camera model
          <br />
          <input
            type="text"
            name="camera_model"
            value={row.camera_model ?? ""}
            placeholder="(empty for none)"
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Tags (comma-separated)
          <br />
          <input
            type="text"
            name="tags"
            value={row.tags.join(", ")}
            style={{ width: "100%" }}
          />
        </label>
        <div>
          <button type="submit">Save</button>
        </div>
      </Form>

      {action.value?.ok && (
        <p style={{ color: "green", marginTop: "1rem" }}>
          Saved at {action.value.updated_at}.
        </p>
      )}
      {action.value?.failed && (
        <p style={{ color: "crimson", marginTop: "1rem" }}>
          Save failed: {action.value.message ?? "unknown error"}
        </p>
      )}
    </div>
  );
});

export const head: DocumentHead = ({ resolveValue }) => {
  const row = resolveValue(useMedia);
  return {
    title: row ? `Edit ${row.file} — Admin` : "Not found — Admin",
  };
};
