// Guide export strings, as the addon reads and writes them (Export / import
// in the addon's Guides.lua): "L4G1:" followed by the base64 of the
// serialized guide (its name, faction, uid and everything in GUIDE_TABLES).
// importGuide cleans a guide exactly as the addon does on import, so what the
// website shows is what the addon will end up with.

import {
  GUIDE_TABLES,
  MAX_CHAPTER_LEVEL,
  MAX_NAME_LENGTH,
  MAX_OBJECTIVES,
  MAX_TEXT_LENGTH,
  NOTE_KINDS,
  isFaction,
  type Chapter,
  type ClassFile,
  type Coords,
  type Guide,
  type GuideItem,
  type NoteItem,
  type NoteKind,
  type QuestItem,
} from "./guide";
import { LuaTable, base64Decode, base64Encode, deserialize, luaToNumber, serialize, toLua, type LuaValue } from "./lua";

export const EXPORT_PREFIX = "L4G1:";
// 1 and 2 were older guide layouts, and 3 had no faction; the addon can't import any of them.
export const EXPORT_VERSION = 4;

export const IMPORT_ERRORS = {
  empty: "Paste a guide string first.",
  notAGuide: "That isn't a Level4ever guide string.",
  damaged: "The guide string is damaged. Make sure you copied all of it.",
  newer: "This guide was exported from a newer version of Level4ever. Update the addon to import it.",
  older: "This guide was exported from an old version of Level4ever and can't be imported any more.",
} as const;

// A new uid: 12 hex digits, like the addon makes.
export function newUid(): string {
  const n = () => Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, "0");
  return n() + n();
}

// The export string for a guide. A guide needs a uid so later exports can
// update copies of it in game; give it one first (see newUid) and keep it.
export function exportGuide(guide: Guide): string {
  if (!isFaction(guide.faction)) {
    throw new Error(`"${guide.name}" has no faction.`);
  }
  if (!guide.uid) {
    throw new Error(`"${guide.name}" has no uid.`);
  }
  const payload: Record<string, unknown> = {
    version: EXPORT_VERSION,
    name: guide.name,
    faction: guide.faction,
    uid: guide.uid,
  };
  for (const key of GUIDE_TABLES) {
    payload[key] = guide[key];
  }
  return EXPORT_PREFIX + base64Encode(serialize(toLua(payload)!));
}

export type ImportResult = { guide: Guide; error?: undefined } | { guide?: undefined; error: string };

export function importGuide(text: string): ImportResult {
  text = text.replace(/[ \t\n\v\f\r]/g, "");
  if (text === "") {
    return { error: IMPORT_ERRORS.empty };
  }
  if (!text.startsWith(EXPORT_PREFIX)) {
    return { error: IMPORT_ERRORS.notAGuide };
  }
  const raw = base64Decode(text.slice(EXPORT_PREFIX.length));
  let payload: LuaValue;
  try {
    payload = deserialize(raw ?? new Uint8Array());
  } catch {
    return { error: IMPORT_ERRORS.damaged };
  }
  if (!raw || !(payload instanceof LuaTable)) {
    return { error: IMPORT_ERRORS.damaged };
  }
  const version = toNumber(payload.get("version")) || 0;
  if (version > EXPORT_VERSION) {
    return { error: IMPORT_ERRORS.newer };
  } else if (version < EXPORT_VERSION) {
    return { error: IMPORT_ERRORS.older };
  }
  const guide = sanitizeGuide(payload);
  if (!guide) {
    return { error: IMPORT_ERRORS.damaged };
  }
  normalizeChapters(guide);
  return { guide };
}

///////////////////////////////////////////////////////////////////////////
// Cleaning an imported guide (SanitizeGuide and its helpers)
///////////////////////////////////////////////////////////////////////////

// Lua's tonumber: numbers and numeric strings; NaN otherwise.
function toNumber(value: LuaValue | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  return typeof value === "string" ? luaToNumber(value) : NaN;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// The first maxBytes bytes of text as UTF-8, without splitting a character
// (the addon cuts at the byte, which can leave half a character).
function truncateBytes(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) {
    return text;
  }
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) {
    end--;
  }
  return decoder.decode(bytes.subarray(0, end));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && value > 0 && Number.isInteger(value);
}

// strtrim(tostring(name or "")):sub(1, MAX_NAME_LENGTH), or the default if that's empty.
function cleanName(name: LuaValue | undefined, fallback: string): string {
  let text = "";
  if (typeof name === "string") {
    text = name;
  } else if (typeof name === "number") {
    text = String(name);
  } else if (name === true) {
    text = "true";
  } else if (name instanceof LuaTable) {
    text = "table";
  }
  text = truncateBytes(text.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, ""), MAX_NAME_LENGTH);
  return text !== "" ? text : fallback;
}

