import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { formatPercent } from "../lib/format";
import { inset, squarify, type Placed } from "../lib/treemap";
import type { NodeView } from "../lib/types";
import { useBytes, useLocale } from "../lib/hooks";
import {  } from "./ui";
import { cx } from "../lib/cx";

export type TreemapMode = "category" | "cleanup";

/** A child list plus a synthetic "N more" tile for children cut off by the server limit. */
type Tile = { kind: "node"; node: NodeView } | { kind: "rest"; bytes: number; count: number; parent: number };

function tilesOf(node: NodeView): Tile[] {
  const tiles: Tile[] = node.children.map((c) => ({ kind: "node", node: c }));
  if (node.restCount > 0 && node.restBytes > 0) tiles.push({ kind: "rest", bytes: node.restBytes, count: node.restCount, parent: node.id });
  return tiles;
}

const bytesOf = (t: Tile) => (t.kind === "node" ? t.node.bytes : t.bytes);

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function tileClass(node: NodeView, mode: TreemapMode, nested: boolean): string {
  if (mode === "cleanup") {
    if (node.marked === "safe") return "hatch-safe";
    if (node.marked) return "hatch-review";
    return "tile-neutral";
  }
  return cx(nested ? "tile-inner" : "tile", `cat-${node.category}`);
}

interface Hover {
  node?: NodeView;
  rest?: { bytes: number; count: number };
  x: number;
  y: number;
}

