// Reading a guide in order, as a character following it would: which quests
// are in the log at each step, what's wrong with each step, and which quests
// could be picked up at a point.

import type { Quest } from "../data/types";
import type { Coords, Guide, GuideItem } from "./guide";
import { HIDDEN_QUESTS, giverPlaces, nearestCoords, unavailableReason, type Profile, type QuestIndex } from "./questData";

export type Severity = "error" | "warning" | "info";

export interface Warning {
  severity: Severity;
  text: string;
}

// What a character has done by a point in the guide.
export interface GuideState {
  picked: Set<number>; // picked up, not turned in yet
  turnedIn: Set<number>;
  // The level they start the chapter at (the last target before it), and
  // the chapter's target, when the guide has them.
  levelFrom?: number;
  levelTo?: number;
  coords?: Coords; // the last place the guide sent them
}

// Does this step count for the profile's class? With no class set, every
// step counts.
function counts(guide: Guide, item: GuideItem, profile: Profile): boolean {
  if (!profile.class) {
    return true;
  }
  if (item.class && item.class !== profile.class) {
    return false;
  }
  const questClass = item.type === "quest" ? guide.questClasses[item.quest] : undefined;
  return !questClass || questClass === profile.class;
}

// Each chapter's level range: from the last level target before it, to its
// own target (or the start, if it has none).
function chapterLevels(guide: Guide): Map<number, { from?: number; to?: number }> {
  const levels = new Map<number, { from?: number; to?: number }>();
  let level: number | undefined;
  for (const chapter of guide.chapters) {
    levels.set(chapter.id, { from: level, to: chapter.level ?? level });
    level = chapter.level ?? level;
  }
  return levels;
}

function stepCoords(guide: Guide, item: GuideItem): Coords | undefined {
  if (item.type === "note") {
    return item.coords;
  }
  return item.pickup ? guide.questCoords[item.quest] : (guide.turnInCoords[item.quest] ?? guide.questCoords[item.quest]);
}

// The state just before guide.items[index] (or after the last item, for
// index = guide.items.length), in a chapter: the one new steps go in, which
// the index alone can't tell at a chapter's edge.
export function stateAt(guide: Guide, profile: Profile, index: number, chapterId?: number): GuideState {
  const state: GuideState = { picked: new Set(), turnedIn: new Set() };
  const at = chapterId ?? (guide.items[index] ?? guide.items[guide.items.length - 1])?.chapterId;
  const levels = at === undefined ? undefined : chapterLevels(guide).get(at);
  state.levelFrom = levels?.from;
  state.levelTo = levels?.to;
  guide.items.slice(0, index).forEach((item) => apply(guide, item, profile, state));
  return state;
}

function apply(guide: Guide, item: GuideItem, profile: Profile, state: GuideState): void {
  if (!counts(guide, item, profile)) {
    return;
  }
  state.coords = stepCoords(guide, item) ?? state.coords;
  if (item.type !== "quest") {
    return;
  }
  if (item.pickup && !state.turnedIn.has(item.quest)) {
    state.picked.add(item.quest); // a quest turned in can't be picked up again
  }
  if (item.turnin) {
    state.picked.delete(item.quest);
    state.turnedIn.add(item.quest);
  }
}

///////////////////////////////////////////////////////////////////////////
// Warnings
///////////////////////////////////////////////////////////////////////////

