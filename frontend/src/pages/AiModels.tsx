import { Bot, Copy as CopyIcon, FolderOpen, ScanSearch, Terminal } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmClean, PathText, ProgressPanel, ReportDialog, SelectionBar } from "../components/common";
import { Badge, Banner, Button, Card, Checkbox, EmptyState, PageHeader, Segmented, Stat } from "../components/ui";
import { api } from "../lib/api";
import { cx } from "../lib/cx";
import { formatAgo, splitBytes } from "../lib/format";
import { useBytes, useLocale } from "../lib/hooks";
import type { AiModel, CleanReport, DeleteMethod } from "../lib/types";
import { errorText, useApp } from "../store/app";

type SourceFilter = "all" | AiModel["source"];
const SOURCES: AiModel["source"][] = ["huggingface", "lmstudio", "ollama", "comfyui"];

export function AiModelsPage() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const { settings, running, setRunning, toast, refreshDrives } = useApp();
  const [models, setModels] = useState<AiModel[] | null>(null);
  const [source, setSource] = useState<SourceFilter>("all");
  const [onlyDup, setOnlyDup] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [method, setMethod] = useState<DeleteMethod>(settings?.cacheDelete ?? "permanent");
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const scanning = !!running.models;

  const scan = async () => {
    setRunning("models", true);
    try {
      setModels(await api.aiModels());
      setSelected(new Set());
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setRunning("models", false);
    }
  };

  const byId = useMemo(() => new Map((models ?? []).map((m) => [m.id, m])), [models]);
  const list = (models ?? []).filter((m) => (source === "all" || m.source === source) && (!onlyDup || m.sameAs.length > 0));
  const total = (models ?? []).reduce((s, m) => s + m.bytes, 0);
  // A duplicate pair is counted once: the smaller copy is what keeping one would free.
  const dupSavings = useMemo(() => {
    const seen = new Set<string>();
    let bytes = 0;
    for (const m of models ?? []) {
      for (const other of m.sameAs) {
        const pair = [m.id, other].sort().join("|");
        if (seen.has(pair)) continue;
        seen.add(pair);
        bytes += Math.min(m.bytes, byId.get(other)?.bytes ?? 0);
      }
    }
    return { bytes, count: (models ?? []).filter((m) => m.sameAs.length > 0).length };
  }, [models, byId]);
  const chosen = list.filter((m) => selected.has(m.id) && m.remove.length > 0);
  const chosenBytes = chosen.reduce((s, m) => s + m.bytes, 0);

  const remove = async () => {
    setBusy("paths");
    try {
      const r = await api.pathsClean(
        "models",
        chosen.flatMap((m) => m.remove),
        method,
      );
      setConfirm(false);
      setReport(r);
      await scan();
      void refreshDrives();
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const ollamaRemove = async (m: AiModel) => {
    setBusy(m.id);
    try {
      await api.ollamaRemove(m.id);
      toast("positive", t("models.removed", { name: m.name }));
      await scan();
      void refreshDrives();
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const totalSplit = splitBytes(total, locale);
  const dupSplit = splitBytes(dupSavings.bytes, locale);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("models.title")}
        subtitle={t("models.subtitle")}
        actions={
          <Button variant={models ? "secondary" : "primary"} icon={<ScanSearch size={16} strokeWidth={1.75} />} loading={scanning} onClick={() => void scan()}>
            {scanning ? t("common.scanning") : models ? t("common.rescan") : t("common.scan")}
          </Button>
        }
      />
      {scanning ? (
        <ProgressPanel kind="models" />
      ) : !models ? (
        <Card>
          <EmptyState icon={<Bot size={20} strokeWidth={1.75} />} title={t("models.emptyTitle")} body={t("models.emptyBody")} />
        </Card>
      ) : models.length === 0 ? (
        <Card>
          <EmptyState icon={<Bot size={20} strokeWidth={1.75} />} title={t("models.none")} />
        </Card>
      ) : (
        <>
          <div className="module-grid ticks grid-cols-3">
            <Stat label={t("models.total")} value={totalSplit.value} unit={totalSplit.unit} />
            <Stat label={t("models.count")} value={models.length} sub={SOURCES.filter((s) => models.some((m) => m.source === s)).map((s) => t(`models.sources.${s}`)).join(" · ")} />
            <Stat label={t("models.duplicates")} value={dupSavings.count > 0 ? dupSplit.value : "0"} unit={dupSavings.count > 0 ? dupSplit.unit : undefined} sub={t("common.items", { count: dupSavings.count })} />
          </div>
          {dupSavings.count > 0 && (
            <Banner
              tone="warning"
              icon={<CopyIcon size={15} strokeWidth={1.75} />}
              action={
                <Button size="sm" variant="ghost" onClick={() => setOnlyDup(!onlyDup)}>
                  {onlyDup ? t("models.sources.all") : t("models.onlyDuplicates")}
                </Button>
              }
            >
              {t("models.duplicateBanner", { count: dupSavings.count, size: fmt(dupSavings.bytes) })}
            </Banner>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={source}
              onChange={setSource}
              options={[
                { value: "all" as SourceFilter, label: `${t("models.sources.all")} ${models.length}` },
                ...SOURCES.filter((s) => models.some((m) => m.source === s)).map((s) => ({ value: s as SourceFilter, label: `${t(`models.sources.${s}`)} ${models.filter((m) => m.source === s).length}` })),
              ]}
            />
            <span className="text-[12px] text-ink-muted">{t("models.redownload")}</span>
          </div>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {list.map((m) => {
                const others = m.sameAs.map((id) => byId.get(id)).filter((x): x is AiModel => !!x);
                return (
                  <li key={m.id} className={cx("rail flex items-center gap-3 px-4 py-2.5 hover:bg-surface", selected.has(m.id) && "bg-primary-soft")}>
                    <Checkbox
                      checked={selected.has(m.id)}
                      disabled={m.remove.length === 0}
                      onChange={(on) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(m.id);
                          else next.delete(m.id);
                          return next;
                        })
                      }
                      label={m.name}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[14px] font-medium text-ink" title={m.name}>
                          {m.name}
                        </span>
                        <Badge tone="primary">{t(`models.sources.${m.source}`)}</Badge>
                        {m.kind !== "model" && <Badge>{m.kind}</Badge>}
                        {m.formats.slice(0, 3).map((f) => (
                          <Badge key={f}>{f}</Badge>
                        ))}
                        {others.length > 0 && (
                          <Badge tone="warning">
                            <CopyIcon size={11} strokeWidth={1.75} />
                            {t("models.alsoIn", { tools: [...new Set(others.map((o) => t(`models.sources.${o.source}`)))].join(", ") })}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <PathText path={m.path} className="min-w-0 flex-1" />
                        {m.mtime > 0 && <span className="shrink-0 font-mono text-[11px] text-ink-muted">{t("models.lastChanged", { when: formatAgo(m.mtime, locale) })}</span>}
                      </div>
                    </div>
                    <span className="num w-[84px] shrink-0 text-right font-mono text-[14px] text-ink">{fmt(m.bytes)}</span>
                    {m.source === "ollama" && m.command ? (
                      <Button size="sm" variant="secondary" icon={<Terminal size={14} strokeWidth={1.75} />} loading={busy === m.id} title={t("models.ollamaHint")} onClick={() => void ollamaRemove(m)}>
                        {t("models.removeOllama")}
                      </Button>
                    ) : null}
                    <button type="button" title={t("common.reveal")} aria-label={t("common.reveal")} onClick={() => void api.reveal(m.path).catch(() => undefined)} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
                      <FolderOpen size={15} strokeWidth={1.75} />
                    </button>
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
      <ConfirmClean open={confirm} onClose={() => setConfirm(false)} onConfirm={() => void remove()} count={chosen.length} bytes={chosenBytes} method={method} onMethod={setMethod} hasReview busy={busy === "paths"} files />
      <ReportDialog report={report} onClose={() => setReport(null)} />
    </div>
  );
}
