import type { Quest, QuestData } from "../src/data/types";
import { indexQuestData } from "../src/lib/questData";

const ORC = 2;
const UNDEAD = 16;
const HUMAN = 1;

// A few Durotar quests: a chain (1 -> 2), a class quest, an Undead-only and
// an Alliance quest, one needing a profession, and a higher-level one.
export const QUESTS: Quest[] = [
  { id: 1, name: "Your Place in the World", level: 1, minLevel: 1, startNpcs: [100], endNpcs: [101], objectives: [], zone: 14 },
  {
    id: 2,
    name: "Cutting Teeth",
    level: 2,
    minLevel: 1,
    startNpcs: [101],
    endNpcs: [101],
    objectives: [{ type: "monster", id: 102 }, { type: "item", id: 300 }],
    prereqAll: [1],
    zone: 14,
  },
  { id: 3, name: "Call of Earth", level: 4, minLevel: 4, classes: 64, startNpcs: [103], endNpcs: [103], objectives: [], zone: 14 },
  { id: 4, name: "Undead Business", level: 2, minLevel: 1, races: UNDEAD, startNpcs: [104], objectives: [], zone: 85 },
  { id: 5, name: "Alliance Errand", level: 2, minLevel: 1, races: HUMAN, startNpcs: [104], objectives: [], zone: 12 },
  { id: 6, name: "Fishing Lesson", level: 5, minLevel: 5, skill: [356, 1], startNpcs: [100], objectives: [], zone: 14 },
  { id: 7, name: "Later On", level: 12, minLevel: 10, races: ORC, startNpcs: [100], objectives: [], zone: 14 },
  { id: 9, name: "Lunar Elder", level: 60, minLevel: 1, startNpcs: [100], objectives: [] },
  { id: 8, name: "Either Way", level: 3, minLevel: 1, prereqAny: [1, 9], startNpcs: [101], objectives: [], zone: 14 },
];

export const DATA: QuestData = {
  faction: "Horde",
  source: {
    questiedb: "abc",
    generated: "2026-01-01T00:00:00Z",
    credit: { text: "Quest data from QuestieDB", url: "https://github.com/Questie/QuestieDB/tree/abc", license: "GPL-3.0-only" },
  },
  quests: QUESTS,
  npcs: {
    100: { id: 100, name: "Kaltunk", spawns: { 1411: [[43.29, 68.53]] } },
    10176: { id: 10176, name: "Kaltunk", spawns: { 1411: [[43.29, 68.53]] } },
    101: { id: 101, name: "Gornek", spawns: { 1411: [[42.06, 68.33], [80, 80]] } },
    102: { id: 102, name: "Mottled Boar" },
    103: { id: 103, name: "Shikrik", spawns: { 1411: [[42.39, 69.0]] } },
    104: { id: 104, name: "Somebody", spawns: { 1420: [[30, 70]] } },
  },
  objects: {},
  items: { 300: { id: 300, name: "Boar Tusk" } },
  maps: { 1411: "Durotar", 1420: "Tirisfal Glades" },
  areas: { 14: "Durotar", 12: "Elwynn Forest", 85: "Tirisfal Glades" },
};

export const INDEX = indexQuestData(DATA);
