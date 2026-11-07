import { AlertTriangle, MonitorX } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Shell } from "./components/Shell";
import { Banner, EmptyState } from "./components/ui";
import { api, isDesktop, onProgress, onQuickClean, onShellAnalyze } from "./lib/api";
import { useFeature } from "./lib/hooks";
import { hasFeature } from "./lib/platform";
import { checkForUpdate } from "./lib/updates";
import { OverviewPage } from "./pages/Overview";
import { useApp } from "./store/app";

// Pages other than the Overview load on first visit, which keeps the startup bundle small.
const AiModelsPage = lazy(() => import("./pages/AiModels").then((m) => ({ default: m.AiModelsPage })));
const AppsPage = lazy(() => import("./pages/Apps").then((m) => ({ default: m.AppsPage })));
const AssistantsPage = lazy(() => import("./pages/Assistants").then((m) => ({ default: m.AssistantsPage })));
const CleanerPage = lazy(() => import("./pages/Cleaner").then((m) => ({ default: m.CleanerPage })));
const DownloadsPage = lazy(() => import("./pages/Downloads").then((m) => ({ default: m.DownloadsPage })));
const DuplicatesPage = lazy(() => import("./pages/Duplicates").then((m) => ({ default: m.DuplicatesPage })));
const EmptyFoldersPage = lazy(() => import("./pages/EmptyFolders").then((m) => ({ default: m.EmptyFoldersPage })));
const ExplorerPage = lazy(() => import("./pages/Explorer").then((m) => ({ default: m.ExplorerPage })));
const GamesPage = lazy(() => import("./pages/Games").then((m) => ({ default: m.GamesPage })));
const HistoryPage = lazy(() => import("./pages/History").then((m) => ({ default: m.HistoryPage })));
const LargeFilesPage = lazy(() => import("./pages/LargeFiles").then((m) => ({ default: m.LargeFilesPage })));
const ProjectsPage = lazy(() => import("./pages/Projects").then((m) => ({ default: m.ProjectsPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));
const StartupPage = lazy(() => import("./pages/Startup").then((m) => ({ default: m.StartupPage })));
const ToolsPage = lazy(() => import("./pages/Tools").then((m) => ({ default: m.ToolsPage })));

function Page() {
  const page = useApp((s) => s.page);
  switch (page) {
    case "overview":
      return <OverviewPage />;
    case "explorer":
      return <ExplorerPage />;
    case "large":
      return <LargeFilesPage />;
    case "duplicates":
      return <DuplicatesPage />;
    case "empty":
      return <EmptyFoldersPage />;
    case "junk":
      return <CleanerPage />;
    case "projects":
      return <ProjectsPage />;
    case "models":
      return <AiModelsPage />;
    case "assistants":
      return <AssistantsPage />;
    case "downloads":
      return <DownloadsPage />;
    case "games":
      return <GamesPage />;
    case "apps":
      return <AppsPage />;
    case "startup":
      return <StartupPage />;
    case "tools":
      return <ToolsPage />;
    case "history":
      return <HistoryPage />;
    case "settings":
      return <SettingsPage />;
  }
}

export function App() {
  const { t, i18n } = useTranslation();
  const boot = useApp((s) => s.boot);
  const ready = useApp((s) => s.ready);
  const bootError = useApp((s) => s.bootError);
  const settingsError = useApp((s) => s.info?.settingsError);
  const page = useApp((s) => s.page);
  const go = useApp((s) => s.go);
  const quickCleanShortcuts = useFeature("quickCleanShortcuts");
  const elevation = useFeature("elevation");
  const elevated = useApp((s) => !!s.info?.elevated);

  useEffect(() => {
    // Folders from Explorer's "Analyze with ReClaim": a cold start leaves them waiting, a
    // running copy is told when a burst of selected folders has arrived.
    const takePending = () => {
      void api
        .shellTakePending()
        .then((req) => req && useApp.getState().analyze(req))
        .catch(() => undefined);
    };
    // A shortcut or jump list task asked for the quick clean review.
    const takeQuickClean = () => {
      void api
        .quickCleanTake()
        .then((asked) => asked && useApp.getState().requestQuickClean())
        .catch(() => undefined);
    };
    void boot().then(() => {
      takePending();
      takeQuickClean();
      const { settings, info, platform, toast } = useApp.getState();
      // Installed copies add the Explorer entry the first time they start; say where it went.
      if (hasFeature(platform, "explorerMenu")) {
        void api
          .shellMenuDefault(i18n.language)
          .then((added) => added && toast("neutral", t("settings.explorerDefaultAdded")))
          .catch(() => undefined);
      }
      if (settings?.checkUpdates && info) {
        void checkForUpdate(info.version).then((r) => {
          if (r.kind === "available") toast("neutral", t("settings.updateAvailable", { version: r.version }));
        });
      }
    });
    const unlisten = onProgress((e) => useApp.getState().setProgress(e));
    const unlistenShell = onShellAnalyze(takePending);
    const unlistenQuick = onQuickClean(takeQuickClean);
    return () => {
      void unlisten.then((f) => f());
      void unlistenShell.then((f) => f());
      void unlistenQuick.then((f) => f());
    };
    // Boot once; `t` and `i18n` only format the startup toasts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);

  useEffect(() => {
    if (!ready || !isDesktop() || !quickCleanShortcuts) return;
    // The jump list keeps the text it was given, so it is rewritten when the language changes.
    void api.jumpListSet(t("overview.quickTitle"), t("overview.quickTaskHint")).catch(() => undefined);
  }, [ready, quickCleanShortcuts, t, i18n.language]);

  if (!isDesktop()) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon={<MonitorX size={20} strokeWidth={1.75} />} title={t("app.fullName")} body={t("common.desktopOnly")} />
      </div>
    );
  }
  if (!ready) return <div className="h-full bg-canvas" />;
  return (
    <Shell>
      {bootError && (
        <div className="mb-4">
          <Banner tone="danger" icon={<AlertTriangle size={16} strokeWidth={1.75} />}>
            {bootError}
          </Banner>
        </div>
      )}
      {elevated && !elevation && (
        <div className="mb-4">
          <Banner tone="warning" icon={<AlertTriangle size={16} strokeWidth={1.75} />}>
            {t("common.rootNoDelete")}
          </Banner>
        </div>
      )}
      {settingsError && page !== "settings" && (
        <div className="mb-4">
          <Banner
            tone="danger"
            icon={<AlertTriangle size={16} strokeWidth={1.75} />}
            action={
              <button type="button" className="font-medium underline" onClick={() => go("settings")}>
                {t("nav.settings")}
              </button>
            }
          >
            {t("settings.settingsError")}
          </Banner>
        </div>
      )}
      <Suspense fallback={null}>
        <Page />
      </Suspense>
    </Shell>
  );
}
