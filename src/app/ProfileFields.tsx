// Who a guide is for: faction, races, class and professions.

import type { Faction } from "../lib/guide";
import { CLASSES, PROFESSIONS, racesFor, type Profile } from "../lib/questData";
import { Chips } from "./ui";

export function ProfileFields({
  faction,
  onFaction,
  profile,
  onProfile,
}: {
  faction: Faction;
  onFaction?: (faction: Faction) => void;
  profile: Profile;
  onProfile: (profile: Profile) => void;
}) {
  return (
    <>
      {onFaction && (
        <div className="field">
          <span>Faction</span>
          <Chips
            label="Faction"
            options={[
              { value: "Horde" as Faction, label: "Horde" },
              { value: "Alliance" as Faction, label: "Alliance" },
            ]}
            selected={[faction]}
            onChange={(selected) => {
              const next = selected.find((f) => f !== faction);
              if (next) {
                onFaction(next);
                onProfile({ ...profile, races: [] }); // races belong to a faction
              }
            }}
          />
        </div>
      )}
      <div className="field">
        <span>Races (none picked: any of the faction's)</span>
        <Chips
          label="Races"
          options={racesFor(faction).map((race) => ({ value: race.id, label: race.name }))}
          selected={profile.races}
          onChange={(races) => onProfile({ ...profile, races })}
        />
      </div>
      <label className="field">
        <span>Class</span>
        <select
          className="input"
          value={profile.class ?? ""}
          onChange={(event) => onProfile({ ...profile, class: event.target.value || undefined })}
        >
          <option value="">Any class (class quests get their class)</option>
          {CLASSES.map((c) => (
            <option key={c.file} value={c.file}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        <span>Professions (shows their quests)</span>
        <Chips
          label="Professions"
          options={PROFESSIONS.map((p) => ({ value: p.skill, label: p.name }))}
          selected={profile.professions}
          onChange={(professions) => onProfile({ ...profile, professions })}
        />
      </div>
    </>
  );
}
