import { ChevronDown, FolderOpen, MessagesSquare, ScanSearch, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmClean, ProgressPanel, ReportDialog, SelectionBar } from "../components/common";
import { Banner, Button, Card, Checkbox, EmptyState, PageHeader, RiskBadge, SectionTitle, Select } from "../components/ui";
import { api } from "../lib/api";
import { cx } from "../lib/cx";
import { daysSince, formatAgo, formatCount } from "../lib/format";
import { useBytes, useLocale } from "../lib/hooks";
import { claudeProjectLabel } from "../lib/paths";
import type { AssistantData, CleanReport, DeleteMethod } from "../lib/types";
import { errorText, useApp } from "../store/app";

function Folder({ data, selected, onToggle }: { data: AssistantData; selected: Set<string>; onToggle: (paths: string[], on: boolean) => void }) {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const profile = useApp((s) => s.info?.userProfile ?? "");
  const [open, setOpen] = useState(false);
  const paths = data.items.length > 0 ? data.items.map((i) => i.path) : [data.path];
  const sel = paths.filter((p) => selected.has(p));
  return (
    <li className={cx("rail", open && "bg-surface")}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Checkbox checked={sel.length === paths.length} indeterminate={sel.length > 0 && sel.length < paths.length} onChange={(on) => onToggle(paths, on)} label={t(`assistants.folders.${data.id}`)} />
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => data.items.length > 0 && setOpen(!open)} aria-expanded={open}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-medium text-ink">{t(`assistants.folders.${data.id}`, { defaultValue: data.id })}</span>
              {data.risk !== "safe" && <RiskBadge risk={data.risk} />}
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <span>{t("common.filesCount", { count: data.files })}</span>
              {data.mtime > 0 && <span>· {formatAgo(data.mtime, locale)}</span>}
              {data.items.length > 0 && <span>· {t("common.items", { count: data.items.length })}</span>}
            </div>
          </div>
          <span className="num shrink-0 font-mono text-[14px] text-ink">{fmt(data.bytes)}</span>
          {data.items.length > 0 && <ChevronDown size={16} strokeWidth={1.75} className={cx("shrink-0 text-ink-muted transition-transform transition-fast", open && "rotate-180")} aria-hidden />}
        </button>
        <button type="button" title={t("common.reveal")} aria-label={t("common.reveal")} onClick={() => void api.open(data.path).catch(() => undefined)} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
          <FolderOpen size={15} strokeWidth={1.75} />
        </button>
      </div>
      {open && (
        <ul className="anim-fade mx-4 mb-3 ml-[46px] max-h-[360px] divide-y divide-line overflow-y-auto rounded-md border border-line bg-canvas">
          {data.items.map((i) => (
            <li key={i.path} className="flex items-center gap-3 px-3 py-1.5">
              <Checkbox checked={selected.has(i.path)} onChange={(on) => onToggle([i.path], on)} label={i.name} className="h-4 w-4" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px] text-ink" title={i.name}>
                  {data.id === "claude-projects" ? claudeProjectLabel(i.name, profile) : i.name}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-ink-muted">{formatCount(i.files, locale)}</span>
              <span className="w-[90px] shrink-0 text-right font-mono text-[11px] text-ink-muted">{i.mtime ? formatAgo(i.mtime, locale) : ""}</span>
              <span className="num w-[72px] shrink-0 text-right font-mono text-[12px] text-ink">{fmt(i.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function AssistantsPage() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const { settings, running, setRunning, toast, refreshDrives } = useApp();
  const [data, setData] = useState<AssistantData[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [age, setAge] = useState(90);
  const [confirm, setConfirm] = useState(false);
  const [method, setMethod] = useState<DeleteMethod>(settings?.filesDelete ?? "recycle");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CleanReport | null>(null);
  const scanning = !!running.assistants;

  const scan = async () => {
    setRunning("assistants", true);
    try {
      const found = await api.assistantData();
      setData(found);
      // Only regenerable data is preselected; conversation history never is.
      setSelected(new Set(found.filter((d) => d.risk === "safe").flatMap((d) => (d.items.length ? d.items.map((i) => i.path) : [d.path]))));
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setRunning("assistants", false);
    }
  };

  const sizes = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data ?? []) {
      if (d.items.length) for (const i of d.items) m.set(i.path, i.bytes);
      else m.set(d.path, d.bytes);
    }
    return m;
  }, [data]);
  const chosen = [...selected].filter((p) => sizes.has(p));
  const chosenBytes = chosen.reduce((s, p) => s + (sizes.get(p) ?? 0), 0);
  const tools = [...new Set((data ?? []).map((d) => d.tool))];

  const toggle = (paths: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        if (on) next.add(p);
        else next.delete(p);
      }
      return next;
    });

  const selectOld = () => {
    const next = new Set(selected);
    for (const d of data ?? []) for (const i of d.items) if (daysSince(i.mtime) >= age) next.add(i.path);
    setSelected(next);
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await api.pathsClean("assistants", chosen, method);
      setConfirm(false);
      setReport(r);
      await scan();
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
        title={t("assistants.title")}
        subtitle={t("assistants.subtitle")}
        actions={
          <Button variant={data ? "secondary" : "primary"} icon={<ScanSearch size={16} strokeWidth={1.75} />} loading={scanning} onClick={() => void scan()}>
            {scanning ? t("common.scanning") : data ? t("common.rescan") : t("common.scan")}
          </Button>
        }
      />
      {scanning ? (
        <ProgressPanel kind="assistants" />
      ) : !data ? (
        <Card>
          <EmptyState icon={<MessagesSquare size={20} strokeWidth={1.75} />} title={t("assistants.emptyTitle")} body={t("assistants.emptyBody")} />
        </Card>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={<MessagesSquare size={20} strokeWidth={1.75} />} title={t("assistants.none")} />
        </Card>
      ) : (
        <>
          <Banner icon={<ShieldCheck size={15} strokeWidth={1.75} />}>
            {t("assistants.emptyBody")} {t("assistants.privacy")}
          </Banner>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-[13px] text-ink-secondary">{t("assistants.olderThan")}</span>
            <Select label={t("assistants.olderThan")} value={age} onChange={setAge} options={[7, 30, 90, 180, 365].map((d) => ({ value: d, label: t("common.days", { count: d }) }))} />
            <Button size="sm" variant="secondary" onClick={selectOld}>
              {t("common.selectAll")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t("common.selectNone")}
            </Button>
          </div>
          <Card className="overflow-hidden">
            {tools.map((tool) => {
              const list = data.filter((d) => d.tool === tool);
              return (
                <div key={tool}>
                  <SectionTitle aside={fmt(list.reduce((s, d) => s + d.bytes, 0))}>{tool}</SectionTitle>
                  <ul className="divide-y divide-line border-b border-line last:border-b-0">
                    {list.map((d) => (
                      <Folder key={d.id} data={d} selected={selected} onToggle={toggle} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </Card>
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
              {t("common.clean")}
            </Button>
          </SelectionBar>
        </>
      )}
      <ConfirmClean
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void remove()}
        count={chosen.length}
        bytes={chosenBytes}
        method={method}
        onMethod={setMethod}
        hasReview={(data ?? []).some((d) => d.risk !== "safe" && (d.items.some((i) => selected.has(i.path)) || selected.has(d.path)))}
        busy={busy}
      />
      <ReportDialog report={report} onClose={() => setReport(null)} />
    </div>
  );
}
