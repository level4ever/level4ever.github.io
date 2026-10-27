// The shown chapter's steps. Click a step to select it (new steps go after
// it, and its everyday settings show on its row); its ✎ button opens all its
// settings in the side panel. Drag steps to reorder them, or onto a chapter
// to move them there.

import { useEffect, useRef, useState } from "react";
import type { Warning } from "../lib/analysis";
import {
  batchItems,
  chapterItems,
  deleteItem,
  getChapter,
  getItem,
  insertItems,
  moveItem,
  renameChapter,
  setChapterLevel,
  setOptional,
  toggleObjective,
  unbatchItem,
  updateItem,
} from "../lib/editor";
import type { Phase } from "../lib/addQuest";
import type { Guide, GuideItem, NoteKind, QuestItem } from "../lib/guide";
import { className, objectiveText, type Profile, type QuestIndex } from "../lib/questData";
import { DRAG_TYPE, foundQuests, isFound } from "./Chapters";
import { cursorPosition, useApp } from "./store";
import { PHASE_LABELS, PhaseIcon, PhaseLegend, SeverityIcon, worst } from "./ui";

export const NOTE_KIND_LABELS: Record<NoteKind | "note", string> = {
  note: "Note",
  train: "Train skills",
  hearth: "Set hearth",
  usehearth: "Use hearth",
  flight: "Get flight point",
  profession: "Learn profession",
  target: "Target macro",
  loot: "Loot items",
};

export function stepTitle(item: GuideItem, index: QuestIndex | undefined): string {
  if (item.type === "quest") {
    return index?.byId.get(item.quest)?.name ?? `Quest ${item.quest}`;
  }
  return item.text || NOTE_KIND_LABELS[item.kind ?? "note"];
}

