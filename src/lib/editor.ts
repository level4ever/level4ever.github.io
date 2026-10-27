// Changes to a guide, keeping the shape the addon expects: items grouped by
// chapter in chapter order, and every batch a run of at least two items in
// one chapter (see Chapters, Items and Batches in the addon's Core.lua).
// Each function changes the guide it's given, e.g. an immer draft.

import { MAX_CHAPTER_LEVEL, MAX_NAME_LENGTH, emptyGuide, type Chapter, type Faction, type Guide, type GuideItem } from "./guide";
import { fixBatches, newUid, nextId, sortItems, truncateBytes } from "./guideString";

// An item before it has an id: it gets one, and its chapter, when inserted.
export type NewItem = GuideItem extends infer T ? (T extends GuideItem ? Omit<T, "id" | "chapterId"> : never) : never;

// Where in a chapter: index 0 is before its first item, its length after its last.
export interface Position {
  chapterId: number;
  index: number;
}

// Trimmed and at most MAX_NAME_LENGTH bytes (the addon's limit).
export function cleanName(name: string): string {
  return truncateBytes(name.trim(), MAX_NAME_LENGTH);
}

// A new guide with one chapter to put steps in.
export function newGuide(name: string, faction: Faction): Guide {
  const guide = emptyGuide(cleanName(name) || "New guide", faction);
  guide.uid = newUid();
  guide.chapters.push({ id: 1, name: "Chapter 1" });
  return guide;
}

// A copy is a different guide, so it gets its own uid.
export function copyGuide(guide: Guide, name: string): Guide {
  const copy: Guide = structuredClone(guide);
  copy.name = cleanName(name) || "Copy";
  copy.uid = newUid();
  return copy;
}

///////////////////////////////////////////////////////////////////////////
// Chapters
///////////////////////////////////////////////////////////////////////////

export function getChapter(guide: Guide, chapterId: number): Chapter | undefined {
  return guide.chapters.find((chapter) => chapter.id === chapterId);
}

// Adds a chapter after afterChapterId, or at the end.
export function addChapter(guide: Guide, name: string, afterChapterId?: number): Chapter {
  const chapter: Chapter = { id: nextId(guide.chapters.map((c) => c.id)), name: cleanName(name) || "Chapter" };
  const after = guide.chapters.findIndex((c) => c.id === afterChapterId);
  guide.chapters.splice(after === -1 ? guide.chapters.length : after + 1, 0, chapter);
  sortItems(guide);
  return chapter;
}

export function renameChapter(guide: Guide, chapterId: number, name: string): void {
  const chapter = getChapter(guide, chapterId);
  const clean = cleanName(name);
  if (chapter && clean) {
    chapter.name = clean;
  }
}

// The level to reach by the chapter's end; undefined clears it.
export function setChapterLevel(guide: Guide, chapterId: number, level: number | undefined): void {
  const chapter = getChapter(guide, chapterId);
  if (!chapter) {
    return;
  }
  if (level !== undefined && Number.isInteger(level) && level > 0) {
    chapter.level = Math.min(level, MAX_CHAPTER_LEVEL);
  } else {
    delete chapter.level;
  }
}

export function moveChapter(guide: Guide, chapterId: number, toIndex: number): void {
  const from = guide.chapters.findIndex((c) => c.id === chapterId);
  if (from === -1) {
    return;
  }
  const [chapter] = guide.chapters.splice(from, 1);
  guide.chapters.splice(Math.max(0, Math.min(toIndex, guide.chapters.length)), 0, chapter!);
  sortItems(guide);
}

// Removes the chapter and every item in it.
export function deleteChapter(guide: Guide, chapterId: number): void {
  guide.chapters = guide.chapters.filter((c) => c.id !== chapterId);
  guide.items = guide.items.filter((item) => item.chapterId !== chapterId);
}

///////////////////////////////////////////////////////////////////////////
// Items
///////////////////////////////////////////////////////////////////////////

export function chapterItems(guide: Guide, chapterId: number): GuideItem[] {
  return guide.items.filter((item) => item.chapterId === chapterId);
}

export function getItem(guide: Guide, itemId: number): GuideItem | undefined {
  return guide.items.find((item) => item.id === itemId);
}

// The index in guide.items where an item at this position goes.
function globalIndex(guide: Guide, at: Position): number {
  const indexes = guide.items.flatMap((item, i) => (item.chapterId === at.chapterId ? [i] : []));
  if (at.index < indexes.length) {
    return indexes[Math.max(0, at.index)]!;
  }
  if (indexes.length > 0) {
    return indexes[indexes.length - 1]! + 1;
  }
  // An empty chapter: after every item of the chapters before it.
  const order = guide.chapters.findIndex((c) => c.id === at.chapterId);
  const before = new Set(guide.chapters.slice(0, order).map((c) => c.id));
  return guide.items.filter((item) => before.has(item.chapterId)).length;
}

// Inserts items, in order, at a position. Returns their ids.
export function insertItems(guide: Guide, items: NewItem[], at: Position): number[] {
  if (!getChapter(guide, at.chapterId)) {
    throw new Error(`no chapter ${at.chapterId}`);
  }
  let id = nextId(guide.items.map((item) => item.id));
  const added = items.map((item) => ({ ...item, id: id++, chapterId: at.chapterId }) as GuideItem);
  guide.items.splice(globalIndex(guide, at), 0, ...added);
  fixBatches(guide);
  return added.map((item) => item.id);
}

// Changes an item's fields; undefined removes a field.
export function updateItem(guide: Guide, itemId: number, patch: Partial<NewItem>): void {
  const item = getItem(guide, itemId) as Record<string, unknown> | undefined;
  if (!item) {
    return;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete item[key];
    } else {
      item[key] = value;
    }
  }
}

