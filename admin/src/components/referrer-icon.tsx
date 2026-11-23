import { brandOf, isPublicHostname } from "~/lib/referrer-icon";
import { BRAND_ICONS } from "~/lib/referrer-icons.gen";

// A referrer row's 16px icon, beside its name (so it says nothing more:
// alt="" and aria-hidden). Direct visits get an arrow into a box,
// well-known sites their bundled brand icon, other public hosts their
// favicon through the admin (/api/favicon/<host>/, which answers a grey
// globe when there is none), anything else a globe.

const outline = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.75",
  "stroke-linecap": "round" as const,
  "stroke-linejoin": "round" as const,
};

const box = "size-4 shrink-0";

export const ReferrerIcon = ({ host }: { host: string }) => {
  if (host === "") {
    return (
      <svg
        {...outline}
        aria-hidden="true"
        class={[box, "text-zinc-400 dark:text-zinc-500"]}
        data-referrer-icon="direct"
      >
        <path d="M10 17l5-5-5-5M15 12H3M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      </svg>
    );
  }
  const brand = brandOf(host);
  const icon = brand ? BRAND_ICONS[brand] : undefined;
  if (icon) {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        class={[box, icon.color ? "" : "text-zinc-900 dark:text-zinc-100"]}
        style={{ fill: icon.color ?? "currentColor" }}
        data-referrer-icon={brand}
      >
        <path d={icon.path} />
      </svg>
    );
  }
  const name = host.toLowerCase();
  if (isPublicHostname(name)) {
    return (
      <img
        src={`/api/favicon/${name}/`}
        width={16}
        height={16}
        alt=""
        decoding="async"
        class={[box, "rounded-sm"]}
        data-referrer-icon="favicon"
      />
    );
  }
  return (
    <svg
      {...outline}
      aria-hidden="true"
      class={[box, "text-zinc-400 dark:text-zinc-500"]}
      data-referrer-icon="globe"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
};
