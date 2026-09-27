# ROUTE MAP design (WAYPOINTs)

**English** · [한국어](routes.ko.md)

The ROUTE MAP shows each ROUTE (a Linear project) as a line through its WAYPOINTs (Linear project milestones): which WAYPOINTs are passed, where the ROUTE is now, which FLIGHTs are flying that leg, and when the next WAYPOINTs are likely to be reached. It lives on the NETWORK tab, above the ROUTES table.

> Status (2026-09-27): steps 1–4 of "Implementation order" are built (ATC-2): read-only WAYPOINT data, `GET /api/routes`, the ROUTE MAP on NETWORK and the ETA. Step 5 onwards is not built.

Related: [fleet.md](fleet.md) section 7.3 (NETWORK), `server/network.ts` (ROUTES table), `server/sources/linear-projects.ts` (Linear projects and milestones), `server/routes.ts` (this design), `server/following.ts` (which AIRCRAFT flies a FLIGHT).

## 1. Current facts

Read-only from the running atc (`/api/network`, `/api/logbook`) and from Linear on 2026-09-27.

| Area | Figure | What it means for the ROUTE MAP |
|---|---|---|
| vocado milestones | 4 of 7 open vocado projects use milestones (14 milestones). Song Catalog & Publication: Foundation, Read Model, First Real Song, Web Surface 100%, Beta Ready 0% (`next`). Song Experience: Differentiated Listening Experience v1 83%. Lyrics Canonical Data: M1–M6, M2 done | Milestones are the plan the SUPERVISOR already writes; atc only has to read them |
| Milestone order | Linear `sortOrder` is the order on the project page. It is not the order of completion: Beta Ready (`next`) sits before Web Surface (`done`) | "Passed" comes from each WAYPOINT's own status, not from its position |
| Milestone fields | `name`, `description`, `targetDate`, `progress` (0–100), `sortOrder`, `status` (`done`, `next`, `overdue`, `unstarted`), `issues`. None of the vocado milestones has a target date yet | Progress and status come straight from Linear; target dates are optional |
| Exit criteria | Milestone descriptions carry an "Exit criteria:" heading followed by a numbered list | The list can be extracted without a new convention |
| atc team | The new Linear team `ATC` has project "atc" with M15–M20 (M15 "Linear teams and ROUTE MAP" … M20 "Network planning"); each description has an exit-criteria list | atc reads several teams since ATC-1 (`LINEAR_TEAM_KEYS`), but projects and milestones are still read for the main team (`LINEAR_TEAM_KEY`) only; atc's own plan shows up as a ROUTE once they follow the team list (step 5) |
| Query cost | Linear rejects a projects → milestones → issues query (complexity over 10,000). The root `projectMilestones` query with 50 milestones × 50 issues passes | Milestones are read with their own query, paged |
| LOGBOOK attribution | 18 of 82 LOGBOOK entries have a FLIGHT key | A per-ROUTE rate from the LOGBOOK alone is thin; Linear completion times fill the gap |
| NETWORK today | 7 ROUTEs, Beta Readiness busiest (13 open FLIGHTs, 12 ARRIVED in 14 days) and without milestones | The map has to fit several ROUTEs, most with only a few WAYPOINTs |

## 2. Principles

1. **Read only.** atc reads milestones; it never creates, moves or edits them. The SUPERVISOR plans in Linear.
2. **Linear decides what is passed.** A WAYPOINT is passed when Linear says `done`. atc does not second-guess progress.
3. **One place for the arithmetic.** WAYPOINT state, FLIGHT counts, exit criteria and ETA are pure functions in `server/routes.ts`, tested with `node:test`. The screen only draws.
4. **Unknown is a valid answer.** With too few completions, no FLIGHTs or a truncated list, the ETA is "unknown", never a guess.
5. **Stay out of the issue query.** `server/sources/linear.ts` (the FLIGHT board) is not touched; WAYPOINT membership is read from the milestone side.

## 3. Data

