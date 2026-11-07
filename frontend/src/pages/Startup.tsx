import { Lock, Power } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppIcon } from "../components/FileIcons";
import { Badge, Banner, Card, EmptyState, PageHeader, Skeleton, Switch } from "../components/ui";
import { exeFromCommand } from "../lib/format";
import { api } from "../lib/api";
import type { StartupItem } from "../lib/types";
import { errorText, useApp } from "../store/app";

export function StartupPage() {
  const { t } = useTranslation();
  const { info, toast } = useApp();
  const [items, setItems] = useState<StartupItem[] | null>(null);

  const load = () => void api.startup().then(setItems).catch((e) => toast("danger", errorText(e)));
  useEffect(() => {
    load();
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = async (item: StartupItem, enabled: boolean) => {
    setItems((prev) => prev?.map((i) => (i === item ? { ...i, enabled } : i)) ?? null);
    try {
      await api.startupSet(item.source, item.name, enabled);
    } catch (e) {
      toast("danger", errorText(e));
      load();
    }
  };

  const enabled = items?.filter((i) => i.enabled).length ?? 0;
  const locked = (i: StartupItem) => i.needsAdmin && !info?.elevated;

  return (
    <div className="space-y-5">
      <PageHeader title={t("startup.title")} subtitle={t("startup.subtitle")} meta={items ? <span className="num font-mono">{t("startup.enabledCount", { enabled, total: items.length })}</span> : null} />
      {items?.some(locked) && <Banner icon={<Lock size={15} strokeWidth={1.75} />}>{t("startup.adminHint")}</Banner>}
      <Card className="overflow-hidden">
        {items === null ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Power size={20} strokeWidth={1.75} />} title={t("startup.none")} />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((i) => (
              <li key={`${i.source}:${i.name}`} className="rail flex items-center gap-4 px-4 py-2.5 hover:bg-surface">
                <Switch checked={i.enabled} onChange={(v) => void set(i, v)} disabled={locked(i)} label={i.name} />
                <AppIcon path={i.source.startsWith("folder") ? i.command : exeFromCommand(i.command)} name={i.name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={i.enabled ? "truncate text-[14px] font-medium text-ink" : "truncate text-[14px] text-ink-secondary"}>{i.name}</span>
                    {locked(i) && <Lock size={13} strokeWidth={1.75} className="text-ink-muted" aria-label={t("common.needsAdmin")} />}
                  </div>
                  <div className="selectable truncate font-mono text-[12px] text-ink-muted" title={i.command}>
                    {i.command}
                  </div>
                </div>
                <Badge>{t(`startup.sources.${i.source}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
