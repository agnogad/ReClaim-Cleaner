import { describe, expect, it } from "vitest";
import { buildRecommendations, defaultSelection, idleProjects, isCleanable, isCommandOnly, mergeReports, quickCleanItems, safeArtifactPaths } from "./recommend";
import type { Project, Settings, TargetResult, TargetRule } from "./types";

const t = (key: string, opts?: Record<string, unknown>) => `${key}${opts ? JSON.stringify(opts) : ""}`;

function rule(id: string, risk: TargetRule["risk"], extra: Partial<TargetRule> = {}): TargetRule {
  return {
    id,
    group: "dev",
    name: id,
    nameTr: `${id}-tr`,
    description: "",
    descriptionTr: "",
    paths: [],
    mode: "contents",
    include: [],
    exclude: [],
    minAgeHours: null,
    risk,
    admin: false,
    closeApps: [],
    command: null,
    verified: true,
    source: null,
    user: false,
    ...extra,
  };
}

function result(id: string, bytes: number, extra: Partial<TargetResult> = {}): TargetResult {
  return { id, bytes, files: 1, found: [{ path: `C:\\Users\\a\\${id}`, bytes, files: 1 }], running: [], partial: false, commandAvailable: false, ...extra };
}

const settings: Settings = {
  language: "en",
  theme: "system",
  cacheDelete: "permanent",
  filesDelete: "recycle",
  showCaution: false,
  exclusions: [],
  projectRoots: [],
  idleDays: 30,
  largeMinMb: 100,
  duplicateMinKb: 1024,
  installerAgeDays: 30,
  checkUpdates: false,
  onboarded: false,
  explorerMenuDefaultApplied: false,
};

describe("isCommandOnly", () => {
  const pathless = rule("apt-cache", "review", { mode: "report", paths: [], command: "apt-get clean" });
  const empty = (commandAvailable: boolean) => ({ id: "apt-cache", bytes: 0, files: 0, found: [], running: [], partial: false, commandAvailable });

  it("shows a pathless report rule where commands are copied", () => {
    expect(isCommandOnly(pathless, empty(true), false)).toBe(true);
  });

  it("hides it when this system does not have the tool", () => {
    expect(isCommandOnly(pathless, empty(false), false)).toBe(false);
  });

  it("changes nothing where commands run from the app", () => {
    expect(isCommandOnly(pathless, empty(true), true)).toBe(false);
  });

  it("keeps other rules to what the scan measured", () => {
    expect(isCommandOnly({ ...pathless, paths: ["%HOME%/.cache/x"] }, empty(true), false)).toBe(false);
    expect(isCommandOnly({ ...pathless, mode: "contents" }, empty(true), false)).toBe(false);
    expect(isCommandOnly({ ...pathless, command: null }, empty(true), false)).toBe(false);
    expect(isCommandOnly({ ...pathless, command: "api:SHEmptyRecycleBinW()" }, empty(true), false)).toBe(false);
  });
});

describe("the Linux Trash rule", () => {
  const trash = rule("recycle-bin", "review", { mode: "report", paths: [], command: "api:SHEmptyRecycleBin" });

  it("is cleaned by the app, so nothing offers its command", () => {
    expect(isCleanable(trash)).toBe(true);
    expect(isCommandOnly(trash, { id: trash.id, bytes: 0, files: 0, found: [], running: [], partial: false, commandAvailable: true }, false)).toBe(false);
  });
});

