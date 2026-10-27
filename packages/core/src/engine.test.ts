/**
 * Engine tests, runnable with the Node built-in test runner:
 *   node --experimental-strip-types --test src/engine.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { haversine, toECEF, fromECEF } from "./geo.ts";
import { PriorityQueue } from "./priority-queue.ts";
import { buildGhanaGraph } from "./data/ghana.ts";
import { aStar, dijkstra } from "./routing.ts";
import { buildDirections } from "./directions.ts";
import { planTrip, randomTrip } from "./trip.ts";
import { searchPlaces } from "./search.ts";
import { SpatialGrid } from "./spatial-index.ts";
import { buildConstellation, simulateFix } from "./satellite.ts";

test("haversine: Accra→Kumasi is ~200km great-circle", () => {
  const accra = { lat: 5.6037, lng: -0.187 };
  const kumasi = { lat: 6.6886, lng: -1.6244 };
  const d = haversine(accra, kumasi) / 1000;
  assert.ok(d > 195 && d < 215, `expected ~200km, got ${d.toFixed(1)}km`);
});

test("ECEF round-trips back to lat/lng", () => {
  const p = { lat: 7.9465, lng: -1.0232 };
  const back = fromECEF(toECEF(p));
  assert.ok(Math.abs(back.lat - p.lat) < 1e-6);
  assert.ok(Math.abs(back.lng - p.lng) < 1e-6);
});

test("priority queue pops in ascending priority and supports decreaseKey", () => {
  const pq = new PriorityQueue<string>();
  pq.push("a", 5);
  pq.push("b", 3);
  pq.push("c", 9);
  pq.push("b", 1); // decreaseKey
  assert.equal(pq.pop(), "b");
  assert.equal(pq.pop(), "a");
  assert.equal(pq.pop(), "c");
  assert.equal(pq.pop(), undefined);
});

test("Ghana graph is connected enough to route corner-to-corner", () => {
  const g = buildGhanaGraph();
  const r = aStar(g, "aflao", "lawra", { metric: "time" });
  assert.ok(r, "expected a route from Aflao to Lawra");
  assert.ok(r!.path[0] === "aflao" && r!.path.at(-1) === "lawra");
  assert.ok(r!.distanceM > 0 && r!.timeS > 0);
});

test("A* returns the same optimal cost as Dijkstra", () => {
  const g = buildGhanaGraph();
  const pairs: [string, string][] = [
    ["accra", "bolgatanga"],
    ["takoradi", "ho"],
    ["wa", "aflao"],
  ];
  for (const [from, to] of pairs) {
    const d = dijkstra(g, from, to, { metric: "time" })!;
    const a = aStar(g, from, to, { metric: "time" })!;
    assert.ok(Math.abs(d.timeS - a.timeS) < 1, `${from}->${to} costs differ`);
  }
});

test("travel modes: same path by distance, far slower on foot by time", () => {
  const g = buildGhanaGraph();
  // Distance is independent of mode, so the shortest-distance path matches.
  const driveD = aStar(g, "accra", "kumasi", { metric: "distance", mode: "drive" })!;
  const walkD = aStar(g, "accra", "kumasi", { metric: "distance", mode: "walk" })!;
  assert.deepEqual(driveD.path, walkD.path);
  // By time, walking is many times slower than driving.
  const driveT = aStar(g, "accra", "kumasi", { metric: "time", mode: "drive" })!;
  const walkT = aStar(g, "accra", "kumasi", { metric: "time", mode: "walk" })!;
  assert.ok(walkT.timeS > driveT.timeS * 5, "walking should be far slower");
});

test("turn-by-turn directions start at origin and end at arrival", () => {
  const g = buildGhanaGraph();
  const r = aStar(g, "accra", "kumasi", { metric: "time" })!;
  const steps = buildDirections(g, r);
  assert.ok(steps.length >= 2);
  assert.equal(steps[0]!.maneuver, "depart");
  assert.equal(steps.at(-1)!.maneuver, "arrive");
});

test("search ranks exact and prefix matches first", () => {
  const g = buildGhanaGraph();
  const results = searchPlaces(g, "kum");
  assert.ok(results.length > 0);
  assert.equal(results[0]!.id, "kumasi");
});

test("trip simulator tracks position from start to arrival", () => {
  const g = buildGhanaGraph();
  const planned = planTrip(g, "accra", "kumasi", "drive");
  assert.ok(planned, "expected a planned trip");
  const { route, sim } = planned!;

  // At t=0 we're at the origin, not arrived.
  const start = sim.stateAt(0);
  const origin = g.getNode("accra")!.location;
  assert.ok(Math.abs(start.position.lat - origin.lat) < 1e-6);
  assert.equal(start.arrived, false);
  assert.ok(start.speedKmh > 0);

  // Halfway in time we're partway along and moving.
  const mid = sim.stateAt(sim.totalTimeS / 2);
  assert.ok(mid.progress > 0 && mid.progress < 1);
  assert.ok(mid.distanceRemainingM < sim.totalDistanceM);

  // Past the end we've arrived at the destination.
  const end = sim.stateAt(sim.totalTimeS + 10);
  assert.equal(end.arrived, true);
  const dest = g.getNode("kumasi")!.location;
  assert.ok(Math.abs(end.position.lat - dest.lat) < 1e-6);
  assert.ok(Math.abs(end.position.lng - dest.lng) < 1e-6);

  // Total time matches the route's time.
  assert.ok(Math.abs(sim.totalTimeS - route.timeS) < 1);
});

test("random trip produces a usable fleet vehicle", () => {
  const g = buildGhanaGraph();
  let seed = 123;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const trip = randomTrip(g, rng);
  assert.ok(trip, "expected a random trip");
  assert.notEqual(trip!.origin, trip!.destination);
  assert.ok(trip!.sim.totalDistanceM > 0);
});

test("spatial grid nearest matches a brute-force scan", () => {
  const g = buildGhanaGraph();
  const pts = g.nodeList().map((n) => ({ id: n.id, location: n.location }));
  const grid = new SpatialGrid<{ id: string; location: { lat: number; lng: number } }>();
  grid.insertAll(pts);

  const query = { lat: 6.9, lng: -1.5 };
  const brute = pts
    .map((p) => ({ p, d: haversine(query, p.location) }))
    .sort((a, b) => a.d - b.d)[0]!.p;
  assert.equal(grid.nearest(query)!.id, brute.id);
});

test("GPS simulation recovers position to within a few metres", () => {
  const constellation = buildConstellation();
  const truth = { lat: 6.6886, lng: -1.6244 }; // Kumasi
  let seed = 7;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const { fix, errorM, visible } = simulateFix(constellation, truth, 1800, {
    clockBiasM: 50_000,
    noiseM: 5,
    rng,
  });
  assert.ok(visible.length >= 4, `need 4+ sats, saw ${visible.length}`);
  assert.ok(fix, "expected a position fix");
  assert.ok(errorM !== null && errorM < 60, `error too large: ${errorM}m`);
  // Clock bias should be recovered close to the injected 50 km.
  assert.ok(Math.abs(fix!.clockBiasM - 50_000) < 2000);
});
