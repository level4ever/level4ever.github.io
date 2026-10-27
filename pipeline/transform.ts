// SPDX-License-Identifier: GPL-3.0-only
// Turns a QuestieDB dump (questiedb-dump.lua) into the website's quest data
// for one faction (src/data/types.ts): the quests that faction can see, and
// only the NPCs, objects and items those quests involve.

import { CLASS_MASKS, FACTION_RACE_MASKS, RACES, masksOverlap } from "../src/data/masks";
import { questieCredit, type Faction, type Item, type Located, type Npc, type Objective, type Quest, type QuestData, type Spawns, type WorldObject } from "../src/data/types";

type Id = number;
type Points = [number, number][];
type ByZone = [areaId: number, points: Points][];
type Row = Record<string, any>; // a dumped entity, keyed by QuestieDB field name

export interface Dump {
  meta: { faction: Faction; flavor: string; contractVersion: number };
  Quest: Record<string, Row>;
  Npc: Record<string, Row>;
  Object: Record<string, Row>;
  Item: Record<string, Row>;
  zones: {
    areaIdToUiMapId: Record<string, number>;
    subZoneToParentZone: Record<string, number>;
    zoneIDs: Record<string, number>;
  };
  enums: {
    raceMaskById: Record<string, number>;
    factionRaceMasks: Record<Faction, number>;
    classKeys: Record<string, number>;
  };
  objectiveFirst: Record<string, Id[]>;
}

// The version of QuestieDB's data contract (config.contractVersion) that
// transform reads. The site is built from QuestieDB's latest master, so a new
// contract, which may reshape the data, stops the build until it's checked.
export const QUESTIEDB_CONTRACT = 4;

export function checkContract(dump: Dump): void {
  if (dump.meta.contractVersion !== QUESTIEDB_CONTRACT) {
    throw new Error(
      `QuestieDB's data contract is version ${dump.meta.contractVersion}, but pipeline/transform.ts reads version ` +
        `${QUESTIEDB_CONTRACT}. Check what changed, update transform, then QUESTIEDB_CONTRACT.`,
    );
  }
}

// The masks in src/data/masks.ts must be QuestieDB's.
export function checkMasks(dump: Dump): void {
  for (const race of RACES) {
    if (dump.enums.raceMaskById[race.id] !== race.mask) {
      throw new Error(`QuestieDB's mask for race ${race.id} is ${dump.enums.raceMaskById[race.id]}, not ${race.mask}`);
    }
  }
  for (const faction of ["Alliance", "Horde"] as const) {
    if (dump.enums.factionRaceMasks[faction] !== FACTION_RACE_MASKS[faction]) {
      throw new Error(`QuestieDB's ${faction} race mask differs from src/data/masks.ts`);
    }
  }
  for (const [name, mask] of Object.entries(CLASS_MASKS)) {
    if (dump.enums.classKeys[name] !== mask) {
      throw new Error(`QuestieDB's mask for ${name} is ${dump.enums.classKeys[name]}, not ${mask}`);
    }
  }
}

const SMALL_WORDS = new Set(["of", "the", "and"]);

// DUN_MOROGH -> "Dun Morogh", VALLEY_OF_TRIALS -> "Valley of Trials"
function zoneName(symbol: string): string {
  return symbol
    .toLowerCase()
    .split("_")
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

const round = (n: number) => Math.round(n * 100) / 100;

// Drops undefined fields.
function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}

const nonEmpty = <T>(list: T[]): T[] | undefined => (list.length > 0 ? list : undefined);
const ids = (list: unknown): Id[] | undefined => (Array.isArray(list) ? nonEmpty(list as Id[]) : undefined);
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

