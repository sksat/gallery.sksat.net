import { component$ } from "@builder.io/qwik";

import { CALENDAR_HREF } from "~/components/gallery/calendar";
import { CAMERA_LIST_HREF } from "~/components/gallery/cameras";

// The avatar with its grey square corners made transparent (the same
// source as public/favicon.ico), so only the round icon shows on the header.
import LogoSksat from "~/media/sksat-round.png?jsx";
import HeaderSksat from "~/media/sksat-header.png?jsx";

export default component$(() => {
  return (
    <header class="relative h-32 overflow-hidden">
      <HeaderSksat
        class="absolute inset-0 z-0 h-full w-full object-cover"
        style="object-position: 0% 50%;"
        alt="生活(@m2__z)さんに描いていただいたイラスト: https://skeb.jp/@m2__z/works/12"
      />
      <nav
        aria-label="サイト"
        class="absolute top-2 right-3 z-20 flex gap-2 text-sm"
      >
        {/* Plain <a>s for the same reason as the title link below. */}
        {[
          { href: CALENDAR_HREF, label: "カレンダー" },
          { href: CAMERA_LIST_HREF, label: "カメラ" },
        ].map(({ href, label }) => (
          <a
            key={href}
            href={href}
            class="rounded bg-black/40 px-2 py-1 text-white hover:bg-black/60"
          >
            {label}
          </a>
        ))}
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
