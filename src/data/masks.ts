// SPDX-License-Identifier: GPL-3.0-only
// Race and class masks in quest data (Quest.races / Quest.classes), from
// QuestieDB's LibQuestieDB.Enum. The data pipeline fails if QuestieDB's
// values ever differ from these.

import type { Faction } from "./types";

export interface Race {
  id: number;
  name: string;
  faction: Faction;
  mask: number;
}

export const RACES: Race[] = [
  { id: 1, name: "Human", faction: "Alliance", mask: 1 },
  { id: 3, name: "Dwarf", faction: "Alliance", mask: 4 },
  { id: 4, name: "Night Elf", faction: "Alliance", mask: 8 },
  { id: 7, name: "Gnome", faction: "Alliance", mask: 64 },
  { id: 95, name: "Skyborne", faction: "Alliance", mask: 2 ** 32 },
  { id: 2, name: "Orc", faction: "Horde", mask: 2 },
  { id: 5, name: "Undead", faction: "Horde", mask: 16 },
  { id: 6, name: "Tauren", faction: "Horde", mask: 32 },
  { id: 8, name: "Troll", faction: "Horde", mask: 128 },
  { id: 96, name: "Skyborne", faction: "Horde", mask: 2 ** 33 },
];

export const FACTION_RACE_MASKS: Record<Faction, number> = {
  Alliance: RACES.filter((r) => r.faction === "Alliance").reduce((mask, r) => mask + r.mask, 0),
  Horde: RACES.filter((r) => r.faction === "Horde").reduce((mask, r) => mask + r.mask, 0),
};

// Class file names, as the addon's guides name them, and their masks.
export const CLASS_MASKS: Record<string, number> = {
  WARRIOR: 1,
  PALADIN: 2,
  HUNTER: 4,
  ROGUE: 8,
  PRIEST: 16,
  SHAMAN: 64,
  MAGE: 128,
  WARLOCK: 256,
  DRUID: 1024,
};

// Masks go past 32 bits (Skyborne), so no JS bitwise operators.
export function masksOverlap(a: number, b: number): boolean {
  return (BigInt(a) & BigInt(b)) !== 0n;
}
