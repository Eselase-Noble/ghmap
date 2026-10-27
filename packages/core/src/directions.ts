/**
 * Turn-by-turn directions, derived from a computed route.
 *
 * A {@link RouteResult} is just a list of places. To narrate it the way a
 * satnav does ("turn right onto N6, continue for 120 km"), we walk the path,
 * group consecutive segments that stay on the same named road, and classify the
 * turn at each junction from the change in compass bearing.
 */
import { bearing } from "./geo.ts";
import type { Edge, Graph, TravelMode } from "./graph.ts";
import { edgeTravelSeconds } from "./graph.ts";
import type { RouteResult } from "./routing.ts";

export type Maneuver =
  | "depart"
  | "continue"
  | "slight-left"
  | "left"
  | "sharp-left"
  | "slight-right"
  | "right"
  | "sharp-right"
  | "uturn"
  | "arrive";

export interface DirectionStep {
  maneuver: Maneuver;
  /** Human-readable instruction, e.g. "Turn right onto N6 toward Kumasi". */
  instruction: string;
  /** Road name for this leg, if known. */
  roadName?: string;
  /** Length of this step, in metres. */
  distanceM: number;
  /** Travel time for this step, in seconds. */
  timeS: number;
}

/** Classify a turn from the signed change in bearing (degrees, [-180, 180]). */
function classifyTurn(delta: number): Maneuver {
  const a = ((delta + 180) % 360) - 180; // normalise
  const abs = Math.abs(a);
  if (abs < 20) return "continue";
  if (abs > 160) return "uturn";
  if (abs < 45) return a < 0 ? "slight-left" : "slight-right";
  if (abs < 120) return a < 0 ? "left" : "right";
  return a < 0 ? "sharp-left" : "sharp-right";
}

const TURN_VERB: Record<Maneuver, string> = {
  depart: "Head out",
  continue: "Continue",
  "slight-left": "Bear left",
  left: "Turn left",
  "sharp-left": "Make a sharp left",
  "slight-right": "Bear right",
  right: "Turn right",
  "sharp-right": "Make a sharp right",
  uturn: "Make a U-turn",
  arrive: "Arrive",
};

/** Build a list of turn-by-turn steps for a route. */
export function buildDirections(
  graph: Graph,
  route: RouteResult,
  mode: TravelMode = "drive",
): DirectionStep[] {
  const { path } = route;
  if (path.length < 2) return [];

  // Collect the edges actually travelled, with the bearing of each segment.
  interface Seg {
    edge: Edge;
    bearingDeg: number;
    fromName: string;
    toName: string;
  }
  const segs: Seg[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const from = graph.getNode(path[i]!);
    const to = graph.getNode(path[i + 1]!);
    const edge = graph.edgeBetween(path[i]!, path[i + 1]!);
    if (!from || !to || !edge) continue;
    segs.push({
      edge,
      bearingDeg: bearing(from.location, to.location),
      fromName: from.name,
      toName: to.name,
    });
  }
  if (segs.length === 0) return [];

  const steps: DirectionStep[] = [];
  let i = 0;
  while (i < segs.length) {
    const start = segs[i]!;
    const roadName = start.edge.name;
    // Merge consecutive segments that stay on the same named road.
    let distanceM = 0;
    let timeS = 0;
    let j = i;
    while (
      j < segs.length &&
      (segs[j]!.edge.name ?? null) === (roadName ?? null)
    ) {
      distanceM += segs[j]!.edge.lengthM;
      timeS += edgeTravelSeconds(segs[j]!.edge, mode);
      j++;
    }
    const toName = segs[j - 1]!.toName;

    const maneuver: Maneuver =
      i === 0
        ? "depart"
        : classifyTurn(start.bearingDeg - segs[i - 1]!.bearingDeg);

    const road = roadName ? ` onto ${roadName}` : "";
    const instruction =
      i === 0
        ? `Head out from ${start.fromName}${road} toward ${toName}`
        : `${TURN_VERB[maneuver]}${road} toward ${toName}`;

    steps.push({
      maneuver,
      instruction,
      ...(roadName !== undefined ? { roadName } : {}),
      distanceM,
      timeS,
    });
    i = j;
  }

  // Final arrival step.
  const last = segs[segs.length - 1]!;
  steps.push({
    maneuver: "arrive",
    instruction: `Arrive at ${last.toName}`,
    distanceM: 0,
    timeS: 0,
  });
  return steps;
}
