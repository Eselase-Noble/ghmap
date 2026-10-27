/**
 * Shortest-path routing over the GhMap graph.
 *
 * Two algorithms, sharing the same priority-queue machinery:
 *  - {@link dijkstra}: optimal, explores uniformly outward from the origin.
 *  - {@link aStar}: optimal given an admissible heuristic; we use the
 *    straight-line (haversine) distance/time to the goal, which never
 *    overestimates, so A* returns the same optimal path as Dijkstra while
 *    exploring far fewer nodes.
 *
 * Cost can be minimised by distance (metres) or travel time (seconds).
 */
import type { Edge, Graph, NodeId, TravelMode } from "./graph.ts";
import { edgeTravelSeconds, modeSpeedKmh } from "./graph.ts";
import { haversine } from "./geo.ts";
import { PriorityQueue } from "./priority-queue.ts";

export type CostMode = "distance" | "time";

export interface RouteOptions {
  /** Minimise travel time (default) or raw distance. */
  metric?: CostMode;
  /** How the traveller moves; affects speed and therefore time. */
  mode?: TravelMode;
}

export interface RouteResult {
  /** Ordered list of node ids from origin to destination (inclusive). */
  readonly path: NodeId[];
  /** Total distance along the route, in metres. */
  readonly distanceM: number;
  /** Total travel time along the route, in seconds. */
  readonly timeS: number;
  /** How many nodes the search settled — useful for comparing algorithms. */
  readonly nodesExplored: number;
}

/** The fastest possible speed (km/h) a mode can travel, for the heuristic. */
function fastestKmh(mode: TravelMode): number {
  // modeSpeedKmh is constant for walk/cycle; for drive it peaks on motorways.
  return modeSpeedKmh(mode, "motorway");
}

/** Cost contributed by a single edge, under the chosen metric and mode. */
function edgeCost(edge: Edge, metric: CostMode, mode: TravelMode): number {
  return metric === "distance" ? edge.lengthM : edgeTravelSeconds(edge, mode);
}

/**
 * Admissible, consistent heuristic: the best conceivable cost from `a` to the
 * goal. For distance that's the straight line; for time it's that line covered
 * at the fastest speed the mode can reach. Never overestimates, so A* stays
 * optimal.
 */
function heuristic(
  graph: Graph,
  a: NodeId,
  goal: NodeId,
  metric: CostMode,
  mode: TravelMode,
): number {
  const na = graph.getNode(a);
  const ng = graph.getNode(goal);
  if (!na || !ng) return 0;
  const straight = haversine(na.location, ng.location);
  if (metric === "distance") return straight;
  return straight / ((fastestKmh(mode) * 1000) / 3600);
}

function reconstruct(
  cameFrom: Map<NodeId, Edge>,
  origin: NodeId,
  destination: NodeId,
  nodesExplored: number,
  mode: TravelMode,
): RouteResult {
  const path: NodeId[] = [destination];
  let distanceM = 0;
  let timeS = 0;
  let current = destination;
  while (current !== origin) {
    const edge = cameFrom.get(current);
    if (!edge) break; // unreachable
    distanceM += edge.lengthM;
    timeS += edgeTravelSeconds(edge, mode);
    current = edge.from;
    path.push(current);
  }
  path.reverse();
  return { path, distanceM, timeS, nodesExplored };
}

/** Classic Dijkstra. Returns null if the destination is unreachable. */
export function dijkstra(
  graph: Graph,
  origin: NodeId,
  destination: NodeId,
  options: RouteOptions = {},
): RouteResult | null {
  if (!graph.getNode(origin) || !graph.getNode(destination)) return null;
  const metric = options.metric ?? "time";
  const mode = options.mode ?? "drive";

  const dist = new Map<NodeId, number>([[origin, 0]]);
  const cameFrom = new Map<NodeId, Edge>();
  const settled = new Set<NodeId>();
  const frontier = new PriorityQueue<NodeId>();
  frontier.push(origin, 0);

  while (!frontier.isEmpty()) {
    const current = frontier.pop()!;
    if (current === destination) {
      return reconstruct(cameFrom, origin, destination, settled.size, mode);
    }
    if (settled.has(current)) continue;
    settled.add(current);

    const base = dist.get(current)!;
    for (const edge of graph.neighbors(current)) {
      if (settled.has(edge.to)) continue;
      const tentative = base + edgeCost(edge, metric, mode);
      if (tentative < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, tentative);
        cameFrom.set(edge.to, edge);
        frontier.push(edge.to, tentative);
      }
    }
  }
  return null;
}

/** A* with a haversine heuristic. Same optimal result as Dijkstra, fewer nodes. */
export function aStar(
  graph: Graph,
  origin: NodeId,
  destination: NodeId,
  options: RouteOptions = {},
): RouteResult | null {
  if (!graph.getNode(origin) || !graph.getNode(destination)) return null;
  const metric = options.metric ?? "time";
  const mode = options.mode ?? "drive";

  const gScore = new Map<NodeId, number>([[origin, 0]]);
  const cameFrom = new Map<NodeId, Edge>();
  const settled = new Set<NodeId>();
  const frontier = new PriorityQueue<NodeId>();
  frontier.push(origin, heuristic(graph, origin, destination, metric, mode));

  while (!frontier.isEmpty()) {
    const current = frontier.pop()!;
    if (current === destination) {
      return reconstruct(cameFrom, origin, destination, settled.size, mode);
    }
    if (settled.has(current)) continue;
    settled.add(current);

    const base = gScore.get(current)!;
    for (const edge of graph.neighbors(current)) {
      if (settled.has(edge.to)) continue;
      const tentative = base + edgeCost(edge, metric, mode);
      if (tentative < (gScore.get(edge.to) ?? Infinity)) {
        gScore.set(edge.to, tentative);
        cameFrom.set(edge.to, edge);
        const f =
          tentative + heuristic(graph, edge.to, destination, metric, mode);
        frontier.push(edge.to, f);
      }
    }
  }
  return null;
}
