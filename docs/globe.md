# GLOBE: atc's AIRCRAFT over a 3D globe, and a SPACE theme

Status (2026-10-01): design draft from the idea [#280](https://github.com/chaehy5665/atc/issues/280). Nothing is built. The SUPERVISOR decided the route model, the tab and the priority on 2026-10-01 (section 8). Work orders G1–G4 follow section 6.

**LANDING tier of every step: `auto`.** GLOBE is a read-only screen plus a pure module. It adds no server route that writes, no state file and no package (section 2, principle 4).

Related: [dispatch.md](dispatch.md) ("FLIGHT FOLLOWING: milestones as built", "STRIPS progress bar as built"), [fleet.md](fleet.md) (base AIRPORT, OUTSTATION, REPOSITION 8.6), [ui-visibility.md](ui-visibility.md).

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

## 2. Principles

1. **Read-only, like RADAR and NETWORK.** GLOBE shows what atc already knows. It sends nothing to sessions, changes no state, and adds no server data in G1–G3.
2. **Facts from the milestones, estimates only inside the current segment.** A plane's place on its route is the STRIPS progress model (`server/progress.ts`), not a new guess. No percentage, no ETA. Where the model has no estimate, the plane stops at the start of the segment, as the bar's marker does.
3. **The location stays in the browser.** The SUPERVISOR's location and any AIRPORT positions they pick live only in `localStorage`. They are never sent to the server, written to state files, or put into PRs, issues, logs or screenshots (the repository is public). Without a location, GLOBE uses a default (section 3.6).
4. **No new package and no external request.** The projection, great circles and the day/night terminator are a few pure functions. Coastlines are Natural Earth 1:110m land (public domain), simplified and shipped inside the GLOBE chunk. No tile server, no geocoder, no CDN. Adding a package would make the PR `user` tier (`package*.json`) and is not needed for an orthographic globe.
5. **One scene model, two drawings.** A pure function turns the snapshot into a **scene**: places (AIRPORTs), and for each FLIGHT a route, a state and a position `t` along it. The globe and the SPACE theme are two renderers of the same scene (section 5). Calculation is tested with `node:test`; drawing is not.
6. **Stable from snapshot to snapshot.** AIRPORT places and route bearings come from hashes of stable ids (AIRPORT `id`, FLIGHT key), so planes do not jump when another FLIGHT appears.
7. **Quiet when nothing is flying.** Parked AIRCRAFT are small marks at their AIRPORT. ARRIVED FLIGHTs fade out like the Dark cockpit rule on RADAR. Theme tokens only, `settings.motion` respected, 30 fps cap, stop when hidden.
8. **A text equivalent.** The same scene is listed as rows next to the globe (callsign, FLIGHT, state, AIRPORT), for screen readers and narrow screens.

## 3. The globe

### 3.1 Places

- **Hub.** The SUPERVISOR's location (3.6). The **home AIRPORT** sits on it. Default home AIRPORT: the one where most live sessions are (`Session.repo`). The SUPERVISOR can pick another in the GLOBE toolbar (saved in `localStorage`).
- **Other AIRPORTs** sit around the hub at a bearing and a distance from a stable hash of the AIRPORT `id` (distance 12°–30° of arc, bearing anywhere). A pure layout nudges AIRPORTs that land closer than a minimum separation (order by `id`, so the nudge is stable). The SUPERVISOR may drag an AIRPORT to another place; the override is saved in `localStorage` by AIRPORT `id`. Closed and missing AIRPORTs are not drawn.
- Each AIRPORT is drawn as a small aerodrome symbol with its four-letter code, and a short runway whose heading also comes from the hash.

### 3.2 A FLIGHT is a circuit from its AIRPORT and back

Decided (section 8): a FLIGHT departs its AIRPORT and lands at the same AIRPORT, as it does in atc (work starts on a STAND and ends in that AIRPORT's main branch). Its route is a closed loop: **departure → outbound leg → turn point → inbound leg → IAF** (initial approach fix) **→ final → runway → gate**.

- The outbound bearing comes from a hash of the FLIGHT key, nudged away from the other FLIGHTs at the same AIRPORT (stable order by key). The loop size is a fixed fraction of the distance to the nearest other AIRPORT, so circuits do not overlap AIRPORTs.
- Long great-circle arcs are kept for real moves between AIRPORTs (3.4).

### 3.3 From facts to the picture

The FLIGHT's AIRCRAFT is the one holding a STAND whose `ticketKey` is the FLIGHT (claims). A STAND-free FLIGHT flies without a callsign unless an existing read route already names its AIRCRAFT (G2 checks; it adds no route for this).

| Fact | Source | Drawn as |
|---|---|---|
| FLIGHT has a STAND but no OUT | milestones | At the gate, nose out ("boarding") |
| `work` segment (OUT→OFF), AIRCRAFT `airborne` | progress | Flying the loop. Position along departure→IAF is the marker inside `work` (elapsed / p75, capped at the IAF). No estimate: at the departure end |
| `late` in `work` | progress | Stops short of the IAF and the label turns amber. No holding pattern (holding means waiting, below) |
| AIRCRAFT `holding` (idle with the STAND), or an open `HOLD` CLEARANCE for the FLIGHT | snapshot | Holding pattern (racetrack) at its current point |
| AIRCRAFT `nordo` | snapshot | Grey, no animation, label `NORDO` |
| `landing` segment (OFF→ON), PR `CLEARED` | progress, `pulls` | On final from the IAF to the runway; position from the `landing` marker |
| `landing` segment, PR `APPROACH` (blocked) | `pulls[].blocks` | Holding at the IAF. Block codes (CI, review, behind …) in the tooltip and the text row |
| `GO AROUND` CLEARANCE for the FLIGHT in the last 30 min, or a `landing.conflict` event | `clearances` | One missed-approach loop from final back to the IAF, mark `GA` until the new head is CLEARED |
| ON (merged) | milestones | Touchdown. In `rts` (ON→IN, MCC AIRPORT only) it taxis to the gate |
| IN, or ON where no RTS follows (`done`) | milestones | At the gate, fades out over 30 min. `reverted` adds a mark |
| AIRCRAFT without a FLIGHT | snapshot, `fleet` | Small parked mark at its base AIRPORT (count when several) |

A click on a plane opens the FLIGHT drawer (`#flight/<KEY>`, as `OpenFlight` in `web/src/FlightLink.tsx` does). The tooltip carries the AIRCRAFT's callsign, status and STAND, as RADAR's blocks do. A plane without a FLIGHT key in the drawer format is not a link.

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

## 6. Implementation order

Each step is one issue. Each PR adds a changelog fragment pair and describes the screen in `docs/guide/screens.md` (Korean); G1 adds the GLOBE row.

| # | Step | Output | Tier |
|---|---|---|---|
| G1 | **Globe and places.** Pure module `server/globe.ts` (browser-safe, like `server/progress.ts`) with tests: orthographic projection and horizon clipping, slerp, destination point by bearing and distance, subsolar point and terminator, AIRPORT layout with hashed places, minimum separation and overrides. Simplified Natural Earth land. The `#globe` tab after RADAR (lazy), location (3.6), home AIRPORT picker, drag/zoom/home, AIRPORTs, parked AIRCRAFT at their base, the text rows | A globe centred on the SUPERVISOR with AIRPORTs and parked AIRCRAFT; no FLIGHTs yet | auto |
| G2 | **FLIGHTs on circuits.** Pure `globeSceneOf` (snapshot + milestones/progress + fleet → routes, states, `t`) with tests for every row of 3.3. Planes, holding, final, go-around, touchdown, taxi, fade-out, click targets | Every FLIGHT in progress flies its circuit with the right state | auto |
| G3 | **Moves between AIRPORTs.** OUTSTATION and REPOSITION great-circle tracks (3.4), from the snapshot and `GET /api/fleet/plan` | Cross-AIRPORT movement is visible | auto |
| G4 | **SPACE theme.** The second renderer of the same scene (section 5), the toggle and its default | GLOBE and SPACE show the same traffic | auto |

- G1 has no dependencies. G2 needs G1. G3 and G4 need G2 and can go in either order.
- Checks for every step: `npm test`, `npx tsc --noEmit -p .`, `npx vite build`, and the GLOBE chunk size from the build output in the PR. On a 7702 test server (`ATC_GITHUB=off`, copied `airports.json` and `fleet.json`), open the tab with Playwright with a **made-up location** typed into the fields (never the real one), and describe what was seen in the PR in words. No screenshots (public repository, and a screenshot of this screen would show a location).

## 7. Risks

| Risk | Mitigation |
|---|---|
| The SUPERVISOR's location leaks | `localStorage` only, rounded to 1°, a forget button. Tests and PR checks use made-up coordinates. No screenshots of this tab anywhere (the root `CLAUDE.md` already forbids them in PRs) |
| The picture claims more than atc knows | Positions come only from the progress model's marker; no estimate means the start of the segment. Late stops short of the IAF instead of inventing a landing time |
| Bundle and CPU cost | Lazy tab, land data inside the GLOBE chunk only, no package. 1 Hz position updates, 30 fps cap only while dragging or animating, stop when hidden, still frame with motion off |
| Clutter with many FLIGHTs at one AIRPORT | Bearings spread by stable nudging; labels collapse to the FLIGHT number when circuits overlap; the text rows always list everything |
| Looks broken in a theme | Colours only from `:root` tokens; the PR checks at least two themes |
| Hash places put two AIRPORTs on top of each other | Minimum separation in the layout, plus the drag override |

## 8. Decisions

**Made (SUPERVISOR):**

- 2026-09-30: "real aircraft" means atc's own AIRCRAFT drawn as planes. Real-world air traffic (ADS-B) is out of scope.
- 2026-10-01: **Route model:** a FLIGHT is a circuit from its AIRPORT and back (3.2); great-circle arcs are only for real moves between AIRPORTs (3.4). This differs from the idea's wording ("a transfer orbit from Earth to its planet"): in SPACE a FLIGHT orbits its own body, and transfer orbits are for OUTSTATION and REPOSITION.
- 2026-10-01: **Placement:** a new tab `#globe` right after RADAR, lazy-loaded.
- 2026-10-01: **Priority** of the work orders: Low.

**Proposed here, for the SUPERVISOR to accept or change:**

- Inline SVG with a hand-written orthographic projection, no package (principle 4). three.js / globe.gl only if G1 shows SVG is not enough, as a separate `user`-tier decision.
- Default location from the UTC offset, Geolocation rounded to 1°, no city search.
- Home AIRPORT default: where most live sessions are.
- SPACE as a toggle inside GLOBE, not a separate tab.

## Not built yet

Everything in section 6 (G1–G4).
