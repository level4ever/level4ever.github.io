import { describe, expect, test } from "vitest";
import { addQuestStep } from "../src/lib/addQuest";
import { insertItems, newGuide } from "../src/lib/editor";
import type { Profile } from "../src/lib/questData";
import { groupByPlace, guideRoute, objectivePlaces, routeOnMap, stepPoints, stepRanges, type RoutePoint } from "../src/lib/route";
import { INDEX, QUESTS } from "./sampleData";

const anyone: Profile = { races: [], professions: [] };
const quest = (id: number) => QUESTS.find((q) => q.id === id)!;

describe("the route", () => {
  test("a step's points: pick up, objectives near the last place, turn in nearest", () => {
    const guide = newGuide("Test", "Horde");
    addQuestStep(guide, INDEX, quest(1), ["pickup", "objectives", "turnin"], { chapterId: 1, index: 0 }, anyone);
    // Quest 2's objective is a boar and a tusk with no spawns in the sample,
    // so only its pick-up and turn-in (Gornek, nearest of his two spots) show.
    addQuestStep(guide, INDEX, quest(2), ["pickup", "objectives", "turnin"], { chapterId: 1, index: 1 }, anyone);
    expect(guideRoute(guide, INDEX)).toEqual([
      { itemId: 1, kind: "pickup", coords: { mapID: 1411, x: 0.4329, y: 0.6853 }, fromGuide: true },
      { itemId: 1, kind: "turnin", coords: { mapID: 1411, x: 0.4206, y: 0.6833 }, fromGuide: false },
      { itemId: 2, kind: "pickup", coords: { mapID: 1411, x: 0.4206, y: 0.6833 }, fromGuide: true },
      { itemId: 2, kind: "turnin", coords: { mapID: 1411, x: 0.4206, y: 0.6833 }, fromGuide: false },
    ]);
  });

  test("the guide's own places win, and a note goes where it says", () => {
    const guide = newGuide("Test", "Horde");
    addQuestStep(guide, INDEX, quest(1), ["objectives", "turnin"], { chapterId: 1, index: 0 }, anyone);
    guide.objectiveCoords[1] = { 2: { mapID: 1411, x: 0.1, y: 0.1 } };
    guide.turnInCoords[1] = { mapID: 1411, x: 0.2, y: 0.2 };
    insertItems(guide, [{ type: "note", text: "Hearth", coords: { mapID: 1411, x: 0.3, y: 0.3 } }], { chapterId: 1, index: 1 });
    insertItems(guide, [{ type: "note", text: "Nowhere" }], { chapterId: 1, index: 2 });
    expect(guideRoute(guide, INDEX).map((p) => [p.itemId, p.kind, p.coords.x, p.fromGuide])).toEqual([
      [1, "objectives", 0.1, true],
      [1, "turnin", 0.2, true],
      [2, "note", 0.3, true],
    ]);
  });

  test("objective places: monsters, objects, item drops, kill credit and explored areas", () => {
    const withDrops = {
      ...INDEX,
      data: {
        ...INDEX.data,
        items: { 300: { id: 300, name: "Boar Tusk", npcDrops: [102] } },
        npcs: { ...INDEX.data.npcs, 102: { id: 102, name: "Mottled Boar", spawns: { 1411: [[50, 50] as [number, number]] } } },
      },
    };
    const places = objectivePlaces(withDrops, quest(2));
    expect(places.map((p) => Object.keys(p.spawns ?? {}))).toEqual([["1411"], ["1411"]]);
    // Only some objectives: just the tusk.
    expect(objectivePlaces(withDrops, quest(2), [2])).toHaveLength(1);
    const guide = newGuide("Test", "Horde");
    insertItems(guide, [{ type: "quest", quest: 2, objectives: true }], { chapterId: 1, index: 0 });
    expect(stepPoints(guide, withDrops, guide.items[0]!)).toEqual([
      { itemId: 1, kind: "objectives", coords: { mapID: 1411, x: 0.5, y: 0.5 }, fromGuide: false },
    ]);
  });
});

describe("a route on one map", () => {
  // Like Fire Totem Loop: Barrens, a trip to Durotar, back to the Barrens,
  // Durotar again, and ending in the Barrens.
  const BARRENS = 1413;
  const DUROTAR = 1411;
  const point = (itemId: number, mapID: number, x = itemId / 100): RoutePoint => ({
    itemId,
    kind: "objectives",
    coords: { mapID, x, y: 0.5 },
    fromGuide: true,
  });
  const route = [
    point(27, BARRENS),
    point(28, DUROTAR),
    point(29, DUROTAR),
    point(30, BARRENS),
    point(31, BARRENS),
    point(31, DUROTAR),
    point(32, DUROTAR),
    point(33, BARRENS),
  ];
  const ids = (points: RoutePoint[]) => points.map((p) => `${p.itemId}`).join(" ");

  test("is walked in stretches, broken where it goes elsewhere", () => {
    const barrens = routeOnMap(route, BARRENS);
    expect(barrens.legs.map(ids)).toEqual(["27", "30 31", "33"]);
    expect(barrens.exits.map((e) => [e.at.itemId, e.map, e.itemIds])).toEqual([
      [27, DUROTAR, [28, 29]],
      [31, DUROTAR, [31, 32]],
    ]);
    expect(barrens.entries.map((e) => [e.at.itemId, e.map])).toEqual([
      [30, DUROTAR],
      [33, DUROTAR],
    ]);
  });

  test("a map the chapter starts away from", () => {
    const durotar = routeOnMap(route, DUROTAR);
    expect(durotar.legs.map(ids)).toEqual(["28 29", "31 32"]);
    expect(durotar.entries.map((e) => [e.at.itemId, e.map])).toEqual([
      [28, BARRENS],
      [31, BARRENS],
    ]);
    expect(durotar.exits.map((e) => [e.at.itemId, e.map, e.itemIds])).toEqual([
      [29, BARRENS, [30, 31]],
      [32, BARRENS, [33]],
    ]);
  });

  test("step ranges and shared places", () => {
    expect(stepRanges([31, 28, 29, 33, 32, 40])).toBe("28–29, 31–33, 40");
    const same = [point(28, DUROTAR, 0.386), point(31, DUROTAR, 0.3861), point(32, DUROTAR, 0.5)];
    expect(groupByPlace(same).map(ids)).toEqual(["28 31", "32"]);
  });
});
