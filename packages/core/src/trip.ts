/**
 * Real-time trip simulation.
 *
 * Routing gives us a static path. To *track* movement we need to know where a
 * vehicle is at any moment in time, how fast it's going, which way it's facing,
 * and how far is left. {@link TripSimulator} precomputes the route's segments
 * (length, speed, duration) once, then answers {@link TripSimulator.stateAt} in
 * O(log n) for any elapsed time. This backs both turn-by-turn navigation and
 * the live fleet view.
 */
import type { LatLng } from "./geo.ts";
import { bearing } from "./geo.ts";
import type { Graph, NodeId, TravelMode } from "./graph.ts";
import { modeSpeedKmh } from "./graph.ts";
import { aStar, type RouteResult } from "./routing.ts";

export interface TripState {
  position: LatLng;
  /** Heading in degrees (0 = north, 90 = east). */
  bearingDeg: number;
  distanceCoveredM: number;
  distanceRemainingM: number;
  timeElapsedS: number;
  timeRemainingS: number;
  /** Current speed in km/h (the road class speed of the active segment). */
  speedKmh: number;
  /** Index of the current segment (0-based) along the path. */
  segmentIndex: number;
  /** Overall progress, 0 to 1. */
  progress: number;
  arrived: boolean;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class TripSimulator {
  readonly totalDistanceM: number;
  readonly totalTimeS: number;

  private readonly pts: LatLng[];
  private readonly segLenM: number[] = [];
  private readonly segSpeedKmh: number[] = [];
  private readonly segDurS: number[] = [];
  private readonly cumDistM: number[] = [0];
  private readonly cumTimeS: number[] = [0];

  constructor(graph: Graph, route: RouteResult, mode: TravelMode = "drive") {
    this.pts = route.path
      .map((id) => graph.getNode(id)?.location)
      .filter((l): l is LatLng => !!l);

    for (let i = 0; i < route.path.length - 1; i++) {
      const edge = graph.edgeBetween(route.path[i]!, route.path[i + 1]!);
      if (!edge) continue;
      const speed = modeSpeedKmh(mode, edge.roadClass);
      const dur = edge.lengthM / ((speed * 1000) / 3600);
      this.segLenM.push(edge.lengthM);
      this.segSpeedKmh.push(speed);
      this.segDurS.push(dur);
      this.cumDistM.push(this.cumDistM[this.cumDistM.length - 1]! + edge.lengthM);
      this.cumTimeS.push(this.cumTimeS[this.cumTimeS.length - 1]! + dur);
    }
    this.totalDistanceM = this.cumDistM[this.cumDistM.length - 1]!;
    this.totalTimeS = this.cumTimeS[this.cumTimeS.length - 1]!;
  }

  /** The travel state at a given elapsed time (clamped to the trip length). */
  stateAt(elapsedS: number): TripState {
    const nSeg = this.segLenM.length;
    if (nSeg === 0) {
      const only = this.pts[0] ?? { lat: 0, lng: 0 };
      return {
        position: only,
        bearingDeg: 0,
        distanceCoveredM: 0,
        distanceRemainingM: 0,
        timeElapsedS: 0,
        timeRemainingS: 0,
        speedKmh: 0,
        segmentIndex: 0,
        progress: 1,
        arrived: true,
      };
    }

    const t = Math.max(0, Math.min(elapsedS, this.totalTimeS));
    const arrived = t >= this.totalTimeS;

    // Find the active segment: largest i with cumTime[i] <= t.
    let lo = 0;
    let hi = nSeg - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cumTimeS[mid]! <= t) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const segElapsed = t - this.cumTimeS[i]!;
    const f = this.segDurS[i]! > 0 ? segElapsed / this.segDurS[i]! : 1;

    const a = this.pts[i]!;
    const b = this.pts[i + 1]!;
    const position: LatLng = {
      lat: lerp(a.lat, b.lat, f),
      lng: lerp(a.lng, b.lng, f),
    };
    const distanceCoveredM = this.cumDistM[i]! + f * this.segLenM[i]!;

    return {
      position,
      bearingDeg: bearing(a, b),
      distanceCoveredM,
      distanceRemainingM: this.totalDistanceM - distanceCoveredM,
      timeElapsedS: t,
      timeRemainingS: this.totalTimeS - t,
      speedKmh: this.segSpeedKmh[i]!,
      segmentIndex: i,
      progress: this.totalDistanceM > 0 ? distanceCoveredM / this.totalDistanceM : 1,
      arrived,
    };
  }
}

/** Plan a trip between two places: the route plus a ready simulator. */
export function planTrip(
  graph: Graph,
  origin: NodeId,
  destination: NodeId,
  mode: TravelMode = "drive",
): { route: RouteResult; sim: TripSimulator } | null {
  const route = aStar(graph, origin, destination, { metric: "time", mode });
  if (!route) return null;
  return { route, sim: new TripSimulator(graph, route, mode) };
}

/**
 * Pick a random trip across the network, for populating a live fleet. `rng`
 * defaults to Math.random; inject one for deterministic tests.
 */
export function randomTrip(
  graph: Graph,
  rng: () => number = Math.random,
  mode: TravelMode = "drive",
): { origin: NodeId; destination: NodeId; route: RouteResult; sim: TripSimulator } | null {
  const nodes = graph.nodeList();
  if (nodes.length < 2) return null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const a = nodes[Math.floor(rng() * nodes.length)]!;
    const b = nodes[Math.floor(rng() * nodes.length)]!;
    if (a.id === b.id) continue;
    const planned = planTrip(graph, a.id, b.id, mode);
    if (planned && planned.sim.totalDistanceM > 0) {
      return { origin: a.id, destination: b.id, ...planned };
    }
  }
  return null;
}