export function Steps({
  guide,
  index,
  profile,
  warnings,
  onOpenStep,
}: {
  guide: Guide;
  index: QuestIndex | undefined;
  profile: Profile;
  warnings: Map<number, Warning[]>;
  onOpenStep: () => void;
}) {
  const chapterId = useApp((s) => s.chapterId);
  const cursor = useApp((s) => s.cursor);
  const selected = useApp((s) => s.selectedItemId);
  const findText = useApp((s) => s.findText);
  const found = foundQuests(guide, index, findText);
  const list = useRef<HTMLOListElement>(null);
  // Bring the first found step into view as the search or chapter changes.
  useEffect(() => {
    list.current?.querySelector(".step.found")?.scrollIntoView?.({ block: "nearest" });
  }, [findText, chapterId]);
  const [dragOver, setDragOver] = useState<{ id: number; after: boolean }>();
  // The step whose batch other steps are being clicked into (the addon's
  // Batch button), until Done or Esc.
  const [batching, setBatching] = useState<number>();
  useEffect(() => {
    if (batching === undefined) return;
    const stop = (event: KeyboardEvent) => event.key === "Escape" && setBatching(undefined);
    window.addEventListener("keydown", stop);
    return () => window.removeEventListener("keydown", stop);
  }, [batching]);
  useEffect(() => setBatching(undefined), [chapterId]);
  // The anchor deleted (or undone away) ends it, or clicks would go nowhere.
  useEffect(() => {
    if (batching !== undefined && !getItem(guide, batching)) setBatching(undefined);
  }, [guide, batching]);
  const app = useApp.getState();
  const chapter = chapterId === undefined ? undefined : getChapter(guide, chapterId);
  if (!chapter) {
    return <section className="column" />;
  }
  const items = chapterItems(guide, chapter.id);
  const position = cursorPosition(guide, cursor);
  const markerAt = position.chapterId === chapter.id ? position.inChapter : undefined;
  // Numbering runs through the whole guide, like the addon's.
  const firstNumber = guide.items.findIndex((item) => item.chapterId === chapter.id) + 1;

  const addNote = (kind: NoteKind | "note") => {
    let id = 0;
    app.edit((g) => {
      const at = cursorPosition(g, useApp.getState().cursor);
      id = insertItems(g, [{ type: "note", ...(kind === "note" ? {} : { kind }) }], {
        chapterId: at.chapterId,
        index: at.inChapter,
      })[0]!;
    });
    app.select(id);
    onOpenStep();
  };

  const drop = (target: GuideItem, after: boolean, draggedId: number) => {
    if (draggedId === target.id) return;
    app.edit((g) => {
      const list = chapterItems(g, chapter.id).filter((item) => item.id !== draggedId);
      const at = list.findIndex((item) => item.id === target.id) + (after ? 1 : 0);
      moveItem(g, draggedId, { chapterId: chapter.id, index: at });
    });
  };

  return (
    <section className="column" aria-label="Steps">
      <div className="chapter-title">
        <input
          className="input"
          aria-label="Chapter name"
          value={chapter.name}
          maxLength={60}
          onChange={(event) =>
            app.edit((g) => {
              const c = getChapter(g, chapter.id)!;
              c.name = event.target.value;
            }, `chapter-name:${chapter.id}`)
          }
          onBlur={() =>
            app.edit(
              (g) => renameChapter(g, chapter.id, getChapter(g, chapter.id)!.name || "Chapter"),
              `chapter-name:${chapter.id}`,
            )
          }
        />
        <label className="row small muted" title="The level to reach by the end of this chapter">
          to level
          <input
            className="input level-input"
            type="number"
            min={1}
            max={100}
            value={chapter.level ?? ""}
            onChange={(event) =>
              app.edit(
                (g) => setChapterLevel(g, chapter.id, event.target.value ? Number(event.target.value) : undefined),
                `chapter-level:${chapter.id}`,
              )
            }
          />
        </label>
      </div>
      <div className="add-row">
        {(["note", "train", "flight", "hearth", "usehearth", "target", "loot", "profession"] as const).map((kind) => (
          <button key={kind} className="btn small" onClick={() => addNote(kind)}>
            + {NOTE_KIND_LABELS[kind]}
          </button>
        ))}
      </div>
      <PhaseLegend />
      {batching !== undefined && getItem(guide, batching) && (
        <div className="batch-banner" role="status">
          <span>
            Click steps to do them together with step {guide.items.findIndex((i) => i.id === batching) + 1} "
            {stepTitle(getItem(guide, batching)!, index)}": every pick-up first, then every objective, then every
            turn-in.
          </span>
          <button className="btn small primary" onClick={() => setBatching(undefined)}>
            Done
          </button>
        </div>
      )}
      <div className="scroll">
        <ol ref={list} className="steps" aria-label={`Steps in ${chapter.name}`}>
          {markerAt === 0 && <InsertMarker />}
          {items.length === 0 && (
            <li className="muted small" style={{ padding: "8px 12px" }}>
              No steps yet. Add quests from the panel on the right, or a note above.
            </li>
          )}
          {items.map((item, i) => (
            <StepRow
              key={item.id}
              guide={guide}
              item={item}
              number={firstNumber + i}
              index={index}
              profile={profile}
              warnings={warnings.get(item.id)}
              selected={item.id === selected}
              found={found && isFound(item, found)}
              marker={markerAt === i + 1}
              batchPlace={batchPlace(items, i)}
              batchSize={item.batch === undefined ? 0 : items.filter((other) => other.batch === item.batch).length}
              batching={batching}
              onBatch={() => {
                if (batching === item.id) {
                  setBatching(undefined);
                } else if (item.batch !== undefined) {
                  app.edit((g) => unbatchItem(g, item.id));
                } else {
                  setBatching(item.id);
                }
              }}
              onPickForBatch={() => app.edit((g) => batchItems(g, batching!, item.id))}
              dragOver={dragOver?.id === item.id ? (dragOver.after ? "after" : "before") : undefined}
              onDragOver={(after) => setDragOver({ id: item.id, after })}
              onDragEnd={() => setDragOver(undefined)}
              onDrop={(draggedId, after) => {
                setDragOver(undefined);
                drop(item, after, draggedId);
              }}
              onOpen={onOpenStep}
            />
          ))}
        </ol>
        {items.length > 0 && markerAt !== 0 && (
          <div className="add-row">
            <button className="btn ghost small" onClick={() => app.setCursor({ chapterId: chapter.id })}>
              Put new steps at the start of this chapter
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// Where a step sits in its batch, for the batch's outline.
function batchPlace(items: GuideItem[], i: number): "first" | "middle" | "last" | undefined {
  const batch = items[i]!.batch;
  if (batch === undefined) return undefined;
  const before = items[i - 1]?.batch === batch;
  const after = items[i + 1]?.batch === batch;
  return before && after ? "middle" : before ? "last" : "first";
}

function InsertMarker() {
  return (
    <li className="insert-here" aria-label="New steps go here">
      new steps go here
    </li>
  );
}

function StepRow({
  guide,
  item,
  number,
  index,
  profile,
  warnings,
  selected,
  found,
  marker,
  batchPlace,
  batchSize,
  batching,
  onBatch,
  onPickForBatch,
  dragOver,
  onDragOver,
  onDragEnd,
  onDrop,
  onOpen,
}: {
  batchPlace: "first" | "middle" | "last" | undefined;
  batchSize: number;
  batching: number | undefined;
  onBatch: () => void;
  onPickForBatch: () => void;
  guide: Guide;
  item: GuideItem;
  number: number;
  index: QuestIndex | undefined;
  profile: Profile;
  warnings: Warning[] | undefined;
  selected: boolean;
  found: boolean | undefined; // undefined when not searching
  marker: boolean;
  dragOver?: "before" | "after";
  onDragOver: (after: boolean) => void;
  onDragEnd: () => void;
  onDrop: (draggedId: number, after: boolean) => void;
  onOpen: () => void;
}) {
  const app = useApp.getState();
  const severity = worst(warnings);
  const stepClass = item.class ?? (item.type === "quest" ? guide.questClasses[item.quest] : undefined);
  const otherClass = profile.class !== undefined && stepClass !== undefined && stepClass !== profile.class;
  const after = (event: React.DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY > box.top + box.height / 2;
  };

  return (
    <>
      <li
        className={[
          "step",
          batchPlace ? `batched batch-${batchPlace}` : "",
          batching === item.id ? "batch-anchor" : "",
          batching !== undefined && batching !== item.id ? "batch-pick" : "",
          otherClass ? "dimmed" : "",
          found ? "found" : found === false ? "not-found" : "",
          dragOver ? `drag-over-${dragOver}` : "",
        ].join(" ")}
        aria-selected={selected}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, String(item.id));
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(DRAG_TYPE)) {
            event.preventDefault();
            onDragOver(after(event));
          }
        }}
        onDragEnd={onDragEnd}
        onDrop={(event) => {
          event.preventDefault();
          onDrop(Number(event.dataTransfer.getData(DRAG_TYPE)), after(event));
        }}
        onClick={() => (batching !== undefined && batching !== item.id ? onPickForBatch() : app.select(item.id))}
        onDoubleClick={() => {
          app.select(item.id);
          onOpen();
        }}
        title={
          batching !== undefined && batching !== item.id
            ? "Add to the batch"
            : item.batch !== undefined
              ? "In a batch: done together with the steps around it"
              : undefined
        }
      >
        <span className="grip" aria-hidden>
          ⋮⋮
        </span>
        <span className="step-num">{number}</span>
        <div className="step-main">
          <span className="step-name">
            {item.type === "note" && <span className="tag">{NOTE_KIND_LABELS[item.kind ?? "note"]}</span>}{" "}
            {stepTitle(item, index)}
          </span>
          <span className="step-sub">
            {batchPlace === "first" && <span className="tag batch-tag">Batch · {batchSize} steps</span>}
            {item.type === "quest" && <QuestSub guide={guide} item={item} index={index} />}
            {stepClass && <span className="tag accent">{className(stepClass)}</span>}
            {severity && <SeverityIcon severity={severity} title={warnings!.map((w) => w.text).join("\n")} />}
            {severity && <span className="small">{warnings![0]!.text}</span>}
          </span>
        </div>
        <div className="step-end" onClick={(event) => event.stopPropagation()}>
          {item.type === "quest" && <Ticks item={item} />}
          {/* Shown over the row's end on hover or focus, so names get the room. */}
          <span className="step-actions">
            <button
              className={`icon-btn batch-btn${item.batch !== undefined || batching === item.id ? " active" : ""}`}
              aria-pressed={item.batch !== undefined || batching === item.id}
              title={
                batching === item.id
                  ? "Done batching"
                  : item.batch !== undefined
                    ? "Take this out of its batch"
                    : "Batch: then click the steps to do together with this one"
              }
              onClick={onBatch}
            >
              ⛓
            </button>
            <button
              className="icon-btn"
              title="Edit step: every setting, in the side panel"
              aria-label="Edit step"
              onClick={() => {
                app.select(item.id);
                onOpen();
              }}
            >
              ✎
            </button>
            <button className="icon-btn" title="Delete step" onClick={() => app.edit((g) => deleteItem(g, item.id))}>
              ✕
            </button>
          </span>
        </div>
        {selected && item.type === "quest" && <QuickSettings guide={guide} item={item} index={index} />}
      </li>
      {marker && <InsertMarker />}
    </>
  );
}

