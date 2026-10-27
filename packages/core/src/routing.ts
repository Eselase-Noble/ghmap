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
import type { Edge, Graph, NodeId } from "./graph.ts";
import { ROAD_SPEED_KMH, edgeTravelSeconds } from "./graph.ts";
import { haversine } from "./geo.ts";
import { PriorityQueue } from "./priority-queue.ts";

export type CostMode = "distance" | "time";

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

const FASTEST_KMH = Math.max(...Object.values(ROAD_SPEED_KMH));

/** Cost contributed by a single edge, under the chosen mode. */
function edgeCost(edge: Edge, mode: CostMode): number {
  return mode === "distance" ? edge.lengthM : edgeTravelSeconds(edge);
}

/**
 * Admissible, consistent heuristic: the best conceivable cost from `a` to the
 * goal. For distance that's the straight line; for time it's that line covered
 * at the fastest road speed in the network. Never overestimates, so A* stays
 * optimal.
 */
function heuristic(graph: Graph, a: NodeId, goal: NodeId, mode: CostMode): number {
  const na = graph.getNode(a);
  const ng = graph.getNode(goal);
  if (!na || !ng) return 0;
  const straight = haversine(na.location, ng.location);
  if (mode === "distance") return straight;
  return straight / ((FASTEST_KMH * 1000) / 3600);
}

function reconstruct(
  graph: Graph,
  cameFrom: Map<NodeId, Edge>,
  origin: NodeId,
  destination: NodeId,
  nodesExplored: number,
): RouteResult {
  const path: NodeId[] = [destination];
  let distanceM = 0;
  let timeS = 0;
  let current = destination;
  while (current !== origin) {
    const edge = cameFrom.get(current);
    if (!edge) break; // unreachable
    distanceM += edge.lengthM;
    timeS += edgeTravelSeconds(edge);
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
  mode: CostMode = "time",
): RouteResult | null {
  if (!graph.getNode(origin) || !graph.getNode(destination)) return null;

  const dist = new Map<NodeId, number>([[origin, 0]]);
  const cameFrom = new Map<NodeId, Edge>();
  const settled = new Set<NodeId>();
  const frontier = new PriorityQueue<NodeId>();
  frontier.push(origin, 0);

  while (!frontier.isEmpty()) {
    const current = frontier.pop()!;
    if (current === destination) {
      return reconstruct(graph, cameFrom, origin, destination, settled.size);
    }
    if (settled.has(current)) continue;
    settled.add(current);

    const base = dist.get(current)!;
    for (const edge of graph.neighbors(current)) {
      if (settled.has(edge.to)) continue;
      const tentative = base + edgeCost(edge, mode);
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
  mode: CostMode = "time",
): RouteResult | null {
  if (!graph.getNode(origin) || !graph.getNode(destination)) return null;

  const gScore = new Map<NodeId, number>([[origin, 0]]);
  const cameFrom = new Map<NodeId, Edge>();
  const settled = new Set<NodeId>();
  const frontier = new PriorityQueue<NodeId>();
  frontier.push(origin, heuristic(graph, origin, destination, mode));

  while (!frontier.isEmpty()) {
    const current = frontier.pop()!;
    if (current === destination) {
      return reconstruct(graph, cameFrom, origin, destination, settled.size);
    }
    if (settled.has(current)) continue;
    settled.add(current);

    const base = gScore.get(current)!;
    for (const edge of graph.neighbors(current)) {
      if (settled.has(edge.to)) continue;
      const tentative = base + edgeCost(edge, mode);
      if (tentative < (gScore.get(edge.to) ?? Infinity)) {
        gScore.set(edge.to, tentative);
        cameFrom.set(edge.to, edge);
        const f = tentative + heuristic(graph, edge.to, destination, mode);
        frontier.push(edge.to, f);
      }
    }
  }
  return null;
}
