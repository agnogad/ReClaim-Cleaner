import { ArrowUp, ClipboardCopy, ExternalLink, FolderOpen, FolderSearch, Home, Lock, Map as MapIcon, ScanSearch, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmClean, PathText, ProgressPanel, ReportDialog } from "../components/common";
import { HiddenSpacePanel } from "../components/HiddenSpace";
import { LockDialog } from "../components/LockDialog";
import { useBytes, useFeature, useLocale } from "../lib/hooks";
import { Treemap, type TreemapMode } from "../components/Treemap";
import { Badge, Banner, Button, Card, EmptyState, PageHeader, Segmented } from "../components/ui";
import { cx } from "../lib/cx";
import { api, pickFolders } from "../lib/api";
import { formatCount, formatDate, formatPercent } from "../lib/format";
import { driveLabel, isDriveRoot, samePath } from "../lib/paths";
import type { CleanReport, Category, Crumb, DeleteMethod, ExtStat, NodeView } from "../lib/types";
import { errorText, useApp } from "../store/app";

const CATEGORIES: Category[] = ["projects", "media", "caches", "apps", "ai", "system", "other"];

function Legend({ mode }: { mode: TreemapMode }) {
  const { t } = useTranslation();
  if (mode === "cleanup") {
    return (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-ink-secondary">
        <span className="flex items-center gap-2">
          <span className="hatch-safe inline-block h-3 w-5 rounded-[3px]" />
          {t("explorer.legendSafe")}
        </span>
        <span className="flex items-center gap-2">
          <span className="hatch-review inline-block h-3 w-5 rounded-[3px]" />
          {t("explorer.legendReview")}
        </span>
        <span className="flex items-center gap-2">
          <span className="tile-neutral inline-block h-3 w-5 rounded-[3px]" />
          {t("explorer.legendOther")}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-ink-secondary">
      {CATEGORIES.map((c) => (
        <span key={c} className={cx("flex items-center gap-2", `cat-${c}`)}>
          <span className="cat-dot" />
          {t(`categories.${c}`)}
        </span>
      ))}
    </div>
  );
}

function TypesTable() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const version = useApp((s) => s.explorerVersion);
  const [rows, setRows] = useState<ExtStat[]>([]);
  useEffect(() => {
    void api.explorerExtensions(60).then(setRows).catch(() => setRows([]));
  }, [version]);
  const total = rows.reduce((s, r) => s + r.bytes, 0) || 1;
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="border-b border-line text-left">
          <th className="label px-4 py-2 font-normal">{t("explorer.extension")}</th>
          <th className="label px-4 py-2 text-right font-normal">{t("common.files")}</th>
          <th className="label w-[40%] px-4 py-2 font-normal">{t("explorer.share")}</th>
          <th className="label px-4 py-2 text-right font-normal">{t("common.size")}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r) => (
          <tr key={r.ext} className="hover:bg-surface">
            <td className="px-4 py-2 font-mono text-ink">{r.ext ? `.${r.ext}` : t("explorer.noExtension")}</td>
            <td className="num px-4 py-2 text-right font-mono text-ink-secondary">{formatCount(r.files, locale)}</td>
            <td className="px-4 py-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(r.bytes / total) * 100}%` }} />
              </div>
            </td>
            <td className="num px-4 py-2 text-right font-mono text-ink">{fmt(r.bytes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ExplorerPage() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const { info, drives, explorer, explorerVersion, running, scanExplorer, settings, toast, bumpExplorer, refreshDrives } = useApp();
  const [current, setCurrent] = useState(0);
  const [node, setNode] = useState<NodeView | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [selected, setSelected] = useState<NodeView | null>(null);
  const [mode, setMode] = useState<TreemapMode>("category");
  const [tab, setTab] = useState<"map" | "types">("map");
  const [confirm, setConfirm] = useState(false);
  const [lockPath, setLockPath] = useState<string | null>(null);
  const [method, setMethod] = useState<DeleteMethod>(settings?.filesDelete ?? "recycle");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CleanReport | null>(null);
  const locks = useFeature("locks");
  const hiddenSpace = useFeature("hiddenSpace");

  useEffect(() => {
    if (!explorer) return;
    let alive = true;
    void Promise.all([api.explorerNode(current, 3, 40), api.explorerAncestors(current)]).then(([n, c]) => {
      if (!alive) return;
      if (!n && current !== 0) {
        setCurrent(0);
        return;
      }
      setNode(n);
      setCrumbs(c);
    });
    return () => {
      alive = false;
    };
  }, [explorer, explorerVersion, current]);

  // A new scan starts at the root again (state adjusted during render, not in an effect).
  const scanKey = explorer ? `${explorer.root}|${explorer.scannedAt}` : "";
  const [seenScan, setSeenScan] = useState(scanKey);
  if (scanKey !== seenScan) {
    setSeenScan(scanKey);
    setCurrent(0);
    setSelected(null);
  }

  const roots = [{ value: "home", label: t("explorer.home"), path: info?.userProfile ?? "" }, ...drives.map((d) => ({ value: d.root, label: driveLabel(d.root), path: d.root }))];
  // The selected location follows the last scan, which may also come from Explorer's menu.
  const location = explorer && explorer.selection.length === 0 ? (roots.find((r) => r.path && samePath(r.path, explorer.root))?.value ?? "custom") : "custom";
  const scan = (path: string) => {
    setSelected(null);
    void scanExplorer(path);
  };
  const choose = async () => {
    const [p] = await pickFolders(false);
    if (p) scan(p);
  };

  const whole = !!explorer && explorer.selection.length === 0;
  const drive = explorer && whole ? drives.find((d) => samePath(explorer.root, d.root)) : undefined;
  const notScanned = drive ? Math.max(0, drive.total - drive.free - explorer!.bytes) : 0;
  const detail = selected ?? node;

  const remove = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const r = await api.pathsClean("explorer", [detail.path], method);
      setConfirm(false);
      setReport(r);
      setSelected(null);
      bumpExplorer();
      void refreshDrives();
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("explorer.title")}
        subtitle={t("explorer.subtitle")}
        actions={
          <>
            <Segmented
              value={location}
              onChange={(v) => {
                const r = roots.find((x) => x.value === v);
                if (r?.path) scan(r.path);
              }}
              options={roots.map((r) => ({ value: r.value, label: r.value === "home" ? <><Home size={14} strokeWidth={1.75} />{r.label}</> : r.label }))}
            />
            <Button icon={<FolderSearch size={16} strokeWidth={1.75} />} onClick={() => void choose()} disabled={running.explorer}>
              {t("explorer.chooseFolder")}
            </Button>
          </>
        }
        meta={
          explorer && !running.explorer ? (
            <>
              <span className="selectable font-mono">{whole ? explorer.root : t("explorer.selection", { count: explorer.selection.length, parent: explorer.root })}</span>
              <span>·</span>
              <span className="num font-mono">{fmt(explorer.bytes)}</span>
              <span>·</span>
              <span className="num font-mono">{t("explorer.scannedIn", { files: formatCount(explorer.files, locale), seconds: (explorer.millis / 1000).toFixed(1) })}</span>
              {notScanned > 0 && (
                <>
                  <span>·</span>
                  <span title={t("explorer.notScannedHint")}>
                    {t("explorer.notScanned")}: <span className="num font-mono">{fmt(notScanned)}</span>
                  </span>
                </>
              )}
              <Button size="sm" variant="ghost" icon={<ScanSearch size={14} strokeWidth={1.75} />} onClick={() => scan(explorer.root)}>
                {t("common.rescan")}
              </Button>
            </>
          ) : null
        }
      />

      {running.explorer ? (
        <ProgressPanel kind="explorer" label={t("common.scanning")} />
      ) : !explorer || !node ? (
        <Card>
          <EmptyState
            icon={<MapIcon size={20} strokeWidth={1.75} />}
            title={t("explorer.emptyTitle")}
            body={t("explorer.emptyBody")}
            action={roots.map((r) => (
              <Button key={r.value} variant={r.value === "home" ? "primary" : "secondary"} onClick={() => r.path && scan(r.path)}>
                {r.label}
              </Button>
            ))}
          />
        </Card>
      ) : (
        <>
          {explorer.denied > 0 && !info?.elevated && <Banner tone="neutral">{t("explorer.denied")}</Banner>}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Card className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
                  <Button size="icon" variant="ghost" aria-label={t("common.up")} title={t("common.up")} disabled={crumbs.length < 2} onClick={() => setCurrent(crumbs[crumbs.length - 2]?.id ?? 0)}>
                    <ArrowUp size={16} strokeWidth={1.75} />
                  </Button>
                  {crumbs.map((c, i) => (
                    <span key={c.id} className="flex min-w-0 items-center gap-1">
                      {i > 0 && <span className="text-ink-muted">/</span>}
                      <button
                        type="button"
                        onClick={() => {
                          setCurrent(c.id);
                          setSelected(null);
                        }}
                        className={cx("truncate rounded px-1 font-mono", i === crumbs.length - 1 ? "text-ink" : "text-ink-secondary hover:text-ink")}
                      >
                        {c.name}
                      </button>
                    </span>
                  ))}
                </nav>
                <div className="flex items-center gap-2">
                  <Segmented
                    size="sm"
                    value={tab}
                    onChange={setTab}
                    options={[
                      { value: "map", label: t("explorer.tabMap") },
                      { value: "types", label: t("explorer.tabTypes") },
                    ]}
                  />
                  {tab === "map" && (
                    <Segmented
                      size="sm"
                      value={mode}
                      onChange={setMode}
                      options={[
                        { value: "category", label: t("explorer.viewCategory") },
                        { value: "cleanup", label: t("explorer.viewCleanup") },
                      ]}
                    />
                  )}
                </div>
              </div>
              {tab === "map" ? (
                <div className="p-3">
                  <Treemap
                    key={node.id}
                    node={node}
                    mode={mode}
                    selectedId={selected?.id ?? null}
                    onOpen={(id) => {
                      setCurrent(id);
                      setSelected(null);
                    }}
                    onSelect={setSelected}
                  />
                  <div className="mt-3 border-t border-line pt-3">
                    <Legend mode={mode} />
                  </div>
                </div>
              ) : (
                <div className="max-h-[640px] overflow-y-auto">
                  <TypesTable />
                </div>
              )}
            </Card>

            <div className="space-y-5">
              {detail && (
                <Card ticks>
                  <div className="px-4 py-3">
                    <div className="label mb-1">{detail.kind === "dir" ? t("common.folders") : t("common.files")}</div>
                    <div className="truncate text-[16px] font-medium text-ink" title={detail.name}>
                      {detail.kind === "small" ? t("explorer.smallFiles") : detail.name || detail.path}
                    </div>
                    <PathText path={detail.path} className="mt-0.5" />
                    {detail.mount ? (
                      <div className="mt-3">
                        <Badge>{t(`explorer.mounts.${detail.mount}`)}</Badge>
                        <p className="mt-2 text-[13px] text-ink-secondary">{t(`explorer.mountHints.${detail.mount}`)}</p>
                      </div>
                    ) : (
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <div>
                          <div className="label">{t("common.size")}</div>
                          <div className="num font-mono text-[18px] text-ink">{fmt(detail.bytes)}</div>
                        </div>
                        <div>
                          <div className="label">{t("common.files")}</div>
                          <div className="num font-mono text-[18px] text-ink">{formatCount(detail.files, locale)}</div>
                        </div>
                        {detail.reclaimSafe + detail.reclaimReview > 0 && (
                          <div className="col-span-2">
                            <div className="label">{t("explorer.reclaimable")}</div>
                            <div className="num font-mono text-[14px] text-positive-fg">{fmt(detail.reclaimSafe + detail.reclaimReview)}</div>
                          </div>
                        )}
                        {detail.mtime > 0 && (
                          <div className="col-span-2">
                            <div className="label">{t("common.modified")}</div>
                            <div className="font-mono text-[13px] text-ink-secondary">{formatDate(detail.mtime, locale)}</div>
                          </div>
                        )}
                      </div>
                    )}
                    {detail.unreadableName && <p className="mt-3 text-[13px] text-ink-secondary">{t("explorer.unreadableName")}</p>}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {detail.kind !== "small" && !detail.unreadableName && (
                        <>
                          <Button size="sm" icon={<FolderOpen size={14} strokeWidth={1.75} />} onClick={() => void api.reveal(detail.path).catch((e) => toast("danger", errorText(e)))}>
                            {t("common.reveal")}
                          </Button>
                          {/* On a whole drive every running program would match, which says nothing. */}
                          {locks && !isDriveRoot(detail.path, drives.map((d) => d.root)) && (
                            <Button size="sm" variant="ghost" icon={<Lock size={14} strokeWidth={1.75} />} onClick={() => setLockPath(detail.path)}>
                              {t("locks.button")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<ClipboardCopy size={14} strokeWidth={1.75} />}
                            onClick={() => void navigator.clipboard.writeText(detail.path).then(() => toast("positive", t("common.copied")))}
                          >
                            {t("common.copyPath")}
                          </Button>
                          {detail.id !== 0 && !detail.mount && (
                            <Button
                              size="sm"
                              variant="danger"
                              icon={<Trash2 size={14} strokeWidth={1.75} />}
                              onClick={() => {
                                setMethod(settings?.filesDelete ?? "recycle");
                                setConfirm(true);
                              }}
                            >
                              {t("explorer.deleteItem")}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              )}
              <Card>
                <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                  <span className="label">{t("explorer.contents")}</span>
                  <span className="num font-mono text-[12px] text-ink-muted">{fmt(node.bytes)}</span>
                </div>
                <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
                  {node.children.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => (c.kind === "dir" && c.childCount > 0 ? setCurrent(c.id) : setSelected(c))}
                        onMouseEnter={() => undefined}
                        className={cx("rail flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface", selected?.id === c.id && "rail-active bg-surface", `cat-${c.category}`)}
                      >
                        <span className="cat-dot" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink">{c.kind === "small" ? `${t("explorer.smallFiles")} · ${formatCount(c.files, locale)}` : c.name}</span>
                          {c.mount ? (
                            <span className="mt-1 block truncate text-[11px] text-ink-muted">{t(`explorer.mounts.${c.mount}`)}</span>
                          ) : (
                            <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-surface-muted">
                              <span className="block h-full rounded-full" style={{ width: `${(c.bytes / (node.bytes || 1)) * 100}%`, background: "var(--cat)" }} />
                            </span>
                          )}
                        </span>
                        <span className="w-[72px] shrink-0 text-right">
                          {c.mount ? (
                            <span className="num block font-mono text-[12px] text-ink-muted">—</span>
                          ) : (
                            <>
                              <span className="num block font-mono text-[12px] text-ink">{fmt(c.bytes)}</span>
                              <span className="num block font-mono text-[11px] text-ink-muted">{formatPercent(c.bytes, node.bytes, locale)}</span>
                            </>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                  {node.restCount > 0 && (
                    <li className="flex items-center justify-between px-4 py-2 text-[12px] text-ink-muted">
                      <span>{t("explorer.moreItems", { count: node.restCount })}</span>
                      <span className="num font-mono">{fmt(node.restBytes)}</span>
                    </li>
                  )}
                </ul>
              </Card>
              {!node.unreadableName && (
                <Button size="sm" variant="ghost" icon={<ExternalLink size={14} strokeWidth={1.75} />} onClick={() => void api.open(node.path).catch((e) => toast("danger", errorText(e)))}>
                  {t("explorer.openFolder")}
                </Button>
              )}
            </div>
          </div>
          {drive && hiddenSpace && <HiddenSpacePanel root={drive.root} />}
        </>
      )}
      <ConfirmClean open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void remove()} count={1} bytes={detail?.bytes ?? 0} method={method} onMethod={setMethod} busy={busy} files>
        {detail && <PathText path={detail.path} className="mt-3" />}
      </ConfirmClean>
      <ReportDialog report={report} onClose={() => setReport(null)} />
      <LockDialog path={lockPath} onClose={() => setLockPath(null)} />
    </div>
  );
}