// Ticks or unticks objective n (of the quest's `count`) on a step that does
// objectives. Every one ticked is all of them (true), and the last one ticked
// stays: a step that does objectives does at least one.
export function toggleObjective(guide: Guide, itemId: number, n: number, count: number): void {
  const item = getItem(guide, itemId);
  if (item?.type !== "quest" || !item.objectives) {
    return;
  }
  const chosen = Array.isArray(item.objectives) ? item.objectives : Array.from({ length: count }, (_, i) => i + 1);
  const next = chosen.includes(n) ? chosen.filter((o) => o !== n) : [...chosen, n].sort((a, b) => a - b);
  if (next.length > 0) {
    item.objectives = next.length >= count ? true : next;
  }
}

export function deleteItem(guide: Guide, itemId: number): void {
  guide.items = guide.items.filter((item) => item.id !== itemId);
  fixBatches(guide);
}

// Moves an item to a position (counted as if it weren't in its chapter).
// It leaves its batch, unless it stays inside that batch's run.
export function moveItem(guide: Guide, itemId: number, to: Position): void {
  const from = guide.items.findIndex((item) => item.id === itemId);
  if (from === -1 || !getChapter(guide, to.chapterId)) {
    return;
  }
  const [item] = guide.items.splice(from, 1);
  item!.chapterId = to.chapterId;
  const index = globalIndex(guide, to);
  guide.items.splice(index, 0, item!);
  const batch = item!.batch;
  if (batch !== undefined && guide.items[index - 1]?.batch !== batch && guide.items[index + 1]?.batch !== batch) {
    delete item!.batch;
  }
  fixBatches(guide);
}

// Puts an item in a batch with the item before it in its chapter (joining
// that one's batch if it has one), or takes it out of its batch.
export function setBatchedWithPrevious(guide: Guide, itemId: number, batched: boolean): void {
  const index = guide.items.findIndex((item) => item.id === itemId);
  const item = guide.items[index];
  if (!item) {
    return;
  }
  if (!batched) {
    const batch = item.batch;
    delete item.batch;
    // Taken from the middle of a batch, the items after it would be split
    // off into a batch of their own; keep them with the ones before.
    if (batch !== undefined) {
      const rest = guide.items.slice(index + 1);
      const run = rest.findIndex((next) => next.batch !== batch);
      const after = rest.slice(0, run === -1 ? rest.length : run);
      if (after.length > 0 && guide.items[index - 1]?.batch === batch) {
        guide.items.splice(index + after.length, 0, ...guide.items.splice(index, 1));
      }
    }
  } else {
    const previous = guide.items[index - 1];
    if (!previous || previous.chapterId !== item.chapterId) {
      return;
    }
    previous.batch ??= nextId(guide.items.map((i) => i.batch));
    // Joining an item that was in another batch moves just this one.
    item.batch = previous.batch;
  }
  fixBatches(guide);
}

// Batches otherId with anchorId: if other is in a batch and anchor isn't,
// anchor joins it; otherwise other joins anchor's batch (starting one), as
// the addon's BatchItems does. The one joining moves next to the batch, so
// it stays in one piece, on the side it came from: from above, just before
// the batch; from below, just after. (The addon always puts it after, which
// swaps a step batched from above.) Only within a chapter. Returns the batch
// number.
export function batchItems(guide: Guide, anchorId: number, otherId: number): number | undefined {
  const anchor = getItem(guide, anchorId);
  const other = getItem(guide, otherId);
  if (!anchor || !other || anchor === other || anchor.chapterId !== other.chapterId) {
    return undefined;
  }
  if (anchor.batch !== undefined && other.batch === anchor.batch) {
    return anchor.batch;
  }
  const [joining, base] = other.batch !== undefined && anchor.batch === undefined ? [anchor, other] : [other, anchor];
  base.batch ??= nextId(guide.items.map((item) => item.batch));
  const fromAbove = guide.items.indexOf(joining) < guide.items.indexOf(base);
  guide.items.splice(guide.items.indexOf(joining), 1);
  joining.batch = base.batch;
  let first = guide.items.indexOf(base);
  let last = first;
  while (guide.items[first - 1]?.batch === base.batch) first--;
  while (guide.items[last + 1]?.batch === base.batch) last++;
  guide.items.splice(fromAbove ? first : last + 1, 0, joining);
  fixBatches(guide);
  return base.batch;
}

// Takes an item out of its batch (one from the middle moves to just after it).
export function unbatchItem(guide: Guide, itemId: number): void {
  setBatchedWithPrevious(guide, itemId, false);
}

///////////////////////////////////////////////////////////////////////////
// Per-quest settings
///////////////////////////////////////////////////////////////////////////

// The tables a guide keeps per quest, by quest ID. undefined clears.
export function setQuestValue<K extends "questCoords" | "turnInCoords" | "questClasses" | "questPrereqs">(
  guide: Guide,
  key: K,
  questID: number,
  value: Guide[K][number] | undefined,
): void {
  const table = guide[key] as Record<number, unknown>;
  if (value === undefined || (Array.isArray(value) && value.length === 0)) {
    delete table[questID];
  } else {
    table[questID] = value;
  }
}

export function setOptional(guide: Guide, questID: number, optional: boolean): void {
  if (optional) {
    guide.optionalQuests[questID] = true;
  } else {
    delete guide.optionalQuests[questID];
  }
}

// Quest IDs with at least one step in the guide.
export function questsInGuide(guide: Guide): Set<number> {
  return new Set(guide.items.flatMap((item) => (item.type === "quest" ? [item.quest] : [])));
}