`server/sources/linear-projects.ts` gets a second query next to the projects query, sharing its 10-minute cache and its team (`LINEAR_TEAM_KEY`):

```graphql
projectMilestones(first: 50, after: $after, filter: { project: { accessibleTeams: { some: { key: { eq: $team } } } } }) {
  pageInfo { hasNextPage endCursor }
  nodes { id name description targetDate progress sortOrder status project { name }
    issues(first: 50) { pageInfo { hasNextPage } nodes { identifier title state { name type } completedAt } } }
}
```

Pages are followed up to 10 (500 milestones). A milestone with more than 50 issues is marked `truncated`. If the milestone query fails, the projects still load and the ROUTE MAP says milestones are unavailable.

## 4. `GET /api/routes`

```json
{
  "at": "…",
  "ok": true,
  "milestones": true,
  "error": null,
  "windowDays": 28,
  "routes": [{
    "project": "Song Experience",
    "state": "started",
    "progress": 0.80,
    "targetDate": null,
    "open": { "active": 4, "blocked": 0, "planned": 3 },
    "aircraft": ["TEAM_F"],
    "rate": { "completed": 6, "perWeek": 1.5 },
    "waypoints": [{
      "id": "…", "name": "Differentiated Listening Experience v1",
      "state": "active", "linearStatus": "next", "progress": 0.83, "targetDate": null,
      "criteria": ["Material UI PRs expose …", "…"],
      "flights": [{ "key": "VOC-137", "title": "…", "phase": "done", "aircraft": null, "url": "…" }],
      "counts": { "done": 5, "active": 1, "blocked": 0, "planned": 1 },
      "truncated": false,
      "late": false,
      "eta": { "at": "2026-10-04", "remaining": 2, "cumulative": 2, "reason": null }
    }]
  }]
}
```

- **ROUTEs**: every Linear project whose status is not `completed` or `canceled`, plus any project with open FLIGHTs on the board. ROUTEs with WAYPOINTs come first, then ROUTEs without (`waypoints: []`); within each group busiest first (open FLIGHTs), then name.
- **ROUTE `open` and `aircraft`**: open FLIGHTs of the project on the FLIGHT board by phase (parent issues left out, as on the ROUTES table) and the AIRCRAFT flying them. They are there for every ROUTE, with or without WAYPOINTs.
- **WAYPOINT state**: `passed` when Linear status is `done`. Of the rest, the first in `sortOrder` is `active`; the others are `planned`. Linear's `overdue` stays visible as `linearStatus` and as "late".
- **FLIGHT phase**: `done` (completed), `blocked` (open and has an open `blockedBy` from the FLIGHT board), `active` (started), `planned` (any other open state). Canceled and duplicate FLIGHTs are left out.
- **AIRCRAFT**: the same rule as FOLLOWING (`targetsOf`): the ASSIGN proposal's AIRCRAFT, else the first `tail:` label.
- **Exit criteria**: if the description has a heading line containing "exit criteria" or "완료 기준", the numbered items (`1.` or `1)`) under it until the next heading; otherwise all numbered items in the description. Only the first line of each item, Markdown emphasis removed.

## 5. ETA

- **Rate**: distinct FLIGHTs of the ROUTE completed in the last 28 days. A FLIGHT counts when the LOGBOOK has it ARRIVED in the window, or when Linear's `completedAt` of a WAYPOINT FLIGHT falls in the window. `perWeek = completed / 4`.
- **Remaining**: open FLIGHTs (active, blocked, planned) of a WAYPOINT. ROUTEs are flown in order, so a WAYPOINT's ETA counts the remaining FLIGHTs of every unpassed WAYPOINT before it too: `eta = now + cumulativeRemaining / perDay`.
- **Unknown** when the ROUTE completed fewer than 3 FLIGHTs in the window (`reason: "few-samples"`), the WAYPOINT has no open FLIGHTs while not passed (`"no-flights"`), or a list was truncated (`"truncated"`).
- **Late**: a target date that is before the ETA, or already past while the WAYPOINT is not passed. Passed WAYPOINTs have no ETA.

