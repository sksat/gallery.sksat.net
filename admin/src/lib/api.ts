import type { RequestEventCommon } from "@builder.io/qwik-city";

// Wrap an API handler so any thrown error becomes a JSON 500 with the message
// logged server-side and a generic body returned. Used by every onGet/onPatch/
// onPost in src/routes/api/* so a missing D1 binding or a parseTags failure
// surfaces as a structured error instead of an opaque framework 500.
export const withErrorHandler = (
  label: string,
  handler: (ev: RequestEventCommon) => Promise<void>,
): ((ev: RequestEventCommon) => Promise<void>) => {
  return async (ev) => {
    try {
      await handler(ev);
    } catch (err) {
      console.error(`${label} failed:`, err);
      ev.json(500, { error: `${label} failed; see admin worker logs` });
    }
  };
};