function cleanText(value: LuaValue | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? truncateBytes(value, MAX_TEXT_LENGTH) : undefined;
}

function isUid(value: LuaValue | undefined): value is string {
  return typeof value === "string" && value.length <= 32 && /^[0-9a-fA-F]+$/.test(value);
}

function cleanCoords(coords: LuaValue | undefined): Coords | undefined {
  if (coords instanceof LuaTable) {
    const mapID = coords.get("mapID");
    const x = coords.get("x");
    const y = coords.get("y");
    if (isPositiveInteger(mapID) && typeof x === "number" && typeof y === "number") {
      return { mapID, x, y };
    }
  }
  return undefined;
}

// A list of positive integers (e.g. quest IDs), or undefined if it has none.
function cleanIdList(list: LuaValue | undefined): number[] | undefined {
  if (!(list instanceof LuaTable)) {
    return undefined;
  }
  const clean = [...list.ipairs()].filter(isPositiveInteger);
  return clean.length > 0 ? clean : undefined;
}

// An objective's number: 1 to MAX_OBJECTIVES.
function isObjectiveIndex(value: unknown): value is number {
  return isPositiveInteger(value) && value <= MAX_OBJECTIVES;
}

function cleanObjectiveCoords(coordsByIndex: LuaValue | undefined): Record<number, Coords> | undefined {
  if (!(coordsByIndex instanceof LuaTable)) {
    return undefined;
  }
  const clean: Record<number, Coords> = {};
  for (const [index, coords] of coordsByIndex.pairs()) {
    const value = isObjectiveIndex(index) ? cleanCoords(coords) : undefined;
    if (value) {
      clean[index as number] = value;
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function cleanClass(value: LuaValue | undefined): ClassFile | undefined {
  return typeof value === "string" && /^[A-Z]+$/.test(value) ? value : undefined;
}

// How each per-quest table's values are checked: the clean value, or
// undefined to drop it.
const QUEST_VALUE_CLEANERS = {
  questCoords: cleanCoords,
  turnInCoords: cleanCoords,
  questClasses: cleanClass,
  optionalQuests: (value: LuaValue | undefined) => (value === true ? (true as const) : undefined),
  questPrereqs: cleanIdList,
  objectiveCoords: cleanObjectiveCoords,
} satisfies Record<Exclude<(typeof GUIDE_TABLES)[number], "chapters" | "items">, unknown>;

function cleanObjectives(objectives: LuaValue | undefined): true | number[] | undefined {
  if (objectives === true) {
    return true;
  } else if (objectives instanceof LuaTable) {
    const list = [...objectives.ipairs()].filter(isObjectiveIndex);
    return list.length > 0 ? list : undefined;
  }
  return undefined;
}

const NOTE_KIND_OK = new Set<unknown>(NOTE_KINDS.filter((kind) => kind !== "note"));

// Drops undefined fields, so a cleaned item has only what the addon keeps.
function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}

function cleanItem(item: LuaValue | undefined): GuideItem | undefined {
  if (!(item instanceof LuaTable)) {
    return undefined;
  }
  const id = item.get("id");
  if (!isPositiveInteger(id)) {
    return undefined;
  }
  // A bad chapterId is fixed by normalizeChapters, so anything goes for now.
  const chapterId = item.get("chapterId") as number;
  const batch = item.get("batch");
  const base = { id, chapterId, batch: isPositiveInteger(batch) ? batch : undefined };
  const type = item.get("type");
  const quest = item.get("quest");
  if (type === "quest" && isPositiveInteger(quest)) {
    return compact<QuestItem>({
      ...base,
      type: "quest",
      quest,
      pickup: item.get("pickup") === true ? true : undefined,
      objectives: cleanObjectives(item.get("objectives")),
      turnin: item.get("turnin") === true ? true : undefined,
      ongoing: item.get("ongoing") === true ? true : undefined,
      class: cleanClass(item.get("class")),
    });
  } else if (type === "note") {
    const kind = item.get("kind");
    const itemId = item.get("itemId");
    const count = item.get("count");
    return compact<NoteItem>({
      ...base,
      type: "note",
      text: cleanText(item.get("text")),
      kind: NOTE_KIND_OK.has(kind) ? (kind as NoteKind) : undefined,
      coords: cleanCoords(item.get("coords")),
      class: cleanClass(item.get("class")),
      itemId: isPositiveInteger(itemId) ? itemId : undefined,
      count: isPositiveInteger(count) ? count : undefined,
      prereqs: cleanIdList(item.get("prereqs")),
    });
  }
  return undefined;
}

// Builds a clean guide from imported data: chapters and items must have
// usable ids and known types, quest items only keep quest IDs and their
// actions, and per-quest tables only keep quest-ID keys with values of the
// right shape. Undefined if it has no faction.
function sanitizeGuide(payload: LuaTable): Guide | undefined {
  const faction = payload.get("faction");
  if (!isFaction(faction)) {
    return undefined;
  }
  const uid = payload.get("uid");
  const listOf = (key: string) => {
    const value = payload.get(key);
    return value instanceof LuaTable ? [...value.ipairs()] : [];
  };

  const chapters: Chapter[] = [];
  const chapterIds = new Set<number>();
  for (const chapter of listOf("chapters")) {
    if (!(chapter instanceof LuaTable)) {
      continue;
    }
    const id = chapter.get("id");
    if (isPositiveInteger(id) && !chapterIds.has(id)) {
      chapterIds.add(id);
      const level = chapter.get("level");
      chapters.push(
        compact({
          id,
          name: cleanName(chapter.get("name"), "Chapter"),
          level: isPositiveInteger(level) && level <= MAX_CHAPTER_LEVEL ? level : undefined,
        }),
      );
    }
  }

  const items: GuideItem[] = [];
  const itemIds = new Set<number>();
  for (const item of listOf("items")) {
    const clean = cleanItem(item);
    if (clean && !itemIds.has(clean.id)) {
      itemIds.add(clean.id);
      items.push(clean);
    }
  }

  const guide: Guide = compact({
    name: cleanName(payload.get("name"), "Imported guide"),
    faction,
    uid: isUid(uid) ? uid : undefined,
    chapters,
    items,
    questCoords: {},
    questClasses: {},
    optionalQuests: {},
    questPrereqs: {},
    objectiveCoords: {},
    turnInCoords: {},
  });
  for (const [key, clean] of Object.entries(QUEST_VALUE_CLEANERS)) {
    const values = payload.get(key);
    if (!(values instanceof LuaTable)) {
      continue;
    }
    const target = guide[key as keyof typeof QUEST_VALUE_CLEANERS] as Record<number, unknown>;
    for (const [questID, value] of values.pairs()) {
      const cleaned = isPositiveInteger(questID) ? clean(value) : undefined;
      if (cleaned !== undefined) {
        target[questID as number] = cleaned;
      }
    }
  }
  return guide;
}

///////////////////////////////////////////////////////////////////////////
// Chapters and batches (NormalizeChapters, SortItems and FixBatches in the
// addon's Core.lua)
///////////////////////////////////////////////////////////////////////////

function nextId(values: (number | undefined)[]): number {
  return Math.max(0, ...values.map((v) => v ?? 0)) + 1;
}

// Items whose chapter is missing go into the first chapter (made if there
// isn't one), items are grouped by chapter order, and batches are tidied.
export function normalizeChapters(guide: Guide): void {
  const valid = new Set(guide.chapters.map((chapter) => chapter.id));
  for (const item of guide.items) {
    if (!valid.has(item.chapterId)) {
      if (guide.chapters.length === 0) {
        const chapter = { id: nextId(guide.chapters.map((c) => c.id)), name: "Chapter 1" };
        guide.chapters.push(chapter);
        valid.add(chapter.id);
      }
      item.chapterId = guide.chapters[0]!.id;
    }
  }
  sortItems(guide);
  fixBatches(guide);
}

// Re-groups items by chapter order, keeping each chapter's items in order.
export function sortItems(guide: Guide): void {
  const order = new Map(guide.chapters.map((chapter, index) => [chapter.id, index]));
  guide.items = guide.items
    .map((item, index) => ({ item, index, chapter: order.get(item.chapterId) ?? Infinity }))
    .sort((a, b) => a.chapter - b.chapter || a.index - b.index)
    .map((entry) => entry.item);
}

// A batch is a contiguous run of at least two items in one chapter: a batch
// of one is no batch, and the same number in two places becomes two batches.
export function fixBatches(guide: Guide): void {
  const items = guide.items;
  let fresh = nextId(items.map((item) => item.batch));
  const seen = new Set<number>();
  let i = 0;
  while (i < items.length) {
    const batch = items[i]!.batch;
    if (batch === undefined) {
      i++;
      continue;
    }
    let j = i;
    while (items[j + 1]?.batch === batch && items[j + 1]!.chapterId === items[i]!.chapterId) {
      j++;
    }
    if (j === i) {
      delete items[i]!.batch;
    } else if (seen.has(batch)) {
      for (let k = i; k <= j; k++) {
        items[k]!.batch = fresh;
      }
      fresh++;
    }
    seen.add(batch);
    i = j + 1;
  }
}
