// Saved guides, in this browser's IndexedDB. Nothing leaves the browser:
// sharing a guide is done with its export string.

import { createStore, del, entries, set } from "idb-keyval";
import type { Guide } from "../lib/guide";
import type { Profile } from "../lib/questData";

export interface StoredGuide {
  id: string;
  guide: Guide;
  profile: Profile;
  // Imported before its faction's quest data loaded: the profile is guessed
  // from the guide once it has.
  guessProfile?: true;
  created: string; // ISO dates
  updated: string;
}

const store = createStore("level4ever", "guides");

export async function loadGuides(): Promise<StoredGuide[]> {
  return (await entries<string, StoredGuide>(store)).map(([, guide]) => guide);
}

export function saveGuide(guide: StoredGuide): Promise<void> {
  return set(guide.id, guide, store);
}

export function deleteGuide(id: string): Promise<void> {
  return del(id, store);
}
