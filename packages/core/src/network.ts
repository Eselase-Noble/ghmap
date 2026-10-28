/**
 * Loads the imported OpenStreetMap road dataset into a routable {@link Graph}.
 *
 * The importer (tools/import-osm.mjs) emits a compact JSON: parallel coordinate
 * arrays, a road-name dictionary, contracted edges that keep their shape
 * geometry, and snapped place names. This turns that back into the same Graph
 * the routing, trip, and traffic code already work with, plus a list of named
 * places for the gazetteer.
 */
import type { LatLng } from "./geo.ts";
import { Graph, type RoadClass } from "./graph.ts";
import type { GazPlace } from "./search.ts";

/** Shape of the JSON produced by tools/import-osm.mjs. */
export interface RoadNetworkData {
  meta: {
    generated: string;
    source: string;
    classesFetched: string[];
    wayCount: number;
    nodeCount: number;
    edgeCount: number;
    roadClasses: RoadClass[];
  };
  lat: number[];
  lng: number[];
  names: string[];
  /** [u, v, lengthM, classCode, oneway, nameIdx, geomFlat(lng,lat,…)] */
  edges: [number, number, number, number, number, number, number[]][];
  places: { name: string; kind: string; node: number; region?: string }[];
}

export interface LoadedNetwork {
  graph: Graph;
  places: GazPlace[];
  meta: RoadNetworkData["meta"];
}

export function loadRoadNetwork(data: RoadNetworkData): LoadedNetwork {
  const graph = new Graph();
  const { lat, lng, names, edges, places, meta } = data;
  const classes = meta.roadClasses;

  // Which node indices are named places (so we give them a useful node name).
  const placeName = new Map<number, { name: string; kind: string }>();
  for (const p of places) placeName.set(p.node, { name: p.name, kind: p.kind });

  const id = (i: number) => `n${i}`;
  for (let i = 0; i < lat.length; i++) {
    const named = placeName.get(i);
    graph.addNode({
      id: id(i),
      name: named?.name ?? "",
      location: { lat: lat[i]!, lng: lng[i]! },
      kind: named?.kind ?? "junction",
    });
  }

  const coord = (i: number): LatLng => ({ lat: lat[i]!, lng: lng[i]! });
  for (const [u, v, lengthM, classCode, oneway, nameIdx, geomFlat] of edges) {
    const roadClass = classes[classCode] ?? "tertiary";
    const name = nameIdx >= 0 ? names[nameIdx] : undefined;
    const geometry: LatLng[] = [];
    for (let k = 0; k + 1 < geomFlat.length; k += 2) {
      geometry.push({ lng: geomFlat[k]!, lat: geomFlat[k + 1]! });
    }
    graph.addEdge(id(u), id(v), roadClass, {
      lengthM,
      ...(name ? { name } : {}),
      geometry,
    });
    if (!oneway) {
      graph.addEdge(id(v), id(u), roadClass, {
        lengthM,
        ...(name ? { name } : {}),
        geometry: geometry.slice().reverse(),
      });
    }
  }

  // Each place gets a unique id (several can share a junction node).
  const gazPlaces: GazPlace[] = places.map((p, i) => ({
    id: `p${i}`,
    name: p.name,
    kind: p.kind,
    location: coord(p.node),
    node: id(p.node),
    ...(p.region ? { region: p.region } : {}),
  }));

  return { graph, places: gazPlaces, meta };
}
