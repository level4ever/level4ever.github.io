// SPDX-License-Identifier: GPL-3.0-only
// The quest data the website loads: public/data/<faction>.json, built from
// QuestieDB by pipeline/build-data.ts. Coordinates are 0-100 percentages of
// the map, as QuestieDB has them (the addon's Coords use 0-1).

export const FACTIONS = ["Horde", "Alliance"] as const;
export type Faction = (typeof FACTIONS)[number];

// Points by UiMapID (the map IDs the addon's Coords use).
export type Spawns = Record<number, [x: number, y: number][]>;

export interface Located {
  spawns?: Spawns;
  // AreaIDs of dungeons and other places with no map to show, where it also is.
  instances?: number[];
}

export interface Npc extends Located {
  id: number;
  name: string;
  subName?: string; // "Weapon Vendor"
  minLevel?: number;
  maxLevel?: number;
  friendlyTo?: "A" | "H" | "AH";
}

export interface WorldObject extends Located {
  id: number;
  name: string;
}

export interface Item {
  id: number;
  name: string;
  npcDrops?: number[];
  objectDrops?: number[];
  itemDrops?: number[]; // contained in these items
  vendors?: number[];
  startQuest?: number;
}

// One of a quest's objectives. A quest's objectives are listed in the order
// the game numbers them (as Questie orders them).
export type Objective =
  | { type: "monster"; id: number; text?: string }
  | { type: "object"; id: number; text?: string }
  | { type: "item"; id: number; text?: string }
  | { type: "reputation"; faction: number; value: number }
  | { type: "killcredit"; ids: number[]; id: number; text?: string }
  | { type: "spell"; id: number; text?: string; item?: number }
  | ({ type: "event"; text?: string } & Located);

export interface Quest {
  id: number;
  name: string;
  level: number; // the quest's level
  minLevel: number; // level needed to pick it up
  maxLevel?: number; // last level it's offered at
  races?: number; // race mask (see RACE_MASKS); none means every race
  classes?: number; // class mask (see CLASS_MASKS); none means every class
  startNpcs?: number[];
  startObjects?: number[];
  startItems?: number[]; // items that start it, e.g. a drop
  endNpcs?: number[];
  endObjects?: number[];
  objectives: Objective[];
  text?: string[]; // what the quest log says to do
  prereqAll?: number[]; // every one of these must be turned in first
  prereqAny?: number[]; // one of these must be turned in first
  exclusiveTo?: number[]; // can't do it once one of these is done
  next?: number; // the next quest in its chain
  parent?: number; // must have this quest in the log
  breadcrumbFor?: number; // an optional quest leading to this one
  breadcrumbs?: number[]; // optional quests leading to this one
  zone?: number; // AreaID it's listed under in the quest log
  sort?: number; // or the quest log category (QuestSort ID), for class/profession/etc. quests
  skill?: [skill: number, value: number]; // profession needed
  repeatable?: true;
  sourceItem?: number; // given by the quest giver
  sourceItems?: number[]; // needed, but not an objective
}

// Shown wherever the quest data is used or shared. The data is QuestieDB's,
// modified (reshaped) by pipeline/, and stays under QuestieDB's license.
export interface Credit {
  text: string;
  url: string; // QuestieDB at the commit the data was built from
  license: "GPL-3.0-only";
}

export function questieCredit(questiedbCommit: string, generated: string): Credit {
  return {
    text:
      "Quest data from QuestieDB by the Questie team and contributors, modified by the Level4ever " +
      `data pipeline on ${generated.slice(0, 10)}. Licensed under the GNU General Public License v3.`,
    url: `https://github.com/Questie/QuestieDB/tree/${questiedbCommit}`,
    license: "GPL-3.0-only",
  };
}

export interface QuestData {
  faction: Faction;
  source: { questiedb: string; generated: string; credit: Credit };
  quests: Quest[];
  npcs: Record<number, Npc>;
  objects: Record<number, WorldObject>;
  items: Record<number, Item>;
  maps: Record<number, string>; // UiMapID -> zone name
  areas: Record<number, string>; // AreaID -> zone name
}
