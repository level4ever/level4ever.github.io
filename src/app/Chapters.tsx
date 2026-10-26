// The guide's chapters. Click one to show its steps; drop a step on one to
// move it to the end of that chapter.

import { useState } from "react";
import type { Warning } from "../lib/analysis";
import { addChapter, chapterItems, deleteChapter, moveChapter, moveItem } from "../lib/editor";
import type { Guide } from "../lib/guide";
import { useApp } from "./store";
import { SeverityIcon, worst } from "./ui";

export const DRAG_TYPE = "application/x-level4ever-step";

export function Chapters({ guide, warnings }: { guide: Guide; warnings: Map<number, Warning[]> }) {
  const current = useApp((s) => s.chapterId);
  const [dropTarget, setDropTarget] = useState<number>();
  const app = useApp.getState();

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
      <div className="scroll">
        {guide.chapters.map((chapter, i) => {
          const items = chapterItems(guide, chapter.id);
          const severity = worst(items.flatMap((item) => (warnings.get(item.id) ?? []).filter((w) => w.severity !== "info")));
          return (
            <div
              key={chapter.id}
              className={`chapter${dropTarget === chapter.id ? " drop-target" : ""}`}
              aria-current={chapter.id === current}
              onClick={() => app.showChapter(chapter.id)}
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
                    {items.length} steps{chapter.level ? ` · to ${chapter.level}` : ""}
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
