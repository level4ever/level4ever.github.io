// Editing one guide: chapters, the chapter's steps, and the side panel for
// adding quests and editing the selected step.

import { useEffect, useMemo, useState } from "react";
import { analyzeGuide, type Warning } from "../lib/analysis";
import { cleanName } from "../lib/editor";
import { className, racesFor } from "../lib/questData";
import { Chapters } from "./Chapters";
import { ExportDialog, ProfileDialog } from "./dialogs";
import { MapView } from "./MapView";
import { QuestPanel } from "./QuestPanel";
import { StepPanel } from "./StepPanel";
import { Steps } from "./Steps";
import type { StoredGuide } from "./storage";
import { useApp, useQuestIndex } from "./store";
import { PhaseLegend } from "./ui";

// Undo and redo for the open guide, with Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
// (Cmd on a Mac). In a text box, those keys undo its typing instead.
function UndoButtons() {
  const canUndo = useApp((s) => s.history.past.length > 0);
  const canRedo = useApp((s) => s.history.future.length > 0);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!(event.ctrlKey || event.metaKey) || target?.closest?.("input, textarea, select, [contenteditable]")) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        useApp.getState().undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        useApp.getState().redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className="btn" disabled={!canUndo} onClick={() => useApp.getState().undo()} title="Undo (Ctrl+Z)">
        ↶ Undo
      </button>
      <button className="btn" disabled={!canRedo} onClick={() => useApp.getState().redo()} title="Redo (Ctrl+Shift+Z)">
        ↷ Redo
      </button>
    </div>
  );
}

export function Editor({ stored }: { stored: StoredGuide }) {
  const { guide, profile } = stored;
  const data = useQuestIndex(guide.faction);
  const index = data?.status === "ready" ? data.index : undefined;
  const selectedItemId = useApp((s) => s.selectedItemId);
  const [dialog, setDialog] = useState<"export" | "profile">();
  const [tab, setTab] = useState<"quests" | "step">("quests");

  const warnings = useMemo(
    () => (index ? analyzeGuide(guide, index, profile) : new Map<number, Warning[]>()),
    [guide, index, profile],
  );

  const races = racesFor(guide.faction).filter((r) => profile.races.includes(r.id));
  const who = [races.map((r) => r.name).join("/") || `Any ${guide.faction} race`, profile.class ? className(profile.class) : "any class"];
  const showStep = selectedItemId !== undefined && tab === "step";

  return (
    <div className="editor-shell">
      <div className="topbar">
        <span className={`tag ${guide.faction.toLowerCase()}`}>{guide.faction}</span>
        <input
          className="input"
          style={{ maxWidth: 360, fontWeight: 600 }}
          aria-label="Guide name"
          value={guide.name}
          maxLength={60}
          onChange={(event) =>
            useApp.getState().edit((g) => {
              g.name = event.target.value;
            }, "guide-name")
          }
          onBlur={() =>
            useApp.getState().edit((g) => {
              g.name = cleanName(g.name) || "New guide";
            }, "guide-name")
          }
        />
        <button className="btn ghost small" onClick={() => setDialog("profile")} title="Who this guide is for">
          {who.join(", ")} ✎
        </button>
        <div className="spacer" />
        <UndoButtons />
        <button className="btn primary" onClick={() => setDialog("export")}>
          Export string
        </button>
      </div>
      <main className="editor">
        <Chapters guide={guide} index={index} warnings={warnings} />
        <Steps
          guide={guide}
          index={index}
          profile={profile}
          warnings={warnings}
          onOpenStep={() => setTab("step")}
        />
        <section className="column map-column" aria-label="Map">
          {index ? (
            <MapView guide={guide} index={index} profile={profile} />
          ) : (
            <div className="panel-section notice">Loading the map…</div>
          )}
        </section>
        <section className="column side-column" aria-label="Side panel">
          {/* Adding quests is the usual view; a step's Edit button swaps in its settings until Back. */}
          <div className="column-head">
            {showStep ? (
              <>
                <button className="btn ghost small" onClick={() => setTab("quests")}>
                  ← Add quests
                </button>
                <h2 style={{ textAlign: "right" }}>Step settings</h2>
              </>
            ) : (
              <h2>Add quests</h2>
            )}
          </div>
          <PhaseLegend />
          {data?.status === "error" ? (
            <div className="panel-section">
              <div className="notice error">Couldn't load the quest data ({data.error}). Reload the page to try again.</div>
            </div>
          ) : !index ? (
            <div className="panel-section">
              <div className="notice">Loading {guide.faction} quests…</div>
            </div>
          ) : showStep ? (
            <StepPanel guide={guide} index={index} profile={profile} itemId={selectedItemId} warnings={warnings} />
          ) : (
            <QuestPanel guide={guide} index={index} profile={profile} />
          )}
        </section>
      </main>
      {dialog === "export" && <ExportDialog guide={guide} onClose={() => setDialog(undefined)} />}
      {dialog === "profile" && <ProfileDialog guide={guide} profile={profile} onClose={() => setDialog(undefined)} />}
    </div>
  );
}
