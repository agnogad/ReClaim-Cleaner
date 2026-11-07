import { ChevronDown, ClipboardCopy, ExternalLink, FolderOpen, ScanSearch, Sparkles, Terminal } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmClean, PathText, ProgressPanel, ReportDialog, SelectionBar } from "../components/common";
import { useBytes, useFeature } from "../lib/hooks";
import { isFilePath } from "../lib/paths";
import { Badge, Banner, Button, Card, Checkbox, EmptyState, PageHeader, RiskBadge, SectionTitle } from "../components/ui";
import { cx } from "../lib/cx";
import { api, openUrl } from "../lib/api";
import { isCleanable, isCommandOnly, ruleDescription, ruleName } from "../lib/recommend";
import { buildScript } from "../lib/script";
import type { CleanReport, DeleteMethod, Group, TargetResult, TargetRule } from "../lib/types";
import { errorText, useApp } from "../store/app";

const GROUPS: Group[] = ["system", "browser", "apps", "games", "dev", "ai", "media"];

interface Row {
  rule: TargetRule;
  res: TargetResult;
}

function RuleRow({ row, checked, onToggle, elevated }: { row: Row; checked: boolean; onToggle: (v: boolean) => void; elevated: boolean }) {
  const { t, i18n } = useTranslation();
  const fmt = useBytes();
  const toast = useApp((s) => s.toast);
  const runCommands = useFeature("runRuleCommands");
  const [open, setOpen] = useState(false);
  const [cmdBusy, setCmdBusy] = useState(false);
  const { rule, res } = row;
  const blocked = res.running.length > 0;
  const cleanable = isCleanable(rule);
  const commandOnly = res.bytes === 0 && isCommandOnly(rule, res, runCommands);

  const runCommand = async () => {
    setCmdBusy(true);
    try {
      const r = await api.ruleCommand(rule.id);
      toast(r.cancelled ? "warning" : "positive", r.cancelled ? t("junk.commandCancelled") : t("junk.commandDone", { code: r.code ?? 0 }));
      await useApp.getState().scanJunk();
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setCmdBusy(false);
    }
  };

  const copyCommand = () => {
    void navigator.clipboard.writeText(rule.command!).then(
      () => toast("positive", t("common.copied")),
      (e) => toast("danger", errorText(e)),
    );
  };

  return (
    <li className={cx("rail", open && "bg-surface")}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Checkbox checked={checked} onChange={onToggle} disabled={blocked || !cleanable} label={ruleName(rule, i18n.language)} />
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-medium text-ink">{ruleName(rule, i18n.language)}</span>
              {rule.risk !== "safe" && <RiskBadge risk={rule.risk} />}
              {rule.admin && !elevated && <Badge tone="primary">{t("common.needsAdmin")}</Badge>}
              {blocked && <Badge tone="warning">{t("junk.closeApp", { apps: res.running.join(", ") })}</Badge>}
              {!rule.verified && <Badge>{t("common.unverified")}</Badge>}
              {rule.user && <Badge tone="primary">{t("common.userRule")}</Badge>}
            </div>
            <div className="truncate text-[13px] text-ink-muted">{ruleDescription(rule, i18n.language)}</div>
          </div>
          {commandOnly ? <span className="shrink-0 text-[13px] text-ink-muted">{t("junk.notMeasured")}</span> : <span className="num shrink-0 font-mono text-[14px] text-ink">{fmt(res.bytes)}</span>}
          <ChevronDown size={16} strokeWidth={1.75} className={cx("shrink-0 text-ink-muted transition-transform transition-fast", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      {open && (
        <div className="anim-fade space-y-2 px-4 pb-3 pl-[46px]">
          {res.found.length > 0 && (
            <ul className="divide-y divide-line rounded-md border border-line bg-canvas">
              {res.found.map((f) => (
                <li key={f.path} className="flex items-center gap-3 px-3 py-1.5">
                  <PathText path={f.path} className="flex-1" />
                  <span className="num shrink-0 font-mono text-[12px] text-ink-secondary">{fmt(f.bytes)}</span>
                  {isFilePath(f.path) && (
                    <button type="button" title={t("common.reveal")} aria-label={t("common.reveal")} onClick={() => void api.reveal(f.path).catch(() => undefined)} className="rounded p-1 text-ink-muted hover:bg-surface-muted hover:text-ink">
                      <FolderOpen size={14} strokeWidth={1.75} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
            {rule.minAgeHours ? <span>{t("junk.minAge", { hours: rule.minAgeHours })}</span> : null}
            {res.partial && <span>{t("junk.partial")}</span>}
            {rule.command && !rule.command.startsWith("api:") && (
              <>
                <code className="selectable rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-ink">{rule.command}</code>
                {!runCommands ? (
                  <>
                    <Button size="sm" variant="secondary" icon={<ClipboardCopy size={14} strokeWidth={1.75} />} onClick={copyCommand}>
                      {t("common.copyCommand")}
                    </Button>
                    <span>{t("common.copyCommandHint")}</span>
                  </>
                ) : (
                  res.commandAvailable && (
                    <Button size="sm" variant="secondary" icon={<Terminal size={14} strokeWidth={1.75} />} loading={cmdBusy} onClick={() => void runCommand()} title={t("common.commandHint")}>
                      {t("common.runCommand")}
                    </Button>
                  )
                )}
              </>
            )}
            {rule.source && (
              <button type="button" onClick={() => void openUrl(rule.source!)} className="inline-flex items-center gap-1 text-primary hover:underline">
                <ExternalLink size={12} strokeWidth={1.75} />
                {t("common.source")}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

export function CleanerPage() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const { info, settings, rules, junk, running, scanJunk, toast, refreshDrives } = useApp();
  const scanning = !!running.junk;
  const elevated = !!info?.elevated;
  const scriptExport = useFeature("scriptExport");
  const runCommands = useFeature("runRuleCommands");

  const rows: Row[] = useMemo(() => {
    if (!rules || !junk) return [];
    const byId = new Map(rules.targets.map((r) => [r.id, r]));
    return junk
      .map((res) => ({ rule: byId.get(res.id)!, res }))
      .filter((r) => r.rule && (r.res.bytes > 0 || isCommandOnly(r.rule, r.res, runCommands)))
      .sort((a, b) => b.res.bytes - a.res.bytes);
  }, [rules, junk, runCommands]);

  const visible = useMemo(() => rows.filter((r) => r.rule.risk !== "caution" || settings?.showCaution), [rows, settings?.showCaution]);
  const hiddenCaution = rows.length - visible.length;

  const defaults = useMemo(
    () => new Set(visible.filter((r) => r.rule.risk === "safe" && r.res.running.length === 0 && isCleanable(r.rule) && (!r.rule.admin || elevated)).map((r) => r.rule.id)),
    [visible, elevated],
  );
  const [manual, setManual] = useState<{ for: TargetResult[] | null; set: Set<string> } | null>(null);
  const selected = manual && manual.for === junk ? manual.set : defaults;
  const setSelected = (next: Set<string> | ((prev: Set<string>) => Set<string>)) => setManual({ for: junk, set: typeof next === "function" ? next(selected) : next });

  const [confirm, setConfirm] = useState(false);
  const [method, setMethod] = useState<DeleteMethod>(settings?.cacheDelete ?? "permanent");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CleanReport | null>(null);

  const chosen = visible.filter((r) => selected.has(r.rule.id));
  const chosenBytes = chosen.reduce((s, r) => s + r.res.bytes, 0);
  const total = visible.reduce((s, r) => s + r.res.bytes, 0);
  const blockedCount = visible.filter((r) => r.res.running.length > 0).length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const clean = async () => {
    setBusy(true);
    try {
      const out = await api.junkClean(
        chosen.map((r) => r.rule.id),
        method,
      );
      setConfirm(false);
      setReport(out.report);
      if (out.elevationCancelled) toast("warning", t("overview.elevationCancelled"));
      await Promise.all([scanJunk(), refreshDrives()]);
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const copyScript = async () => {
    if (!settings || !info) return;
    const items = chosen.map((r) => ({
      title: ruleName(r.rule, "en"),
      paths: r.rule.mode === "report" ? [] : r.res.found.map((f) => f.path),
      mode: r.rule.mode,
      include: r.rule.include,
      exclude: r.rule.exclude,
      minAgeHours: r.rule.minAgeHours,
      admin: r.rule.admin,
      command: r.rule.command,
    }));
    await navigator.clipboard.writeText(buildScript(items, { recycle: method === "recycle", generatedAt: new Date(), version: info.version }));
    toast("positive", t("common.scriptCopied"));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("junk.title")}
        subtitle={t("junk.subtitle")}
        actions={
          junk && (
            <Button icon={<ScanSearch size={16} strokeWidth={1.75} />} loading={scanning} onClick={() => void scanJunk()}>
              {scanning ? t("common.scanning") : t("common.rescan")}
            </Button>
          )
        }
      />
      {scanning ? (
        <ProgressPanel kind="junk" />
      ) : !junk ? (
        <Card>
          <EmptyState
            icon={<Sparkles size={20} strokeWidth={1.75} />}
            title={t("junk.emptyTitle")}
            body={t("junk.emptyBody", { count: rules?.targets.length ?? 0 })}
            action={
              <Button variant="primary" size="lg" icon={<ScanSearch size={18} strokeWidth={1.75} />} onClick={() => void scanJunk()}>
                {t("common.scan")}
              </Button>
            }
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState icon={<Sparkles size={20} strokeWidth={1.75} />} title={t("junk.nothing")} />
        </Card>
      ) : (
        <>
          <div className="module-grid grid-cols-3">
            <div className="px-5 py-3">
              <div className="label">{t("junk.found")}</div>
              <div className="num mt-1 font-mono text-[22px] text-ink">{fmt(total)}</div>
            </div>
            <div className="px-5 py-3">
              <div className="label">{t("risk.safe")}</div>
              <div className="num mt-1 font-mono text-[22px] text-ink">{fmt(visible.filter((r) => r.rule.risk === "safe").reduce((s, r) => s + r.res.bytes, 0))}</div>
            </div>
            <div className="px-5 py-3">
              <div className="label">{t("junk.blocked")}</div>
              <div className="num mt-1 font-mono text-[22px] text-ink">{blockedCount}</div>
            </div>
          </div>
          {hiddenCaution > 0 && <Banner>{t("junk.hiddenCaution", { count: hiddenCaution })}</Banner>}
          <Card className="overflow-hidden">
            {GROUPS.map((g) => {
              const list = visible.filter((r) => r.rule.group === g);
              if (list.length === 0) return null;
              const groupSel = list.filter((r) => selected.has(r.rule.id));
              const selectable = list.filter((r) => r.res.running.length === 0 && isCleanable(r.rule));
              const groupBytes = list.reduce((s, r) => s + r.res.bytes, 0);
              return (
                <div key={g}>
                  <SectionTitle aside={groupBytes > 0 ? fmt(groupBytes) : "—"}>
                    <span className="inline-flex items-center gap-3">
                      <Checkbox
                        checked={selectable.length > 0 && groupSel.length === selectable.length}
                        indeterminate={groupSel.length > 0 && groupSel.length < selectable.length}
                        onChange={(on) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            for (const r of selectable) {
                              if (on) next.add(r.rule.id);
                              else next.delete(r.rule.id);
                            }
                            return next;
                          })
                        }
                        label={t(`groups.${g}`)}
                      />
                      {t(`groups.${g}`)}
                    </span>
                  </SectionTitle>
                  <ul className="divide-y divide-line border-b border-line last:border-b-0">
                    {list.map((r) => (
                      <RuleRow key={r.rule.id} row={r} checked={selected.has(r.rule.id)} onToggle={(v) => toggle(r.rule.id, v)} elevated={elevated} />
                    ))}
                  </ul>
                </div>
              );
            })}
          </Card>
          <SelectionBar count={chosen.length} bytes={chosenBytes} note={t(`method.${method}`)}>
            {scriptExport && (
              <Button size="sm" variant="secondary" icon={<ClipboardCopy size={15} strokeWidth={1.75} />} disabled={chosen.length === 0} onClick={() => void copyScript()}>
                {t("common.copyScript")}
              </Button>
            )}
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
        adminCount={chosen.filter((r) => r.rule.admin && !elevated).length}
        hasReview={chosen.some((r) => r.rule.risk !== "safe")}
        busy={busy}
      />
      <ReportDialog report={report} onClose={() => setReport(null)} />
    </div>
  );
}
