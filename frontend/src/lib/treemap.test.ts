import { describe, expect, it } from "vitest";
import { inset, squarify } from "./treemap";

describe("squarify", () => {
  const rect = { x: 0, y: 0, w: 600, h: 400 };
  const values = [600, 600, 400, 400, 300, 200, 100];

  it("fills the rectangle exactly", () => {
    const placed = squarify(values, (v) => v, rect);
    expect(placed).toHaveLength(values.length);
    const area = placed.reduce((s, p) => s + p.w * p.h, 0);
    expect(area).toBeCloseTo(rect.w * rect.h, 3);
  });

  it("keeps tiles inside bounds and proportional", () => {
    const placed = squarify(values, (v) => v, rect);
    const total = values.reduce((a, b) => a + b, 0);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x + p.w).toBeLessThanOrEqual(rect.w + 1e-6);
      expect(p.y + p.h).toBeLessThanOrEqual(rect.h + 1e-6);
      expect((p.w * p.h) / (rect.w * rect.h)).toBeCloseTo(p.item / total, 5);
    }
  });

  it("keeps aspect ratios reasonable", () => {
    const placed = squarify(values, (v) => v, rect);
    for (const p of placed) {
      expect(Math.max(p.w / p.h, p.h / p.w)).toBeLessThan(4);
    }
  });

  it("drops zero-sized items and handles empty input", () => {
    expect(squarify([0, 0], (v) => v, rect)).toEqual([]);
    expect(squarify([5, 0], (v) => v, rect)).toHaveLength(1);
    expect(squarify([5], (v) => v, { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
  });

  it("insets without going negative", () => {
    expect(inset({ x: 0, y: 0, w: 10, h: 10 }, 4, 8)).toEqual({ x: 4, y: 8, w: 2, h: 0 });
  });
});
