/** Whether a key goes to a field being typed in (not a page shortcut). */
export const isTextTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLInputElement ||
  t instanceof HTMLTextAreaElement ||
  t instanceof HTMLSelectElement ||
  (t instanceof HTMLElement && t.isContentEditable);
