import { History as HistoryIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBytes, useLocale } from "../lib/hooks";
import { Badge, Button, Card, Dialog, EmptyState, PageHeader, Stat } from "../components/ui";
import { api } from "../lib/api";
import { formatCount, formatDateTime, splitBytes } from "../lib/format";
import type { HistoryEntry } from "../lib/types";
import { errorText, useApp } from "../store/app";

export function HistoryPage() {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const toast = useApp((s) => s.toast);
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    void api.history(500).then(setEntries).catch((e) => toast("danger", errorText(e)));
  }, [toast]);

  const total = (entries ?? []).reduce((s, e) => s + e.freed, 0);
  const totalSplit = splitBytes(total, locale);

  const clear = async () => {
    try {
      await api.historyClear();
      setEntries([]);
      setConfirm(false);
    } catch (e) {
      toast("danger", errorText(e));
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("history.title")}
        subtitle={t("history.subtitle")}
        actions={
          entries && entries.length > 0 ? (
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              {t("history.clear")}
            </Button>
          ) : null
        }
      />
      <div className="module-grid grid-cols-3">
        <Stat label={t("history.totalFreed")} value={totalSplit.value} unit={totalSplit.unit} />
        <Stat label={t("history.cleanups")} value={formatCount(entries?.length ?? 0, locale)} />
        <Stat label={t("history.last")} value={entries?.[0] ? formatDateTime(entries[0].time, locale) : t("common.never")} className="[&_.num]:text-[18px]" />
      </div>
      <Card className="overflow-hidden">
        {!entries || entries.length === 0 ? (
          <EmptyState icon={<HistoryIcon size={20} strokeWidth={1.75} />} title={t("history.none")} />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface text-left">
                <th className="label px-4 py-2 font-normal">{t("common.modified")}</th>
                <th className="label px-4 py-2 font-normal">{t("common.type")}</th>
                <th className="label px-4 py-2 text-right font-normal">{t("history.freed")}</th>
                <th className="label px-4 py-2 text-right font-normal">{t("history.recycled")}</th>
                <th className="label px-4 py-2 text-right font-normal">{t("common.files")}</th>
                <th className="label px-4 py-2 text-right font-normal">{t("history.failed")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.map((e, i) => (
                <tr key={`${e.time}-${i}`} className="hover:bg-surface">
                  <td className="px-4 py-2 font-mono text-[12px] text-ink-secondary">{formatDateTime(e.time, locale)}</td>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2 text-ink">
                      {t(`history.kinds.${e.kind}`, { defaultValue: e.kind })}
                      {e.elevated && <Badge tone="primary">{t("nav.admin")}</Badge>}
                    </span>
                    {e.items.length > 0 && (
                      <span className="selectable block max-w-[420px] truncate font-mono text-[11px] text-ink-muted" title={e.items.join("\n")}>
                        {e.items.slice(0, 4).join(", ")}
                        {e.items.length > 4 ? ` +${e.items.length - 4}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="num px-4 py-2 text-right font-mono text-ink">{fmt(e.freed)}</td>
                  <td className="num px-4 py-2 text-right font-mono text-ink-secondary">{fmt(e.recycled)}</td>
                  <td className="num px-4 py-2 text-right font-mono text-ink-secondary">{formatCount(e.files, locale)}</td>
                  <td className="num px-4 py-2 text-right font-mono text-ink-secondary">{formatCount(e.failed, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("history.clear")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={() => void clear()} data-autofocus>
              {t("history.clear")}
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-ink-secondary">{t("history.clearConfirm")}</p>
      </Dialog>
    </div>
  );
}
