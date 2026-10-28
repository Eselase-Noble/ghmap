/**
 * Live online geocoding via OpenStreetMap's Nominatim service.
 *
 * Our bundled dataset holds Ghana's settlements and streets, but not every
 * business or landmark. When the local search comes up short, we query the full
 * OpenStreetMap index on demand so anything that exists in OSM can still be
 * found and routed to. Results outside the local data get snapped to the
 * nearest road junction by the caller.
 *
 * Nominatim asks for light use (<=1 req/sec); callers debounce.
 */
export interface OnlineResult {
  name: string;
  region: string;
  lat: number;
  lng: number;
  kind: string;
}

export async function geocodeGhana(
  query: string,
  signal?: AbortSignal,
): Promise<OnlineResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=gh&limit=6&addressdetails=1&q=" +
    encodeURIComponent(q);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as Array<{
      display_name: string;
      name?: string;
      lat: string;
      lon: string;
      type?: string;
      category?: string;
    }>;
    return json.map((r) => {
      const parts = r.display_name.split(",").map((s) => s.trim());
      return {
        name: r.name || parts[0] || r.display_name,
        region: parts.slice(1, 3).join(", "),
        lat: Number(r.lat),
        lng: Number(r.lon),
        kind: r.type || r.category || "place",
      };
    });
  } catch {
    return []; // offline, aborted, or rate-limited — fall back to local only
  }
}
