import { component$ } from "@builder.io/qwik";
import { useLocation } from "@builder.io/qwik-city";

import { CALENDAR_HREF } from "~/components/gallery/calendar";
import { CAMERA_LIST_HREF } from "~/components/gallery/cameras";

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
    href: CAMERA_LIST_HREF,
    label: "カメラ",
    icon: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  },
];

export default component$(() => {
  const path = useLocation().url.pathname;
  return (
    <header class="relative h-32 overflow-hidden">
      <HeaderSksat
        class="absolute inset-0 z-0 h-full w-full object-cover"
        style="object-position: 0% 50%;"
        alt="生活(@m2__z)さんに描いていただいたイラスト: https://skeb.jp/@m2__z/works/12"
      />
      {/* A small, quiet pill over the illustration: icon + label in the
          header's small text; the current section is filled. */}
      <nav
        aria-label="サイト"
        class="absolute top-2 right-2 z-20 flex rounded-full bg-black/45 p-0.5 backdrop-blur-sm sm:right-3"
      >
        {/* Plain <a>s for the same reason as the title link below. */}
        {NAV.map(({ href, label, icon }) => {
          const current = path.startsWith(href);
          return (
            <a
              key={href}
              href={href}
              aria-current={current ? "page" : undefined}
              // Inline colour: the site's unlayered `a { color }` beats
              // utilities.
              style={{ color: current ? "#fff" : "rgb(255 255 255 / 0.9)" }}
              class={[
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs leading-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white",
                current ? "bg-white/20" : "hover:bg-white/10",
              ]}
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
      </nav>
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
  );
});
