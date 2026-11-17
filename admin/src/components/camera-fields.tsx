import { component$ } from "@builder.io/qwik";
import { z } from "@builder.io/qwik-city";
import { CAMERA_KINDS, type CameraKind } from "~/lib/types";
import {
  MAX_CAMERA_DESCRIPTION_LEN,
  MAX_CAMERA_FIELD_LEN,
  MAX_CAMERA_SLUG_LEN,
  MAX_CAMERA_URL_LEN,
} from "~/lib/validate";
import { field, label, muted, textarea } from "./ui";

export const CAMERA_KIND_LABELS: Record<CameraKind, string> = {
  digital: "Digital",
  film: "Film",
  phone: "Phone",
  virtual: "Virtual (in-game)",
};

/**
 * zod$ shape shared by the create and edit actions. Only coarse caps here;
 * validateCamera (src/lib/validate.ts) is the real contract.
 */
export const cameraFormSchema = {
  slug: z.string().max(MAX_CAMERA_SLUG_LEN + 50),
  name: z.string().max(MAX_CAMERA_FIELD_LEN + 50),
  make: z
    .string()
    .max(MAX_CAMERA_FIELD_LEN + 50)
    .default(""),
  model: z
    .string()
    .max(MAX_CAMERA_FIELD_LEN + 50)
    .default(""),
  kind: z.string().max(20).default(""),
  product_url: z
    .string()
    .max(MAX_CAMERA_URL_LEN + 50)
    .default(""),
  description: z
    .string()
    .max(MAX_CAMERA_DESCRIPTION_LEN + 50)
    .default(""),
};

export type CameraFieldValues = {
  slug: string;
  name: string;
  make: string | null;
  model: string | null;
  kind: CameraKind | null;
  product_url: string | null;
  description: string | null;
};

const legend = "text-sm font-semibold text-zinc-900 dark:text-zinc-100";

/** The inputs of the camera create/edit form (the page owns <Form>). */
export const CameraFields = component$<{ values?: CameraFieldValues }>(
  ({ values }) => (
    <>
      <fieldset class="space-y-3">
        <legend class={legend}>Identity</legend>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label for="camera-name" class={label}>
              Name
            </label>
            <input
              id="camera-name"
              type="text"
              name="name"
              required
              value={values?.name ?? ""}
              placeholder="e.g. VirtualLens2"
              maxLength={MAX_CAMERA_FIELD_LEN}
              class={field}
            />
          </div>
          <div>
            <label for="camera-slug" class={label}>
              Slug
            </label>
            <input
              id="camera-slug"
              type="text"
              name="slug"
              required
              value={values?.slug ?? ""}
              placeholder="e.g. virtuallens2"
              maxLength={MAX_CAMERA_SLUG_LEN}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              aria-describedby="camera-slug-help"
              class={field}
            />
            <p id="camera-slug-help" class={["mt-1 text-xs", muted]}>
              Public URL: <code>/camera/&lt;slug&gt;/</code>. Lowercase letters,
              digits and hyphens. Changing it breaks existing links.
            </p>
          </div>
        </div>
        <div class="max-w-xs">
          <label for="camera-kind" class={label}>
            Kind
          </label>
          <select id="camera-kind" name="kind" class={field}>
            <option value="" selected={!values?.kind}>
              (unspecified)
            </option>
            {CAMERA_KINDS.map((k) => (
              <option key={k} value={k} selected={values?.kind === k}>
                {CAMERA_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class={legend}>Maker</legend>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label for="camera-make" class={label}>
              Make
            </label>
            <input
              id="camera-make"
              type="text"
              name="make"
              value={values?.make ?? ""}
              placeholder="e.g. logilabo"
              maxLength={MAX_CAMERA_FIELD_LEN}
              class={field}
            />
          </div>
          <div>
            <label for="camera-model" class={label}>
              Model
            </label>
            <input
              id="camera-model"
              type="text"
              name="model"
              value={values?.model ?? ""}
              placeholder="e.g. VirtualLens2"
              maxLength={MAX_CAMERA_FIELD_LEN}
              class={field}
            />
          </div>
        </div>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class={legend}>Details</legend>
        <div>
          <label for="camera-product-url" class={label}>
            製品ページ
          </label>
          <input
            id="camera-product-url"
            type="url"
            name="product_url"
            value={values?.product_url ?? ""}
            placeholder="https://"
            maxLength={MAX_CAMERA_URL_LEN}
            class={field}
          />
        </div>
        <div>
          <label for="camera-description" class={label}>
            Description
          </label>
          <textarea
            id="camera-description"
            name="description"
            rows={4}
            maxLength={MAX_CAMERA_DESCRIPTION_LEN}
            class={textarea}
            value={values?.description ?? ""}
          />
        </div>
      </fieldset>
    </>
  ),
);
