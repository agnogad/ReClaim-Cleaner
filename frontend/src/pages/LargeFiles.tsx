import { FileStack, FolderOpen, HardDrive, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmClean, PathText, ProgressPanel, ReportDialog, SelectionBar } from "../components/common";
import { LockDialog } from "../components/LockDialog";
import { useBytes, useFeature, useLocale } from "../lib/hooks";
import { FileIcon } from "../components/FileIcons";
import { Button, Card, Checkbox, EmptyState, PageHeader, Select } from "../components/ui";
import { cx } from "../lib/cx";
import { api } from "../lib/api";
import { daysSince, formatDate } from "../lib/format";
import { driveLabel, parentPath, pathKey } from "../lib/paths";
import { FILE_KINDS, fileKind, type FileKind } from "../lib/filetypes";
import type { CleanReport, DeleteMethod, FileView, InstallerFile } from "../lib/types";
import { errorText, useApp } from "../store/app";

const MB = 1024 * 1024;

export function LargeFilesPage() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const { drives, explorer, explorerVersion, running, scanExplorer, settings, installers, scanInstallers, toast, bumpExplorer, refreshDrives } = useApp();
  const [minMb, setMinMb] = useState<number>(settings?.largeMinMb ?? 100);
  const [kinds, setKinds] = useState<Set<FileKind>>(new Set());
  const [age, setAge] = useState<number>(0);
  const [files, setFiles] = useState<FileView[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [method, setMethod] = useState<DeleteMethod>(settings?.filesDelete ?? "recycle");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [lockPath, setLockPath] = useState<string | null>(null);
  const sys = drives.find((d) => d.system) ?? drives[0];
  const locks = useFeature("locks");

  useEffect(() => {
    if (!explorer) return;
    void api.explorerLarge(minMb * MB, 1500).then(setFiles).catch(() => setFiles([]));
  }, [explorer, explorerVersion, minMb]);

  useEffect(() => {
    if (installers === null) void scanInstallers();
  }, [installers, scanInstallers]);

  // Old installers live outside the scanned root sometimes; merge them so the list is complete.
  const merged: FileView[] = useMemo(() => {
    const seen = new Set(files.map((f) => pathKey(f.path)));
    const extra = (installers ?? [])
      .filter((i: InstallerFile) => i.bytes >= minMb * MB && !seen.has(pathKey(i.path)))
      .map((i, n) => ({ id: -1 - n, name: i.name, path: i.path, bytes: i.bytes, mtime: i.mtime, category: "other" as const }));
    return [...files, ...extra].sort((a, b) => b.bytes - a.bytes);
  }, [files, installers, minMb]);

  const list = merged.filter((f) => (kinds.size === 0 || kinds.has(fileKind(f.name))) && (age === 0 || daysSince(f.mtime) >= age));
  const chosen = list.filter((f) => selected.has(f.path));
  const chosenBytes = chosen.reduce((s, f) => s + f.bytes, 0);
  const counts = useMemo(() => {
    const m = new Map<FileKind, number>();
    for (const f of merged) m.set(fileKind(f.name), (m.get(fileKind(f.name)) ?? 0) + 1);
    return m;
  }, [merged]);

  const toggle = (path: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });

  const remove = async () => {
    setBusy(true);
    try {
      const r = await api.pathsClean(
        "large",
        chosen.map((f) => f.path),
        method,
      );
      setConfirm(false);
      setReport(r);
      setSelected(new Set());
      bumpExplorer();
      void scanInstallers();
      void refreshDrives();
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("large.title")} subtitle={t("large.subtitle")} meta={explorer ? <span className="selectable font-mono">{t("large.from", { root: explorer.root })}</span> : null} />
      {running.explorer ? (
        <ProgressPanel kind="explorer" />
      ) : !explorer ? (
        <Card>
          <EmptyState
            icon={<FileStack size={20} strokeWidth={1.75} />}
            title={t("large.needsScan")}
            action={drives.map((d) => (
              <Button key={d.root} variant={d.system ? "primary" : "secondary"} icon={<HardDrive size={16} strokeWidth={1.75} />} onClick={() => void scanExplorer(d.root)}>
                {t("large.scanDrive", { drive: driveLabel(d.root) })}
              </Button>
            ))}
          />
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Select
                label={t("common.minSize")}
                value={minMb}
                onChange={setMinMb}
                options={[10, 50, 100, 250, 500, 1024, 4096].map((v) => ({ value: v, label: `≥ ${fmt(v * MB)}` }))}
              />
              <Select
                label={t("common.age")}
                value={age}
                onChange={setAge}
                options={[
                  { value: 0, label: t("large.ageAny") },
                  { value: 180, label: t("large.age6m") },
                  { value: 365, label: t("large.age1y") },
                ]}
              />
              <div className="flex flex-wrap gap-1.5">
                {FILE_KINDS.filter((k) => counts.get(k)).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kinds.has(k)}
                    onClick={() =>
                      setKinds((prev) => {
                        const next = new Set(prev);
                        if (next.has(k)) next.delete(k);
                        else next.add(k);
                        return next;
                      })
                    }
                    className={cx(
                      "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors transition-fast",
                      kinds.has(k) ? "border-primary bg-primary-soft text-ink" : "border-line text-ink-secondary hover:border-line-strong hover:text-ink",
                    )}
                  >
                    {t(`large.kinds.${k}`)}
                    <span className="num font-mono text-[11px] text-ink-muted">{counts.get(k)}</span>
                  </button>
                ))}
              </div>
            </div>
          </Card>
          {list.length === 0 ? (
            <Card>
              <EmptyState icon={<FileStack size={20} strokeWidth={1.75} />} title={t("large.none")} />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full table-fixed text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-surface text-left">
                    <th className="w-10 px-4 py-2">
                      <Checkbox
                        checked={chosen.length > 0 && chosen.length === list.length}
                        indeterminate={chosen.length > 0 && chosen.length < list.length}
                        onChange={(on) => setSelected(on ? new Set(list.map((f) => f.path)) : new Set())}
                        label={t("common.selectAll")}
                      />
                    </th>
                    <th className="label px-2 py-2 font-normal">{t("common.name")}</th>
                    <th className="label w-[110px] px-2 py-2 font-normal">{t("common.type")}</th>
                    <th className="label w-[120px] px-2 py-2 font-normal">{t("common.modified")}</th>
                    <th className="label w-[100px] px-2 py-2 text-right font-normal">{t("common.size")}</th>
                    <th className="w-[76px] px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.slice(0, 500).map((f) => (
                    <tr key={f.path} className={cx("hover:bg-surface", selected.has(f.path) && "bg-primary-soft")}>
                      <td className="px-4 py-2">
                        <Checkbox checked={selected.has(f.path)} onChange={(v) => toggle(f.path, v)} label={f.name} />
                      </td>
                      <td className="min-w-0 px-2 py-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <FileIcon path={f.path} name={f.name} size={22} />
                          <div className="min-w-0">
                            <div className="truncate text-ink" title={f.name}>
                              {f.name}
                            </div>
                            <PathText path={parentPath(f.path)} />
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-ink-secondary">{t(`large.kinds.${fileKind(f.name)}`)}</td>
                      <td className="px-2 py-2 font-mono text-[12px] text-ink-secondary">{formatDate(f.mtime, locale)}</td>
                      <td className="num px-2 py-2 text-right font-mono text-ink">{fmt(f.bytes)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        {locks && (
                          <button type="button" title={t("locks.button")} aria-label={t("locks.button")} onClick={() => setLockPath(f.path)} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
                            <Lock size={15} strokeWidth={1.75} />
                          </button>
                        )}
                        <button type="button" title={t("common.reveal")} aria-label={t("common.reveal")} onClick={() => void api.reveal(f.path).catch(() => undefined)} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
                          <FolderOpen size={15} strokeWidth={1.75} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
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
          {sys && <span className="sr-only">{sys.root}</span>}
        </>
      )}
      <ConfirmClean open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void remove()} count={chosen.length} bytes={chosenBytes} method={method} onMethod={setMethod} busy={busy} files />
      <ReportDialog report={report} onClose={() => setReport(null)} />
      <LockDialog path={lockPath} onClose={() => setLockPath(null)} />
    </div>
  );
}
