// The guides saved in this browser.

import { useEffect, useState } from "react";
import { ExportDialog, ImportDialog, NewGuideDialog } from "./dialogs";
import type { StoredGuide } from "./storage";
import { useApp } from "./store";

export function Library() {
  const guides = useApp((s) => s.guides);
  const [dialog, setDialog] = useState<"new" | "import" | { export: StoredGuide }>();
  const list = Object.values(guides).sort((a, b) => b.updated.localeCompare(a.updated));

  return (
    <main className="library">
      <div className="library-inner">
        <div className="library-head">
          <h1>Your guides</h1>
          <button className="btn" onClick={() => setDialog("import")}>
            Import string
          </button>
          <button className="btn primary" onClick={() => setDialog("new")}>
            New guide
          </button>
        </div>
        {list.length === 0 ? (
          <div className="empty">
            <h2>Build a levelling guide for Level4ever</h2>
            <p className="muted">
              Pick quests from the Forever quest data, put them in order, and export a string the addon imports.
              <br />
              Guides are saved in this browser only; export them to keep a copy or share them.
            </p>
            <div className="row">
              <button className="btn" onClick={() => setDialog("import")}>
                Import from the addon
              </button>
              <button className="btn primary" onClick={() => setDialog("new")}>
                Start a new guide
              </button>
            </div>
          </div>
        ) : (
          <div className="guide-grid">
            {list.map((stored) => (
              <GuideCard key={stored.id} stored={stored} onExport={() => setDialog({ export: stored })} />
            ))}
          </div>
        )}
      </div>
      <DeletedNotice />
      {dialog === "new" && <NewGuideDialog onClose={() => setDialog(undefined)} />}
      {dialog === "import" && <ImportDialog onClose={() => setDialog(undefined)} />}
      {typeof dialog === "object" && <ExportDialog guide={dialog.export.guide} onClose={() => setDialog(undefined)} />}
    </main>
  );
}

// After a guide is deleted: a way to bring it back, for a while.
function DeletedNotice() {
  const deleted = useApp((s) => s.deleted);
  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => useApp.getState().dismissDeleted(), 15000);
    return () => clearTimeout(timer);
  }, [deleted]);
  if (!deleted) return null;
  return (
    <div className="toast" role="status">
      <span>Deleted "{deleted.guide.name}".</span>
      <button className="btn small primary" onClick={() => useApp.getState().restoreDeleted()}>
        Undo
      </button>
      <button className="icon-btn" title="Dismiss" onClick={() => useApp.getState().dismissDeleted()}>
        ✕
      </button>
    </div>
  );
}

function GuideCard({ stored, onExport }: { stored: StoredGuide; onExport: () => void }) {
  const { guide } = stored;
  const quests = new Set(guide.items.flatMap((item) => (item.type === "quest" ? [item.quest] : []))).size;
  const app = useApp.getState();
  return (
    <article className="guide-card">
      <div className="row">
        <span className={`tag ${guide.faction.toLowerCase()}`}>{guide.faction}</span>
        <span className="muted small">Edited {new Date(stored.updated).toLocaleDateString()}</span>
      </div>
      <h2>{guide.name}</h2>
      <div className="muted small">
        {guide.chapters.length} chapter(s), {guide.items.length} step(s), {quests} quest(s)
      </div>
      <div className="actions">
        <button className="btn primary small" onClick={() => app.open(stored.id)}>
          Open
        </button>
        <button className="btn small" onClick={onExport}>
          Export
        </button>
        <button className="btn small" onClick={() => app.duplicateGuide(stored.id)}>
          Duplicate
        </button>
        <button className="btn small danger" onClick={() => app.removeGuide(stored.id)}>
          Delete
        </button>
      </div>
    </article>
  );
}
