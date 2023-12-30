import { component$ } from "@builder.io/qwik";
import styles from "./header.module.css";

import LogoSksat from '~/media/sksat.jpg?jsx';

export default component$(() => {
  return (
    <header>
      <div class={["container", styles.wrapper]}>
        <div>
          <a href="/" title="" class="flex items-center">
            <LogoSksat class="mr-4" style={{ width: 50, height: 50 }} />
            <h2 class="text-x1 font-bold">sksat gallery</h2>
          </a>
        </div>
      </div>
    </header>
  );
});
