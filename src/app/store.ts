// The app's state: saved guides, the one being edited, where new steps go,
// and the quest data for each faction.

import { produce } from "immer";
import { create } from "zustand";
import type { QuestData } from "../data/types";
import { copyGuide, newGuide } from "../lib/editor";
import type { Faction, Guide } from "../lib/guide";
import { importGuide, newUid } from "../lib/guideString";
import { guessProfile, indexQuestData, type Profile, type QuestIndex } from "../lib/questData";
import { guideRoute } from "../lib/route";
import { deleteGuide, loadGuides, saveGuide, type StoredGuide } from "./storage";

// The zone filter's value for "where the guide's race starts", worked out
// once the quest data is in (see startingZone).
export const STARTING_ZONE = "@start";

// Where new steps go: after an item, or at the start of a chapter.
export type Cursor = { itemId: number } | { chapterId: number };

type DataState = { status: "loading" } | { status: "ready"; index: QuestIndex } | { status: "error"; error: string };

// The open guide's earlier and undone versions. `key` and `time` belong to
// the last edit: a run of edits with the same key (typing in one field) is
// one step to undo.
interface History {
  past: Guide[];
  future: Guide[];
  key?: string;
  time?: number;
}

const HISTORY_LIMIT = 200;
const COALESCE_MS = 1500;
const NO_HISTORY: History = { past: [], future: [] };

interface AppState {
  loaded: boolean;
  guides: Record<string, StoredGuide>;
  activeId?: string;
  chapterId?: number; // the chapter shown
  cursor?: Cursor;
  selectedItemId?: number; // the step shown in the step panel
  previewQuest?: number; // a quest being looked at in the side panel, shown on the map
  // The side panel's zone filter: a zone's name, or the race's starting zone
  // (STARTING_ZONE), which a guide with no steps yet opens on. Showing a
  // chapter sets it to its first step's zone.
  zoneFilter?: string;
  findText: string; // the "Find quest" box: a quest ID or part of a name
  data: Partial<Record<Faction, DataState>>;
  history: History;
  deleted?: StoredGuide; // the guide deleted last, until it's restored or another goes

  load(): Promise<void>;
  createGuide(name: string, faction: Faction, profile: Profile): string;
  importString(text: string): { id: string } | { error: string };
  duplicateGuide(id: string): string;
  removeGuide(id: string): void;
  restoreDeleted(): void;
  dismissDeleted(): void;
  open(id: string | undefined): void;
  // `coalesce` names what's being edited (e.g. a text field), so a run of
  // edits to it undoes in one go.
  edit(change: (guide: Guide) => void, coalesce?: string): void;
  undo(): void;
  redo(): void;
  setProfile(profile: Profile): void;
  // `itemId` picks the step to select, instead of the chapter's first.
  showChapter(chapterId: number, itemId?: number): void;
  select(itemId: number | undefined): void;
  setCursor(cursor: Cursor): void;
  setPreview(questID: number | undefined): void;
  setZoneFilter(zone: string | undefined): void;
  setFindText(text: string): void;
  loadData(faction: Faction): void;
}

const LAST_OPEN = "level4ever:open";

function remember(id: string | undefined) {
  try {
    if (id) localStorage.setItem(LAST_OPEN, id);
    else localStorage.removeItem(LAST_OPEN);
  } catch {
    // Storage may be unavailable (private windows); it's only a convenience.
  }
}

function recall(): string | undefined {
  try {
    return localStorage.getItem(LAST_OPEN) ?? undefined;
  } catch {
    return undefined;
  }
}

// Edits are saved after a short pause, so typing doesn't write on every key;
// anything waiting is written at once when the page is hidden or closed.
// New and restored guides are written straight away.
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; record: StoredGuide }>();

function write(record: StoredGuide) {
  saveGuide(record).catch((error) => console.error("Couldn't save the guide", error));
}

function persist(record: StoredGuide, now = false) {
  clearTimeout(pending.get(record.id)?.timer);
  pending.delete(record.id);
  if (now) {
    write(record);
    return;
  }
  const timer = setTimeout(() => {
    pending.delete(record.id);
    write(record);
  }, 300);
  pending.set(record.id, { timer, record });
}

function cancelSave(id: string) {
  clearTimeout(pending.get(id)?.timer);
  pending.delete(id);
}

export function flushSaves() {
  for (const { timer, record } of pending.values()) {
    clearTimeout(timer);
    write(record);
  }
  pending.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushSaves);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushSaves());
}

function newId(): string {
  return crypto.randomUUID();
}

function record(guide: Guide, profile: Profile): StoredGuide {
  const now = new Date().toISOString();
  return { id: newId(), guide, profile, created: now, updated: now };
}

