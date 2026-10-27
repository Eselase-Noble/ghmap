/**
 * Geographic primitives for GhMap.
 *
 * Everything in GhMap is anchored to WGS-84 latitude/longitude. This module
 * provides the small amount of spherical geometry we need: great-circle
 * distance, bearings, and conversion to a local ENU (east-north-up) frame that
 * the satellite simulator uses for trilateration.
 */

/** Mean radius of the Earth, in metres (WGS-84 authalic sphere). */
export const EARTH_RADIUS_M = 6_371_008.8;

/** A point on the surface of Ghana (or anywhere), in decimal degrees. */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** A 3D point in an Earth-Centred, Earth-Fixed (ECEF) frame, in metres. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export const toRadians = (deg: number): number => deg * DEG2RAD;
export const toDegrees = (rad: number): number => rad * RAD2DEG;

/**
 * Great-circle (haversine) distance between two points, in metres.
 *
 * This is the straight-line "as the crow flies" distance along the Earth's
 * surface. Road distances are longer; the routing graph stores real edge
 * weights, but haversine is our default heuristic and fallback.
 */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Initial bearing (forward azimuth) from `a` to `b`, in degrees [0, 360).
 * 0° = north, 90° = east.
 */
export function bearing(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLng = toRadians(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Convert geodetic lat/lng (+ optional height in metres) to ECEF coordinates.
 * Uses a spherical Earth, which is accurate to within a few km globally and
 * far better than that over an area the size of Ghana — plenty for a
 * positioning *simulation*.
 */
export function toECEF(p: LatLng, heightM = 0): Vec3 {
  const lat = toRadians(p.lat);
  const lng = toRadians(p.lng);
  const r = EARTH_RADIUS_M + heightM;
  return {
    x: r * Math.cos(lat) * Math.cos(lng),
    y: r * Math.cos(lat) * Math.sin(lng),
    z: r * Math.sin(lat),
  };
}

/** Inverse of {@link toECEF}: ECEF metres back to lat/lng + height. */
export function fromECEF(v: Vec3): LatLng & { height: number } {
  const hyp = Math.sqrt(v.x * v.x + v.y * v.y);
  const lat = Math.atan2(v.z, hyp);
  const lng = Math.atan2(v.y, v.x);
  const r = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return { lat: toDegrees(lat), lng: toDegrees(lng), height: r - EARTH_RADIUS_M };
}

export const subtract = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const scale = (a: Vec3, s: number): Vec3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});

export const dot = (a: Vec3, b: Vec3): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

export const norm = (a: Vec3): number => Math.sqrt(dot(a, a));

export const distance3d = (a: Vec3, b: Vec3): number => norm(subtract(a, b));

/** Bounding box, handy for the spatial index and viewport queries. */
export interface BBox {
  readonly minLat: number;
  readonly minLng: number;
  readonly maxLat: number;
  readonly maxLng: number;
}

/** Approximate bounding box of mainland Ghana, used to seed the spatial grid. */
export const GHANA_BBOX: BBox = {
  minLat: 4.5,
  minLng: -3.26,
  maxLat: 11.17,
  maxLng: 1.2,
};

export function inBBox(p: LatLng, box: BBox): boolean {
  return (
    p.lat >= box.minLat &&
    p.lat <= box.maxLat &&
    p.lng >= box.minLng &&
    p.lng <= box.maxLng
  );
}
