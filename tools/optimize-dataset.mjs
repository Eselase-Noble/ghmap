#!/usr/bin/env node
/**
 * Shrinks the raw OSM dataset to a size a browser can actually load, without
 * losing routability.
 *
 *  - Through roads (motorway…tertiary) keep their shape, simplified with
 *    Douglas–Peucker so long gentle curves use far fewer points.
 *  - Residential/minor roads drop their inline geometry entirely (the routing
 *    still works junction-to-junction, and the base map already draws their
 *    real shape), which removes the overwhelming majority of the points.
 *
 * Usage: node tools/optimize-dataset.mjs [inFile] [outFile]
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN = resolve(__dirname, process.argv[2] ?? "../apps/web/public/ghana-roads.json");
const OUT = resolve(__dirname, process.argv[3] ?? "../apps/web/public/ghana-roads.json");

// Perpendicular distance (in degrees) of p from the segment a→b.
function perpDist(p, a, b) {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas–Peucker on an array of [lng,lat] points. */
function simplify(points, tol) {
  if (points.length <= 2) return points;
  let maxD = 0;
  let idx = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > tol) {
    const left = simplify(points.slice(0, idx + 1), tol);
    const right = simplify(points.slice(idx), tol);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

const round5 = (n) => Number(n.toFixed(5));

function main() {
  const data = JSON.parse(readFileSync(IN, "utf8"));
  const classes = data.meta.roadClasses;
  const residentialCode = classes.indexOf("residential");
  const trackCode = classes.indexOf("track");

  // Tolerance ~0.00025° ≈ 25 m for through roads.
  const TOL = 0.00025;
  let before = 0;
  let after = 0;

  for (const e of data.edges) {
    const classCode = e[3];
    const geomFlat = e[6];
    before += geomFlat.length / 2;

    // Minor roads: drop inline geometry (routing uses the junction endpoints).
    if (classCode === residentialCode || classCode === trackCode) {
      e[6] = [];
      continue;
    }
    // Rebuild [lng,lat] pairs, simplify, flatten.
    const pts = [];
    for (let k = 0; k + 1 < geomFlat.length; k += 2) pts.push([geomFlat[k], geomFlat[k + 1]]);
    const simplified = simplify(pts, TOL);
    const flat = [];
    for (const [lng, lat] of simplified) flat.push(round5(lng), round5(lat));
    e[6] = flat;
    after += simplified.length;
  }

  data.meta.optimized = { simplifiedTolDeg: TOL, minorGeometryDropped: true };
  const str = JSON.stringify(data);
  writeFileSync(OUT, str);

  const inMB = (statSync(IN).size / 1048576).toFixed(1);
  console.log(
    `Optimized: through-road shape points ${before.toLocaleString()} → ${after.toLocaleString()}\n` +
      `  ${inMB} MB in → ${(str.length / 1048576).toFixed(1)} MB out\n` +
      `  ${data.edges.length.toLocaleString()} edges, ${data.lat.length.toLocaleString()} junctions kept`,
  );
}

main();
