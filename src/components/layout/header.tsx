import { component$ } from "@builder.io/qwik";

// The avatar with its grey square corners made transparent (the same
// source as public/favicon.ico), so only the round icon shows on the header.
import LogoSksat from "~/media/sksat-round.png?jsx";
import HeaderSksat from "~/media/sksat-header.png?jsx";

// The illustration and the logo only: the site's links are in each page's
// first line (SiteNav, components/layout/site-nav.tsx).
export default component$(() => (
  <header class="relative h-32 overflow-hidden">
    <HeaderSksat
      class="absolute inset-0 z-0 h-full w-full object-cover"
      style="object-position: 0% 50%;"
      alt="生活(@m2__z)さんに描いていただいたイラスト: https://skeb.jp/@m2__z/works/12"
    />
    {/* The face in the illustration is on the left and the image is
        cropped from its left edge, so below xl the face sits where a
        centred title would: keep the title to the right there, and on
        phones put the icon above the title. */}
    <div class="relative z-10 flex h-full items-center justify-end pr-4 xl:justify-center xl:pr-0">
      <div>
        {/* A plain <a>, not <Link>: the gallery rewrites the URL with
            history.pushState/replaceState, which Qwik City's SPA router does
            not track. Keeping the router inactive avoids it acting on a
            stale URL (e.g. a <Link> to "/" being ignored as "same page"). */}
        <a href="/" title="" class="flex flex-col items-center sm:flex-row">
          <LogoSksat
            class="mb-1 h-10 w-10 [image-rendering:pixelated] sm:mr-3 sm:mb-0 sm:h-14 sm:w-14"
            alt=""
          />
          <h2
            class="site-title"
            style="color: white; text-shadow: 2px 2px 0px grey;"
          >
            sksat gallery
          </h2>
        </a>
      </div>
    </div>
  </header>
));
