import { describe, expect, it } from "vitest";
import {
  baseStems,
  defaultMerge,
  findRetouchPairs,
  isRetouchTool,
  retouchSignals,
  splitName,
  uploadBaseStems,
} from "./retouch-match";

const photos = (paths: string[]) =>
  paths.map((path, i) => ({ id: i + 1, path }));

describe("splitName", () => {
  it("splits folder, stem and extension", () => {
    expect(splitName("/VRChat/2026-06/a_DxO.jpg")).toEqual({
      dir: "/VRChat/2026-06",
      stem: "a_DxO",
      ext: ".jpg",
    });
    expect(splitName("/x/2022-08-13_20.22.42.jpg").stem).toBe(
      "2022-08-13_20.22.42",
    );
    expect(splitName("/x/noext")).toEqual({
      dir: "/x",
      stem: "noext",
      ext: "",
    });
  });
});

describe("baseStems", () => {
  it("takes off retouch suffixes one at a time", () => {
    expect(baseStems("a_ON1-Edit")).toEqual(["a_ON1", "a"]);
    expect(baseStems("IMG_0001-Edit-2")).toEqual(["IMG_0001-Edit", "IMG_0001"]);
    expect(baseStems("a (1)")).toEqual(["a"]);
    expect(baseStems("a-1")).toEqual(["a"]);
  });

  it("leaves names a camera or VRChat made alone", () => {
    expect(
      baseStems("VRChat_2025-05-18_04-12-11.568_7680x4320_Environment"),
    ).toEqual([]);
    expect(
      baseStems("VRChat_2025-05-18_04-12-11.568_7680x4320_Player"),
    ).toEqual([]);
    expect(baseStems("IMG_20240309_200656639_HDR")).toEqual([]);
    expect(baseStems("VRChat_2022-10-16_03-06-20.022_7680x4320")).toEqual([]);
    expect(baseStems("VRChat_3840x2160_2022-08-22_02-03-18.591")).toEqual([]);
    expect(baseStems("1212816_0012")).toEqual([]);
    expect(baseStems("IMAG0003")).toEqual([]);
  });
});

describe("findRetouchPairs", () => {
  it("pairs the library's retouches with their originals", () => {
    const list = photos([
      "/VRChat/2026-06/VRChat_2026-06-04_03-20-34.513_4320x7680.png",
      "/VRChat/2026-06/VRChat_2026-06-04_03-20-34.513_4320x7680_DxO.jpg",
      "/VRChat/2023-04/VRChat_2023-04-29_12-57-29.611_4320x7680.png",
      "/VRChat/2023-04/VRChat_2023-04-29_12-57-29.611_4320x7680_lightroom.jpg",
      "/VRChat/2026-04/VRChat_2026-04-29_05-42-58.826_7680x4320.png",
      "/VRChat/2026-04/VRChat_2026-04-29_05-42-58.826_7680x4320_ON1.png",
      "/VRChat/2025-05/VRChat_2025-05-09_03-04-16.103_4320x7680.png",
      "/VRChat/2025-05/VRChat_2025-05-09_03-04-16.103_4320x7680-Edit.png",
      "/VRChat/2025-05/VRChat_2025-05-09_03-02-47.754_4320x7680.png",
      "/VRChat/2025-05/VRChat_2025-05-09_03-02-47.754_4320x7680-2.png",
      "/VRChat/2025-02/VRChat_2025-02-21_02-13-19.963_4320x7680.png",
      "/VRChat/2025-02/VRChat_2025-02-21_02-13-19.963_4320x7680_trim.PNG",
    ]);
    expect(findRetouchPairs(list)).toEqual([
      { original: 3, retouch: 4 },
      { original: 11, retouch: 12 },
      { original: 9, retouch: 10 },
      { original: 7, retouch: 8 },
      { original: 5, retouch: 6 },
      { original: 1, retouch: 2 },
    ]);
  });

  it("leaves VRChat's layers, other folders and lone names alone", () => {
    const list = photos([
      "/VRChat/2025-05/VRChat_2025-05-18_04-12-11.568_7680x4320.png",
      "/VRChat/2025-05/VRChat_2025-05-18_04-12-11.568_7680x4320_Environment.png",
      "/VRChat/2025-05/VRChat_2025-05-18_04-12-11.568_7680x4320_Player.png",
      "/2024/a/IMAG0001.JPG",
      "/2024/b/IMAG0001_edit.JPG",
      "/x/solo_DxO.jpg",
    ]);
    expect(findRetouchPairs(list)).toEqual([]);
  });

  it("pairs every retouch with the plainest original", () => {
    const list = photos(["/a/x.png", "/a/x_ON1.png", "/a/x_ON1-Edit.jpg"]);
    expect(findRetouchPairs(list)).toEqual([
      { original: 1, retouch: 3 },
      { original: 1, retouch: 2 },
    ]);
  });

  it("compares names without case, and not two photos of one stem", () => {
    expect(findRetouchPairs(photos(["/a/IMG.JPG", "/a/img_dxo.jpg"]))).toEqual([
      { original: 1, retouch: 2 },
    ]);
    expect(
      findRetouchPairs(photos(["/a/x.png", "/a/x.jpg", "/a/x_DxO.jpg"])),
    ).toEqual([]);
  });
});

describe("uploadBaseStems", () => {
  it("is the name itself, then the plainer ones", () => {
    expect(uploadBaseStems("/a/x_DxO.jpg")).toEqual(["x_DxO", "x"]);
    expect(uploadBaseStems("/a/x.jpg")).toEqual(["x"]);
  });
});

describe("retouch signals", () => {
  it("knows retouching programs, not cameras or VRChat", () => {
    expect(isRetouchTool("Adobe Lightroom 8.2 (Windows)")).toBe(true);
    expect(isRetouchTool("DxO PhotoLab 9.8.1")).toBe(true);
    expect(isRetouchTool("ON1 Photo RAW 2026")).toBe(true);
    expect(isRetouchTool("VRChat")).toBe(false);
    expect(isRetouchTool("HDR+ 1.0.888945374zd")).toBe(false);
    expect(isRetouchTool("UF22 21/10/19 v0.59")).toBe(false);
    expect(isRetouchTool(null)).toBe(false);
  });

  it("compares the time to the second and the camera", () => {
    expect(
      retouchSignals(
        { timestamp: "2026-06-04T03:20:37.165+09:00", camera_id: 1 },
        {
          timestamp: "2026-06-04T03:20:37+09:00",
          camera_id: 1,
          creator_tool: "DxO PhotoLab 9.8.1",
        },
      ),
    ).toEqual({ sameTime: true, sameCamera: true, tool: "DxO PhotoLab 9.8.1" });
    expect(
      retouchSignals(
        { timestamp: null, camera_id: null },
        { timestamp: null, camera_id: null, creator_tool: "VRChat" },
      ),
    ).toEqual({ sameTime: false, sameCamera: false, tool: null });
  });
});

describe("defaultMerge", () => {
  it("leaves a change of visibility to the owner, and shows what the site shows", () => {
    expect(defaultMerge("private", "public")).toEqual({
      visibility: null,
      show: true,
    });
    expect(defaultMerge("public", "private")).toEqual({
      visibility: null,
      show: false,
    });
    expect(defaultMerge("unlisted", "unlisted")).toEqual({
      visibility: "unlisted",
      show: false,
    });
    expect(defaultMerge("private", "private")).toEqual({
      visibility: "private",
      show: false,
    });
  });
});
