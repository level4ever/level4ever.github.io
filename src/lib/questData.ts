// Looking things up in the quest data (src/data/types.ts) for the editor.

import { CLASS_MASKS, FACTION_RACE_MASKS, RACES, masksOverlap } from "../data/masks";
import type { Located, Objective, Quest, QuestData } from "../data/types";
import type { ClassFile, Coords, Faction, Guide } from "./guide";

// Who a guide is for, beyond its faction. Website-only: not in export strings.
export interface Profile {
  races: number[]; // race IDs; none means every race of the faction
  class?: ClassFile; // none means any class
  professions: number[]; // skill IDs
}

export const CLASSES: { file: ClassFile; name: string }[] = [
  { file: "WARRIOR", name: "Warrior" },
  { file: "PALADIN", name: "Paladin" },
  { file: "HUNTER", name: "Hunter" },
  { file: "ROGUE", name: "Rogue" },
  { file: "PRIEST", name: "Priest" },
  { file: "SHAMAN", name: "Shaman" },
  { file: "MAGE", name: "Mage" },
  { file: "WARLOCK", name: "Warlock" },
  { file: "DRUID", name: "Druid" },
];

export const PROFESSIONS: { skill: number; name: string }[] = [
  { skill: 171, name: "Alchemy" },
  { skill: 164, name: "Blacksmithing" },
  { skill: 333, name: "Enchanting" },
  { skill: 202, name: "Engineering" },
  { skill: 182, name: "Herbalism" },
  { skill: 165, name: "Leatherworking" },
  { skill: 186, name: "Mining" },
  { skill: 393, name: "Skinning" },
  { skill: 197, name: "Tailoring" },
  { skill: 185, name: "Cooking" },
  { skill: 129, name: "First Aid" },
  { skill: 356, name: "Fishing" },
];

export function className(file: ClassFile): string {
  return CLASSES.find((c) => c.file === file)?.name ?? file;
}

export function racesFor(faction: Faction) {
  return RACES.filter((race) => race.faction === faction);
}

// The data's classes for a class mask, e.g. 64 -> ["SHAMAN"].
export function classesOf(mask: number | undefined): ClassFile[] {
  return mask ? CLASSES.filter((c) => masksOverlap(mask, CLASS_MASKS[c.file]!)).map((c) => c.file) : [];
}

export function raceNames(mask: number | undefined, faction: Faction): string[] {
  return mask ? racesFor(faction).filter((r) => masksOverlap(mask, r.mask)).map((r) => r.name) : [];
}

export interface QuestIndex {
  data: QuestData;
  byId: Map<number, Quest>;
}

export function indexQuestData(data: QuestData): QuestIndex {
  return { data, byId: new Map(data.quests.map((quest) => [quest.id, quest])) };
}

// Why a quest isn't for this guide's faction or profile, or undefined if it is.
export function unavailableReason(quest: Quest, faction: Faction, profile: Profile): string | undefined {
  if (quest.races !== undefined) {
    if (!masksOverlap(quest.races, FACTION_RACE_MASKS[faction])) {
      return `Not for the ${faction}`;
    }
    const races = racesFor(faction).filter((r) => profile.races.includes(r.id));
    if (races.length > 0 && !races.some((r) => masksOverlap(quest.races!, r.mask))) {
      return `Only for ${raceNames(quest.races, faction).join(", ")}`;
    }
  }
  if (quest.classes !== undefined && profile.class && !masksOverlap(quest.classes, CLASS_MASKS[profile.class] ?? 0)) {
    return `Only for ${classesOf(quest.classes).map(className).join(", ")}`;
  }
  if (quest.skill && !profile.professions.includes(quest.skill[0])) {
    const profession = PROFESSIONS.find((p) => p.skill === quest.skill![0])?.name ?? `skill ${quest.skill[0]}`;
    return `Needs ${profession} ${quest.skill[1]}`;
  }
  return undefined;
}

// A profile for a guide made elsewhere: the professions its quests need.
export function guessProfile(guide: Guide, index: QuestIndex): Profile {
  const professions = new Set<number>();
  for (const item of guide.items) {
    const skill = item.type === "quest" ? index.byId.get(item.quest)?.skill : undefined;
    if (skill) {
      professions.add(skill[0]);
    }
  }
  return { races: [], professions: [...professions] };
}

// Each race's first quest giver, where a new character starts.
const STARTING_NPCS: Record<number, number> = {
  1: 823, // Human: Deputy Willem, Northshire
  3: 658, // Dwarf: Sten Stoutarm, Coldridge Valley
  7: 658, // Gnome
  4: 2079, // Night Elf: Conservator Ilthalaine, Shadowglen
  95: 263113, // Skyborne: Myriaal Mistwake, Zephras Isle
  2: 10176, // Orc: Kaltunk, Valley of Trials
  8: 10176, // Troll
  5: 1568, // Undead: Undertaker Mordo, Deathknell
  6: 2981, // Tauren: Chief Hawkwind, Camp Narache
  96: 263113, // Skyborne
};

