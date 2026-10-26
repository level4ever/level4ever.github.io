// Everything about the selected step, and its quest's settings in this guide.

import { useState } from "react";
import type { Warning } from "../lib/analysis";
import { deleteItem, getItem, setBatchedWithPrevious, setOptional, setQuestValue, updateItem } from "../lib/editor";
import type { Coords, Guide, NoteItem, NoteKind, QuestItem } from "../lib/guide";
import {
  CLASSES,
  giverPlaces,
  nearestCoords,
  objectiveText,
  turnInPlaces,
  type Profile,
  type QuestIndex,
} from "../lib/questData";
import { QuestDetails } from "./QuestCard";
import { NOTE_KIND_LABELS, Ticks, stepTitle } from "./Steps";
import { useApp } from "./store";
import { WarningList } from "./ui";

// Note kinds that have no place to go (see NOTE_KINDS in the addon's Core.lua).
const NO_LOCATION = new Set<string>(["usehearth", "target"]);

export function StepPanel({
  guide,
  index,
  itemId,
  warnings,
}: {
  guide: Guide;
  index: QuestIndex;
  profile: Profile;
  itemId: number;
  warnings: Map<number, Warning[]>;
}) {
  const item = getItem(guide, itemId);
  if (!item) {
    return <div className="panel-section muted">Select a step to edit it.</div>;
  }
  const app = useApp.getState();
  const position = guide.items.indexOf(item);
  const previous = guide.items[position - 1];
  const canBatch = previous?.chapterId === item.chapterId;
  const list = warnings.get(item.id);

  return (
    <div className="scroll">
      <div className="panel-section">
        <h3>Step {position + 1}</h3>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{stepTitle(item, index)}</div>
        {list && <WarningList warnings={list} />}
      </div>
      {item.type === "quest" ? (
        <QuestStep guide={guide} index={index} item={item} />
      ) : (
        <NoteStep index={index} item={item} />
      )}
      <div className="panel-section">
        <h3>This step</h3>
        <label className="field">
          <span>Only for a class</span>
          <ClassSelect
            value={item.class}
            onChange={(cls) => app.edit((g) => updateItem(g, item.id, { class: cls }))}
            empty="Every class"
          />
        </label>
        <label className="row">
          <input
            type="checkbox"
            disabled={!canBatch && item.batch === undefined}
            checked={item.batch !== undefined && previous?.batch === item.batch}
            onChange={(event) => app.edit((g) => setBatchedWithPrevious(g, item.id, event.target.checked))}
          />
          Batch with the step above (done together: every pick-up, then every objective, then every turn-in). The ⛓
          button on a step batches any steps in its chapter.
        </label>
        <div className="row">
          <button className="btn danger" onClick={() => app.edit((g) => deleteItem(g, item.id))}>
            Delete step
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestStep({ guide, index, item }: { guide: Guide; index: QuestIndex; item: QuestItem }) {
  const app = useApp.getState();
  const quest = index.byId.get(item.quest);
  const objectives = quest?.objectives ?? [];
  const some = Array.isArray(item.objectives) ? item.objectives : undefined;
  const update = (patch: Partial<QuestItem>) => app.edit((g) => updateItem(g, item.id, patch));

  return (
    <>
      <div className="panel-section">
        <div className="row">
          <Ticks item={item} />
          <label className="row small">
            <input type="checkbox" checked={!!item.ongoing} onChange={(e) => update({ ongoing: e.target.checked || undefined })} />
            Ongoing (worked on in the background until its next step)
          </label>
        </div>
        {item.objectives && objectives.length > 1 && (
          <div className="field">
            <span>Objectives this step does</span>
            <label className="row small">
              <input type="checkbox" checked={!some} onChange={() => update({ objectives: some ? true : [1] })} />
              All of them
            </label>
            {some &&
              objectives.map((objective, i) => (
                <label key={i} className="row small">
                  <input
                    type="checkbox"
                    checked={some.includes(i + 1)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...some, i + 1].sort((a, b) => a - b) : some.filter((n) => n !== i + 1);
                      update({ objectives: next.length > 0 ? next : true });
                    }}
                  />
                  {i + 1}. {objectiveText(index, objective)}
                </label>
              ))}
          </div>
        )}
        {quest ? <QuestDetails quest={quest} index={index} /> : <div className="notice">Quest {item.quest} isn't in the quest data.</div>}
      </div>
      <div className="panel-section">
        <h3>Quest {item.quest} in this guide</h3>
        <span className="muted small">These apply to every step for this quest.</span>
        <label className="row">
          <input
            type="checkbox"
            checked={!!guide.optionalQuests[item.quest]}
            onChange={(e) => app.edit((g) => setOptional(g, item.quest, e.target.checked))}
          />
          Optional (fine to skip, e.g. an escort)
        </label>
        <label className="field">
          <span>Only for a class</span>
          <ClassSelect
            value={guide.questClasses[item.quest]}
            onChange={(cls) => app.edit((g) => setQuestValue(g, "questClasses", item.quest, cls))}
            empty="Every class"
          />
        </label>
        <PrereqsField
          index={index}
          value={guide.questPrereqs[item.quest] ?? []}
          onChange={(ids) => app.edit((g) => setQuestValue(g, "questPrereqs", item.quest, ids))}
        />
        <CoordsField
          label="Where it's picked up"
          index={index}
          value={guide.questCoords[item.quest]}
          onChange={(coords, typing) =>
            app.edit((g) => setQuestValue(g, "questCoords", item.quest, coords), typing ? `pickup:${item.quest}` : undefined)
          }
          suggestion={quest && nearestCoords(giverPlaces(index, quest), guide.questCoords[item.quest])}
          suggestionLabel="Quest giver"
        />
        <CoordsField
          label="Where it's turned in (only if the game shows no marker)"
          index={index}
          value={guide.turnInCoords[item.quest]}
          onChange={(coords, typing) =>
            app.edit((g) => setQuestValue(g, "turnInCoords", item.quest, coords), typing ? `turnin:${item.quest}` : undefined)
          }
          suggestion={quest && nearestCoords(turnInPlaces(index, quest), guide.questCoords[item.quest])}
          suggestionLabel="Quest ender"
        />
      </div>
    </>
  );
}

function NoteStep({ index, item }: { index: QuestIndex; item: NoteItem }) {
  const app = useApp.getState();
  const update = (patch: Partial<NoteItem>, field?: string) =>
    app.edit((g) => updateItem(g, item.id, patch), field && `${field}:${item.id}`);
  const kind = item.kind ?? "note";
  const textLabel = kind === "target" ? "NPC name" : kind === "loot" ? "Item name" : "Text";
  return (
    <div className="panel-section">
      <label className="field">
        <span>Kind</span>
        <select
          className="input"
          value={kind}
          onChange={(e) => update({ kind: e.target.value === "note" ? undefined : (e.target.value as NoteKind) })}
        >
          {Object.entries(NOTE_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{textLabel}</span>
        <input
          className="input"
          value={item.text ?? ""}
          maxLength={255}
          onChange={(e) => update({ text: e.target.value || undefined }, "text")}
        />
      </label>
      {kind === "loot" && (
        <div className="grid-2">
          <label className="field">
            <span>Item ID</span>
            <input
              className="input"
              type="number"
              min={1}
              value={item.itemId ?? ""}
              onChange={(e) => update({ itemId: positive(e.target.value) }, "item-id")}
            />
          </label>
          <label className="field">
            <span>How many</span>
            <input
              className="input"
              type="number"
              min={1}
              value={item.count ?? ""}
              placeholder="1"
              onChange={(e) => update({ count: positive(e.target.value) }, "count")}
            />
          </label>
        </div>
      )}
      {!NO_LOCATION.has(kind) && (
        <CoordsField
          label="Location for the arrow"
          index={index}
          value={item.coords}
          onChange={(coords, typing) => update({ coords }, typing ? "coords" : undefined)}
        />
      )}
      <PrereqsField index={index} value={item.prereqs ?? []} onChange={(ids) => update({ prereqs: ids.length ? ids : undefined })} />
      <span className="muted small">
        {kind === "note" ? "Ticked off by hand in game." : `Ticks itself off in game (${NOTE_KIND_LABELS[kind]}).`}
      </span>
    </div>
  );
}

function positive(text: string): number | undefined {
  const n = Number(text);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function ClassSelect({ value, onChange, empty }: { value?: string; onChange: (cls: string | undefined) => void; empty: string }) {
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{empty}</option>
      {CLASSES.map((c) => (
        <option key={c.file} value={c.file}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

// Quests that must be turned in first.
function PrereqsField({ index, value, onChange }: { index: QuestIndex; value: number[]; onChange: (ids: number[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const id = positive(text.trim());
    if (id && !value.includes(id)) {
      onChange([...value, id]);
    }
    setText("");
  };
  return (
    <div className="field">
      <span>Only after these quests are turned in</span>
      {value.map((id) => (
        <div key={id} className="row small">
          <span style={{ flex: 1 }}>
            {index.byId.get(id)?.name ?? "Unknown quest"} <span className="muted">({id})</span>
          </span>
          <button className="icon-btn" title="Remove" onClick={() => onChange(value.filter((v) => v !== id))}>
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Quest ID"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn small" onClick={add} disabled={!positive(text.trim())}>
          Add
        </button>
      </div>
    </div>
  );
}

// A map and a point on it, shown as 0-100 like the game's coordinates.
function CoordsField({
  label,
  index,
  value,
  onChange,
  suggestion,
  suggestionLabel,
}: {
  label: string;
  index: QuestIndex;
  value: Coords | undefined;
  onChange: (coords: Coords | undefined, typing?: boolean) => void;
  suggestion?: Coords;
  suggestionLabel?: string;
}) {
  const maps = Object.entries(index.data.maps).sort((a, b) => a[1].localeCompare(b[1]));
  const set = (patch: Partial<Coords>, typing?: boolean) => {
    const next = { mapID: value?.mapID ?? suggestion?.mapID ?? Number(maps[0]![0]), x: value?.x ?? 0.5, y: value?.y ?? 0.5, ...patch };
    onChange(next, typing);
  };
  const percent = (n: number | undefined) => (n === undefined ? "" : String(Math.round(n * 1000) / 10));
  const fromPercent = (text: string) => Math.min(1, Math.max(0, Number(text) / 100));
  const differs = suggestion && (!value || value.mapID !== suggestion.mapID || Math.hypot(value.x - suggestion.x, value.y - suggestion.y) > 0.005);

  return (
    <div className="field">
      <span>{label}</span>
      {value ? (
        <div className="row">
          <select
            className="input"
            style={{ flex: 2, minWidth: 120 }}
            aria-label="Map"
            value={value.mapID}
            onChange={(e) => set({ mapID: Number(e.target.value) })}
          >
            {!index.data.maps[value.mapID] && <option value={value.mapID}>Map {value.mapID}</option>}
            {maps.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <input
            className="input"
            style={{ width: 64 }}
            type="number"
            step="0.1"
            aria-label="X"
            value={percent(value.x)}
            onChange={(e) => set({ x: fromPercent(e.target.value) }, true)}
          />
          <input
            className="input"
            style={{ width: 64 }}
            type="number"
            step="0.1"
            aria-label="Y"
            value={percent(value.y)}
            onChange={(e) => set({ y: fromPercent(e.target.value) }, true)}
          />
          <button className="icon-btn" title="Clear" onClick={() => onChange(undefined)}>
            ✕
          </button>
        </div>
      ) : (
        <span className="muted small">Not set.</span>
      )}
      <div className="row">
        {differs && (
          <button className="btn small" onClick={() => onChange(suggestion)}>
            Use {suggestionLabel} ({index.data.maps[suggestion!.mapID] ?? suggestion!.mapID} {percent(suggestion!.x)},{" "}
            {percent(suggestion!.y)})
          </button>
        )}
        {!value && (
          <button className="btn small" onClick={() => set({})}>
            Set by hand
          </button>
        )}
      </div>
    </div>
  );
}
