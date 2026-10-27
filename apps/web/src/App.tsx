import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  alternativeRoutes,
  aStar,
  buildConstellation,
  buildDirections,
  randomTrip,
  simulateFix,
  TripSimulator,
  type CostMode,
  type DirectionStep,
  type RouteResult,
  type TravelMode,
  type TripState,
} from "@ghmap/core";
import { PlaceInput } from "./PlaceInput.tsx";
import { loadDataset, type Dataset } from "./dataset.ts";
import { getRecent, getSaved, pushRecent, toggleSaved } from "./storage.ts";
import {
  BASE_STYLE,
  EMPTY_FC,
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
  routeTrafficFeatures,
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
  const deviceMarker = useRef<maplibregl.Marker | null>(null);

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const initial = useMemo(() => readUrlState(), []);
  const [layer, setLayer] = useState<Layer>(initial.view ?? "streets");
  const [origin, setOrigin] = useState<string | null>(initial.origin ?? null);
  const [destination, setDestination] = useState<string | null>(initial.destination ?? null);
  const [mode, setMode] = useState<TravelMode>(initial.mode ?? "drive");
  const [metric, setMetric] = useState<CostMode>(initial.metric ?? "time");
  const [trafficOn, setTrafficOn] = useState(true);

  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [steps, setSteps] = useState<DirectionStep[]>([]);
  const [note, setNote] = useState("");
  const [showSteps, setShowSteps] = useState(false);

  const [menu, setMenu] = useState<Menu>(null);
  const [copied, setCopied] = useState(false);

  const [saved, setSaved] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);

  // Navigation
  const [navActive, setNavActive] = useState(false);
  const [navState, setNavState] = useState<TripState | null>(null);
  const [navFactor, setNavFactor] = useState(40);
  const [navFix, setNavFix] = useState<{ errorM: number; sats: number } | null>(null);
  const navSimRef = useRef<TripSimulator | null>(null);
  const navElapsedRef = useRef(0);
  const navMarker = useRef<maplibregl.Marker | null>(null);
  const navStepCumRef = useRef<number[]>([]);
  const lastNavUi = useRef(0);

  // Fleet + device tracking
  const [fleetActive, setFleetActive] = useState(false);
  const fleetRef = useRef<Vehicle[]>([]);
  const [tracking, setTracking] = useState(false);
  const watchId = useRef<number | null>(null);

  const constellation = useMemo(() => buildConstellation(), []);
  const graph = dataset?.graph ?? null;
  const gazetteer = dataset?.gazetteer ?? null;
  const traffic = dataset?.traffic ?? null;

  const nameOf = useCallback((id: string) => gazetteer?.get(id)?.name ?? id, [gazetteer]);

  // --- Load dataset + saved/recent once ---
  useEffect(() => {
    setSaved(getSaved());
    setRecent(getRecent());
    loadDataset().then((d) => {
      setDataset(d);
      // Sensible defaults if URL didn't specify.
      setOrigin((o) => o ?? (d.gazetteer.search("Accra", 1)[0]?.id ?? null));
      setDestination((dn) => dn ?? (d.gazetteer.search("Kumasi", 1)[0]?.id ?? null));
    });
  }, []);

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
      map.addLayer({ id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } });

      map.addSource("route-alts", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "route-alts",
        type: "line",
        source: "route-alts",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#8aa0b6", "line-width": 5, "line-opacity": 0.55 },
      });

      map.addSource("route", { type: "geojson", data: EMPTY_LINE });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.7 },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#1a73e8", "line-width": 5.5 },
      });

      map.addSource("route-traffic", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "route-traffic",
        type: "line",
        source: "route-traffic",
        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
        paint: { "line-color": ["get", "color"], "line-width": 5.5 },
      });

      setMapLoaded(true);
    });

    map.on("contextmenu", (e) => {
      setMenu({
        x: e.point.x,
        y: e.point.y,
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
        label: gazetteerRef.current?.label({ lat: e.lngLat.lat, lng: e.lngLat.lng }) ?? "",
      });
    });
    map.on("click", () => setMenu(null));
    map.on("movestart", () => setMenu(null));

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Keep a ref to the gazetteer for map event handlers (which close over nothing).
  const gazetteerRef = useRef(gazetteer);
  useEffect(() => {
    gazetteerRef.current = gazetteer;
  }, [gazetteer]);

  // --- Seed-mode city markers (OSM mode relies on base-map labels) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !dataset || dataset.source !== "seed" || !gazetteer) return;
    const markers: maplibregl.Marker[] = [];
    for (const node of dataset.graph.nodeList()) {
      const el = document.createElement("div");
      const big = node.kind === "capital" || node.kind === "city";
      el.className = "city-marker";
      el.style.cssText = `width:${big ? 12 : 8}px;height:${big ? 12 : 8}px;background:${big ? "#fcd116" : "#ffffff"}`;
      el.title = node.name;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setDestination(node.id);
      });
      markers.push(
        new maplibregl.Marker({ element: el })
          .setLngLat([node.location.lng, node.location.lat])
          .setPopup(new maplibregl.Popup({ offset: 12 }).setHTML(`<strong>${node.name}</strong><br/>${node.region ?? ""}`))
          .addTo(map),
      );
    }
    return () => markers.forEach((m) => m.remove());
  }, [mapLoaded, dataset, gazetteer]);

  // --- Satellite layer toggle ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    map.setLayoutProperty("satellite", "visibility", layer === "satellite" ? "visible" : "none");
  }, [layer, mapLoaded]);

  // --- Compute routes whenever inputs change ---
  // The best route is computed and shown immediately; alternatives (several
  // more A* runs, costly on the full OSM graph) are deferred so the UI paints
  // the primary route without blocking.
  useEffect(() => {
    if (!graph || !origin || !destination || origin === destination) {
      setRoutes([]);
      setSteps([]);
      setNote(origin && origin === destination ? "Choose two different places." : "");
      return;
    }
    let cancelled = false;
    const trafficOpt =
      trafficOn && metric === "time" ? { model: traffic!, date: new Date() } : undefined;
    const opts = { metric, mode, ...(trafficOpt ? { traffic: trafficOpt } : {}) };

    setNote("Calculating route…");
    const best = aStar(graph, origin, destination, opts);
    if (cancelled) return;
    if (!best) {
      setRoutes([]);
      setSteps([]);
      setNote("No route found.");
      return;
    }
    setRoutes([best]);
    setSelected(0);
    setSteps(buildDirections(graph, best, mode));
    setNote("");

    const id = window.setTimeout(() => {
      if (cancelled) return;
      const alts = alternativeRoutes(graph, origin, destination, { ...opts, count: 3 });
      if (!cancelled && alts.length > 1) {
        setRoutes(alts);
        setSelected(0);
      }
    }, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [graph, traffic, origin, destination, metric, mode, trafficOn]);

  // Rebuild steps when the selected alternative changes.
  useEffect(() => {
    if (graph && routes[selected]) setSteps(buildDirections(graph, routes[selected]!, mode));
  }, [graph, routes, selected, mode]);

  useEffect(() => {
    writeUrlState({ origin, destination, mode, metric, view: layer });
  }, [origin, destination, mode, metric, layer]);

  // --- Draw routes (selected + alternatives + optional traffic colouring) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !graph) return;
    const routeSrc = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    const altSrc = map.getSource("route-alts") as maplibregl.GeoJSONSource | undefined;
    const trafficSrc = map.getSource("route-traffic") as maplibregl.GeoJSONSource | undefined;
    if (!routeSrc || !altSrc || !trafficSrc) return;

    const sel = routes[selected];
    if (!sel) {
      routeSrc.setData(EMPTY_LINE);
      altSrc.setData(EMPTY_FC);
      trafficSrc.setData(EMPTY_FC);
      return;
    }
    routeSrc.setData(routeToGeoJSON(graph, sel));
    altSrc.setData({
      type: "FeatureCollection",
      features: routes
        .filter((_, i) => i !== selected)
        .map((r) => routeToGeoJSON(graph, r)),
    });

    const showTraffic = trafficOn && metric === "time";
    if (showTraffic && traffic) {
      trafficSrc.setData(routeTrafficFeatures(graph, sel, traffic, new Date()));
    } else {
      trafficSrc.setData(EMPTY_FC);
    }
    map.setLayoutProperty("route-traffic", "visibility", showTraffic ? "visible" : "none");
    map.setLayoutProperty("route-line", "visibility", showTraffic ? "none" : "visible");

    if (!navActive) {
      const coords = routeToGeoJSON(graph, sel).geometry.coordinates;
      if (coords.length > 1) {
        const bounds = coords.reduce(
          (b, c) => b.extend(c as [number, number]),
          new maplibregl.LngLatBounds(coords[0] as [number, number], coords[0] as [number, number]),
        );
        map.fitBounds(bounds, { padding: { top: 90, bottom: 90, left: 400, right: 90 } });
      }
    }
  }, [routes, selected, graph, mapLoaded, trafficOn, metric, traffic, navActive]);

  // ====================================================================
  // Real-time animation loop (navigation + fleet)
  // ====================================================================
  useEffect(() => {
    if (!navActive && !fleetActive) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.5);
      last = now;
      const map = mapRef.current;
      if (navActive && navSimRef.current && map) {
        navElapsedRef.current += dt * navFactor;
        const st = navSimRef.current.stateAt(navElapsedRef.current);
        navMarker.current?.setLngLat([st.position.lng, st.position.lat]);
        map.jumpTo({ center: [st.position.lng, st.position.lat], zoom: 13, bearing: st.bearingDeg, pitch: 50 });
        if (now - lastNavUi.current > 350) {
          lastNavUi.current = now;
          setNavState(st);
          const { fix, visible, errorM } = simulateFix(constellation, st.position, 1200 + navElapsedRef.current, {
            clockBiasM: 60_000,
            noiseM: 6,
          });
          setNavFix(fix ? { errorM: errorM ?? 0, sats: visible.length } : null);
        }
      }
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

  function startNav() {
    const map = mapRef.current;
    const sel = routes[selected];
    if (!map || !graph || !sel || sel.path.length < 2) return;
    const sim = new TripSimulator(graph, sel, mode);
    navSimRef.current = sim;
    navElapsedRef.current = 0;
    lastNavUi.current = 0;
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
    mapRef.current?.easeTo({ pitch: 0, bearing: 0, zoom: 6.5, duration: 600 });
  }

  function makeVehicleEl() {
    const el = document.createElement("div");
    el.className = "veh";
    const arrow = document.createElement("div");
    arrow.className = "veh-arrow";
    el.appendChild(arrow);
    return { el, arrow };
  }
  function vehicleHtml(v: Vehicle, st: TripState) {
    return (
      `<strong>${v.label}</strong><br/>${v.originName} → ${v.destName}<br/>` +
      `${st.speedKmh.toFixed(0)} km/h · ${formatKm(st.distanceRemainingM)} left<br/>` +
      `ETA ${arrivalTime(st.timeRemainingS)} · ${Math.round(st.progress * 100)}% there`
    );
  }
  function spawnVehicle(i: number): Vehicle | null {
    const map = mapRef.current;
    if (!map || !graph) return null;
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
    if (!graph) return;
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
    fleetRef.current.forEach((v) => v.marker.remove());
    fleetRef.current = [];
    setFleetActive(false);
  }

  // --- Real device tracking (watchPosition) ---
  function toggleTracking() {
    if (tracking) {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      deviceMarker.current?.remove();
      deviceMarker.current = null;
      setTracking(false);
      return;
    }
    if (!navigator.geolocation) {
      setNote("Geolocation isn't available in this browser.");
      return;
    }
    setTracking(true);
    setNote("Tracking your live location…");
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const map = mapRef.current;
        if (!map) return;
        const here: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        if (!deviceMarker.current) {
          const el = document.createElement("div");
          el.className = "device-marker";
          const dot = document.createElement("div");
          dot.className = "device-dot";
          el.appendChild(dot);
          deviceMarker.current = new maplibregl.Marker({ element: el });
        }
        deviceMarker.current.setLngLat(here).addTo(map);
        const el = deviceMarker.current.getElement().firstElementChild as HTMLElement;
        if (pos.coords.heading != null && !Number.isNaN(pos.coords.heading)) {
          el.style.transform = `rotate(${pos.coords.heading}deg)`;
          el.classList.add("has-heading");
        }
        if (!navActive) map.easeTo({ center: here, zoom: Math.max(map.getZoom(), 13), duration: 600 });
      },
      () => {
        setNote("Couldn't track location (permission denied?).");
        setTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
  }

  const useMyLocation = useCallback(
    (assign: (id: string) => void) => {
      if (!navigator.geolocation || !gazetteer) return setNote("Geolocation unavailable.");
      setNote("Locating you…");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          const hit = gazetteer.nearest(here);
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
            assign(hit.place.id);
            setNote(`You're near ${hit.place.name}.`);
          } else setNote("You appear to be outside the map.");
        },
        () => setNote("Couldn't get your location."),
        { enableHighAccuracy: true, timeout: 8000 },
      );
    },
    [gazetteer],
  );

  function onSelectPlace(setter: (id: string) => void) {
    return (id: string) => {
      setter(id);
      setRecent(pushRecent(id));
    };
  }
  function onToggle(id: string) {
    setSaved(toggleSaved(id));
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

  const navBanner = (() => {
    if (!navState) return null;
    const cum = navStepCumRef.current;
    let idx = cum.findIndex((end) => navState.distanceCoveredM < end - 1);
    if (idx === -1) idx = steps.length - 1;
    const next = steps[idx + 1] ?? steps[steps.length - 1];
    const toTurn = Math.max(0, (cum[idx] ?? navState.distanceCoveredM) - navState.distanceCoveredM);
    return { next, toTurn };
  })();

  const sel = routes[selected];
  const selTime = sel ? (trafficOn && sel.trafficTimeS != null ? sel.trafficTimeS : sel.timeS) : 0;

  return (
    <div className="app">
      <div id="map" ref={mapContainer} />

      {!dataset ? (
        <div className="loading">
          <div className="flag-dot big" />
          <div>Loading Ghana map…</div>
        </div>
      ) : null}

      <div className="top-controls">
        <div className="layer-toggle">
          <button className={layer === "streets" ? "active" : ""} onClick={() => setLayer("streets")}>
            Streets
          </button>
          <button className={layer === "satellite" ? "active" : ""} onClick={() => setLayer("satellite")}>
            Satellite
          </button>
        </div>
        <button className={`pill ${trafficOn ? "active" : ""}`} onClick={() => setTrafficOn((t) => !t)} title="Show live traffic estimate">
          {trafficOn ? "● Traffic on" : "○ Traffic"}
        </button>
        <button className={`pill ${tracking ? "active" : ""}`} onClick={toggleTracking} title="Follow my live GPS location">
          {tracking ? "● Tracking me" : "◎ Track me"}
        </button>
        <button className={`pill ${fleetActive ? "active" : ""}`} onClick={() => (fleetActive ? stopFleet() : startFleet())} title="Live vehicles across Ghana">
          {fleetActive ? "● Live vehicles" : "○ Live vehicles"}
        </button>
      </div>

      {menu ? (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          <div className="ctx-label">{menu.label}</div>
          <button
            onMouseDown={() => {
              const hit = gazetteer?.nearest({ lat: menu.lat, lng: menu.lng });
              if (hit) setOrigin(hit.place.id);
              setMenu(null);
            }}
          >
            Directions from here
          </button>
          <button
            onMouseDown={() => {
              const hit = gazetteer?.nearest({ lat: menu.lat, lng: menu.lng });
              if (hit) setDestination(hit.place.id);
              setMenu(null);
            }}
          >
            Directions to here
          </button>
        </div>
      ) : null}

      {/* Navigation overlay */}
      {navActive && navState ? (
        <>
          <div className="nav-top">
            <div className="nav-maneuver">{MANEUVER_ICON[navBanner?.next?.maneuver ?? "continue"]}</div>
            <div className="nav-instruction">
              {navState.arrived ? (
                <strong>You have arrived at {destination ? nameOf(destination) : ""}</strong>
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
                <input type="range" min={5} max={200} step={5} value={navFactor} onChange={(e) => setNavFactor(Number(e.target.value))} />
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

      {/* Sidebar */}
      {!navActive && dataset && gazetteer ? (
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
                gazetteer={gazetteer}
                value={origin}
                placeholder="Choose starting point"
                onSelect={onSelectPlace(setOrigin)}
                onClear={() => setOrigin(null)}
                onUseMyLocation={() => useMyLocation(setOrigin)}
                saved={saved}
                recent={recent}
                onToggleSaved={onToggle}
              />
            </div>
            <div className="io">
              <span className="pin to">B</span>
              <PlaceInput
                gazetteer={gazetteer}
                value={destination}
                placeholder="Choose destination"
                onSelect={onSelectPlace(setDestination)}
                onClear={() => setDestination(null)}
                saved={saved}
                recent={recent}
                onToggleSaved={onToggle}
              />
              <button className="swap" title="Swap" onClick={swap}>
                ⇅
              </button>
            </div>

            <div className="modes">
              {MODES.map((m) => (
                <button key={m} className={mode === m ? "active" : ""} title={MODE_LABEL[m]} onClick={() => setMode(m)}>
                  <span className="ic">{MODE_ICON[m]}</span>
                  {sel && mode === m ? <span className="t">{formatDuration(selTime)}</span> : null}
                </button>
              ))}
            </div>

            <div className="seg">
              <button className={metric === "time" ? "active" : ""} onClick={() => setMetric("time")}>
                Fastest
              </button>
              <button className={metric === "distance" ? "active" : ""} onClick={() => setMetric("distance")}>
                Shortest
              </button>
            </div>

            {routes.length > 0 ? (
              <div className="summary">
                <div className="alts">
                  {routes.map((r, i) => {
                    const t = trafficOn && r.trafficTimeS != null ? r.trafficTimeS : r.timeS;
                    return (
                      <button key={i} className={`alt ${i === selected ? "active" : ""}`} onClick={() => setSelected(i)}>
                        <span className="alt-time">{formatDuration(t)}</span>
                        <span className="alt-meta">
                          {formatKm(r.distanceM)}
                          {i === 0 ? " · best" : ""}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="eta">Arrive around {arrivalTime(selTime)}{trafficOn ? " (with traffic)" : ""}</div>
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
            {dataset.source === "osm"
              ? `${dataset.meta?.nodeCount.toLocaleString()} junctions · ${dataset.meta?.edgeCount.toLocaleString()} road segments · OpenStreetMap`
              : `${dataset.graph.nodeCount} places · ${dataset.graph.roadCount} segments · seed data`}
            {" · right-click for directions"}
          </p>
        </aside>
      ) : null}
    </div>
  );
}
