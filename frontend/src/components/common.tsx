import { AlertTriangle, FolderPlus, Lock, ShieldAlert, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { pickFolders } from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";
import { hasDriveLetter, samePath, shortPath } from "../lib/paths";
import type { CleanReport, DeleteMethod } from "../lib/types";
import { api } from "../lib/api";
import { useBytes, useFeature, useLocale } from "../lib/hooks";
import { useApp } from "../store/app";
import { Banner, Button, Dialog, ProgressBar, Segmented } from "./ui";
import { LockDialog } from "./LockDialog";
import { cx } from "../lib/cx";

/** Live progress of one job kind, with a cancel button. */
export function ProgressPanel({ kind, label, className }: { kind: string; label?: string; className?: string }) {
  const { t } = useTranslation();
  const p = useApp((s) => s.progress[kind]);
  const locale = useLocale();
  const ratio = p && p.total > 0 ? p.done / p.total : null;
  return (
    <div className={cx("rounded-lg border border-line bg-canvas px-4 py-3", className)} aria-live="polite">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">{label ?? t("common.scanning")}</div>
          <div className="num truncate font-mono text-[12px] text-ink-muted">
            {p ? t("common.progressFiles", { files: formatCount(p.files, locale), size: formatBytes(p.bytes, locale) }) : "…"}
            {p && p.total > 0 ? ` · ${t("common.progressStage", { done: formatCount(p.done, locale), total: formatCount(p.total, locale) })}` : ""}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void api.cancel(kind)}>
          {t("common.cancel")}
        </Button>
      </div>
      <ProgressBar value={ratio} />
      {p?.current && <div className="selectable mt-2 truncate font-mono text-[11px] text-ink-muted" title={p.current}>{p.current}</div>}
    </div>
  );
}

/** Editable list of folders (scan roots, exclusions). */
export function FolderList({ folders, onChange, suggestions = [], emptyText }: { folders: string[]; onChange: (f: string[]) => void; suggestions?: string[]; emptyText?: string }) {
  const { t } = useTranslation();
  const profile = useApp((s) => s.info?.userProfile ?? "");
  const add = async () => {
    const picked = await pickFolders(true);
    const next = [...folders];
    for (const p of picked) if (!next.some((f) => samePath(f, p))) next.push(p);
    onChange(next);
  };
  const missing = suggestions.filter((s) => !folders.some((f) => samePath(f, s)));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {folders.length === 0 && <span className="text-[13px] text-ink-muted">{emptyText ?? t("settings.noneAdded")}</span>}
      {folders.map((f) => (
        <span key={f} className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border border-line bg-surface pl-2.5 pr-1 font-mono text-[12px] text-ink" title={f}>
          <span className="truncate">{shortPath(f, profile)}</span>
          <button type="button" aria-label={`${t("common.remove")} ${f}`} onClick={() => onChange(folders.filter((x) => x !== f))} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
            <X size={13} strokeWidth={1.75} />
          </button>
        </span>
      ))}
      {missing.slice(0, 4).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange([...folders, s])}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-line-strong px-2.5 font-mono text-[12px] text-ink-secondary hover:border-primary hover:text-primary"
          title={s}
        >
          + {shortPath(s, profile)}
        </button>
      ))}
      <Button size="sm" variant="ghost" icon={<FolderPlus size={15} strokeWidth={1.75} />} onClick={() => void add()}>
        {t("common.addFolder")}
      </Button>
    </div>
  );
}

export function PathText({ path, className }: { path: string; className?: string }) {
  const profile = useApp((s) => s.info?.userProfile ?? "");
  return (
    <span className={cx("selectable block truncate font-mono text-[12px] text-ink-muted", className)} title={path}>
      {shortPath(path, profile)}
    </span>
  );
}

