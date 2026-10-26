// The map art list (public/maps/maps.json, made by tools/maps/extract.py).

import { useEffect, useState } from "react";

export interface MapArt {
  id: number; // UiMapID
  name: string;
  type: "world" | "continent" | "zone" | "micro";
  parent: number | null;
  file: string;
  width: number;
  height: number;
}

let request: Promise<Map<number, MapArt>> | undefined;

function loadMaps(): Promise<Map<number, MapArt>> {
  request ??= fetch(`${import.meta.env.BASE_URL}maps/maps.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<{ maps: MapArt[] }>;
    })
    .then((list) => new Map(list.maps.map((map) => [map.id, map])))
    .catch((error) => {
      request = undefined; // try again next time
      throw error;
    });
  return request;
}

export function useMapArt(): Map<number, MapArt> | "error" | undefined {
  const [maps, setMaps] = useState<Map<number, MapArt> | "error">();
  useEffect(() => {
    let live = true;
    loadMaps()
      .then((list) => live && setMaps(list))
      .catch(() => live && setMaps("error"));
    return () => {
      live = false;
    };
  }, []);
  return maps;
}

export function mapImageUrl(map: MapArt): string {
  return `${import.meta.env.BASE_URL}maps/${map.file}`;
}
