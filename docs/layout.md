# Layout: atc's screens after the arrow

Status (2026-10-02): **Y1–Y6 built** (section 4). The SUPERVISOR chose the direction on 2026-10-02 ("추천대로 진행", section 6). **Section 7 (the shell: rail, sidebar, drawer, CONTROL panel) decided 2026-10-02, not built.** This draft replaces [ui-visibility.md](ui-visibility.md) 3.2 (tabs by task) and its open decision 4, and sets the order of [design-language.md](design-language.md) step L4 (the tab audit). Written in an ENGINEERING session; DUTY or ENGINEERING update the status after merge.

Related: [autonomy.md](autonomy.md) principles 1, 9 and 10 (the arrow, brakes, direction), [design-language.md](design-language.md) (how a screen looks and behaves), [design-taste.md](design-taste.md), [duty.md](duty.md) 7 (the SUPERVISOR QUEUE in the DUTY drawer), [guide/screens.md](guide/screens.md) (what each tab shows today).

## 1. Current facts

Read from `origin/main` (`f44a9bb`) and read-only state on 2026-10-02 ~07:30Z.

- **13 tabs, ordered by data source:** RADAR, FOLLOW, GLOBE, STRIPS, FIDS, AIRPORTS, FLEET, METRICS, NETWORK, DISPATCH, SCHEDULE, RADIO, DOCS (`TABS` in `web/src/App.tsx`). Around them are the FLIGHT, PR, DUTY and IDEAS drawers, the header (readouts, CONTROL strip, UPDATE bar, ALERT line, BELL) and the settings window. The default tab is RADAR.
- **The biggest views are the ones whose job is being automated.** `Dispatch.tsx` has 1,739 lines and `Schedule.tsx` 1,372. FLEET has about 4,300 lines over `views/fleet/`. Every other view has 165–671.
- **The human verdict was a rubber stamp, and it is leaving.**
  - In the 7 days to 2026-10-02 07:00Z, DISPATCH cards got 313 manual approvals and 7 rejections (2%), plus 106 manual LAUNCHes. SCHEDULE got 9 verdicts (`proposals.jsonl`, `schedule.jsonl`).
  - Since 2026-10-02:
    - DISPATCH approves its own cards (ATC-367, live since 07:00Z).
    - SCHEDULE and FLEET PLAN are being automated (ATC-370, in progress).
    - CROSSCHECK is to be turned off (ATC-371).
- **Firing the arrow has no screen of its own.** It is the SUPERVISOR's one active daily job (autonomy.md principles 1 and 10). Today it lives in four places:
  - the release block inside DISPATCH (ATC-362, `web/src/views/Release.tsx`)
  - the FLIGHT drawer's state buttons
  - FOLLOW's `Todo로` chip
  - the DUTY chat
- **K1–K3 approvals are spread out:**
  - HUMAN CHECK, at the top of STRIPS
  - `user`-tier MERGE, in the PR drawer
  - the automation switches, in settings
  - the team-merge switch, in AIRPORTS
- **Brakes are spread out** (autonomy.md principle 9):
  - ATFM GROUND STOP and the manual departure stop, in DISPATCH
  - CANCEL and RECALL, in DISPATCH's IN FLIGHT table
  - STOP, AOG and STOP ALL, in FLEET
  - HOLD, a GitHub label
  - the mode switches, in settings
- **The SUPERVISOR QUEUE** is shown in the DUTY drawer (duty.md 7). Its items link to `#dispatch`, `#schedule`, `#strips`, `#fleet` and `#radar` (`server/supervisor-queue.ts`). The ANNUNCIATOR menu bar opens the same links.
- **The earlier regrouping was not adopted.** ui-visibility 3.2 proposed LIVE, DECISIONS, FLIGHTS, FLEET, READINESS and DOCS. Under the arrow, DECISIONS has no work left, and READINESS measured shadow stages, which live first dropped.
- **Restyling alone did not work.** In the FLEET card experiment on 2026-10-02, a token-only restyle was judged "AI slop". A structural instrument-panel card was preferred, mildly.

## 2. Principles

1. **One screen per SUPERVISOR job, not per data source.** The jobs after release are:
   - fire (release)
   - approve K1–K3
   - pull a brake
   - watch exceptions
   - read results

   Rare maintenance and ambient viewing sit outside the tab row.
2. **When its job is automated, a screen becomes a record.** Its live parts move to the job they serve. If an off switch brings back a human approval, the item appears in the SUPERVISOR QUEUE; no tab keeps a second approval UI.
3. **Views, not tabs.** A list, a board and a radar of the same FLIGHTs are three views of one screen.
4. **Every old address keeps working.** `LEGACY_HASH` maps each retired address to its new place. Queue links and the menu bar move in the same step.
5. **One screen per step, live.** Each step moves a part and removes the old copy in the same PR, so nothing exists in two places. Structure comes before restyling.

## 3. The map

### 3.1 Today's tabs

