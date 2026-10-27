/** Small presentation helpers and map style config for the web app. */
import type { CostMode, Graph, Maneuver, NodeId, RouteResult, TravelMode } from "@ghmap/core";

/** Keyless vector base map (OpenFreeMap). */
export const BASE_STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** Esri World Imagery raster tiles, used for the satellite layer. */
export const SATELLITE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export const GHANA_CENTER: [number, number] = [-1.0232, 7.9465];
export const GHANA_BOUNDS: [[number, number], [number, number]] = [
  [-3.5, 4.4],
  [1.3, 11.3],
];

export function formatKm(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(0)} km` : `${Math.round(m)} m`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

/** Build a GeoJSON LineString for a computed route. */
export function routeToGeoJSON(
  graph: Graph,
  route: RouteResult,
): GeoJSON.Feature<GeoJSON.LineString> {
  const coords = route.path
    .map((id: NodeId) => graph.getNode(id)?.location)
    .filter((l): l is { lat: number; lng: number } => !!l)
    .map((l) => [l.lng, l.lat] as [number, number]);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

export const EMPTY_LINE: GeoJSON.Feature<GeoJSON.LineString> = {
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: [] },
};

/** Clock arrival time given a travel duration from now. */
export function arrivalTime(seconds: number): string {
  const d = new Date(Date.now() + seconds * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Emoji glyph for each travel mode, for the mode switcher. */
export const MODE_ICON: Record<TravelMode, string> = {
  drive: "🚗",
  cycle: "🚲",
  walk: "🚶",
};

export const MODE_LABEL: Record<TravelMode, string> = {
  drive: "Drive",
  cycle: "Cycle",
  walk: "Walk",
};

/** A small arrow glyph for each turn-by-turn maneuver. */
export const MANEUVER_ICON: Record<Maneuver, string> = {
  depart: "🧭",
  continue: "⬆️",
  "slight-left": "↖️",
  left: "⬅️",
  "sharp-left": "↩️",
  "slight-right": "↗️",
  right: "➡️",
  "sharp-right": "↪️",
  uturn: "🔄",
  arrive: "📍",
};

/** The shareable app state encoded in the URL query string. */
export interface UrlState {
  origin: string | null;
  destination: string | null;
  mode: TravelMode;
  metric: CostMode;
  view: "streets" | "satellite";
}

export function readUrlState(): Partial<UrlState> {
  const p = new URLSearchParams(window.location.search);
  const out: Partial<UrlState> = {};
  if (p.get("from")) out.origin = p.get("from");
  if (p.get("to")) out.destination = p.get("to");
  const m = p.get("mode");
  if (m === "drive" || m === "cycle" || m === "walk") out.mode = m;
  const c = p.get("by");
  if (c === "time" || c === "distance") out.metric = c;
  const v = p.get("view");
  if (v === "streets" || v === "satellite") out.view = v;
  return out;
}

export function writeUrlState(s: UrlState): void {
  const p = new URLSearchParams();
  if (s.origin) p.set("from", s.origin);
  if (s.destination) p.set("to", s.destination);
  p.set("mode", s.mode);
  p.set("by", s.metric);
  p.set("view", s.view);
  const url = `${window.location.pathname}?${p.toString()}`;
  window.history.replaceState(null, "", url);
}
