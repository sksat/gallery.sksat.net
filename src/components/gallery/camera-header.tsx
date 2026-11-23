import { component$ } from "@builder.io/qwik";

import type { CameraJSON } from "./types";

/** The manufacturer's name, linking to its website when there is one. */
export const Manufacturer = component$<{ camera: CameraJSON }>(({ camera }) =>
  camera.manufacturerUrl ? (
    <a
      href={camera.manufacturerUrl}
      rel="noopener noreferrer"
      target="_blank"
      class="underline-offset-4 hover:underline"
    >
      {camera.manufacturer}
    </a>
  ) : (
    <>{camera.manufacturer}</>
  ),
);
