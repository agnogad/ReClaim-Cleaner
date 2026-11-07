// Turns raw scan results into the ranked recommendation list shared by the Overview and the
// cleaners, and executes a selection of them.

import { api } from "./api";
import { daysSince } from "./format";
import { shortPath } from "./paths";
import type { ScriptItem } from "./script";
import type { CleanReport, DeleteMethod, Group, InstallerFile, Project, Risk, Settings, TargetResult, TargetRule } from "./types";

export type RecKind = "rule" | "artifacts" | "installers";

export interface Rec {
  key: string;
  kind: RecKind;
  title: string;
  subtitle: string;
  risk: Risk;
  bytes: number;
  count: number;
  admin: boolean;
  blockedBy: string[];
  group?: Group;
  ruleId?: string;
  paths: string[];
}

type T = (key: string, opts?: Record<string, unknown>) => string;

const RISK_ORDER: Record<Risk, number> = { safe: 0, review: 1, caution: 2 };

export function ruleName(rule: TargetRule, lang: string): string {
  return lang.startsWith("tr") ? rule.nameTr : rule.name;
}

export function ruleDescription(rule: TargetRule, lang: string): string {
  return lang.startsWith("tr") ? rule.descriptionTr : rule.description;
}

/** Rule results that can be cleaned by deleting files (report-only rules need their tool). */
export function isCleanable(rule: TargetRule): boolean {
  return rule.mode !== "report" || !!rule.command?.startsWith("api:SHEmptyRecycleBin");
}

/**
 * A rule whose only way in is a command the user runs: it names no paths, so it can never be
 * measured. It is worth showing where the command is copied rather than run, and only when this
 * system has the tool, which keeps the apt rules off Fedora.
 */
export function isCommandOnly(rule: TargetRule, res: TargetResult, runCommands: boolean): boolean {
  return !runCommands && rule.mode === "report" && rule.paths.length === 0 && !!rule.command && !rule.command.startsWith("api:") && res.commandAvailable;
}

export function idleProjects(projects: Project[], idleDays: number, now = Date.now()): Project[] {
  return projects.filter((p) => daysSince(p.lastActivity, now) >= idleDays);
}

/** Build folders that rebuild themselves; `review` ones (like a venv) are never preselected. */
export function safeArtifactPaths(projects: Project[]): Set<string> {
  return new Set(projects.flatMap((p) => p.artifacts.filter((a) => a.risk === "safe").map((a) => a.path)));
}

export function buildRecommendations(args: {
  rules: TargetRule[];
  junk: TargetResult[] | null;
  projects: Project[] | null;
  installers: InstallerFile[] | null;
  settings: Settings;
  lang: string;
  profile: string;
  t: T;
  now?: number;
}): Rec[] {
  const { rules, junk, projects, installers, settings, lang, profile, t } = args;
  const out: Rec[] = [];
  const byId = new Map(rules.map((r) => [r.id, r]));
  for (const res of junk ?? []) {
    const rule = byId.get(res.id);
    if (!rule || res.bytes <= 0 || !isCleanable(rule)) continue;
    if (rule.risk === "caution" && !settings.showCaution) continue;
    const first = res.found[0]?.path ?? "";
    out.push({
      key: `rule:${rule.id}`,
      kind: "rule",
      title: ruleName(rule, lang),
      subtitle: res.found.length > 1 ? `${shortPath(first, profile)}  +${res.found.length - 1}` : shortPath(first, profile),
      risk: rule.risk,
      bytes: res.bytes,
      count: res.files,
      admin: rule.admin,
      blockedBy: res.running,
      group: rule.group,
      ruleId: rule.id,
      paths: res.found.map((f) => f.path),
    });
  }
  if (projects && projects.length > 0) {
    const idle = idleProjects(projects, settings.idleDays, args.now);
    const byRule = new Map<string, { dir: string; risk: Risk; bytes: number; paths: string[]; projects: Set<string> }>();
    for (const p of idle) {
      for (const a of p.artifacts) {
        const key = a.dirName.toLowerCase();
        const entry = byRule.get(key) ?? { dir: a.dirName, risk: a.risk, bytes: 0, paths: [], projects: new Set<string>() };
        entry.bytes += a.bytes;
        entry.paths.push(a.path);
        entry.projects.add(p.path);
        if (RISK_ORDER[a.risk] > RISK_ORDER[entry.risk]) entry.risk = a.risk;
        byRule.set(key, entry);
      }
    }
    for (const [key, e] of byRule) {
      if (e.risk === "caution" && !settings.showCaution) continue;
      out.push({
        key: `art:${key}`,
        kind: "artifacts",
        title: t("overview.artifactsIdle", { name: e.dir }),
        subtitle: t("overview.artifactsIn", { count: e.projects.size, days: settings.idleDays }),
        risk: e.risk,
        bytes: e.bytes,
        count: e.paths.length,
        admin: false,
        blockedBy: [],
        paths: e.paths,
      });
    }
  }
  if (installers && installers.length > 0) {
    out.push({
      key: "installers",
      kind: "installers",
      title: t("overview.installers"),
      subtitle: t("overview.installersHint", { days: settings.installerAgeDays }),
      risk: "review",
      bytes: installers.reduce((s, f) => s + f.bytes, 0),
      count: installers.length,
      admin: false,
      blockedBy: [],
      paths: installers.map((f) => f.path),
    });
  }
  out.sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || b.bytes - a.bytes);
  return out;
}

