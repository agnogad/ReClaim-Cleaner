import { FolderOpen, Gamepad2, HardDrive, ScanSearch } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmClean, PathText, ProgressPanel, ReportDialog, SelectionBar } from "../components/common";
import { Badge, Banner, Button, Card, CardHeader, Checkbox, EmptyState, PageHeader, RiskBadge, Stat } from "../components/ui";
import { api } from "../lib/api";
import { cx } from "../lib/cx";
import { splitBytes } from "../lib/format";
import { useBytes, useLocale } from "../lib/hooks";
import type { CleanReport, DeleteMethod, ShaderCache, SteamReport } from "../lib/types";
import { errorText, useApp } from "../store/app";

/** Caches of removed games are preselected; installed games' caches are left for the user. */
function safeSelection(r: SteamReport): Set<string> {
  return new Set(r.caches.filter((c) => !c.installed).map((c) => c.appId));
}

export function GamesPage() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const { settings, running, setRunning, toast, refreshDrives } = useApp();
  const [report, setReport] = useState<SteamReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [method, setMethod] = useState<DeleteMethod>(settings?.cacheDelete ?? "permanent");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CleanReport | null>(null);
  const scanning = !!running.steam;

  const scan = async () => {
    setRunning("steam", true);
    try {
      const r = await api.steamReport();
      setReport(r);
      setSelected(safeSelection(r));
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setRunning("steam", false);
    }
  };

  const caches = report?.caches ?? [];
  // One app id can have a cache in more than one library; selection and deletion go by id.
  const chosen = caches.filter((c) => selected.has(c.appId));
  const chosenBytes = chosen.reduce((s, c) => s + c.bytes, 0);
  const chosenIds = [...new Set(chosen.map((c) => c.appId))];
  const cacheBytes = caches.reduce((s, c) => s + c.bytes, 0);
  const orphanBytes = caches.filter((c) => !c.installed).reduce((s, c) => s + c.bytes, 0);
  const games = report?.libraries.reduce((s, l) => s + l.games.length, 0) ?? 0;
  const gameBytes = report?.libraries.reduce((s, l) => s + l.bytes, 0) ?? 0;

  const toggle = (c: ShaderCache, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(c.appId);
      else next.delete(c.appId);
      return next;
    });

  const remove = async () => {
    setBusy(true);
    try {
      const r = await api.steamClean(chosenIds, method);
      setConfirm(false);
      setResult(r);
      await scan();
      void refreshDrives();
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const gamesSplit = splitBytes(gameBytes, locale);
  const cacheSplit = splitBytes(cacheBytes, locale);
  const orphanSplit = splitBytes(orphanBytes, locale);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("games.title")}
        subtitle={t("games.subtitle")}
        actions={
          <Button variant={report ? "secondary" : "primary"} icon={<ScanSearch size={16} strokeWidth={1.75} />} loading={scanning} onClick={() => void scan()}>
            {scanning ? t("common.scanning") : report ? t("common.rescan") : t("games.find")}
          </Button>
        }
      />
      {scanning ? (
        <ProgressPanel kind="steam" />
      ) : !report ? (
        <Card>
          <EmptyState
            icon={<Gamepad2 size={20} strokeWidth={1.75} />}
            title={t("games.emptyTitle")}
            body={t("games.emptyBody")}
            action={
              <Button variant="primary" icon={<ScanSearch size={16} strokeWidth={1.75} />} onClick={() => void scan()}>
                {t("games.find")}
              </Button>
            }
          />
        </Card>
      ) : !report.root ? (
        <Card>
          <EmptyState icon={<Gamepad2 size={20} strokeWidth={1.75} />} title={t("games.notInstalled")} />
        </Card>
      ) : (
        <>
          <div className="module-grid ticks grid-cols-1 sm:grid-cols-3">
            <Stat label={t("games.totalGames")} value={gamesSplit.value} unit={gamesSplit.unit} sub={t("games.games", { count: games })} />
            <Stat label={t("games.totalCaches")} value={cacheSplit.value} unit={cacheSplit.unit} sub={t("common.items", { count: caches.length })} />
            <Stat label={t("games.removedGames")} value={orphanSplit.value} unit={orphanSplit.unit} sub={t("common.items", { count: caches.filter((c) => !c.installed).length })} />
          </div>

          <Card>
            <CardHeader title={t("games.libraries")} />
            <ul className="divide-y divide-line">
              {report.libraries.map((l) => (
                <li key={l.path} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <HardDrive size={16} strokeWidth={1.75} className="shrink-0 text-ink-muted" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <PathText path={l.path} className="text-[13px] text-ink" />
                    <div className="truncate text-[12px] text-ink-muted" title={l.games.map((g) => g.name).join(", ")}>
                      {l.games.length > 0 ? l.games.slice(0, 4).map((g) => g.name).join(" · ") + (l.games.length > 4 ? " …" : "") : t("games.noGames")}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="num font-mono text-[13px] text-ink">{fmt(l.bytes)}</div>
                    <div className="num font-mono text-[11px] text-ink-muted">
                      {t("games.games", { count: l.games.length })}
                      {l.free !== null ? ` · ${t("games.free", { size: fmt(l.free) })}` : ""}
                    </div>
                  </div>
                  <button type="button" title={t("common.reveal")} aria-label={t("common.reveal")} onClick={() => void api.open(l.path).catch(() => undefined)} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
                    <FolderOpen size={15} strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {report.running && <Banner tone="warning">{t("games.steamRunning")}</Banner>}

          <Card className="overflow-hidden">
            <CardHeader title={t("games.shaderCaches")} hint={t("games.shaderHint")} />
            {caches.length === 0 ? (
              <EmptyState icon={<Gamepad2 size={20} strokeWidth={1.75} />} title={t("games.noCaches")} />
            ) : (
              <ul className="divide-y divide-line">
                {caches.map((c) => (
                  <li key={c.path} className={cx("rail flex items-center gap-3 px-4 py-2.5 hover:bg-surface", selected.has(c.appId) && "bg-primary-soft")}>
                    <Checkbox checked={selected.has(c.appId)} onChange={(on) => toggle(c, on)} label={c.name ?? t("games.unknownGame", { id: c.appId })} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[14px] font-medium text-ink">{c.name ?? t("games.unknownGame", { id: c.appId })}</span>
                        <RiskBadge risk={c.risk} />
                        <Badge tone={c.installed ? "neutral" : "warning"}>{c.installed ? t("games.installed") : t("games.notInstalledGame")}</Badge>
                      </div>
                      <PathText path={c.path} />
                    </div>
                    <span className="num w-[84px] shrink-0 text-right font-mono text-[14px] text-ink">{fmt(c.bytes)}</span>
                    <button type="button" title={t("common.reveal")} aria-label={t("common.reveal")} onClick={() => void api.reveal(c.path).catch(() => undefined)} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
                      <FolderOpen size={15} strokeWidth={1.75} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <SelectionBar count={chosen.length} bytes={chosenBytes} note={t(`method.${method}`)}>
            <Button size="sm" variant="ghost" onClick={() => setSelected(safeSelection(report))}>
              {t("common.selectSafe")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={chosen.length === 0 || report.running}
              onClick={() => {
                setMethod(settings?.cacheDelete ?? "permanent");
                setConfirm(true);
              }}
            >
              {t("games.deleteSelected")}
            </Button>
          </SelectionBar>
        </>
      )}
      <ConfirmClean open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void remove()} count={chosen.length} bytes={chosenBytes} method={method} onMethod={setMethod} hasReview={chosen.some((c) => c.installed)} busy={busy} />
      <ReportDialog report={result} onClose={() => setResult(null)} />
    </div>
  );
}
