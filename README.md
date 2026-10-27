# GhMap

A map of Ghana. The idea is simple: build something like Google Maps but focused
only on Ghana, and actually understand how it works underneath instead of just
calling someone else's API for the hard parts.

So the routing, the search, the GPS positioning math... all of that is written
by hand in this repo. It covers the whole country, from Accra down to the coast
and all the way up to Bolgatanga and Wa.

Right now the engine is done and tested, and there's a working web map on top of
it. Mobile is next.

## What it does so far

* Finds the best route between any two places, either fastest or shortest
* Drive, cycle, or walk, with travel times that change to match
* Gives you turn by turn directions for the route
* Search box with live suggestions as you type
* Right click anywhere for directions from or to that spot
* Finds your own location and routes from there
* Shares the current route as a link you can send to someone
* Simulates a full GPS satellite constellation and works out your position from
  the signals, the same way a real GPS chip does
* Shows everything on an interactive map with a satellite imagery view

## How it's put together

It's a TypeScript monorepo so the web app and the future mobile app can share the
same engine.

```
ghmap/
  packages/
    core/        the engine, no UI, runs anywhere
      src/
        geo.ts            distance and coordinate math
        priority-queue.ts a binary heap, written from scratch
        graph.ts          the road network
        routing.ts        Dijkstra and A*
        spatial-index.ts  grid for fast "nearest place" lookups
        satellite.ts      the GPS constellation and position solver
        data/ghana.ts     cities and highways across all 16 regions
  apps/
    web/         the React + MapLibre map
    mobile/      coming soon
```

## The interesting bits

**Routing.** There are two shortest path algorithms in here, Dijkstra and A*.
They always agree on the answer, but A* is smarter about it because it uses the
straight line distance to the goal as a hint, so it checks far fewer places
before it finds the route. You can optimise for travel time or raw distance.

**The satellites.** This is the part I'm most happy with. There are 24 satellites
orbiting in the model, just like the real GPS constellation. A receiver on the
ground measures how long each signal takes to arrive, and then a least squares
solver works backwards from those measurements to figure out the latitude,
longitude, and even the error in the receiver's own clock. In testing it pins
down a location in Kumasi to within about 5 metres.

**The data.** Ghana's main cities and highways are built in by hand to start
with, with real coordinates. The plan is to pull in full road detail from
OpenStreetMap on top of that so it eventually knows every street.

## Running it

You need Node 22 or newer.

```bash
npm install      # grab dependencies
npm run demo     # see the whole engine run in your terminal
npm test         # run the tests
npm run web      # start the map at http://localhost:5173
```

## Using the engine in code

```ts
import { buildGhanaGraph, aStar, simulateFix, buildConstellation } from "@ghmap/core";

const graph = buildGhanaGraph();
const route = aStar(graph, "accra", "tamale", "time");
console.log(route?.distanceM, route?.timeS, route?.path);

const fix = simulateFix(buildConstellation(), { lat: 5.6037, lng: -0.187 }, 0);
console.log(fix.fix?.position);
```

## What's next

* Pull in OpenStreetMap so every road in Ghana is covered
* A mobile app that reuses the same engine
* Live traffic, saved places, and alternative routes

## Contributing

If you know Ghana's roads better than the data does (very likely), corrections
are welcome. Open an issue or a pull request.

## License

MIT. See the LICENSE file.
