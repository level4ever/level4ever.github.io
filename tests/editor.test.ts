import { describe, expect, test } from "vitest";
import type { Guide, QuestItem } from "../src/lib/guide";
import { exportGuide, importGuide } from "../src/lib/guideString";
import {
  addChapter,
  batchItems,
  cleanName,
  copyGuide,
  deleteChapter,
  deleteItem,
  insertItems,
  moveChapter,
  moveItem,
  newGuide,
  questsInGuide,
  setBatchedWithPrevious,
  setChapterLevel,
  toggleObjective,
  unbatchItem,
} from "../src/lib/editor";
import { addQuestStep } from "../src/lib/addQuest";
import { DEFAULT_AVAILABLE_OPTIONS, analyzeGuide, availableQuests, stateAt } from "../src/lib/analysis";
import { indexQuestData, questRegion, startingCoords, startingZone, unavailableReason, type Profile } from "../src/lib/questData";
import { DATA, INDEX, QUESTS } from "./sampleData";

const quest = (id: number) => QUESTS.find((q) => q.id === id)!;
const anyone: Profile = { races: [], professions: [] };
const ids = (guide: Guide) => guide.items.map((item) => item.id);
const batches = (guide: Guide) => guide.items.map((item) => item.batch ?? "-").join(" ");

// A guide with chapters 1 and 2, three plain notes in each.
function sample(): Guide {
  const guide = newGuide("Test", "Horde");
  addChapter(guide, "Second");
  insertItems(guide, ["a", "b", "c"].map((text) => ({ type: "note", text })), { chapterId: 1, index: 0 });
  insertItems(guide, ["d", "e", "f"].map((text) => ({ type: "note", text })), { chapterId: 2, index: 0 });
  return guide;
}

describe("editing a guide", () => {
  test("a new guide has a uid and a chapter, and exports", () => {
    const guide = newGuide("  Orc 1-12  ", "Horde");
    expect(guide).toMatchObject({ name: "Orc 1-12", faction: "Horde", chapters: [{ id: 1, name: "Chapter 1" }] });
    expect(guide.uid).toMatch(/^[0-9a-f]{12}$/);
    expect(importGuide(exportGuide(guide)).guide).toEqual(guide);
    expect(copyGuide(guide, "Copy").uid).not.toBe(guide.uid);
  });

  test("names are cut at the addon's 60 bytes, whole characters only", () => {
    expect(new TextEncoder().encode(cleanName("✓".repeat(30))).length).toBe(60);
    expect(cleanName("é".repeat(40))).toBe("é".repeat(30));
    expect(cleanName("  Valley  ")).toBe("Valley");
  });

  test("the quests a guide has steps for", () => {
    const guide = sample();
    expect(questsInGuide(guide)).toEqual(new Set());
    insertItems(
      guide,
      [
        { type: "quest", quest: 1, pickup: true },
        { type: "quest", quest: 1, turnin: true },
        { type: "quest", quest: 2, pickup: true },
      ],
      { chapterId: 2, index: 0 },
    );
    expect(questsInGuide(guide)).toEqual(new Set([1, 2]));
  });

  test("items go where they're put and stay grouped by chapter", () => {
    const guide = sample();
    expect(ids(guide)).toEqual([1, 2, 3, 4, 5, 6]);
    insertItems(guide, [{ type: "note", text: "x" }], { chapterId: 1, index: 1 });
    insertItems(guide, [{ type: "note", text: "y" }], { chapterId: 2, index: 99 });
    expect(ids(guide)).toEqual([1, 7, 2, 3, 4, 5, 6, 8]);
    const empty = addChapter(guide, "Middle", 1);
    insertItems(guide, [{ type: "note", text: "z" }], { chapterId: empty.id, index: 0 });
    expect(ids(guide)).toEqual([1, 7, 2, 3, 9, 4, 5, 6, 8]);
  });

  test("moving items and chapters", () => {
    const guide = sample();
    moveItem(guide, 1, { chapterId: 2, index: 1 });
    expect(ids(guide)).toEqual([2, 3, 4, 1, 5, 6]);
    moveChapter(guide, 2, 0);
    expect(ids(guide)).toEqual([4, 1, 5, 6, 2, 3]);
    deleteChapter(guide, 2);
    expect(ids(guide)).toEqual([2, 3]);
  });

  test("batches stay runs of two or more in one chapter", () => {
    const guide = sample();
    setBatchedWithPrevious(guide, 2, true);
    setBatchedWithPrevious(guide, 3, true);
    expect(batches(guide)).toBe("1 1 1 - - -");
    setBatchedWithPrevious(guide, 4, true); // the first in its chapter: no item before it there
    expect(batches(guide)).toBe("1 1 1 - - -");
    // Out of the middle of a batch: it moves after the rest, which stay together.
    setBatchedWithPrevious(guide, 2, false);
    expect(ids(guide)).toEqual([1, 3, 2, 4, 5, 6]);
    expect(batches(guide)).toBe("1 1 - - - -");
    // Moved out of its batch, the one left on its own is no batch.
    moveItem(guide, 3, { chapterId: 2, index: 3 });
    expect(batches(guide)).toBe("- - - - - -");
    deleteItem(guide, 1);
    expect(ids(guide)).toEqual([2, 4, 5, 6, 3]);
  });
});

