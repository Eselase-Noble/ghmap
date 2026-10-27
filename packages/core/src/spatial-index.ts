/**
 * A uniform grid spatial index for fast nearest-neighbour and viewport queries.
 *
 * Google Maps' "you are here" and "search this area" both reduce to: given a
 * point, find the closest known places quickly. A linear scan is O(n) per
 * query; bucketing points into a lat/lng grid lets us look only at the cells
 * near the query, giving roughly O(1) average lookups for evenly spread data.
 *
 * We expand the search ring outward until we have enough candidates and can
 * prove no closer point hides in an unvisited ring.
 */
import type { BBox, LatLng } from "./geo.ts";
import { GHANA_BBOX, haversine } from "./geo.ts";

export interface IndexedPoint {
  readonly id: string;
  readonly location: LatLng;
}

interface Cell {
  readonly row: number;
  readonly col: number;
}

export class SpatialGrid<T extends IndexedPoint> {
  private readonly cells = new Map<string, T[]>();
  private readonly bbox: BBox;
  private readonly rows: number;
  private readonly cols: number;
  private readonly latStep: number;
  private readonly lngStep: number;

  /**
   * @param bbox   area the grid covers (defaults to mainland Ghana)
   * @param cellDeg approximate cell size in degrees (~0.1° ≈ 11 km)
   */
  constructor(bbox: BBox = GHANA_BBOX, cellDeg = 0.1) {
    this.bbox = bbox;
    this.rows = Math.max(1, Math.ceil((bbox.maxLat - bbox.minLat) / cellDeg));
    this.cols = Math.max(1, Math.ceil((bbox.maxLng - bbox.minLng) / cellDeg));
    this.latStep = (bbox.maxLat - bbox.minLat) / this.rows;
    this.lngStep = (bbox.maxLng - bbox.minLng) / this.cols;
  }

  private cellOf(p: LatLng): Cell {
    const row = this.clamp(
      Math.floor((p.lat - this.bbox.minLat) / this.latStep),
      this.rows,
    );
    const col = this.clamp(
      Math.floor((p.lng - this.bbox.minLng) / this.lngStep),
      this.cols,
    );
    return { row, col };
  }

  private clamp(v: number, max: number): number {
    return Math.min(max - 1, Math.max(0, v));
  }

  private key(row: number, col: number): string {
    return `${row}:${col}`;
  }

  insert(item: T): void {
    const { row, col } = this.cellOf(item.location);
    const k = this.key(row, col);
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(item);
    else this.cells.set(k, [item]);
  }

  insertAll(items: Iterable<T>): void {
    for (const item of items) this.insert(item);
  }

  /** All items whose location falls inside `box`. */
  queryBBox(box: BBox): T[] {
    const topLeft = this.cellOf({ lat: box.maxLat, lng: box.minLng });
    const bottomRight = this.cellOf({ lat: box.minLat, lng: box.maxLng });
    const out: T[] = [];
    for (let r = bottomRight.row; r <= topLeft.row; r++) {
      for (let c = topLeft.col; c <= bottomRight.col; c++) {
        const bucket = this.cells.get(this.key(r, c));
        if (!bucket) continue;
        for (const item of bucket) {
          if (
            item.location.lat >= box.minLat &&
            item.location.lat <= box.maxLat &&
            item.location.lng >= box.minLng &&
            item.location.lng <= box.maxLng
          ) {
            out.push(item);
          }
        }
      }
    }
    return out;
  }

  /** The single closest item to `p`, by great-circle distance, or null. */
  nearest(p: LatLng): T | null {
    return this.kNearest(p, 1)[0] ?? null;
  }

  /**
   * The `k` closest items to `p`, sorted nearest-first. Grows the ring of cells
   * searched until we have k candidates *and* one extra ring (so nothing closer
   * can be hiding just outside the searched area), then sorts by true distance.
   */
  kNearest(p: LatLng, k: number): T[] {
    const center = this.cellOf(p);
    const maxRing = Math.max(this.rows, this.cols);
    const found: T[] = [];
    let ring = 0;
    let ringsSinceEnough = 0;

    while (ring <= maxRing) {
      for (const { row, col } of this.ringCells(center, ring)) {
        const bucket = this.cells.get(this.key(row, col));
        if (bucket) found.push(...bucket);
      }
      if (found.length >= k) {
        ringsSinceEnough++;
        // One extra ring guarantees correctness near cell boundaries.
        if (ringsSinceEnough >= 2) break;
      }
      ring++;
    }

    return found
      .map((item) => ({ item, d: haversine(p, item.location) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k)
      .map((x) => x.item);
  }

  /** Cells exactly `ring` steps (Chebyshev distance) from the centre cell. */
  private *ringCells(center: Cell, ring: number): Generator<Cell> {
    if (ring === 0) {
      yield center;
      return;
    }
    const seen = new Set<string>();
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const row = center.row + dr;
        const col = center.col + dc;
        if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) continue;
        const k = this.key(row, col);
        if (seen.has(k)) continue;
        seen.add(k);
        yield { row, col };
      }
    }
  }
}
