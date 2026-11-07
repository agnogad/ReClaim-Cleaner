import { AppWindow, CheckCircle2, Cog, FolderOpen, Loader2, Monitor, RefreshCw, Server, ShieldCheck, Terminal, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { formatCount } from "../lib/format";
import { useLocale } from "../lib/hooks";
import { combineOutcomes, groupLockers, type LockerGroup } from "../lib/locks";
import type { CloseOutcome, LockerKind, LockReport } from "../lib/types";
import { errorText, useApp } from "../store/app";
import { PathText } from "./common";
import { Badge, Banner, Button, Dialog } from "./ui";

const ORDER: LockerKind[] = ["app", "background", "console", "explorer", "service", "system"];
const ICONS: Record<LockerKind, LucideIcon> = {
  app: AppWindow,
  background: Cog,
  console: Terminal,
  explorer: FolderOpen,
  service: Server,
  system: Monitor,
};

interface LoadState {
  report: LockReport | null;
  error: string | null;
  loading: boolean;
}

function LockerRow({ group, busy, onClose }: { group: LockerGroup; busy: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const Icon = ICONS[group.kind];
  const pids = group.members.map((m) => m.pid);
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink-secondary">
        <Icon size={15} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-medium text-ink">{group.name || t("locks.unknownProcess")}</span>
          {group.service && <Badge>{group.service}</Badge>}
          {group.usesFiles && <Badge tone="warning">{t("locks.usesFiles")}</Badge>}
          {group.runsFrom && <Badge tone="primary">{t("locks.runsFrom")}</Badge>}
        </div>
        {group.exe && <PathText path={group.exe} className="mt-0.5" />}
        <div className="num mt-0.5 font-mono text-[11px] text-ink-muted">
          {pids.length > 1 ? `${t("locks.processes", { count: pids.length })} · ` : ""}
          {t("locks.pid", { pid: pids.slice(0, 4).join(", ") + (pids.length > 4 ? " …" : "") })}
        </div>
      </div>
      {group.closable.length > 0 && (
        <Button size="sm" loading={busy} onClick={onClose} title={t("locks.closeHint")}>
          {t("locks.close")}
        </Button>
      )}
    </li>
  );
}

function LockBody({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const toast = useApp((s) => s.toast);
  const [state, setState] = useState<LoadState>({ report: null, error: null, loading: true });
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api.locksFind(path).then(
        (report) => setState({ report, error: null, loading: false }),
        (e: unknown) => setState({ report: null, error: errorText(e), loading: false }),
      ),
    [path],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const recheck = () => {
    setState((s) => ({ ...s, loading: true }));
    void load();
  };

  // Each window of the app gets the same close request, one after another.
  const close = async (g: LockerGroup) => {
    setBusyKey(g.key);
    try {
      const outcomes: CloseOutcome[] = [];
      for (const l of g.closable) {
        const r = await api.locksClose(path, l.pid, l.started);
        outcomes.push(r.outcome);
        setState({ report: r.report, error: null, loading: false });
      }
      const outcome = combineOutcomes(outcomes);
      const tone = outcome === "closed" ? "positive" : outcome === "gone" ? "neutral" : "warning";
      toast(tone, t(`locks.outcome.${outcome}`, { name: g.name }));
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusyKey(null);
    }
  };

  const report = state.report;
  const all = report ? groupLockers(report.lockers) : [];
  const groups = ORDER.map((kind) => ({ kind, list: all.filter((g) => g.kind === kind) })).filter((g) => g.list.length > 0);

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={t("locks.title")}
      footer={
        <>
          <Button variant="ghost" icon={<RefreshCw size={14} strokeWidth={1.75} />} loading={state.loading} onClick={recheck}>
            {t("locks.recheck")}
          </Button>
          <Button variant="primary" onClick={onClose} data-autofocus>
            {t("common.done")}
          </Button>
        </>
      }
    >
      <PathText path={path} className="text-[13px]" />
      <div className="mt-4 space-y-4">
        {state.loading && !report ? (
          <div className="flex items-center gap-2 text-[14px] text-ink-secondary">
            <Loader2 size={16} strokeWidth={1.75} className="spin" aria-hidden />
            {t("locks.checking")}
          </div>
        ) : state.error ? (
          <Banner tone="danger">{state.error}</Banner>
        ) : report && report.lockers.length === 0 ? (
          <Banner tone="positive" icon={<CheckCircle2 size={16} strokeWidth={1.75} />}>
            {report.isDir ? t("locks.noneFolder") : t("locks.none")}
          </Banner>
        ) : (
          groups.map((g) => (
            <section key={g.kind}>
              <div className="label mb-1.5">{t(`locks.groups.${g.kind}`)}</div>
              <ul className="divide-y divide-line rounded-md border border-line">
                {g.list.map((group) => (
                  <LockerRow key={group.key} group={group} busy={busyKey === group.key} onClose={() => void close(group)} />
                ))}
              </ul>
              {g.kind !== "app" && <p className="mt-1.5 text-[12px] text-ink-muted">{t(`locks.hints.${g.kind}`)}</p>}
            </section>
          ))
        )}
        {report && (
          <div className="space-y-1 text-[12px] text-ink-muted">
            {report.isDir && <p>{t("locks.folderNote", { files: formatCount(report.checked, locale), folders: formatCount(report.folders, locale) })}</p>}
            {report.truncated && <p>{t("locks.truncated")}</p>}
            {report.unchecked > 0 && <p>{t("locks.unchecked", { count: report.unchecked })}</p>}
          </div>
        )}
        <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
          <ShieldCheck size={13} strokeWidth={1.75} className="text-positive-fg" aria-hidden />
          {t("locks.neverKill")}
        </p>
      </div>
    </Dialog>
  );
}

/** Lists what holds a file or folder, with a graceful close and a re-check. */
export function LockDialog({ path, onClose }: { path: string | null; onClose: () => void }) {
  if (!path) return null;
  return <LockBody key={path} path={path} onClose={onClose} />;
}
