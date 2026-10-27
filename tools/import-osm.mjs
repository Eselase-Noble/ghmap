#!/usr/bin/env node
/**
 * GhMap OpenStreetMap importer.
 *
 * Fetches Ghana's real road network from the Overpass API, one road class at a
 * time (small queries are far more likely to succeed on a busy public server),
 * rebuilds topology by matching shared coordinates, contracts the long chains
 * of shape points down to junction-to-junction edges that keep their geometry,
 * snaps place names onto the network, and writes a single compact JSON dataset
 * the apps load for real-road routing.
 *
 * Usage:
 *   node tools/import-osm.mjs [class1,class2,...]
 * Default classes: motorway,trunk,primary,secondary,tertiary,unclassified,residential
 *
 * Output: apps/web/public/ghana-roads.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../apps/web/public/ghana-roads.json");

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/** Overpass highway classes → GhMap RoadClass. */
const CLASS_MAP = {
  motorway: "motorway",
  trunk: "trunk",
  primary: "primary",
  secondary: "secondary",
  tertiary: "tertiary",
  unclassified: "tertiary",
  residential: "residential",
  living_street: "residential",
  service: "residential",
  road: "tertiary",
  track: "track",
};
const ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "track"];
const classCode = (rc) => ROAD_CLASSES.indexOf(rc);

const DEFAULT_CLASSES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371008.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function overpass(query, label) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ep = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "GhMap/0.1 (github.com/Eselase-Noble/ghmap)",
        },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(240_000),
      });
      if (res.ok) {
        const json = await res.json();
        return json;
      }
      lastErr = new Error(`HTTP ${res.status} from ${ep}`);
    } catch (e) {
      lastErr = e;
    }
    const wait = Math.min(2000 * 2 ** attempt, 30_000);
    console.log(`  [${label}] attempt ${attempt + 1} failed (${lastErr.message}); retrying in ${wait / 1000}s via next mirror`);
    await sleep(wait);
  }
  throw lastErr;
}

function wayQuery(hwClass) {
  return `[out:json][timeout:240];
area["ISO3166-1"="GH"][admin_level=2]->.gh;
way(area.gh)["highway"="${hwClass}"];
out geom tags;`;
}

const placesQuery = `[out:json][timeout:180];
area["ISO3166-1"="GH"][admin_level=2]->.gh;
(node(area.gh)["place"~"^(city|town|village|suburb)$"];);
out tags center;`;

// ---------------------------------------------------------------------------
// Fine graph assembled from way geometry, keyed by shared coordinates.
// ---------------------------------------------------------------------------
const keyToId = new Map();
const nodeLat = [];
const nodeLng = [];
function nodeId(lat, lng) {
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  let id = keyToId.get(key);
  if (id === undefined) {
    id = nodeLat.length;
    nodeLat.push(lat);
    nodeLng.push(lng);
    keyToId.set(key, id);
  }
  return id;
}

/** edges[]: { u, v, len, cls, name, oneway, geom:[nodeId...] } (geom u..v) */
const edges = [];
const adj = new Map(); // nodeId -> Set(edgeIndex)
function addIncident(n, ei) {
  let s = adj.get(n);
  if (!s) adj.set(n, (s = new Set()));
  s.add(ei);
}

function addWay(way) {
  const g = way.geometry;
  if (!g || g.length < 2) return;
  const tags = way.tags ?? {};
  const rc = CLASS_MAP[tags.highway] ?? "tertiary";
  const name = tags.ref || tags.name || "";
  const oneway =
    tags.oneway === "yes" ||
    tags.oneway === "true" ||
    tags.oneway === "1" ||
    tags.junction === "roundabout" ||
    tags.highway === "motorway";
  let prev = nodeId(g[0].lat, g[0].lon);
  for (let i = 1; i < g.length; i++) {
    const cur = nodeId(g[i].lat, g[i].lon);
    if (cur === prev) continue;
    const len = haversine(nodeLat[prev], nodeLng[prev], nodeLat[cur], nodeLng[cur]);
    const ei = edges.length;
    edges.push({ u: prev, v: cur, len, cls: rc, name, oneway, geom: [prev, cur], dead: false });
    addIncident(prev, ei);
    addIncident(cur, ei);
    prev = cur;
  }
}