function QuestSub({ guide, item, index }: { guide: Guide; item: QuestItem; index: QuestIndex | undefined }) {
  const quest = index?.byId.get(item.quest);
  return (
    <>
      {quest && <span className="muted">{quest.level > 0 ? `Lv ${quest.level}` : "Any level"}</span>}
      {Array.isArray(item.objectives) && <span className="tag">objectives {item.objectives.join(", ")}</span>}
      {item.ongoing && <span className="tag">ongoing</span>}
      {guide.optionalQuests[item.quest] && <span className="tag">optional</span>}
    </>
  );
}

// Pick up / objectives / turn in.
export function Ticks({ item }: { item: QuestItem }) {
  const app = useApp.getState();
  const toggle = (key: Phase) =>
    app.edit((g) => {
      const step = g.items.find((i) => i.id === item.id) as QuestItem;
      if (step[key]) delete step[key];
      else step[key] = true;
    });
  return (
    <span className="ticks" role="group" aria-label="What this step does">
      {(["pickup", "objectives", "turnin"] as const).map((phase) => (
        <button
          key={phase}
          className="tick"
          aria-pressed={!!item[phase]}
          aria-label={PHASE_LABELS[phase]}
          title={`${PHASE_LABELS[phase]}: ${item[phase] ? "on" : "off"} for this step`}
          onClick={() => toggle(phase)}
        >
          <PhaseIcon phase={phase} />
        </button>
      ))}
    </span>
  );
}

