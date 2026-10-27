// The editor's column widths, as the viewer drags them. Left alone, the
// columns take their default widths (see .editor in styles.css). Once one is
// dragged, the chapters, steps and side columns keep the widths they had then
// (in pixels, kept in this browser) and the map takes what's left, so a drag
// only moves the two columns either side of the handle.

import { useState } from "react";

export interface ColumnSizes {
  chapters: number;
  steps: number;
  side: number;
}

// Each column's width as laid out, the map's included.
export interface ColumnWidths extends ColumnSizes {
  map: number;
}

export const MIN_WIDTHS: ColumnWidths = { chapters: 140, steps: 260, map: 240, side: 300 };

// The handles, each between two columns: left to right.
export const SPLITTERS = [
  ["chapters", "steps"],
  ["steps", "map"],
  ["map", "side"],
] as const;

// The widths after dragging handle `splitter` by dx pixels: the column on its
// left gains what the one on its right loses, neither going under its minimum.
export function resizeColumns(widths: ColumnWidths, splitter: number, dx: number): ColumnSizes {
  const [left, right] = SPLITTERS[splitter]!;
  const total = widths[left] + widths[right];
  const leftWidth = Math.max(MIN_WIDTHS[left], Math.min(total - MIN_WIDTHS[right], widths[left] + dx));
  const next: ColumnWidths = { ...widths, [left]: leftWidth, [right]: total - leftWidth };
  return {
    chapters: Math.round(Math.max(MIN_WIDTHS.chapters, next.chapters)),
    steps: Math.round(Math.max(MIN_WIDTHS.steps, next.steps)),
    side: Math.round(Math.max(MIN_WIDTHS.side, next.side)),
  };
}

// The grid's columns for these sizes, handles' zero-width tracks between
// them. In a window too narrow for them all, the map gives way first, then
// the others down to their minimums.
export function gridColumns(sizes: ColumnSizes): string {
  const col = (min: number, width: number) => `minmax(${min}px, ${width}px)`;
  return [
    col(MIN_WIDTHS.chapters, sizes.chapters),
    col(MIN_WIDTHS.steps, sizes.steps),
    `minmax(${MIN_WIDTHS.map}px, 1fr)`,
    col(MIN_WIDTHS.side, sizes.side),
  ].join(" 0 ");
}

const KEY = "level4ever:columns";

function isSizes(value: unknown): value is ColumnSizes {
  const sizes = value as ColumnSizes | null;
  return (
    typeof sizes === "object" &&
    sizes !== null &&
    [sizes.chapters, sizes.steps, sizes.side].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
  );
}

// Storage may be unavailable (private windows), or hold something else; the
// sizes are only a convenience, so either way it's the defaults.
export function loadColumnSizes(): ColumnSizes | undefined {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return isSizes(saved) ? { chapters: saved.chapters, steps: saved.steps, side: saved.side } : undefined;
  } catch {
    return undefined;
  }
}

export function saveColumnSizes(sizes: ColumnSizes | undefined): void {
  try {
    if (sizes) localStorage.setItem(KEY, JSON.stringify(sizes));
    else localStorage.removeItem(KEY);
  } catch {
    // Kept for this visit only.
  }
}

// The viewer's column sizes (undefined: the defaults). `set` shows new sizes
// at once and `save` keeps them, so a drag saves once, when it ends.
export function useColumnSizes() {
  const [sizes, setSizes] = useState(loadColumnSizes);
  return {
    sizes,
    set: setSizes,
    save: (next: ColumnSizes) => {
      setSizes(next);
      saveColumnSizes(next);
    },
    reset: () => {
      setSizes(undefined);
      saveColumnSizes(undefined);
    },
  };
}
