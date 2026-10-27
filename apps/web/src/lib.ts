/** Small presentation helpers and map style config for the web app. */
import type { Graph, NodeId, RouteResult } from "@ghmap/core";

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