export const useApp = create<AppState>()((setState, get) => {
  const add = (stored: StoredGuide) => {
    setState((s) => ({ guides: { ...s.guides, [stored.id]: stored } }));
    persist(stored, true);
    return stored.id;
  };

  // Puts a new version of the open guide in place and keeps the view on
  // things that still exist in it.
  const setGuide = (stored: StoredGuide, guide: Guide) => {
    const updated = { ...stored, guide, updated: new Date().toISOString() };
    setState((s) => ({ guides: { ...s.guides, [updated.id]: updated } }));
    persist(updated);
    // A faction change needs that faction's data.
    if (guide.faction !== stored.guide.faction) {
      get().loadData(guide.faction);
    }
    const { chapterId, selectedItemId, cursor } = get();
    const chapter = guide.chapters.find((c) => c.id === chapterId) ?? guide.chapters[0];
    const hasItem = (id?: number) => id !== undefined && guide.items.some((item) => item.id === id);
    setState({
      chapterId: chapter?.id,
      selectedItemId: hasItem(selectedItemId) ? selectedItemId : undefined,
      cursor:
        cursor && ("itemId" in cursor ? hasItem(cursor.itemId) : guide.chapters.some((c) => c.id === cursor.chapterId))
          ? cursor
          : chapter && endOfChapter(guide, chapter.id),
    });
  };

  const active = () => {
    const { activeId, guides } = get();
    return activeId ? guides[activeId] : undefined;
  };

  return {
    loaded: false,
    guides: {},
    data: {},
    findText: "",
    history: NO_HISTORY,

    async load() {
      const list = await loadGuides();
      // Saved before every guide had a uid: it needs one to export.
      for (const stored of list.filter((g) => !g.guide.uid)) {
        stored.guide.uid = newUid();
        persist(stored, true);
      }
      const guides = Object.fromEntries(list.map((g) => [g.id, g]));
      setState({ guides, loaded: true });
      const last = recall();
      if (last && guides[last]) {
        get().open(last);
      }
    },

    createGuide(name, faction, profile) {
      return add(record(newGuide(name, faction), profile));
    },

    importString(text) {
      const result = importGuide(text);
      if (!result.guide) {
        return { error: result.error };
      }
      // Always a new guide, never over one here (even one with the same uid,
      // which may have edits of its own). It keeps its uid, so its exports
      // still update copies of it in game. One without a uid (or with a bad
      // one, dropped on import) gets a new one, as it can't export without.
      const { guide } = result;
      guide.uid ??= newUid();
      const data = get().data[guide.faction];
      if (data?.status === "ready") {
        return { id: add(record(guide, guessProfile(guide, data.index))) };
      }
      return { id: add({ ...record(guide, { races: [], professions: [] }), guessProfile: true }) };
    },

    duplicateGuide(id) {
      const source = get().guides[id]!;
      return add(record(copyGuide(source.guide, `${source.guide.name} (copy)`), structuredClone(source.profile)));
    },

    removeGuide(id) {
      const deleted = get().guides[id];
      setState((s) => {
        const { [id]: _, ...guides } = s.guides;
        return { guides, deleted, ...(s.activeId === id ? { activeId: undefined, history: NO_HISTORY } : {}) };
      });
      cancelSave(id);
      deleteGuide(id).catch((error) => console.error("Couldn't delete the guide", error));
    },

    restoreDeleted() {
      const { deleted } = get();
      if (deleted) {
        add(deleted);
        setState({ deleted: undefined });
      }
    },

    dismissDeleted() {
      setState({ deleted: undefined });
    },

    open(id) {
      const stored = id ? get().guides[id] : undefined;
      remember(stored?.id);
      const chapterId = stored?.guide.chapters[0]?.id;
      setState({
        activeId: stored?.id,
        history: stored?.id === get().activeId ? get().history : NO_HISTORY,
        chapterId,
        selectedItemId: undefined,
        findText: "",
        cursor: chapterId === undefined ? undefined : endOfChapter(stored!.guide, chapterId),
        // A brand new guide starts where its race starts.
        zoneFilter: stored && stored.guide.items.length === 0 && stored.profile.races.length > 0 ? STARTING_ZONE : undefined,
      });
      if (stored) {
        get().loadData(stored.guide.faction);
      }
    },

    edit(change, coalesce) {
      const stored = active();
      if (!stored) {
        return;
      }
      // Changes edit the draft; a value one returns (e.g. a new id) is ignored,
      // as immer would take it for a whole new guide.
      const guide = produce(stored.guide, (draft) => {
        change(draft);
      });
      if (guide === stored.guide) {
        return;
      }
      const { history } = get();
      const now = Date.now();
      const sameRun = coalesce !== undefined && history.key === coalesce && now - (history.time ?? 0) < COALESCE_MS;
      setState({
        history: {
          past: sameRun ? history.past : [...history.past, stored.guide].slice(-HISTORY_LIMIT),
          future: [],
          key: coalesce,
          time: now,
        },
      });
      setGuide(stored, guide);
    },

    undo() {
      const stored = active();
      const { past, future } = get().history;
      const previous = past[past.length - 1];
      if (stored && previous) {
        setState({ history: { past: past.slice(0, -1), future: [stored.guide, ...future] } });
        setGuide(stored, previous);
      }
    },

    redo() {
      const stored = active();
      const { past, future } = get().history;
      const next = future[0];
      if (stored && next) {
        setState({ history: { past: [...past, stored.guide], future: future.slice(1) } });
        setGuide(stored, next);
      }
    },

    setProfile(profile) {
      const stored = active();
      if (stored) {
        const updated = { ...stored, profile, updated: new Date().toISOString() };
        setState((s) => ({ guides: { ...s.guides, [updated.id]: updated } }));
        persist(updated);
      }
    },

    showChapter(chapterId, itemId) {
      const stored = get().activeId ? get().guides[get().activeId!] : undefined;
      // Its first step selected (so the map goes there), with new steps still
      // going at its end.
      const first = itemId ?? stored?.guide.items.find((item) => item.chapterId === chapterId)?.id;
      // The quests offered start with the zone that step is in (as the map
      // shows it); the filter is left as it was if there's none.
      const data = stored && get().data[stored.guide.faction];
      const index = data?.status === "ready" ? data.index : undefined;
      const mapID = index && guideRoute(stored!.guide, index).find((point) => point.itemId === first)?.coords.mapID;
      const zone = mapID === undefined ? undefined : index!.data.maps[mapID];
      setState({
        chapterId,
        selectedItemId: first,
        cursor: stored && endOfChapter(stored.guide, chapterId),
        ...(zone ? { zoneFilter: zone } : {}),
      });
    },

    select(itemId) {
      setState(itemId === undefined ? { selectedItemId: undefined } : { selectedItemId: itemId, cursor: { itemId } });
    },

    setCursor(cursor) {
      setState({ cursor });
    },

    setPreview(previewQuest) {
      setState({ previewQuest });
    },

    setZoneFilter(zoneFilter) {
      setState({ zoneFilter });
    },

    setFindText(findText) {
      setState({ findText });
    },

    loadData(faction) {
      if (get().data[faction]) {
        return;
      }
      const setData = (state: DataState) => setState((s) => ({ data: { ...s.data, [faction]: state } }));
      setData({ status: "loading" });
      fetch(`${import.meta.env.BASE_URL}data/${faction.toLowerCase()}.json`)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json() as Promise<QuestData>;
        })
        .then((data) => {
          const index = indexQuestData(data);
          setData({ status: "ready", index });
          // Guides imported while it loaded get their profile now.
          for (const stored of Object.values(get().guides)) {
            if (stored.guessProfile && stored.guide.faction === faction) {
              const { guessProfile: _, ...rest } = stored;
              const updated = { ...rest, profile: guessProfile(stored.guide, index) };
              setState((s) => ({ guides: { ...s.guides, [updated.id]: updated } }));
              persist(updated);
            }
          }
        })
        .catch((error: unknown) => setData({ status: "error", error: String(error) }));
    },
  };
});

