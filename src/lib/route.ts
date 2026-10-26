// Where a guide's steps take a character, for the map: each step's points
// (pick up, objectives, turn in, or a note's place), in guide order.

import type { Located, Quest } from "../data/types";
import type { Coords, Guide, GuideItem } from "./guide";
import { nearestCoords, turnInPlaces, type QuestIndex } from "./questData";

export type PointKind = "pickup" | "objectives" | "turnin" | "note";

export interface RoutePoint {
  itemId: number;
  kind: PointKind;
  coords: Coords;
  // Set by the guide (questCoords, turnInCoords, objectiveCoords or a
  // note's coords), not worked out from the quest data.
  fromGuide: boolean;
}

// The NPCs, objects and places an objective is done at: monsters, objects,
// whatever drops an item, kill-credit targets and explored areas.
export function objectivePlaces(index: QuestIndex, quest: Quest, objectives?: number[]): Located[] {
  const { npcs, objects, items } = index.data;
  const places: (Located | undefined)[] = [];
  quest.objectives.forEach((objective, i) => {
    if (objectives && !objectives.includes(i + 1)) return;
    switch (objective.type) {
      case "monster":
        places.push(npcs[objective.id]);
        break;
      case "object":
        places.push(objects[objective.id]);
        break;
      case "item": {
        const item = items[objective.id];
        places.push(...(item?.npcDrops ?? []).map((id) => npcs[id]), ...(item?.objectDrops ?? []).map((id) => objects[id]));
        break;
      }
      case "killcredit":
        places.push(...[objective.id, ...objective.ids].map((id) => npcs[id]));
        break;
      case "event":
        places.push(objective);
        break;
    }
  });
  return places.filter((place): place is Located => place !== undefined);
}

// One step's points, each nearest to where the character was before it.
export function stepPoints(guide: Guide, index: QuestIndex, item: GuideItem, near?: Coords): RoutePoint[] {
  if (item.type === "note") {
    return item.coords ? [{ itemId: item.id, kind: "note", coords: item.coords, fromGuide: true }] : [];
  }
  const quest = index.byId.get(item.quest);
  const points: RoutePoint[] = [];
  const add = (kind: PointKind, coords: Coords | undefined, fromGuide: boolean) => {
    if (coords) {
      points.push({ itemId: item.id, kind, coords, fromGuide });
      near = coords;
    }
  };
  if (item.pickup) {
    add("pickup", guide.questCoords[item.quest], true);
  }
  if (item.objectives) {
    const chosen = Array.isArray(item.objectives) ? item.objectives : undefined;
    const set = guide.objectiveCoords[item.quest];
    const own = set && (chosen ?? Object.keys(set).map(Number)).map((n) => set[n]).find(Boolean);
    if (own) {
      add("objectives", own, true);
    } else if (quest) {
      add("objectives", nearestCoords(objectivePlaces(index, quest, chosen), near), false);
    }
  }
  if (item.turnin) {
    const own = guide.turnInCoords[item.quest];
    add("turnin", own ?? (quest && nearestCoords(turnInPlaces(index, quest), near)), own !== undefined);
  }
  return points;
}

// Every step's points, in guide order.
export function guideRoute(guide: Guide, index: QuestIndex): RoutePoint[] {
  const route: RoutePoint[] = [];
  let near: Coords | undefined;
  for (const item of guide.items) {
    const points = stepPoints(guide, index, item, near);
    route.push(...points);
    near = points[points.length - 1]?.coords ?? near;
  }
  return route;
}

// A route as seen on one map: the stretches it walks there (each a line),
// and where it leaves for other maps and comes back.
export interface MapView {
  legs: RoutePoint[][];
  // Leaving after `at`, for `map`, doing these steps away before coming back.
  exits: { at: RoutePoint; map: number; itemIds: number[] }[];
  // Coming back at `at`, from `map`.
  entries: { at: RoutePoint; map: number }[];
}

export function routeOnMap(route: RoutePoint[], mapID: number): MapView {
  const view: MapView = { legs: [], exits: [], entries: [] };
  let leg: RoutePoint[] = [];
  let away: RoutePoint[] = [];
  for (const point of route) {
    if (point.coords.mapID !== mapID) {
      if (leg.length > 0) {
        view.legs.push(leg);
        leg = [];
      }
      away.push(point);
      continue;
    }
    if (away.length > 0) {
      // Arriving from elsewhere: back from a trip, or the chapter started there.
      view.entries.push({ at: point, map: away[away.length - 1]!.coords.mapID });
    }
    away = [];
    leg.push(point);
  }
  if (leg.length > 0) view.legs.push(leg);
  // Exits: after each leg that isn't the route's end, to the next map.
  const legEnds = new Set(view.legs.map((l) => l[l.length - 1]!));
  route.forEach((point, i) => {
    if (!legEnds.has(point) || i === route.length - 1) return;
    const trip: RoutePoint[] = [];
    for (let j = i + 1; j < route.length && route[j]!.coords.mapID !== mapID; j++) trip.push(route[j]!);
    if (trip.length === 0) return;
    view.exits.push({ at: point, map: trip[0]!.coords.mapID, itemIds: [...new Set(trip.map((p) => p.itemId))] });
  });
  return view;
}

// Step numbers as ranges: [28, 29, 31] -> "28–29, 31".
export function stepRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return parts.join(", ");
}

// Points at the same place (within about a tenth of a percent of the map),
// so stacked steps show as one pin.
export function groupByPlace(points: RoutePoint[]): RoutePoint[][] {
  const groups = new Map<string, RoutePoint[]>();
  for (const point of points) {
    const key = `${point.coords.mapID}:${Math.round(point.coords.x * 1000)}:${Math.round(point.coords.y * 1000)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(point);
  }
  return [...groups.values()];
}
