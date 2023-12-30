import { component$ } from "@builder.io/qwik";

import LogoSksat from "~/media/sksat.jpg?jsx";
import HeaderSksat from "~/media/sksat-header.png?jsx";

export default component$(() => {
  return (
    <header class="relative h-32 overflow-hidden">
      <HeaderSksat
        class="absolute inset-0 z-0 h-full w-full object-cover"
        style="object-position: 0% 50%;"
        alt="生活(@m2__z)さんに描いていただいたイラスト: https://skeb.jp/@m2__z/works/12"
      />
      <div class="relative z-10 flex h-full items-center justify-center">
        <div>
          <a href="/" title="" class="flex items-center">
            <LogoSksat class="mr-4" style={{ width: 50, height: 50 }} />
            <h2
              class="text-x1 font-bold"
              style="color: white; text-shadow: 2px 2px 0px grey;"
            >
              sksat gallery
            </h2>
          </a>
        </div>
      </div>
    </header>
  );
});
