import { Archive, Database, HardDriveDownload, History as HistoryIcon, Moon, Package, ShieldAlert, Trash2, Wrench } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useBytes, useLocale } from "../lib/hooks";
import { Badge, Button, Dialog } from "../components/ui";
import { PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { formatCount } from "../lib/format";
import type { RecycleBinInfo, SystemFile, ToolId } from "../lib/types";
import { errorText, useApp } from "../store/app";

function ToolCard({ icon, title, body, value, command, admin, children }: { icon: ReactNode; title: string; body: ReactNode; value?: ReactNode; command?: string; admin?: boolean; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-primary">{icon}</span>
          <h3 className="display-medium text-[16px] text-ink">{title}</h3>
        </div>
        {admin && <Badge tone="primary">{t("common.needsAdmin")}</Badge>}
      </div>
      {value && <div className="num mt-3 font-mono text-[22px] text-ink">{value}</div>}
      <p className="mt-2 flex-1 text-[13px] text-ink-secondary">{body}</p>
      {command && <code className="selectable mt-3 block truncate rounded bg-surface-muted px-2 py-1 font-mono text-[11px] text-ink-secondary" title={command}>{command}</code>}
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function ToolsPage() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const { toast, junk, refreshDrives } = useApp();
  const [bin, setBin] = useState<RecycleBinInfo | null>(null);
  const [files, setFiles] = useState<SystemFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmBin, setConfirmBin] = useState(false);

  const load = () => {
    void api.recycleBinInfo().then(setBin).catch(() => setBin(null));
    void api.systemFiles().then(setFiles).catch(() => setFiles([]));
  };
  useEffect(load, []);

  const run = async (id: ToolId) => {
    setBusy(id);
    try {
      const r = await api.tool(id);
      if (r.cancelled) toast("warning", t("tools.declined"));
      else if (r.code !== null && r.code !== 0) toast("warning", t("tools.finished", { code: r.code }));
      else if (!["disk-cleanup", "storage-sense", "system-protection"].includes(id)) toast("positive", t("tools.finished", { code: 0 }));
      load();
      void refreshDrives();
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const emptyBin = async () => {
    setBusy("bin");
    try {
      const r = await api.recycleBinEmpty();
      setConfirmBin(false);
      toast("positive", t("overview.cleanedToast", { size: fmt(r.freed) }));
      load();
      void refreshDrives();
    } catch (e) {
      toast("danger", errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const hiber = files.find((f) => f.name === "hiberfil.sys");
  const page = files.find((f) => f.name === "pagefile.sys");
  const windowsOld = junk?.find((r) => r.id === "windows-old");
  const doCache = junk?.find((r) => r.id === "delivery-optimization");

  return (
    <div className="space-y-5">
      <PageHeader title={t("tools.title")} subtitle={t("tools.subtitle")} />
      <div className="module-grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        <ToolCard icon={<Trash2 size={16} strokeWidth={1.75} />} title={t("tools.recycleTitle")} value={bin ? fmt(bin.bytes) : "—"} body={t("tools.recycleBody", { items: formatCount(bin?.items ?? 0, locale) })}>
          <Button size="sm" variant="secondary" disabled={!bin || bin.items === 0} loading={busy === "bin"} onClick={() => setConfirmBin(true)}>
            {t("tools.recycleEmpty")}
          </Button>
        </ToolCard>
        <ToolCard
          icon={<Moon size={16} strokeWidth={1.75} />}
          title={t("tools.hibernateTitle")}
          value={hiber ? fmt(hiber.bytes) : "—"}
          body={hiber ? t("tools.hibernateBody") : t("tools.hibernateNone")}
          command={hiber ? "powercfg /hibernate off" : "powercfg /hibernate on"}
          admin
        >
          {hiber ? (
            <Button size="sm" variant="secondary" loading={busy === "hibernate-off"} onClick={() => void run("hibernate-off")}>
              {t("tools.hibernateOff")}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" loading={busy === "hibernate-on"} onClick={() => void run("hibernate-on")}>
              {t("tools.hibernateOn")}
            </Button>
          )}
        </ToolCard>
        <ToolCard icon={<Package size={16} strokeWidth={1.75} />} title={t("tools.dismTitle")} body={t("tools.dismBody")} command="Dism.exe /Online /Cleanup-Image /StartComponentCleanup" admin>
          <Button size="sm" variant="secondary" loading={busy === "dism-cleanup"} onClick={() => void run("dism-cleanup")}>
            {t("tools.run")}
          </Button>
        </ToolCard>
        <ToolCard
          icon={<HardDriveDownload size={16} strokeWidth={1.75} />}
          title={t("tools.doTitle")}
          value={doCache && doCache.bytes > 0 ? fmt(doCache.bytes) : undefined}
          body={t("tools.doBody")}
          command="Delete-DeliveryOptimizationCache -Force"
          admin
        >
          <Button size="sm" variant="secondary" loading={busy === "delivery-optimization"} onClick={() => void run("delivery-optimization")}>
            {t("tools.run")}
          </Button>
        </ToolCard>
        <ToolCard
          icon={<Archive size={16} strokeWidth={1.75} />}
          title={t("tools.oldTitle")}
          value={windowsOld && windowsOld.bytes > 0 ? fmt(windowsOld.bytes) : undefined}
          body={windowsOld && windowsOld.bytes > 0 ? t("tools.oldBody") : t("tools.oldNone")}
          command="cleanmgr.exe /autoclean"
          admin
        >
          <Button size="sm" variant="secondary" disabled={!windowsOld || windowsOld.bytes === 0} loading={busy === "windows-old"} onClick={() => void run("windows-old")}>
            {t("tools.run")}
          </Button>
        </ToolCard>
        <ToolCard icon={<Wrench size={16} strokeWidth={1.75} />} title={t("tools.cleanmgrTitle")} body={t("tools.cleanmgrBody")} command="cleanmgr.exe">
          <Button size="sm" variant="ghost" onClick={() => void run("disk-cleanup")}>
            {t("tools.openTool")}
          </Button>
        </ToolCard>
        <ToolCard icon={<Database size={16} strokeWidth={1.75} />} title={t("tools.senseTitle")} body={t("tools.senseBody")} command="ms-settings:storagesense">
          <Button size="sm" variant="ghost" onClick={() => void run("storage-sense")}>
            {t("tools.openTool")}
          </Button>
        </ToolCard>
        <ToolCard icon={<HistoryIcon size={16} strokeWidth={1.75} />} title={t("tools.restoreTitle")} body={t("tools.restoreBody")} command="SystemPropertiesProtection.exe">
          <Button size="sm" variant="ghost" onClick={() => void run("system-protection")}>
            {t("tools.openTool")}
          </Button>
        </ToolCard>
        {page && (
          <ToolCard icon={<ShieldAlert size={16} strokeWidth={1.75} />} title={t("tools.pagefile")} value={fmt(page.bytes)} body={page.path} />
        )}
      </div>
      <Dialog
        open={confirmBin}
        onClose={() => setConfirmBin(false)}
        title={t("tools.recycleEmpty")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmBin(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={busy === "bin"} onClick={() => void emptyBin()} data-autofocus>
              {t("tools.recycleEmpty")}
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-ink-secondary">{t("tools.recycleConfirm")}</p>
      </Dialog>
    </div>
  );
}
