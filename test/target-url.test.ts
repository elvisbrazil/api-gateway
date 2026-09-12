import { describe, expect, it } from "vitest";
import { buildTargetUrl } from "../src/proxy/target-url.js";

describe("buildTargetUrl", () => {
  it("joins the upstream base path with the remaining path", () => {
    expect(buildTargetUrl("http://users:4001/v1/", "/api/users", "/api/users/7?x=1", true)).toBe(
      "http://users:4001/v1/7?x=1",
    );
  });

  it("maps the bare prefix to the upstream root", () => {
    expect(buildTargetUrl("http://users:4001", "/api/users", "/api/users", true)).toBe(
      "http://users:4001/",
    );
  });

  it("keeps the full path when not stripping", () => {
    expect(buildTargetUrl("http://users:4001", "/api/users", "/api/users/7", false)).toBe(
      "http://users:4001/api/users/7",
    );
  });
});