// After a chapter's last item, or at its start if it's empty.
export function endOfChapter(guide: Guide, chapterId: number): Cursor {
  const items = guide.items.filter((item) => item.chapterId === chapterId);
  const last = items[items.length - 1];
  return last ? { itemId: last.id } : { chapterId };
}

// The guide index new steps go at, and as a chapter position.
export function cursorPosition(guide: Guide, cursor: Cursor | undefined): { index: number; chapterId: number; inChapter: number } {
  if (cursor && "itemId" in cursor) {
    const index = guide.items.findIndex((item) => item.id === cursor.itemId);
    if (index !== -1) {
      const item = guide.items[index]!;
      const inChapter = guide.items.slice(0, index + 1).filter((i) => i.chapterId === item.chapterId).length;
      return { index: index + 1, chapterId: item.chapterId, inChapter };
    }
  }
  const chapterId = cursor && "chapterId" in cursor ? cursor.chapterId : (guide.chapters[0]?.id ?? 1);
  const order = guide.chapters.findIndex((c) => c.id === chapterId);
  const before = new Set(guide.chapters.slice(0, order).map((c) => c.id));
  return { index: guide.items.filter((item) => before.has(item.chapterId)).length, chapterId, inChapter: 0 };
}

// The active guide, or undefined.
export function useActiveGuide(): StoredGuide | undefined {
  return useApp((s) => (s.activeId ? s.guides[s.activeId] : undefined));
}

export function useQuestIndex(faction: Faction | undefined): DataState | undefined {
  return useApp((s) => (faction ? s.data[faction] : undefined));
}
