import { Code2, FolderOpen, GitBranch, ScanSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmClean, FolderList, PathText, ProgressPanel, ReportDialog, SelectionBar } from "../components/common";
import { useBytes, useLocale } from "../lib/hooks";
import { Badge, Button, Card, Checkbox, EmptyState, PageHeader, RiskBadge, Select } from "../components/ui";
import { cx } from "../lib/cx";
import { api } from "../lib/api";
import { daysSince, formatAgo } from "../lib/format";
import { idleProjects, safeArtifactPaths } from "../lib/recommend";
import type { CleanReport, DeleteMethod, Project } from "../lib/types";
import { effectiveRoots, errorText, useApp } from "../store/app";

export function ProjectsPage() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const { info, settings, projects, running, scanProjects, saveSettings, toast, refreshDrives } = useApp();
  const roots = effectiveRoots(settings, info);
  // Every project is listed and selected by default; "Select idle" narrows it to the idle ones.
  const [idle, setIdle] = useState<number>(0);
  const [manual, setManual] = useState<{ for: Project[] | null; set: Set<string> } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [method, setMethod] = useState<DeleteMethod>(settings?.cacheDelete ?? "permanent");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CleanReport | null>(null);
  const scanning = !!running.projects;

  const list: Project[] = useMemo(() => (projects ?? []).filter((p) => idle === 0 || daysSince(p.lastActivity) >= idle), [projects, idle]);

  const allSafe = useMemo(() => safeArtifactPaths(projects ?? []), [projects]);
  // A manual selection only applies to the scan it was made on.
  const selected = manual && manual.for === projects ? manual.set : allSafe;
  const setSelected = (next: Set<string> | ((prev: Set<string>) => Set<string>)) =>
    setManual({ for: projects, set: typeof next === "function" ? next(selected) : next });
  const selectIdle = () => setSelected(safeArtifactPaths(idleProjects(projects ?? [], settings?.idleDays ?? 30)));

  const all = list.flatMap((p) => p.artifacts);
  const chosen = all.filter((a) => selected.has(a.path));
  const chosenBytes = chosen.reduce((s, a) => s + a.bytes, 0);

  const toggle = (path: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });

  const clean = async () => {
    setBusy(true);
    try {
      const r = await api.pathsClean(
        "projects",
        chosen.map((a) => a.path),
        method,
      );
      setConfirm(false);
      setReport(r);
      setSelected(new Set());
      useApp.setState({
        projects: (projects ?? [])
          .map((p) => ({ ...p, artifacts: p.artifacts.filter((a) => !selected.has(a.path) || r.failures.some((f) => f.path === a.path)) }))
          .map((p) => ({ ...p, bytes: p.artifacts.reduce((s, a) => s + a.bytes, 0) }))
          .filter((p) => p.artifacts.length > 0),
      });
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
        title={t("projects.title")}
        subtitle={t("projects.subtitle")}
        actions={
          <Button variant={projects ? "secondary" : "primary"} icon={<ScanSearch size={16} strokeWidth={1.75} />} loading={scanning} disabled={roots.length === 0} onClick={() => void scanProjects(roots)}>
            {scanning ? t("common.scanning") : projects ? t("common.rescan") : t("common.scan")}
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="label mb-2">{t("common.roots")}</div>
            <FolderList folders={settings?.projectRoots ?? []} onChange={(f) => void saveSettings({ projectRoots: f })} suggestions={info?.suggestedRoots ?? []} />
          </div>
          <div>
            <div className="label mb-2">{t("projects.idle")}</div>
            <Select
              label={t("projects.idle")}
              value={idle}
              onChange={setIdle}
              options={[
                { value: 0, label: t("projects.idleAny") },
                { value: 7, label: t("common.olderThan", { days: 7 }) },
                { value: 30, label: t("common.olderThan", { days: 30 }) },
                { value: 90, label: t("common.olderThan", { days: 90 }) },
                { value: 180, label: t("common.olderThan", { days: 180 }) },
              ]}
            />
          </div>
        </div>
      </Card>

      {scanning ? (
        <ProgressPanel kind="projects" />
      ) : !projects ? (
        <Card>
          <EmptyState
            icon={<Code2 size={20} strokeWidth={1.75} />}
            title={t("projects.emptyTitle")}
            body={roots.length === 0 ? t("common.noRoots") : t("projects.emptyBody")}
            action={
              roots.length > 0 && (
                <Button variant="primary" size="lg" icon={<ScanSearch size={18} strokeWidth={1.75} />} onClick={() => void scanProjects(roots)}>
                  {t("common.scan")}
                </Button>
              )
            }
          />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={<Code2 size={20} strokeWidth={1.75} />} title={t("projects.none")} />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-[12px] text-ink-muted">
              {t("projects.projectsCount", { count: list.length })} · {fmt(list.reduce((s, p) => s + p.bytes, 0))} · {t("projects.restoreHint")}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={selectIdle}>
                {t("projects.selectIdle")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(all.map((a) => a.path)))}>
                {t("common.selectAll")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                {t("common.selectNone")}
              </Button>
            </div>
          </div>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {list.map((p) => {
                const days = daysSince(p.lastActivity);
                const sel = p.artifacts.filter((a) => selected.has(a.path));
                return (
                  <li key={p.path} className="rail px-4 py-3 hover:bg-surface">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={sel.length === p.artifacts.length}
                        indeterminate={sel.length > 0 && sel.length < p.artifacts.length}
                        onChange={(on) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            for (const a of p.artifacts) {
                              if (on) next.add(a.path);
                              else next.delete(a.path);
                            }
                            return next;
                          })
                        }
                        label={p.name}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-medium text-ink">{p.name}</span>
                          {p.hasGit && (
                            <Badge>
                              <GitBranch size={11} strokeWidth={1.75} />
                              {t("projects.git")}
                            </Badge>
                          )}
                          <span className={cx("font-mono text-[11px]", days >= (settings?.idleDays ?? 30) ? "text-ink-muted" : "text-positive-fg")}>{t("projects.lastActivity", { when: formatAgo(p.lastActivity, locale) })}</span>
                        </div>
                        <PathText path={p.path} />
                      </div>
                      <span className="num shrink-0 font-mono text-[14px] text-ink">{fmt(p.bytes)}</span>
                      <button type="button" title={t("common.reveal")} aria-label={t("common.reveal")} onClick={() => void api.open(p.path).catch(() => undefined)} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
                        <FolderOpen size={15} strokeWidth={1.75} />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 pl-[30px]">
                      {p.artifacts.map((a) => (
                        <label
                          key={a.path}
                          className={cx(
                            "inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2.5 text-[12px] transition-colors transition-fast",
                            selected.has(a.path) ? "border-primary bg-primary-soft" : "border-line bg-canvas hover:border-line-strong",
                          )}
                        >
                          <Checkbox checked={selected.has(a.path)} onChange={(v) => toggle(a.path, v)} label={a.dirName} className="h-4 w-4" />
                          <span className="font-mono text-ink">{a.dirName}</span>
                          <span className="num font-mono text-ink-secondary">{fmt(a.bytes)}</span>
                          {a.risk !== "safe" && <RiskBadge risk={a.risk} />}
                        </label>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <SelectionBar count={chosen.length} bytes={chosenBytes} note={t(`method.${method}`)}>
            <Button
              size="sm"
              variant="primary"
              disabled={chosen.length === 0}
              onClick={() => {
                setMethod(settings?.cacheDelete ?? "permanent");
                setConfirm(true);
              }}
            >
              {t("common.clean")}
            </Button>
          </SelectionBar>
        </>
      )}
      <ConfirmClean
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void clean()}
        count={chosen.length}
        bytes={chosenBytes}
        method={method}
        onMethod={setMethod}
        hasReview={chosen.some((a) => a.risk !== "safe")}
        busy={busy}
      />
      <ReportDialog report={report} onClose={() => setReport(null)} />
    </div>
  );
}
