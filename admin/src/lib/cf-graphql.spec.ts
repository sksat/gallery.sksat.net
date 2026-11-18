import { describe, expect, it } from "vitest";
import { GRAPHQL_ENDPOINT, graphqlEndpoint } from "./cf-graphql";

describe("graphqlEndpoint", () => {
  const env = { E2E_FAKE_GRAPHQL_URL: "http://127.0.0.1:5178/" };
  const local = new URL("http://localhost:5175/");
  const prod = new URL("https://admin.gallery.sksat.net/");

  it("is the real API unless the fake is bound", () => {
    expect(graphqlEndpoint({ env: {} }, local)).toBe(GRAPHQL_ENDPOINT);
    expect(graphqlEndpoint(undefined, prod)).toBe(GRAPHQL_ENDPOINT);
  });

  it("uses the fake only for loopback requests to a loopback URL", () => {
    expect(graphqlEndpoint({ env }, local)).toBe("http://127.0.0.1:5178/");
    expect(graphqlEndpoint({ env }, prod)).toBe(GRAPHQL_ENDPOINT);
    expect(
      graphqlEndpoint(
        { env: { E2E_FAKE_GRAPHQL_URL: "https://evil.example/" } },
        local,
      ),
    ).toBe(GRAPHQL_ENDPOINT);
    expect(
      graphqlEndpoint({ env: { E2E_FAKE_GRAPHQL_URL: "nonsense" } }, local),
    ).toBe(GRAPHQL_ENDPOINT);
  });
});
