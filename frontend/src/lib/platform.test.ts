import { describe, expect, it } from "vitest";
import { hasFeature, osLabel, pageAvailable, type Feature } from "./platform";
import type { PageId } from "../store/app";

const FEATURES: Feature[] = ["appsPage", "startupPage", "toolsPage", "hiddenSpace", "locks", "elevation", "explorerMenu", "quickCleanShortcuts", "scriptExport", "runRuleCommands"];
const PAGES: PageId[] = ["overview", "explorer", "large", "duplicates", "empty", "junk", "projects", "models", "assistants", "downloads", "games", "apps", "startup", "tools", "history", "settings"];
const WINDOWS_ONLY_PAGES: PageId[] = ["apps", "startup", "tools"];

describe("features", () => {
  it("keeps everything on Windows", () => {
    for (const f of FEATURES) expect({ f, on: hasFeature("windows", f) }).toEqual({ f, on: true });
  });

  it("gates all of it elsewhere", () => {
    for (const platform of ["linux", "macos", "freebsd"]) {
      for (const f of FEATURES) expect({ platform, f, on: hasFeature(platform, f) }).toEqual({ platform, f, on: false });
    }
  });
});

describe("pages", () => {
  it("shows every page on Windows", () => {
    expect(PAGES.filter((p) => !pageAvailable("windows", p))).toEqual([]);
  });

  it("hides the Windows-only pages on Linux and keeps the rest", () => {
    expect(PAGES.filter((p) => !pageAvailable("linux", p))).toEqual(WINDOWS_ONLY_PAGES);
  });
});

describe("osLabel", () => {
  it("shows name, version and build on Windows", () => {
    expect(osLabel({ name: "Windows 11", displayVersion: "24H2", build: "26100" })).toBe("Windows 11 24H2 (26100)");
  });

  it("leaves out what a system does not report", () => {
    expect(osLabel({ name: "Ubuntu 24.04", displayVersion: "", build: "" })).toBe("Ubuntu 24.04");
    expect(osLabel({ name: "Linux", displayVersion: "", build: "6.8.0" })).toBe("Linux (6.8.0)");
  });
});
