import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  aStar,
  dijkstra,
  buildConstellation,
  buildDirections,
  buildGhanaGraph,
  ReverseGeocoder,
  simulateFix,
  type CostMode,
  type DirectionStep,
  type RouteResult,
  type TravelMode,
} from "@ghmap/core";
import { PlaceInput } from "./PlaceInput.tsx";
import {
  BASE_STYLE,
  EMPTY_LINE,
  GHANA_BOUNDS,
  GHANA_CENTER,
  MANEUVER_ICON,
  MODE_ICON,
  MODE_LABEL,
  SATELLITE_TILES,
  arrivalTime,
  formatDuration,
  formatKm,
  readUrlState,
  routeToGeoJSON,
  writeUrlState,
} from "./lib.ts";

type Layer = "streets" | "satellite";
type Menu = { x: number; y: number; lng: number; lat: number; label: string } | null;

interface GpsResult {
  errorM: number;
  gdop: number;
  visible: number;
  clockBiasKm: number;
}

const MODES: TravelMode[] = ["drive", "cycle", "walk"];

export function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const meMarker = useRef<maplibregl.Marker | null>(null);

  const graph = useMemo(() => buildGhanaGraph(), []);
  const constellation = useMemo(() => buildConstellation(), []);
  const geocoder = useMemo(() => new ReverseGeocoder(graph), [graph]);

  const initial = useMemo(() => readUrlState(), []);
  const [ready, setReady] = useState(false);
  const [layer, setLayer] = useState<Layer>(initial.view ?? "streets");
  const [origin, setOrigin] = useState<string | null>(initial.origin ?? "accra");
  const [destination, setDestination] = useState<string | null>(
    initial.destination ?? "kumasi",
  );
  const [mode, setMode] = useState<TravelMode>(initial.mode ?? "drive");
  const [metric, setMetric] = useState<CostMode>(initial.metric ?? "time");

  const [route, setRoute] = useState<RouteResult | null>(null);
  const [steps, setSteps] = useState<DirectionStep[]>([]);
  const [note, setNote] = useState("");
  const [showSteps, setShowSteps] = useState(false);

  const [menu, setMenu] = useState<Menu>(null);
  const [gps, setGps] = useState<GpsResult | null>(null);
  const [showGps, setShowGps] = useState(false);
  const [copied, setCopied] = useState(false);

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
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.setMaxBounds([
      [GHANA_BOUNDS[0][0] - 2, GHANA_BOUNDS[0][1] - 2],
      [GHANA_BOUNDS[1][0] + 2, GHANA_BOUNDS[1][1] + 2],
    ]);

    map.on("load", () => {
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

      for (const city of graph.nodeList()) {
        const el = document.createElement("div");
        const big = city.kind === "capital" || city.kind === "city";
        el.className = "city-marker";
        el.style.cssText = `width:${big ? 12 : 8}px;height:${big ? 12 : 8}px;background:${
          big ? "#fcd116" : "#ffffff"
        }`;
        el.title = city.name;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
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

    // Right-click: offer directions from/to this point.
    map.on("contextmenu", (e) => {
      const label = geocoder.label({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      setMenu({
        x: e.point.x,
        y: e.point.y,
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
        label,
      });
    });
    map.on("click", () => setMenu(null));
    map.on("movestart", () => setMenu(null));

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [graph, geocoder]);

  // --- Satellite layer toggle ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty(
      "satellite",
      "visibility",
      layer === "satellite" ? "visible" : "none",
    );
  }, [layer, ready]);

  // --- Compute the route whenever inputs change ---
  useEffect(() => {
    if (!origin || !destination || origin === destination) {
      setRoute(null);
      setSteps([]);
      setNote(origin === destination ? "Choose two different places." : "");
      return;
    }
    const r = aStar(graph, origin, destination, { metric, mode });
    setRoute(r);
    if (r) {
      setSteps(buildDirections(graph, r, mode));
      const d = dijkstra(graph, origin, destination, { metric, mode });
      setNote(
        `A* settled ${r.nodesExplored} nodes` +
          (d ? `, Dijkstra ${d.nodesExplored}` : ""),
      );
    } else {
      setSteps([]);
      setNote("No route found.");
    }
  }, [graph, origin, destination, metric, mode]);

  // --- Reflect state into the URL for sharing ---
  useEffect(() => {
    writeUrlState({ origin, destination, mode, metric, view: layer });
  }, [origin, destination, mode, metric, layer]);

  // --- Draw / fit the route ---
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
      map.fitBounds(bounds, {
        padding: { top: 90, bottom: 90, left: 400, right: 90 },
      });
    }
  }, [route, graph, ready]);

  // --- "Use my location" via the browser Geolocation API ---
  const useMyLocation = useCallback(
    (assign: (id: string) => void) => {
      if (!navigator.geolocation) {
        setNote("Geolocation isn't available in this browser.");
        return;
      }
      setNote("Locating you…");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const hit = geocoder.nearest(here);
          const map = mapRef.current;
          if (map) {
            if (!meMarker.current) {
              const el = document.createElement("div");
              el.className = "me-marker";
              meMarker.current = new maplibregl.Marker({ element: el });
            }
            meMarker.current.setLngLat([here.lng, here.lat]).addTo(map);
            map.flyTo({ center: [here.lng, here.lat], zoom: 10 });
          }
          if (hit) {
            assign(hit.node.id);
            setNote(`You're near ${hit.node.name}.`);
          } else {
            setNote("You appear to be outside Ghana.");
          }
        },
        () => setNote("Couldn't get your location (permission denied?)."),
        { enableHighAccuracy: true, timeout: 8000 },
      );
    },
    [geocoder],
  );

  function runGpsSim() {
    const node = destination ? graph.getNode(destination) : null;
    const target = node ?? graph.getNode("kumasi")!;
    const { fix, visible, errorM } = simulateFix(
      constellation,
      target.location,
      1200,
      { clockBiasM: 60_000, noiseM: 6 },
    );
    if (!fix) return setGps(null);
    setGps({
      errorM: errorM ?? 0,
      gdop: fix.gdop,
      visible: visible.length,
      clockBiasKm: fix.clockBiasM / 1000,
    });
    const map = mapRef.current;
    if (map) map.flyTo({ center: [target.location.lng, target.location.lat], zoom: 11 });
  }

  function share() {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  function swap() {
    setOrigin(destination);
    setDestination(origin);
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

      {/* Right-click context menu */}
      {menu ? (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="ctx-label">{menu.label}</div>
          <button
            onMouseDown={() => {
              const hit = geocoder.nearest({ lat: menu.lat, lng: menu.lng });
              if (hit) setOrigin(hit.node.id);
              setMenu(null);
            }}
          >
            Directions from here
          </button>
          <button
            onMouseDown={() => {
              const hit = geocoder.nearest({ lat: menu.lat, lng: menu.lng });
              if (hit) setDestination(hit.node.id);
              setMenu(null);
            }}
          >
            Directions to here
          </button>
        </div>
      ) : null}

      <aside className="sidebar">
        <div className="brand">
          <span className="flag-dot" />
          <h1>GhMap</h1>
          <button className="share" onClick={share} title="Copy shareable link">
            {copied ? "Copied!" : "Share"}
          </button>
        </div>

        <div className="card">
          <div className="io">
            <span className="pin from">A</span>
            <PlaceInput
              graph={graph}
              value={origin}
              placeholder="Choose starting point"
              onSelect={setOrigin}
              onClear={() => setOrigin(null)}
              onUseMyLocation={() => useMyLocation(setOrigin)}
            />
          </div>
          <div className="io">
            <span className="pin to">B</span>
            <PlaceInput
              graph={graph}
              value={destination}
              placeholder="Choose destination"
              onSelect={setDestination}
              onClear={() => setDestination(null)}
            />
            <button className="swap" title="Swap" onClick={swap}>
              ⇅
            </button>
          </div>

          <div className="modes">
            {MODES.map((m) => (
              <button
                key={m}
                className={mode === m ? "active" : ""}
                title={MODE_LABEL[m]}
                onClick={() => setMode(m)}
              >
                <span className="ic">{MODE_ICON[m]}</span>
                {route && mode === m ? (
                  <span className="t">{formatDuration(route.timeS)}</span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="seg">
            <button
              className={metric === "time" ? "active" : ""}
              onClick={() => setMetric("time")}
            >
              Fastest
            </button>
            <button
              className={metric === "distance" ? "active" : ""}
              onClick={() => setMetric("distance")}
            >
              Shortest
            </button>
          </div>

          {route ? (
            <div className="summary">
              <div className="big">
                <span className="time">{formatDuration(route.timeS)}</span>
                <span className="dist">{formatKm(route.distanceM)}</span>
              </div>
              <div className="eta">Arrive around {arrivalTime(route.timeS)}</div>
              <button
                className="steps-toggle"
                onClick={() => setShowSteps((s) => !s)}
              >
                {showSteps ? "Hide steps" : `Show ${steps.length} steps`}
              </button>
              {showSteps ? (
                <ol className="steps">
                  {steps.map((s, i) => (
                    <li key={i}>
                      <span className="mic">{MANEUVER_ICON[s.maneuver]}</span>
                      <span className="itxt">
                        {s.instruction}
                        {s.distanceM > 0 ? (
                          <em> · {formatKm(s.distanceM)}</em>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}
          {note ? <div className="hint">{note}</div> : null}
        </div>

        {/* GPS simulation (secondary) */}
        <div className="card">
          <button className="accordion" onClick={() => setShowGps((s) => !s)}>
            🛰️ Simulated GPS fix {showGps ? "▾" : "▸"}
          </button>
          {showGps ? (
            <>
              <p className="hint">
                Acquires the satellites above {destination ? nameOf(destination) : "Kumasi"} and
                solves its position by least-squares trilateration.
              </p>
              <button className="btn-primary" onClick={runGpsSim}>
                Acquire & solve
              </button>
              {gps ? (
                <div className="result">
                  <div className="stat">
                    <div className="k">Error</div>
                    <div className="v good">{gps.errorM.toFixed(1)} m</div>
                  </div>
                  <div className="stat">
                    <div className="k">GDOP</div>
                    <div className="v">{gps.gdop.toFixed(2)}</div>
                  </div>
                  <div className="stat">
                    <div className="k">Satellites</div>
                    <div className="v">{gps.visible}</div>
                  </div>
                  <div className="stat">
                    <div className="k">Clock bias</div>
                    <div className="v">{gps.clockBiasKm.toFixed(1)} km</div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <p className="tagline">
          {graph.nodeCount} places · {graph.roadCount} road segments · right-click
          the map for directions
        </p>
      </aside>
    </div>
  );
}
