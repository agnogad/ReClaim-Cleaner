// Update check against GitHub Releases. Notify only: the app opens the release page and never
// downloads or installs anything by itself.

export const REPO = "yusufky63/reclaim-cleaner";
export const REPO_URL = `https://github.com/${REPO}`;

export type UpdateResult = { kind: "current" } | { kind: "available"; version: string; url: string } | { kind: "none" } | { kind: "error" };

/** Compares dotted numeric versions; pre-release suffixes are ignored. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, "")
      .split("-")[0]!
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function checkForUpdate(current: string): Promise<UpdateResult> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (res.status === 404) return { kind: "none" };
    if (!res.ok) return { kind: "error" };
    const body = (await res.json()) as { tag_name?: string; html_url?: string };
    if (!body.tag_name) return { kind: "none" };
    return isNewer(body.tag_name, current) ? { kind: "available", version: body.tag_name.replace(/^v/i, ""), url: body.html_url ?? `${REPO_URL}/releases` } : { kind: "current" };
  } catch {
    return { kind: "error" };
  }
}