describe("buildRecommendations", () => {
  const now = Date.UTC(2026, 9, 16);
  const rules = [
    rule("npm", "safe"),
    rule("ollama", "review"),
    rule("prefetch", "caution"),
    rule("winold", "caution", { mode: "report", command: "cleanmgr.exe /autoclean" }),
    rule("bin", "review", { mode: "report", command: "api:SHEmptyRecycleBinW()" }),
    rule("wintemp", "safe", { admin: true }),
  ];
  const junk = [result("npm", 100), result("ollama", 500), result("prefetch", 50), result("winold", 900), result("bin", 10), result("wintemp", 70), result("chrome", 5, { running: ["chrome.exe"] })];
  const projects: Project[] = [
    { path: "C:\\p\\old", name: "old", lastActivity: now / 1000 - 90 * 86400, hasGit: true, bytes: 300, artifacts: [{ path: "C:\\p\\old\\node_modules", ruleId: "node-modules", dirName: "node_modules", risk: "safe", bytes: 300, files: 10 }] },
    { path: "C:\\p\\new", name: "new", lastActivity: now / 1000 - 2 * 86400, hasGit: true, bytes: 999, artifacts: [{ path: "C:\\p\\new\\node_modules", ruleId: "node-modules", dirName: "node_modules", risk: "safe", bytes: 999, files: 10 }] },
  ];

  const recs = buildRecommendations({ rules, junk, projects, installers: [], settings, lang: "en", profile: "C:\\Users\\a", t, now });

  it("hides caution and report-only rules, keeps the Recycle Bin", () => {
    const keys = recs.map((r) => r.key);
    expect(keys).not.toContain("rule:prefetch");
    expect(keys).not.toContain("rule:winold");
    expect(keys).toContain("rule:bin");
  });

  it("only counts idle projects", () => {
    const art = recs.find((r) => r.kind === "artifacts")!;
    expect(art.bytes).toBe(300);
    expect(art.paths).toEqual(["C:\\p\\old\\node_modules"]);
  });

  it("sorts safe first, then by size", () => {
    expect(recs[0]!.risk).toBe("safe");
    const risks = recs.map((r) => r.risk);
    expect(risks.indexOf("review")).toBeGreaterThan(risks.lastIndexOf("safe"));
    expect(recs[0]!.bytes).toBeGreaterThanOrEqual(recs[1]!.bytes);
  });

  it("preselects only safe, unblocked, non-admin items", () => {
    const sel = defaultSelection(recs);
    expect(sel.has("rule:npm")).toBe(true);
    expect(sel.has("art:node_modules")).toBe(true);
    expect(sel.has("rule:wintemp")).toBe(false);
    expect(sel.has("rule:ollama")).toBe(false);
  });

  it("quick cleans safe rules only, admin ones when elevated", () => {
    const keys = (elevated: boolean) => quickCleanItems(recs, elevated).map((r) => r.key);
    expect(keys(false)).toContain("rule:npm");
    expect(keys(false)).not.toContain("rule:wintemp");
    expect(keys(true)).toContain("rule:wintemp");
    // Build artifacts and review items need their own pages.
    expect(keys(true)).not.toContain("art:node_modules");
    expect(keys(true)).not.toContain("rule:ollama");
  });

  it("uses Turkish names", () => {
    const trRecs = buildRecommendations({ rules, junk, projects: null, installers: null, settings, lang: "tr", profile: "", t, now });
    expect(trRecs.find((r) => r.key === "rule:npm")?.title).toBe("npm-tr");
  });
});

describe("safeArtifactPaths", () => {
  const now = Date.UTC(2026, 9, 16);
  const art = (path: string, risk: "safe" | "review") => ({ path, ruleId: "x", dirName: path.split("\\").pop() ?? "", risk, bytes: 1, files: 1 });
  const projects: Project[] = [
    { path: "C:\\p\\old", name: "old", lastActivity: now / 1000 - 90 * 86400, hasGit: false, bytes: 2, artifacts: [art("C:\\p\\old\\node_modules", "safe"), art("C:\\p\\old\\.venv", "review")] },
    { path: "C:\\p\\new", name: "new", lastActivity: now / 1000 - 2 * 86400, hasGit: false, bytes: 1, artifacts: [art("C:\\p\\new\\target", "safe")] },
  ];

  it("selects the safe folders of every project, active ones too", () => {
    expect([...safeArtifactPaths(projects)].sort()).toEqual(["C:\\p\\new\\target", "C:\\p\\old\\node_modules"]);
  });

  it("narrows to idle projects when combined with idleProjects", () => {
    expect([...safeArtifactPaths(idleProjects(projects, 30, now))]).toEqual(["C:\\p\\old\\node_modules"]);
  });
});

describe("mergeReports", () => {
  it("sums counters", () => {
    const base = { freed: 1, recycled: 2, files: 3, dirs: 0, failed: 1, failures: [{ path: "x", reason: "in_use" }], cancelled: false, items: ["a"] };
    const m = mergeReports([base, { ...base, cancelled: true }]);
    expect(m.freed).toBe(2);
    expect(m.failures).toHaveLength(2);
    expect(m.cancelled).toBe(true);
  });
});
