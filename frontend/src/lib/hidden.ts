// Arithmetic and actions for the hidden space explainer. The engine measures; this decides what
// counts towards the gap and which Windows screen each part links to.

import type { HiddenKind, HiddenPart, HiddenSpace, ToolId } from "./types";

/** Parts Windows keeps for itself, summarized on the Overview. */
export const SYSTEM_KINDS: HiddenKind[] = ["shadowCopies", "reservedStorage", "pageFile", "hiberFile", "swapFile", "mft"];

export type PartAction = { kind: "tool"; tool: ToolId; label: string } | { kind: "page"; page: "tools" | "junk"; label: string } | { kind: "reveal" } | { kind: "admin" } | { kind: "measure" };

/** Online-only files are listed in folders but stored elsewhere, so they never explain used space. */
export function takesSpace(p: HiddenPart): boolean {
  return p.kind !== "cloudOnly";
}

/** Bytes of known parts that the scan did not count. */
export function outsideBytes(h: HiddenSpace): number {
  return h.parts.filter((p) => !p.inScan && takesSpace(p)).reduce((s, p) => s + (p.bytes ?? 0), 0);
}

/** Space Windows keeps for itself on the drive, as far as it is known, whether or not a scan saw it. */
export function systemKept(h: HiddenSpace): { parts: HiddenPart[]; bytes: number } {
  const parts = h.parts.filter((p) => SYSTEM_KINDS.includes(p.kind));
  return { parts, bytes: parts.reduce((s, p) => s + (p.bytes ?? 0), 0) };
}

/** The Windows screen (or ReClaim page) where the user can act on a part. Nothing is changed by ReClaim itself. */
export function partActions(p: HiddenPart, elevated: boolean): PartAction[] {
  switch (p.kind) {
    case "shadowCopies":
      return [...(p.needsAdmin ? [{ kind: "measure" } as const] : []), { kind: "tool", tool: "system-protection", label: "systemProtection" }];
    case "pageFile":
    case "swapFile":
      return [{ kind: "tool", tool: "performance-options", label: "performance" }];
    case "hiberFile":
      return [{ kind: "page", page: "tools", label: "tools" }];
    case "reservedStorage":
      // Settings > Storage shows it under "System & reserved"; nothing to see when it is off.
      return p.bytes ? [{ kind: "tool", tool: "storage-sense", label: "storage" }] : [];
    case "recycleBin":
      return [{ kind: "page", page: "junk", label: "junk" }];
    case "virtualDisk":
      return [{ kind: "reveal" }];
    case "unreadable":
      return elevated ? [] : [{ kind: "admin" }];
    default:
      return [];
  }
}
