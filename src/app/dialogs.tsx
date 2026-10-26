// Making, importing and exporting guides.

import { useState } from "react";
import type { Faction, Guide } from "../lib/guide";
import { exportGuide } from "../lib/guideString";
import type { Profile } from "../lib/questData";
import { ProfileFields } from "./ProfileFields";
import { useApp } from "./store";
import { Dialog } from "./ui";

export function NewGuideDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [faction, setFaction] = useState<Faction>("Horde");
  const [profile, setProfile] = useState<Profile>({ races: [], professions: [] });
  const create = () => {
    const id = useApp.getState().createGuide(name || "New guide", faction, profile);
    useApp.getState().open(id);
    onClose();
  };
  return (
    <Dialog title="New guide" onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input
          className="input"
          autoFocus
          value={name}
          maxLength={60}
          placeholder="e.g. Orc/Troll 1-12"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && create()}
        />
      </label>
      <ProfileFields faction={faction} onFaction={setFaction} profile={profile} onProfile={setProfile} />
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={create}>
          Create guide
        </button>
      </div>
    </Dialog>
  );
}

export function ProfileDialog({
  guide,
  profile,
  onClose,
}: {
  guide: Guide;
  profile: Profile;
  onClose: () => void;
}) {
  const [faction, setFaction] = useState<Faction>(guide.faction);
  const [draft, setDraft] = useState(profile);
  const save = () => {
    const app = useApp.getState();
    if (faction !== guide.faction) {
      app.edit((g) => {
        g.faction = faction;
      });
    }
    app.setProfile(draft);
    onClose();
  };
  return (
    <Dialog title="Who this guide is for" onClose={onClose}>
      <p className="muted small">
        These decide which quests the builder suggests and what it checks. Only the faction goes into the export
        string; the addon works out the rest from the character playing.
      </p>
      <ProfileFields faction={faction} onFaction={setFaction} profile={draft} onProfile={setDraft} />
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </Dialog>
  );
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const submit = () => {
    const result = useApp.getState().importString(text);
    if ("error" in result) {
      setError(result.error);
    } else {
      useApp.getState().open(result.id);
      onClose();
    }
  };
  return (
    <Dialog title="Import a guide" onClose={onClose}>
      <p className="muted small">
        Paste a string exported from the Level4ever addon (Guides tab, Export) or from this site. It's added as a new
        guide.
      </p>
      <textarea
        className="input"
        rows={8}
        autoFocus
        value={text}
        placeholder="L4G1:..."
        onChange={(event) => {
          setText(event.target.value);
          setError(undefined);
        }}
      />
      {error && <div className="notice error">{error}</div>}
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit} disabled={!text.trim()}>
          Import
        </button>
      </div>
    </Dialog>
  );
}

export function ExportDialog({ guide, onClose }: { guide: Guide; onClose: () => void }) {
  const text = exportGuide(guide);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  return (
    <Dialog title={`Export "${guide.name}"`} onClose={onClose}>
      <p className="muted small">
        In game, open Level4ever's Guides tab, click Import... and paste this. To bring a newer version of a guide you
        already imported up to date, paste it and click Update existing... instead; characters keep their progress.
      </p>
      <textarea
        className="input"
        rows={8}
        readOnly
        value={text}
        onFocus={(event) => event.currentTarget.select()}
        aria-label="Export string"
      />
      <div className="row muted small">{text.length.toLocaleString()} characters</div>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Close
        </button>
        <button className="btn primary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </Dialog>
  );
}
