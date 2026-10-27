/**
 * Alternative routes.
 *
 * Google shows you two or three ways to get somewhere. We produce them with the
 * classic penalty (or "plateau avoidance") method: find the best route, then
 * make the edges it used more expensive and search again, so the next search is
 * pushed onto genuinely different roads. We keep a candidate only if it's
 * sufficiently distinct from the ones already found.
 */
import type { Edge, Graph, NodeId } from "./graph.ts";
import { aStar, type RouteOptions, type RouteResult } from "./routing.ts";

/** Undirected key for an edge, so A↔B counts as the same road either way. */
function edgeKey(a: NodeId, b: NodeId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** The set of edge keys a route traverses. */
function routeEdgeKeys(route: RouteResult): Set<string> {
  const keys = new Set<string>();
  for (let i = 0; i < route.path.length - 1; i++) {
    keys.add(edgeKey(route.path[i]!, route.path[i + 1]!));
  }
  return keys;
}

/** Fraction of `candidate`'s edges that are shared with `existing`. */
function overlap(candidate: Set<string>, existing: Set<string>): number {
  if (candidate.size === 0) return 1;
  let shared = 0;
  for (const k of candidate) if (existing.has(k)) shared++;
  return shared / candidate.size;
}

export interface AlternativesOptions extends RouteOptions {
  /** How many routes to return at most (including the best). Default 3. */
  count?: number;
  /** Max fraction of shared edges for a route to count as distinct. Default 0.7. */
  maxOverlap?: number;
}

/**
 * Return up to `count` routes, best first, each reasonably distinct from the
 * others. The first is the true optimum; the rest are penalised alternatives.
 */
export function alternativeRoutes(
  graph: Graph,
  origin: NodeId,
  destination: NodeId,
  options: AlternativesOptions = {},
): RouteResult[] {
  const count = options.count ?? 3;
  const maxOverlap = options.maxOverlap ?? 0.7;

  const best = aStar(graph, origin, destination, options);
  if (!best) return [];

  const routes: RouteResult[] = [best];
  const allKeys = routeEdgeKeys(best);

  // Grow the penalty each round so we keep escaping the already-found roads.
  for (let round = 0; routes.length < count && round < count * 3; round++) {
    const penaltyScale = 1.6 + round * 0.8;
    const penalized = new Set(allKeys);
    const candidate = aStar(graph, origin, destination, {
      ...options,
      edgePenalty: (edge: Edge) =>
        penalized.has(edgeKey(edge.from, edge.to))
          ? (options.metric === "distance" ? edge.lengthM : edge.lengthM / 10) * penaltyScale
          : 0,
    });
    if (!candidate) break;

    const candKeys = routeEdgeKeys(candidate);
    const tooSimilar = routes.some(
      (r) => overlap(candKeys, routeEdgeKeys(r)) > maxOverlap,
    );
    if (tooSimilar) continue;

    routes.push(candidate);
    for (const k of candKeys) allKeys.add(k);
  }

  return routes;
}
