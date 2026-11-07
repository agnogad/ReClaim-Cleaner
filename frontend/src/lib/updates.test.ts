import { describe, expect, it } from "vitest";
import { isNewer } from "./updates";

describe("isNewer", () => {
  it("compares numeric versions", () => {
    expect(isNewer("v0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.1.10", "0.1.9")).toBe(true);
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("v0.9.9", "1.0.0")).toBe(false);
    expect(isNewer("1.0", "1.0.0")).toBe(false);
    expect(isNewer("1.1.0-beta.1", "1.0.0")).toBe(true);
  });
});
