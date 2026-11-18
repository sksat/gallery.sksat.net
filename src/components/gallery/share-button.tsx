import { $, component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";

import { shareUrl } from "./share";

// How long 「リンクをコピーしました」 stays on screen.
const FEEDBACK_MS = 2000;

/**
 * Shares the photo page that is open (the URL without the gallery's query):
 * the OS share sheet where `navigator.share` exists (phones), otherwise a
 * copy to the clipboard. Without clipboard access it shows the URL in a
 * selected read-only field to copy by hand.
 */
export const ShareButton = component$(() => {
  // Rendered as the copy button on the server; switched once the browser
  // turns out to have a share sheet.
  const canShare = useSignal(false);
  const copied = useSignal(false);
  // Successful copies so far; restarts the message timer.
  const copies = useSignal(0);
  // The URL to copy by hand when the clipboard is unavailable.
  const manualUrl = useSignal<string>();
  const manualInput = useSignal<HTMLInputElement>();

  // A visible task is intended: whether a share sheet exists is only known
  // in the browser, and the label has to match before the first tap.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    canShare.value = typeof navigator.share === "function";
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    track(() => manualUrl.value);
    manualInput.value?.focus();
    manualInput.value?.select();
  });

  // Restarted by every copy, so a second one keeps the message up.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    if (track(() => copies.value) === 0) return;
    const timer = setTimeout(() => (copied.value = false), FEEDBACK_MS);
    cleanup(() => clearTimeout(timer));
  });

  const onClick = $(async () => {
    const url = shareUrl(window.location.href);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (e) {
        // Closing the share sheet is not a failure.
        if (e instanceof DOMException && e.name === "AbortError") return;
        // Otherwise (e.g. not allowed here, or the tap's user activation
        // ran out while the handler loaded) fall through to copying; the
        // URL field catches the case where that is refused too.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      manualUrl.value = undefined;
      copies.value++;
      copied.value = true;
    } catch {
      manualUrl.value = url;
    }
  });

  const label = canShare.value ? "共有" : "リンクをコピー";

  return (
    <div
      // Bottom right: the site nav sits above the overlay at the top right.
      // Reversed so the button stays in the corner and the message and URL
      // field stack above it. Only the button and the field take clicks
      // (and keep them from the overlay, which closes on click), so the
      // rest of the corner still closes the overlay.
      // Above the open info sheet (its foot leaves room for it), so the
      // button, the copy message and the URL field stay usable.
      class="pointer-events-none absolute right-3 bottom-3 z-20 flex flex-col-reverse items-end gap-2"
    >
      <button
        type="button"
        data-testid="share-button"
        aria-label={label}
        title={label}
        onClick$={onClick}
        stoppropagation:click
        class="pointer-events-auto rounded-full bg-black/50 p-2 text-white/80 hover:bg-black/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        {copied.value ? (
          // Check mark
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          // Box with an arrow out of it, on every device; only the label
          // says whether a tap shares or copies.
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <path d="m16 6-4-4-4 4" />
            <path d="M12 2v13" />
          </svg>
        )}
      </button>
      <p
        data-testid="share-status"
        aria-live="polite"
        class={[
          "rounded bg-black/70 px-2 py-1 text-sm text-white transition-opacity duration-200",
          copied.value ? "opacity-100" : "opacity-0",
        ]}
      >
        {copied.value && (
          // A fresh node per copy, so a second copy is announced again.
          <span key={copies.value}>リンクをコピーしました</span>
        )}
      </p>
      {manualUrl.value && (
        <input
          ref={manualInput}
          type="text"
          readOnly
          data-testid="share-url"
          aria-label="この写真のリンク"
          value={manualUrl.value}
          stoppropagation:click
          class="pointer-events-auto w-[min(80vw,24rem)] rounded bg-black/70 px-2 py-1 text-sm text-white"
        />
      )}
    </div>
  );
});
