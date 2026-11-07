// Squarified treemap layout (Bruls, Huizing, van Wijk). Items keep their input order, which is
// size-descending, so the biggest tile always sits top-left.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed<T> extends Rect {
  item: T;
}

function worst(row: number[], side: number, scale: number): number {
  let min = Infinity;
  let max = 0;
  let sum = 0;
  for (const v of row) {
    const a = v * scale;
    sum += a;
    if (a < min) min = a;
    if (a > max) max = a;
  }
  if (sum === 0 || side === 0) return Infinity;
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

export function squarify<T>(items: T[], value: (item: T) => number, rect: Rect): Placed<T>[] {
  const entries = items.map((item) => ({ item, v: Math.max(0, value(item)) })).filter((e) => e.v > 0);
  const total = entries.reduce((s, e) => s + e.v, 0);
  if (total === 0 || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const out: Placed<T>[] = [];
  let free: Rect = { ...rect };
  let i = 0;
  while (i < entries.length) {
    const side = Math.min(free.w, free.h);
    const row: typeof entries = [entries[i]!];
    i++;
    while (i < entries.length) {
      const next = entries[i]!;
      const current = row.map((e) => e.v);
      if (worst([...current, next.v], side, scale) <= worst(current, side, scale)) {
        row.push(next);
        i++;
      } else {
        break;
      }
    }
    const rowArea = row.reduce((s, e) => s + e.v * scale, 0);
    if (free.w >= free.h) {
      // Lay the row out as a column on the left.
      const colW = free.h > 0 ? rowArea / free.h : 0;
      let y = free.y;
      for (const e of row) {
        const h = colW > 0 ? (e.v * scale) / colW : 0;
        out.push({ item: e.item, x: free.x, y, w: colW, h });
        y += h;
      }
      free = { x: free.x + colW, y: free.y, w: free.w - colW, h: free.h };
    } else {
      const rowH = free.w > 0 ? rowArea / free.w : 0;
      let x = free.x;
      for (const e of row) {
        const w = rowH > 0 ? (e.v * scale) / rowH : 0;
        out.push({ item: e.item, x, y: free.y, w, h: rowH });
        x += w;
      }
      free = { x: free.x, y: free.y + rowH, w: free.w, h: free.h - rowH };
    }
  }
  return out;
}

/** Shrinks a rect by `pad` on every side, never below zero. */
export function inset(r: Rect, pad: number, top = pad): Rect {
  return { x: r.x + pad, y: r.y + top, w: Math.max(0, r.w - pad * 2), h: Math.max(0, r.h - pad - top) };
}
