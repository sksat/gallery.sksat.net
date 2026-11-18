import { isLoopback } from "./access";

/**
 * Whether the E2E-only pages under /e2e/ are served: only with the E2E
 * server's `E2E_TEST_ROUTES=1` binding and on a loopback host, so neither
 * production nor a stray binding there exposes them.
 */
export const e2eRoutesEnabled = (
  env: Record<string, unknown> | undefined,
  url: URL,
): boolean => env?.E2E_TEST_ROUTES === "1" && isLoopback(url.hostname);
