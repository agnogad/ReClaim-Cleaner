import { extOf } from "./format";
import type { DupGroup } from "./types";

export type FileKind = "video" | "image" | "audio" | "archive" | "disk" | "installer" | "document" | "model" | "other";

const KINDS: Record<Exclude<FileKind, "other">, string[]> = {
  video: ["mp4", "mkv", "mov", "avi", "wmv", "webm", "m4v", "flv", "mpg", "mpeg", "ts", "m2ts"],
  image: ["jpg", "jpeg", "png", "gif", "heic", "webp", "tif", "tiff", "bmp", "raw", "cr2", "cr3", "nef", "arw", "dng", "psd", "xcf"],
  audio: ["mp3", "flac", "wav", "m4a", "aac", "ogg", "wma", "opus", "aiff"],
  archive: ["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "zst", "cab"],
  disk: ["iso", "img", "vhd", "vhdx", "vmdk", "qcow2", "vdi", "wim", "esd"],
  installer: ["exe", "msi", "msix", "msixbundle", "appx", "appxbundle", "apk", "dmg"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "epub"],
  model: ["gguf", "safetensors", "ckpt", "onnx", "pt", "pth", "ggml", "bin"],
};

export const FILE_KINDS: FileKind[] = ["video", "image", "audio", "archive", "disk", "installer", "document", "model", "other"];

export function fileKind(name: string): FileKind {
  const ext = extOf(name);
  for (const [kind, exts] of Object.entries(KINDS)) {
    if (exts.includes(ext)) return kind as FileKind;
  }
  return "other";
}

/** Duplicate selection helpers. Each returns the paths to delete; one copy always stays. */
export type KeepRule = "newest" | "oldest" | "shortest";

export function selectDuplicates(groups: DupGroup[], keep: KeepRule): Set<string> {
  const selected = new Set<string>();
  for (const g of groups) {
    if (g.files.length < 2) continue;
    const sorted = [...g.files].sort((a, b) => {
      if (keep === "newest") return b.mtime - a.mtime;
      if (keep === "oldest") return a.mtime - b.mtime;
      return a.path.length - b.path.length || a.path.localeCompare(b.path);
    });
    for (const f of sorted.slice(1)) selected.add(f.path);
  }
  return selected;
}

/** Groups where every copy is selected: deleting them would lose the file. */
export function fullySelectedGroups(groups: DupGroup[], selected: Set<string>): DupGroup[] {
  return groups.filter((g) => g.files.length > 0 && g.files.every((f) => selected.has(f.path)));
}
