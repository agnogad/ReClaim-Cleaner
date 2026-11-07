import { afterEach, describe, expect, it } from "vitest";
import { useApp } from "./app";

afterEach(() => useApp.setState({ platform: "windows", page: "overview" }));

describe("go", () => {
  it("opens every page on Windows", () => {
    useApp.getState().go("tools");
    expect(useApp.getState().page).toBe("tools");
  });

  it("stays put when a link points at a page Linux does not have", () => {
    useApp.setState({ platform: "linux", page: "junk" });
    for (const page of ["apps", "startup", "tools"] as const) {
      useApp.getState().go(page);
      expect(useApp.getState().page).toBe("junk");
    }
    useApp.getState().go("explorer");
    expect(useApp.getState().page).toBe("explorer");
  });
});
