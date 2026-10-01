# GLOBE: atc's AIRCRAFT over a 3D globe, and a SPACE theme

Status (2026-10-01): design draft from the idea [#280](https://github.com/chaehy5665/atc/issues/280). Nothing is built. The SUPERVISOR decided the route model, the tab, the priority and the split between atc and the Mac app on 2026-10-01 (section 9). Work orders follow section 7 (G1–G8): parent [ATC-253](https://linear.app/vocado/issue/ATC-253), G1 [ATC-254](https://linear.app/vocado/issue/ATC-254), G2 [ATC-260](https://linear.app/vocado/issue/ATC-260), G3 [ATC-263](https://linear.app/vocado/issue/ATC-263), G4 [ATC-261](https://linear.app/vocado/issue/ATC-261), G5 [ATC-262](https://linear.app/vocado/issue/ATC-262), G6 [ATC-264](https://linear.app/vocado/issue/ATC-264), G7 [ATC-268](https://linear.app/vocado/issue/ATC-268), G8 [ATC-269](https://linear.app/vocado/issue/ATC-269), G9 [ATC-302](https://linear.app/vocado/issue/ATC-302) (world tour, 3.2). Related RADIO step: [ATC-267](https://linear.app/vocado/issue/ATC-267) (PREFLIGHT frequency). All are in Backlog until the SUPERVISOR releases G1.

**LANDING tier of G1–G4: `auto`.** GLOBE is a read-only screen, a pure module and one read-only route (`GET /api/globe`). It adds no route that writes, no state file and no package (section 2, principle 4). G5 and G6 are in the atc-app repository, where the SUPERVISOR merges every PR.

Related: [dispatch.md](dispatch.md) ("FLIGHT FOLLOWING: milestones as built", "STRIPS progress bar as built"), [fleet.md](fleet.md) (base AIRPORT, OUTSTATION, REPOSITION 8.6), [ui-visibility.md](ui-visibility.md), [mac-app.md](mac-app.md), atc-app `docs/design.md` (10.6 N8).

## 1. Current facts

Verified in the code on `origin/main` (2026-10-01).

- **Tabs.** `web/src/App.tsx` keeps RADAR in the main bundle and loads every other tab with `lazyTab` (`web/src/lazyTab.tsx`), so a tab's code, CSS and data load only when it is first opened. A tab reads `#<id>` and may read a sub-path (`#docs/requesting`).
- **RADAR** (`web/src/views/Map.tsx`) is a three-column graph: AIRCRAFT ─ STAND ─ FLIGHT. It folds ARRIVED STANDs by default (Dark cockpit, ATC-111). AIRCRAFT status is `aircraftStatus` in `web/src/aviation.ts`: `airborne` (busy), `holding` (idle with a STAND), `parked` (idle, no STAND), `nordo` (dead).
- **Snapshot** (`server/model.ts`, `GET /api/snapshot` and SSE): `sessions` (with `repo`), `workspaces` (with `ticketKey`), `claims` (AIRCRAFT ↔ STAND), `tickets`, `airports` (`id` is the first commit hash and stays the same when the folder moves, `code` is four letters), `clearances` (`HOLD`, `GO AROUND`, `LAND` … with `flight`, `readbackAt`, `cancelledAt`), `pulls` (`ticketKey`, `landing` CLEARED/APPROACH, `blocks`), `alerts`. `web/src/derive.ts` builds the index, including `awayBySession` (AIRPORTs an AIRCRAFT is working at as an OUTSTATION).
- **OOOI and progress.** `GET /api/milestones` returns per FLIGHT the milestones OUT (DEPARTED), OFF (PR opened), ON (merged), IN (RTS put it in service), `reverted`, and a `FlightProgress` from `server/progress.ts`: the current segment (`work`, `landing`, `rts`, `done`), elapsed minutes, the typical p25–p75 range of similar FLIGHTs, `late` past p75, and a `marker` in 0..1. `server/progress.ts` is pure and browser-safe and was written so GLOBE could reuse it (its header comment says so). `web/src/useMilestones.ts` refetches it once per snapshot minute.
- **Base AIRPORT.** Each AIRCRAFT in `fleet.json` has a `base` AIRPORT (`GET /api/fleet`). DISPATCH pairs an AIRCRAFT only with FLIGHTs of its base ([fleet.md](fleet.md) 8.6), so almost every FLIGHT starts and lands at the same AIRPORT. Only OUTSTATION work and REPOSITION (`GET /api/fleet/plan`, kind `REPOSITION` with `from` and `airport`, ATC-179) move an AIRCRAFT between AIRPORTs.
- **Drawing conventions.** Views draw inline SVG and take colours only from the `:root` tokens in `web/src/styles.css` (themes `radar`, `cockpit`, `night` (Night Sky) …). `settings.motion` (default off under `prefers-reduced-motion`) turns animation off. `web/src/Starfield.tsx` caps an always-on canvas at 30 fps and stops when the tab is hidden.
- **No map library and no geographic data** in the repository. `package.json` has no d3, three.js or topojson.
- **Browser storage.** The settings (`web/src/settings.ts`) and alert state already live in `localStorage`, read and written inside `try`/`catch`.
- **The Mac app (ATCA, atc-app repository).** ANNUNCIATOR targets macOS 14 with no dependencies. Its atc window (N7) hosts the whole web UI in a WKWebView, so the web GLOBE tab shows there too. Native screens are N8: design only, picked by the SUPERVISOR after using N7, and only for screens that need the OS or must stay visible while the SUPERVISOR works elsewhere (atc-app `docs/design.md` 10.6). Team sessions build only the Linux `ATCCore` package; the app target is built in CI and on the SUPERVISOR's Mac, and only the SUPERVISOR sees its screens. MapKit on macOS 14 has a satellite map style with realistic elevation, which shows the Earth as a globe when zoomed out (to be confirmed on the Mac in G5).

## 2. Principles

1. **Read-only, like RADAR and NETWORK.** GLOBE shows what atc already knows. It sends nothing to sessions and changes no state. The only server addition is one read-only route, `GET /api/globe` (3.8), computed from data atc already has.
2. **Facts from the milestones, estimates only inside the current segment.** A plane's place on its route is the STRIPS progress model (`server/progress.ts`), not a new guess. No percentage, no ETA. Where the model has no estimate, the plane stops at the start of the segment, as the bar's marker does.
3. **The location stays on the client.** The SUPERVISOR's location and any AIRPORT positions they pick live only in the browser's `localStorage` (or, for G5, in the Mac app). They are never sent to the server, written to state files, or put into PRs, issues, logs or screenshots (the repository is public). The scene route works in coordinates relative to the hub, so it never needs the location. Without a location, GLOBE uses a default (section 3.6).
4. **No new package and no external request.** The projection, great circles and the day/night terminator are a few pure functions. Coastlines are Natural Earth 1:110m land (public domain), simplified and shipped inside the GLOBE chunk. No tile server, no geocoder, no CDN. Adding a package would make the PR `user` tier (`package*.json`) and is not needed for an orthographic globe.
5. **The server computes the scene, clients draw it.** A pure function on the server turns the snapshot into a **scene**: places (AIRPORTs relative to the hub), and for each FLIGHT a route, a state and a position `t` along it. `GET /api/globe` serves it (3.8). The web globe, the SPACE theme and the ATCA window are renderers of the same scene, so they cannot disagree (the Mac app's principle "the server decides, clients show"). Calculation is tested with `node:test`; drawing is not.
6. **Stable from snapshot to snapshot.** AIRPORT places and route bearings come from hashes of stable ids (AIRPORT `id`, FLIGHT key), so planes do not jump when another FLIGHT appears.
7. **Quiet when nothing is flying.** Parked AIRCRAFT are small marks at their AIRPORT. ARRIVED FLIGHTs fade out like the Dark cockpit rule on RADAR. Theme tokens only, `settings.motion` respected, 30 fps cap, stop when hidden.
8. **A text equivalent.** The same scene is listed as rows next to the globe (callsign, FLIGHT, state, AIRPORT), for screen readers and narrow screens.

## 3. The globe

### 3.1 Places

- **Hub.** The SUPERVISOR's location (3.6). The **home AIRPORT** sits on it. Default home AIRPORT: the one where most live sessions are (`Session.repo`). The SUPERVISOR can pick another in the GLOBE toolbar (saved in `localStorage`).
- **Other AIRPORTs** sit around the hub at a bearing and a distance from a stable hash of the AIRPORT `id` (distance 12°–30° of arc, bearing anywhere). A pure layout nudges AIRPORTs that land closer than a minimum separation (order by `id`, so the nudge is stable). The SUPERVISOR may drag an AIRPORT to another place; the override is saved in `localStorage` by AIRPORT `id`. Closed and missing AIRPORTs are not drawn.
- Each AIRPORT is drawn as a small aerodrome symbol with its four-letter code, and a short runway whose heading also comes from the hash.

### 3.2 A FLIGHT is a trip from its AIRPORT to a real airport (world tour, G9)

Decided 2026-10-01 (section 9). This replaces the first model, in which a FLIGHT flew a circuit from its AIRPORT and back. G2 built that circuit ("G2 as built"), and it stays on screen until G9 ([ATC-302](https://linear.app/vocado/issue/ATC-302)) lands. The new model:

- **A FLIGHT departs its own AIRPORT** (where its code lives) **and flies to a real airport somewhere in the world.** It lands and fades out there. The next FLIGHT of the same AIRCRAFT departs from its AIRPORT again; AIRCRAFT do not continue from their last destination.
- **The distance stands for the typical duration** of similar FLIGHTs. It is not an arrival time, and the tooltip says so. The duration is `p75(work) + p75(landing)` from `typicalDurations` (`server/progress.ts`, TYPE×WAKE → WAKE → AIRPORT), which is the same model that gives the plane its place (principle 2). The server turns it into a `range` band. The bands keep the range stable while samples come and go:

  | Typical duration (p75 work + p75 landing) | `range` |
  |---|---|
  | under 30 min | 15° |
  | 30 min – 1 h | 25° |
  | 1 – 2 h | 35° |
  | 2 – 4 h | 45° |
  | 4 – 8 h | 55° |
  | 8 h or more | 65° |
  | no samples | 25°, `rangeKnown: false` |

  Token estimates (TRIP FUEL) were considered and not chosen. They are on a different scale from the plane's place, so the two could disagree.
- **The destination is chosen on the client** (principle 3: the server never sees a location). A pure, browser-safe step in `server/globe.ts`, called after `placeOnLand`, works on the same bundled airport list (`globe-geo.ts`):
  1. Take the airports at `range` ± 5° from the origin AIRPORT's placed point.
  2. Leave out the airports the AIRPORTs occupy (and anything within 3° of them) and the destinations already pinned by other drawn FLIGHTs.
  3. Prefer airports within 85° of the hub, so a trip stays on the visible side when the globe is centred on the hub.
  4. Pick the one whose bearing from the origin is closest to the FLIGHT's `outbound`.
  5. If none is left, widen to ± 10°, then ± 15°. If still none, use the great-circle point at `outbound` and `range` (it may be at sea).
- **Pinned for the whole FLIGHT.** The chosen destination is saved in `localStorage` (`atc.globe` → `dest[key]`, inside `try`/`catch`) and reused until the FLIGHT leaves the scene, when it is pruned. A destination never moves during a FLIGHT, even when the band changes or other FLIGHTs come and go. With storage unavailable, the step is still deterministic for the same inputs.
- **Track.** The great circle from the origin to the destination (`slerp`), with the **approach fix** at 85 % of the track. Cruise runs from the origin to the approach fix, final from the approach fix to the destination. The outbound bearing still comes from the hash of the FLIGHT key, nudged as in G2, so it sets the direction of travel.
- Real moves between AIRPORTs (OUTSTATION, REPOSITION) keep their own great-circle arcs (3.4). SPACE (section 5) and the AIRPORT view (3.9) keep their own drawings; this section is about the globe.

### 3.3 From facts to the picture

The FLIGHT's AIRCRAFT is the one holding a STAND whose `ticketKey` is the FLIGHT (claims). A STAND-free FLIGHT flies without a callsign unless an existing read route already names its AIRCRAFT (G2 checks; it adds no route for this).

| Fact | Source | Drawn as |
|---|---|---|
| FLIGHT has a STAND but no OUT | milestones | At the gate, nose out ("boarding") |
| `work` segment (OUT→OFF), AIRCRAFT `airborne` | progress | Flying the track (3.2). Position along origin → approach fix is the marker inside `work` (elapsed / p75, capped short of the approach fix). No estimate: at the origin |
| `late` in `work` | progress | Stops short of the approach fix and the label turns amber. No holding pattern (holding means waiting, below) |
| AIRCRAFT `holding` (idle with the STAND), or an open `HOLD` CLEARANCE for the FLIGHT | snapshot | Holding pattern (racetrack) at its current point |
| AIRCRAFT `nordo` | snapshot | Grey, no animation, label `NORDO` |
| `landing` segment (OFF→ON), PR `CLEARED` | progress, `pulls` | On final from the approach fix to the destination; position from the `landing` marker |
| `landing` segment, PR `APPROACH` (blocked) | `pulls[].blocks` | Holding at the approach fix. Block codes (CI, review, behind …) in the tooltip and the text row |
| `GO AROUND` CLEARANCE for the FLIGHT in the last 30 min, or a `landing.conflict` event | `clearances` | One missed-approach loop at the destination back to the approach fix, mark `GA` until the new head is CLEARED |
| ON (merged) | milestones | Touchdown at the destination. In `rts` (ON→IN, MCC AIRPORT only) it taxis to the gate there |
| IN, or ON where no RTS follows (`done`) | milestones | At the destination gate, fades out over 30 min. `reverted` adds a mark |
| AIRCRAFT without a FLIGHT | snapshot, `fleet` | Small parked mark at its base AIRPORT (count when several) |

A click on a plane opens the FLIGHT drawer (`#flight/<KEY>`, as `OpenFlight` in `web/src/FlightLink.tsx` does). The tooltip carries the AIRCRAFT's callsign, status and STAND, as RADAR's blocks do. From G9 it also names the destination (IATA code) and says that the distance stands for the typical duration of similar FLIGHTs, not an arrival time; the FLIGHTS list gets a `DEST` column. A plane without a FLIGHT key in the drawer format is not a link.

### 3.4 Moves between AIRPORTs (great circles)

- **OUTSTATION.** An AIRCRAFT working at another AIRPORT (`awayBySession`) is drawn at that AIRPORT, with a dashed great-circle track from its base.
- **REPOSITION.** An approved REPOSITION card that has not finished is a ferry flight on the great circle from `from` to `airport`. A finished one leaves a fading track for 2 hours. Data: `GET /api/fleet/plan` (read-only).
- Arcs are sampled by spherical interpolation (slerp) of unit vectors and drawn with a small altitude bulge so they read as flights, not as the ground track.

### 3.5 Time

- The **day/night terminator** comes from the subsolar point for `now` (solar declination and the equation of time, a pure function). The night hemisphere is a shaded cap; the SUPERVISOR's local night shows on the hub.
- Positions are recomputed from `now` once a second (planes move on a scale of minutes). Holding patterns and the go-around loop animate with SVG/CSS when `settings.motion` is on, and are a still frame when it is off.

### 3.6 Location

- **Default, no permission:** longitude from the browser's UTC offset (`-getTimezoneOffset() / 4` degrees), latitude 0. This is coarse on purpose.
- **Use my location:** the Geolocation API, rounded to 1° before it is saved (enough for a globe; less precise if a screen is ever shared).
- **Type it:** latitude and longitude fields. There is no city search, because it would need a geocoder (an external request).
- Saved in `localStorage` (`atc.globe`), read and written inside `try`/`catch`. A "forget location" button clears it. The server never sees it.

### 3.7 Interaction

Drag to rotate, wheel or pinch to zoom (clamped), a "home" button to centre on the hub. Hover or focus shows the tooltip; Tab moves through planes in the text-row order.

### 3.8 The scene route: `GET /api/globe`

Read-only, no `Origin` check needed (it writes nothing). G1 builds it with `airports[]` and `parked[]`; G2 adds `flights[]`, G3 `moves[]`. Query `?home=<AIRPORT code>` picks the home AIRPORT; without it the server uses the default in 3.1. It reads only what the snapshot, the milestones/progress and `fleet.json` already hold; it calls no GitHub or Linear beyond them.

- `at`, `home`.
- `airports[]`: `id`, `code`, `name`, and `bearing`/`distance` (degrees of arc) from the hub. The home AIRPORT has distance 0. Each client places them from its own hub location; manual overrides stay on the client.
- `flights[]`: `key`, `airport`, `aircraft` (REGISTRATION or `null`), `state` (one row of 3.3: `boarding`, `cruise`, `hold`, `final`, `goAround`, `taxi`, `arrived`, `nordo`), `t` in 0..1 along the leg of that state, `outbound` bearing, `late`, `blocks` (landing block codes) and `fadeFrom` (ISO, for `arrived`). G9 adds `range` (degrees of arc, the band of 3.2) and `rangeKnown` (`false` when there were no samples). The destination itself is not in the scene: it depends on the location, so each client chooses it (3.2).
- `parked[]`: REGISTRATION and base AIRPORT for AIRCRAFT without a FLIGHT.
- `moves[]` (G3): `kind` (`outstation`, `reposition`), `aircraft`, `from`, `to`, `t`, `endedAt`.

Clients refetch once per snapshot minute (like `useMilestones`) and animate in between. The scene is a few kilobytes, so the Mac app can read it as cheaply as the web.

### 3.9 Radio on the globe and the AIRPORT view (G7)

The interaction with the control sessions during departure and landing is already recorded and merged by RADIO ([radio.md](radio.md), `GET /api/radio`, the `radio` SSE topic): each transmission has `freq`, `from`, `to`, `aircraft`, `flight`, `airport`, `kind`, `head`, and for calls `open`/`overdueAt`. GLOBE draws it; it adds no data.

| Phase | atc event | Frequency | Station |
|---|---|---|---|
| Check before departure | CROSSCHECK mark, PREFLIGHT HOLD | PREFLIGHT ([ATC-267](https://linear.app/vocado/issue/ATC-267), not built yet) | CROSSCHECK |
| At the gate, departure | FLIGHT PLAN → READBACK (OUT) | DELIVERY | OCC |
| En route | HOLD, INFO, TRAFFIC CLEARANCEs | TOWER | TOWER |
| Approach | LAND, GO AROUND → READBACK/UNABLE | TOWER | TOWER |
| Runway | MCC INSPECTION → LAND (merge = ON) | GROUND | MCC |
| Taxi in | RTS started → ok (IN), ROLLBACK | GROUND | MCC |
| Arrival report | ARRIVED | COMPANY | OCC |

- **On the globe:** transmissions of the last 2 minutes are short radio pulses between the AIRPORT and the plane. An open call blinks until its reply and turns amber past `overdueAt`.
- **AIRPORT view** (`#globe/<CODE>`, click an AIRPORT): STANDs as gates on an apron, a taxiway and a runway; OCC, TOWER and MCC (and CROSSCHECK once PREFLIGHT exists) as facilities; planes placed by their scene state; each recent transmission as a line from facility to plane with its `head`. `body` shows only on click; voice stays template-only (RADIO principle 3). A short list links to the RADIO tab filtered to that AIRPORT.
- Interactions RADIO does not carry are not drawn. They join RADIO first (as PREFLIGHT does in ATC-267), so the RADIO tab and GLOBE always agree. Unknown frequencies map to a generic station instead of failing.

### G1 as built (ATC-254)

- **Pure module** `server/globe.ts` (browser-safe, tested in `server/globe.test.ts`): `project`/`unproject` (orthographic, unit disc), `clipPolyline` and `clipRing` (cut at the horizon; a ring that crosses the horizon several times is closed along the limb counter-clockwise, each exit joined to the next entry counter-clockwise, so a continent crossing the edge several times still fills correctly), `slerp`, `destination`, `bearingDeg`, `distanceDeg`, `subsolarPoint` (right ascension minus sidereal time, so the equation of time is inside; about 0.05°), `nightRing`, `layoutAirports` and `placeAirports`, `defaultHome` and `globeSceneOf`.
- **Layout.** `layoutAirports(ids, homeId)` works with the hub at (0°, 0°) and returns `bearing`, `distance` and a `runway` heading per AIRPORT `id`. Bearing is from `hash32(id#brg)` (FNV-1a), distance 12°–30° from `hash32(id#dst)`. AIRPORTs are placed in `id` order and a new one that lands within 9° of an earlier one is turned by 47° (up to 8 times per lap) and then pushed 2.5° further out (up to 4 laps, 40° at most). Adding an `id` that sorts last never moves the others. `placeAirports(hub, places, overrides)` is the client step: hub position plus bearing and distance, with a dragged place winning.
- **Route** `GET /api/globe[?home=<code>]` (`server/globe-api.ts`): `at`, `home`, `airports[]` (`id`, `code`, `name`, `bearing`, `distance`, `runway`) and `parked[]` (`registration`, `callsign`, `airport`). It reads the snapshot and `fleet.json` only (via `fleetView`). It takes no location and writes nothing. `callsign` comes with the row so the GLOBE chunk does not pull the callsign rules into the main bundle. A `home` that is not an open AIRPORT code falls back to the default.
- **Parked** are the AIRCRAFT of `fleet.json` that are not retired, hold no STAND (and keep no FLIGHT), and whose `base` is an open AIRPORT.
- **Land** is `web/src/views/globe-land.ts`: Natural Earth 1:110m land, outer rings, Douglas–Peucker 0.25°, rounded to 0.1°, stored as integers ×10 and reversed to counter-clockwise (the source is clockwise). 113 rings, 2522 points, about 10 KB gzipped.
- **View** `web/src/views/Globe.tsx` (own lazy chunk, own CSS). Everything the SUPERVISOR sets lives in `localStorage` key `atc.globe` (`loc`, `home`, `overrides`, `view`), read and written inside `try`/`catch`; geolocation is rounded to 1° before saving. The night cap is recomputed every 10 s while the tab is visible. Colours are `:root` tokens only.
- Not in G1: FLIGHTs (G2), moves (G3), SPACE (G4).

### G2 as built (ATC-260)

- **Scene.** `flightsOf(input, airports)` (pure, in `server/globe.ts`, tested in `server/globe-flights.test.ts`) is called by the one `globeSceneOf`, and `GET /api/globe` gains `flights[]`. The route reads the same sources as `GET /api/milestones` (`milestonesNow`, `progressNow`) plus the snapshot and `fleet.json` (through `fleetView`); no second route and no new external call. A scene is about 350 bytes per FLIGHT.
- **Row** (`GlobeFlight`): `key`, `airport` (code), `aircraft` and `callsign` (`null` without a STAND), `state`, `t`, `outbound`, `late`, `blocks`, `fadeFrom`, `reverted`. FLIGHTs whose AIRPORT cannot be found (no STAND workspace and no open PR in an open AIRPORT) are left out. FLIGHTs of a closed ticket are drawn only while they fade out.
- **State rules**, in this order: `done` segment → `arrived` for 30 min after IN (ON where no RTS follows), then gone; no progress (no OUT) with a STAND → `boarding`; AIRCRAFT dead → `nordo` (at its stopped place); `rts` → `taxi`; `landing`: GO AROUND → `goAround`, blocked PR or an open HOLD → `hold` at the IAF (`t = 1`, `blocks` filled), else `final`; `work`: AIRCRAFT idle with the STAND or an open HOLD → `hold` at the current place, else `cruise`.
- **Open HOLD**: the latest non-cancelled `HOLD` CLEARANCE for the FLIGHT with no later `CONTINUE` or `LAND`. **GO AROUND**: the PR is not CLEARED and either has a `dirty`/`behind` block (the state `landing.conflict` reports; the event log itself is in memory and is not read here) or a non-cancelled `GO AROUND` CLEARANCE is younger than 30 min.
- **`t` (principle 2).** Taken only from `FlightProgress.marker` (`marker * 4 - segment index`), which is elapsed / p75 inside the segment, capped at `CRUISE_CAP` (0.9) for `cruise` and `final`, so a plane never reaches the IAF or the runway by estimate; the milestones say when it does. No sample, no marker fraction → `t = 0`. `goAround` and `taxi` have no estimate either, so `t = 0`.
- **Outbound** bearings: `hash32(key#out) % 360`, FLIGHTs of one AIRPORT in key order, a new one closer than 25° to an earlier one is turned by 37° (12 tries). A later key never moves an earlier one.
- **Parked** now means: not retired, base is an open AIRPORT, and no drawn FLIGHT. An AIRCRAFT that holds a STAND after its FLIGHT faded is parked again.
- **Shape** (`circuitOf`, `pointAlong`, `racetrack`, `circuitSize` in `server/globe.ts`): size = 0.35 × distance to the nearest other AIRPORT, clamped to 2°–7°. Cruise path: AIRPORT → turn point (`outbound`, size) → IAF (behind the runway start on the runway axis, 0.55 × size). Final: IAF → AIRPORT. Taxi: runway end → gate (0.6° beside the runway). Missed approach: from 80 % of final over the runway end, a turn, back to the IAF. Holding racetrack: right-hand, 0.55 × size long, 0.25 × size wide.
- **View** (`web/src/views/GlobeFlights.tsx`): planes rotated to the screen heading, `--radar` en route/final/taxi, `--amber` hold, go-around and late, `--faint` boarding/arrived/NORDO (NORDO has an `--alert` outline); a plane is a link to `#flight/<KEY>` and has a `<title>` tooltip; the holding racetrack and the go-around loop move with SVG `animateMotion` only while `settings.motion` is on; an arrived plane's opacity fades with `fadeFrom`. A FLIGHTS list beside the AIRPORTS list repeats callsign, FLIGHT, AIRPORT, state, blocks.
- Not in G2: OUTSTATION and REPOSITION arcs (G3), SPACE (G4).

### Land placement as built (ATC-291)

- **Why.** G1 put the default location at latitude 0 (the Pacific for UTC+9) and placed AIRPORTs at hashed bearings, so most points were at sea (SUPERVISOR, 2026-10-01).
- **Default location** (`defaultLoc` in `web/src/views/Globe.tsx`): the principal city of `Intl.DateTimeFormat().resolvedOptions().timeZone`, through `tzCity(tz, TZ_CITY)` (pure, `server/globe.ts`). `TZ_CITY` is generated from the IANA `zone1970.tab` (principal city coordinates) plus the links in `tzdata.zi` (aliases such as `Asia/Calcutta`), rounded to 0.1°; `Asia/Seoul` gives 37.6°N 127.0°E. A name that is not in the table (`Etc/*`, unknown) falls back to the old UTC-offset rule. Geolocation and typed coordinates still win; nothing is sent to the server.
- **AIRPORT places** (`placeOnLand`, pure, `server/globe.ts`): the scene stays hub-relative and location-free. After `layoutAirports`, the client takes the real airports whose distance from the hub is within 12° to 30° (widened to 35°, 40°, 45° if none), in AIRPORT `id` order, and picks the one whose bearing from the hub is closest to the AIRPORT's hashed bearing, skipping airports already used and preferring ones at least 3° from those already chosen. The home AIRPORT stays on the hub, a dragged override wins, and a hub with no airport within 45° (mid-ocean) keeps the hashed place. Adding an AIRPORT with a later `id` never moves the others. The tooltip shows the IATA code.
- **Data** (`web/src/views/globe-geo.ts`, inside the GLOBE chunk, about 14 KB gzipped): generated by `web/src/views/globe-geo.gen.mjs` (the refresh commands are in its header) from IANA `zone1970.tab` and `tzdata.zi` (public domain) and the OurAirports `large_airport` rows that have an IATA code (public domain; 1172 airports), coordinates rounded to 0.1°.
- **Circuits** (G2) may still cross the sea; only the AIRPORT points are on land. The ATCA app (G5, [ATC-262](https://linear.app/vocado/issue/ATC-262)) must use the same step and the same list so its places match.

### G7 as built (ATC-268)

- **Pure module** `server/globe-radio.ts` (browser-safe, tested in `server/globe-radio.test.ts`; next to the scene module): `stationOf` (DELIVERY and COMPANY → OCC, TOWER → TOWER, GROUND → MCC, PREFLIGHT → CROSSCHECK, any other frequency → a generic `RADIO` station), `callStateOf` (`open`, `overdue` past `overdueAt`, `answered` for replies and closed calls), `planeOf` (by `flight`, then by `aircraft`, preferring the transmission's AIRPORT), `pulsesOf` (the transmissions of a window, oldest first; an **open call stays until its reply** even past the window), `atAirport`, and the AIRPORT view layout (`assignGates`, `planeSpot`, `lineOf`, fixed 900 × 560 coordinates). Unknown frequencies, kinds and bad timestamps do not break it.
- **Data.** The existing `GET /api/radio` and the `radio` SSE topic, read the way the RADIO tab reads them (`useRadioFeed` in `web/src/views/GlobeRadio.tsx`, merged with `mergeTx`). No new route, no new state, no server change.
- **On the globe** (`RadioLayer`, a new group after the planes; the scene and `GlobeFlights.tsx` are unchanged): each transmission of the last 2 minutes, and every open call, is a dashed line between its AIRPORT and its plane with a travelling dot. An open call blinks (`--cyan`) until its reply, past `overdueAt` it is a solid `--amber` line, an answered one is `--radar`. The blink and the dot run only with `settings.motion` on (the CSS also stops with `data-motion="off"`); with motion off the line is still. A transmission with no plane gets a ring at its AIRPORT; one with no AIRPORT and no plane (MCC's GROUND broadcasts) is not drawn on the globe. The plane's place is computed with the same circuit rules as `FlightsLayer` (a small duplicate instead of changing that file, so G3 and G4 merge cleanly).
- **AIRPORT view** (`web/src/views/GlobeAirport.tsx`, `#globe/<CODE>`): opened by pressing an AIRPORT without dragging it (less than 5 px) or by the code link in the AIRPORTS list; `← GLOBE` returns. Gates are the AIRPORT's drawn FLIGHTs plus its parked AIRCRAFT, at least four, in key order (the scene carries no list of empty STANDs). One runway, a taxiway, an apron. Facilities: OCC, TOWER, MCC always; CROSSCHECK only when a PREFLIGHT transmission exists; a dashed `RADIO` box when a transmission has an unknown frequency. Planes by scene state: `boarding`, `arrived`, `nordo` at the gate (nose to the runway); `cruise` leaves along a line to the upper right edge by `t`; `hold` on a racetrack at the upper left (several share it evenly); `final` from the left edge towards the runway by `t` and never past the touchdown zone (arrival is the milestone's job); `goAround` on a climbing loop over the runway; `taxi` from the runway to the gate (the server's `t` is 0, so it starts on the runway). Each plane links to `#flight/<KEY>`.
- **Lines and text.** Transmissions of the last 10 minutes (open calls until their reply), at most 8 lines, from the facility to the plane, labelled with the **`head` only**; MCC's GROUND broadcasts (no AIRPORT, no plane, `to: ALL`) drop to the middle of the runway and only the newest carries a label. `body` appears only when a line or a list row is pressed, as in RADIO (voice stays template-only). Below the view, `RECENT TRANSMISSIONS` lists the AIRPORT's last 12 (broadcasts included) with `OPEN` or `LATE` words, and `RADIO에서 <CODE> 보기` stores the AIRPORT in `atc.radio.airport` (the RADIO tab's own filter key) and opens `#radio`.
- **Pilot's discretion.** (1) Open calls are kept past the window (the spec says they blink until the reply). (2) MCC's broadcasts have no AIRPORT, so they appear in every AIRPORT's list. (3) Gates come from the scene's FLIGHTs and parked AIRCRAFT. (4) CROSSCHECK is shown only when PREFLIGHT traffic exists, so a quiet AIRPORT stays quiet.
- Not in G7: the Mac app (G8), new interactions that RADIO does not carry.

## 4. Rendering

- **Orthographic projection in inline SVG.** Rotate unit vectors by the view's yaw and pitch, keep the front hemisphere, project to x/y. Clip land polygons and tracks at the horizon (split segments where they cross it). Sphere fill, graticule every 30°, land, night cap, then tracks and planes.
- **Land data.** Natural Earth 1:110m land, simplified (Douglas–Peucker) and coordinates rounded to 0.1°, as a JSON module inside the GLOBE chunk. Target: under 60 KB gzipped. The licence (public domain) and the source version are noted in the module header.
- **Planes** are one small SVG symbol rotated to the track heading, coloured by state with existing tokens (`--radar` airborne, `--amber` holding and late, `--alert` NORDO, `--faint` parked). The callsign label follows RADAR's short form.
- If the SVG becomes too slow with many land paths, a later step can draw land to a canvas under the SVG; the scene model does not change.

## 5. The SPACE theme

A toggle in the GLOBE toolbar (`GLOBE | SPACE`, saved in `localStorage`; the `night` (Night Sky) app theme opens in SPACE the first time). Same scene, different drawing:

- **Earth** is the home AIRPORT, at the centre. Other AIRPORTs are **planets** on circular orbits. Orbit radius by rank of their hashed distance, angle by hash, so they stay in the same place from day to day.
- **A FLIGHT is a launch, an orbit and a landing** around its own body: `work` is the orbit (position as in 3.3), `landing` with a blocked PR is a parking orbit, CLEARED is the descent, ON is the landing, `rts` and IN are back on the pad.
- **Moves between AIRPORTs** (OUTSTATION, REPOSITION) are **transfer orbits**: a half ellipse from one body's orbit to the other's.
- HOLD, NORDO, GO AROUND and the text rows work as on the globe. There is no day/night terminator; the background is a static starfield (not the animated `Starfield`, to keep one animation per screen).

### G4 as built (ATC-261)

- **Same scene, second renderer.** `GET /api/globe` and `server/globe.ts` are unchanged. The GLOBE toolbar has a `GLOBE | SPACE` toggle (a `segmented` radio group). The choice is saved in `atc.globe` as `mode`; with nothing saved the `night` (Night Sky) app theme opens in SPACE and every other theme in GLOBE (`modeOf`). SPACE replaces the globe drawing only: the AIRPORTS and FLIGHTS lists beside it, the HOME select and the data are the same. The globe-only controls (location fields, "home", "reset AIRPORT places") and the location note are hidden in SPACE.
- **Pure module** `server/space.ts` (browser-safe, tested in `server/space.test.ts`): `layoutBodies`, `polarOf`, `headingOf`, `missedLoop`, `parkLoop`, `routeOf`, `pointOf`, `starsOf`, `modeOf`. **View** `web/src/views/GlobeSpace.tsx` (+ `GlobeSpace.css`, inside the GLOBE chunk). `GlobeFlights.tsx` now exports the helpers both views share (`toneOf`, `flightTip`, `flightMarks`, `flightNumber`, `fadeOf`), so state label, tone, tooltip, link and fade are the same code in both views.
- **Bodies.** Earth is the home AIRPORT, at the centre (if the scene has no `home`, the AIRPORT with the smallest `distance`). The others are planets on circular orbits: orbit radius by the **rank** of the scene `distance` (ties by `id`), evenly spaced between 190 and 450 px of a 1000 px view; angle = scene `bearing` (0° up, clockwise). Both come from the scene, so a planet stays in the same place from day to day for the same set of AIRPORTs; adding or removing an AIRPORT can shift the ranks of the others.
- **FLIGHT around its own body** (`polarOf`, polar around the body: radius in body radii, angle 0° up clockwise; the pad is the surface at `outbound`): `boarding` and `arrived` stand on the pad, nose out; `cruise` is the launch and the orbit (radius rises to 2.3 over the first 20 % of `t`, then 300° of arc in `t`); `hold` is a **parking orbit** at 3.0 on the angle of its `t` (the plane circles it with motion on); `final` is the descent from the orbit to the pad over the remaining 60°, touchdown at `t = 1`; `goAround` is one climb-and-return loop from near the surface; `taxi` is on the pad; `nordo` is where it stopped on the orbit, grey with the NORDO outline. `t` is the scene's `t`; nothing is estimated in the browser.
- **Background.** A static starfield (90 stars from a fixed seed, `starsOf`), not the animated `Starfield.tsx`. The only repeating motion is the hold and go-around loops, and only with `settings.motion` on. No day/night terminator. Colours are `:root` tokens (`--scope`, `--text`, `--line`, `--cyan`, `--radar`, and the plane tones from G2).
- **Not in G4.** Transfer orbits for moves: `moves[]` (G3) is not in the scene on main yet, so SPACE draws no OUTSTATION or REPOSITION track. Add a half ellipse between the two bodies' orbits when it lands. Planets cannot be dragged or zoomed, and there is no AIRPORT view (G7).

**PILOT'S DISCRETION.**

- Orbit radii use the rank of `distance` (as the issue says) and are spaced evenly, so the ring gap does not show the real distance. The ring order does.
- A parked AIRCRAFT is the small plane mark beside its planet, as on the globe.
- The parking orbit is outside the flight orbit (3.0 against 2.3 body radii) so a holding plane and a flying plane at one body do not share a line.
- The choice of view is saved in the existing key `atc.globe`; a first visit in `night` opens SPACE, and once the SUPERVISOR picks a view (either one) it wins over the theme.

### SUPERVISOR landing mark as built (ATC-300)

- **Why.** Three FLIGHTs held at the IAF with the same `no-review` block looked the same on GLOBE, but only one waited for MCC; the others waited for the SUPERVISOR (`user` tier, ESCALATE). atc already knows who lands a PR (`landByOf`, used by TOWER, the SUPERVISOR queue and the alerts), so GLOBE shows that answer and has no rule of its own.
- **Scene (server).** `GlobeFlight` gains `landBy` (`mcc`, `supervisor`, `holder`, or `null`) and `landWhy` (`user`, `escalate`, `hold`, `mode`, `tier-unknown`, `teams-merge-off`, only for `supervisor`). They are set only for a FLIGHT in the `landing` segment with an open PR that is drawn as `hold`, `final` or `goAround`; otherwise both are `null` (also with no `land` callback or an input without a PR number and head). Both are optional for readers, so the Mac app (G5) can ignore them. `flightsOf` takes a `land(pull)` callback and does not know MCC.
- **One rule.** `server/land-by.ts` `landDecisionOf` returns `{ by, why }`; `landByOf` is its `by`, so the reason cannot drift from the decision (a test walks every mode, repository, `teamsMerge`, HOLD/ESCALATE and tier combination). Order of reasons: not the MCC AIRPORT → `teams-merge-off` (else `holder`); mode that does not land → `mode`; `hold` before `escalate`; no tier for this head → `tier-unknown`; `user` tier → `user`.
- **Route.** `GET /api/globe` passes `landDecisionOf(p, mccLandInfoCached(snapshot), teamsMerge)` (`server/globe-api.ts`): cached tiers only, no new GitHub or Linear call, no new state.
- **View.** `flightMarks` adds `SUP` for `landBy === "supervisor"` and `flightTip` adds `· SUPERVISOR 머지 대기 — <reason>` (`user 등급`, `MCC ESCALATE`, `SUPERVISOR HOLD`, …). The plane keeps its state colour. The SUPERVISOR treatment is a **`--cyan` ring around the plane** plus the **`SUP` text** (cyan, split from the amber `GA`/`LATE` marks through `splitMarks`, because a thing the SUPERVISOR must do does not borrow CAUTION's amber, design-language principle 2). The FLIGHTS list gets a `LAND BY` line: `MCC`, `SUPERVISOR · <reason>` or `TEAM`, in `--faint` except the SUPERVISOR one. GLOBE, SPACE and the AIRPORT view (G7) use the same helpers, so the ring, the mark and the tooltip appear in all three. Clicking a plane still opens `#flight/<KEY>`.
- **Pilot's discretion.** (1) A `final` FLIGHT whose PR is CLEARED but is `user` tier is marked too, because the SUPERVISOR has to press MERGE; (2) `goAround` carries `landBy`; (3) `cyan` for the ring and `SUP` (the design language gives it to "a state the SUPERVISOR set on purpose" and never to warnings).
- **Follow-up, not done here.** On an ESCALATED PR the `no-review` landing block text still says it waits for the MCC INSPECTION, which is misleading. That belongs to the landing blocks, not GLOBE.

## 6. The ATCA globe window (G5)

The web tab is built first because team sessions can build and check it. After G2 the Mac app gets a native **GLOBE window** as an N8 candidate (atc-app `docs/design.md` 10.6, "it must stay visible while the SUPERVISOR works elsewhere"):

- SwiftUI `Map` with the satellite style at realistic elevation, zoomed out to the globe. Real imagery and coastlines come from MapKit; the window draws AIRPORTs, FLIGHT tracks to their destinations (3.2, with the same destination step and airport list as the web, ported to `ATCCore`), planes and great-circle tracks as map annotations and polylines (`MKGeodesicPolyline` for arcs) from `GET /api/globe`. The day/night terminator is a polygon overlay computed in `ATCCore` (pure, tested on Linux).
- The location comes from CoreLocation on the Mac, or from the same typed coordinates, and stays in the app's own preferences (principle 3). The server never sees it.
- Read-only, like the rest of the app before N5. A click opens the FLIGHT in the atc window (N7).
- **Two modes.** `MAP` is the information view: the same states and text rows as the web tab. `CINEMATIC` is the animated, game-like view (6.1).
- The window is its own issue in the Linear project `atc-app`, merged by the SUPERVISOR after they check it on the Mac (nobody else can see it). The SPACE theme stays web-only unless the SUPERVISOR asks for it there.

### 6.1 CINEMATIC mode

The game-like view of the same scene. It is presentation only; it adds no data and no new meaning.

- **Camera.** A slow orbit of the globe when nothing is selected. Selecting a plane (or the "tour" button, which steps through the FLIGHTs in progress every 20 s) flies the camera to it with MapKit's camera animation and follows it at an oblique angle. Esc or a drag hands the camera back to the SUPERVISOR.
- **Planes and trails.** A plane symbol that banks in turns and climbs or descends by state; a fading trail behind airborne planes; a holding racetrack drawn as it is flown; a short touchdown flash on ON and a departure from the gate on OUT.
- **Honest motion (principle 2 still applies).** The point on the route still comes only from the scene's `t`. Between two scene refetches a plane eases towards the new `t` and then **keeps flying in place** (a small loop or hold at that point), so smooth motion never suggests progress atc does not know. No percentage, no ETA, no countdown. Late stays amber.
- **Calm by default.** It follows the system's Reduce Motion setting (a still frame), caps the frame rate, pauses when the window is hidden or occluded and in Low Power Mode. No sound (RADIO already owns sound).
- Its own issue after the `MAP` window, so the SUPERVISOR can use the information view first.

### 6.2 CINEMATIC follows the radio (G8)

In CINEMATIC, a new transmission about a plane on the scene moves the camera to that plane (at most one cut per 15 s; the SUPERVISOR's own camera wins until released) and shows its `head` as a subtitle with station and callsign. Sound stays with the RADIO monitor (R4, ATC-173); the window plays nothing itself. With Reduce Motion, subtitles only.

## 7. Implementation order

Each step is one issue. Each PR adds a changelog fragment pair and describes the screen in `docs/guide/screens.md` (Korean); G1 adds the GLOBE row.

| # | Step | Output | Tier |
|---|---|---|---|
| G1 | **Globe, places and the scene route.** Pure module `server/globe.ts` (browser-safe, like `server/progress.ts`) with tests: orthographic projection and horizon clipping, slerp, destination point by bearing and distance, subsolar point and terminator, AIRPORT layout relative to the hub with hashed places and minimum separation. `GET /api/globe` with `airports[]` and `parked[]` (3.8). Simplified Natural Earth land. The `#globe` tab after RADAR (lazy), location (3.6), home AIRPORT picker, client-side position overrides, drag/zoom/home, AIRPORTs, parked AIRCRAFT at their base, the text rows | A globe centred on the SUPERVISOR with AIRPORTs and parked AIRCRAFT; no FLIGHTs yet | auto |
| G2 | **FLIGHTs on circuits.** Pure `globeSceneOf` on the server (snapshot + milestones/progress + fleet → places, routes, states, `t`) with tests for every row of 3.3, added to `GET /api/globe` as `flights[]` (3.8). The web tab draws planes, holding, final, go-around, touchdown, taxi, fade-out and click targets | Every FLIGHT in progress flies its circuit with the right state | auto |
| G3 | **Moves between AIRPORTs.** `moves[]` in the scene (OUTSTATION from the snapshot, REPOSITION from the FLEET PLAN record) and their great-circle tracks on the web (3.4) | Cross-AIRPORT movement is visible | auto |
| G4 | **SPACE theme.** The second web renderer of the same scene (section 5), the toggle and its default | GLOBE and SPACE show the same traffic | auto |
| G5 | **ATCA GLOBE window, `MAP` mode** (atc-app repository, section 6). MapKit globe drawing `GET /api/globe`, terminator in `ATCCore` | A native globe window on the Mac | atc-app (SUPERVISOR merges) |
| G6 | **ATCA `CINEMATIC` mode** (6.1). Camera orbit, follow and tour; banked planes, trails, touchdown and departure effects; honest motion; Reduce Motion and pause rules | The game-like view of the same traffic | atc-app (SUPERVISOR merges) |
| G7 | **Radio on the globe and the AIRPORT view** (3.9). Pure transmission → station/plane mapping with tests, pulses on the globe, the aerodrome view, from `GET /api/radio` | The control interaction around departures and landings is visible | auto |
| G8 | **CINEMATIC follows the radio** (6.2). Camera cuts to the talking plane, `head` subtitles, sound via the R4 monitor | A landing reads as the conversation it is | atc-app (SUPERVISOR merges) |
| G9 | **World tour** (3.2). `range` and `rangeKnown` in the scene from the band table; the pure destination step on the client with tests; destinations pinned per FLIGHT; the great-circle track with the approach fix replaces the circuit; one placement function shared by the plane layer and the radio layer; `DEST` in the tooltip and the FLIGHTS list | Every FLIGHT flies from its AIRPORT to a real airport at a distance that stands for its typical duration | auto |

- G1 has no dependencies. G2 needs G1. G3 and G4 need G2 and can go in either order. G5 needs G2 (G3 for moves), and is picked as an N8 candidate by the SUPERVISOR. G6 needs G5. G7 needs G2. G8 needs G6. G9 needs G2, and waits for G3 (ATC-263) and the SUPERVISOR landing mark (ATC-300), which change the same files; G5 waits for G9 so the Mac app ports the tour, not the circuit. ATC-267 (RADIO PREFLIGHT) blocks nothing and is blocked by nothing; G7 and G8 show PREFLIGHT once it exists.
- Checks for G1–G4: `npm test`, `npx tsc --noEmit -p .`, `npx vite build`, and the GLOBE chunk size from the build output in the PR. On a 7702 test server (`ATC_GITHUB=off`, copied `airports.json` and `fleet.json`), open the tab with Playwright with a **made-up location** typed into the fields (never the real one), and describe what was seen in the PR in words. No screenshots (public repository, and a screenshot of this screen would show a location).

## 8. Risks

| Risk | Mitigation |
|---|---|
| The SUPERVISOR's location leaks | `localStorage` only, rounded to 1°, a forget button. Tests and PR checks use made-up coordinates. No screenshots of this tab anywhere (the root `CLAUDE.md` already forbids them in PRs) |
| The picture claims more than atc knows | Positions come only from the progress model's marker; no estimate means the start of the segment. Late stops short of the approach fix instead of inventing a landing time |
| Bundle and CPU cost | Lazy tab, land data inside the GLOBE chunk only, no package. 1 Hz position updates, 30 fps cap only while dragging or animating, stop when hidden, still frame with motion off |
| Clutter with many FLIGHTs at one AIRPORT | Bearings spread by stable nudging; labels collapse to the FLIGHT number when circuits overlap; the text rows always list everything |
| Looks broken in a theme | Colours only from `:root` tokens; the PR checks at least two themes |
| Hash places put two AIRPORTs on top of each other | Minimum separation in the layout, plus the drag override |
| The web and the Mac app drift | Both draw `GET /api/globe`; neither computes states or places. Only drawing differs |
| CINEMATIC motion reads as progress atc does not know | Position only from the scene's `t`; between refetches the plane flies in place (6.1). No percentage, ETA or countdown |
| A destination jumps during a FLIGHT (the band changes, or another FLIGHT leaves) | The destination is pinned per FLIGHT on the client (3.2) and only pruned when the FLIGHT leaves the scene. Bands, not raw minutes, so the range rarely changes |
| The distance reads as an arrival time | It is a band of the typical duration of similar FLIGHTs; the tooltip says so, and the position still comes only from `t` and stops short of the approach fix by estimate |
| Trips go over the horizon | Destinations prefer airports within 85° of the hub; the track is clipped at the horizon like any other line, and the SUPERVISOR can rotate the globe |
| The web and the Mac app choose different destinations | Same step, same airport list and same rule in `ATCCore` (G5). Pins are per client, so a FLIGHT first seen at different moments can still differ; the FLIGHT, its state and `t` are always the same |
| The Mac window cannot be checked by teams | The scene logic is on the server and in `ATCCore`, both tested on Linux. The window itself is small and is checked by the SUPERVISOR on the Mac before merging |

## 9. Decisions

**Made (SUPERVISOR):**

- 2026-09-30: "real aircraft" means atc's own AIRCRAFT drawn as planes. Real-world air traffic (ADS-B) is out of scope.
- 2026-10-01: ~~**Route model:** a FLIGHT is a circuit from its AIRPORT and back (3.2);~~ superseded later the same day by the world tour (below); great-circle arcs are only for real moves between AIRPORTs (3.4). This differs from the idea's wording ("a transfer orbit from Earth to its planet"): in SPACE a FLIGHT orbits its own body, and transfer orbits are for OUTSTATION and REPOSITION.
- 2026-10-01: **Placement:** a new tab `#globe` right after RADAR, lazy-loaded.
- 2026-10-01: **Priority** of the work orders: Low.
- 2026-10-01: **Web first, then the Mac app (option A).** The scene is computed on the server and served read-only (3.8). The web tab (G1–G4) comes first; a native MapKit GLOBE window in ATCA (G5) follows as an N8 candidate. Alternatives that were not chosen: the Mac app only (every visual change needs a build on the Mac, and only the SUPERVISOR can check it), and the web only. G1 waits in Backlog until the SUPERVISOR releases it.
- 2026-10-01: **The game-like view lives in the Mac app.** The web GLOBE stays a light SVG information view (G1–G4). An animated, game-like view on a real globe is `CINEMATIC` mode in the ATCA window (6.1, G6), because MapKit brings the real Earth without a package, a bundled texture or a `user`-tier PR in atc. Not chosen: a three.js CINEMATIC mode on the web, and a WebGL web GLOBE from G1. The web draws inline SVG with a hand-written orthographic projection and no package (principle 4).

- 2026-10-01: **World tour replaces the circuit** (3.2, G9 [ATC-302](https://linear.app/vocado/issue/ATC-302)). A FLIGHT departs its own AIRPORT and flies to a real airport, leaving out the places the AIRPORTs occupy. Chosen: replace the circuit (not a second mode); distance from the typical duration (progress p75), not from tokens (TRIP FUEL); every FLIGHT departs from its own AIRPORT (AIRCRAFT do not continue from the last destination). G5 (ATC-262) went back to Backlog to port the tour after G9.
- 2026-10-01: **Show the control interaction.** Departures and landings show the exchange with OCC, TOWER and MCC from RADIO (G7 on the web, G8 in CINEMATIC). CROSSCHECK's check before departure joins RADIO as a PREFLIGHT frequency (ATC-267) instead of being read by GLOBE directly.

**Proposed here, for the SUPERVISOR to accept or change:**

- Default location from the UTC offset, Geolocation rounded to 1° (CoreLocation in G5), no city search.
- Home AIRPORT default: where most live sessions are.
- SPACE as a toggle inside GLOBE, not a separate tab.

## Not built yet

Everything in section 7 (G1–G9), and the PREFLIGHT frequency (ATC-267).