describe("batching, as the addon's Batch button does", () => {
  test("a step joins the one it's batched with, next to its batch", () => {
    const guide = sample(); // chapter 1: 1 2 3, chapter 2: 4 5 6
    expect(batchItems(guide, 1, 3)).toBe(1);
    expect(ids(guide)).toEqual([1, 3, 2, 4, 5, 6]);
    expect(batches(guide)).toBe("1 1 - - - -");
    // Another step joins the same batch, after its last step.
    batchItems(guide, 1, 2);
    expect(ids(guide)).toEqual([1, 3, 2, 4, 5, 6]);
    expect(batches(guide)).toBe("1 1 1 - - -");
  });

  test("neighbours keep their order, whichever way they're batched", () => {
    const below = sample();
    batchItems(below, 1, 2);
    expect(ids(below)).toEqual([1, 2, 3, 4, 5, 6]);
    const above = sample();
    batchItems(above, 2, 1);
    expect(ids(above)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(batches(above)).toBe("1 1 - - - -");
    // From further above, it moves down to just before the batch.
    const far = sample();
    batchItems(far, 3, 1);
    expect(ids(far)).toEqual([2, 1, 3, 4, 5, 6]);
    expect(batches(far)).toBe("- 1 1 - - -");
  });

  test("an unbatched anchor joins the other's batch, on its side", () => {
    const guide = sample();
    batchItems(guide, 2, 3);
    batchItems(guide, 1, 3); // 1 isn't batched, 3 is: 1 joins 3's batch, from above
    expect(ids(guide)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(batches(guide)).toBe("1 1 1 - - -");
  });

  test("not across chapters; taking one out keeps the batch whole", () => {
    const guide = sample();
    expect(batchItems(guide, 1, 4)).toBeUndefined();
    batchItems(guide, 1, 2);
    batchItems(guide, 1, 3);
    unbatchItem(guide, 2);
    expect(ids(guide)).toEqual([1, 3, 2, 4, 5, 6]);
    expect(batches(guide)).toBe("1 1 - - - -");
  });
});

describe("a quest step's objectives", () => {
  // A step doing Cutting Teeth's two objectives.
  function step(): Guide {
    const guide = newGuide("Test", "Horde");
    addQuestStep(guide, INDEX, quest(2), ["objectives"], { chapterId: 1, index: 0 }, anyone);
    return guide;
  }
  const objectives = (guide: Guide) => (guide.items[0] as QuestItem).objectives;

  test("ticked one at a time: every one ticked is all of them, and the last one stays", () => {
    const guide = step();
    toggleObjective(guide, 1, 1, 2);
    expect(objectives(guide)).toEqual([2]);
    toggleObjective(guide, 1, 2, 2); // the only one left
    expect(objectives(guide)).toEqual([2]);
    toggleObjective(guide, 1, 1, 2);
    expect(objectives(guide)).toBe(true);
  });

  test("a step that doesn't do objectives, or isn't a quest, is left alone", () => {
    const guide = step();
    delete (guide.items[0] as QuestItem).objectives;
    toggleObjective(guide, 1, 1, 2);
    expect(objectives(guide)).toBeUndefined();
    insertItems(guide, [{ type: "note", text: "x" }], { chapterId: 1, index: 1 });
    toggleObjective(guide, 2, 1, 2);
    expect(guide.items[1]).toEqual({ id: 2, chapterId: 1, type: "note", text: "x" });
  });
});

describe("adding quests", () => {
  test("fills in where to pick it up, nearest the last place the guide went", () => {
    const guide = newGuide("Test", "Horde");
    addQuestStep(guide, INDEX, quest(2), ["pickup"], { chapterId: 1, index: 0 }, anyone, { mapID: 1411, x: 0.79, y: 0.79 });
    expect(guide.questCoords[2]).toEqual({ mapID: 1411, x: 0.8, y: 0.8 });
    expect(guide.items).toEqual([{ id: 1, chapterId: 1, type: "quest", quest: 2, pickup: true }]);
    expect(guide.questPrereqs[2]).toEqual([1]);
  });

  test("class quests get their class, and an any-one prerequisite only when it's in the guide", () => {
    const guide = newGuide("Test", "Horde");
    addQuestStep(guide, INDEX, quest(3), ["pickup", "objectives", "turnin"], { chapterId: 1, index: 0 }, anyone);
    expect(guide.questClasses[3]).toBe("SHAMAN");
    addQuestStep(guide, INDEX, quest(8), ["pickup"], { chapterId: 1, index: 1 }, anyone);
    expect(guide.questPrereqs[8]).toBeUndefined();
    const withOne = newGuide("Test", "Horde");
    addQuestStep(withOne, INDEX, quest(1), ["pickup"], { chapterId: 1, index: 0 }, anyone);
    addQuestStep(withOne, INDEX, quest(8), ["pickup"], { chapterId: 1, index: 1 }, anyone);
    expect(withOne.questPrereqs[8]).toEqual([1]);
  });

  test("settings already there aren't changed", () => {
    const guide = newGuide("Test", "Horde");
    guide.questCoords[1] = { mapID: 1411, x: 0.5, y: 0.5 };
    addQuestStep(guide, INDEX, quest(1), ["pickup"], { chapterId: 1, index: 0 }, anyone);
    expect(guide.questCoords[1]).toEqual({ mapID: 1411, x: 0.5, y: 0.5 });
  });
});

describe("profiles", () => {
  test.each([
    [5, anyone, "Not for the Horde"],
    [4, { races: [2, 8], professions: [] }, "Only for Undead"],
    [4, anyone, undefined],
    [3, { races: [], class: "WARRIOR", professions: [] }, "Only for Shaman"],
    [3, { races: [], class: "SHAMAN", professions: [] }, undefined],
    [6, anyone, "Needs Fishing 1"],
    [6, { races: [], professions: [356] }, undefined],
  ] as const)("quest %s", (id, profile, reason) => {
    expect(unavailableReason(quest(id), "Horde", { ...profile, races: [...profile.races], professions: [...profile.professions] })).toBe(reason);
  });
});

describe("the zone a quest is picked up in", () => {
  // Durotar's subzone 363 (Valley of Trials) has no name of its own, so it
  // shows as "Durotar" too: the zone filter goes by name, not area.
  const index = indexQuestData({
    ...DATA,
    areas: { ...DATA.areas, 363: "Durotar" },
    quests: [
      ...QUESTS,
      { id: 20, name: "Sting of the Scorpid", level: 3, minLevel: 1, startNpcs: [101], objectives: [], zone: 363 },
      { id: 21, name: "A Class Quest", level: 1, minLevel: 1, classes: 64, sort: 82, startNpcs: [103], objectives: [] },
      { id: 22, name: "Started by an Item", level: 4, minLevel: 1, startItems: [300], objectives: [], zone: 363 },
      { id: 23, name: "Nowhere", level: 4, minLevel: 1, objectives: [] },
    ],
  });
  const region = (id: number) => questRegion(index, index.byId.get(id)!);

  test("is where its giver stands, whatever the quest log files it under", () => {
    expect([1, 20, 21, 4].map(region)).toEqual(["Durotar", "Durotar", "Durotar", "Tirisfal Glades"]);
  });

  test("a race's starting zone", () => {
    expect(startingZone(index, { races: [2], professions: [] })).toBe("Durotar");
    expect(startingZone(index, { races: [], professions: [] })).toBeUndefined();
  });

  test("quests that are never suggested", () => {
    const hidden = indexQuestData({
      ...DATA,
      quests: [
        { id: 5843, name: "Welcome!", level: 1, minLevel: 1, races: 130, startNpcs: [100], objectives: [], zone: 14 },
        { id: 8828, name: "Winter's Presents", level: 1, minLevel: 1, sort: 22, startNpcs: [100], objectives: [] },
        QUESTS[0]!,
      ],
    });
    const guide = newGuide("Test", "Horde");
    const state = stateAt(guide, anyone, 0, 1);
    expect(availableQuests(guide, hidden, anyone, state).map((a) => a.quest.id)).toEqual([1]);
  });

  test("or, with no giver, the zone it's listed under", () => {
    expect(region(22)).toBe("Durotar");
    expect(region(23)).toBeUndefined();
  });
});

describe("reading a guide in order", () => {
  function chain(): Guide {
    const guide = newGuide("Test", "Horde");
    const at = (index: number) => ({ chapterId: 1, index });
    addQuestStep(guide, INDEX, quest(1), ["pickup"], at(0), anyone);
    addQuestStep(guide, INDEX, quest(1), ["turnin"], at(1), anyone);
    addQuestStep(guide, INDEX, quest(2), ["pickup"], at(2), anyone);
    addQuestStep(guide, INDEX, quest(2), ["objectives", "turnin"], at(3), anyone);
    return guide;
  }
  const texts = (guide: Guide, profile = anyone) =>
    Object.fromEntries([...analyzeGuide(guide, INDEX, profile)].map(([id, list]) => [id, list.map((w) => w.text)]));

  test("a guide in a sensible order has nothing to say", () => {
    expect(texts(chain())).toEqual({});
  });

  test("steps out of order", () => {
    const guide = chain();
    moveItem(guide, 3, { chapterId: 1, index: 0 }); // pick up 2 before 1 is turned in
    moveItem(guide, 2, { chapterId: 1, index: 0 }); // turn in 1 before picking it up
    expect(texts(guide)).toEqual({
      2: [`Not picked up yet: that happens later in "Chapter 1"`],
      1: ["Already turned in earlier"],
    });
  });

  test("prerequisites turned in later, levels and the profile", () => {
    const guide = chain();
    setChapterLevel(guide, 1, 5);
    const second = addChapter(guide, "Next").id;
    addQuestStep(guide, INDEX, quest(7), ["pickup"], { chapterId: second, index: 0 }, anyone);
    addQuestStep(guide, INDEX, quest(4), ["pickup"], { chapterId: second, index: 1 }, anyone);
    guide.questPrereqs[1] = [2];
    const orc: Profile = { races: [2], professions: [] };
    expect(texts(guide, orc)).toMatchObject({
      1: [`Needs "Cutting Teeth" turned in first, which happens later in "Chapter 1"`],
      5: ["Needs level 10, but this chapter only goes up to 5", 'Never turned in: click a later step, then add it from "Picked up, not turned in yet"'],
      6: ["Only for Undead", 'Never turned in: click a later step, then add it from "Picked up, not turned in yet"'],
    });
  });

  test("steps for other classes don't count for a class", () => {
    const guide = chain();
    guide.items[0]!.class = "PALADIN";
    expect(texts(guide, { races: [], class: "SHAMAN", professions: [] })).toEqual({
      2: ["Not picked up in this guide, so it must be picked up before it"],
    });
  });

  test("at a chapter's edge, the level is the chapter new steps go in", () => {
    const guide = chain();
    setChapterLevel(guide, 1, 3);
    const next = addChapter(guide, "Next").id;
    setChapterLevel(guide, next, 6);
    insertItems(guide, [{ type: "note", text: "x" }], { chapterId: next, index: 0 });
    const end = guide.items.length - 1; // after chapter 1, before the note in "Next"
    expect(stateAt(guide, anyone, end, 1)).toMatchObject({ levelFrom: undefined, levelTo: 3 });
    expect(stateAt(guide, anyone, end, next)).toMatchObject({ levelFrom: 3, levelTo: 6 });
    // An empty chapter still has its range.
    const empty = newGuide("Empty", "Horde");
    setChapterLevel(empty, 1, 5);
    expect(stateAt(empty, anyone, 0, 1)).toMatchObject({ levelTo: 5 });
  });

  test("a race starts at its first quest giver", () => {
    expect(startingCoords(INDEX, { races: [2], professions: [] })).toEqual({ mapID: 1411, x: 0.4329, y: 0.6853 });
    expect(startingCoords(INDEX, anyone)).toBeUndefined();
  });

  test("quests to pick up at a point", () => {
    const guide = chain();
    setChapterLevel(guide, 1, 3);
    addChapter(guide, "Next");
    const names = (index: number, profile = anyone) =>
      availableQuests(guide, INDEX, profile, stateAt(guide, profile, index)).map((a) => `${a.quest.id}:${a.status}`);
    // In a chapter going up to level 3: the Horde's quests without a
    // profession up to level 5 (not 7, nor the level-60 holiday quest
    // anyone can pick up), lowest level first. The chain's
    // second quest is locked until later, and 8 needs a quest only turned
    // in later.
    expect(names(0)).toEqual(["1:ready", "4:ready", "8:earlier", "3:ready"]);
    // After the chain: the rest, lowest level first.
    expect(names(guide.items.length)).toEqual(["4:ready", "8:ready", "3:ready"]);
    expect(names(guide.items.length, { races: [2], class: "WARRIOR", professions: [] })).toEqual(["8:ready"]);
  });

  test("quests to pick up say which of their prerequisites are still needed", () => {
    const guide = chain();
    setChapterLevel(guide, 1, 3);
    guide.questPrereqs[2] = [1, 99]; // the data's, and one set in the guide
    guide.questPrereqs[4] = [99]; // only one set in the guide
    const at = (index: number) =>
      Object.fromEntries(
        availableQuests(guide, INDEX, anyone, stateAt(guide, anyone, index), { ...DEFAULT_AVAILABLE_OPTIONS, locked: true }).map(
          (a) => [a.quest.id, { status: a.status, needs: a.needs, needsAny: a.needsAny }],
        ),
      );
    expect(at(0)).toMatchObject({
      1: { status: "ready", needs: [], needsAny: [] },
      2: { status: "locked", needs: [1, 99], needsAny: [] },
      4: { status: "earlier", needs: [99], needsAny: [] },
      8: { status: "earlier", needs: [], needsAny: [1, 9] },
    });
    // Once 1 is turned in, it's no longer listed.
    expect(at(2)).toMatchObject({
      2: { status: "earlier", needs: [99], needsAny: [] },
      8: { status: "ready", needs: [], needsAny: [] },
    });
  });
});
