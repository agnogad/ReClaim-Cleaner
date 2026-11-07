import { FolderOpen, FolderX, ScanSearch } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmClean, FolderList, PathText, ProgressPanel, ReportDialog } from "../components/common";
import { useLocale } from "../lib/hooks";
import { Badge, Button, Card, Checkbox, EmptyState, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import type { CleanReport, DeleteMethod, EmptyFolder } from "../lib/types";
import { errorText, useApp } from "../store/app";
import { libraryRoots } from "../lib/roots";

export function EmptyFoldersPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { info, settings, running, setRunning, toast } = useApp();
  const [roots, setRoots] = useState<string[]>(() => libraryRoots(info?.libraries).slice(0, 3));
  const [folders, setFolders] = useState<EmptyFolder[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [method, setMethod] = useState<DeleteMethod>(settings?.filesDelete ?? "recycle");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CleanReport | null>(null);
  const scanning = !!running.empty;

  const scan = async () => {
    setRunning("empty", true);
    try {
      const found = await api.emptyScan(roots);
      setFolders(found);
      setSelected(new Set(found.map((f) => f.path)));
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setRunning("empty", false);
    }
  };

  const chosen = (folders ?? []).filter((f) => selected.has(f.path));

  const remove = async () => {
    setBusy(true);
    try {
      const r = await api.pathsClean(
        "empty",
        chosen.map((f) => f.path),
        method,
      );
      setConfirm(false);
      setReport(r);
      const failed = new Set(r.failures.map((f) => f.path));
      setFolders((prev) => (prev ?? []).filter((f) => !selected.has(f.path) || failed.has(f.path)));
      setSelected(new Set());
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("empty.title")}
        subtitle={t("empty.subtitle")}
        actions={
          <Button variant={folders ? "secondary" : "primary"} icon={<ScanSearch size={16} strokeWidth={1.75} />} loading={scanning} disabled={roots.length === 0} onClick={() => void scan()}>
            {scanning ? t("common.scanning") : folders ? t("common.rescan") : t("common.scan")}
          </Button>
        }
      />
      <Card>
        <div className="px-4 py-3">
          <div className="label mb-2">{t("common.roots")}</div>
          <FolderList folders={roots} onChange={setRoots} suggestions={libraryRoots(info?.libraries)} />
        </div>
      </Card>
      {scanning ? (
        <ProgressPanel kind="empty" />
      ) : !folders ? (
        <Card>
          <EmptyState icon={<FolderX size={20} strokeWidth={1.75} />} title={t("empty.emptyTitle")} body={t("empty.emptyBody")} />
        </Card>
      ) : folders.length === 0 ? (
        <Card>
          <EmptyState icon={<FolderX size={20} strokeWidth={1.75} />} title={t("empty.none")} />
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2">
              <Checkbox
                checked={chosen.length === folders.length}
                indeterminate={chosen.length > 0 && chosen.length < folders.length}
                onChange={(on) => setSelected(on ? new Set(folders.map((f) => f.path)) : new Set())}
                label={t("common.selectAll")}
              />
              <span className="label">{t("common.items", { count: folders.length })}</span>
            </div>
            <ul className="max-h-[560px] divide-y divide-line overflow-y-auto">
              {folders.map((f) => (
                <li key={f.path} className="rail flex items-center gap-3 px-4 py-2 hover:bg-surface">
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
                  {f.nested > 0 && <Badge>{t("empty.nested", { count: f.nested })}</Badge>}
                  <span className="shrink-0 font-mono text-[12px] text-ink-muted">{formatDate(f.mtime, locale)}</span>
                  <button type="button" title={t("common.reveal")} aria-label={t("common.reveal")} onClick={() => void api.reveal(f.path).catch(() => undefined)} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
                    <FolderOpen size={15} strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={chosen.length === 0}
              onClick={() => {
                setMethod(settings?.filesDelete ?? "recycle");
                setConfirm(true);
              }}
            >
              {t(`method.${settings?.filesDelete ?? "recycle"}`)} ({chosen.length})
            </Button>
          </div>
        </>
      )}
      <ConfirmClean open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void remove()} count={chosen.length} bytes={0} method={method} onMethod={setMethod} busy={busy} files />
      <ReportDialog report={report} onClose={() => setReport(null)} />
    </div>
  );
}