export function Treemap({
  node,
  mode,
  selectedId,
  onOpen,
  onSelect,
  height = 540,
}: {
  node: NodeView;
  mode: TreemapMode;
  selectedId: number | null;
  onOpen: (id: number) => void;
  onSelect: (node: NodeView) => void;
  height?: number;
}) {
  const { t } = useTranslation();
  const fmt = useBytes();
  const locale = useLocale();
  const [ref, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Hover | null>(null);

  const layout = useMemo(() => squarify(tilesOf(node), bytesOf, { x: 0, y: 0, w: size.w, h: size.h }), [node, size.w, size.h]);

  const label = (n: NodeView) => (n.kind === "small" ? `${t("explorer.smallFiles")} · ${n.files}` : n.name);

  const move = (e: MouseEvent, h: Omit<Hover, "x" | "y">) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ ...h, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const click = (n: NodeView) => {
    if (n.kind === "dir" && n.childCount > 0) onOpen(n.id);
    else onSelect(n);
  };

  const renderLeaf = (p: Placed<Tile>, nested: boolean, gap: number) => {
    const r = inset(p, gap / 2);
    if (r.w < 2 || r.h < 2) return null;
    const style = { left: r.x, top: r.y, width: r.w, height: r.h };
    if (p.item.kind === "rest") {
      const rest = p.item;
      return (
        <div
          key={`rest-${rest.parent}`}
          className="absolute rounded-[5px] border border-dashed border-line-strong bg-surface"
          style={style}
          onMouseMove={(e) => move(e, { rest })}
          onMouseLeave={() => setHover(null)}
        >
          {r.w > 70 && r.h > 26 && <span className="absolute left-2 top-1.5 truncate text-[11px] text-ink-muted">{t("explorer.moreItems", { count: rest.count })}</span>}
        </div>
      );
    }
    const n = p.item.node;
    const big = !nested && r.w > 150 && r.h > 100;
    const reclaim = n.reclaimSafe + n.reclaimReview;
    return (
      <button
        key={n.id}
        type="button"
        aria-label={`${label(n)}, ${fmt(n.bytes)}`}
        onClick={(e) => {
          e.stopPropagation();
          click(n);
        }}
        onMouseMove={(e) => move(e, { node: n })}
        onMouseLeave={() => setHover(null)}
        className={cx(
          "tile-interactive absolute overflow-hidden rounded-[5px] text-left",
          tileClass(n, mode, nested),
          selectedId === n.id && "outline outline-2 outline-offset-[-1px] outline-primary",
        )}
        style={style}
      >
        {r.w > 54 && r.h > 22 && <span className="absolute left-2 right-2 top-1.5 truncate text-[12px] leading-tight text-ink">{label(n)}</span>}
        {r.w > 64 && r.h > 46 && (
          <span className={cx("num absolute bottom-1.5 left-2 font-mono font-medium leading-none tracking-tight text-ink", big ? "text-[22px]" : "text-[13px]")}>{fmt(n.bytes)}</span>
        )}
        {mode === "cleanup" && !n.marked && reclaim > 0 && r.w > 90 && r.h > 46 && (
          <span className="absolute bottom-1.5 right-2 rounded-sm bg-positive-soft px-1 font-mono text-[11px] text-positive-fg">+{fmt(reclaim)}</span>
        )}
      </button>
    );
  };

  // Containers show their own children; level 1 nests when roomy, level 2 only when large, so
  // big folders such as AppData\Local still show what is inside them.
  const renderBox = (p: Placed<Tile>, level: number) => {
    const gap = level === 1 ? 6 : 4;
    if (p.item.kind === "rest") return renderLeaf(p, level > 1, gap);
    const n = p.item.node;
    const r = inset(p, gap / 2);
    const roomy = level === 1 ? r.w > 130 && r.h > 96 : r.w > 170 && r.h > 120;
    if (!(n.kind === "dir" && n.children.length > 0 && roomy && level < 3)) return renderLeaf(p, level > 1, gap);
    const header = level === 1 ? 28 : 24;
    const inner = inset({ x: 0, y: 0, w: r.w, h: r.h }, level === 1 ? 6 : 4, header);
    const kids = squarify(tilesOf(n), bytesOf, inner);
    const reclaim = n.reclaimSafe + n.reclaimReview;
    return (
      <div
        key={n.id}
        className={cx("absolute overflow-hidden", level === 1 ? "rounded-md" : "rounded-[5px]", tileClass(n, mode, level > 1), selectedId === n.id && "outline outline-2 outline-offset-[-1px] outline-primary")}
        style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
      >
        <button
          type="button"
          onClick={() => click(n)}
          onMouseMove={(e) => move(e, { node: n })}
          onMouseLeave={() => setHover(null)}
          aria-label={`${n.name}, ${fmt(n.bytes)}`}
          className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-2 text-left hover:underline"
          style={{ height: header }}
        >
          <span className={cx("truncate text-ink", level === 1 ? "text-[13px] font-medium" : "text-[12px]")}>{n.name}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {mode === "cleanup" && !n.marked && reclaim > 0 && <span className="rounded-sm bg-positive-soft px-1 font-mono text-[11px] text-positive-fg">+{fmt(reclaim)}</span>}
            <span className="num font-mono text-[12px] text-ink-secondary">{fmt(n.bytes)}</span>
          </span>
        </button>
        <div className="absolute inset-0">{kids.map((k) => renderBox(k, level + 1))}</div>
      </div>
    );
  };

  const tip = hover && (hover.node || hover.rest);
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }} onMouseLeave={() => setHover(null)}>
      {layout.map((p) => renderBox(p, 1))}
      {tip && hover && (
        <div
          className="z-popover pointer-events-none absolute max-w-[320px] rounded-md border border-line bg-canvas px-3 py-2 shadow-popover"
          style={{ left: Math.min(hover.x + 14, Math.max(0, size.w - 240)), top: Math.min(hover.y + 14, Math.max(0, height - 90)) }}
        >
          {hover.node ? (
            <>
              <div className="truncate text-[13px] font-medium text-ink">{label(hover.node)}</div>
              <div className="num mt-0.5 font-mono text-[12px] text-ink-secondary">
                {fmt(hover.node.bytes)} · {formatPercent(hover.node.bytes, node.bytes, locale)}
              </div>
              {hover.node.reclaimSafe + hover.node.reclaimReview > 0 && (
                <div className="mt-0.5 font-mono text-[12px] text-positive-fg">
                  {t("explorer.reclaimable")}: {fmt(hover.node.reclaimSafe + hover.node.reclaimReview)}
                </div>
              )}
              <div className="mt-0.5 truncate font-mono text-[11px] text-ink-muted">{t(`categories.${hover.node.category}`)}</div>
            </>
          ) : (
            hover.rest && (
              <div className="num font-mono text-[12px] text-ink-secondary">
                {t("explorer.moreItems", { count: hover.rest.count })} · {fmt(hover.rest.bytes)}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
