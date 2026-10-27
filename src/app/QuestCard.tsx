// One quest, with what it's about and buttons to add its steps.

import { useState } from "react";
import type { Located, Quest } from "../data/types";
import type { Phase } from "../lib/addQuest";
import type { Faction } from "../lib/guide";
import {
  classesOf,
  className,
  giverPlaces,
  objectiveText,
  PROFESSIONS,
  raceNames,
  turnInPlaces,
  zoneName,
  type QuestIndex,
} from "../lib/questData";
import { questNames } from "../lib/analysis";
import { useApp } from "./store";
import { PhaseIcon, QuestLevel } from "./ui";

export function QuestCard({
  quest,
  index,
  faction,
  playerLevel,
  note,
  distance,
  actions,
  onAdd,
  compact,
}: {
  quest: Quest;
  index: QuestIndex;
  faction: Faction;
  playerLevel?: number;
  note?: string;
  distance?: number;
  actions: { label: string; phases: Phase[]; primary?: boolean }[];
  onAdd: (phases: Phase[]) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const classes = classesOf(quest.classes);
  const races = raceNames(quest.races, faction);
  const profession = quest.skill && (PROFESSIONS.find((p) => p.skill === quest.skill![0])?.name ?? `Skill ${quest.skill[0]}`);
  const zone = zoneName(index, quest);

  return (
    <div
      className="quest-card"
      onMouseEnter={() => useApp.getState().setPreview(quest.id)}
      onMouseLeave={() => useApp.getState().setPreview(undefined)}
      onFocus={() => useApp.getState().setPreview(quest.id)}
      onBlur={() => useApp.getState().setPreview(undefined)}
    >
      <div className="quest-card-head">
        <QuestLevel level={quest.level} playerLevel={playerLevel} />
        <button
          className="name btn ghost"
          style={{ padding: 0, textAlign: "left", justifyContent: "flex-start", whiteSpace: "normal" }}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {quest.name}
        </button>
        <span className="muted small">{quest.id}</span>
      </div>
      {!compact && (
        <div className="tags">
          {zone && <span className="tag">{zone}</span>}
          {distance !== undefined && <span className="tag">{distance < 0.05 ? "right here" : `${Math.round(distance * 100)}% away`}</span>}
          {classes.length > 0 && classes.length < 9 && <span className="tag accent">{classes.map(className).join("/")}</span>}
          {races.length > 0 && races.length < 5 && <span className="tag">{races.join("/")}</span>}
          {profession && <span className="tag accent">{profession}</span>}
          {quest.startItems && <span className="tag">starts from an item</span>}
          {quest.repeatable && <span className="tag">repeatable</span>}
          {quest.minLevel > 1 && <span className="tag">needs level {quest.minLevel}</span>}
        </div>
      )}
      {note && <div className="small sev-info">{note}</div>}
      {open && <QuestDetails quest={quest} index={index} />}
      <div className="buttons">
        {actions.map((action) => (
          <button
            key={action.label}
            className={`btn small${action.primary ? " primary" : ""}`}
            aria-label={action.label}
            title={`Add a step: ${action.label.toLowerCase()}`}
            onClick={() => onAdd(action.phases)}
          >
            <span className="phase-icons">
              {action.phases.map((phase) => (
                <PhaseIcon key={phase} phase={phase} />
              ))}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function placeText(index: QuestIndex, place: Located & { name?: string }): string {
  const maps = Object.keys(place.spawns ?? {}).map((id) => index.data.maps[Number(id)] ?? `map ${id}`);
  const where = maps.length > 0 ? maps.join(", ") : place.instances ? "a dungeon" : "unknown";
  return `${place.name ?? "?"} (${where})`;
}

export function QuestDetails({ quest, index }: { quest: Quest; index: QuestIndex }) {
  const name = (id: number) => index.byId.get(id)?.name ?? `quest ${id}`;
  const givers = giverPlaces(index, quest);
  const enders = turnInPlaces(index, quest);
  const items = (quest.startItems ?? []).map((id) => index.data.items[id]?.name ?? `item ${id}`);
  return (
    <div className="details">
      {quest.text && (
        <div>
          <strong>Description:</strong>
          <div>{quest.text.join(" ")}</div>
        </div>
      )}
      {(givers.length > 0 || items.length > 0) && (
        <div>
          <strong>Starts:</strong> {[...givers.map((p) => placeText(index, p)), ...items.map((i) => `${i} (item)`)].join("; ")}
        </div>
      )}
      {enders.length > 0 && (
        <div>
          <strong>Ends:</strong> {enders.map((p) => placeText(index, p)).join("; ")}
        </div>
      )}
      {quest.objectives.length > 0 && (
        <div>
          <strong>Objectives:</strong>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {quest.objectives.map((o, i) => (
              <li key={i}>{objectiveText(index, o)}</li>
            ))}
          </ol>
        </div>
      )}
      {quest.prereqAll && (
        <div>
          <strong>After:</strong> {questNames(quest.prereqAll, name, ", ")}
        </div>
      )}
      {quest.prereqAny && (
        <div>
          <strong>After one of:</strong> {questNames(quest.prereqAny, name)}
        </div>
      )}
      {quest.exclusiveTo && (
        <div>
          <strong>Can't do with:</strong> {questNames(quest.exclusiveTo, name, ", ")}
        </div>
      )}
      {quest.next && (
        <div>
          <strong>Leads to:</strong> {name(quest.next)}
        </div>
      )}
    </div>
  );
}
