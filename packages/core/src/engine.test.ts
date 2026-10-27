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
  const r = aStar(g, "aflao", "lawra", "time");
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
    const d = dijkstra(g, from, to, "time")!;
    const a = aStar(g, from, to, "time")!;
    assert.ok(Math.abs(d.timeS - a.timeS) < 1, `${from}->${to} costs differ`);
  }
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
