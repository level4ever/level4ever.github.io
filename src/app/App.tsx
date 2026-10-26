import { useEffect } from "react";
import { Editor } from "./Editor";
import { Library } from "./Library";
import { useActiveGuide, useApp, useQuestIndex } from "./store";

export function App() {
  const loaded = useApp((s) => s.loaded);
  const active = useActiveGuide();
  useEffect(() => {
    useApp
      .getState()
      .load()
      .catch((error) => console.error("Couldn't load saved guides", error));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand btn ghost" onClick={() => useApp.getState().open(undefined)} title="All guides">
          <span className="brand-mark">L4</span>
          Level4ever Guide Builder
        </button>
        <div className="spacer" />
      </header>
      {!loaded ? <main className="library" /> : active ? <Editor stored={active} /> : <Library />}
      <Credit faction={active?.guide.faction} />
    </div>
  );
}

// The quest data's credit, as its license asks (see LICENSE).
function Credit({ faction }: { faction?: "Horde" | "Alliance" }) {
  const data = useQuestIndex(faction);
  const credit = data?.status === "ready" ? data.index.data.source.credit : undefined;
  return (
    <footer className="credit">
      {credit ? (
        <>
          {credit.text} <a href={credit.url}>Source</a>. Map art © Blizzard Entertainment.
        </>
      ) : (
        <>
          Quest data from <a href="https://github.com/Questie/QuestieDB">QuestieDB</a> by the Questie team and
          contributors, modified by the Level4ever data pipeline. Licensed under the GNU General Public License v3. Map
          art © Blizzard Entertainment.
        </>
      )}
    </footer>
  );
}
