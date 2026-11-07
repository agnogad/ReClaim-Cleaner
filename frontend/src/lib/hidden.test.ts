import { describe, expect, it } from "vitest";
import { outsideBytes, partActions, systemKept } from "./hidden";
import type { HiddenPart, HiddenSpace } from "./types";

const part = (p: Partial<HiddenPart>): HiddenPart => ({ kind: "mft", bytes: 0, inScan: false, path: null, label: null, limit: null, count: null, needsAdmin: false, ...p });

const space: HiddenSpace = {
  root: "C:\\",
  total: 1000,
  free: 100,
  used: 900,
  scanned: 600,
  unexplained: 50,
  deniedPaths: [],
  parts: [
    part({ kind: "shadowCopies", bytes: null, needsAdmin: true }),
    part({ kind: "pageFile", bytes: 100, inScan: true }),
    part({ kind: "mft", bytes: 50 }),
    part({ kind: "reservedStorage", bytes: 200 }),
    part({ kind: "cloudOnly", bytes: 5000, count: 3 }),
    part({ kind: "unreadable", bytes: null, count: 2 }),
  ],
};

describe("hidden space", () => {
  it("counts only parts outside the scan that take space here", () => {
    expect(outsideBytes(space)).toBe(250);
  });

  it("summarizes what Windows keeps for itself", () => {
    const kept = systemKept(space);
    expect(kept.bytes).toBe(350);
    expect(kept.parts.map((p) => p.kind)).toEqual(["shadowCopies", "pageFile", "mft", "reservedStorage"]);
  });

  it("links to Windows screens and asks to measure when needed", () => {
    expect(partActions(space.parts[0]!, false).map((a) => a.kind)).toEqual(["measure", "tool"]);
    expect(partActions(part({ kind: "pageFile" }), false)).toEqual([{ kind: "tool", tool: "performance-options", label: "performance" }]);
    expect(partActions(part({ kind: "unreadable" }), false)).toEqual([{ kind: "admin" }]);
    expect(partActions(part({ kind: "unreadable" }), true)).toEqual([]);
    expect(partActions(part({ kind: "mft" }), false)).toEqual([]);
    expect(partActions(part({ kind: "reservedStorage", bytes: 0 }), false)).toEqual([]);
    expect(partActions(part({ kind: "reservedStorage", bytes: 7 }), false)).toHaveLength(1);
  });
});
