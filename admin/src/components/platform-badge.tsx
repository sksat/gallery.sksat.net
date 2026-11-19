import { component$ } from "@builder.io/qwik";
import { platformOf } from "~/lib/platform";
import { usePlatformList } from "~/routes/layout";
import { platformBadge } from "./ui";

/** A photo's platform (by key) as a badge: its name, coloured by kind. */
export const PlatformBadge = component$<{ platform: string }>(
  ({ platform }) => {
    const p = platformOf(usePlatformList().value, platform);
    return <span class={platformBadge(p.kind)}>{p.name}</span>;
  },
);
