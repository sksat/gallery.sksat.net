import { component$ } from "@builder.io/qwik";
import styles from "./header.module.css";

export default component$(() => {
  return (
    <header class={styles.header}>
      <div class={["container", styles.wrapper]}>
        <div>
          <a href="/" title="" class="flex items-center">
            <img class="mr-4" src="/sksat.jpg" height={50} width={50}></img>
            <h2 class="text-x1 font-bold">sksat gallery</h2>
          </a>
        </div>
      </div>
    </header>
  );
});
