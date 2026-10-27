import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  aStar,
  dijkstra,
  buildConstellation,
  buildGhanaGraph,
  simulateFix,
  type CostMode,
  type RouteResult,
} from "@ghmap/core";
import {
  BASE_STYLE,
  EMPTY_LINE,
  GHANA_BOUNDS,
  GHANA_CENTER,
  SATELLITE_TILES,
  formatDuration,
  formatKm,
  routeToGeoJSON,
} from "./lib.ts";

type Layer = "streets" | "satellite";

interface GpsResult {
  lat: number;
  lng: number;
  errorM: number;
  gdop: number;
  visible: { id: string; elevationDeg: number }[];
  clockBiasKm: number;
}

export function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const graph = useMemo(() => buildGhanaGraph(), []);
  const constellation = useMemo(() => buildConstellation(), []);
  const cities = useMemo(
    () => graph.nodeList().slice().sort((a, b) => a.name.localeCompare(b.name)),
    [graph],
  );

  const [ready, setReady] = useState(false);
  const [layer, setLayer] = useState<Layer>("streets");
  const [origin, setOrigin] = useState("accra");
  const [destination, setDestination] = useState("tamale");
  const [costMode, setCostMode] = useState<CostMode>("time");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [exploredNote, setExploredNote] = useState<string>("");

  const [gpsPlace, setGpsPlace] = useState("kumasi");
  const [gps, setGps] = useState<GpsResult | null>(null);

  // --- Initialise the map once ---
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: BASE_STYLE,
      center: GHANA_CENTER,
      zoom: 6.2,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");
    map.setMaxBounds([
      [GHANA_BOUNDS[0][0] - 2, GHANA_BOUNDS[0][1] - 2],
      [GHANA_BOUNDS[1][0] + 2, GHANA_BOUNDS[1][1] + 2],
    ]);

    map.on("load", () => {
      // Satellite raster overlay (hidden until toggled).
      map.addSource("satellite", {
        type: "raster",
        tiles: [SATELLITE_TILES],
        tileSize: 256,
        attribution: "Imagery © Esri",
      });
      map.addLayer({
        id: "satellite",
        type: "raster",
        source: "satellite",
        layout: { visibility: "none" },
      });

      // Route line.
      map.addSource("route", { type: "geojson", data: EMPTY_LINE });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.6 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ce1126", "line-width": 4.5 },
      });

      // City markers.
      for (const city of graph.nodeList()) {
        const el = document.createElement("div");
        const isCapital = city.kind === "capital" || city.kind === "city";
        el.style.cssText = `width:${isCapital ? 12 : 8}px;height:${
          isCapital ? 12 : 8
        }px;border-radius:50%;background:${
          isCapital ? "#fcd116" : "#ffffff"
        };border:2px solid #006b3f;cursor:pointer;box-shadow:0 0 0 1px rgba(0,0,0,.3)`;
        el.title = city.name;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          // Click a marker to set it as the destination.
          setDestination(city.id);
        });
        new maplibregl.Marker({ element: el })
          .setLngLat([city.location.lng, city.location.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 12 }).setHTML(
              `<strong>${city.name}</strong><br/>${city.region ?? ""}`,
            ),
          )
          .addTo(map);
      }

      setReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [graph]);

  // --- Toggle satellite layer ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty(
      "satellite",
      "visibility",
      layer === "satellite" ? "visible" : "none",
    );
  }, [layer, ready]);

  // --- Compute route whenever inputs change ---
  useEffect(() => {
    if (origin === destination) {
      setRoute(null);
      setExploredNote("Pick two different places.");
      return;
    }
    const r = aStar(graph, origin, destination, costMode);
    setRoute(r);
    if (r) {
      const d = dijkstra(graph, origin, destination, costMode);
      setExploredNote(
        `A* settled ${r.nodesExplored} nodes` +
          (d ? ` vs Dijkstra ${d.nodesExplored}` : ""),
      );
    } else {
      setExploredNote("No route found.");
    }
  }, [graph, origin, destination, costMode]);

  // --- Draw route on the map ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!route) {
      src.setData(EMPTY_LINE);
      return;
    }
    const line = routeToGeoJSON(graph, route);
    src.setData(line);
    const coords = line.geometry.coordinates;
    if (coords.length > 1) {
      const bounds = coords.reduce(
        (b, c) => b.extend(c as [number, number]),
        new maplibregl.LngLatBounds(
          coords[0] as [number, number],
          coords[0] as [number, number],
        ),
      );
      map.fitBounds(bounds, { padding: { top: 80, bottom: 80, left: 380, right: 80 } });
    }
  }, [route, graph, ready]);

  function runGpsSim() {
    const place = graph.getNode(gpsPlace);
    if (!place) return;
    const t = 1200; // a fixed simulation epoch
    const { fix, visible, errorM } = simulateFix(
      constellation,
      place.location,
      t,
      { clockBiasM: 60_000, noiseM: 6 },
    );
    if (!fix) {
      setGps(null);
      return;
    }
    setGps({
      lat: fix.position.lat,
      lng: fix.position.lng,
      errorM: errorM ?? 0,
      gdop: fix.gdop,
      clockBiasKm: fix.clockBiasM / 1000,
      visible: visible
        .slice()
        .sort((a, b) => b.elevationDeg - a.elevationDeg)
        .map((s) => ({ id: s.id, elevationDeg: s.elevationDeg })),
    });
    const map = mapRef.current;
    if (map) map.flyTo({ center: [place.location.lng, place.location.lat], zoom: 11 });
  }

  const nameOf = (id: string) => graph.getNode(id)?.name ?? id;

  return (
    <div className="app">
      <div id="map" ref={mapContainer} />

      <div className="layer-toggle">
        <button
          className={layer === "streets" ? "active" : ""}
          onClick={() => setLayer("streets")}
        >
          Streets
        </button>
        <button
          className={layer === "satellite" ? "active" : ""}
          onClick={() => setLayer("satellite")}
        >
          Satellite
        </button>
      </div>

      <aside className="sidebar">
        <div className="brand">
          <span className="flag-dot" />
          <h1>GhMap</h1>
        </div>
        <p className="tagline">
          Routing & GPS for Ghana — {graph.nodeCount} places, {graph.roadCount}{" "}
          road segments.
        </p>

        {/* Routing */}
        <div className="card">
          <h2>Directions</h2>

          <label htmlFor="origin">From</label>
          <select
            id="origin"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          >
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label htmlFor="destination">To</label>
          <select
            id="destination"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label>Optimise for</label>
          <div className="seg">
            <button
              className={costMode === "time" ? "active" : ""}
              onClick={() => setCostMode("time")}
            >
              Fastest
            </button>
            <button
              className={costMode === "distance" ? "active" : ""}
              onClick={() => setCostMode("distance")}
            >
              Shortest
            </button>
          </div>

          {route ? (
            <>
              <div className="result">
                <div className="stat">
                  <div className="k">Distance</div>
                  <div className="v">{formatKm(route.distanceM)}</div>
                </div>
                <div className="stat">
                  <div className="k">Travel time</div>
                  <div className="v">{formatDuration(route.timeS)}</div>
                </div>
              </div>
              <div className="path">
                {route.path.map(nameOf).join("  →  ")}
              </div>
            </>
          ) : null}
          <div className="hint">{exploredNote}</div>
        </div>

        {/* GPS simulation */}
        <div className="card">
          <h2>Simulated GPS fix</h2>
          <label htmlFor="gpsPlace">Receiver location</label>
          <select
            id="gpsPlace"
            value={gpsPlace}
            onChange={(e) => setGpsPlace(e.target.value)}
          >
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="btn-primary" onClick={runGpsSim}>
            Acquire satellites & solve position
          </button>

          {gps ? (
            <>
              <div className="result">
                <div className="stat">
                  <div className="k">Position error</div>
                  <div className="v good">{gps.errorM.toFixed(1)} m</div>
                </div>
                <div className="stat">
                  <div className="k">GDOP</div>
                  <div className="v">{gps.gdop.toFixed(2)}</div>
                </div>
                <div className="stat">
                  <div className="k">Satellites</div>
                  <div className="v">{gps.visible.length}</div>
                </div>
                <div className="stat">
                  <div className="k">Clock bias</div>
                  <div className="v">{gps.clockBiasKm.toFixed(1)} km</div>
                </div>
              </div>
              <div className="sat-list">
                {gps.visible.map((s) => (
                  <div className="sat" key={s.id}>
                    <span>{s.id}</span>
                    <span>{s.elevationDeg.toFixed(0)}° elev</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="hint">
              Solves lat/lng & clock bias from the satellites above the horizon
              using least-squares trilateration — real GPS math.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