export function analyzeGuide(guide: Guide, index: QuestIndex, profile: Profile): Map<number, Warning[]> {
  const warnings = new Map<number, Warning[]>();
  const warn = (item: GuideItem, severity: Severity, text: string) => {
    (warnings.get(item.id) ?? warnings.set(item.id, []).get(item.id)!).push({ severity, text });
  };
  const name = (questID: number) => index.byId.get(questID)?.name ?? `quest ${questID}`;
  const chapterName = new Map(guide.chapters.map((c) => [c.id, c.name]));
  const levels = chapterLevels(guide);

  // Where each quest is picked up and turned in, by guide index, to tell
  // "later in the guide" from "not in it".
  const stepsAt = (tick: "pickup" | "turnin") => {
    const at = new Map<number, number[]>();
    guide.items.forEach((item, i) => {
      if (item.type === "quest" && item[tick] && counts(guide, item, profile)) {
        (at.get(item.quest) ?? at.set(item.quest, []).get(item.quest)!).push(i);
      }
    });
    return at;
  };
  const pickupsAt = stepsAt("pickup");
  const inGuide = new Set(guide.items.flatMap((item) => (item.type === "quest" && counts(guide, item, profile) ? [item.quest] : [])));
  const turnInsAt = stepsAt("turnin");
  const after = (at: Map<number, number[]>, questID: number, i: number) => {
    const later = at.get(questID)?.find((j) => j > i);
    return later === undefined ? undefined : guide.items[later];
  };
  const where = (item: GuideItem) => `in "${chapterName.get(item.chapterId)}"`;

  // Prerequisites that aren't turned in by this point.
  const checkPrereqs = (item: GuideItem, i: number, prereqs: number[], state: GuideState, fromGuide: boolean) => {
    for (const prereq of prereqs) {
      if (state.turnedIn.has(prereq)) {
        continue;
      }
      const later = after(turnInsAt, prereq, i);
      if (later) {
        warn(item, "error", `Needs "${name(prereq)}" turned in first, which happens later ${where(later)}`);
      } else if (turnInsAt.has(prereq)) {
        warn(item, "error", `Needs "${name(prereq)}" turned in first`);
      } else if (inGuide.has(prereq)) {
        warn(item, "warning", `Needs "${name(prereq)}" turned in first, but this guide never turns it in`);
      } else if (fromGuide) {
        warn(item, "info", `Needs "${name(prereq)}" done before this guide; otherwise the addon skips this`);
      } else {
        warn(item, "info", `Needs "${name(prereq)}" first, which isn't in this guide`);
      }
    }
  };

  const state: GuideState = { picked: new Set(), turnedIn: new Set() };
  const lastStep = new Map<number, GuideItem>();
  guide.items.forEach((item, i) => {
    if (!counts(guide, item, profile)) {
      apply(guide, item, profile, state);
      return;
    }
    if (item.type === "note") {
      checkPrereqs(item, i, item.prereqs ?? [], state, true);
      apply(guide, item, profile, state);
      return;
    }

    const quest = index.byId.get(item.quest);
    lastStep.set(item.quest, item);
    if (!item.pickup && !item.objectives && !item.turnin) {
      warn(item, "info", "Nothing is ticked, so the addon passes over this step");
    }
    if (!quest) {
      warn(item, "warning", `Quest ${item.quest} isn't in the quest data; check the ID`);
    } else {
      const reason = unavailableReason(quest, guide.faction, profile);
      if (reason) {
        warn(item, reason.startsWith("Not for") ? "error" : "warning", reason);
      }
    }
    const inLog = state.picked.has(item.quest) || state.turnedIn.has(item.quest);

    if (item.pickup) {
      if (state.picked.has(item.quest)) {
        warn(item, "warning", "Already picked up earlier");
      } else if (state.turnedIn.has(item.quest)) {
        warn(item, "error", "Already turned in earlier");
      }
      checkPrereqs(item, i, guide.questPrereqs[item.quest] ?? [], state, true);
      if (quest) {
        const fromData = (quest.prereqAll ?? []).filter((p) => !(guide.questPrereqs[item.quest] ?? []).includes(p));
        checkPrereqs(item, i, fromData, state, false);
        if (quest.prereqAny && !quest.prereqAny.some((p) => state.turnedIn.has(p))) {
          warn(item, "info", `Needs one of ${questNames(quest.prereqAny, name)} first`);
        }
        const level = levels.get(item.chapterId)?.to;
        if (level !== undefined && quest.minLevel > level) {
          warn(item, "warning", `Needs level ${quest.minLevel}, but this chapter only goes up to ${level}`);
        }
        for (const other of quest.exclusiveTo ?? []) {
          if (state.picked.has(other) || state.turnedIn.has(other)) {
            warn(item, "error", `Can't be taken after "${name(other)}"`);
          }
        }
      }
    } else if (!inLog && (item.objectives || item.turnin)) {
      // Picked up later is out of order; not at all, it's from an earlier guide.
      const later = after(pickupsAt, item.quest, i);
      if (later) {
        warn(item, "error", `Not picked up yet: that happens later ${where(later)}`);
      } else {
        warn(item, "info", "Not picked up in this guide, so it must be picked up before it");
      }
    }

    if (Array.isArray(item.objectives) && quest) {
      const missing = item.objectives.filter((n) => n > quest.objectives.length);
      if (missing.length > 0) {
        warn(item, "warning", `The quest has ${quest.objectives.length} objective(s), not ${Math.max(...missing)}`);
      }
    }
    if (item.turnin && state.turnedIn.has(item.quest) && !item.pickup) {
      warn(item, "error", "Already turned in earlier");
    }
    apply(guide, item, profile, state);
  });

  for (const questID of state.picked) {
    const item = lastStep.get(questID);
    if (item) {
      warn(item, "info", "Still in the quest log at the end of the guide");
    }
  }
  return warnings;
}

