// Adding a quest's steps to a guide, with what the addon needs to know about
// the quest filled in from the quest data.

import type { Quest } from "../data/types";
import { CLASS_MASKS, masksOverlap } from "../data/masks";
import type { Coords, Guide, QuestItem } from "./guide";
import { insertItems, questsInGuide, setQuestValue, type Position } from "./editor";
import { classesOf, giverPlaces, nearestCoords, type Profile, type QuestIndex } from "./questData";

export type Phase = "pickup" | "objectives" | "turnin";

// Fills in the guide's per-quest settings from the data, where it has none:
// - where it's picked up (the game shows nothing until it's in the log), the
//   giver's spawn nearest to `near`
// - its class, if it's a class quest (the profile's class if it has several)
// - the quests before it. The addon needs all of them done, so only the
//   data's "all of these" list is used, plus an "any one of these" list when
//   exactly one of them is in this guide.
export function fillQuestSettings(guide: Guide, index: QuestIndex, quest: Quest, profile: Profile, near?: Coords): void {
  if (!guide.questCoords[quest.id]) {
    setQuestValue(guide, "questCoords", quest.id, nearestCoords(giverPlaces(index, quest), near));
  }
  if (!guide.questClasses[quest.id]) {
    const classes = classesOf(quest.classes);
    const only =
      classes.length === 1
        ? classes[0]
        : profile.class && quest.classes && masksOverlap(quest.classes, CLASS_MASKS[profile.class] ?? 0)
          ? profile.class
          : undefined;
    setQuestValue(guide, "questClasses", quest.id, only);
  }
  if (!guide.questPrereqs[quest.id]) {
    const inGuide = questsInGuide(guide);
    const anyInGuide = (quest.prereqAny ?? []).filter((id) => inGuide.has(id));
    const prereqs = [...(quest.prereqAll ?? []), ...(anyInGuide.length === 1 ? anyInGuide : [])];
    setQuestValue(guide, "questPrereqs", quest.id, prereqs.length > 0 ? prereqs : undefined);
  }
}

// Adds one step for the quest, with these phases ticked, at a position.
// Returns the new item's id.
export function addQuestStep(
  guide: Guide,
  index: QuestIndex,
  quest: Quest,
  phases: Phase[],
  at: Position,
  profile: Profile,
  near?: Coords,
): number {
  const step: Omit<QuestItem, "id" | "chapterId"> = { type: "quest", quest: quest.id };
  if (phases.includes("pickup")) step.pickup = true;
  if (phases.includes("objectives")) step.objectives = true;
  if (phases.includes("turnin")) step.turnin = true;
  const [id] = insertItems(guide, [step], at);
  fillQuestSettings(guide, index, quest, profile, near);
  return id!;
}
