/**
 * Loads the map dataset for the app. Prefers the imported OpenStreetMap network
 * (apps/web/public/ghana-roads.json) for real road coverage; if it isn't there,
 * falls back to the hand-built seed graph so the app still works.
 */
import {
  buildGhanaGraph,
  Gazetteer,
  loadRoadNetwork,
  TrafficModel,
  type GazPlace,
  type Graph,
  type RoadNetworkData,
} from "@ghmap/core";

export interface Dataset {
  graph: Graph;
  gazetteer: Gazetteer;
  traffic: TrafficModel;
  source: "osm" | "seed";
  meta?: RoadNetworkData["meta"];
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
          gazetteer: new Gazetteer(places),
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
    ...(n.region ? { region: n.region } : {}),
  }));
  return {
    graph,
    gazetteer: new Gazetteer(places),
    traffic: new TrafficModel(graph),
    source: "seed",
  };
}