// Lowest level first, then by name. Quests whose level matches the
// player's (level 0 or below) go by the level needed to pick them up.
export function byLevel<T>(quest: (value: T) => Quest) {
  const level = (q: Quest) => (q.level > 0 ? q.level : q.minLevel);
  return (a: T, b: T) => level(quest(a)) - level(quest(b)) || quest(a).name.localeCompare(quest(b).name);
}

// "A" or "B", with the IDs of quests that share a name (e.g. each race's
// version of a class quest): "Call of Earth" (1517, 1518).
export function questNames(ids: number[], name: (id: number) => string, joiner = " or "): string {
  const byName = new Map<string, number[]>();
  for (const id of ids) {
    (byName.get(name(id)) ?? byName.set(name(id), []).get(name(id))!).push(id);
  }
  return [...byName].map(([n, list]) => (list.length > 1 ? `"${n}" (${list.join(", ")})` : `"${n}"`)).join(joiner);
}

///////////////////////////////////////////////////////////////////////////
// Quests to pick up at a point
///////////////////////////////////////////////////////////////////////////

export interface AvailableQuest {
  quest: Quest; // in level order, lowest first
  // ready: every earlier quest is done. earlier: needs quests that aren't in
  // this guide (perhaps done in an earlier one). locked: needs quests this
  // guide only turns in later.
  status: "ready" | "earlier" | "locked";
  distance?: number; // to the giver, across the map (0-1), if on the same map
}

export interface AvailableOptions {
  levelBelow: number; // hide quests this far under the current level (grey)
  levelAbove: number; // and this far over
  repeatable: boolean;
  locked: boolean;
}

// The game colours a quest red from 5 levels above the player.
const RED_LEVELS = 5;

export const DEFAULT_AVAILABLE_OPTIONS: AvailableOptions = { levelBelow: 6, levelAbove: 2, repeatable: false, locked: false };

export function availableQuests(
  guide: Guide,
  index: QuestIndex,
  profile: Profile,
  state: GuideState,
  options: AvailableOptions = DEFAULT_AVAILABLE_OPTIONS,
): AvailableQuest[] {
  const turnedInLater = new Set(
    guide.items.flatMap((item) => (item.type === "quest" && item.turnin && !state.turnedIn.has(item.quest) ? [item.quest] : [])),
  );
  const done = (id: number) => state.turnedIn.has(id);
  const result: AvailableQuest[] = [];
  for (const quest of index.data.quests) {
    if (state.picked.has(quest.id) || state.turnedIn.has(quest.id)) continue;
    if (HIDDEN_QUESTS.has(quest.id) || unavailableReason(quest, guide.faction, profile)) continue;
    if (quest.repeatable && !options.repeatable) continue;
    if (quest.exclusiveTo?.some((id) => state.picked.has(id) || done(id))) continue;
    const top = state.levelTo ?? state.levelFrom;
    if (top !== undefined && quest.minLevel > top + options.levelAbove) continue;
    // Red quests too: ones anyone can pick up but that are far above the
    // chapter, such as holiday quests.
    if (top !== undefined && quest.level >= top + RED_LEVELS) continue;
    const bottom = state.levelFrom ?? state.levelTo;
    if (bottom !== undefined && quest.level > 0 && quest.level < bottom - options.levelBelow) continue;
    const needs = [...(quest.prereqAll ?? []), ...(guide.questPrereqs[quest.id] ?? [])].filter((id) => !done(id));
    const needsAny = quest.prereqAny && !quest.prereqAny.some(done) ? quest.prereqAny : [];
    let status: AvailableQuest["status"] = "ready";
    if (needs.some((id) => turnedInLater.has(id)) || (needsAny.length > 0 && needsAny.every((id) => turnedInLater.has(id)))) {
      status = "locked";
    } else if (needs.length > 0 || needsAny.length > 0) {
      status = "earlier";
    }
    if (status === "locked" && !options.locked) continue;
    const giver = state.coords && nearestCoords(giverPlaces(index, quest), state.coords);
    const distance =
      giver && state.coords && giver.mapID === state.coords.mapID
        ? Math.hypot(giver.x - state.coords.x, giver.y - state.coords.y)
        : undefined;
    result.push({ quest, status, distance });
  }
  return result.sort(byLevel((a) => a.quest));
}
