/**
 * A runnable tour of the GhMap engine. Run with:
 *   npm run demo        (from the repo root)
 *   node --experimental-strip-types packages/core/src/demo.ts
 *
 * It exercises every subsystem end-to-end: graph, routing (Dijkstra vs A*),
 * spatial nearest-neighbour search, and the GPS satellite positioning sim.
 */
import { buildGhanaGraph } from "./data/ghana.ts";
import { aStar, dijkstra } from "./routing.ts";
import { SpatialGrid } from "./spatial-index.ts";
import {
  buildConstellation,
  simulateFix,
} from "./satellite.ts";

function km(m: number): string {
  return `${(m / 1000).toFixed(1)} km`;
}
function mins(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const graph = buildGhanaGraph();
console.log("=== GhMap engine demo ===\n");
console.log(`Network: ${graph.nodeCount} places, ${graph.roadCount} directed road segments\n`);

// --- Routing: Accra -> Bolgatanga, comparing algorithms + cost modes ---
const origin = "accra";
const dest = "bolgatanga";
const nameOf = (id: string) => graph.getNode(id)?.name ?? id;

console.log(`--- Route: ${nameOf(origin)} → ${nameOf(dest)} ---`);
for (const mode of ["time", "distance"] as const) {
  const r = aStar(graph, origin, dest, mode);
  if (!r) {
    console.log(`  (${mode}) no route found`);
    continue;
  }
  console.log(
    `  A* by ${mode}: ${km(r.distanceM)}, ${mins(r.timeS)} via ` +
      r.path.map(nameOf).join(" → "),
  );
}

// Confirm A* and Dijkstra agree on cost but A* explores fewer nodes.
const d = dijkstra(graph, origin, dest, "time")!;
const a = aStar(graph, origin, dest, "time")!;
console.log(
  `\n  Optimality check: Dijkstra ${mins(d.timeS)} (explored ${d.nodesExplored}) ` +
    `vs A* ${mins(a.timeS)} (explored ${a.nodesExplored})`,
);

// --- Spatial index: nearest city to an arbitrary coordinate ---
console.log("\n--- Nearest-place search ---");
const grid = new SpatialGrid<{ id: string; location: { lat: number; lng: number } }>();
grid.insertAll(
  graph.nodeList().map((n) => ({ id: n.id, location: n.location })),
);
const somewhere = { lat: 6.9, lng: -1.5 }; // between Kumasi and Mampong
const near = grid.kNearest(somewhere, 3);
console.log(
  `  Near (${somewhere.lat}, ${somewhere.lng}): ` +
    near.map((n) => nameOf(n.id)).join(", "),
);

// --- GPS satellite simulation ---
console.log("\n--- Simulated GPS fix ---");
const constellation = buildConstellation();
console.log(`  Constellation: ${constellation.length} satellites in 6 orbital planes`);

const truth = graph.getNode("kumasi")!.location;
// Deterministic pseudo-random noise so the demo is reproducible.
let seed = 42;
const rng = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const { fix, visible, errorM } = simulateFix(constellation, truth, 1200, {
  clockBiasM: 75_000, // ~0.25 ms receiver clock error
  noiseM: 8, // metre-level ranging noise
  rng,
});

console.log(`  Receiver truth: Kumasi (${truth.lat}, ${truth.lng})`);
console.log(`  Satellites visible: ${visible.length}`);
if (fix) {
  console.log(
    `  Solved position: (${fix.position.lat.toFixed(5)}, ${fix.position.lng.toFixed(5)})`,
  );
  console.log(
    `  Position error: ${errorM!.toFixed(1)} m | GDOP ${fix.gdop.toFixed(2)} | ` +
      `clock bias est ${(fix.clockBiasM / 1000).toFixed(1)} km | ${fix.iterations} iters`,
  );
} else {
  console.log("  Fix failed (too few satellites).");
}

console.log("\n=== demo complete ===");
