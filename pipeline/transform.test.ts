// SPDX-License-Identifier: GPL-3.0-only
import { describe, expect, test } from "vitest";
import { FACTION_RACE_MASKS } from "../src/data/masks";
import { transform, type Dump } from "./transform";

const ORC = 2;
const HUMAN = 1;

// A tiny QuestieDB dump: Durotar (area 14 -> map 1411) with a subzone
// (Valley of Trials, 363), Orgrimmar (1637 -> 1454) and a dungeon (2437).
function dump(): Dump {
  return {
    meta: { faction: "Horde", flavor: "Forever", contractVersion: 4 },
    Quest: {
      "1": {
        name: "Orc only",
        requiredRaces: ORC,
        questLevel: 2,
        requiredLevel: 1,
        startedBy: [[10]],
        finishedBy: [[11], [20]],
        objectives: [[[12, null, 0]], [[21, "Burn the tent", 0]], [[30, null, 0]], null, [[[13, 14], 15, "Credit", 0]], null],
        triggerEnd: ["Explore the cave", [[363, [[45.5, 60.25]]]]],
        objectivesText: ["Do things.", ""],
        preQuestSingle: [5],
        exclusiveTo: [1],
        zoneOrSort: 14,
        specialFlags: 1,
      },
      "2": { name: "Alliance only", requiredRaces: HUMAN, startedBy: [[99]], objectives: [] },
      "3": { name: "Everyone, class quest", requiredClasses: 64, zoneOrSort: -82, objectives: [[[12, null, 0]], [[21, null, 0]]] },
      "5": { name: "One of three versions", preQuestSingle: [5, 6, 7], exclusiveTo: [5, 6, 7], objectives: [] },
      "4": { name: "Both factions' races", requiredRaces: FACTION_RACE_MASKS.Horde + FACTION_RACE_MASKS.Alliance, objectives: [], zoneOrSort: 367 },
    },
    Npc: {
      "10": { name: "Giver", subName: "Trainer", spawns: [[1637, [[50, 50]]], [363, [[44.4449, 66.6]]]] },
      "11": { name: "Ender", spawns: [[2437, [[-1, -1]]]] },
      "12": { name: "Target", spawns: [[14, [[10, 10], [11, 11]]]] },
      "13": { name: "Credit A" },
      "14": { name: "Credit B" },
      "15": { name: "Credit root" },
      "40": { name: "Drops the item", spawns: [[14, [[20, 20]]]] },
      "99": { name: "Not referenced by Horde quests" },
    },
    Object: { "20": { name: "Chest", spawns: [[14, [[1, 2]]]] }, "21": { name: "Tent" } },
    Item: { "30": { name: "Fang", npcDrops: [40], itemDrops: [31] }, "31": { name: "Box", objectDrops: [20] } },
    zones: {
      areaIdToUiMapId: { "14": 1411, "1637": 1454, "2437": 0 },
      subZoneToParentZone: { "363": 14, "367": 14 },
      zoneIDs: { DUROTAR: 14, ORGRIMMAR: 1637, VALLEY_OF_TRIALS: 363 },
    },
    enums: { raceMaskById: {}, factionRaceMasks: FACTION_RACE_MASKS, classKeys: {} },
    objectiveFirst: { objectObjectiveFirst: [3] },
  };
}

describe("transform", () => {
  const data = transform(dump(), "2026-01-01T00:00:00Z", "abc123");
  const quest = (id: number) => data.quests.find((q) => q.id === id);

  test("keeps the faction's quests and quests for everyone", () => {
    expect(data.quests.map((q) => q.id)).toEqual([1, 3, 4, 5]);
  });

  test("reshapes a quest", () => {
    expect(quest(1)).toEqual({
      id: 1,
      name: "Orc only",
      level: 2,
      minLevel: 1,
      races: ORC,
      startNpcs: [10],
      endNpcs: [11],
      endObjects: [20],
      objectives: [
        { type: "monster", id: 12 },
        { type: "object", id: 21, text: "Burn the tent" },
        { type: "item", id: 30 },
        { type: "killcredit", ids: [13, 14], id: 15, text: "Credit" },
        { type: "event", text: "Explore the cave", spawns: { 1411: [[45.5, 60.25]] } },
      ],
      text: ["Do things."],
      prereqAny: [5],
      zone: 14,
      repeatable: true,
    });
    expect(quest(3)).toMatchObject({ classes: 64, sort: 82 });
  });

  test("a quest that lists itself among its alternatives needs none of them", () => {
    expect(quest(5)).toMatchObject({ exclusiveTo: [6, 7] });
    expect(quest(5)!.prereqAny).toBeUndefined();
  });

  test("objectives of a type some quests list first come first", () => {
    expect(quest(3)!.objectives.map((o) => o.type)).toEqual(["object", "monster"]);
  });

  test("spawns go on the UiMap of their zone, or its parent zone's", () => {
    expect(data.npcs[10]).toEqual({
      id: 10,
      name: "Giver",
      subName: "Trainer",
      spawns: { 1454: [[50, 50]], 1411: [[44.44, 66.6]] },
    });
  });

  test("dungeons have no map, so they're listed as instances", () => {
    expect(data.npcs[11]).toEqual({ id: 11, name: "Ender", instances: [2437] });
  });

  test("only the NPCs, objects and items the quests involve, item drops included", () => {
    expect(Object.keys(data.npcs).map(Number)).toEqual([10, 11, 12, 13, 14, 15, 40]);
    expect(Object.keys(data.objects).map(Number)).toEqual([20, 21]);
    expect(Object.keys(data.items).map(Number).sort()).toEqual([30, 31]);
  });

  test("credits Questie", () => {
    expect(data.source.credit).toEqual({
      text:
        "Quest data from QuestieDB by the Questie team and contributors, modified by the Level4ever data pipeline " +
        "on 2026-01-01. Licensed under the GNU General Public License v3.",
      url: "https://github.com/Questie/QuestieDB/tree/abc123",
      license: "GPL-3.0-only",
    });
  });

  test("zone names", () => {
    // 367 has no name of its own, so its quests show their zone's.
    expect(data.areas).toEqual({ 14: "Durotar", 1637: "Orgrimmar", 363: "Valley of Trials", 367: "Durotar" });
    expect(data.maps).toEqual({ 1411: "Durotar", 1454: "Orgrimmar" });
  });
});
