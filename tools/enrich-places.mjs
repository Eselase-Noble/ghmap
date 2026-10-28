#!/usr/bin/env node
/**
 * Enriches the searchable places in ghana-roads.json with:
 *  - Streets: derived from the road names already in the dataset (no network).
 *  - Landmarks / POIs: named hospitals, schools, universities, markets, fuel
 *    stations, hotels, banks, attractions, etc. fetched from OpenStreetMap.
 *
 * Streets are written first (guaranteed), then POIs are merged in if the
 * fetch succeeds. Each place is snapped to the nearest road junction so it can
 * be routed to directly.
 *
 * Usage: node tools/enrich-places.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, "../apps/web/public/ghana-roads.json");

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function haversine(aLat, aLng, bLat, bLng) {
  const R = 6371008.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function overpass(query, label) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const ep = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "GhMap/0.1 (github.com/Eselase-Noble/ghmap)" },
        body: "data=" + encodeURIComponent(query),
        signal: AbortSignal.timeout(240_000),
      });
      if (res.ok) return await res.json();
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    const wait = Math.min(2000 * 2 ** attempt, 30_000);
    console.log(`  [${label}] attempt ${attempt + 1} failed (${lastErr.message}); retry in ${wait / 1000}s`);
    await sleep(wait);
  }
  throw lastErr;
}

/** Build a grid index over an array of {lat,lng,idx} for fast nearest lookups. */
function makeGrid(points, cell = 0.05) {
  const grid = new Map();
  const key = (lat, lng) => `${Math.floor(lat / cell)}:${Math.floor(lng / cell)}`;
  for (const p of points) {
    const k = key(p.lat, p.lng);
    let b = grid.get(k);
    if (!b) grid.set(k, (b = []));
    b.push(p);
  }
  return {
    nearest(lat, lng) {
      let best = null;
      let bestD = Infinity;
      const r0 = Math.floor(lat / cell);
      const c0 = Math.floor(lng / cell);
      for (let ring = 0; ring <= 60; ring++) {
        for (let dr = -ring; dr <= ring; dr++) {
          for (let dc = -ring; dc <= ring; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
            const b = grid.get(`${r0 + dr}:${c0 + dc}`);
            if (!b) continue;
            for (const p of b) {
              const d = haversine(lat, lng, p.lat, p.lng);
              if (d < bestD) {
                bestD = d;
                best = p;
              }
            }
          }
        }
        if (best && ring >= 1) break;
      }
      return best;
    },
  };
}

const POI_QUERIES = {
  amenities: `node(area.gh)["amenity"~"^(hospital|clinic|pharmacy|school|college|university|bank|fuel|marketplace|place_of_worship|police|fire_station|restaurant|cafe|fast_food|bar|hotel|bus_station|library|townhall|courthouse|post_office|fountain|cinema|theatre)$"]["name"];`,
  shops: `node(area.gh)["shop"~"^(supermarket|mall|convenience|department_store|electronics|hardware)$"]["name"];`,
  tourismLeisure: `node(area.gh)["tourism"~"^(hotel|guest_house|attraction|museum|viewpoint|hostel|resort)$"]["name"];
    node(area.gh)["leisure"~"^(stadium|park|sports_centre|pitch)$"]["name"];
    node(area.gh)["historic"]["name"];`,
};

async function fetchPois() {
  const out = [];
  for (const [label, body] of Object.entries(POI_QUERIES)) {
    try {
      console.log(`Fetching POIs: ${label}…`);
      const json = await overpass(
        `[out:json][timeout:180];area["ISO3166-1"="GH"][admin_level=2]->.gh;(${body});out center tags;`,
        label,
      );
      for (const el of json.elements) {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        const t = el.tags ?? {};
        if (lat == null || lng == null || !t.name) continue;
        const kind = t.amenity || t.shop || t.tourism || t.leisure || (t.historic ? "historic" : "landmark");
        out.push({ name: t.name, kind, lat, lng });
      }
      console.log(`  ${label}: ${json.elements.length} elements`);
    } catch (e) {
      console.log(`  ${label}: FAILED (${e.message}); skipping`);
    }
  }
  return out;
}

function deriveStreets(data) {
  const { names, edges, lat, lng } = data;
  // Longest edge per road name → representative junction.
  const best = new Map(); // name -> { len, node }
  for (const [u, , len, , , nameIdx] of edges) {
    if (nameIdx < 0) continue;
    const name = names[nameIdx];
    if (!name) continue;
    const cur = best.get(name);
    if (!cur || len > cur.len) best.set(name, { len, node: u });
  }
  // Nearest town (existing place entries) for region labels.
  const towns = data.places
    .filter((p) => ["city", "town", "village", "suburb"].includes(p.kind))
    .map((p) => ({ lat: lat[p.node], lng: lng[p.node], name: p.name }));
  const townGrid = makeGrid(towns, 0.1);

  const streets = [];
  for (const [name, { node }] of best) {
    const near = townGrid.nearest(lat[node], lng[node]);
    streets.push({ name, kind: "street", node, ...(near ? { region: near.name } : {}) });
  }
  return streets;
}

async function main() {
  const data = JSON.parse(readFileSync(FILE, "utf8"));
  const basePlaces = data.places.filter((p) =>
    ["city", "town", "village", "suburb", "hamlet"].includes(p.kind),
  );
  console.log(`Base place=* entries: ${basePlaces.length}`);

  // 1) Streets (guaranteed, local).
  const streets = deriveStreets(data);
  console.log(`Derived ${streets.length} street names`);
  data.places = [...basePlaces, ...streets];
  writeFileSync(FILE, JSON.stringify(data));
  console.log("  wrote streets");

  // 2) POIs (best effort).
  const pois = await fetchPois();
  if (pois.length) {
    const junctions = data.lat.map((la, i) => ({ lat: la, lng: data.lng[i], idx: i }));
    const grid = makeGrid(junctions, 0.05);
    const snapped = pois
      .map((p) => {
        const n = grid.nearest(p.lat, p.lng);
        return n ? { name: p.name, kind: p.kind, node: n.idx } : null;
      })
      .filter(Boolean);
    data.places = [...basePlaces, ...streets, ...snapped];
    console.log(`Snapped ${snapped.length} POIs`);
  }

  data.meta.placeBreakdown = {
    settlements: basePlaces.length,
    streets: streets.length,
    pois: data.places.length - basePlaces.length - streets.length,
  };
  writeFileSync(FILE, JSON.stringify(data));
  const str = JSON.stringify(data);
  console.log(`\nDone. ${data.places.length} searchable places. File ${(str.length / 1048576).toFixed(1)} MB`);
}

main().catch((e) => {
  console.error("Enrich failed:", e.message);
  process.exit(1);
});
