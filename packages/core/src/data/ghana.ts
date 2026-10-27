/**
 * Hand-built seed dataset for Ghana: major cities/towns and the primary road
 * network connecting them. Coordinates are real (WGS-84). Road lengths default
 * to the great-circle distance; where a well-known road distance exists we pass
 * it explicitly so travel times are realistic.
 *
 * This is the "core" layer of the hybrid data strategy. A later importer will
 * merge detailed OpenStreetMap geometry on top of these anchors.
 */
import { Graph } from "../graph.ts";
import type { PlaceNode, RoadClass } from "../graph.ts";

interface SeedCity {
  id: string;
  name: string;
  lat: number;
  lng: number;
  region: string;
  kind?: string;
}

/** Regional capitals and other significant towns across all 16 regions. */
export const GHANA_CITIES: SeedCity[] = [
  // Greater Accra
  { id: "accra", name: "Accra", lat: 5.6037, lng: -0.187, region: "Greater Accra", kind: "capital" },
  { id: "tema", name: "Tema", lat: 5.6698, lng: -0.0166, region: "Greater Accra", kind: "city" },
  { id: "madina", name: "Madina", lat: 5.6836, lng: -0.1664, region: "Greater Accra", kind: "town" },
  { id: "kasoa", name: "Kasoa", lat: 5.5342, lng: -0.4167, region: "Central", kind: "town" },
  // Ashanti
  { id: "kumasi", name: "Kumasi", lat: 6.6886, lng: -1.6244, region: "Ashanti", kind: "city" },
  { id: "obuasi", name: "Obuasi", lat: 6.2027, lng: -1.6663, region: "Ashanti", kind: "town" },
  { id: "ejisu", name: "Ejisu", lat: 6.7365, lng: -1.4719, region: "Ashanti", kind: "town" },
  { id: "mampong", name: "Mampong", lat: 7.0637, lng: -1.4001, region: "Ashanti", kind: "town" },
  // Central
  { id: "cape-coast", name: "Cape Coast", lat: 5.1053, lng: -1.2466, region: "Central", kind: "city" },
  { id: "winneba", name: "Winneba", lat: 5.3511, lng: -0.6232, region: "Central", kind: "town" },
  { id: "elmina", name: "Elmina", lat: 5.0845, lng: -1.3509, region: "Central", kind: "town" },
  // Western
  { id: "takoradi", name: "Sekondi-Takoradi", lat: 4.9344, lng: -1.7133, region: "Western", kind: "city" },
  { id: "tarkwa", name: "Tarkwa", lat: 5.3005, lng: -1.9959, region: "Western", kind: "town" },
  { id: "axim", name: "Axim", lat: 4.8699, lng: -2.2405, region: "Western", kind: "town" },
  // Western North
  { id: "sefwi-wiawso", name: "Sefwi Wiawso", lat: 6.2096, lng: -2.4859, region: "Western North", kind: "town" },
  // Eastern
  { id: "koforidua", name: "Koforidua", lat: 6.094, lng: -0.2591, region: "Eastern", kind: "city" },
  { id: "nsawam", name: "Nsawam", lat: 5.8089, lng: -0.3515, region: "Eastern", kind: "town" },
  { id: "nkawkaw", name: "Nkawkaw", lat: 6.5486, lng: -0.7667, region: "Eastern", kind: "town" },
  { id: "akosombo", name: "Akosombo", lat: 6.2667, lng: 0.05, region: "Eastern", kind: "town" },
  // Volta
  { id: "ho", name: "Ho", lat: 6.6008, lng: 0.4713, region: "Volta", kind: "city" },
  { id: "hohoe", name: "Hohoe", lat: 7.1515, lng: 0.4733, region: "Volta", kind: "town" },
  { id: "keta", name: "Keta", lat: 5.9179, lng: 0.9887, region: "Volta", kind: "town" },
  { id: "aflao", name: "Aflao", lat: 6.1189, lng: 1.1922, region: "Volta", kind: "town" },
  // Oti
  { id: "dambai", name: "Dambai", lat: 8.0667, lng: 0.1833, region: "Oti", kind: "town" },
  // Bono
  { id: "sunyani", name: "Sunyani", lat: 7.3349, lng: -2.3123, region: "Bono", kind: "city" },
  { id: "berekum", name: "Berekum", lat: 7.4536, lng: -2.5859, region: "Bono", kind: "town" },
  // Bono East
  { id: "techiman", name: "Techiman", lat: 7.5907, lng: -1.939, region: "Bono East", kind: "city" },
  { id: "kintampo", name: "Kintampo", lat: 8.0563, lng: -1.7306, region: "Bono East", kind: "town" },
  { id: "atebubu", name: "Atebubu", lat: 7.7503, lng: -0.9869, region: "Bono East", kind: "town" },
  // Ahafo
  { id: "goaso", name: "Goaso", lat: 6.8028, lng: -2.5167, region: "Ahafo", kind: "town" },
  // Northern
  { id: "tamale", name: "Tamale", lat: 9.4075, lng: -0.8533, region: "Northern", kind: "city" },
  { id: "yendi", name: "Yendi", lat: 9.4427, lng: -0.0093, region: "Northern", kind: "town" },
  // Savannah
  { id: "damongo", name: "Damongo", lat: 9.0833, lng: -1.8167, region: "Savannah", kind: "town" },
  { id: "salaga", name: "Salaga", lat: 8.5508, lng: -0.5193, region: "Savannah", kind: "town" },
  // North East
  { id: "nalerigu", name: "Nalerigu", lat: 10.5283, lng: -0.3661, region: "North East", kind: "town" },
  { id: "walewale", name: "Walewale", lat: 10.3522, lng: -0.8028, region: "North East", kind: "town" },
  // Upper East
  { id: "bolgatanga", name: "Bolgatanga", lat: 10.7856, lng: -0.8514, region: "Upper East", kind: "city" },
  { id: "bawku", name: "Bawku", lat: 11.0611, lng: -0.2417, region: "Upper East", kind: "town" },
  { id: "navrongo", name: "Navrongo", lat: 10.8956, lng: -1.0919, region: "Upper East", kind: "town" },
  { id: "paga", name: "Paga", lat: 10.9867, lng: -1.1119, region: "Upper East", kind: "town" },
  // Upper West
  { id: "wa", name: "Wa", lat: 10.0607, lng: -2.5099, region: "Upper West", kind: "city" },
  { id: "tumu", name: "Tumu", lat: 10.8733, lng: -1.9833, region: "Upper West", kind: "town" },
  { id: "lawra", name: "Lawra", lat: 10.6497, lng: -2.8947, region: "Upper West", kind: "town" },
];