/** Sticky footer that summarises a selection and holds the main action. */
export function SelectionBar({ count, bytes, children, note }: { count: number; bytes: number; children: ReactNode; note?: ReactNode }) {
  const { t } = useTranslation();
  const fmt = useBytes();
  return (
    <div className="z-sticky sticky bottom-0 -mx-6 mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas px-6 py-3">
      <div className="min-w-0">
        <div className="num font-mono text-[14px] text-ink">{count > 0 ? t("common.selectedSummary", { size: fmt(bytes), count }) : t("common.nothingSelected")}</div>
        {note && <div className="text-[12px] text-ink-muted">{note}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function ConfirmClean({
  open,
  onClose,
  onConfirm,
  count,
  bytes,
  method,
  onMethod,
  adminCount = 0,
  hasReview = false,
  busy,
  files,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  count: number;
  bytes: number;
  method: DeleteMethod;
  onMethod?: (m: DeleteMethod) => void;
  adminCount?: number;
  hasReview?: boolean;
  busy?: boolean;
  files?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const fmt = useBytes();
  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={files ? t("confirm.titleFiles", { count }) : t("confirm.title", { count })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={onConfirm} loading={busy} data-autofocus>
            {busy ? t("confirm.working") : files ? t("confirm.confirmDelete") : t("confirm.confirm")}
          </Button>
        </>
      }
    >
      <p className="text-[15px] text-ink">{t("confirm.body", { size: fmt(bytes) })}</p>
      <div className="mt-4">
        <div className="label mb-2">{t("confirm.method")}</div>
        {onMethod ? (
          <Segmented
            value={method}
            onChange={onMethod}
            options={[
              { value: "permanent", label: t("method.permanent") },
              { value: "recycle", label: t("method.recycle") },
            ]}
          />
        ) : (
          <div className="text-[14px] text-ink">{t(`method.${method}`)}</div>
        )}
        <p className="mt-2 text-[13px] text-ink-muted">{t(`method.${method}Hint`)}</p>
      </div>
      <div className="mt-4 space-y-2">
        {adminCount > 0 && (
          <Banner tone="primary" icon={<ShieldAlert size={16} strokeWidth={1.75} />}>
            {t("confirm.adminNote", { count: adminCount })}
          </Banner>
        )}
        {hasReview && (
          <Banner tone="warning" icon={<AlertTriangle size={16} strokeWidth={1.75} />}>
            {t("confirm.reviewNote")}
          </Banner>
        )}
      </div>
      {children}
    </Dialog>
  );
}

/** Paths of failures that "What is using this?" can check: files or folders that were in use. */
function lockable(reason: string, path: string): boolean {
  return reason === "in_use" && hasDriveLetter(path);
}

export function ReportDialog({ report, onClose }: { report: CleanReport | null; onClose: () => void }) {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const [lockPath, setLockPath] = useState<string | null>(null);
  const locks = useFeature("locks");
  if (!report) return null;
  // The lock check replaces the report while it is open, so the two dialogs never stack.
  if (lockPath) return <LockDialog path={lockPath} onClose={() => setLockPath(null)} />;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("result.title")}
      wide={report.failures.length > 0}
      footer={
        <Button variant="primary" onClick={onClose} data-autofocus>
          {t("result.ok")}
        </Button>
      }
    >
      <div className="module-grid grid-cols-3">
        <div className="px-4 py-3">
          <div className="label">{t("result.freed")}</div>
          <div className="num mt-1 font-mono text-[20px] text-ink">{fmt(report.freed)}</div>
        </div>
        <div className="px-4 py-3">
          <div className="label">{t("result.recycled")}</div>
          <div className="num mt-1 font-mono text-[20px] text-ink">{fmt(report.recycled)}</div>
        </div>
        <div className="px-4 py-3">
          <div className="label">{t("result.skipped")}</div>
          <div className="num mt-1 font-mono text-[20px] text-ink">{formatCount(report.failed, locale)}</div>
        </div>
      </div>
      {report.failures.length > 0 && (
        <div className="mt-4">
          <div className="label mb-2">{t("result.skippedList")}</div>
          <ul className="max-h-[260px] divide-y divide-line overflow-y-auto rounded-md border border-line">
            {report.failures.map((f, i) => (
              <li key={`${f.path}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                <PathText path={f.path} />
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[12px] text-ink-secondary">{t(`reasons.${f.reason}`, { defaultValue: f.reason })}</span>
                  {locks && lockable(f.reason, f.path) && (
                    <Button size="sm" variant="ghost" icon={<Lock size={13} strokeWidth={1.75} />} onClick={() => setLockPath(f.path)}>
                      {t("locks.button")}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

/** Horizontal bar of one or more segments over a track (drive usage, reclaimable share). */
export function UsageBar({ segments, className }: { segments: { value: number; className: string; label?: string }[]; className?: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className={cx("flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-surface-muted", className)}>
      {segments
        .filter((s) => s.value > 0)
        .map((s, i) => (
          <div key={i} title={s.label} className={cx("h-full first:rounded-l-full last:rounded-r-full", s.className)} style={{ width: `${(s.value / total) * 100}%` }} />
        ))}
    </div>
  );
}
