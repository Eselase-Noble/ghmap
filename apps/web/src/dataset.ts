/**
 * Loads the map dataset for the app. Prefers the imported OpenStreetMap network
 * (apps/web/public/ghana-roads.json) for real road coverage; if it isn't there,
 * falls back to the hand-built seed graph so the app still works.
 *
 * Returns the raw place list (so the app can merge in the user's own custom
 * places and rebuild the gazetteer) plus a spatial index over graph nodes for
 * snapping arbitrary points (dropped pins, right-clicks) to the road network.
 */
import {
  buildGhanaGraph,
  loadRoadNetwork,
  SpatialGrid,
  TrafficModel,
  type GazPlace,
  type Graph,
  type LatLng,
  type RoadNetworkData,
} from "@ghmap/core";

export type NodeGrid = SpatialGrid<{ id: string; location: LatLng }>;

export interface Dataset {
  graph: Graph;
  places: GazPlace[];
  nodeGrid: NodeGrid;
  traffic: TrafficModel;
  source: "osm" | "seed";
  meta?: RoadNetworkData["meta"];
}

function buildNodeGrid(graph: Graph): NodeGrid {
  const grid = new SpatialGrid<{ id: string; location: LatLng }>();
  grid.insertAll(graph.nodeList().map((n) => ({ id: n.id, location: n.location })));
  return grid;
}

export async function loadDataset(): Promise<Dataset> {
  try {
    const res = await fetch("/ghana-roads.json", { cache: "force-cache" });
    if (res.ok) {
      const data = (await res.json()) as RoadNetworkData;
      if (data?.edges?.length) {
        const { graph, places, meta } = loadRoadNetwork(data);
        return {
          graph,
          places,
          nodeGrid: buildNodeGrid(graph),
          traffic: new TrafficModel(graph),
          source: "osm",
          meta,
        };
      }
    }
  } catch {
    /* fall through to seed */
  }

  const graph = buildGhanaGraph();
  const places: GazPlace[] = graph.nodeList().map((n) => ({
    id: n.id,
    name: n.name,
    kind: n.kind,
    location: n.location,
    node: n.id,
    ...(n.region ? { region: n.region } : {}),
  }));
  return {
    graph,
    places,
    nodeGrid: buildNodeGrid(graph),
    traffic: new TrafficModel(graph),
    source: "seed",
  };
}
