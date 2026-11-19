import { component$ } from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";

import { CALENDAR_HREF } from "~/components/gallery/calendar";
import { CAMERA_LIST_HREF } from "~/components/gallery/cameras";
import { MAP_HREF } from "~/components/map/places";

// The avatar with its grey square corners made transparent (the same
// source as public/favicon.ico), so only the round icon shows on the header.
import LogoSksat from "~/media/sksat-round.png?jsx";
import HeaderSksat from "~/media/sksat-header.png?jsx";

/** The site's sections, with 24×24 stroke icons. */
const NAV = [
  {
    href: CALENDAR_HREF,
    label: "カレンダー",
    icon: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4",
  },
  {
    href: MAP_HREF,
    label: "地図",
    // A map pin.
    icon: "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  },
  {
    href: CAMERA_LIST_HREF,
    label: "カメラ",
    icon: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  },
];

export default component$(() => {
  const path = useLocation().url.pathname;
  return (
    <>
      <header class="relative h-32 overflow-hidden">
        <HeaderSksat
          class="absolute inset-0 z-0 h-full w-full object-cover"
          style="object-position: 0% 50%;"
          alt="生活(@m2__z)さんに描いていただいたイラスト: https://skeb.jp/@m2__z/works/12"
        />
        <div class="relative z-10 flex h-full items-center justify-center">
          <div>
            {/* A plain <a>, not <Link>: the gallery rewrites the URL with
              history.pushState/replaceState, which Qwik City's SPA router does
              not track. Keeping the router inactive avoids it acting on a
              stale URL (e.g. a <Link> to "/" being ignored as "same page"). */}
            <a href="/" title="" class="flex items-center">
              <LogoSksat
                class="mr-3 [image-rendering:pixelated]"
                style={{ width: 56, height: 56 }}
                alt=""
              />
              <h2 style="color: white; text-shadow: 2px 2px 0px grey;">
                sksat gallery
              </h2>
            </a>
          </div>
        </div>
      </header>
      {/* A slim row under the illustration, at the content's width: icon +
        label in small text, the current section underlined in the accent.
        Scrolls sideways on a narrow screen rather than wrapping. */}
      <nav aria-label="サイト" class="border-b border-white/10">
        <div class="flex gap-1 overflow-x-auto px-1 sm:px-2">
          {/* Plain <a>s for the same reason as the title link above. */}
          {NAV.map(({ href, label, icon }) => {
            const current = path.startsWith(href);
            return (
              <a
                key={href}
                href={href}
                aria-current={current ? "page" : undefined}
                // Inline colour: the site's unlayered `a { color }` beats
                // utilities.
                style={{
                  color: current ? "#fff" : "rgb(255 255 255 / 0.7)",
                  borderColor: current ? "var(--color-accent)" : "transparent",
                }}
                class="inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-sm whitespace-nowrap transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white sm:h-10"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d={icon} />
                </svg>
                {label}
              </a>
            );
          })}
        </div>
      </nav>
    </>
  );
});
