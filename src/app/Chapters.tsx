// The guide's chapters. Click one to show its steps; drop a step on one to
// move it to the end of that chapter. "Find quest" lists only the chapters
// with a step for that quest, as the addon's does.

import { useState } from "react";
import type { Warning } from "../lib/analysis";
import { addChapter, chapterItems, deleteChapter, moveChapter, moveItem } from "../lib/editor";
import type { Guide, GuideItem } from "../lib/guide";
import type { QuestIndex } from "../lib/questData";
import { useApp } from "./store";
import { SeverityIcon, worst } from "./ui";

export const DRAG_TYPE = "application/x-level4ever-step";

// The quests "Find quest" is looking for: a quest ID, or the guide's quests
// with the text in their name. Undefined when the box is empty.
export function foundQuests(guide: Guide, index: QuestIndex | undefined, text: string): Set<number> | undefined {
  const term = text.trim().toLowerCase();
  if (!term) return undefined;
  if (/^\d+$/.test(term)) return new Set([Number(term)]);
  const quests = new Set(guide.items.flatMap((item) => (item.type === "quest" ? [item.quest] : [])));
  return new Set([...quests].filter((id) => index?.byId.get(id)?.name.toLowerCase().includes(term)));
}

export const isFound = (item: GuideItem, found: Set<number>) => item.type === "quest" && found.has(item.quest);

export function Chapters({
  guide,
  index,
  warnings,
}: {
  guide: Guide;
  index: QuestIndex | undefined;
  warnings: Map<number, Warning[]>;
}) {
  const current = useApp((s) => s.chapterId);
  const findText = useApp((s) => s.findText);
  const [dropTarget, setDropTarget] = useState<number>();
  const app = useApp.getState();
  const found = foundQuests(guide, index, findText);

  const add = () => {
    let id = 0;
    app.edit((g) => {
      id = addChapter(g, `Chapter ${g.chapters.length + 1}`, current).id;
    });
    app.showChapter(id);
  };

  return (
    <nav className="column" aria-label="Chapters">
      <div className="column-head">
        <h2>Chapters</h2>
        <button className="btn small" onClick={add} title="Add a chapter after this one">
          + Add
        </button>
      </div>
      <div className="find-quest">
        <input
          className="input"
          type="search"
          aria-label="Find quest"
          placeholder="Find quest (ID or name)"
          title="See where a quest is in the guide. Only the chapters with it are listed; inside a chapter, the other steps are dimmed. Escape clears it."
          value={findText}
          onChange={(event) => app.setFindText(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && app.setFindText("")}
        />
      </div>
      <div className="scroll">
        {found && !guide.items.some((item) => isFound(item, found)) && (
          <div className="muted small" style={{ padding: "8px 12px" }}>
            No chapter has that quest.
          </div>
        )}
        {guide.chapters.map((chapter, i) => {
          const items = chapterItems(guide, chapter.id);
          const matches = found && items.filter((item) => isFound(item, found));
          if (matches?.length === 0) return null;
          const severity = worst(items.flatMap((item) => (warnings.get(item.id) ?? []).filter((w) => w.severity !== "info")));
          return (
            <div
              key={chapter.id}
              className={`chapter${dropTarget === chapter.id ? " drop-target" : ""}`}
              aria-current={chapter.id === current}
              onClick={() => app.showChapter(chapter.id, matches?.[0]?.id)}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(DRAG_TYPE)) {
                  event.preventDefault();
                  setDropTarget(chapter.id);
                }
              }}
              onDragLeave={() => setDropTarget(undefined)}
              onDrop={(event) => {
                setDropTarget(undefined);
                const itemId = Number(event.dataTransfer.getData(DRAG_TYPE));
                if (itemId) {
                  event.preventDefault();
                  app.edit((g) => moveItem(g, itemId, { chapterId: chapter.id, index: chapterItems(g, chapter.id).length }));
                }
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="chapter-name">{chapter.name}</div>
                <div className="chapter-meta">
                  <span>
                    {matches ? `${matches.length} of ${items.length} steps` : `${items.length} steps`}
                    {chapter.level ? ` · to ${chapter.level}` : ""}
                  </span>
                  {severity && <SeverityIcon severity={severity} title="Some steps need a look" />}
                </div>
              </div>
              <div className="row" style={{ gap: 0 }} onClick={(event) => event.stopPropagation()}>
                <button
                  className="icon-btn"
                  title="Move up"
                  disabled={i === 0}
                  onClick={() => app.edit((g) => moveChapter(g, chapter.id, i - 1))}
                >
                  ↑
                </button>
                <button
                  className="icon-btn"
                  title="Move down"
                  disabled={i === guide.chapters.length - 1}
                  onClick={() => app.edit((g) => moveChapter(g, chapter.id, i + 1))}
                >
                  ↓
                </button>
                <button
                  className="icon-btn"
                  title="Delete chapter and its steps (Undo brings them back)"
                  disabled={guide.chapters.length === 1}
                  onClick={() => app.edit((g) => deleteChapter(g, chapter.id))}
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
