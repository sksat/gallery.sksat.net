// What a VRChat instance id (as VRCX records it, media.vrcx) says, for the
// edit page: its kind and region. Covered by vrcx.spec.ts. The parts are
// read as VRCX does (src/shared/utils/locationParser.js): after the world
// id and the instance name, "~key(value)" parts.

export type InstanceInfo = {
  /** The world it belongs to (wrld_…). */
  worldId: string;
  /** As VRChat names it: Public, Friends+, Friends, Invite+, Invite, Group… */
  kind: string;
  /** "JP", "US West", … or null when the id has none. */
  region: string | null;
};

const REGIONS: Record<string, string> = {
  us: "US West",
  use: "US East",
  usw: "US West",
  eu: "EU",
  jp: "JP",
};

const GROUP_KINDS: Record<string, string> = {
  public: "Group Public",
  plus: "Group+",
  members: "Group",
};

/** An instance id's world, kind and region; null if it is not one. */
export const parseInstance = (id: string | null): InstanceInfo | null => {
  if (!id) return null;
  const sep = id.indexOf(":");
  if (sep < 0) return null;
  const worldId = id.slice(0, sep);
  if (!/^wrld_[0-9A-Za-z-]+$/.test(worldId)) return null;
  const parts = new Map<string, string>();
  for (const s of id
    .slice(sep + 1)
    .split("~")
    .slice(1)) {
    const open = s.indexOf("(");
    const close = open >= 0 ? s.lastIndexOf(")") : -1;
    if (close > open) parts.set(s.slice(0, open), s.slice(open + 1, close));
    else parts.set(s, "");
  }
  let kind = "Public";
  if (parts.has("private")) {
    kind = parts.has("canRequestInvite") ? "Invite+" : "Invite";
  } else if (parts.has("friends")) kind = "Friends";
  else if (parts.has("hidden")) kind = "Friends+";
  else if (parts.has("group")) {
    kind = GROUP_KINDS[parts.get("groupAccessType") ?? ""] ?? "Group";
  }
  const r = parts.get("region");
  const region = r ? (REGIONS[r] ?? r.toUpperCase()) : null;
  return { worldId, kind, region };
};

/** vrchat.com's page of a user (usr_…). */
export const userUrl = (id: string) =>
  `https://vrchat.com/home/user/${encodeURIComponent(id)}`;