export function transform(dump: Dump, generated: string, questiedb: string): QuestData {
  const faction = dump.meta.faction;
  const { areaIdToUiMapId, subZoneToParentZone, zoneIDs } = dump.zones;

  // The UiMapID an area's coordinates are on, going up through parent zones;
  // undefined for dungeons and anything else with no map.
  const uiMapOf = (area: number): number | undefined => {
    for (let depth = 0; depth < 8 && area; depth++) {
      const map = areaIdToUiMapId[area];
      if (map !== undefined) {
        return map || undefined; // 0: deliberately not shown
      }
      area = subZoneToParentZone[area] ?? 0;
    }
    return undefined;
  };

  const located = (byZone: ByZone | undefined): Located => {
    const spawns: Spawns = {};
    const instances = new Set<number>();
    for (const [area, points] of byZone ?? []) {
      const map = uiMapOf(area);
      const real = points.filter(([x, y]) => !(x === -1 && y === -1));
      if (!map || real.length < points.length) {
        instances.add(area);
      }
      if (map && real.length > 0) {
        (spawns[map] ??= []).push(...real.map(([x, y]) => [round(x), round(y)] as [number, number]));
      }
    }
    return compact({
      spawns: Object.keys(spawns).length > 0 ? spawns : undefined,
      instances: nonEmpty([...instances]),
    });
  };

  const objectiveFirst = Object.fromEntries(
    Object.entries(dump.objectiveFirst).map(([kind, quests]) => [kind, new Set(quests)]),
  );
  const first = (kind: string, quest: Id) => objectiveFirst[kind]?.has(quest) ?? false;

  // In the order the game numbers them: Questie's order (monsters, objects,
  // items, reputation, kill credit, spells, then the event), except that some
  // quests have one type first.
  const objectivesOf = (id: Id, row: Row): Objective[] => {
    const [monsters, objects, items, reputation, killCredits, spells] = (row.objectives ?? []) as any[];
    const list: Objective[] = [];
    const add = (objective: Objective, atStart: boolean) => (atStart ? list.unshift(objective) : list.push(objective));
    for (const [npc, label] of monsters ?? []) {
      add(compact({ type: "monster", id: npc, text: text(label) }), false);
    }
    for (const [object, label] of objects ?? []) {
      add(compact({ type: "object", id: object, text: text(label) }), first("objectObjectiveFirst", id));
    }
    for (const [item, label] of items ?? []) {
      add(compact({ type: "item", id: item, text: text(label) }), first("itemObjectiveFirst", id));
    }
    if (reputation) {
      add({ type: "reputation", faction: reputation[0], value: reputation[1] }, false);
    }
    for (const [npcs, root, label] of killCredits ?? []) {
      add(compact({ type: "killcredit", ids: npcs, id: root, text: text(label) }), first("killCreditObjectiveFirst", id));
    }
    for (const [spell, label, item] of spells ?? []) {
      add(compact({ type: "spell", id: spell, text: text(label), item: item || undefined }), first("spellObjectiveFirst", id));
    }
    if (row.triggerEnd) {
      const [label, byZone] = row.triggerEnd as [string, ByZone];
      add(compact({ type: "event", text: text(label), ...located(byZone) }), first("eventObjectiveFirst", id));
    }
    return list;
  };

  const factionMask = FACTION_RACE_MASKS[faction];
  const quests: Quest[] = [];
  for (const [key, row] of Object.entries(dump.Quest)) {
    const id = Number(key);
    const races: number | undefined = row.requiredRaces || undefined;
    if (races !== undefined && !masksOverlap(races, factionMask)) {
      continue; // the other faction's
    }
    const [startNpcs, startObjects, startItems] = (row.startedBy ?? []) as (Id[] | null)[];
    const [endNpcs, endObjects] = (row.finishedBy ?? []) as (Id[] | null)[];
    const zoneOrSort: number = row.zoneOrSort ?? 0;
    quests.push(
      compact({
        id,
        name: row.name,
        level: row.questLevel ?? 0,
        minLevel: row.requiredLevel ?? 0,
        maxLevel: row.requiredMaxLevel || undefined,
        races,
        classes: row.requiredClasses || undefined,
        startNpcs: ids(startNpcs),
        startObjects: ids(startObjects),
        startItems: ids(startItems),
        endNpcs: ids(endNpcs),
        endObjects: ids(endObjects),
        objectives: objectivesOf(id, row),
        text: Array.isArray(row.objectivesText) ? nonEmpty(row.objectivesText.filter(text)) : undefined,
        // A quest can't need itself. A "one of these" list that names the
        // quest itself is a set of alternative versions (each race's Call of
        // Earth, 1516 and 1519), which exclusiveTo already keeps apart: it
        // needs none of them.
        prereqAll: ids(row.preQuestGroup?.filter((other: Id) => other !== id)),
        prereqAny: row.preQuestSingle?.includes(id) ? undefined : ids(row.preQuestSingle),
        exclusiveTo: ids(row.exclusiveTo?.filter((other: Id) => other !== id)),
        next: row.nextQuestInChain || undefined,
        parent: row.parentQuest || undefined,
        breadcrumbFor: row.breadcrumbForQuestId || undefined,
        breadcrumbs: ids(row.breadcrumbs),
        zone: zoneOrSort > 0 ? zoneOrSort : undefined,
        sort: zoneOrSort < 0 ? -zoneOrSort : undefined,
        skill: row.requiredSkill?.[0] ? (row.requiredSkill as [number, number]) : undefined,
        repeatable: (row.specialFlags ?? 0) % 2 === 1 ? (true as const) : undefined,
        sourceItem: row.sourceItemId || undefined,
        sourceItems: ids(row.requiredSourceItems),
      }),
    );
  }
  quests.sort((a, b) => a.id - b.id);

  // Everything those quests involve.
  const npcIds = new Set<Id>();
  const objectIds = new Set<Id>();
  const itemIds = new Set<Id>();
  const addAll = (set: Set<Id>, list: (Id | undefined)[] | undefined) => list?.forEach((id) => id && set.add(id));
  for (const quest of quests) {
    addAll(npcIds, [...(quest.startNpcs ?? []), ...(quest.endNpcs ?? [])]);
    addAll(objectIds, [...(quest.startObjects ?? []), ...(quest.endObjects ?? [])]);
    addAll(itemIds, [...(quest.startItems ?? []), ...(quest.sourceItems ?? []), quest.sourceItem]);
    for (const objective of quest.objectives) {
      if (objective.type === "monster") npcIds.add(objective.id);
      else if (objective.type === "object") objectIds.add(objective.id);
      else if (objective.type === "item") itemIds.add(objective.id);
      else if (objective.type === "killcredit") addAll(npcIds, [objective.id, ...objective.ids]);
      else if (objective.type === "spell") addAll(itemIds, [objective.item]);
    }
  }

  const items: Record<Id, Item> = {};
  const pending = [...itemIds];
  while (pending.length > 0) {
    const id = pending.pop()!;
    const row = dump.Item[id];
    if (!row || items[id]) {
      continue;
    }
    const item: Item = compact({
      id,
      name: row.name,
      npcDrops: ids(row.npcDrops),
      objectDrops: ids(row.objectDrops),
      itemDrops: ids(row.itemDrops),
      vendors: ids(row.vendors),
      startQuest: row.startQuest || undefined,
    });
    items[id] = item;
    addAll(npcIds, [...(item.npcDrops ?? []), ...(item.vendors ?? [])]);
    addAll(objectIds, item.objectDrops);
    pending.push(...(item.itemDrops ?? []));
  }

  const npcs: Record<Id, Npc> = {};
  for (const id of [...npcIds].sort((a, b) => a - b)) {
    const row = dump.Npc[id];
    if (row) {
      npcs[id] = compact({
        id,
        name: row.name,
        subName: text(row.subName),
        minLevel: row.minLevel || undefined,
        maxLevel: row.maxLevel || undefined,
        friendlyTo: row.friendlyToFaction || undefined,
        ...located(row.spawns),
      });
    }
  }
  const objects: Record<Id, WorldObject> = {};
  for (const id of [...objectIds].sort((a, b) => a - b)) {
    const row = dump.Object[id];
    if (row) {
      objects[id] = compact({ id, name: row.name, ...located(row.spawns) });
    }
  }

  // Zone names, from QuestieDB's zone symbols. A map takes the name of a
  // zone (not a subzone) on it.
  const areas: Record<Id, string> = {};
  for (const [symbol, area] of Object.entries(zoneIDs)) {
    areas[area] ??= zoneName(symbol);
  }
  const maps: Record<Id, string> = {};
  for (const [area, name] of Object.entries(areas)) {
    const map = areaIdToUiMapId[area];
    if (map && subZoneToParentZone[area] === undefined) {
      maps[map] ??= name;
    }
  }
  // Quests listed under a subzone with no name of its own take its zone's.
  for (const quest of quests) {
    let area = quest.zone;
    for (let depth = 0; area && !areas[area] && depth < 8; depth++) {
      area = subZoneToParentZone[area];
    }
    if (quest.zone && area && areas[area]) {
      areas[quest.zone] ??= areas[area]!;
    }
  }

  return { faction, source: { questiedb, generated, credit: questieCredit(questiedb, generated) }, quests, npcs, objects, items, maps, areas };
}
