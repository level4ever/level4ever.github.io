// Adding quests where new steps go: the quests in the log there (to do or
// turn in), the ones that can be picked up there, and a search of them all.

import { useMemo, useState } from "react";
import type { Quest } from "../data/types";
import { addQuestStep, type Phase } from "../lib/addQuest";
import {
  DEFAULT_AVAILABLE_OPTIONS,
  availableQuests,
  byLevel,
  levelWindow,
  questNames,
  stateAt,
  type AvailableOptions,
  type AvailableQuest,
  type GuideState,
} from "../lib/analysis";
import type { Guide } from "../lib/guide";
import {
  HIDDEN_QUESTS,
  questRegion,
  startingCoords,
  startingZone,
  unavailableReason,
  type Profile,
  type QuestIndex,
} from "../lib/questData";
import { QuestCard } from "./QuestCard";
import { STARTING_ZONE, cursorPosition, useApp } from "./store";

const PAGE = 40;

export function QuestPanel({ guide, index, profile }: { guide: Guide; index: QuestIndex; profile: Profile }) {
  const cursor = useApp((s) => s.cursor);
  const [search, setSearch] = useState("");
  const zoneFilter = useApp((s) => s.zoneFilter);
  const zone = zoneFilter === STARTING_ZONE ? startingZone(index, profile) : zoneFilter; // a zone's name (see questRegion)
  const setZone = useApp.getState().setZoneFilter;
  const [allLevels, setAllLevels] = useState(false);
  const [showLocked, setShowLocked] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const position = cursorPosition(guide, cursor);
  const state = useMemo(() => {
    const at = stateAt(guide, profile, position.index, position.chapterId);
    // Before the guide goes anywhere, it's where the character starts.
    at.coords ??= startingCoords(index, profile);
    return at;
  }, [guide, index, profile, position.index, position.chapterId]);
  const chapter = guide.chapters.find((c) => c.id === position.chapterId);
  const level = state.levelTo ?? state.levelFrom;

  const options = useMemo(
    () => ({ ...DEFAULT_AVAILABLE_OPTIONS, locked: showLocked, anyLevel: allLevels }),
    [showLocked, allLevels],
  );
  const levels = levelWindow(state, options);
  const unfiltered = useMemo(
    () => availableQuests(guide, index, profile, state, options),
    [guide, index, profile, state, options],
  );
  const available = zone === undefined ? unfiltered : unfiltered.filter((a) => questRegion(index, a.quest) === zone);

  // Zones that have quests to offer here, busiest first.
  const zones = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of unfiltered) {
      const region = questRegion(index, a.quest);
      if (region) counts.set(region, (counts.get(region) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [index, unfiltered]);

  const inLog = [...state.picked]
    .map((id) => index.byId.get(id))
    .filter((q): q is Quest => q !== undefined)
    .sort(byLevel((q: Quest) => q));

  const add = (quest: Quest, phases: Phase[]) => {
    let id = 0;
    useApp.getState().edit((g) => {
      const at = cursorPosition(g, useApp.getState().cursor);
      id = addQuestStep(g, index, quest, phases, { chapterId: at.chapterId, index: at.inChapter }, profile, state.coords);
    });
    // The next quest goes after this one.
    useApp.getState().select(id);
  };

  const term = search.trim().toLowerCase();
  const results = useMemo(() => {
    if (!term) return [];
    const id = Number(term);
    return index.data.quests
      .filter((q) => q.id === id || q.name.toLowerCase().includes(term))
      .sort((a, b) => Number(b.id === id) - Number(a.id === id) || byLevel((q: Quest) => q)(a, b))
      .slice(0, 60);
  }, [index, term]);

  return (
    <div className="scroll">
      <div className="panel-section">
        <div className="muted small">
          New steps go {position.inChapter === 0 ? "at the start of" : `after step ${position.index} in`}{" "}
          <strong>{chapter?.name}</strong>
          {level !== undefined && <>, around level {levelRange(state.levelFrom, state.levelTo)}</>}
          . Click a step to add after it.
        </div>
        <input
          className="input"
          type="search"
          placeholder="Search all quests by name or ID"
          aria-label="Search quests"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {term ? (
        <div className="panel-section">
          <h3>
            Search results <span className="muted">({results.length})</span>
          </h3>
          <div className="quest-list">
            {results.map((quest) => (
              <QuestCard
                key={quest.id}
                quest={quest}
                index={index}
                faction={guide.faction}
                playerLevel={state.levelFrom ?? state.levelTo}
                note={
                  unavailableReason(quest, guide.faction, profile) ??
                  (HIDDEN_QUESTS.has(quest.id) ? `Not suggested: ${HIDDEN_QUESTS.get(quest.id)}` : undefined) ??
                  searchNote(quest, state)
                }
                actions={actionsFor(quest, state)}
                onAdd={(phases) => add(quest, phases)}
              />
            ))}
            {results.length === 0 && <div className="muted small">No quests match.</div>}
          </div>
        </div>
      ) : (
        <>
          <div className="panel-section">
            <h3>
              Picked up, not turned in yet <span className="muted">({inLog.length})</span>
            </h3>
            {inLog.length === 0 ? (
              <div className="muted small">
                Quests picked up before this point show here until they're turned in, to add their next step.
              </div>
            ) : (
              <>
                <div className="muted small">Add each one's next step here: its objectives, its turn-in, or both.</div>
                <div className="quest-list">
                  {inLog.map((quest) => (
                    <QuestCard
                      key={quest.id}
                      quest={quest}
                      index={index}
                      faction={guide.faction}
                      playerLevel={state.levelFrom ?? state.levelTo}
                      actions={IN_LOG_ACTIONS}
                      onAdd={(phases) => add(quest, phases)}
                      compact
                    />
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="panel-section">
            <h3>
              Can be picked up here <span className="muted">({available.length})</span>
            </h3>
            <div className="filters">
              <select
                className="input"
                aria-label="Zone"
                value={zone ?? ""}
                onChange={(event) => {
                  setZone(event.target.value || undefined);
                  setShown(PAGE);
                }}
              >
                <option value="">All zones</option>
                {zone !== undefined && !zones.some(([name]) => name === zone) && <option value={zone}>{zone} (0)</option>}
                {zones.map(([name, count]) => (
                  <option key={name} value={name}>
                    {name} ({count})
                  </option>
                ))}
              </select>
              <div className="chips">
                <button
                  className="chip small"
                  aria-pressed={allLevels}
                  disabled={level === undefined}
                  title={
                    level === undefined
                      ? "This chapter has no level target, so every level shows already"
                      : "Also show quests well above or below this level"
                  }
                  onClick={() => setAllLevels(!allLevels)}
                >
                  Any level
                </button>
                <button
                  className="chip small"
                  aria-pressed={showLocked}
                  title="Also show quests that need one this guide turns in further on"
                  onClick={() => setShowLocked(!showLocked)}
                >
                  Unlocked later in guide
                </button>
              </div>
              <div className="muted small">
                {levels ? (
                  <span title={levelRule(options)}>
                    Quests of level{" "}
                    <strong className="level-range">
                      {levels.from}–{levels.to}
                    </strong>{" "}
                    that can be picked up by level <strong className="level-range">{levels.pickupBy}</strong>.
                  </span>
                ) : level === undefined ? (
                  "Every level shows: give chapters a level target to only see quests around it."
                ) : (
                  "Quests of every level."
                )}
              </div>
            </div>
            <div className="quest-list">
              {available.slice(0, shown).map((a) => (
                <QuestCard
                  key={a.quest.id}
                  quest={a.quest}
                  index={index}
                  faction={guide.faction}
                  playerLevel={state.levelFrom ?? state.levelTo}
                  note={availableNote(a, index)}
                  distance={a.distance}
                  actions={PICKUP_ACTIONS}
                  onAdd={(phases) => add(a.quest, phases)}
                />
              ))}
            </div>
            {available.length > shown && (
              <button className="btn" onClick={() => setShown(shown + PAGE)}>
                Show more ({available.length - shown} left)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function levelRange(from: number | undefined, to: number | undefined): string {
  const levels = [from, to].filter((n): n is number => n !== undefined).sort((a, b) => a - b);
  return levels[0] === levels[levels.length - 1] ? String(levels[0]) : `${levels[0]}-${levels[levels.length - 1]}`;
}

// What the level range means, for its tooltip.
function levelRule(options: AvailableOptions): string {
  return (
    `From ${options.levelBelow} levels under the chapter's level to ${options.redAbove - 1} over it ` +
    `(red quests are left out), and no more than ${options.levelAbove} over it to pick up. ` +
    `"Any level" shows the rest.`
  );
}

type Action = { label: string; phases: Phase[]; primary?: boolean };

// Each button adds one step, ticked as its marks show.
const PICKUP_ACTIONS: Action[] = [
  { label: "Pick up", phases: ["pickup"], primary: true },
  { label: "Pick up + objectives", phases: ["pickup", "objectives"] },
  { label: "Whole quest", phases: ["pickup", "objectives", "turnin"] },
];

const IN_LOG_ACTIONS: Action[] = [
  { label: "Objectives", phases: ["objectives"] },
  { label: "Objectives + turn in", phases: ["objectives", "turnin"], primary: true },
  { label: "Turn in", phases: ["turnin"] },
];

function actionsFor(quest: Quest, state: GuideState): Action[] {
  if (state.picked.has(quest.id)) return IN_LOG_ACTIONS;
  return PICKUP_ACTIONS;
}

function searchNote(quest: Quest, state: GuideState): string | undefined {
  if (state.turnedIn.has(quest.id)) return "Already turned in by this point";
  if (state.picked.has(quest.id)) return "Picked up, not turned in yet";
  return undefined;
}

function availableNote(a: AvailableQuest, index: QuestIndex): string | undefined {
  if (a.status === "ready") return undefined;
  const name = (id: number) => index.byId.get(id)?.name ?? `quest ${id}`;
  const needs = [
    ...(a.needs.length > 0 ? [questNames(a.needs, name, ", ")] : []),
    ...(a.needsAny.length > 0 ? [`one of ${questNames(a.needsAny, name)}`] : []),
  ].join(" and ");
  return a.status === "locked" ? `Locked: needs ${needs}, turned in later` : `Needs ${needs} (not in this guide)`;
}
