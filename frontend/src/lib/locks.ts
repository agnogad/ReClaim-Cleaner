// Grouping for the "What is using this?" list. Browsers and editors run many processes from one
// program file; the list shows them as one entry.

import type { CloseOutcome, Locker, LockerKind } from "./types";

export interface LockerGroup {
  key: string;
  kind: LockerKind;
  name: string;
  exe: string | null;
  service: string | null;
  usesFiles: boolean;
  runsFrom: boolean;
  members: Locker[];
  /** Members with a window that can be asked to close. */
  closable: Locker[];
}

export function groupLockers(lockers: Locker[]): LockerGroup[] {
  const groups = new Map<string, LockerGroup>();
  for (const l of lockers) {
    const key = [l.kind, l.name.toLowerCase(), (l.exe ?? "").toLowerCase(), l.service ?? ""].join("|");
    const g = groups.get(key) ?? { key, kind: l.kind, name: l.name, exe: l.exe, service: l.service, usesFiles: false, runsFrom: false, members: [], closable: [] };
    g.usesFiles ||= l.usesFiles;
    g.runsFrom ||= l.runsFrom;
    g.members.push(l);
    if (l.canClose) g.closable.push(l);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.members.sort((a, b) => a.pid - b.pid);
  return [...groups.values()];
}

/** One outcome for closing several windows of the same app: any success counts. */
export function combineOutcomes(outcomes: CloseOutcome[]): CloseOutcome {
  if (outcomes.includes("closed")) return "closed";
  return outcomes.find((o) => o !== "gone") ?? outcomes[0] ?? "notAllowed";
}
