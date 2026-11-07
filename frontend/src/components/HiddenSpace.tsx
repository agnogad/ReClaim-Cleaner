import { ExternalLink, FolderOpen, Gauge, Map as MapIcon, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { cx } from "../lib/cx";
import { formatBytes } from "../lib/format";
import { outsideBytes, partActions, systemKept, type PartAction } from "../lib/hidden";
import { useBytes, useLocale } from "../lib/hooks";
import { driveLabel, samePath } from "../lib/paths";
import type { HiddenPart, HiddenSpace } from "../lib/types";
import { errorText, useApp } from "../store/app";
import { PathText, UsageBar } from "./common";
import { Badge, Button, Card, CardHeader, Skeleton } from "./ui";

/** Loads the explanation for `root` again whenever the space map changes or `nonce` does. */
function useHidden(root: string | null, nonce: number): HiddenSpace | null {
  const version = useApp((s) => s.explorerVersion);
  const [data, setData] = useState<{ key: string; value: HiddenSpace | null } | null>(null);
  const key = `${root}|${version}|${nonce}`;
  useEffect(() => {
    if (!root) return;
    let alive = true;
    void api.hiddenSpace(root).then(
      (value) => alive && setData({ key, value }),
      () => alive && setData({ key, value: null }),
    );
    return () => {
      alive = false;
    };
  }, [root, key]);
  return data?.value ?? null;
}

function partTitle(p: HiddenPart, t: (k: string, o?: Record<string, unknown>) => string): string {
  return t(`hidden.parts.${p.kind}`, { label: p.label ?? "" });
}

function PartValue({ p }: { p: HiddenPart }) {
  const { t } = useTranslation();
  const fmt = useBytes();
  if (p.kind === "reservedStorage" && p.bytes === 0) return <span className="text-[13px] text-ink-muted">{t("hidden.off")}</span>;
  if (p.bytes === null) return <span className="text-[13px] text-ink-muted">{p.needsAdmin ? t("hidden.needsAdmin") : t("hidden.unknown")}</span>;
  return <span className="num font-mono text-[14px] text-ink">{fmt(p.bytes)}</span>;
}

function PartFacts({ p }: { p: HiddenPart }) {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  if (p.kind === "shadowCopies" && p.count !== null) return <>{t("hidden.shadowFacts", { count: p.count, limit: p.limit ? fmt(p.limit) : "—" })}</>;
  if (p.kind === "unreadable" && p.count !== null) return <>{t("hidden.folders", { count: p.count })}</>;
  if (p.kind === "cloudOnly" && p.count !== null) return <>{t("hidden.cloudFiles", { count: p.count, size: formatBytes(p.bytes ?? 0, locale) })}</>;
  if (p.kind === "recycleBin" && p.count !== null) return <>{t("hidden.items", { count: p.count })}</>;
  if (p.kind === "virtualDisk" && p.path) return <PathText path={p.path} />;
  return null;
}

function ActionButton({ a, p, measuring, onMeasure }: { a: PartAction; p: HiddenPart; measuring: boolean; onMeasure: () => void }) {
  const { t } = useTranslation();
  const { go, toast } = useApp();
  const fail = (e: unknown) => toast("danger", errorText(e));
  switch (a.kind) {
    case "measure":
      return (
        <Button size="sm" variant="primary" icon={<Gauge size={14} strokeWidth={1.75} />} loading={measuring} onClick={onMeasure} title={t("hidden.measureHint")}>
          {measuring ? t("hidden.measuring") : t("hidden.measure")}
        </Button>
      );
    case "tool":
      return (
        <Button size="sm" variant="ghost" icon={<ExternalLink size={14} strokeWidth={1.75} />} onClick={() => void api.tool(a.tool).catch(fail)}>
          {t(`hidden.actions.${a.label}`)}
        </Button>
      );
    case "page":
      return (
        <Button size="sm" variant="ghost" onClick={() => go(a.page)}>
          {t(`hidden.actions.${a.label}`)}
        </Button>
      );
    case "reveal":
      return p.path ? (
        <Button size="sm" variant="ghost" icon={<FolderOpen size={14} strokeWidth={1.75} />} onClick={() => void api.reveal(p.path!).catch(fail)}>
          {t("common.reveal")}
        </Button>
      ) : null;
    case "admin":
      return (
        <Button size="sm" variant="ghost" icon={<ShieldCheck size={14} strokeWidth={1.75} />} onClick={() => void api.restartElevated().catch(fail)}>
          {t("settings.restartAdmin")}
        </Button>
      );
  }
}

function useMeasure(onDone: () => void) {
  const { t } = useTranslation();
  const toast = useApp((s) => s.toast);
  const [measuring, setMeasuring] = useState(false);
  const measure = useCallback(async () => {
    setMeasuring(true);
    try {
      if (await api.hiddenMeasure()) onDone();
      else toast("warning", t("hidden.measureDeclined"));
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setMeasuring(false);
    }
  }, [onDone, t, toast]);
  return { measuring, measure };
}

/** Space map panel: reconciles the drive's used space with the scan. */
export function HiddenSpacePanel({ root }: { root: string }) {
  const { t } = useTranslation();
  const fmt = useBytes();
  const elevated = useApp((s) => !!s.info?.elevated);
  const [nonce, setNonce] = useState(0);
  const h = useHidden(root, nonce);
  const { measuring, measure } = useMeasure(useCallback(() => setNonce((n) => n + 1), []));
  const drive = driveLabel(root);

  if (!h) {
    return (
      <Card>
        <CardHeader title={t("hidden.title")} hint={t("hidden.hint", { drive })} />
        <div className="space-y-2 p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
        </div>
      </Card>
    );
  }
  const outside = outsideBytes(h);
  const scanned = h.scanned ?? 0;
  const unexplained = h.unexplained ?? 0;
  const parts = [...h.parts].sort((a, b) => Number(a.inScan) - Number(b.inScan) || (b.bytes ?? -1) - (a.bytes ?? -1));

  return (
    <Card>
      <CardHeader eyebrow={drive} title={t("hidden.title")} hint={t("hidden.hint", { drive })} />
      <div className="module-grid grid-cols-2 border-b border-line lg:grid-cols-4">
        {[
          { label: t("hidden.used"), value: fmt(h.used), dot: "bg-ink-secondary" },
          { label: t("hidden.scanned"), value: fmt(scanned), dot: "bg-primary" },
          { label: t("hidden.outside"), value: fmt(outside), dot: "bg-warning" },
          { label: t("hidden.unexplained"), value: unexplained > 0 ? fmt(unexplained) : "—", dot: "hatch-review", title: t("hidden.unexplainedHint") },
        ].map((s) => (
          <div key={s.label} className="px-4 py-3" title={s.title}>
            <div className="flex items-center gap-2 text-[12px] text-ink-secondary">
              <span className={cx("inline-block h-2.5 w-2.5 rounded-[3px]", s.dot)} aria-hidden />
              {s.label}
            </div>
            <div className="num mt-1 font-mono text-[18px] text-ink">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="space-y-2 px-4 py-3">
        <UsageBar
          className="h-2.5"
          segments={[
            { value: Math.min(scanned, h.used), className: "bg-primary", label: t("hidden.scanned") },
            { value: outside, className: "bg-warning", label: t("hidden.outside") },
            { value: Math.max(0, unexplained), className: "hatch-review", label: t("hidden.unexplained") },
            { value: h.free, className: "swatch-free" },
          ]}
        />
        <p className="text-[12px] text-ink-muted">{unexplained < 0 ? t("hidden.overcount") : t("hidden.unexplainedHint")}</p>
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {parts.map((p, i) => (
          <li key={`${p.kind}-${i}`} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-[240px] flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium text-ink">{partTitle(p, t)}</span>
                {h.scanned !== null && p.kind !== "cloudOnly" && p.kind !== "unreadable" && p.bytes !== 0 && <Badge tone={p.inScan ? "neutral" : "warning"}>{p.inScan ? t("hidden.inMap") : t("hidden.outsideMap")}</Badge>}
              </div>
              <p className="mt-0.5 max-w-[80ch] text-[13px] text-ink-secondary">{t(`hidden.body.${p.kind}`)}</p>
              <div className="mt-1 font-mono text-[12px] text-ink-muted">
                <PartFacts p={p} />
              </div>
              {p.kind === "unreadable" && h.deniedPaths.length > 0 && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[12px] text-ink-secondary">{t("hidden.deniedList")}</summary>
                  <ul className="mt-1 space-y-0.5">
                    {h.deniedPaths.map((d) => (
                      <li key={d}>
                        <PathText path={d} />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <PartValue p={p} />
              <div className="flex flex-wrap justify-end gap-1">
                {partActions(p, elevated).map((a, j) => (
                  <ActionButton key={j} a={a} p={p} measuring={measuring} onMeasure={() => void measure()} />
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Overview card: what Windows keeps on the system drive, with a way into the full explanation. */
export function HiddenSummary() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const { drives, explorer, running, go, scanExplorer } = useApp();
  const sys = drives.find((d) => d.system) ?? drives[0];
  const root = sys?.root ?? null;
  const [nonce, setNonce] = useState(0);
  const h = useHidden(root, nonce);
  const { measuring, measure } = useMeasure(useCallback(() => setNonce((n) => n + 1), []));
  if (!sys || !root) return null;
  const drive = driveLabel(root);
  const mapped = !!explorer && samePath(explorer.root, root) && explorer.selection.length === 0;
  const kept = h ? systemKept(h) : null;
  const shown = [...(kept?.parts ?? [])].filter((p) => p.bytes !== 0 || p.needsAdmin).sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));

  return (
    <Card>
      <CardHeader title={t("hidden.overviewTitle")} hint={t("hidden.overviewBody", { drive })} />
      {!kept ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line">
            {shown.map((p) => (
              <li key={p.kind} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                <span className="truncate text-ink">{partTitle(p, t)}</span>
                {p.bytes === null && p.needsAdmin ? (
                  <Button size="sm" variant="ghost" icon={<Gauge size={13} strokeWidth={1.75} />} loading={measuring} onClick={() => void measure()} title={t("hidden.measureHint")}>
                    {t("hidden.measure")}
                  </Button>
                ) : (
                  <span className="num shrink-0 font-mono text-[12px] text-ink-secondary">{p.bytes === null ? "—" : formatBytes(p.bytes, locale)}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
            <div>
              <div className="label">{t("hidden.overviewKnown")}</div>
              <div className="num font-mono text-[16px] text-ink">{fmt(kept.bytes)}</div>
            </div>
            <Button
              size="sm"
              icon={<MapIcon size={14} strokeWidth={1.75} />}
              disabled={running.explorer}
              onClick={() => {
                go("explorer");
                if (!mapped) void scanExplorer(root);
              }}
            >
              {mapped ? t("hidden.explain") : t("hidden.mapToExplain", { drive })}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
