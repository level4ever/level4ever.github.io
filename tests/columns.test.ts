// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { MIN_WIDTHS, gridColumns, loadColumnSizes, resizeColumns, saveColumnSizes } from "../src/app/columns";

// The default layout in a 1920px window.
const widths = { chapters: 200, steps: 400, map: 720, side: 600 };

afterEach(() => localStorage.clear());

describe("resizing the editor's columns", () => {
  test("a handle trades width between the two columns either side of it", () => {
    expect(resizeColumns(widths, 0, 50)).toEqual({ chapters: 250, steps: 350, side: 600 });
    // The map takes what's left, so it gains or loses with its neighbours.
    expect(resizeColumns(widths, 1, -100)).toEqual({ chapters: 200, steps: 300, side: 600 });
    expect(resizeColumns(widths, 2, -100)).toEqual({ chapters: 200, steps: 400, side: 700 });
  });

  test("no column goes under its minimum, however far it's dragged", () => {
    expect(resizeColumns(widths, 0, -1000)).toEqual({ chapters: MIN_WIDTHS.chapters, steps: 460, side: 600 });
    expect(resizeColumns(widths, 0, 1000)).toEqual({ chapters: 340, steps: MIN_WIDTHS.steps, side: 600 });
    expect(resizeColumns(widths, 1, 1000)).toEqual({ chapters: 200, steps: 400 + 720 - MIN_WIDTHS.map, side: 600 });
    expect(resizeColumns(widths, 2, 1000)).toEqual({ chapters: 200, steps: 400, side: MIN_WIDTHS.side });
    expect(resizeColumns(widths, 2, -1000)).toEqual({ chapters: 200, steps: 400, side: 600 + 720 - MIN_WIDTHS.map });
  });

  test("sizes become grid columns, the map taking what's left, with the handles' tracks between", () => {
    expect(gridColumns({ chapters: 250, steps: 350, side: 700 })).toBe(
      "minmax(140px, 250px) 0 minmax(260px, 350px) 0 minmax(240px, 1fr) 0 minmax(300px, 700px)",
    );
  });

  test("are kept in this browser, and reset to the defaults", () => {
    expect(loadColumnSizes()).toBeUndefined();
    saveColumnSizes({ chapters: 250, steps: 350, side: 700 });
    expect(loadColumnSizes()).toEqual({ chapters: 250, steps: 350, side: 700 });
    saveColumnSizes(undefined);
    expect(loadColumnSizes()).toBeUndefined();
  });

  test("anything else saved under the key is the defaults", () => {
    for (const saved of ["not json", "null", "[]", '{"chapters":250,"steps":350}', '{"chapters":-1,"steps":350,"side":700}']) {
      localStorage.setItem("level4ever:columns", saved);
      expect(loadColumnSizes()).toBeUndefined();
    }
  });
});
