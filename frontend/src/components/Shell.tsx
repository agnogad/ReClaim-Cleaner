import {
  AppWindow,
  Bot,
  Boxes,
  Code2,
  Copy,
  Download,
  FileStack,
  FolderX,
  Gamepad2,
  History,
  LayoutDashboard,
  MessagesSquare,
  type LucideIcon,
  Map as MapIcon,
  Power,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useApp, type PageId } from "../store/app";
import { UsageBar } from "./common";
import { useBytes } from "../lib/hooks";
import { driveLabel } from "../lib/paths";
import { pageAvailable } from "../lib/platform";
import {  } from "./ui";
import { cx } from "../lib/cx";

interface NavItem {
  id: PageId;
  icon: LucideIcon;
}

const SECTIONS: { label: string | null; items: NavItem[] }[] = [
  { label: null, items: [{ id: "overview", icon: LayoutDashboard }] },
  {
    label: "nav.analyze",
    items: [
      { id: "explorer", icon: MapIcon },
      { id: "large", icon: FileStack },
      { id: "duplicates", icon: Copy },
      { id: "empty", icon: FolderX },
    ],
  },
  {
    label: "nav.clean",
    items: [
      { id: "junk", icon: Sparkles },
      { id: "projects", icon: Code2 },
    ],
  },
  {
    label: "nav.organize",
    items: [
      { id: "models", icon: Bot },
      { id: "assistants", icon: MessagesSquare },
      { id: "downloads", icon: Download },
      { id: "games", icon: Gamepad2 },
    ],
  },
  {
    label: "nav.manage",
    items: [
      { id: "apps", icon: AppWindow },
      { id: "startup", icon: Power },
      { id: "tools", icon: Wrench },
    ],
  },
];

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 1024 1024" aria-hidden>
      <rect width="1024" height="1024" rx="224" fill="var(--primary-fill)" />
      <path d="M754 540A270 270 0 1 1 484 270" fill="none" stroke="var(--primary-contrast)" strokeWidth="96" />
      <path d="M858 484A318 318 0 0 0 540 166L540 262A222 222 0 0 1 762 484Z" fill="var(--primary-contrast)" />
    </svg>
  );
}

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "rail flex h-9 w-full items-center gap-2.5 rounded-md pl-3 pr-2 text-left text-[14px] transition-colors transition-fast",
        active ? "rail-active bg-primary-soft font-medium text-ink" : "text-ink-secondary hover:bg-surface-muted hover:text-ink",
      )}
    >
      <Icon size={17} strokeWidth={1.75} className={active ? "text-primary" : ""} aria-hidden />
      <span className="truncate">{t(`nav.${item.id}`)}</span>
    </button>
  );
}

function Sidebar() {
  const { t } = useTranslation();
  const page = useApp((s) => s.page);
  const go = useApp((s) => s.go);
  const info = useApp((s) => s.info);
  const drives = useApp((s) => s.drives);
  const platform = useApp((s) => s.platform);
  const fmt = useBytes();
  const sys = drives.find((d) => d.system) ?? drives[0];
  const sections = SECTIONS.map((s) => ({ ...s, items: s.items.filter((item) => pageAvailable(platform, item.id)) })).filter((s) => s.items.length > 0);
  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Logo />
        <div className="leading-tight">
          <div className="display text-[16px] text-ink">{t("app.name")}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">Cleaner</div>
        </div>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-3 pt-1" aria-label="Main">
        {sections.map((s, i) => (
          <div key={i}>
            {s.label && <div className="label mb-1.5 px-3">{t(s.label)}</div>}
            <div className="space-y-0.5">
              {s.items.map((item) => (
                <NavButton key={item.id} item={item} active={page === item.id} onClick={() => go(item.id)} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-line px-3 py-3">
        <NavButton item={{ id: "history", icon: History }} active={page === "history"} onClick={() => go("history")} />
        <NavButton item={{ id: "settings", icon: SettingsIcon }} active={page === "settings"} onClick={() => go("settings")} />
      </div>
      {sys && (
        <div className="border-t border-line px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between gap-2 font-mono text-[11px] text-ink-muted">
            <span className="min-w-0 truncate" title={sys.root}>
              {driveLabel(sys.root)}
            </span>
            <span className="num shrink-0">{fmt(sys.free)}</span>
          </div>
          <UsageBar segments={[{ value: sys.total - sys.free, className: "bg-primary" }, { value: sys.free, className: "swatch-free" }]} />
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-muted">
            {info?.elevated ? <ShieldCheck size={13} strokeWidth={1.75} className="text-positive-fg" /> : <Boxes size={13} strokeWidth={1.75} />}
            <span>{info?.elevated ? t("nav.admin") : t("nav.standard")}</span>
            {info?.portable && <span className="ml-auto rounded-sm bg-surface-muted px-1.5 font-mono text-[10px]">{t("nav.portable")}</span>}
          </div>
        </div>
      )}
    </aside>
  );
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="z-toast pointer-events-none fixed bottom-5 right-5 flex w-[360px] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "anim-rise pointer-events-auto flex items-start gap-3 rounded-md border bg-canvas px-3.5 py-3 text-[14px] shadow-popover",
            t.tone === "positive" ? "border-positive" : t.tone === "danger" ? "border-danger" : t.tone === "warning" ? "border-warning" : "border-line",
          )}
        >
          <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", t.tone === "positive" ? "bg-positive" : t.tone === "danger" ? "bg-danger" : t.tone === "warning" ? "bg-warning" : "bg-primary")} />
          <span className="selectable min-w-0 flex-1 text-ink">{t.text}</span>
          <button type="button" aria-label="close" onClick={() => dismiss(t.id)} className="text-ink-muted hover:text-ink">
            <X size={15} strokeWidth={1.75} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell flex h-full">
      <Sidebar />
      <main className="relative min-w-0 flex-1 overflow-y-auto" id="main">
        <div className="mx-auto w-full max-w-[1320px] px-6 pb-6 pt-6">{children}</div>
      </main>
      <Toasts />
    </div>
  );
}
