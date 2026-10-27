import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  aStar,
  dijkstra,
  buildConstellation,
  buildDirections,
  buildGhanaGraph,
  randomTrip,
  ReverseGeocoder,
  simulateFix,
  TripSimulator,
  type CostMode,
  type DirectionStep,
  type RouteResult,
  type TravelMode,
  type TripState,
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

interface Vehicle {
  id: string;
  label: string;
  sim: TripSimulator;
  elapsed: number;
  factor: number;
  originName: string;
  destName: string;
  marker: maplibregl.Marker;
  arrow: HTMLElement;
  popup: maplibregl.Popup;
}

const MODES: TravelMode[] = ["drive", "cycle", "walk"];
const FLEET_SIZE = 9;
const FLEET_LABELS = ["STC", "VIP", "Metro Mass", "OA Travel", "Trotro", "Taxi", "Cargo", "Bolt", "Yango"];

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
  const [copied, setCopied] = useState(false);

  // --- Navigation state ---
  const [navActive, setNavActive] = useState(false);
  const [navState, setNavState] = useState<TripState | null>(null);
  const [navFactor, setNavFactor] = useState(40);
  const [navFix, setNavFix] = useState<{ errorM: number; sats: number } | null>(null);
  const navSimRef = useRef<TripSimulator | null>(null);
  const navElapsedRef = useRef(0);
  const navMarker = useRef<maplibregl.Marker | null>(null);
  const navStepCumRef = useRef<number[]>([]);
  const lastNavUi = useRef(0);

  // --- Fleet state ---
  const [fleetActive, setFleetActive] = useState(false);
  const fleetRef = useRef<Vehicle[]>([]);

  const nameOf = useCallback(
    (id: string) => graph.getNode(id)?.name ?? id,
    [graph],
  );

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

    map.on("contextmenu", (e) => {
      setMenu({
        x: e.point.x,
        y: e.point.y,
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
        label: geocoder.label({ lat: e.lngLat.lat, lng: e.lngLat.lng }),
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
        `A* settled ${r.nodesExplored} nodes` + (d ? `, Dijkstra ${d.nodesExplored}` : ""),
      );
    } else {
      setSteps([]);
      setNote("No route found.");
    }
  }, [graph, origin, destination, metric, mode]);

  useEffect(() => {
    writeUrlState({ origin, destination, mode, metric, view: layer });
  }, [origin, destination, mode, metric, layer]);

  // --- Draw / fit the route (skip auto-fit while navigating) ---
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
    if (navActive) return;
    const coords = line.geometry.coordinates;
    if (coords.length > 1) {
      const bounds = coords.reduce(
        (b, c) => b.extend(c as [number, number]),
        new maplibregl.LngLatBounds(
          coords[0] as [number, number],
          coords[0] as [number, number],
        ),
      );
      map.fitBounds(bounds, { padding: { top: 90, bottom: 90, left: 400, right: 90 } });
    }
  }, [route, graph, ready, navActive]);

  // ====================================================================
  // Real-time animation loop (drives navigation + fleet)
  // ====================================================================
  useEffect(() => {
    if (!navActive && !fleetActive) return;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.5);
      last = now;
      const map = mapRef.current;

      // --- Navigation ---
      if (navActive && navSimRef.current && map) {
        navElapsedRef.current += dt * navFactor;
        const st = navSimRef.current.stateAt(navElapsedRef.current);
        navMarker.current?.setLngLat([st.position.lng, st.position.lat]);
        map.jumpTo({
          center: [st.position.lng, st.position.lat],
          zoom: 12.5,
          bearing: st.bearingDeg,
          pitch: 45,
        });
        if (now - lastNavUi.current > 350) {
          lastNavUi.current = now;
          setNavState(st);
          const { fix, visible, errorM } = simulateFix(
            constellation,
            st.position,
            1200 + navElapsedRef.current,
            { clockBiasM: 60_000, noiseM: 6 },
          );
          setNavFix(fix ? { errorM: errorM ?? 0, sats: visible.length } : null);
        }
      }

      // --- Fleet ---
      if (fleetActive && map) {
        for (const v of fleetRef.current) {
          v.elapsed += dt * v.factor;
          const st = v.sim.stateAt(v.elapsed);
          v.marker.setLngLat([st.position.lng, st.position.lat]);
          v.arrow.style.transform = `rotate(${st.bearingDeg}deg)`;
          if (v.popup.isOpen()) v.popup.setHTML(vehicleHtml(v, st));
          if (st.arrived) recycleVehicle(v);
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navActive, fleetActive, navFactor]);

  // ---- Navigation controls ----
  function startNav() {
    const map = mapRef.current;
    if (!map || !route || route.path.length < 2) return;
    const sim = new TripSimulator(graph, route, mode);
    navSimRef.current = sim;
    navElapsedRef.current = 0;
    lastNavUi.current = 0;
    // Cumulative distance at the end of each step, for the live banner.
    let acc = 0;
    navStepCumRef.current = steps.map((s) => (acc += s.distanceM));

    if (!navMarker.current) {
      const el = document.createElement("div");
      el.className = "nav-marker";
      navMarker.current = new maplibregl.Marker({ element: el });
    }
    const st0 = sim.stateAt(0);
    navMarker.current.setLngLat([st0.position.lng, st0.position.lat]).addTo(map);
    setNavState(st0);
    setNavActive(true);
    setMenu(null);
  }

  function stopNav() {
    setNavActive(false);
    navSimRef.current = null;
    navMarker.current?.remove();
    navMarker.current = null;
    setNavState(null);
    setNavFix(null);
    const map = mapRef.current;
    if (map) map.easeTo({ pitch: 0, bearing: 0, zoom: 6.5, duration: 600 });
  }

  // ---- Fleet controls ----
  function makeVehicleEl(): { el: HTMLElement; arrow: HTMLElement } {
    const el = document.createElement("div");
    el.className = "veh";
    const arrow = document.createElement("div");
    arrow.className = "veh-arrow";
    el.appendChild(arrow);
    return { el, arrow };
  }

  function vehicleHtml(v: Vehicle, st: TripState): string {
    return (
      `<strong>${v.label}</strong><br/>` +
      `${v.originName} → ${v.destName}<br/>` +
      `${st.speedKmh.toFixed(0)} km/h · ${formatKm(st.distanceRemainingM)} left<br/>` +
      `ETA ${arrivalTime(st.timeRemainingS)} · ${Math.round(st.progress * 100)}% there`
    );
  }

  function spawnVehicle(i: number): Vehicle | null {
    const map = mapRef.current;
    if (!map) return null;
    const trip = randomTrip(graph, Math.random, "drive");
    if (!trip) return null;
    const { el, arrow } = makeVehicleEl();
    const popup = new maplibregl.Popup({ offset: 14, closeButton: false });
    const v: Vehicle = {
      id: `veh-${i}`,
      label: `${FLEET_LABELS[i % FLEET_LABELS.length]} ${i + 1}`,
      sim: trip.sim,
      elapsed: Math.random() * trip.sim.totalTimeS,
      factor: 70 + Math.random() * 90,
      originName: nameOf(trip.origin),
      destName: nameOf(trip.destination),
      marker: new maplibregl.Marker({ element: el }),
      arrow,
      popup,
    };
    const st = v.sim.stateAt(v.elapsed);
    v.marker.setLngLat([st.position.lng, st.position.lat]).setPopup(popup).addTo(map);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      popup.setHTML(vehicleHtml(v, v.sim.stateAt(v.elapsed)));
    });
    return v;
  }

  function recycleVehicle(v: Vehicle) {
    const trip = randomTrip(graph, Math.random, "drive");
    if (!trip) return;
    v.sim = trip.sim;
    v.elapsed = 0;
    v.originName = nameOf(trip.origin);
    v.destName = nameOf(trip.destination);
  }

  function startFleet() {
    const list: Vehicle[] = [];
    for (let i = 0; i < FLEET_SIZE; i++) {
      const v = spawnVehicle(i);
      if (v) list.push(v);
    }
    fleetRef.current = list;
    setFleetActive(true);
  }

  function stopFleet() {
    for (const v of fleetRef.current) v.marker.remove();
    fleetRef.current = [];
    setFleetActive(false);
  }

  // --- "Use my location" ---
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

  // Live navigation banner: which step are we on, and how far to the next turn.
  const navBanner = (() => {
    if (!navState) return null;
    const cum = navStepCumRef.current;
    let idx = cum.findIndex((end) => navState.distanceCoveredM < end - 1);
    if (idx === -1) idx = steps.length - 1;
    const step = steps[idx];
    const next = steps[idx + 1] ?? steps[steps.length - 1];
    const toTurn = Math.max(0, (cum[idx] ?? navState.distanceCoveredM) - navState.distanceCoveredM);
    return { step, next, toTurn };
  })();

  return (
    <div className="app">
      <div id="map" ref={mapContainer} />

      {/* Top-right controls */}
      <div className="top-controls">
        <div className="layer-toggle">
          <button className={layer === "streets" ? "active" : ""} onClick={() => setLayer("streets")}>
            Streets
          </button>
          <button
            className={layer === "satellite" ? "active" : ""}
            onClick={() => setLayer("satellite")}
          >
            Satellite
          </button>
        </div>
        <button
          className={`fleet-btn ${fleetActive ? "active" : ""}`}
          onClick={() => (fleetActive ? stopFleet() : startFleet())}
          title="Show live vehicles moving across Ghana"
        >
          {fleetActive ? "● Live vehicles on" : "○ Live vehicles"}
        </button>
      </div>

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

      {/* ---------- Navigation overlay ---------- */}
      {navActive && navState ? (
        <>
          <div className="nav-top">
            <div className="nav-maneuver">
              {MANEUVER_ICON[navBanner?.next?.maneuver ?? "continue"]}
            </div>
            <div className="nav-instruction">
              {navState.arrived ? (
                <strong>You have arrived at {nameOf(destination!)}</strong>
              ) : (
                <>
                  <div className="nav-dist">{formatKm(navBanner?.toTurn ?? 0)}</div>
                  <div className="nav-next">{navBanner?.next?.instruction}</div>
                </>
              )}
            </div>
          </div>

          <div className="nav-bottom">
            <div className="nav-eta">
              <span className="eta-time">{formatDuration(navState.timeRemainingS)}</span>
              <span className="eta-sub">
                {formatKm(navState.distanceRemainingM)} · arrive {arrivalTime(navState.timeRemainingS)}
              </span>
            </div>
            <div className="nav-dials">
              <div className="dial">
                <span className="dv">{navState.speedKmh.toFixed(0)}</span>
                <span className="dk">km/h</span>
              </div>
              <div className="dial">
                <span className="dv">{navFix ? navFix.sats : "–"}</span>
                <span className="dk">sats</span>
              </div>
              <div className="dial">
                <span className="dv good">{navFix ? `${navFix.errorM.toFixed(0)}m` : "–"}</span>
                <span className="dk">GPS acc.</span>
              </div>
            </div>
            <div className="nav-actions">
              <label className="speedlbl">
                Sim speed {navFactor}×
                <input
                  type="range"
                  min={5}
                  max={200}
                  step={5}
                  value={navFactor}
                  onChange={(e) => setNavFactor(Number(e.target.value))}
                />
              </label>
              <button className="nav-stop" onClick={stopNav}>
                {navState.arrived ? "Done" : "End"}
              </button>
            </div>
            <div className="nav-progress">
              <span style={{ width: `${Math.round(navState.progress * 100)}%` }} />
            </div>
          </div>
        </>
      ) : null}

      {/* ---------- Sidebar (hidden during navigation) ---------- */}
      {!navActive ? (
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
              <button className={metric === "time" ? "active" : ""} onClick={() => setMetric("time")}>
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
                <button className="go" onClick={startNav}>
                  ▶ Start navigation
                </button>
                <button className="steps-toggle" onClick={() => setShowSteps((s) => !s)}>
                  {showSteps ? "Hide steps" : `Show ${steps.length} steps`}
                </button>
                {showSteps ? (
                  <ol className="steps">
                    {steps.map((s, i) => (
                      <li key={i}>
                        <span className="mic">{MANEUVER_ICON[s.maneuver]}</span>
                        <span className="itxt">
                          {s.instruction}
                          {s.distanceM > 0 ? <em> · {formatKm(s.distanceM)}</em> : null}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            ) : null}
            {note ? <div className="hint">{note}</div> : null}
          </div>

          <p className="tagline">
            {graph.nodeCount} places · {graph.roadCount} road segments · right-click the map for
            directions
          </p>
        </aside>
      ) : null}
    </div>
  );
}
