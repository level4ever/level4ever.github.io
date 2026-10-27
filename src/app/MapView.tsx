// The map: the shown chapter's route over the zone's art, the selected
// step's objective spots, and picking a step's location with a click.

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getItem, setQuestValue, updateItem } from "../lib/editor";
import type { Coords, Guide, GuideItem } from "../lib/guide";
import type { Located } from "../data/types";
import { stateAt } from "../lib/analysis";
import { giverPlaces, round4, startingCoords, turnInPlaces, type Profile, type QuestIndex } from "../lib/questData";
import { groupByPlace, guideRoute, objectivePlaces, routeOnMap, stepRanges, type PointKind, type RoutePoint } from "../lib/route";
import { mapImageUrl, useMapArt, type MapArt } from "./maps";
import { stepTitle } from "./Steps";
import { cursorPosition, useApp } from "./store";

const KIND_LABELS: Record<PointKind, string> = {
  pickup: "Pick up",
  objectives: "Objectives",
  turnin: "Turn in",
  note: "Note",
};

// What clicking the map can set for a step: one per thing it does.
type PickTarget = { label: string; set: (guide: Guide, coords: Coords) => void };

function pickTargets(item: GuideItem | undefined): PickTarget[] {
  if (!item) return [];
  if (item.type === "note") {
    if (item.kind === "usehearth" || item.kind === "target") return [];
    return [{ label: "Note's place", set: (g, coords) => updateItem(g, item.id, { coords }) }];
  }
  const quest = item.quest;
  const targets: PickTarget[] = [];
  if (item.pickup) {
    targets.push({ label: "Pick-up spot", set: (g, coords) => setQuestValue(g, "questCoords", quest, coords) });
  }
  if (item.objectives) {
    const objectives = Array.isArray(item.objectives) ? item.objectives : [1];
    for (const objective of objectives) {
      targets.push({
        label: objectives.length > 1 || Array.isArray(item.objectives) ? `Objective ${objective} spot` : "Objectives spot",
        set: (g, coords) => {
          g.objectiveCoords[quest] = { ...g.objectiveCoords[quest], [objective]: coords };
        },
      });
    }
  }
  if (item.turnin) {
    targets.push({ label: "Turn-in spot", set: (g, coords) => setQuestValue(g, "turnInCoords", quest, coords) });
  }
  return targets;
}

// Game coordinates (0-100) to the image's Leaflet space and back. Leaflet's
// flat maps put y upwards, so rows go down into negative latitudes.
const toLatLng = (map: MapArt, x: number, y: number) => L.latLng((-y / 100) * map.height, (x / 100) * map.width);
const fromLatLng = (map: MapArt, at: L.LatLng) => ({ x: (at.lng / map.width) * 100, y: (-at.lat / map.height) * 100 });

