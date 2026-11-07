import { Archive, Box, Disc3, File, FileText, Film, Image as ImageIcon, Music, Package, type LucideIcon } from "lucide-react";
import { cx } from "../lib/cx";
import { fileKind, type FileKind } from "../lib/filetypes";
import { useShellImage } from "../lib/images";

const KIND_ICONS: Record<FileKind, LucideIcon> = {
  video: Film,
  image: ImageIcon,
  audio: Music,
  archive: Archive,
  disk: Disc3,
  installer: Package,
  document: FileText,
  model: Box,
  other: File,
};

/** Real app icon from the shell, or the first letter while it loads or when there is none. */
export function AppIcon({ path, name, size = 32 }: { path: string | null | undefined; name: string; size?: number }) {
  const src = useShellImage(path, Math.min(256, size * 2), "icon");
  const box = { width: size, height: size };
  if (src) return <img src={src} alt="" style={box} className="shrink-0 object-contain" draggable={false} />;
  return (
    <span style={box} className="flex shrink-0 items-center justify-center rounded-md border border-line bg-surface font-mono text-[13px] text-ink-secondary" aria-hidden>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** The icon Explorer shows for a file, with a type glyph as fallback. */
export function FileIcon({ path, name, size = 20 }: { path: string; name: string; size?: number }) {
  const src = useShellImage(path, Math.min(256, size * 2), "icon");
  if (src) return <img src={src} alt="" style={{ width: size, height: size }} className="shrink-0 object-contain" draggable={false} />;
  const Icon = KIND_ICONS[fileKind(name)];
  return <Icon size={size} strokeWidth={1.5} className="shrink-0 text-ink-muted" aria-hidden />;
}

/** Content thumbnail for photos, videos and documents; falls back to the large file icon. */
export function FileThumb({ path, name, className }: { path: string; name: string; className?: string }) {
  const kind = fileKind(name);
  const wantsThumb = kind === "image" || kind === "video" || kind === "document";
  const thumb = useShellImage(wantsThumb ? path : null, 192, "thumb");
  const icon = useShellImage(thumb ? null : path, 96, "icon");
  const src = thumb || icon;
  const Icon = KIND_ICONS[kind];
  return (
    <div className={cx("flex items-center justify-center overflow-hidden bg-surface", className)}>
      {src ? (
        <img src={src} alt="" className={thumb ? "h-full w-full object-cover" : "h-12 w-12 object-contain"} draggable={false} loading="lazy" />
      ) : (
        <Icon size={28} strokeWidth={1.25} className="text-ink-muted" aria-hidden />
      )}
    </div>
  );
}