interface SeedRoad {
  a: string;
  b: string;
  roadClass: RoadClass;
  name?: string;
  /** Known road distance in km (overrides great-circle estimate). */
  km?: number;
}

/** Primary inter-city road network. Distances in km where well-established. */
export const GHANA_ROADS: SeedRoad[] = [
  // N1 coastal corridor
  { a: "accra", b: "tema", roadClass: "motorway", name: "Accra–Tema Motorway", km: 19 },
  { a: "accra", b: "kasoa", roadClass: "trunk", name: "N1", km: 30 },
  { a: "kasoa", b: "winneba", roadClass: "trunk", name: "N1", km: 35 },
  { a: "winneba", b: "cape-coast", roadClass: "trunk", name: "N1", km: 60 },
  { a: "cape-coast", b: "elmina", roadClass: "primary", name: "Cape Coast–Elmina", km: 13 },
  { a: "cape-coast", b: "takoradi", roadClass: "trunk", name: "N1", km: 73 },
  { a: "takoradi", b: "tarkwa", roadClass: "primary", name: "Takoradi–Tarkwa", km: 88 },
  { a: "takoradi", b: "axim", roadClass: "primary", name: "N1", km: 65 },
  // N6 Accra–Kumasi
  { a: "accra", b: "nsawam", roadClass: "trunk", name: "N6", km: 36 },
  { a: "nsawam", b: "nkawkaw", roadClass: "trunk", name: "N6", km: 120 },
  { a: "nkawkaw", b: "kumasi", roadClass: "trunk", name: "N6", km: 110 },
  { a: "nsawam", b: "koforidua", roadClass: "primary", name: "Nsawam–Koforidua", km: 40 },
  { a: "koforidua", b: "nkawkaw", roadClass: "primary", name: "Eastern corridor", km: 70 },
  { a: "koforidua", b: "akosombo", roadClass: "primary", name: "Koforidua–Akosombo", km: 55 },
  // Ashanti hub
  { a: "kumasi", b: "obuasi", roadClass: "primary", name: "Kumasi–Obuasi", km: 64 },
  { a: "kumasi", b: "ejisu", roadClass: "primary", name: "Kumasi–Ejisu", km: 20 },
  { a: "kumasi", b: "mampong", roadClass: "primary", name: "Kumasi–Mampong", km: 58 },
  { a: "kumasi", b: "techiman", roadClass: "trunk", name: "N10", km: 125 },
  { a: "kumasi", b: "sunyani", roadClass: "trunk", name: "Kumasi–Sunyani", km: 123 },
  // Bono / Bono East
  { a: "sunyani", b: "berekum", roadClass: "primary", name: "Sunyani–Berekum", km: 32 },
  { a: "sunyani", b: "techiman", roadClass: "primary", name: "Sunyani–Techiman", km: 55 },
  { a: "sunyani", b: "goaso", roadClass: "primary", name: "Sunyani–Goaso", km: 58 },
  { a: "techiman", b: "kintampo", roadClass: "trunk", name: "N10", km: 58 },
  { a: "techiman", b: "atebubu", roadClass: "primary", name: "Techiman–Atebubu", km: 92 },
  { a: "sefwi-wiawso", b: "kumasi", roadClass: "primary", name: "Sefwi–Kumasi", km: 150 },
  { a: "sefwi-wiawso", b: "goaso", roadClass: "tertiary", name: "Sefwi–Goaso", km: 90 },
  // Northern corridor (N10)
  { a: "kintampo", b: "tamale", roadClass: "trunk", name: "N10", km: 175 },
  { a: "atebubu", b: "salaga", roadClass: "primary", name: "Atebubu–Salaga", km: 80 },
  { a: "salaga", b: "tamale", roadClass: "primary", name: "Salaga–Tamale", km: 160 },
  { a: "tamale", b: "yendi", roadClass: "primary", name: "Tamale–Yendi", km: 95 },
  { a: "tamale", b: "damongo", roadClass: "primary", name: "Tamale–Damongo", km: 145 },
  { a: "tamale", b: "walewale", roadClass: "trunk", name: "N10", km: 120 },
  { a: "walewale", b: "nalerigu", roadClass: "primary", name: "Walewale–Nalerigu", km: 65 },
  { a: "walewale", b: "bolgatanga", roadClass: "trunk", name: "N10", km: 60 },
  { a: "damongo", b: "wa", roadClass: "primary", name: "Damongo–Wa", km: 190 },
  // Upper East / West
  { a: "bolgatanga", b: "navrongo", roadClass: "primary", name: "Bolga–Navrongo", km: 32 },
  { a: "bolgatanga", b: "bawku", roadClass: "primary", name: "Bolga–Bawku", km: 82 },
  { a: "navrongo", b: "paga", roadClass: "primary", name: "Navrongo–Paga", km: 12 },
  { a: "navrongo", b: "tumu", roadClass: "secondary", name: "Navrongo–Tumu", km: 95 },
  { a: "tumu", b: "wa", roadClass: "secondary", name: "Tumu–Wa", km: 110 },
  { a: "wa", b: "lawra", roadClass: "primary", name: "Wa–Lawra", km: 92 },
  // Volta / Oti corridor
  { a: "accra", b: "akosombo", roadClass: "primary", name: "Accra–Akosombo", km: 100 },
  { a: "akosombo", b: "ho", roadClass: "primary", name: "Akosombo–Ho", km: 75 },
  { a: "ho", b: "hohoe", roadClass: "primary", name: "Ho–Hohoe", km: 70 },
  { a: "ho", b: "keta", roadClass: "secondary", name: "Ho–Keta", km: 95 },
  { a: "keta", b: "aflao", roadClass: "primary", name: "Keta–Aflao", km: 45 },
  { a: "accra", b: "aflao", roadClass: "trunk", name: "N1 East", km: 160 },
  { a: "hohoe", b: "dambai", roadClass: "secondary", name: "Hohoe–Dambai", km: 110 },
  { a: "dambai", b: "atebubu", roadClass: "tertiary", name: "Dambai–Atebubu", km: 85 },
  { a: "madina", b: "accra", roadClass: "primary", name: "Accra–Madina", km: 13 },
];

/** Build a fully-connected GhMap {@link Graph} from the seed dataset. */
export function buildGhanaGraph(): Graph {
  const graph = new Graph();
  for (const c of GHANA_CITIES) {
    const node: PlaceNode = {
      id: c.id,
      name: c.name,
      location: { lat: c.lat, lng: c.lng },
      kind: c.kind ?? "town",
      region: c.region,
    };
    graph.addNode(node);
  }
  for (const r of GHANA_ROADS) {
    graph.addRoad(r.a, r.b, r.roadClass, {
      ...(r.km !== undefined ? { lengthM: r.km * 1000 } : {}),
      ...(r.name !== undefined ? { name: r.name } : {}),
    });
  }
  return graph;
}
