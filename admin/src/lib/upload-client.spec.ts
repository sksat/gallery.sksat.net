import { describe, expect, it } from "vitest";
import { apiProblem } from "./upload-client";

describe("apiProblem", () => {
  it("keeps the route's own message", () => {
    expect(apiProblem(409, "a.png と同じ名前が多すぎます")).toBe(
      "a.png と同じ名前が多すぎます",
    );
  });

  it("puts the generic answers in words", () => {
    expect(apiProblem(500, "internal server error")).toBe(
      "サーバーでエラーが起きました（HTTP 500）",
    );
    expect(apiProblem(502)).toBe("サーバーでエラーが起きました（HTTP 502）");
    expect(apiProblem(403, "cross-origin request rejected")).toBe(
      "権限がありません（ログインし直してください）",
    );
    expect(apiProblem(413)).toBe(
      "リクエストが受け付けられませんでした（HTTP 413）",
    );
  });
});