| Tab | What the SUPERVISOR does there today | What is left after release | Goes to |
|---|---|---|---|
| DISPATCH | judge cards, agree with CROSSCHECK, HELD, modes, ATFM, release, CANCEL / RECALL, MISFIRE | release; brakes (ATFM, CANCEL, RECALL); MISFIRE | split: RELEASE, HOME, FLIGHTS, METRICS |
| SCHEDULE | judge OCC drafts, LATE WAYPOINTS, READINESS | LATE WAYPOINTS (an exception); NEW drafts become release candidates | split: HOME, RELEASE; READINESS removed |
| FLEET | cards, LAUNCH / STOP, AOG, ratings, CREW BRIEFING, FLEET PLAN approval, control sessions | brakes (STOP, AOG); maintenance; LOGBOOK | FLEET, without FLEET PLAN approval |
| STRIPS | HUMAN CHECK, LANDING SEQUENCE, a strip per session | K approval (HUMAN CHECK); blocked PRs | HOME (K), FLIGHTS (the rest) |
| FOLLOW | bundle rows, `Todo로`, stuck lines | release (READY to Todo); exceptions | FLIGHTS (list view); `Todo로` also on RELEASE |
| FIDS | read-only board by Linear state | nothing of its own | FLIGHTS (board view) |
| RADAR | read-only session, STAND and FLIGHT lines | nothing of its own; its alerts already reach the ALERT line | FLIGHTS (radar view) |
| RADIO | read-only radio log, rewind | diagnosis | FLIGHTS (a FLIGHT's thread in its drawer, the full log as a sub-view) |
| METRICS | OPERATIONS, LEAKS, TOUCHES, FUEL | results | METRICS |
| NETWORK | read-only ROUTE map, targets, 28-day trends | results | METRICS |
| AIRPORTS | open, rename, close, team merge switch | rare maintenance; the switch is K3 | settings |
| GLOBE | read-only globe | ambient | view mode, out of the tab row |
| DOCS | guide, changelog | help | help menu |

### 3.2 The new screens

| Screen | Address | Job | What it holds |
|---|---|---|---|
| HOME | `#home` (default) | approve K1–K3, watch exceptions, pull a brake | Empty when normal (design-language principle 1). <br>• The SUPERVISOR QUEUE (once the switches are on, only K1–K3 items and leaks). <br>• WARNING / CAUTION ALERTs. <br>• Stuck FLIGHT lines and LATE WAYPOINTS. <br>• One neutral row of fleet-wide brakes (GROUND STOP, STOP ALL, the automation switches and their state). |
| RELEASE | `#release` | fire | The candidates: READY Backlog issues, agent proposals (SCHEDULE NEW, DUTY drafts), and Todo issues that are not released. Firing = Todo + priority + the declared K effects, recorded as a release (ATC-362), with recent releases by channel. |
| FLIGHTS | `#flights` | watch, per FLIGHT | One set of FLIGHTs from Todo to IN, with stage dots and the PR's landing state. <br>• Views: list (FOLLOW rows, default), board (FIDS), radar (RADAR). <br>• Per-FLIGHT brakes (CANCEL, RECALL) sit on the row and in the drawer. <br>• The FLIGHT drawer shows that FLIGHT's radio thread. The full RADIO log is the RADIO screen (`#radio`, Z4). |
| FLEET | `#fleet` | maintenance, per-AIRCRAFT brakes | As today, with the ATC-280 card and control sessions. FLEET PLAN becomes a record line, not an approval. |
| METRICS | `#metrics` | read results | OPERATIONS, LEAKS, TOUCHES (SUPERVISOR touches per landed PR by UTC day, ATC-512), MISFIRE for every automatic lane (DISPATCH, SCHEDULE, FLEET PLAN), FUEL, and NETWORK (ROUTE progress, trends). |

Outside the tab row:
- GLOBE as a full-screen view mode, from a header button (`#globe` still opens it)
- DOCS in a help menu
- AIRPORTS inside the settings window

The FLIGHT, PR, DUTY and IDEAS drawers stay as they are.

The tab row is then five: HOME, RELEASE, FLIGHTS, FLEET, METRICS.

## 4. Implementation order

Each step is one work order (filed 2026-10-02, linked below) and one PR. The tier is `auto` unless a step touches a `user` path. Each step updates `docs/guide/` (at least `screens.md`), adds a changelog fragment, and follows the design-language checklist. Its Playwright pass runs at the SUPERVISOR's real width (about 1000 px), as well as at 1280 and 390 px, with seeded data. It also runs **with the FLIGHT drawer open**: at 1000 px (the sidebar folds) and at 1280 px with the sidebar and the drawer both open, the narrowest case (about 330 px for a list column, [flights-list.md](flights-list.md)).

| Step | What | Needs |
|---|---|---|
| Y1 ([ATC-376](https://linear.app/vocado/issue/ATC-376)) | **RELEASE screen.** Move the release block out of DISPATCH into `#release` and add the candidates (READY issues and agent proposals) next to the unreleased Todo issues. DISPATCH links there until Y2. | ATC-362 ✅ |
| Y2 ([ATC-377](https://linear.app/vocado/issue/ATC-377)) | **HOME, and DISPATCH taken apart.** Create `#home` with the queue, ALERTs and the brakes row. Move ATFM and the departure stop to the brakes row, CANCEL / RECALL to the FLIGHT row and drawer, MISFIRE to METRICS. Remove the verdict, CROSSCHECK and BLIND UI. The assignment history becomes a record in the FLIGHT drawer. `#dispatch` goes to `#home`. | ATC-367 ✅, ATC-371 |
| Y3 ([ATC-378](https://linear.app/vocado/issue/ATC-378)) | **SCHEDULE taken apart.** LATE WAYPOINTS to HOME. NEW drafts to RELEASE candidates. Remove the verdict UI and READINESS. `#schedule` goes to `#home`. | ATC-370 |
| Y4 ([ATC-379](https://linear.app/vocado/issue/ATC-379)) | **FLIGHTS.** One screen with list, board and radar views, built from FOLLOW, STRIPS, FIDS and RADAR. RADIO becomes a sub-view and a drawer thread. HUMAN CHECK items move to HOME. Old addresses map to the views. | Y2 |
| Y5 ([ATC-380](https://linear.app/vocado/issue/ATC-380)) | **METRICS.** Take in NETWORK and MISFIRE from every automatic lane. | Y2, Y3 |
| Y6 ([ATC-381](https://linear.app/vocado/issue/ATC-381)) | **Small moves.** AIRPORTS into settings, GLOBE to the view mode, DOCS to the help menu, the default tab to `#home`. The tab row is now five. | Y4 |

Order rationale (decision D3): firing has no home and is used every day, so it comes first. The two views whose job is gone hold most of the code and most of the words, so they go next; HOME is built in Y2 because the parts taken out of DISPATCH need a place to land. FLIGHTS changes the most habits, so it comes once the rest has settled.

### Y1 as built (ATC-376)

- `#release` is a tab, placed before DISPATCH (`web/src/views/Release.tsx`). Three blocks: **candidates**, **Todo, not released** and **recent releases** (15 rows, and the 7-day count by channel).
- Candidates are READY Backlog issues (every blocker finished, the rule behind FOLLOW's `Todo로`) and the open SCHEDULE NEW drafts. Each row shows its priority and the K effects declared in the issue body (`kEffects`, from the `## K effects` section; "선언 없음" when it has none).
- `POST /api/releases/fire` moves a READY issue to Todo (the same Linear write as the state button, `moveFlight`) and records a screen release in one click. It refuses an issue without a priority (DISPATCH would not assign it), a stale hash, and a request without the app's Origin. If the move fails, no release is recorded.
- SCHEDULE NEW drafts are listed but cannot be fired from here: they are not issues yet, and the verdict UI stays in SCHEDULE until Y3 (ATC-378). DUTY's issue drafts show up as Backlog READY issues. The `duty-drafts.jsonl` entries are queue cards and notes, not issues, so they are not listed.
- DISPATCH lost its release block and shows a link to `#release`. Routes and checks of ATC-362 are unchanged.

### Y2 as built (ATC-377)

- `#home` is a tab, placed first (the default tab stays RADAR until Y6): `web/src/views/Home.tsx`. Sections that have nothing to show are not drawn; the brakes row is always there. `#dispatch` opens HOME (`LEGACY_HASH`); the queue, alert and FOLLOW links that pointed at `#dispatch` now say `#home`.
  - **QUEUE** is the SUPERVISOR QUEUE with the same buttons as the DUTY drawer's QUEUE (`Actions` in `DutyCards.tsx`). A PROPOSAL item has **승인** / **거절** (inline, one confirmation, the same `/approve`, `/reject` routes, `/verdict` in 2a). With the auto-dispatch switch on, only RELEASE cards appear; with it off, ASSIGN and launch cards come back here.
  - **ALERTS** are WARNING and CAUTION items whose destination is `alerts`, minus `follow|stuck` (shown as **STUCK** rows, with the row's CANCEL and RECALL).
  - **BRAKES** moved to the bottom panel's BRAKES tab (ATC-455, see "Z5 as built"); HOME no longer draws it. What it holds is unchanged: GROUND STOP and manual departure stop counts, `ATFM…` (the existing ATFM panel; its exception block opens at the top when a stop is enforced), `STOP ALL…` (the control sessions' STOP ALL preview and run, moved from FLEET's bulk bar), the automation switches' state (the policy line of the settings window), the DISPATCH 2a↔2b switch, and a link to the settings window.
- DISPATCH is gone. `Dispatch.tsx`, its CSS and `DispatchBriefing`, `Following` and `Readiness2b` (used only by it) are deleted. Gone with them: the per-card verdict, the CROSSCHECK agree lane and chips, BLIND, HELD (PREFLIGHT) and its two buttons, the 2b readiness block, the DISPATCH-side FLIGHT FOLLOWING block, the slot and EXCLUDED readouts, the launch ACCOUNT and MODEL lines and the SUPERVISOR CONFIRM AT AIRCRAFT box (its queue item, GO, stays).
- **CANCEL, RECALL and FRESH START** moved to `web/src/FlightBrakes.tsx`, used by the FOLLOW rows (`FollowRow.proposalInfo`, additive) and the FLIGHT drawer. The drawer gets a `배정 기록` block (`web/src/FlightDispatch.tsx`, `GET /api/dispatch/proposals?flight=KEY`, read-only) with each proposal's stage times, reason and brakes.
- **MISFIRE** and the single-lane landings block (ATC-386) are blocks in METRICS → OPERATIONS (`AutoMisfire`, `SingleLane`).
- Routes of approve, reject, cancel, recall, fresh-start, mode and ATFM are unchanged; `GET /api/settings` gains `dispatchAuto.mode`.

### Y4 as built (ATC-379)

- `#flights` is a tab (`web/src/views/Flights.tsx`), placed after HOME. A row of views at the top picks the view; the address says which: `#flights` (LIST, default), `#flights/board`, `#flights/radar` (RADIO was a fourth view here until Z4 moved it to the rail). FOLLOW, STRIPS, FIDS, RADAR and RADIO are gone from the tab row. Their old addresses (`#follow`, `#strips`, `#board`, `#radar`, and the older `#map`, `#teams`, `#tickets`) open the matching view (`web/src/legacy-hash.ts`, `canonicalHash`): `#follow` and `#strips` open LIST, `#board` BOARD, `#radar` RADAR.
- **LIST** is FOLLOW's bundles and rows with its stage dots, now with the PR's landing badge (`CLEARED TO LAND`, `APPROACH` and the blocker count, STACKED) on the row of a FLIGHT that has an open PR. Under the list: the LANDING SEQUENCE (with the AUTOLAND lines and HOLD buttons) and a folded **AIRCRAFT STRIPS** block (the old STRIPS bays, GATE CLEANUP and progress bars, unchanged). **BOARD** is FIDS with its own list/board switch; **RADAR** is the old RADAR; **RADIO** is the old RADIO tab (filters, replay, listening).
- **HUMAN CHECK** moved to HOME. The queue item (`HUMAN CHECK`, hash `#home`) draws the PR's evidence and the PASS / FAIL form inline (`HumanRow`) instead of a link to STRIPS.
- **A FLIGHT's radio thread** shows in the FLIGHT drawer (`web/src/FlightRadio.tsx`): the calls whose `flight` is that FLIGHT and their replies for the last 7 days; the block is not drawn when there are none, and it links to `#radio` (Z4: filtered to that FLIGHT's AIRCRAFT).
- **Server links** now point at the new places: the queue's HUMAN CHECK and UPDATE and UNDELIVERED items to `#home`, LANDING to `#flights`; alert links `#strips` / `#follow` to `#flights` and `#radar` to `#home`; FOLLOW chips `#flights` and `#radio` (was `#flights/radio` before Z4); the menu bar's RTS and overflow lines to `#home`.
- **HOME as built (ATC-422, S1b).** HOME answers one question, "is there anything for me to do now?", and draws, in this order: the `AtfmAlert` banner when a stop is in force, the SINCE LAST LOOK line (moved from `App.tsx` into `Home.tsx`), and one to-do list. Nothing else: the separate QUEUE, ALERTS, STUCK, EFFECT, LATE WAYPOINTS and "LINEAR에서 직접 DONE" sections are gone. The list is `GET /api/supervisor/queue` in the server's order (S1a), in a reading column centred at about 880 px (design-language principle 8, exception). It sits on the screen surface with no cards; each row is one line with fixed columns (`web/src/kit/TodoRow.tsx`): kind tag, subject, what is needed (one sentence), age, and the item's `primary` button; the age and the button end every row at the right edge. Pressing a row opens its detail below it (the rest of the actions with their confirmations, the reason, the HUMAN CHECK evidence `HumanRow`, the EFFECT mark); the row button is the item's `primary` only: an open or Linear link, or "open the detail" for approve, CANCEL/RECALL, hand delivery and HUMAN CHECK. A WARNING row has a 2 px `--alert` bar on its left edge and an alert-tone tag, a CAUTION row the tag only. When the list is empty HOME shows the SINCE LAST LOOK line and one faint line, `할 일 없음`. The DUTY drawer no longer lists the queue: one line `할 일 n — HOME에서` links to `#home`.
- **Grouped to-do on HOME (ATC-503, H4 of [home-flow.md](home-flow.md)).** The list is drawn from `GET /api/flow` (`todoLines`, `todoRest`) joined by key to the queue items, which still draw each row, button and detail. Items with the same kind and the same needed action collapse into one group row (`web/src/views/HomeTodo.tsx`, HOME only; `kit/TodoRow` is unchanged): kind tag, count, the needed action, `최장 …` and one `펼치기 n` button. Expanding shows one row per item, each with its own button; a group row has no batch action (design-language 12). After grouping at most five lines show and the rest fold into the server's `나머지 n건 BACKLOG 3 …` with a `펼치기 n` button. The order is the server's; the web does not sort. With a kind filter chosen in the sidebar the same grouping is applied to that kind only (`web/src/home-todo.ts`, same rule as the server, tested against it) and nothing is folded. If `/api/flow` cannot be read HOME draws the queue line by line as before. The flow board's `n건 모두 아래 할 일에 있다 ↓` link (H3) calls `openTodoGroup(key)`; HOME expands that group (or the folded rest), opens the row and moves focus to it.
- **The default tab is HOME** now (RADAR was the default and no longer exists); the SINCE LAST LOOK line (ATC-383) is at the top of HOME.
- **Dropped:** the page titles `FOLLOW`, `STRIPS`, `FIDS`, `RADAR`, `RADIO` and the HUMAN CHECK block's `CHOICE·ACCOUNT·DEVICE PR만…` hint line. The strips are no longer a first-level view: they sit in the folded block of LIST.

### Y3 as built (ATC-378)

- SCHEDULE is no longer a tab. `#schedule` opens HOME (`web/src/legacy-hash.ts`); the queue item hash, the `pending|schedule` alert link and the DUTY card link now say `#home`. `Schedule.tsx`, its CSS, `ReadinessFold` and `scheduleLineParts` are deleted.
- **LATE WAYPOINTS** are (since ATC-422) a folded section `LATE WAYPOINTS n` at the top of the FLIGHTS LIST (`views/LateWaypoints.tsx`), drawn only when there is one; they were a HOME section. **LINEAR에서 직접 DONE** (approved CLOSE drafts, which OCC never writes) is a second section, also only when there is one. Both come from the new read-only `GET /api/schedule/home` (`mode`, `slips`, `closeManual`), so HOME does not load the whole SCHEDULE brief.
- **Drafts are approved in the QUEUE.** A SCHEDULE queue item has inline **승인** / **거절** (`ScheduleButtons`, one confirmation, reject takes a reason). In S2 it calls `/api/schedule/ops/:id/approve|reject`. TARGET and ROUTE have no apply path, so they get **동의** / **거절** and call `/verdict` (a recorded shadow verdict, nothing is written). The item carries OCC's reason line (`detail`, 240 characters) so the row says what it approves. The switch `SCHEDULE AUTO` only decides whether the server approves first; with it off, the drafts wait in the QUEUE.
- The S1 ↔ S2 switch moved to the BRAKES row (`SCHEDULE SHADOW — S2로`), the same route.
- NEW drafts stay RELEASE candidates (Y1); their link now says `HOME에서 승인`.
- Removed with the tab: the S1 verdict screen, CROSSCHECK chips, judge-family chips, the CANDIDATES, IN PROGRESS and RECENT tables and the READINESS fold (S2 gate numbers, ROUTES WITHOUT WAYPOINTS). In S1 a draft is not a queue item (as before), so with SCHEDULE AUTO off and S1 on nobody judges it and it expires after 3 days. The server routes (`/verdict`, `/crosscheck`, `/brief`) are unchanged.

### Y5 as built (ATC-380)

- METRICS has six sub-views, chosen by the address (`web/src/views/Metrics.tsx`): `#metrics` OPERATIONS, `#metrics/leaks` LEAKS, `#metrics/touches` TOUCHES, `#metrics/misfire` MISFIRE, `#metrics/fuel` FUEL, `#metrics/network` NETWORK. NETWORK is no longer a tab; `#network` opens `#metrics/network` (`web/src/legacy-hash.ts`). `Network.tsx` is unchanged and rendered inside METRICS.
- **MISFIRE** (`views/MetricsMisfire.tsx`, pure rows in `web/src/misfire-rows.ts`) takes the block that sat under OPERATIONS and covers every automatic lane for the last 7 days: one row per lane (switch, what the server did, MISFIRE, share; FLEET PLAN also shows failed applies), then the DISPATCH daily lines (`/api/dispatch/misfire`, unchanged) and the latest 10 SCHEDULE and FLEET PLAN misfires (`/api/autonomy/auto`, unchanged). No server change.
- The single-lane landings block (ATC-386) stays in OPERATIONS.
- Menu bar and server links to `#network`: none existed in `web/src`, `server` or `menubar`; only old bookmarks reach it.
- With NETWORK gone from the tab row, the row is HOME, RELEASE, FLIGHTS, FLEET and METRICS (Y6 left it in until this step).

### Y6 as built (ATC-381)

- The tab row shows HOME, RELEASE, FLIGHTS, FLEET and METRICS, plus NETWORK until METRICS takes it in (Y5); SCHEDULE left with Y3. The default tab was already `#home` (ATC-379).
- **AIRPORTS** is a settings category (`web/src/SettingsPanel.tsx`, `SETTINGS_INDEX`), rendering the unchanged register view, including the team-merge switch. `#airports` opens the settings window on it and leaves the current tab; the PR-alert links that pointed at `#airports` now point at `#flights` and `#home`.
- **GLOBE** is a view mode (`web/src/GlobeMode.tsx`): a header button or `#globe` / `#globe/<AIRPORT>` opens a full-screen window over the current screen; Escape or the close button returns to it. `views/Globe.tsx` is unchanged.
- **DOCS** is opened from a HELP menu in the header (`web/src/HelpMenu.tsx`); `#docs/<page>` still opens the Docs view, which stays a routed screen with no tab selected.

### Not built yet

Nothing from section 4 (Y1–Y6 are built). The shell around the five screens is section 7 (Z1–Z6).

## 5. Risks

- **An off switch brings an approval back with nowhere to go.** Principle 2: the item appears in the SUPERVISOR QUEUE on HOME, with its approve and reject buttons, so turning a lane off never needs the old tab.
- **Links break.** The queue's `hash` values, the menu bar and old bookmarks all point at today's tabs. `LEGACY_HASH` and `server/supervisor-queue.ts` change in the same step that retires an address.
- **Merge conflicts with daily screen PRs.** Many AIRCRAFT edit `Dispatch.tsx`, `Teams.tsx` and `App.tsx`. Small steps, one screen each, landed by MCC as they pass; no long-lived rebuild branch.
- **Something is lost in a move.** A step keeps every behaviour and every tooltip that carries information, the way ATC-280 did. The guide changes in the same PR.
- **The look stays generic.** Structure first (the FLEET experiment). If a screen still feels generic after its step, the SUPERVISOR names two or three screens they like, and the next step starts from those, not from new references.
- **Public repository.** No screenshots in PRs or issues; the PR describes the screen in text.

## 6. Decisions

Decided by the SUPERVISOR on 2026-10-02 ("추천대로 진행", on the recommendation in the ENGINEERING session):

- **D1.** RADAR becomes the radar view of FLIGHTS. GLOBE leaves the tab row and becomes a view mode. Both addresses keep working.
- **D2.** RELEASE is its own screen, not a block on HOME, because it is the one active daily job.
- **D3.** Order: RELEASE first, then DISPATCH and SCHEDULE taken apart, then FLIGHTS (section 4).
- **D4.** Five screens in the tab row: HOME, RELEASE, FLIGHTS, FLEET, METRICS. GLOBE, DOCS and AIRPORTS move out of it (section 3.2).

Open:

1. Whether the SUPERVISOR QUEUE stays in the DUTY drawer as well as on HOME. Proposed: both. The drawer is the quick view from any tab; HOME is the working view.
2. The name of HOME. atc uses aviation words; a better name can come with Y2.

## 7. Shell: rail, sidebar, drawer and CONTROL panel

Decided by the SUPERVISOR on 2026-10-02, over three rounds on a private structure mockup at their real width (about 1000 px) with example data. Rounds 2 and 3 answered with a screenshot and a list. Z1 and Z2 are built (see "Z1 as built" and "Z2 as built" below); Z3–Z6 are not. Z1–Z6 below are the steps.

### 7.1 Today

- **One header holds everything.**
  - `App.tsx` `header.console` holds:
    - the brand button (opens settings)
    - the tab row (HOME, RELEASE, FLIGHTS, FLEET, METRICS)
    - the readouts (AIRBORNE, STANDS, ENROUTE, FOLLOW next)
    - the DUTY button (`#duty`), HANDOFF and ALERTS, the bell (`AlertBell`)
    - GLOBE, HELP, the sound lock, the clock and LINK
    - the CONTROL strip (`ControlStrip.tsx`, one chip per control session)
  - The ticker and the ALERT list sit under it.
- **The control sessions live in two places.** The header strip shows chips only; clicking one opens `#fleet/control`, the CONTROL SESSIONS group inside FLEET (`views/fleet/ControlSessions.tsx`), where LAUNCH and STOP are.
- **RADIO was a FLIGHTS view** (`#flights/radio`, Y4). Z4 reverses this by the SUPERVISOR's decision E3 ("radio 는 좌측으로"): RADIO is a rail screen again (`#radio`, see "Z4 as built"). A FLIGHT's thread stays in its drawer.
- **The FLIGHT, PR, DUTY and IDEAS drawers open over the screen** from the right.
- **Nothing groups the work by AIRPORT** except inside each screen.

### 7.2 The shell

```
+------+---------------+-------------------------------+--------------+
| atc  | FLIGHTS  N  ? | [=] FLYING 29 WAITING 2  DUTY |  FLIGHT or   |
| HOME | > ATCC        |                               |  DUTY drawer |
| REL  |   ATC-435 *   |          the screen           |   (docked)   |
| FLT  |   ATC-410 *   |                               |              |
| RADIO| > APTB        |                               |              |
| FLEET|   ...         |-------------------------------|              |
| MTRX |               | ^ CONTROL 2  MCC NEEDS  XCK.. |              |
| SV   |               |   sessions | selected thread  |              |
+------+---------------+-------------------------------+--------------+
  rail    sidebar       top bar / screen / CONTROL       drawer
```
N = notifications (Linear, GitHub, atc), ? = search, [=] = sidebar fold, * = live session. The rail shows icons; the words above stand for them.

- **Rail (left, icons only).**
  - The screens: HOME, RELEASE, FLIGHTS, RADIO, FLEET, METRICS.
  - At the foot: GLOBE, HELP and settings (a SUPERVISOR mark, replacing the brand button).
  - Each icon has a tooltip and an accessible name. A count badge shows only what needs the SUPERVISOR (QUEUE items on HOME, READY on RELEASE).
- **Sidebar (next to the rail, folds).**
  - The list inside the selected screen:
    - FLIGHTS and FLEET: FLIGHTs and AIRCRAFT grouped under their AIRPORT, a dot for a live session
    - RELEASE: a section index (candidates, Todo before release, recent releases), each with its count (ATC-423)
    - RADIO: stations (control sessions, AIRCRAFT) as filters
    - METRICS: its sub-views
    - HOME: QUEUE and ALERTS as anchors
  - A button at the left of the top bar folds it; the choice is remembered in the browser.
  - The sidebar header holds the **notifications** (Linear, GitHub, atc), left of **search**. Search filters the sidebar list.
- **Top bar.** The readouts and the ALERT line as today. **DUTY** sits at the right and opens the DUTY drawer.
- **Drawer (right, docked).**
  - The FLIGHT / PR, DUTY and IDEAS drawers share one docked column; opening one closes the other.
  - The column takes width from the screen instead of covering it.
  - It keeps the dialog behaviour of ATC-406 where it makes sense for a docked region. Escape closes it, and focus returns to the opener.
- **CONTROL panel (bottom of the screen column, VS Code style).**
  - It holds the control sessions only: the table (state, last tick, model, what it is doing, LAUNCH / STOP) beside the selected session's recent radio.
  - Folded by default. Its one-line header is today's CONTROL strip: sessions that need the SUPERVISOR (NEEDS, DOWN) first, as chips with a word, then the rest.
  - It opens from its arrow, from a chip, or with Ctrl+\`. Its height is dragged and remembered. It never opens by itself (design-language principle 1).

### 7.3 Width

| Width | Behaviour |
|---|---|
| ≥ 1280 px | Rail, sidebar, screen and drawer all fit; opening a drawer keeps the sidebar |
| 861–1279 px (the SUPERVISOR's ~1000 px) | While a drawer is open the sidebar folds (the screen would be about 370 px wide otherwise) and comes back when the drawer closes; the remembered choice is not changed |
| ≤ 860 px | The rail becomes a bottom tab bar with labels. The sidebar opens over the screen from the left. The drawer covers the screen. The CONTROL panel is a sheet from the bottom. Its header shows only the NEEDS / DOWN chips and `OK n` for the rest, and its table becomes a two-line list per session |

The breakpoint is the 860 px of decision Q2 in [ui-refactor-plan.md](ui-refactor-plan.md); no new width is added.

### 7.4 What moves

| From | To | Address |
|---|---|---|
| Tab row in the header | Rail | unchanged (`#home` …) |
| Brand button (settings) | Settings mark at the rail foot | unchanged |
| GLOBE, HELP buttons in the readouts | Rail foot | unchanged |
| CONTROL strip in the header | CONTROL panel header | — |
| CONTROL SESSIONS group in FLEET | CONTROL panel body | `#fleet/control` opens the panel |
| RADIO view of FLIGHTS | RADIO screen on the rail | `#radio`; `#flights/radio` keeps working (`LEGACY_HASH`) |
| DUTY readout | DUTY button at the right of the top bar, opening the docked drawer | `#duty` unchanged |
| Bell in the readouts | Sidebar header, with Linear and GitHub | — |
| Drawers over the screen | Docked column | unchanged (`#flight/<KEY>` …) |

### 7.5 Steps

Each step is one work order and one PR, filed under [ATC-404](https://linear.app/vocado/issue/ATC-404) on 2026-10-02. They are in Backlog, and each shows as READY on the RELEASE screen once its blockers are done; Z1 waits for ATC-435 (`web/src/kit/`). A step moves a part and removes the old copy in the same PR (principle 5). Each step:
- uses the `web/src/kit/` primitives where they exist ([design-system.md](design-system.md));
- updates `docs/guide/screens.md`;
- is checked at about 1000, 1280 and 390 px in the three themes, and at 1000 and 1280 px with the FLIGHT drawer open, described in words.

| Step | What | Needs |
|---|---|---|
| Z1 ([ATC-442](https://linear.app/vocado/issue/ATC-442)) | **Shell grid, rail and top bar.** The tab row becomes the icon rail (Lucide, tooltips, names); settings, GLOBE and HELP move to the rail foot; the readouts and DUTY form the top bar; ≤ 860 px uses the bottom tab bar | — |
| Z2 ([ATC-443](https://linear.app/vocado/issue/ATC-443)) | **Screen sidebar.** The per-screen list (AIRPORT groups, live dots), the fold button and its remembered state, search filtering the list | Z1 |
| Z3 ([ATC-444](https://linear.app/vocado/issue/ATC-444)) | **Docked drawer.** FLIGHT / PR, DUTY and IDEAS share a docked column; the 861–1279 px fold rule; ≤ 860 px cover | Z1, ATC-406 (done) |
| Z4 ([ATC-446](https://linear.app/vocado/issue/ATC-446)) | **RADIO on the rail.** `#radio` becomes a screen with station filters in the sidebar; the FLIGHTS RADIO view and its copy are removed; `#flights/radio` maps to `#radio` | Z2 |
| Z5 ([ATC-445](https://linear.app/vocado/issue/ATC-445)) | **CONTROL panel.** The CONTROL strip and the CONTROL SESSIONS group move into the bottom panel; folded by default, resize, Ctrl+\`, the ≤ 860 px sheet and `OK n`; `#fleet/control` opens it | Z1 |
| Z6 ([ATC-447](https://linear.app/vocado/issue/ATC-447)) | **Notifications.** A read-only server route groups what needs the SUPERVISOR by source (Linear, GitHub, atc); the server decides what counts (design-language principle 4). The sidebar header shows the three icons with counts and lists. With the sidebar folded, one total sits beside the fold button | Z2 |

The header unit of the refactor plan (S8, ATC-432) waits for Z1: its stylesheet move and live regions apply to the top bar Z1 builds.

### S8 as built (ATC-432)

- **Stylesheet.** `web/src/App.css` (imported by `App.tsx`) holds the top bar (`.console`, readouts, LINK, DUTY, the fold button and brand text that Z1 added), the ticker, the ALERT list and its level colours, the NEW VERSION and UPDATE bars, the tab-error box, their `≤ 860 px` rules and their `night` rules. The matching blocks left `styles.css` and `Rail.css`. The import check owns `App.css` as HEADER.
- **Announcements.** `AlertLive.tsx` mounts two visually hidden regions: `role="status"` (polite: new CAUTION alerts, and a rise in the atc notification count) and `role="alert"` (assertive: new WARNING only). `alert-live.ts` (pure, tested in `server/alert-live.test.ts`) reads only keys that were not in the previous snapshot, nothing on the first load and nothing for ADVISORY, so a poll that changes nothing is silent. The ticker is not read line by line: its button is named `경보 n건, 목록 펼치기`. The ALERTS readout is named with its count. The opened list (`ul.alerts`) is a labelled list the SUPERVISOR opens, not a live region; the regions above announce what is new. The UPDATE and NEW VERSION rows were already `role="status"` and stay so. The old BELL count moved to the notifications (Z6, ATC-447); the rise in its `atc` count is announced by the same polite region.
- **Motion** (principle 10). Infinite in the header: the brand sweep (RADAR liveness, named in principle 10) and the UPDATE dot while an update runs (busy dot). The ticker runs twice and rests at its start, and keeps running only while a WARNING is on it; it still pauses on hover and focus.
- **Buttons.** The header buttons (`접기`, `새로고침`, `업데이트`, `다시 시도`, `PR n`, `닫기`) are `.btn` (`is-primary` for the one action); the bars set `--layer` for the face they sit on.
- **390 px.** The top bar is 86–88 px (the earlier audit measured 263 px) and the first HOME element starts at about 186 px of an 844 px screen, with the UPDATE bar showing.

### 7.6 Decisions (SUPERVISOR, 2026-10-02)

- **E1.** The rail holds icons only, and a sidebar beside it lists what is inside the selected screen, grouped by AIRPORT. The SUPERVISOR gave a screenshot of a desktop chat app as the model.
- **E2.** The FLIGHT drawer is docked on the right ("오른쪽 고정").
- **E3.** The bottom panel holds CONTROL only. RADIO goes to the left ("radio 는 좌측으로"); DUTY takes the notifications' old place at the top right and opens in the drawer ("duty는 알림 자리에(duty 는 서랍에서 열리도록)").
- **E4.** Notifications (Linear, GitHub, atc) sit left of search ("알림은 검색 좌측에"). With the sidebar folded, one total beside the fold button: the session's recommendation, accepted with "진행".
- **E5.** At narrow widths the CONTROL header shows only the sessions that need the SUPERVISOR and `OK n` for the rest. This answers the clipped chips in the SUPERVISOR's 390 px screenshot.
- **E6.** Between 861 and 1279 px an open drawer folds the sidebar until it closes (the session's proposal in the mockup, accepted with "진행").

### Z1 as built (ATC-442)

- **Grid.** `.app.shell` (`web/src/Rail.css`) is a CSS grid with the areas `rail sidebar main drawer`, columns `--rail-w` (56 px), `--sidebar-w` (0), `minmax(0, 1fr)` and `--drawer-w` (0). The sidebar (`aside.sidebar`) and the drawer column (`div.drawer-col`) are rendered empty and `hidden`, and `section.panel-area` (the bottom panel) sits at the foot of the main column; Z2, Z3 and Z5 fill those elements and do not rearrange. The existing overlay drawers and the GLOBE and settings windows are untouched until Z3.
- **Main column is a flex column, not nested grid areas.** `header.console` (the top bar) is `position: sticky`, and a sticky item inside a grid area cannot move past its own area. So the main column is a flex column: top bar (with the CONTROL strip as its last row), the notices (SUPERVISOR pairing, UPDATE bar, NEW VERSION bar, ticker, ALERT list), `main` (the screen), then the panel area. The page still scrolls as a whole.
- **Rail** (`web/src/Rail.tsx`). Icons only (Lucide through `kit/Icon`): HOME `House`, RELEASE `Rocket`, FLIGHTS `Plane`, FLEET `Users`, METRICS `ChartColumn`. Each is a button with an accessible name (the code, plus the count when there is one), `aria-current="page"` on the open screen, and a CSS tooltip (`data-tip`). Arrow Up/Down (and Left/Right on the bottom bar), Home and End move between the buttons; Tab reaches them too. Clicking one sets the screen as the old tab did (a drawer that is open stays open). Badges: HOME shows the QUEUE item count (`GET /api/supervisor/queue`, `items`), RELEASE the READY count (`GET /api/releases`, `ready`); both are read when the snapshot minute changes, as the screens do, and show nothing at 0. The brand mark sits at the top of the rail; its tooltip holds what the old brand showed (`ATC · LOCAL CONTROL · <port>`).
- **Rail foot.** GLOBE (a toggle, `#globe`), HELP (the same menu, opening beside the rail) and the SUPERVISOR mark (`UserRound`), which replaces the brand button and opens the same settings window (`#airports` still opens its AIRPORTS section).
- **Top bar.** Fold button (`PanelLeft`, `aria-disabled`, does nothing until Z2), then AIRBORNE, STANDS, ENROUTE, FOLLOW next, HANDOFF, ALERTS, the bell, the sound lock, the clock and LINK, and DUTY at the right (shown when DUTY is on; `#duty` as before). The ticker, ALERT list and the two version bars keep their place under it. Readouts wrap to a second line if the width is short.
- **≤ 860 px.** The rail becomes a fixed bottom tab bar with labels: the five screens, then GLOBE, HELP and settings as icon-only buttons (32 px wide, 55 px high). The top bar shows the brand text (`ATC · LOCAL CONTROL · <port>`) and DUTY on its first line and the readouts below; the fold button is hidden. The HELP menu opens upward from the bar.
- **Removed in the same PR.** The tab row, the brand button, the settings gear and their CSS (`.tabs`, `.tab*`, `.brand*`, the 861–1760 px second-row rule and the 860 px tab grid), and the `GLOBE` and `HELP` readouts.
- **Tokens added** to `:root`: `--rail-w`, `--bar-h`, `--sidebar-w`, `--drawer-w`.

### Z5 as built (ATC-445)

- **Panel** (`web/src/ControlPanel.tsx`, `ControlPanel.css`) fills `section.panel-area` at the foot of the main column. It replaces `ControlStrip.tsx` (deleted) in the top bar and the CONTROL SESSIONS group of FLEET (`ControlSessions` is now drawn by the panel; `Fleet.tsx` no longer renders it).
- **Header** (always one line): an arrow button (`aria-expanded`, `Ctrl+\``), `CONTROL` with the number of sessions that need the SUPERVISOR (NEEDS and DOWN), then one chip per session, DOWN, NEEDS, LATE, WORKING, OK in that order. Every chip has a dot and a word (`OK`, `WORKING`, `NEEDS`, `LATE`, `DOWN`) and the age of the last tick. The all-DOWN recovery button (ATC-255) stays here. At 860 px and narrower the header shows only the NEEDS, DOWN and LATE chips and one `OK n` chip for the rest.
- **Body** (when open): the CONTROL SESSIONS table of before (state, last tick, model, what it is doing, LAUNCH / STOP, ACCOUNT edit) at the left and, at the right, the selected session's recent radio (`GET /api/radio`, last 6 hours, what it sent or received, read only). With no selection it shows the first chip's session. At 860 px and narrower the panel opens as a sheet from the bottom, above the tab bar, with the table as the two-line list FLEET already uses and the radio below it.
- **Opening.** Folded by default and never opened by the page itself. It opens from the arrow, from a chip (which also selects that session), with `Ctrl+\`` (a second press closes it) and from an address: `#fleet/control` (the old address, kept for the settings link and the server alert links) opens the panel on the FLEET screen, and `#control` opens it on the current screen. The address is then reset to the screen's own. Escape closes it and returns focus to the arrow (an Escape inside an edit field only cancels the edit).
- **Height.** Drag the top edge or focus it and press Arrow Up / Down (24 px). The height is clamped to 160 px to 70 % of the window and remembered in this browser (`localStorage`, `atc.controlPanelHeight`; the panel works without it). The default is 320 px.
- **Reading.** The header chips are read every `CONTROL_POLL_MS` (60 s) while the tab is visible, as the strip was. The table and the radio are mounted only while the panel is open, so they read only then.
- **Pure parts** (`server/control-panel.ts`, `server/control-panel.test.ts`): chip order, `needingCount`, `narrowChipsOf` (`OK n`), height clamp and stored value, the Ctrl+\` test, `controlRadioOf`, `opensControlPanel`.
- **Pilot's discretion.** LATE chips stay visible at narrow widths (hiding a late session inside `OK n` would be wrong). A new `#control` address was added next to `#fleet/control`.
- **BRAKES tab (ATC-455, S1c).** The header has two real tabs after the arrow, `CONTROL` and `BRAKES` (`role="tablist"`; Arrow Left/Right, Home and End move between them with roving `tabindex`; the chosen tab is remembered in this browser, `localStorage` `atc.controlPanelTab`). Clicking a tab opens the panel on it; clicking the open tab folds the panel, as VS Code's panel does. Folded, the CONTROL chips stay as before; when a GROUND STOP is enforced or a manual stop is set, the BRAKES tab adds the count with a word (`BRAKES 2 STOPS`, never colour alone), otherwise nothing. The header is now always drawn (it was hidden before the session list loaded) so BRAKES is reachable on every screen. The BRAKES body is the former HOME line (`web/src/views/Brakes.tsx`): GROUND STOP and manual-stop counts, `ATFM…`, `STOP ALL…`, the automation switch line, the DISPATCH and SCHEDULE mode switches and `스위치 설정`; nothing opens before it is pressed. The confirmations are unchanged and still `confirm()` dialogs. `#control` and `#fleet/control` open the CONTROL tab. The sidebar's HOME anchor `BRAKES` is gone with the HOME section; HOME keeps the `AtfmAlert` banner. The pure parts are in `server/control-panel.ts` (`storedPanelTab`, `nextPanelTab`, `brakesTabWord`). Pilot's discretion: the panel and HOME each read `/api/atfm` (on the minute snapshot key), so a change made in the BRAKES tab shows on HOME's banner at the next read; and Home's Brakes code was removed in this PR (it is a pure deletion, so the HOME restructure S1b is not blocked).

### Z3 as built (ATC-444)

- **One column.** `div.drawer-col` (the last grid area from Z1) now holds the FLIGHT / PR, DUTY and IDEAS drawers. `App.tsx` renders one of them at a time (DUTY first), so opening one closes the other; their addresses (`#flight/<KEY>`, `#pr/<AIRPORT>/<n>`, `#duty`, `#ideas`, `#idea/<n>`) are unchanged. The column is `hidden` when no drawer is open.
- **Width.** `.shell[data-drawer]` sets `--drawer-w`: `clamp(360px, 44vw, 560px)` for FLIGHT / PR and IDEAS, `clamp(360px, 36vw, 440px)` for DUTY (a chat). The column is `position: sticky; height: 100dvh`, so the screen scrolls beside it. The backdrop is gone.
- **Sidebar rule (7.3).** From 861 to 1279 px an open drawer sets `--sidebar-w: 0` and hides `aside.sidebar` through `.shell[data-drawer]`; nothing is written to the remembered choice. Z2 fills the sidebar and keeps this selector (the sidebar does not exist yet, so only the rule is in place). At 1280 px and wider the sidebar keeps its width.
- **≤ 860 px.** The column is `position: fixed; inset: 0` and covers the screen; the bottom tab bar is under it. In this mode the drawer behaves as the ATC-406 modal again (`aria-modal="true"`, Tab trap).
- **ATC-406, what changed.** The hook `useDialog` takes `{ trap, restore }`. Docked (≥ 861 px): `aria-modal="false"`, no Tab trap (the screen stays usable), Escape closes unless the key came from a text field outside the drawer (`dockedEscapeAction`, tested); a text field inside the drawer still only gives up focus. Opening still moves focus into the drawer (and again when the drawer's item changes). Returning focus to the opener moved to `App.tsx` (`openerRef`), because a drawer is re-created when its item changes and loses the control that opened it. Kept as before: focus in on open, scroll to top on a new item, Escape handling in composition and for fields. The GLOBE window and the settings window are unchanged.

### Z2 as built (ATC-443)

- **Where.** `web/src/Sidebar.tsx` fills `aside.sidebar` (the grid area of Z1) and `web/src/Sidebar.css` styles it. `App.tsx` decides whether it is shown and wires the fold button in the top bar. The pure list logic (grouping by AIRPORT, ordering, folding of finished FLIGHTs, search) is `web/src/sidebar-rows.ts`, tested in `server/sidebar-rows.test.ts`.
- **Width.** `.shell.has-sidebar` sets `--sidebar-w` to the new token `--sidebar-open-w` (260 px). Folded, `--sidebar-w` stays 0 and the `aside` is `hidden`. The drawer rule of 861–1279 px (E6) is Z3's (`.shell[data-drawer]` sets `--sidebar-w: 0` and hides the aside while a drawer is open; the remembered choice is not touched). Z2's `.shell.has-sidebar` sets the open width, and the two selectors are kept apart by order in `Rail.css` / `Sidebar.css`.
- **Header.** The screen name, then a row with an empty slot for the notifications of Z6 (`.sb-notify`, no width while empty) left of the **search** box. Search filters this list only (FLIGHT key, title, AIRPORT, AIRCRAFT, state word). Esc in the box clears it first. The query is cleared when the screen changes.
- **What each screen lists.**
  - **FLIGHTS:** `snapshot.tickets` grouped under their AIRPORT (code, repository name, count). A FLIGHT is shown when it is triage, unstarted or started, or a live session holds it; the backlog is left out as in the FLIGHTS list, and finished ones (completed, canceled, duplicate) from the last 7 days sit behind `끝난 FLIGHT n` in each group. Order: live first, then started before unstarted, then priority, then key. A filled dot means a live session (`occupantsOf`). Choosing one sets `#flight/<KEY>`, which opens the drawer as before.
  - **FLEET:** `GET /api/fleet` (the call FLEET makes), with the status of a live session taken from the snapshot, under the AIRCRAFT's base AIRPORT, with a state word (AIRBORNE, IDLE, NORDO, ABSENT). Choosing one sets `#fleet/<REGISTRATION>`, and FLEET now also opens that row on `hashchange` (it only did on first load).
  - **RELEASE (ATC-423, decided 2026-10-03, Q7):** a section index, not the READY list (the list stays on the screen). Three items with their counts from `GET /api/releases`: 후보 (the issues the tree marks `fire`, plus the SCHEDULE NEW proposals), Todo 발권 전 (the tree's `release` rows) and 최근 발권 (the recent releases). Choosing one sets `#release/<candidates|unreleased|recent>` and the screen scrolls to that section; the section split is `partitionRelease` in `web/src/sidebar-rows.ts`, the same function the screen uses. The rail badge (READY count) is unchanged.
  - **METRICS:** OPERATIONS, LEAKS, TOUCHES, MISFIRE, FUEL, NETWORK, the open one marked `aria-current`.
  - **HOME:** the to-do list filtered by kind (ATC-422): 전체, QUEUE (the decisions), ALERT, STUCK, EFFECT, DONE (the approved CLOSEs to set Done by hand), each with its count, from `GET /api/supervisor/queue` (the call HOME makes). Kinds with no item are not listed. Choosing one sets `#home/<kind>` and HOME filters by it (`homeFilterOf` in `web/src/sidebar-rows.ts`); 전체 is `#home`.
- **One server addition, no new route.** `Ticket.airport` (an AIRPORT code or null) is set in `server/snapshot.ts` with `airportOfTicket`, the rule DISPATCH already uses (project mapping first, then the team default). The web had no way to know a FLIGHT's AIRPORT, and a second rule in the screen would break principle 4. It is not stored anywhere.
- **Fold.** The top-bar button (`aria-expanded`, `aria-controls`) folds and unfolds it; the choice is kept in this browser under `atc.sidebar` (`localStorage`, wrapped in try/catch, the sidebar is open when it cannot be read).
- **≤ 860 px.** The sidebar starts closed (the fold button is visible now). The button opens it over the screen from the left (`.shell.sidebar-over`, 320 px or 86 vw, above a transparent scrim); it closes when an item is chosen, on Esc, on a click outside, and when the rail changes the screen. Focus goes to the search box on open.
- **Keyboard.** Tab goes fold button → (top bar) … and search → items in order; every item is a button; the finished-FLIGHT fold is a `<details>`; Enter and Space work as usual.

### Z6 as built (ATC-447)

- **Route.** `GET /api/notices` (read only, `503` until the first snapshot) returns `{ v: 1, at, linear, github, atc }`. Each group is `{ total, items }` (items are cut at 30, `total` is the real count); an item is `{ key, text, source, at, link }`, and atc items also carry `action`. The pure function is `server/notices.ts` (`noticesOf`, tested in `server/notices.test.ts`); `server/notices-run.ts` only collects its inputs. There is no new outside call: the snapshot's PRs, the READY list of `GET /api/releases` (`releaseReadyNow`), the SUPERVISOR QUEUE (`supervisorQueueNow`, the same 5 s cache as `GET /api/supervisor/queue`) and `currentAlerts()`.
- **What counts.** linear: FLIGHTs that are READY for release (priority order, link to the Linear issue). github: the QUEUE's LANDING rows (PRs the SUPERVISOR merges: `user` tier, ESCALATE, HOLD, modes where MCC does not land) first, then open non-draft PRs whose checks failed (`checks-failed`), each PR once. atc: the alert list, unchanged (what the old BELL listed). The client counts linear and github as `total`, and atc as the items with `action` (WARNING, CAUTION, SUPERVISOR waiting) that are not acknowledged (same rule as the old BELL).
- **Sidebar header.** `NoticeIcons` (`web/src/Notices.tsx`) sits in `.sb-notify`, left of the search box: Linear (a plain mark, Lucide has no Linear icon), GitHub (`GitPullRequest`, Lucide dropped its GitHub mark) and atc (`Bell`), each with a count of items only (hidden at 0). A click opens a list under the header; Escape closes it and returns focus to the icon (the key is taken before the narrow sidebar's own Escape, so the sidebar stays open); a click outside closes it. An empty list says `평소 상태`. atc rows open their tab and ACK like the old BELL, with `모두 확인`; Linear and GitHub rows open the issue or PR in a new tab.
- **Folded.** With the sidebar not shown (folded, or ≤ 860 px closed) one total (`NoticeTotal`: bell icon and the sum of the three counts) sits beside the fold button (E4). It unfolds the sidebar, where the three icons are.
- **Header bell removed.** `AlertBell` is gone from the top bar. `SoundLockChip` stays in `AlertBell.tsx`. The data comes from one fetch in `App.tsx` (`useNotices`), refreshed when the snapshot minute or the number of alerts changes (no new polling).
- **Left out: Linear comments.** "New comments on FLIGHTs in flight" is not in this step: atc keeps no comment data in the snapshot, so it would need a new Linear call, which this route must not make. The linear group has the READY rows only; a comment feed is a separate FLIGHT.

### Z4 as built (ATC-446)

This reverses the RADIO part of Y4 ([ATC-379](https://linear.app/vocado/issue/ATC-379)), by the SUPERVISOR's decision E3.

- **Where.** `RAIL_SCREENS` in `web/src/Rail.tsx` gets `RADIO` (Lucide `Radio`) between FLIGHTS and FLEET, and `App.tsx` maps `#radio` to the screen `web/src/views/Radio.tsx` (loaded lazily like the other screens). The screen is the FLIGHTS RADIO view moved as is: the full log, frequency chips, the AIRPORT select, LISTEN, REPLAY and the live SSE feed. Nothing was dropped. One control moved: the AIRCRAFT select is replaced by the sidebar's stations (below), so there is one way to filter by AIRCRAFT, not two. A value saved by the old select under `atc.radio.aircraft` is no longer read.
- **Removed in the same PR.** The RADIO entry of `VIEWS` (`web/src/legacy-hash.ts`) and the `view === "radio"` branch of `Flights.tsx`. `viewOfHash("#flights/radio")` is now LIST.
- **Addresses.** `#flights/radio` (and `#flights/radio/<station>`) maps to `#radio` (`canonicalHash`), so old bookmarks and links keep working. The plain `#radio` entry of `LEGACY_HASH` is gone because `#radio` is a screen again. Links that pointed at `#flights/radio` now point at `#radio`: FOLLOW's `살펴보기` chip (`server/follow.ts`, also the `GET /api/status` next-action), the CONTROL panel's "전체 RADIO 기록" link, the GLOBE airport's "RADIO에서 … 보기" link (it still sets the AIRPORT filter in `atc.radio.airport`).
- **Sidebar.** On `#radio` the sidebar (`web/src/Sidebar.tsx`) lists **all** and then the stations of the last 6 hours, each with its count of transmissions (a transmission counts for its sender, its receiver and its `aircraft`, once each; `ALL` broadcasts and the placeholder names `?`, `AIRCRAFT` and `CROSSCHECK` count for no station, so the PREFLIGHT lines of an AIRCRAFT, whose `aircraft` is named in neither `from` nor `to`, show under that AIRCRAFT). Two groups: **CONTROL** (TOWER, OCC, MCC, REVIEW, DUTY in that order, then other control names by name) and **AIRCRAFT** (by REGISTRATION). It reads the call the screen already makes, `GET /api/radio`, when the snapshot changes; there is no new route. Search filters the stations.
- **The filter is the address.** Choosing a station sets `#radio/<station>` (REGISTRATION for AIRCRAFT, e.g. `#radio/TEAM_E`); **all** sets `#radio`. The screen reads the address and shows only the transmissions with that station as sender or receiver, together with the frequency chips and the AIRPORT select. The rule is pure and tested: `stationOf`, `stationPasses`, `filterByStation`, `stationsOf` and `stationOfHash` in `web/src/radio-log.ts`, tests in `server/radio-log.test.ts`.
- **FLIGHT drawer.** `FlightRadio.tsx` keeps the thread; its link goes to `#radio/<AIRCRAFT of that FLIGHT's calls>`, or `#radio` when no call names an AIRCRAFT.
- **Narrow.** At ≤ 860 px the rail is the bottom bar with RADIO in it, and the sidebar opens over the screen as for the other screens.
- **Pilot's discretion.** The stations are counted from the same 6-hour window as the log. The sidebar's counts update when the snapshot does (about a minute), not on every SSE line.
