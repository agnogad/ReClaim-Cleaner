import { Download, FolderOpen, LayoutGrid, List, ScanSearch, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmClean, ProgressPanel, ReportDialog, SelectionBar } from "../components/common";
import { FileIcon, FileThumb } from "../components/FileIcons";
import { Badge, Button, Card, Checkbox, EmptyState, PageHeader, Segmented, Select, Stat } from "../components/ui";
import { api } from "../lib/api";
import { cx } from "../lib/cx";
import { FILE_KINDS, fileKind, type FileKind } from "../lib/filetypes";
import { daysSince, formatAgo, formatCount, splitBytes } from "../lib/format";
import { useBytes, useLocale } from "../lib/hooks";
import type { CleanReport, DeleteMethod, DownloadFile, DownloadsReport } from "../lib/types";
import { errorText, useApp } from "../store/app";

const PAGE = 300;

export function DownloadsPage() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const { settings, running, setRunning, toast, refreshDrives } = useApp();
  const [report, setReport] = useState<DownloadsReport | null>(null);
  const [kind, setKind] = useState<FileKind | "all">("all");
  const [age, setAge] = useState(0);
  const [onlyCopies, setOnlyCopies] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [method, setMethod] = useState<DeleteMethod>(settings?.filesDelete ?? "recycle");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CleanReport | null>(null);
  const scanning = !!running.downloads;

  const scan = async () => {
    setRunning("downloads", true);
    try {
      setReport(await api.downloads());
      setSelected(new Set());
      setShown(PAGE);
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setRunning("downloads", false);
    }
  };

  const files = useMemo(() => report?.files ?? [], [report]);
  const byKind = useMemo(() => {
    const m = new Map<FileKind, { bytes: number; count: number }>();
    for (const f of files) {
      const k = fileKind(f.name);
      const e = m.get(k) ?? { bytes: 0, count: 0 };
      e.bytes += f.bytes;
      e.count += 1;
      m.set(k, e);
    }
    return m;
  }, [files]);
  const q = query.trim().toLowerCase();
  const list = files.filter(
    (f) => (kind === "all" || fileKind(f.name) === kind) && (age === 0 || daysSince(f.mtime) >= age) && (!onlyCopies || f.copy) && (!q || f.name.toLowerCase().includes(q) || f.folder.toLowerCase().includes(q)),
  );
  const chosen = list.filter((f) => selected.has(f.path));
  const chosenBytes = chosen.reduce((s, f) => s + f.bytes, 0);
  const copies = files.filter((f) => f.copy);
  const old = files.filter((f) => daysSince(f.mtime) >= 180);

  const toggle = (f: DownloadFile, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(f.path);
      else next.delete(f.path);
      return next;
    });

  const remove = async () => {
    setBusy(true);
    try {
      const r = await api.pathsClean(
        "downloads",
        chosen.map((f) => f.path),
        method,
      );
      setConfirm(false);
      setResult(r);
      const failed = new Set(r.failures.map((f) => f.path));
      setReport((prev) => (prev ? { ...prev, files: prev.files.filter((f) => !selected.has(f.path) || failed.has(f.path)) } : prev));
      setSelected(new Set());
      void refreshDrives();
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const totalSplit = splitBytes(report?.bytes ?? 0, locale);
  const kindsPresent = FILE_KINDS.filter((k) => byKind.get(k));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("downloads.title")}
        subtitle={t("downloads.subtitle")}
        meta={report ? <span className="selectable font-mono">{report.root}</span> : null}
        actions={
          <Button variant={report ? "secondary" : "primary"} icon={<ScanSearch size={16} strokeWidth={1.75} />} loading={scanning} onClick={() => void scan()}>
            {scanning ? t("common.scanning") : report ? t("common.rescan") : t("common.scan")}
          </Button>
        }
      />
      {scanning ? (
        <ProgressPanel kind="downloads" />
      ) : !report ? (
        <Card>
          <EmptyState icon={<Download size={20} strokeWidth={1.75} />} title={t("downloads.emptyTitle")} body={t("downloads.emptyBody")} />
        </Card>
      ) : (
        <>
          <div className="module-grid ticks grid-cols-2 lg:grid-cols-4">
            <Stat label={t("common.total")} value={totalSplit.value} unit={totalSplit.unit} sub={t("common.filesCount", { count: files.length })} />
            <Stat label={t("downloads.copies")} value={formatCount(copies.length, locale)} sub={fmt(copies.reduce((s, f) => s + f.bytes, 0))} />
            <Stat label={t("downloads.old")} value={formatCount(old.length, locale)} sub={fmt(old.reduce((s, f) => s + f.bytes, 0))} />
            <div className="px-5 py-4">
              <div className="text-[13px] text-ink-secondary">{t("common.type")}</div>
              <div className="mt-3 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-muted">
                {kindsPresent.map((k) => (
                  <div key={k} className={cx("h-full first:rounded-l-full last:rounded-r-full", `kind-${k}`)} style={{ width: `${((byKind.get(k)?.bytes ?? 0) / (report.bytes || 1)) * 100}%`, background: "var(--kind)" }} title={`${t(`large.kinds.${k}`)} ${fmt(byKind.get(k)?.bytes ?? 0)}`} />
                ))}
              </div>
            </div>
          </div>

          <Card>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <button
                type="button"
                aria-pressed={kind === "all"}
                onClick={() => setKind("all")}
                className={cx("inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px]", kind === "all" ? "border-primary bg-primary-soft text-ink" : "border-line text-ink-secondary hover:border-line-strong hover:text-ink")}
              >
                {t("downloads.allTypes")}
              </button>
              {kindsPresent.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(kind === k ? "all" : k)}
                  className={cx("inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px]", `kind-${k}`, kind === k ? "border-primary bg-primary-soft text-ink" : "border-line text-ink-secondary hover:border-line-strong hover:text-ink")}
                >
                  <span className="kind-dot" />
                  {t(`large.kinds.${k}`)}
                  <span className="num font-mono text-[11px] text-ink-muted">{fmt(byKind.get(k)?.bytes ?? 0)}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
              <label className="field flex min-w-[220px] flex-1 items-center gap-2">
                <Search size={15} strokeWidth={1.75} className="text-ink-muted" aria-hidden />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("downloads.search")} aria-label={t("downloads.search")} className="h-full w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-muted" />
              </label>
              <Select
                label={t("common.age")}
                value={age}
                onChange={setAge}
                options={[
                  { value: 0, label: t("large.ageAny") },
                  { value: 30, label: t("common.olderThan", { days: 30 }) },
                  { value: 180, label: t("large.age6m") },
                  { value: 365, label: t("large.age1y") },
                ]}
              />
              <Button size="md" variant={onlyCopies ? "primary" : "secondary"} onClick={() => setOnlyCopies(!onlyCopies)} disabled={copies.length === 0}>
                {t("downloads.onlyCopies")} ({copies.length})
              </Button>
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: "list", label: <><List size={14} strokeWidth={1.75} />{t("downloads.viewList")}</> },
                  { value: "grid", label: <><LayoutGrid size={14} strokeWidth={1.75} />{t("downloads.viewGrid")}</> },
                ]}
              />
            </div>
          </Card>

          {report.truncated && <p className="text-[12px] text-ink-muted">{t("downloads.truncated", { count: files.length })}</p>}

          {list.length === 0 ? (
            <Card>
              <EmptyState icon={<Download size={20} strokeWidth={1.75} />} title={t("downloads.none")} />
            </Card>
          ) : view === "list" ? (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
                <Checkbox checked={chosen.length > 0 && chosen.length === list.length} indeterminate={chosen.length > 0 && chosen.length < list.length} onChange={(on) => setSelected(on ? new Set(list.map((f) => f.path)) : new Set())} label={t("common.selectAll")} />
                <span className="label">{t("common.items", { count: list.length })}</span>
              </div>
              <ul className="divide-y divide-line">
                {list.slice(0, shown).map((f) => (
                  <li key={f.path} className={cx("rail flex items-center gap-3 px-4 py-2 hover:bg-surface", selected.has(f.path) && "bg-primary-soft")}>
                    <Checkbox checked={selected.has(f.path)} onChange={(on) => toggle(f, on)} label={f.name} />
                    <FileIcon path={f.path} name={f.name} size={22} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[14px] text-ink" title={f.name}>
                          {f.name}
                        </span>
                        {f.copy && <Badge tone="warning">{t("downloads.copyBadge")}</Badge>}
                      </div>
                      <div className="truncate font-mono text-[11px] text-ink-muted">{[f.folder, formatAgo(f.mtime, locale)].filter(Boolean).join(" · ")}</div>
                    </div>
                    <span className="num w-[80px] shrink-0 text-right font-mono text-[13px] text-ink">{fmt(f.bytes)}</span>
                    <button type="button" title={t("common.reveal")} aria-label={t("common.reveal")} onClick={() => void api.reveal(f.path).catch(() => undefined)} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
                      <FolderOpen size={15} strokeWidth={1.75} />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {list.slice(0, shown).map((f) => (
                <div
                  key={f.path}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(f, !selected.has(f.path))}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      toggle(f, !selected.has(f.path));
                    }
                  }}
                  onDoubleClick={() => void api.reveal(f.path).catch(() => undefined)}
                  className={cx("group relative cursor-pointer overflow-hidden rounded-lg border bg-canvas transition-colors transition-fast", selected.has(f.path) ? "border-primary" : "border-line hover:border-line-strong")}
                  title={f.name}
                >
                  <FileThumb path={f.path} name={f.name} className="aspect-[4/3] w-full border-b border-line" />
                  <div className="absolute left-2 top-2">
                    <Checkbox checked={selected.has(f.path)} onChange={(on) => toggle(f, on)} label={f.name} />
                  </div>
                  {f.copy && (
                    <div className="absolute right-2 top-2">
                      <Badge tone="warning">{t("downloads.copyBadge")}</Badge>
                    </div>
                  )}
                  <div className="px-2.5 py-2">
                    <div className="truncate text-[12px] text-ink">{f.name}</div>
                    <div className="num font-mono text-[11px] text-ink-muted">{fmt(f.bytes)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {list.length > shown && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => setShown(shown + PAGE)}>
                {t("duplicates.showMore")}
              </Button>
            </div>
          )}
          <SelectionBar count={chosen.length} bytes={chosenBytes} note={t(`method.${method}`)}>
            <Button
              size="sm"
              variant="primary"
              disabled={chosen.length === 0}
              onClick={() => {
                setMethod(settings?.filesDelete ?? "recycle");
                setConfirm(true);
              }}
            >
              {t(`method.${settings?.filesDelete ?? "recycle"}`)}
            </Button>
          </SelectionBar>
        </>
      )}
      <ConfirmClean open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void remove()} count={chosen.length} bytes={chosenBytes} method={method} onMethod={setMethod} busy={busy} files />
      <ReportDialog report={result} onClose={() => setResult(null)} />
    </div>
  );
}
