# 🇬🇭 GhMap

**An open-source map of Ghana** — routing, spatial search, and a *simulated GPS
satellite positioning engine* — built from the data structures up.

GhMap is a Google-Maps-style map dedicated entirely to Ghana. The goal: cover
every route and location in the country, with the core algorithms
(graphs, shortest-path, spatial indexing, GPS trilateration) implemented by hand
so the whole thing is understandable end to end.

> Status: **early development.** The engine (`@ghmap/core`) is working and
> tested. Web and mobile apps are being built on top of it.

---

## What's inside

GhMap is a TypeScript monorepo so the web and mobile apps share one engine.

```
ghmap/
├── packages/
│   └── core/          @ghmap/core — the platform-agnostic engine
│       └── src/
│           ├── geo.ts            lat/lng math: haversine, bearings, ECEF
│           ├── priority-queue.ts hand-written binary min-heap
│           ├── graph.ts          the road network as a weighted graph
│           ├── routing.ts        Dijkstra + A* shortest paths
│           ├── spatial-index.ts  uniform grid for nearest-place queries
│           ├── satellite.ts      GPS constellation + trilateration solver
│           └── data/ghana.ts     seed cities & highways (all 16 regions)
├── apps/
│   ├── web/           React + MapLibre GL map (in progress)
│   └── mobile/        Expo / React Native app (planned)
```

## The four pillars

1. **Data structures, by hand.** A weighted directed graph for the road
   network, a binary min-heap priority queue, and a uniform spatial grid — no
   routing library doing the clever part for us.
2. **Routing.** `dijkstra()` and `aStar()` both find optimal paths; A* uses a
   straight-line (haversine) heuristic to explore far fewer nodes for the same
   answer. Cost can be minimised by **distance** or **travel time**.
3. **Hybrid map data.** A hand-built seed layer of Ghana's cities and primary
   highways ships today; a later importer merges detailed OpenStreetMap geometry
   on top.
4. **Simulated satellites that actually work.** A Walker constellation of 24 GPS
   satellites orbits in the model; a receiver "measures" pseudoranges, and an
   iterated least-squares (Gauss–Newton) solver recovers its latitude, longitude
   and clock bias — real GPS math, recovering position to within metres.

## Quick start

Requires Node 22+ (for native TypeScript execution).

```bash
npm install          # install workspace dependencies
npm run demo         # tour the whole engine in your terminal
npm test             # run the core test suite
npm run build        # type-check and compile @ghmap/core
```

### Sample `npm run demo` output

```
Network: 43 places, 100 directed road segments

--- Route: Accra → Bolgatanga ---
  A* by time: 804.0 km, 8h 56m via Accra → Nsawam → Nkawkaw → Kumasi → …
  Optimality check: Dijkstra 8h 56m (explored 35) vs A* 8h 56m (explored 29)

--- Simulated GPS fix ---
  Constellation: 24 satellites in 6 orbital planes
  Satellites visible: 9
  Solved position: (6.68862, -1.62440)
  Position error: 4.5 m | GDOP 1.75 | clock bias est 75.0 km
```

## Using the engine

```ts
import { buildGhanaGraph, aStar, simulateFix, buildConstellation } from "@ghmap/core";

const graph = buildGhanaGraph();
const route = aStar(graph, "accra", "tamale", "time");
console.log(route?.distanceM, route?.timeS, route?.path);

const fix = simulateFix(buildConstellation(), { lat: 5.6037, lng: -0.187 }, 0);
console.log(fix.fix?.position); // recovered lat/lng of Accra
```

## Roadmap

- [x] Core engine: graph, routing, spatial index, satellite sim
- [ ] Web app: interactive MapLibre map with route + GPS overlays
- [ ] OpenStreetMap importer for full road geometry
- [ ] Mobile app (Expo) sharing `@ghmap/core`
- [ ] Turn-by-turn directions and place search UI

## Contributing

Issues and pull requests are welcome — especially corrections to Ghana's road
network and place data. This is a learning-forward project; clarity of the
algorithms matters as much as raw coverage.

## License

[MIT](./LICENSE)
