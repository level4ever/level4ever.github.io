// A Level4ever guide, as the addon saves it (see "Saved data" and "Items" in
// the addon's Core.lua). Maps keyed by quest ID use number keys; in an
// export string they're Lua number keys, which the addon requires.

import { FACTIONS, type Faction } from "../data/types";

export { FACTIONS, type Faction };

export function isFaction(value: unknown): value is Faction {
  return value === "Horde" || value === "Alliance";
}

// Limits the addon enforces on import.
export const MAX_NAME_LENGTH = 60; // bytes
export const MAX_TEXT_LENGTH = 255; // bytes
export const MAX_CHAPTER_LEVEL = 100;
export const MAX_OBJECTIVES = 10;

// A class file name, e.g. "SHAMAN".
export type ClassFile = string;

// x and y are 0-1 across the map, as the addon stores them.
export interface Coords {
  mapID: number; // UiMapID
  x: number;
  y: number;
}

export interface Chapter {
  id: number;
  name: string;
  level?: number; // to reach by the chapter's end
}

interface ItemBase {
  id: number;
  chapterId: number;
  batch?: number; // items sharing a batch are done together
  class?: ClassFile; // only for this class
}

export interface QuestItem extends ItemBase {
  type: "quest";
  quest: number;
  pickup?: true;
  objectives?: true | number[]; // all objectives, or these ones (1-based)
  turnin?: true;
  ongoing?: true;
}

// Each kind but a plain note ticks itself off in game.
export const NOTE_KINDS = ["note", "train", "hearth", "usehearth", "flight", "profession", "target", "loot"] as const;
export type NoteKind = Exclude<(typeof NOTE_KINDS)[number], "note">;

export interface NoteItem extends ItemBase {
  type: "note";
  text?: string;
  kind?: NoteKind; // none is a plain note
  coords?: Coords;
  itemId?: number; // "loot" only
  count?: number; // "loot" only
  prereqs?: number[]; // only after these quests
}

export type GuideItem = QuestItem | NoteItem;

export interface Guide {
  name: string;
  faction: Faction;
  uid?: string; // hex; which guide an export came from, so updates go onto the same guide
  chapters: Chapter[];
  items: GuideItem[]; // in guide order, grouped by chapter
  questCoords: Record<number, Coords>; // pick-up
  questClasses: Record<number, ClassFile>;
  optionalQuests: Record<number, true>;
  questPrereqs: Record<number, number[]>;
  objectiveCoords: Record<number, Record<number, Coords>>; // quest -> objective -> coords
  turnInCoords: Record<number, Coords>;
}

// The per-guide tables an export carries besides name, faction and uid.
export const GUIDE_TABLES = [
  "chapters",
  "items",
  "questCoords",
  "questClasses",
  "optionalQuests",
  "questPrereqs",
  "objectiveCoords",
  "turnInCoords",
] as const;

export function emptyGuide(name: string, faction: Faction): Guide {
  return {
    name,
    faction,
    chapters: [],
    items: [],
    questCoords: {},
    questClasses: {},
    optionalQuests: {},
    questPrereqs: {},
    objectiveCoords: {},
    turnInCoords: {},
  };
}
