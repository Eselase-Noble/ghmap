/**
 * The GhMap road network as a directed weighted graph.
 *
 * Nodes are places (cities, towns, junctions). Edges are road segments with a
 * length in metres and a road class that implies a travel speed. We store a
 * directed adjacency list so one-way roads are expressible; `addRoad` adds both
 * directions by default.
 */
import type { LatLng } from "./geo.ts";
import { haversine } from "./geo.ts";

export type NodeId = string;

/** Road classes, roughly following OpenStreetMap's `highway` tag. */
export type RoadClass =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "residential"
  | "track";

/** Default free-flow speed (km/h) assumed for each road class in Ghana. */
export const ROAD_SPEED_KMH: Record<RoadClass, number> = {
  motorway: 110,
  trunk: 90,
  primary: 80,
  secondary: 60,
  tertiary: 45,
  residential: 30,
  track: 20,
};

/** How a traveller moves, which changes the effective speed on each road. */
export type TravelMode = "drive" | "walk" | "cycle";

/** Effective speed (km/h) for a mode on a given road class. */
export function modeSpeedKmh(mode: TravelMode, roadClass: RoadClass): number {
  switch (mode) {
    case "walk":
      return 5;
    case "cycle":
      return 15;
    case "drive":
    default:
      return ROAD_SPEED_KMH[roadClass];
  }
}

export interface PlaceNode {
  readonly id: NodeId;
  readonly name: string;
  readonly location: LatLng;
  /** Free-form category: "city", "town", "junction", "landmark", … */
  readonly kind: string;
  /** Optional region (e.g. "Greater Accra"). */
  readonly region?: string;
}

export interface Edge {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly lengthM: number;
  readonly roadClass: RoadClass;
  /** Optional human name of the road, e.g. "N1" or "Accra–Kumasi Road". */
  readonly name?: string;
}

/** Travel time across an edge in seconds, for the given mode (default drive). */
export function edgeTravelSeconds(edge: Edge, mode: TravelMode = "drive"): number {
  const speedMs = (modeSpeedKmh(mode, edge.roadClass) * 1000) / 3600;
  return edge.lengthM / speedMs;
}

export class Graph {
  private readonly nodes = new Map<NodeId, PlaceNode>();
  private readonly adjacency = new Map<NodeId, Edge[]>();
  private edgeCount = 0;

  get nodeCount(): number {
    return this.nodes.size;
  }

  get roadCount(): number {
    return this.edgeCount;
  }

  addNode(node: PlaceNode): void {
    this.nodes.set(node.id, node);
    if (!this.adjacency.has(node.id)) this.adjacency.set(node.id, []);
  }

  getNode(id: NodeId): PlaceNode | undefined {
    return this.nodes.get(id);
  }

  nodeList(): readonly PlaceNode[] {
    return [...this.nodes.values()];
  }

  neighbors(id: NodeId): readonly Edge[] {
    return this.adjacency.get(id) ?? [];
  }

  /** The edge actually travelled from `from` to `to` (shortest if several). */
  edgeBetween(from: NodeId, to: NodeId): Edge | undefined {
    let best: Edge | undefined;
    for (const edge of this.neighbors(from)) {
      if (edge.to === to && (!best || edge.lengthM < best.lengthM)) best = edge;
    }
    return best;
  }

  /** Add a single directed edge. Length defaults to the great-circle distance. */
  addEdge(
    from: NodeId,
    to: NodeId,
    roadClass: RoadClass,
    opts: { lengthM?: number; name?: string } = {},
  ): void {
    const a = this.nodes.get(from);
    const b = this.nodes.get(to);
    if (!a || !b) {
      throw new Error(`Cannot add edge: unknown node ${!a ? from : to}`);
    }
    const lengthM = opts.lengthM ?? haversine(a.location, b.location);
    const edge: Edge = {
      from,
      to,
      lengthM,
      roadClass,
      ...(opts.name !== undefined ? { name: opts.name } : {}),
    };
    this.adjacency.get(from)!.push(edge);
    this.edgeCount++;
  }

  /**
   * Add a two-way road (an edge in each direction). This is the common case for
   * Ghana's highway network; use {@link addEdge} directly for one-way streets.
   */
  addRoad(
    a: NodeId,
    b: NodeId,
    roadClass: RoadClass,
    opts: { lengthM?: number; name?: string } = {},
  ): void {
    this.addEdge(a, b, roadClass, opts);
    this.addEdge(b, a, roadClass, opts);
  }
}
