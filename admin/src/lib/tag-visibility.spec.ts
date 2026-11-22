import { describe, expect, it } from "vitest";
import {
  chipPatch,
  choiceFor,
  keepChoices,
  storedChoices,
  tagState,
  withTargets,
} from "./tag-visibility";

// film is public by its own setting, secret is not.
const pub = new Set(["film"]);

describe("choiceFor", () => {
  it("stores a choice only where it differs from the tag's setting", () => {
    expect(choiceFor("film", true, pub)).toBeNull();
    expect(choiceFor("film", false, pub)).toBe("hidden");
    expect(choiceFor("secret", true, pub)).toBe("shown");
    expect(choiceFor("secret", false, pub)).toBeNull();
  });
});

describe("chipPatch", () => {
  it("saves only the chips switched since the page loaded", () => {
    expect(
      chipPatch({ film: true, secret: false, night: false }, ["secret"], pub),
    ).toEqual({ film: "hidden", secret: "shown" });
    // Nothing switched: nothing to save, also where the tag's setting
    // changed meanwhile (film loaded hidden, now public by default).
    expect(chipPatch({ film: false, secret: true }, ["secret"], pub)).toEqual(
      {},
    );
    // Switched back to the default: the photo's choice goes.
    expect(chipPatch({ film: false }, ["film"], pub)).toEqual({ film: null });
  });

  it("takes tags named like Object's own properties", () => {
    const loaded = JSON.parse('{"__proto__":false,"constructor":false}');
    const p = chipPatch(loaded, ["__proto__", "constructor"], pub);
    expect(Object.keys(p)).toEqual(["__proto__", "constructor"]);
    expect(JSON.stringify(p)).toBe(
      '{"__proto__":"shown","constructor":"shown"}',
    );
  });
});

describe("withTargets", () => {
  it("changes only the tags the photo has and that are not so already", () => {
    expect(
      withTargets(
        { secret: "hidden" },
        ["film", "secret"],
        { film: false, secret: false, other: true },
        pub,
      ),
    ).toEqual({ film: "hidden", secret: "hidden" });
  });

  it("drops the photo's choice when the target is the tag's setting", () => {
    expect(
      withTargets(
        { film: "hidden", secret: "shown" },
        ["film", "secret"],
        { film: true, secret: false },
        pub,
      ),
    ).toEqual({});
  });
});

describe("keepChoices / storedChoices / tagState", () => {
  it("keeps the choices of the tags listed; none is NULL", () => {
    expect(keepChoices({ a: "shown", b: "hidden" }, ["b", "c"])).toEqual({
      b: "hidden",
    });
    expect(storedChoices({})).toBeNull();
    expect(storedChoices({ b: "hidden" })).toBe('{"b":"hidden"}');
  });

  it("says whether a tag is shown and whether by the photo's choice", () => {
    expect(tagState("film", {}, pub)).toEqual({ shown: true, own: false });
    expect(tagState("film", { film: "hidden" }, pub)).toEqual({
      shown: false,
      own: true,
    });
    expect(tagState("secret", { secret: "shown" }, pub)).toEqual({
      shown: true,
      own: true,
    });
    // A choice equal to the default (0021 hid private tags too) is still
    // the photo's own.
    expect(tagState("secret", { secret: "hidden" }, pub)).toEqual({
      shown: false,
      own: true,
    });
  });
});