// ---------------------------------------------------------------------------
// Contract degree-2 chains, preserving geometry and direction.
// ---------------------------------------------------------------------------
function other(edge, n) {
  return edge.u === n ? edge.v : edge.u;
}
function orientGeomTo(edge, endNode) {
  // return geom list ending at endNode
  return edge.v === endNode ? edge.geom : edge.geom.slice().reverse();
}

function contract() {
  let removed = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [n, set] of adj) {
      if (set.size !== 2) continue;
      const [e1i, e2i] = [...set];
      const e1 = edges[e1i];
      const e2 = edges[e2i];
      if (e1.dead || e2.dead) continue;
      const A = other(e1, n);
      const B = other(e2, n);
      if (A === B || A === n || B === n) continue; // avoid loops
      if (e1.cls !== e2.cls) continue;
      // Direction compatibility.
      let oneway;
      if (!e1.oneway && !e2.oneway) {
        oneway = false;
      } else if (e1.oneway && e2.oneway) {
        // need forward A->n (e1.v===n) and forward n->B (e2.u===n)
        if (e1.v === n && e2.u === n) oneway = true;
        else if (e1.u === n && e2.v === n) {
          // forward B->n->A: swap A/B by reversing meaning below
          oneway = true;
        } else continue;
      } else {
        continue; // mixed oneway/two-way: don't contract
      }

      // Build merged geometry A..n..B.
      let gA = orientGeomTo(e1, n); // ...A..n
      let gB = orientGeomTo(e2, n).slice().reverse(); // n..B
      // gA ends at n, gB starts at n
      const u = gA[0];
      const v = gB[gB.length - 1];
      const geom = gA.concat(gB.slice(1));
      // Determine oneway orientation u->v for merged edge.
      let mergedOneway = oneway;
      if (oneway) {
        // forward must go u->v. If e1 forward was B->n->A we reversed; ensure u->v matches.
        // After building geom from A..n..B with gA oriented to n:
        // if e1.v===n (forward ...->n) then forward is toward n i.e. u->n, consistent u->v.
        // if e1.u===n then forward was n->A; our geom u=A so forward would be v->u; flip geom.
        if (e1.u === n) {
          geom.reverse();
        }
      }
      const gu = geom[0];
      const gv = geom[geom.length - 1];

      const ni = edges.length;
      edges.push({ u: gu, v: gv, len: e1.len + e2.len, cls: e1.cls, name: e1.name || e2.name, oneway: mergedOneway, geom, dead: false });
      e1.dead = true;
      e2.dead = true;
      // Update adjacency: remove n; rewire A and B.
      adj.delete(n);
      for (const endpoint of [gu, gv]) {
        const s = adj.get(endpoint);
        if (!s) continue;
        s.delete(e1i);
        s.delete(e2i);
        s.add(ni);
      }
      removed++;
      changed = true;
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const classes = (process.argv[2]?.split(",") ?? DEFAULT_CLASSES).map((s) => s.trim());
  console.log(`GhMap OSM import — classes: ${classes.join(", ")}`);

  const fetched = [];
  let wayCount = 0;
  for (const hw of classes) {
    try {
      console.log(`Fetching ${hw}…`);
      const json = await overpass(wayQuery(hw), hw);
      const ways = json.elements.filter((e) => e.type === "way");
      for (const w of ways) addWay(w);
      wayCount += ways.length;
      fetched.push(hw);
      console.log(`  ${hw}: ${ways.length} ways (running totals: ${nodeLat.length} nodes, ${edges.length} fine edges)`);
    } catch (e) {
      console.log(`  ${hw}: FAILED after retries (${e.message}); skipping`);
    }
  }
  if (fetched.length === 0) throw new Error("No road data fetched from any endpoint.");

  console.log(`Contracting ${edges.length} fine edges across ${nodeLat.length} nodes…`);
  const removed = contract();
  const live = edges.filter((e) => !e.dead);
  console.log(`  contracted ${removed} nodes; ${live.length} edges remain`);

  // Routing nodes are the junction endpoints only; edge shape points stay
  // inline on each edge (for drawing) rather than becoming graph nodes.
  const junctions = new Set();
  for (const e of live) {
    junctions.add(e.u);
    junctions.add(e.v);
  }

  // Places.
  let places = [];
  try {
    console.log("Fetching place names…");
    const pj = await overpass(placesQuery, "places");
    places = pj.elements
      .map((el) => {
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null || !el.tags?.name) return null;
        return { name: el.tags.name, lat, lng: lon, kind: el.tags.place };
      })
      .filter(Boolean);
    console.log(`  ${places.length} places`);
  } catch (e) {
    console.log(`  places FAILED (${e.message}); continuing without`);
  }

  // Renumber junction nodes to a compact index space.
  const remap = new Map();
  const outLat = [];
  const outLng = [];
  for (const old of junctions) {
    remap.set(old, outLat.length);
    outLat.push(Number(nodeLat[old].toFixed(5)));
    outLng.push(Number(nodeLng[old].toFixed(5)));
  }

  // Grid index over junctions so snapping thousands of places stays fast.
  const CELL = 0.1; // ~11 km
  const grid = new Map();
  const cellKey = (lat, lng) => `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
  for (let i = 0; i < outLat.length; i++) {
    const k = cellKey(outLat[i], outLng[i]);
    let b = grid.get(k);
    if (!b) grid.set(k, (b = []));
    b.push(i);
  }
  function nearestNode(lat, lng) {
    let best = -1;
    let bestD = Infinity;
    for (let ring = 0; ring <= 40; ring++) {
      const r0 = Math.floor(lat / CELL);
      const c0 = Math.floor(lng / CELL);
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const b = grid.get(`${r0 + dr}:${c0 + dc}`);
          if (!b) continue;
          for (const i of b) {
            const d = haversine(lat, lng, outLat[i], outLng[i]);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      if (best >= 0 && ring >= 1) break; // found + one extra ring for safety
    }
    return best;
  }
  const outPlaces = places
    .map((p) => {
      const node = nearestNode(p.lat, p.lng);
      return node >= 0 ? { name: p.name, kind: p.kind, node } : null;
    })
    .filter(Boolean);

  // Edge names dictionary.
  const nameDict = [];
  const nameIndex = new Map();
  const nameIdx = (s) => {
    if (!s) return -1;
    let i = nameIndex.get(s);
    if (i === undefined) {
      i = nameDict.length;
      nameDict.push(s);
      nameIndex.set(s, i);
    }
    return i;
  };
  // Encode edges: [u, v, lenMeters, classCode, oneway, nameIdx, geomFlat[lng,lat,...]]
  const outEdges = live.map((e) => {
    const geomFlat = [];
    for (const g of e.geom) {
      geomFlat.push(Number(nodeLng[g].toFixed(5)), Number(nodeLat[g].toFixed(5)));
    }
    return [
      remap.get(e.u),
      remap.get(e.v),
      Math.round(e.len),
      classCode(e.cls),
      e.oneway ? 1 : 0,
      nameIdx(e.name),
      geomFlat,
    ];
  });

  const data = {
    meta: {
      generated: new Date().toISOString(),
      source: "OpenStreetMap via Overpass API",
      classesFetched: fetched,
      wayCount,
      nodeCount: outLat.length,
      edgeCount: outEdges.length,
      roadClasses: ROAD_CLASSES,
    },
    lat: outLat,
    lng: outLng,
    names: nameDict,
    edges: outEdges,
    places: outPlaces,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  const str = JSON.stringify(data);
  writeFileSync(OUT, str);
  console.log(
    `\nWrote ${OUT}\n  ${(str.length / 1048576).toFixed(1)} MB | ${data.meta.nodeCount} nodes | ${data.meta.edgeCount} edges | ${outPlaces.length} places`,
  );
}

main().catch((e) => {
  console.error("Import failed:", e.message);
  process.exit(1);
});
