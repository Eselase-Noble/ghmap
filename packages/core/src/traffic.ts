/**
 * A traffic model for Ghana.
 *
 * There's no live feed behind GhMap, so this *estimates* congestion from the
 * things that actually drive it here: the time of day (the morning and evening
 * rushes), whether it's a weekday, how urban the road is (Accra and Kumasi
 * choke; the open highway up north does not), and the class of road. The result
 * is a speed factor in (0, 1] that routing multiplies into travel time, plus a
 * colour-coded congestion level for the map.
 *
 * Accra's traffic is famously brutal at peak hours, so proximity to the big
 * urban centres dominates the model — which keeps it distinctly Ghanaian.
 */
import type { LatLng } from "./geo.ts";
import { haversine } from "./geo.ts";
import type { Edge, Graph, RoadClass } from "./graph.ts";

export type CongestionLevel = "free" | "light" | "moderate" | "heavy" | "standstill";

export interface UrbanCenter {
  name: string;
  location: LatLng;
  /** Relative weight of this centre's congestion (Accra is the worst). */
  weight: number;
  /** Radius in km over which its congestion fades to nothing. */
  radiusKm: number;
}

/** Ghana's main urban congestion centres. */
export const GHANA_URBAN_CENTERS: UrbanCenter[] = [
  { name: "Accra", location: { lat: 5.6037, lng: -0.187 }, weight: 1.0, radiusKm: 35 },
  { name: "Tema", location: { lat: 5.6698, lng: -0.0166 }, weight: 0.8, radiusKm: 22 },
  { name: "Kasoa", location: { lat: 5.5342, lng: -0.4167 }, weight: 0.75, radiusKm: 15 },
  { name: "Kumasi", location: { lat: 6.6886, lng: -1.6244 }, weight: 0.85, radiusKm: 25 },
  { name: "Sekondi-Takoradi", location: { lat: 4.9344, lng: -1.7133 }, weight: 0.6, radiusKm: 18 },
  { name: "Tamale", location: { lat: 9.4075, lng: -0.8533 }, weight: 0.5, radiusKm: 16 },
  { name: "Cape Coast", location: { lat: 5.1053, lng: -1.2466 }, weight: 0.45, radiusKm: 14 },
  { name: "Sunyani", location: { lat: 7.3349, lng: -2.3123 }, weight: 0.4, radiusKm: 12 },
  { name: "Koforidua", location: { lat: 6.094, lng: -0.2591 }, weight: 0.4, radiusKm: 12 },
  { name: "Ho", location: { lat: 6.6008, lng: 0.4713 }, weight: 0.35, radiusKm: 11 },
  { name: "Bolgatanga", location: { lat: 10.7856, lng: -0.8514 }, weight: 0.35, radiusKm: 11 },
  { name: "Wa", location: { lat: 10.0607, lng: -2.5099 }, weight: 0.3, radiusKm: 10 },
];

/** How sensitive each road class is to congestion (1 = most affected). */
const CLASS_SENSITIVITY: Record<RoadClass, number> = {
  motorway: 0.55,
  trunk: 0.6,
  primary: 0.75,
  secondary: 0.9,
  tertiary: 0.95,
  residential: 1.0,
  track: 0.4,
};

/**
 * Severity of the daily rush, 0 (quiet) to 1 (peak), by local hour.
 * Weekday mornings (~7-9) and evenings (~16.5-19) are worst; weekends milder.
 */
function rushSeverity(hour: number, weekend: boolean): number {
  const bell = (center: number, width: number) =>
    Math.exp(-((hour - center) ** 2) / (2 * width * width));
  const morning = bell(7.75, 1.0);
  const evening = bell(17.75, 1.25);
  let s = Math.max(morning, evening) * 0.9 + 0.12; // small daytime baseline
  if (hour < 5 || hour > 22) s *= 0.25; // night is clear
  if (weekend) s *= 0.55;
  return Math.min(1, s);
}

/** Small stable per-edge variation so roads aren't uniform. */
function edgeJitter(edge: Edge): number {
  let h = 2166136261;
  const s = `${edge.from}>${edge.to}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000; // 0..1
}

export class TrafficModel {
  private readonly graph: Graph;
  private readonly centers: UrbanCenter[];

  constructor(graph: Graph, centers: UrbanCenter[] = GHANA_URBAN_CENTERS) {
    this.graph = graph;
    this.centers = centers;
  }

  /** Urban congestion exposure of a point, 0 (rural) to ~1 (city core). */
  urbanFactor(p: LatLng): number {
    let f = 0;
    for (const c of this.centers) {
      const d = haversine(p, c.location) / 1000;
      if (d < c.radiusKm) {
        f = Math.max(f, c.weight * (1 - d / c.radiusKm));
      }
    }
    return f;
  }

  /** Speed factor in (0, 1] for an edge at a given time (default: now). */
  speedFactor(edge: Edge, date: Date): number {
    const a = this.graph.getNode(edge.from)?.location;
    const b = this.graph.getNode(edge.to)?.location;
    if (!a || !b) return 1;
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    const urban = this.urbanFactor(mid);
    if (urban <= 0) return 1; // open road, no model effect
    const severity = rushSeverity(date.getHours() + date.getMinutes() / 60, isWeekend(date));
    const sensitivity = CLASS_SENSITIVITY[edge.roadClass];
    const jitter = 0.85 + 0.3 * edgeJitter(edge); // 0.85..1.15
    const drop = Math.min(0.85, severity * urban * sensitivity * jitter);
    return Math.max(0.15, 1 - drop);
  }

  /** Congestion level for an edge at a time, for colouring the map. */
  level(edge: Edge, date: Date): CongestionLevel {
    const f = this.speedFactor(edge, date);
    if (f > 0.85) return "free";
    if (f > 0.65) return "light";
    if (f > 0.45) return "moderate";
    if (f > 0.28) return "heavy";
    return "standstill";
  }
}

function isWeekend(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

/** Map colours for congestion levels (Google-style green→red). */
export const CONGESTION_COLOR: Record<CongestionLevel, string> = {
  free: "#2bb673",
  light: "#9acd32",
  moderate: "#f4b400",
  heavy: "#e8710a",
  standstill: "#c5221f",
};
