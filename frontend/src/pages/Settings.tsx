import { ExternalLink, FolderOpen, GitBranch, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FolderList } from "../components/common";
import { useBytes, useFeature } from "../lib/hooks";
import { Banner, Button, Card, CardHeader, PageHeader, Segmented, Select, Switch } from "../components/ui";
import { LANGUAGES } from "../i18n/languages";
import { api, openUrl } from "../lib/api";
import { osLabel } from "../lib/platform";
import { REPO_URL, checkForUpdate, type UpdateResult } from "../lib/updates";
import type { DeleteMethod, MenuStatus } from "../lib/types";
import { errorText, useApp } from "../store/app";

/** The per-user "Analyze with ReClaim" entry in Explorer's right-click menu. */
function ExplorerMenu() {
  const { t, i18n } = useTranslation();
  const toast = useApp((s) => s.toast);
  const [status, setStatus] = useState<MenuStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api.shellMenuStatus().then(setStatus, () => setStatus(null));
  }, []);
  const set = async (enabled: boolean) => {
    setBusy(true);
    try {
      const next = await api.shellMenuSet(enabled, i18n.language);
      setStatus(next);
      toast("positive", enabled ? t("settings.explorerAdded") : t("settings.explorerRemoved"));
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const other = status?.enabled && !status.current && status.exe;
  return (
    <Card>
      <CardHeader title={t("settings.explorerTitle")} />
      <div className="divide-y divide-line">
        <Row label={t("settings.explorerMenu")} hint={t("settings.explorerMenuHint")}>
          <Switch checked={!!status?.enabled} disabled={!status || busy} onChange={(v) => void set(v)} label={t("settings.explorerMenu")} />
        </Row>
        {other && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="selectable min-w-0 break-all font-mono text-[12px] text-ink-muted">{t("settings.explorerOther", { path: status.exe })}</span>
            <Button size="sm" loading={busy} onClick={() => void set(true)}>
              {t("settings.explorerUseThis")}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** A desktop shortcut that opens the quick clean review. The jump list task needs no setup. */
function QuickCleanShortcut() {
  const { t } = useTranslation();
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const path = await api.desktopShortcutCreate(t("overview.quickTitle"), t("overview.quickTaskHint"));
      toast("positive", t("settings.quickShortcutDone", { path }));
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title={t("settings.quickTitle")} />
      <Row label={t("settings.quickShortcut")} hint={t("settings.quickShortcutHint")}>
        <Button size="sm" icon={<Zap size={15} strokeWidth={1.75} />} loading={busy} onClick={() => void create()}>
          {t("settings.quickShortcutButton")}
        </Button>
      </Row>
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0 max-w-[60ch]">
        <div className="text-[14px] text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-ink-muted">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const { settings, info, saveSettings, toast } = useApp();
  const [update, setUpdate] = useState<UpdateResult | null>(null);
  const [checking, setChecking] = useState(false);
  const explorerMenu = useFeature("explorerMenu");
  const quickCleanShortcuts = useFeature("quickCleanShortcuts");
  const elevation = useFeature("elevation");
  if (!settings || !info) return null;

  const methodOptions = [
    { value: "permanent" as DeleteMethod, label: t("method.permanentShort") },
    { value: "recycle" as DeleteMethod, label: t("method.recycleShort") },
  ];

  const check = async () => {
    setChecking(true);
    setUpdate(await checkForUpdate(info.version));
    setChecking(false);
  };

  const restart = async () => {
    try {
      const ok = await api.restartElevated();
      if (!ok) toast("warning", t("tools.declined"));
    } catch (e) {
      toast("danger", errorText(e));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
      {info.settingsError && (
        <Banner tone="danger" action={<Button size="sm" onClick={() => void saveSettings({})}>{t("common.save")}</Button>}>
          {t("settings.settingsError")}
        </Banner>
      )}
      {info.ruleProblems.length > 0 && (
        <Banner tone="warning">
          {t("settings.rulesProblems")}
          <ul className="mt-1 list-disc pl-5 font-mono text-[11px]">
            {info.ruleProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Banner>
      )}

      <Card>
        <CardHeader title={t("settings.general")} />
        <div className="divide-y divide-line">
          <Row label={t("settings.language")}>
            <Select
              label={t("settings.language")}
              value={settings.language}
              onChange={(v) => void saveSettings({ language: v })}
              className="min-w-[220px]"
              options={[{ value: "system", label: t("settings.languageSystem") }, ...LANGUAGES.map((l) => ({ value: l.code as string, label: l.name }))]}
            />
          </Row>
          <Row label={t("settings.theme")}>
            <Segmented
              value={settings.theme}
              onChange={(v) => void saveSettings({ theme: v })}
              options={[
                { value: "system", label: t("settings.themeSystem") },
                { value: "light", label: t("settings.themeLight") },
                { value: "dark", label: t("settings.themeDark") },
              ]}
            />
          </Row>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("settings.cleaning")} />
        <div className="divide-y divide-line">
          <Row label={t("settings.cacheMethod")} hint={t(`method.${settings.cacheDelete}Hint`)}>
            <Segmented value={settings.cacheDelete} onChange={(v) => void saveSettings({ cacheDelete: v })} options={methodOptions} />
          </Row>
          <Row label={t("settings.filesMethod")} hint={t(`method.${settings.filesDelete}Hint`)}>
            <Segmented value={settings.filesDelete} onChange={(v) => void saveSettings({ filesDelete: v })} options={methodOptions} />
          </Row>
          <Row label={t("settings.showCaution")} hint={t("settings.showCautionHint")}>
            <Switch checked={settings.showCaution} onChange={(v) => void saveSettings({ showCaution: v })} label={t("settings.showCaution")} />
          </Row>
          <Row label={t("settings.idleDays")}>
            <Select label={t("settings.idleDays")} value={settings.idleDays} onChange={(v) => void saveSettings({ idleDays: v })} options={[7, 14, 30, 60, 90, 180].map((d) => ({ value: d, label: t("common.days", { count: d }) }))} />
          </Row>
          <Row label={t("settings.largeMin")}>
            <Select label={t("settings.largeMin")} value={settings.largeMinMb} onChange={(v) => void saveSettings({ largeMinMb: v })} options={[50, 100, 250, 500, 1024].map((v) => ({ value: v, label: fmt(v * 1024 * 1024) }))} />
          </Row>
          <Row label={t("settings.dupMin")}>
            <Select label={t("settings.dupMin")} value={settings.duplicateMinKb} onChange={(v) => void saveSettings({ duplicateMinKb: v })} options={[100, 1024, 10240, 102400].map((v) => ({ value: v, label: fmt(v * 1024) }))} />
          </Row>
          <Row label={t("settings.installerAge")}>
            <Select label={t("settings.installerAge")} value={settings.installerAgeDays} onChange={(v) => void saveSettings({ installerAgeDays: v })} options={[7, 30, 90, 180].map((d) => ({ value: d, label: t("common.days", { count: d }) }))} />
          </Row>
        </div>
      </Card>

      <Card>
        <CardHeader title={t("settings.locations")} />
        <div className="divide-y divide-line">
          <div className="px-4 py-3">
            <div className="text-[14px] text-ink">{t("settings.projectRoots")}</div>
            <div className="mb-2 text-[12px] text-ink-muted">{t("settings.projectRootsHint")}</div>
            <FolderList folders={settings.projectRoots} onChange={(f) => void saveSettings({ projectRoots: f })} suggestions={info.suggestedRoots} />
          </div>
          <div className="px-4 py-3">
            <div className="text-[14px] text-ink">{t("settings.exclusions")}</div>
            <div className="mb-2 text-[12px] text-ink-muted">{t("settings.exclusionsHint")}</div>
            <FolderList folders={settings.exclusions} onChange={(f) => void saveSettings({ exclusions: f })} />
          </div>
        </div>
      </Card>

      {explorerMenu && <ExplorerMenu />}
      {quickCleanShortcuts && <QuickCleanShortcut />}

      <Card>
        <CardHeader title={t("settings.updates")} />
        <div className="divide-y divide-line">
          <Row label={t("settings.checkUpdates")} hint={update ? undefined : t("settings.autoCheckHint")}>
            {update?.kind === "available" && (
              <Button size="sm" variant="primary" icon={<ExternalLink size={14} strokeWidth={1.75} />} onClick={() => void openUrl(update.url)}>
                {t("settings.viewRelease")}
              </Button>
            )}
            {update && (
              <span className="text-[13px] text-ink-secondary">
                {update.kind === "current" ? t("settings.upToDate") : update.kind === "available" ? t("settings.updateAvailable", { version: update.version }) : update.kind === "none" ? t("settings.noReleases") : t("settings.updateFailed")}
              </span>
            )}
            <Button size="sm" icon={<RefreshCw size={14} strokeWidth={1.75} />} loading={checking} onClick={() => void check()}>
              {checking ? t("settings.checking") : t("settings.checkUpdates")}
            </Button>
          </Row>
          <Row label={t("settings.autoCheck")} hint={t("settings.autoCheckHint")}>
            <Switch checked={settings.checkUpdates} onChange={(v) => void saveSettings({ checkUpdates: v })} label={t("settings.autoCheck")} />
          </Row>
        </div>
      </Card>

      {elevation && (
        <Card>
          <CardHeader title={t("settings.adminTitle")} />
          <Row label={info.elevated ? t("settings.adminOn") : t("settings.adminOff")}>
            {!info.elevated && (
              <Button size="sm" icon={<ShieldCheck size={14} strokeWidth={1.75} />} onClick={() => void restart()}>
                {t("settings.restartAdmin")}
              </Button>
            )}
          </Row>
        </Card>
      )}

      <Card>
        <CardHeader title={t("settings.about")} />
        <dl className="divide-y divide-line text-[14px]">
          {[
            [t("settings.version"), <span className="font-mono">{info.version}</span>],
            [t("settings.os"), <span className="font-mono">{osLabel(info.os)}</span>],
            [t("settings.mode"), info.portable ? t("settings.portableMode") : t("settings.installed")],
            [
              t("settings.dataFolder"),
              <span className="flex items-center gap-2">
                <span className="selectable max-w-[360px] truncate font-mono text-[12px]" title={info.dataDir}>
                  {info.dataDir}
                </span>
                <Button size="icon" variant="ghost" aria-label={t("common.open")} onClick={() => void api.open(info.dataDir).catch(() => undefined)}>
                  <FolderOpen size={15} strokeWidth={1.75} />
                </Button>
              </span>,
            ],
            [t("settings.license"), "MIT"],
          ].map(([k, v], i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <dt className="text-ink-secondary">{k}</dt>
              <dd className="text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
          <Button size="sm" icon={<GitBranch size={14} strokeWidth={1.75} />} onClick={() => void openUrl(REPO_URL)}>
            {t("settings.sourceCode")}
          </Button>
          <Button size="sm" variant="ghost" icon={<ExternalLink size={14} strokeWidth={1.75} />} onClick={() => void openUrl(`${REPO_URL}/issues/new/choose`)}>
            {t("settings.reportIssue")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
