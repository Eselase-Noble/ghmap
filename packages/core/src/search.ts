/**
 * Place search and reverse geocoding over the GhMap graph.
 *
 * These back the search box ("type a town, get suggestions") and the
 * click-anywhere behaviour ("what's the nearest place to this point?").
 */
import type { LatLng } from "./geo.ts";
import { haversine } from "./geo.ts";
import type { Graph, PlaceNode } from "./graph.ts";
import { SpatialGrid } from "./spatial-index.ts";

export interface SearchResult {
  node: PlaceNode;
  /** Lower is a better match. */
  score: number;
}

/**
 * Rank places against a free-text query. Exact matches rank first, then
 * prefix matches, then any substring, with region names also searched. Results
 * come back best-first, capped at `limit`.
 */
export function searchPlaces(
  graph: Graph,
  query: string,
  limit = 8,
): PlaceNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: SearchResult[] = [];
  for (const node of graph.nodeList()) {
    const name = node.name.toLowerCase();
    const region = (node.region ?? "").toLowerCase();
    let score: number;
    if (name === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q)) score = 2;
    else if (region.startsWith(q)) score = 3;
    else if (region.includes(q)) score = 4;
    else continue;
    // Prefer bigger places (cities/capitals) on ties.
    const kindBonus = node.kind === "capital" ? -0.3 : node.kind === "city" ? -0.2 : 0;
    scored.push({ node, score: score + kindBonus });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.node.name.localeCompare(b.node.name))
    .slice(0, limit)
    .map((r) => r.node);
}

/** A reusable reverse-geocoder built from the graph's places. */
export class ReverseGeocoder {
  private readonly grid: SpatialGrid<{ id: string; location: LatLng }>;
  private readonly graph: Graph;

  constructor(graph: Graph) {
    this.graph = graph;
    this.grid = new SpatialGrid();
    this.grid.insertAll(
      graph.nodeList().map((n) => ({ id: n.id, location: n.location })),
    );
  }

  /** The nearest known place to a point, plus the distance to it in metres. */
  nearest(point: LatLng): { node: PlaceNode; distanceM: number } | null {
    const hit = this.grid.nearest(point);
    if (!hit) return null;
    const node = this.graph.getNode(hit.id);
    if (!node) return null;
    return { node, distanceM: haversine(point, node.location) };
  }

  /** A short "near X" style label for a point. */
  label(point: LatLng): string {
    const hit = this.nearest(point);
    if (!hit) return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
    const km = hit.distanceM / 1000;
    if (km < 1.5) return hit.node.name;
    return `${km.toFixed(0)} km from ${hit.node.name}`;
  }
}
