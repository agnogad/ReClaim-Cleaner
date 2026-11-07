import { describe, expect, it } from "vitest";
import { combineOutcomes, groupLockers } from "./locks";
import type { Locker } from "./types";

const locker = (p: Partial<Locker>): Locker => ({ pid: 1, started: 1, name: "App", exe: "C:\\App\\app.exe", service: null, kind: "app", usesFiles: false, runsFrom: false, canClose: false, ...p });

describe("lock list", () => {
  it("groups processes of one program", () => {
    const groups = groupLockers([
      locker({ pid: 30, name: "Microsoft Edge", exe: "C:\\Edge\\msedge.exe", usesFiles: true }),
      locker({ pid: 10, name: "Microsoft Edge", exe: "C:\\Edge\\MSEDGE.EXE", canClose: true, runsFrom: true }),
      locker({ pid: 20, name: "Microsoft Edge", exe: "C:\\Edge\\msedge.exe", kind: "background" }),
      locker({ pid: 5, name: "svchost.exe", exe: null, kind: "service", service: "WSearch" }),
    ]);
    expect(groups).toHaveLength(3);
    const edge = groups[0]!;
    expect(edge.members.map((m) => m.pid)).toEqual([10, 30]);
    expect(edge.closable.map((m) => m.pid)).toEqual([10]);
    expect(edge.usesFiles && edge.runsFrom).toBe(true);
  });

  it("reports a close as done when any window closed", () => {
    expect(combineOutcomes(["stillRunning", "closed"])).toBe("closed");
    expect(combineOutcomes(["gone", "denied"])).toBe("denied");
    expect(combineOutcomes(["gone"])).toBe("gone");
    expect(combineOutcomes([])).toBe("notAllowed");
  });
});
