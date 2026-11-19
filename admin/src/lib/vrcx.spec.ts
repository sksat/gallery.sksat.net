import { describe, expect, it } from "vitest";
import { parseInstance, userUrl } from "./vrcx";

describe("parseInstance", () => {
  const W = "wrld_00000000-aaaa-bbbb-cccc-000000000001";
  it("reads the kind and region of VRChat's instance ids", () => {
    const cases: [string, string, string | null][] = [
      [`${W}:75296~friends(usr_a)~region(jp)`, "Friends", "JP"],
      [`${W}:1~hidden(usr_a)~region(use)`, "Friends+", "US East"],
      [`${W}:1~private(usr_a)~canRequestInvite~region(eu)`, "Invite+", "EU"],
      [`${W}:1~private(usr_a)`, "Invite", null],
      [`${W}:1~group(grp_a)~groupAccessType(plus)~region(us)`, "Group+", "US West"],
      [`${W}:1~group(grp_a)~groupAccessType(public)`, "Group Public", null],
      [`${W}:1~group(grp_a)~groupAccessType(members)`, "Group", null],
      [`${W}:12345`, "Public", null],
      [`${W}:1~region(xx)`, "Public", "XX"],
    ];
    for (const [id, kind, region] of cases) {
      expect(parseInstance(id), id).toEqual({ worldId: W, kind, region });
    }
  });

  it("is null for what is not an instance", () => {
    for (const id of [null, "", "private", "offline:offline", "x:1"]) {
      expect(parseInstance(id), String(id)).toBeNull();
    }
  });
});

describe("userUrl", () => {
  it("links a user on vrchat.com", () => {
    expect(userUrl("usr_a-1")).toBe("https://vrchat.com/home/user/usr_a-1");
  });
});