// Where the profile's (first) race starts, if it has one.
export function startingCoords(index: QuestIndex, profile: Profile): Coords | undefined {
  const npc = profile.races.map((race) => index.data.npcs[STARTING_NPCS[race] ?? 0]).find(Boolean);
  return npc && nearestCoords([npc]);
}

// The zone the profile's (first) race starts in, by name (as questRegion
// names zones): Durotar for an Orc.
export function startingZone(index: QuestIndex, profile: Profile): string | undefined {
  const coords = startingCoords(index, profile);
  return coords && index.data.maps[coords.mapID];
}

// Quests never suggested, though search still finds them: ones a levelling
// character can't or shouldn't do.
export const HIDDEN_QUESTS = new Map<number, string>([
  [5843, "Collector's Edition only"], // Welcome!
  [8744, "Winter Veil holiday"], // A Carefully Wrapped Present
  [8767, "Winter Veil holiday"], // A Gently Shaken Gift
  [8788, "Winter Veil holiday"], // A Gently Shaken Gift
  [8828, "Winter Veil holiday"], // Winter's Presents
  [78307, "Season of Discovery only"], // The Horn of Xelthos
  [80001, "Optional sleeping bag step, no rewards"], // Rekindle
]);

// The zone a quest is picked up in, by name: the map its quest giver is on,
// else the zone the quest log lists it under. Class quests and quests in a
// subzone (Valley of Trials) count as the zone they're in (Durotar).
export function questRegion(index: QuestIndex, quest: Quest): string | undefined {
  for (const place of giverPlaces(index, quest)) {
    for (const map of Object.keys(place.spawns ?? {})) {
      const name = index.data.maps[Number(map)];
      if (name) return name;
    }
  }
  return quest.zone ? index.data.areas[quest.zone] : undefined;
}

export function zoneName(index: QuestIndex, quest: Quest): string {
  if (quest.zone) {
    return index.data.areas[quest.zone] ?? `Zone ${quest.zone}`;
  }
  return quest.sort ? "Class, profession or other" : "";
}

function nameOf(index: QuestIndex, kind: "npcs" | "objects" | "items", id: number): string {
  return index.data[kind][id]?.name ?? `#${id}`;
}

// What an objective asks, in words.
export function objectiveText(index: QuestIndex, objective: Objective): string {
  switch (objective.type) {
    case "monster":
      return objective.text ?? `Kill ${nameOf(index, "npcs", objective.id)}`;
    case "object":
      return objective.text ?? `Use ${nameOf(index, "objects", objective.id)}`;
    case "item":
      return objective.text ?? `Collect ${nameOf(index, "items", objective.id)}`;
    case "killcredit":
      return objective.text ?? nameOf(index, "npcs", objective.id);
    case "spell":
      return objective.text ?? "Cast a spell";
    case "reputation":
      return `Reach ${objective.value} reputation`;
    case "event":
      return objective.text ?? "Explore";
  }
}

// Where to find something: the NPCs or objects with these IDs.
function places(index: QuestIndex, npcs: number[] = [], objects: number[] = []): Located[] {
  return [...npcs.map((id) => index.data.npcs[id]), ...objects.map((id) => index.data.objects[id])].filter(
    (entity): entity is NonNullable<typeof entity> => entity !== undefined,
  );
}

export function giverPlaces(index: QuestIndex, quest: Quest): Located[] {
  return places(index, quest.startNpcs, quest.startObjects);
}

export function turnInPlaces(index: QuestIndex, quest: Quest): Located[] {
  return places(index, quest.endNpcs, quest.endObjects);
}

// The point among these places nearest to `near` (on its map), else the
// first point there is, as the addon's Coords (0-1).
export function nearestCoords(placesList: Located[], near?: Coords): Coords | undefined {
  let best: { coords: Coords; distance: number } | undefined;
  for (const place of placesList) {
    for (const [map, points] of Object.entries(place.spawns ?? {})) {
      for (const [x, y] of points) {
        const coords = { mapID: Number(map), x: round4(x / 100), y: round4(y / 100) };
        const distance =
          near && near.mapID === coords.mapID ? Math.hypot(coords.x - near.x, coords.y - near.y) : Infinity;
        if (!best || distance < best.distance) {
          best = { coords, distance };
        }
      }
    }
  }
  return best?.coords;
}

// To 4 decimal places, as the addon's coords are kept.
export const round4 = (n: number) => Math.round(n * 10000) / 10000;
