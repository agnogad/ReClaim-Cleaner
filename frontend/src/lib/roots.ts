import type { LibraryFolders } from "./types";

/** The user's library folders in the order most useful for duplicate and empty-folder scans. */
export function libraryRoots(libs: LibraryFolders | undefined): string[] {
  if (!libs) return [];
  return [libs.downloads, libs.documents, libs.desktop, libs.pictures, libs.videos, libs.music].filter((p): p is string => !!p);
}