// The selected quest step's everyday settings, on its row; the rest are in
// the side panel.
function QuickSettings({ guide, item, index }: { guide: Guide; item: QuestItem; index: QuestIndex | undefined }) {
  const app = useApp.getState();
  const objectives = index?.byId.get(item.quest)?.objectives ?? [];
  const chosen = (n: number) => item.objectives === true || (Array.isArray(item.objectives) && item.objectives.includes(n));
  return (
    <div className="step-quick" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      {item.objectives && objectives.length > 1 && (
        <span className="ticks" role="group" aria-label="Objectives this step does">
          {objectives.map((objective, i) => (
            <button
              key={i}
              className="tick"
              aria-pressed={chosen(i + 1)}
              title={objectiveText(index!, objective)}
              onClick={() => app.edit((g) => toggleObjective(g, item.id, i + 1, objectives.length))}
            >
              {i + 1}
            </button>
          ))}
        </span>
      )}
      <QuestOptions guide={guide} item={item} />
    </div>
  );
}

// A quest step's Ongoing and Optional boxes.
export function QuestOptions({ guide, item }: { guide: Guide; item: QuestItem }) {
  const app = useApp.getState();
  return (
    <>
      <label className="row" title="Worked on in the background until its next step">
        <input
          type="checkbox"
          checked={!!item.ongoing}
          onChange={(e) => app.edit((g) => updateItem(g, item.id, { ongoing: e.target.checked || undefined }))}
        />
        Ongoing
      </label>
      <label className="row" title="Fine to skip, e.g. an escort. Applies to every step for this quest.">
        <input
          type="checkbox"
          checked={!!guide.optionalQuests[item.quest]}
          onChange={(e) => app.edit((g) => setOptional(g, item.quest, e.target.checked))}
        />
        Optional
      </label>
    </>
  );
}
