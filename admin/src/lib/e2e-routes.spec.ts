import { describe, expect, it } from "vitest";
import { e2eRoutesEnabled } from "./e2e-routes";

describe("e2eRoutesEnabled", () => {
  const on = { E2E_TEST_ROUTES: "1" };

  it("needs the binding and a loopback host", () => {
    expect(e2eRoutesEnabled(on, new URL("http://localhost:5175/e2e/"))).toBe(
      true,
    );
    expect(e2eRoutesEnabled(on, new URL("http://127.0.0.1:5175/e2e/"))).toBe(
      true,
    );
    expect(
      e2eRoutesEnabled(on, new URL("https://admin.gallery.sksat.net/e2e/")),
    ).toBe(false);
    expect(e2eRoutesEnabled({}, new URL("http://localhost:5175/e2e/"))).toBe(
      false,
    );
    expect(
      e2eRoutesEnabled(undefined, new URL("http://localhost:5175/e2e/")),
    ).toBe(false);
    expect(
      e2eRoutesEnabled(
        { E2E_TEST_ROUTES: "true" },
        new URL("http://localhost:5175/e2e/"),
      ),
    ).toBe(false);
  });
});