export function MapView({ guide, index, profile }: { guide: Guide; index: QuestIndex; profile: Profile }) {
  const maps = useMapArt();
  const chapterId = useApp((s) => s.chapterId);
  const selectedId = useApp((s) => s.selectedItemId);
  const cursor = useApp((s) => s.cursor);
  const previewId = useApp((s) => s.previewQuest);
  const [mapId, setMapId] = useState<number>();
  const [picking, setPicking] = useState<number>(); // which of the step's targets
  const [hover, setHover] = useState<{ x: number; y: number }>();

  const route = useMemo(() => guideRoute(guide, index), [guide, index]);
  const mapName = useCallback(
    (id: number) => (typeof maps === "object" ? maps.get(id)?.name : undefined) ?? index.data.maps[id] ?? `map ${id}`,
    [maps, index],
  );
  const numbers = useMemo(() => new Map(guide.items.map((item, i) => [item.id, i + 1])), [guide.items]);
  const inChapter = useMemo(
    () => new Set(guide.items.filter((item) => item.chapterId === chapterId).map((item) => item.id)),
    [guide.items, chapterId],
  );
  // Memoized, as the map redraws when these change (and the mouse readout
  // re-renders on every move).
  const chapterRoute = useMemo(() => route.filter((point) => inChapter.has(point.itemId)), [route, inChapter]);
  const selected = selectedId === undefined ? undefined : getItem(guide, selectedId);
  // Where new steps go: the last place the guide has been by then.
  const position = cursorPosition(guide, cursor);
  const before = useMemo(() => new Set(guide.items.slice(0, position.index).map((item) => item.id)), [guide.items, position.index]);
  const here = useMemo(
    () => [...route].reverse().find((point) => before.has(point.itemId))?.coords ?? startingCoords(index, profile),
    [route, before, index, profile],
  );

  // A quest hovered in the side panel: where it's picked up, or if it's in
  // the log there, where it's done and turned in.
  const preview = useMemo(() => {
    const quest = previewId === undefined ? undefined : index.byId.get(previewId);
    if (!quest) return undefined;
    const inLog = stateAt(guide, profile, position.index, position.chapterId).picked.has(quest.id);
    return inLog
      ? { name: quest.name, spots: objectivePlaces(index, quest), givers: turnInPlaces(index, quest) }
      : { name: quest.name, spots: [], givers: giverPlaces(index, quest) };
  }, [previewId, index, guide, profile, position.index, position.chapterId]);
  const targets = pickTargets(selected);
  const target = picking === undefined ? undefined : targets[picking];
  useEffect(() => setPicking(undefined), [selectedId]);

  // The chapter's maps, busiest first.
  const chapterMaps = useMemo(() => {
    const counts = new Map<number, number>();
    for (const point of chapterRoute) counts.set(point.coords.mapID, (counts.get(point.coords.mapID) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [chapterRoute]);

  // Follow the selected step to its map; otherwise, on a new chapter, the
  // chapter's main map.
  const selectedMap = route.find((point) => point.itemId === selectedId)?.coords.mapID;
  const lastChapter = useRef(chapterId);
  useEffect(() => {
    const newChapter = lastChapter.current !== chapterId;
    lastChapter.current = chapterId;
    if (selectedMap !== undefined) setMapId(selectedMap);
    else if (newChapter) setMapId(undefined);
  }, [selectedMap, chapterId]);
  const fallback = chapterMaps[0] ?? startingCoords(index, profile)?.mapID ?? 1411;
  const shown = typeof maps === "object" ? (maps.get(mapId ?? fallback) ?? maps.get(fallback)) : undefined;
  const shownId = shown?.id;
  const pointsHere = useMemo(() => chapterRoute.filter((point) => point.coords.mapID === shownId), [chapterRoute, shownId]);

  if (maps === "error") {
    return <div className="panel-section notice error">Couldn't load the maps. Reload the page to try again.</div>;
  }
  if (!maps || !shown) {
    return <div className="panel-section notice">Loading maps…</div>;
  }

  const zones = [...maps.values()].filter((m) => m.type === "zone" || m.type === "micro").sort((a, b) => a.name.localeCompare(b.name));
  const elsewhere = chapterRoute.length - pointsHere.length;
  const previewMaps = preview
    ? [...new Set([...preview.givers, ...preview.spots].flatMap((place) => Object.keys(place.spawns ?? {}).map(Number)))]
    : [];
  const previewElsewhere = preview && previewMaps.length > 0 && !previewMaps.includes(shown.id);

  return (
    <div className="map-panel">
      <div className="panel-section map-toolbar">
        <div className="row">
          <select
            className="input"
            style={{ flex: 1, minWidth: 160 }}
            aria-label="Map"
            value={shown.id}
            onChange={(event) => setMapId(Number(event.target.value))}
          >
            {chapterMaps.length > 0 && (
              <optgroup label="In this chapter">
                {chapterMaps.map((id) => (
                  <option key={`c${id}`} value={id}>
                    {maps.get(id)?.name ?? `Map ${id}`}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="All zones">
              {zones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          </select>
          <span className="muted small coords-readout" aria-live="off">
            {hover ? `${hover.x.toFixed(1)}, ${hover.y.toFixed(1)}` : ""}
          </span>
        </div>
        <div className="row small">
          {targets.length > 0 ? (
            <>
              <span className="muted">Set on the map:</span>
              {targets.map((t, i) => (
                <button
                  key={t.label}
                  className={`btn small${picking === i ? " primary" : ""}`}
                  aria-pressed={picking === i}
                  onClick={() => setPicking(picking === i ? undefined : i)}
                >
                  {t.label}
                </button>
              ))}
              {target && <span className="muted">Click the map (Esc to stop)</span>}
            </>
          ) : (
            <span className="muted">Select a step to see where it goes, or to set its place on the map.</span>
          )}
        </div>
        <Legend />
        {elsewhere > 0 && (
          <span className="muted small">
            {elsewhere} of this chapter's {chapterRoute.length} stops are on other maps.
          </span>
        )}
        {/* Always there, so hovering quests down the side list doesn't shift the map. */}
        <span className="small sev-info preview-where">
          {previewElsewhere
            ? `${preview!.name} is in ${previewMaps.map((id) => maps.get(id)?.name ?? `map ${id}`).join(", ")}.`
            : " "}
        </span>
      </div>
      <LeafletMap
        map={shown}
        points={pointsHere}
        chapterRoute={chapterRoute}
        mapName={mapName}
        onSwitchMap={setMapId}
        numbers={numbers}
        selectedId={selectedId}
        selected={selected}
        index={index}
        guide={guide}
        fitKey={`${shown.id}:${chapterId}`}
        here={here}
        preview={preview}
        picking={target !== undefined}
        onHover={setHover}
        onPick={(coords) => {
          if (!target) return;
          useApp.getState().edit((g) => target.set(g, coords));
          setPicking(undefined);
        }}
        onStopPicking={() => setPicking(undefined)}
      />
    </div>
  );
}

function Legend() {
  return (
    <div className="legend small">
      {(Object.keys(KIND_LABELS) as PointKind[]).map((kind) => (
        <span key={kind}>
          <i className={`pin-dot pin-${kind}`} /> {KIND_LABELS[kind]}
        </span>
      ))}
      <span>
        <i className="pin-dot pin-spawn" /> Objective spots
      </span>
    </div>
  );
}

function LeafletMap({
  map,
  points,
  chapterRoute,
  mapName,
  onSwitchMap,
  numbers,
  selectedId,
  selected,
  index,
  guide,
  fitKey,
  here,
  preview,
  picking,
  onHover,
  onPick,
  onStopPicking,
}: {
  fitKey: string;
  here: Coords | undefined;
  preview: { spots: Located[]; givers: Located[] } | undefined;
  map: MapArt;
  points: RoutePoint[];
  chapterRoute: RoutePoint[];
  mapName: (id: number) => string;
  onSwitchMap: (id: number) => void;
  numbers: Map<number, number>;
  selectedId: number | undefined;
  selected: GuideItem | undefined;
  index: QuestIndex;
  guide: Guide;
  picking: boolean;
  onHover: (at: { x: number; y: number } | undefined) => void;
  onPick: (coords: Coords) => void;
  onStopPicking: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const leaflet = useRef<
    { map: L.Map; image?: L.ImageOverlay; layers: L.LayerGroup; shownId?: number; fitted?: string } | undefined
  >(undefined);
  const handlers = useRef({ onHover, onPick, onStopPicking, onSwitchMap, picking, map });
  handlers.current = { onHover, onPick, onStopPicking, onSwitchMap, picking, map };

  // The Leaflet map, made once.
  useEffect(() => {
    const view = L.map(container.current!, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 3,
      zoomSnap: 0.25,
      attributionControl: false,
    });
    const layers = L.layerGroup().addTo(view);
    view.on("mousemove", (event: L.LeafletMouseEvent) => {
      const { map: shown } = handlers.current;
      const at = fromLatLng(shown, event.latlng);
      handlers.current.onHover(at.x >= 0 && at.x <= 100 && at.y >= 0 && at.y <= 100 ? at : undefined);
    });
    view.on("mouseout", () => handlers.current.onHover(undefined));
    view.on("click", (event: L.LeafletMouseEvent) => {
      const { picking: on, map: shown } = handlers.current;
      if (!on) return;
      const at = fromLatLng(shown, event.latlng);
      if (at.x < 0 || at.x > 100 || at.y < 0 || at.y > 100) return;
      handlers.current.onPick({ mapID: shown.id, x: round4(at.x / 100), y: round4(at.y / 100) });
    });
    const escape = (event: KeyboardEvent) => event.key === "Escape" && handlers.current.onStopPicking();
    window.addEventListener("keydown", escape);
    leaflet.current = { map: view, layers };
    return () => {
      window.removeEventListener("keydown", escape);
      view.remove();
      leaflet.current = undefined;
    };
  }, []);

  // The map's art, fitted to the panel when it changes.
  useEffect(() => {
    const state = leaflet.current;
    if (!state || state.shownId === map.id) return;
    const bounds = L.latLngBounds([-map.height, 0], [0, map.width]);
    state.image?.remove();
    state.image = L.imageOverlay(mapImageUrl(map), bounds).addTo(state.map);
    state.map.setMaxBounds(bounds.pad(0.25));
    state.shownId = map.id;
  }, [map]);

  // On a new map or chapter: the chapter's route here, or the whole map.
  useEffect(() => {
    const state = leaflet.current;
    if (!state || state.fitted === fitKey) return;
    state.fitted = fitKey;
    const whole = L.latLngBounds([-map.height, 0], [0, map.width]);
    if (points.length === 0) {
      state.map.fitBounds(whole);
      return;
    }
    const route = L.latLngBounds(points.map((p) => toLatLng(map, p.coords.x * 100, p.coords.y * 100)));
    state.map.fitBounds(route.pad(0.35), { maxZoom: 2.5 });
    // Never smaller than the whole map would be.
    if (state.map.getZoom() < state.map.getBoundsZoom(whole)) state.map.fitBounds(whole);
  }, [fitKey, map, points]);

  useEffect(() => {
    container.current?.classList.toggle("picking", picking);
  }, [picking]);

  // The route, pins and the selected step's objective spots.
  useEffect(() => {
    const state = leaflet.current;
    if (!state) return;
    state.layers.clearLayers();
    const at = (c: Coords) => toLatLng(map, c.x * 100, c.y * 100);

    // Where the selected quest is done, picked up and turned in.
    const quest = selected?.type === "quest" ? index.byId.get(selected.quest) : undefined;
    if (quest && selected?.type === "quest") {
      const chosen = Array.isArray(selected.objectives) ? selected.objectives : undefined;
      const spots = [
        ...objectivePlaces(index, quest, chosen).map((place) => ({ place, kind: "spawn" })),
        ...(selected.pickup ? giverPlaces(index, quest).map((place) => ({ place, kind: "giver" })) : []),
        ...(selected.turnin ? turnInPlaces(index, quest).map((place) => ({ place, kind: "ender" })) : []),
      ];
      let drawn = 0;
      for (const { place, kind } of spots) {
        for (const [x, y] of place.spawns?.[map.id] ?? []) {
          if (drawn++ > 600) break;
          L.circleMarker(toLatLng(map, x, y), {
            radius: kind === "spawn" ? 4 : 6,
            className: `spawn spawn-${kind}`,
            interactive: false,
          }).addTo(state.layers);
        }
      }
    }

    // Where new steps go.
    if (here && here.mapID === map.id) {
      L.marker(at(here), {
        icon: L.divIcon({ className: "here-marker", iconSize: [34, 34], iconAnchor: [17, 17] }),
        interactive: false,
        zIndexOffset: -100,
      }).addTo(state.layers);
    }

    // A quest being looked at in the side panel.
    for (const place of preview?.spots ?? []) {
      for (const [x, y] of (place.spawns?.[map.id] ?? []).slice(0, 300)) {
        L.circleMarker(toLatLng(map, x, y), { radius: 4, className: "spawn spawn-preview", interactive: false }).addTo(
          state.layers,
        );
      }
    }
    for (const place of preview?.givers ?? []) {
      for (const [x, y] of place.spawns?.[map.id] ?? []) {
        L.marker(toLatLng(map, x, y), {
          icon: L.divIcon({ className: "preview-marker", html: "<span>!</span>", iconSize: [26, 26], iconAnchor: [13, 13] }),
          interactive: false,
          zIndexOffset: 2000,
        }).addTo(state.layers);
      }
    }

    // The chapter's path on this map: a line for each stretch walked here,
    // broken where it goes to another map, with where it goes and returns.
    const view = routeOnMap(chapterRoute, map.id);
    for (const leg of view.legs) {
      if (leg.length > 1) {
        L.polyline(leg.map((p) => at(p.coords)), { className: "route-line", interactive: false }).addTo(state.layers);
      }
    }
    for (const exit of view.exits) {
      const steps = stepRanges(exit.itemIds.map((id) => numbers.get(id) ?? 0));
      const label = L.marker(at(exit.at.coords), {
        icon: L.divIcon({
          className: "map-exit",
          html: `<span>→ ${escape(mapName(exit.map))} · steps ${steps}</span>`,
          iconSize: undefined,
          iconAnchor: [-20, 26],
        }),
        zIndexOffset: 1500,
        title: `Then to ${mapName(exit.map)} for steps ${steps}. Click to show that map.`,
      });
      label.on("click", () => handlers.current.onSwitchMap(exit.map));
      label.addTo(state.layers);
    }
    for (const entry of view.entries) {
      const label = L.marker(at(entry.at.coords), {
        icon: L.divIcon({
          className: "map-entry",
          html: `<span>from ${escape(mapName(entry.map))}</span>`,
          iconSize: undefined,
          iconAnchor: [-20, -6],
        }),
        zIndexOffset: 1400,
        title: `Coming from ${mapName(entry.map)}. Click to show that map.`,
      });
      label.on("click", () => handlers.current.onSwitchMap(entry.map));
      label.addTo(state.layers);
    }

    // One pin per place: steps at the same spot share it.
    for (const group of groupByPlace(points)) {
      const chosen = group.find((p) => p.itemId === selectedId);
      const lead = chosen ?? group[0]!;
      const stepNumbers = group.map((p) => numbers.get(p.itemId) ?? 0);
      const unique = [...new Set(stepNumbers)];
      const lines = group.map((p) => {
        const item = getItem(guide, p.itemId);
        return `${numbers.get(p.itemId)}. ${KIND_LABELS[p.kind]}: ${item ? stepTitle(item, index) : ""}${p.fromGuide ? "" : " (from the quest data)"}`;
      });
      const title = unique.length > 1 ? `${unique.length} steps here:\n${lines.join("\n")}` : lines.join("\n");
      // A shared pin shows its first (or selected) step, with a badge counting all of them.
      const badge = unique.length > 1 ? `<b class="pin-count">${unique.length}</b>` : "";
      const marker = L.marker(at(lead.coords), {
        // A zero-size anchor at the spot, with the pin centred on it and as
        // wide as its number (step numbers run into the hundreds).
        icon: L.divIcon({
          className: "pin-anchor",
          html: `<span class="pin pin-${lead.kind}${chosen ? " selected" : ""}${lead.fromGuide ? "" : " guessed"}${unique.length > 1 ? " stacked" : ""}">${numbers.get(lead.itemId) ?? unique[0]}${badge}</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0],
        }),
        zIndexOffset: chosen ? 1000 : 0,
        title,
      });
      // Clicking a shared pin goes through its steps in turn.
      marker.on("click", () => {
        if (handlers.current.picking) return;
        const ids = [...new Set(group.map((p) => p.itemId))];
        const next = ids[(ids.indexOf(selectedId ?? -1) + 1) % ids.length]!;
        useApp.getState().select(next);
      });
      marker.addTo(state.layers);
    }
  }, [map, points, chapterRoute, mapName, numbers, selectedId, selected, index, guide, here, preview]);

  // Keep the selected step in view as steps are added and picked.
  useEffect(() => {
    const state = leaflet.current;
    const point = points.find((p) => p.itemId === selectedId);
    if (state && point) {
      state.map.panInside(toLatLng(map, point.coords.x * 100, point.coords.y * 100), { padding: [40, 40] });
    }
  }, [selectedId, points, map]);

  return <div ref={container} className="leaflet-host" role="application" aria-label={`Map of ${map.name}`} />;
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
