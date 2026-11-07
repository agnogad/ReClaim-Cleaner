import { AlertTriangle, Copy, FolderOpen, ScanSearch } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmClean, FolderList, PathText, ProgressPanel, ReportDialog, SelectionBar } from "../components/common";
import { useBytes, useLocale } from "../lib/hooks";
import { Banner, Button, Card, Checkbox, EmptyState, PageHeader, Select } from "../components/ui";
import { cx } from "../lib/cx";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { fullySelectedGroups, selectDuplicates } from "../lib/filetypes";
import type { CleanReport, DeleteMethod, DupGroup } from "../lib/types";
import { libraryRoots } from "../lib/roots";
import { errorText, useApp } from "../store/app";

export function DuplicatesPage() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const { info, settings, running, setRunning, toast, refreshDrives } = useApp();
  const [roots, setRoots] = useState<string[]>(() => libraryRoots(info?.libraries).slice(0, 3));
  const [minKb, setMinKb] = useState<number>(settings?.duplicateMinKb ?? 1024);
  const [groups, setGroups] = useState<DupGroup[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(100);
  const [confirm, setConfirm] = useState(false);
  const [method, setMethod] = useState<DeleteMethod>(settings?.filesDelete ?? "recycle");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CleanReport | null>(null);
  const progress = useApp((s) => s.progress.duplicates);
  const scanning = !!running.duplicates;

  const scan = async () => {
    setRunning("duplicates", true);
    try {
      const found = await api.duplicatesScan(roots, minKb * 1024);
      setGroups(found);
      setSelected(selectDuplicates(found, "newest"));
      setShown(100);
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setRunning("duplicates", false);
    }
  };

  const allFiles = (groups ?? []).flatMap((g) => g.files.map((f) => ({ ...f, bytes: g.bytes })));
  const chosen = allFiles.filter((f) => selected.has(f.path));
  const chosenBytes = chosen.reduce((s, f) => s + f.bytes, 0);
  const unsafe = fullySelectedGroups(groups ?? [], selected);
  const wasted = (groups ?? []).reduce((s, g) => s + g.wasted, 0);

  const remove = async () => {
    setBusy(true);
    try {
      const paths = chosen.map((f) => f.path);
      const r = await api.pathsClean("duplicates", paths, method);
      setConfirm(false);
      setReport(r);
      const failed = new Set(r.failures.map((f) => f.path));
      const gone = new Set(paths.filter((p) => !failed.has(p)));
      setGroups((prev) =>
        (prev ?? [])
          .map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.path)) }))
          .filter((g) => g.files.length > 1)
          .map((g) => ({ ...g, wasted: g.bytes * (g.files.length - 1) })),
      );
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
        title={t("duplicates.title")}
        subtitle={t("duplicates.subtitle")}
        actions={
          <Button variant={groups ? "secondary" : "primary"} icon={<ScanSearch size={16} strokeWidth={1.75} />} loading={scanning} disabled={roots.length === 0} onClick={() => void scan()}>
            {scanning ? t("common.scanning") : groups ? t("common.rescan") : t("common.scan")}
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="label mb-2">{t("common.roots")}</div>
            <FolderList folders={roots} onChange={setRoots} suggestions={libraryRoots(info?.libraries)} />
          </div>
          <div>
            <div className="label mb-2">{t("common.minSize")}</div>
            <Select
              label={t("common.minSize")}
              value={minKb}
              onChange={setMinKb}
              options={[100, 1024, 10 * 1024, 100 * 1024].map((v) => ({ value: v, label: `≥ ${fmt(v * 1024)}` }))}
            />
          </div>
        </div>
      </Card>
      {scanning ? (
        <ProgressPanel kind="duplicates" label={progress?.stage ? t(`duplicates.stages.${progress.stage}`, { defaultValue: t("common.scanning") }) : t("common.scanning")} />
      ) : !groups ? (
        <Card>
          <EmptyState icon={<Copy size={20} strokeWidth={1.75} />} title={t("duplicates.emptyTitle")} body={t("duplicates.emptyBody")} />
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState icon={<Copy size={20} strokeWidth={1.75} />} title={t("duplicates.none")} />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-[12px] text-ink-muted">
              {t("common.items", { count: groups.length })} · {t("duplicates.wasted", { size: fmt(wasted) })}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(selectDuplicates(groups, "newest"))}>
                {t("duplicates.keepNewest")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(selectDuplicates(groups, "oldest"))}>
                {t("duplicates.keepOldest")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(selectDuplicates(groups, "shortest"))}>
                {t("duplicates.keepShortest")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                {t("common.selectNone")}
              </Button>
            </div>
          </div>
          {unsafe.length > 0 && (
            <Banner tone="danger" icon={<AlertTriangle size={16} strokeWidth={1.75} />}>
              {t("duplicates.allSelectedWarning", { count: unsafe.length })}
            </Banner>
          )}
          <div className="space-y-3">
            {groups.slice(0, shown).map((g) => (
              <Card key={g.hash} className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2">
                  <span className="text-[13px] text-ink">{t("duplicates.groupTitle", { count: g.files.length, size: fmt(g.bytes) })}</span>
                  <span className="font-mono text-[12px] text-positive-fg">{t("duplicates.wasted", { size: fmt(g.wasted) })}</span>
                </div>
                <ul className="divide-y divide-line">
                  {g.files.map((f) => (
                    <li key={f.path} className={cx("flex items-center gap-3 px-4 py-2", selected.has(f.path) && "bg-primary-soft")}>
                      <Checkbox
                        checked={selected.has(f.path)}
                        onChange={(on) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (on) next.add(f.path);
                            else next.delete(f.path);
                            return next;
                          })
                        }
                        label={f.path}
                      />
                      <PathText path={f.path} className="flex-1 text-[13px] text-ink" />
                      <span className="shrink-0 font-mono text-[12px] text-ink-muted">{formatDate(f.mtime, locale)}</span>
                      <button type="button" title={t("common.reveal")} aria-label={t("common.reveal")} onClick={() => void api.reveal(f.path).catch(() => undefined)} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
                        <FolderOpen size={15} strokeWidth={1.75} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
          {groups.length > shown && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => setShown(shown + 100)}>
                {t("duplicates.showMore")}
              </Button>
            </div>
          )}
          <SelectionBar count={chosen.length} bytes={chosenBytes} note={t(`method.${method}`)}>
            <Button
              size="sm"
              variant="primary"
              disabled={chosen.length === 0 || unsafe.length > 0}
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
      <ReportDialog report={report} onClose={() => setReport(null)} />
    </div>
  );
}
