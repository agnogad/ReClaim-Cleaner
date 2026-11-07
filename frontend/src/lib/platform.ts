// What this operating system can do, as far as the UI is concerned. `app_info` reports the
// platform; every page, panel and action a system lacks is named here, so the UI asks this file
// instead of comparing platform names.

import type { PageId } from "../store/app";
import type { OsInfo } from "./types";

const WINDOWS_FEATURES = [
  "appsPage",
  "startupPage",
  "toolsPage",
  /** The hidden space panel and its Overview card. */
  "hiddenSpace",
  /** "What is using this?" */
  "locks",
  /** "Restart as administrator". */
  "elevation",
  /** "Analyze with ReClaim" in the file manager's menu. */
  "explorerMenu",
  /** The jump list task and the desktop shortcut for quick clean. */
  "quickCleanShortcuts",
  /** "Copy script", which writes PowerShell. */
  "scriptExport",
  /** Rule commands run from the app. Elsewhere the UI shows them with a copy button. */
  "runRuleCommands",
] as const;

export type Feature = (typeof WINDOWS_FEATURES)[number];

/** A system that is not listed has none of these, so a new port starts from the safe side. */
const FEATURES: Record<string, ReadonlySet<Feature> | undefined> = {
  windows: new Set(WINDOWS_FEATURES),
};

const PAGE_FEATURES: Partial<Record<PageId, Feature>> = {
  apps: "appsPage",
  startup: "startupPage",
  tools: "toolsPage",
};

export function hasFeature(platform: string, feature: Feature): boolean {
  return FEATURES[platform]?.has(feature) ?? false;
}

export function pageAvailable(platform: string, page: PageId): boolean {
  const feature = PAGE_FEATURES[page];
  return !feature || hasFeature(platform, feature);
}

/** `Windows 11 24H2 (26100)`, leaving out what the system does not report. */
export function osLabel(os: OsInfo): string {
  const name = [os.name, os.displayVersion].filter(Boolean).join(" ");
  return os.build ? `${name} (${os.build})` : name;
}