/** Items preselected by default: safe, not blocked by a running app, no UAC prompt needed. */
/** What a quick clean removes: safe rules nothing blocks, without admin rules unless elevated. */
export function quickCleanItems(recs: Rec[], elevated: boolean): Rec[] {
  return recs.filter((r) => r.kind === "rule" && r.risk === "safe" && r.blockedBy.length === 0 && (!r.admin || elevated));
}

export function defaultSelection(recs: Rec[]): Set<string> {
  return new Set(recs.filter((r) => r.risk === "safe" && r.blockedBy.length === 0 && !r.admin).map((r) => r.key));
}

export function mergeReports(reports: CleanReport[]): CleanReport {
  const out: CleanReport = { freed: 0, recycled: 0, files: 0, dirs: 0, failed: 0, failures: [], cancelled: false, items: [] };
  for (const r of reports) {
    out.freed += r.freed;
    out.recycled += r.recycled;
    out.files += r.files;
    out.dirs += r.dirs;
    out.failed += r.failed;
    out.cancelled ||= r.cancelled;
    out.failures.push(...r.failures.slice(0, 200 - out.failures.length));
    out.items.push(...r.items);
  }
  return out;
}

export async function cleanRecommendations(recs: Rec[], cacheMethod: DeleteMethod, filesMethod: DeleteMethod): Promise<{ report: CleanReport; elevationCancelled: boolean }> {
  const reports: CleanReport[] = [];
  let elevationCancelled = false;
  const ruleIds = recs.filter((r) => r.kind === "rule" && r.ruleId).map((r) => r.ruleId!);
  if (ruleIds.length) {
    const res = await api.junkClean(ruleIds, cacheMethod);
    reports.push(res.report);
    elevationCancelled = res.elevationCancelled;
  }
  const artifactPaths = recs.filter((r) => r.kind === "artifacts").flatMap((r) => r.paths);
  if (artifactPaths.length) reports.push(await api.pathsClean("projects", artifactPaths, cacheMethod));
  const installerPaths = recs.filter((r) => r.kind === "installers").flatMap((r) => r.paths);
  if (installerPaths.length) reports.push(await api.pathsClean("installers", installerPaths, filesMethod));
  return { report: mergeReports(reports), elevationCancelled };
}

export function scriptItems(recs: Rec[], rules: TargetRule[]): ScriptItem[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  return recs.map((r) => {
    const rule = r.ruleId ? byId.get(r.ruleId) : undefined;
    if (rule) {
      return { title: r.title, paths: rule.mode === "report" ? [] : r.paths, mode: rule.mode, include: rule.include, exclude: rule.exclude, minAgeHours: rule.minAgeHours, admin: rule.admin, command: rule.command };
    }
    return { title: r.title, paths: r.paths, mode: "path" as const };
  });
}
