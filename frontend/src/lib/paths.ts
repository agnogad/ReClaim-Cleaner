// Path handling for the UI. The engine sends native paths, so a path says which rules it follows:
// one that starts with `/` is POSIX (case-sensitive, `/` only, and a backslash is an ordinary
// character); anything else is Windows (case-insensitive, either separator).

function isPosix(path: string): boolean {
  return path.startsWith("/");
}

/** Without trailing separators, except on the POSIX root, which is nothing but a separator. */
function trimPosix(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

/** A value that is equal for two spellings of the same path, for sets and comparisons. */
export function pathKey(path: string): string {
  return isPosix(path) ? trimPosix(path) : path.toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/** Last path segment, for compact labels. */
export function baseName(path: string): string {
  if (isPosix(path)) {
    const trimmed = trimPosix(path);
    return trimmed === "/" ? trimmed : trimmed.slice(trimmed.lastIndexOf("/") + 1);
  }
  const trimmed = path.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

export function parentPath(path: string): string {
  if (isPosix(path)) {
    const trimmed = trimPosix(path);
    return trimmed.slice(0, trimmed.lastIndexOf("/")) || "/";
  }
  const trimmed = path.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return i > 0 ? trimmed.slice(0, i) : trimmed;
}

/** Replaces the user profile prefix with `~` to keep long paths readable. */
export function shortPath(path: string, profile: string): string {
  if (isPosix(path)) {
    const p = profile.replace(/\/+$/, "");
    return p && path.startsWith(p + "/") && path.length > p.length + 1 ? "~" + path.slice(p.length) : path;
  }
  const p = profile.replace(/[\\/]+$/, "");
  if (p && path.length > p.length && path.toLowerCase().startsWith(p.toLowerCase() + "\\")) return "~" + path.slice(p.length);
  return path;
}

/** How a drive root reads in a label: `C:\` -> `C:`, while `/` and `/mnt/data` stay as they are. */
export function driveLabel(root: string): string {
  return isPosix(root) ? trimPosix(root) : root.replace("\\", "");
}

/** Whether `path` is a whole drive: `C:\`, `/` or one of the mount points in `roots`. */
export function isDriveRoot(path: string, roots: string[] = []): boolean {
  return /^[A-Za-z]:\\?$/.test(path) || pathKey(path) === "/" || roots.some((r) => samePath(r, path));
}

/** A Windows path on a drive letter, the only kind the lock check can look at. */
export function hasDriveLetter(path: string): boolean {
  return /^[A-Za-z]:\\/.test(path);
}

/** Whether a rule result is a real location. Some results are names, such as a system store. */
export function isFilePath(path: string): boolean {
  return isPosix(path) || path.includes("\\");
}

/**
 * A readable hint for Claude Code's project folder name, which is the project's path with every
 * separator turned into `-`. `C--code-shop` -> `C:\code-shop`, and with the home folder
 * `/home/alex`, `-home-alex-shop` -> `~/shop`. The rest stays as it is: a `-` in it may have been
 * a separator or a real dash, and only a known prefix can be told apart.
 */
export function claudeProjectLabel(name: string, profile: string): string {
  const drive = /^([A-Za-z])--(.*)$/.exec(name);
  if (drive) return `${drive[1]}:\\${drive[2]}`;
  const home = isPosix(profile) ? trimPosix(profile).replace(/[^A-Za-z0-9]/g, "-") : "";
  return home && name.startsWith(`${home}-`) ? `~/${name.slice(home.length + 1)}` : name;
}