## 6. Screen

One row per ROUTE: the ROUTE name, its progress, then a horizontal SVG line. A ROUTE without WAYPOINTs is a plain line marked "no WAYPOINTs" with its open FLIGHT counts (active, planned, blocked) and the AIRCRAFT flying it; these rows come after the ROUTEs with WAYPOINTs.

- Passed WAYPOINT ●, active ◉ with its progress, planned ○. The leg into the active WAYPOINT is drawn solid up to its progress and dashed after.
- Above the active WAYPOINT: ✈ with the REGISTRATION of each AIRCRAFT flying a FLIGHT of that WAYPOINT (at most three, then "+n").
- Each WAYPOINT is a button (Tab, Enter or Space). Opening it shows the target date, ETA and late mark, the exit criteria and the FLIGHT list grouped by phase, each with its AIRCRAFT.
- At narrow widths (390 px) the line keeps its WAYPOINT spacing and scrolls sideways inside its own box; the page does not scroll sideways. WAYPOINT names are shown in the detail, with the active one's name under the line.
- Colours only from the `:root` tokens: passed `--radar`, active `--cyan`, planned `--faint`, late `--amber`, blocked `--alert`. The ✈ label on the active WAYPOINT and ✈ in the FLIGHT list use `--radar`.

## 7. Implementation order

1. Read milestones in `linear-projects.ts` (built).
2. `server/routes.ts` pure functions and `GET /api/routes` (built).
3. ROUTE MAP on the NETWORK tab (built).
4. ETA from the ROUTE's completion rate, late mark (built).
5. Read projects and milestones for every team in `LINEAR_TEAM_KEYS` (ATC-1), so the `ATC` ROUTE shows next to the vocado ones. Not built yet.
6. Tie atc gates to WAYPOINTs: the verdict gate, the 2b readiness checklist and the ATFM switch-on conditions shown as exit criteria of M15–M20. Not built yet.
7. OCC briefing: a late WAYPOINT becomes a briefing line. Not built yet.
8. DISPATCH: FLIGHTs on the active WAYPOINT score higher. Not built yet.
9. SCHEDULE: a "set milestone" draft for FLIGHTs of a ROUTE with no WAYPOINT. Not built yet.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Milestone order is not completion order | State comes from Linear status; only the active pick uses order |
| Rate from few FLIGHTs swings wildly | Unknown under 3 completions; the window is 28 days |
| FLIGHTs of later WAYPOINTs get done early | They count as done on their own WAYPOINT and in the rate; ETA only counts remaining work |
| Query cost grows with milestones | Own paged query, 10-minute cache, 50 issues per milestone with a truncated mark |
| Exit criteria written differently | Fallback to all numbered items; no list means no criteria, not an error |

## 9. Not built yet

- Projects and milestones of every team in `LINEAR_TEAM_KEYS`, not only the main team (step 5).
- WAYPOINTs tied to atc gates (step 6), OCC late-WAYPOINT briefing (step 7), DISPATCH WAYPOINT score (step 8), SCHEDULE "set milestone" draft (step 9).
- An OCC notice for ROUTEs without WAYPOINTs (the API already keeps them with `waypoints: []`).

## Decisions (2026-09-27, TEAM_J with structure)

1. `GET /api/routes` is a new endpoint; `/api/network` is unchanged.
2. Active WAYPOINT = first unpassed in `sortOrder` (Linear's `next`); `overdue` shows as late.
3. The rate unites LOGBOOK ARRIVED and Linear `completedAt`, because only 18 of 82 LOGBOOK entries carry a FLIGHT.
4. ETA is cumulative along the ROUTE.
5. ROUTEs without WAYPOINTs stay on the map and in the API (`waypoints: []`), after the others, with their open FLIGHTs and AIRCRAFT. Beta Readiness, the busiest ROUTE, has no milestones; hiding it would hide the most important line. An OCC "ROUTE without WAYPOINTs" notice can build on this later.
