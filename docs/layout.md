# Layout: atc's screens after the arrow

Status (2026-10-02): design draft. The SUPERVISOR chose the direction on 2026-10-02 ("추천대로 진행", section 6). Nothing here is built. This draft replaces [ui-visibility.md](ui-visibility.md) 3.2 (tabs by task) and its open decision 4, and sets the order of [design-language.md](design-language.md) step L4 (the tab audit). Written in an ENGINEERING session; DUTY or ENGINEERING update the status after merge.

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
| METRICS | OPERATIONS, LEAKS, FUEL | results | METRICS |
| NETWORK | read-only ROUTE map, targets, 28-day trends | results | METRICS |
| AIRPORTS | open, rename, close, team merge switch | rare maintenance; the switch is K3 | settings |
| GLOBE | read-only globe | ambient | view mode, out of the tab row |
| DOCS | guide, changelog | help | help menu |

### 3.2 The new screens

| Screen | Address | Job | What it holds |
|---|---|---|---|
| HOME | `#home` (default) | approve K1–K3, watch exceptions, pull a brake | Empty when normal (design-language principle 1). <br>• The SUPERVISOR QUEUE (once the switches are on, only K1–K3 items and leaks). <br>• WARNING / CAUTION ALERTs. <br>• Stuck FLIGHT lines and LATE WAYPOINTS. <br>• One neutral row of fleet-wide brakes (GROUND STOP, STOP ALL, the automation switches and their state). |
| RELEASE | `#release` | fire | The candidates: READY Backlog issues, agent proposals (SCHEDULE NEW, DUTY drafts), and Todo issues that are not released. Firing = Todo + priority + the declared K effects, recorded as a release (ATC-362), with recent releases by channel. |
| FLIGHTS | `#flights` | watch, per FLIGHT | One set of FLIGHTs from Todo to IN, with stage dots and the PR's landing state. <br>• Views: list (FOLLOW rows, default), board (FIDS), radar (RADAR). <br>• Per-FLIGHT brakes (CANCEL, RECALL) sit on the row and in the drawer. <br>• The FLIGHT drawer shows that FLIGHT's radio thread. The full RADIO log is `#flights/radio`. |
| FLEET | `#fleet` | maintenance, per-AIRCRAFT brakes | As today, with the ATC-280 card and control sessions. FLEET PLAN becomes a record line, not an approval. |
| METRICS | `#metrics` | read results | OPERATIONS, LEAKS, MISFIRE for every automatic lane (DISPATCH, SCHEDULE, FLEET PLAN), FUEL, and NETWORK (ROUTE progress, trends). |

Outside the tab row:
- GLOBE as a full-screen view mode, from a header button (`#globe` still opens it)
- DOCS in a help menu
- AIRPORTS inside the settings window

The FLIGHT, PR, DUTY and IDEAS drawers stay as they are.

The tab row is then five: HOME, RELEASE, FLIGHTS, FLEET, METRICS.

## 4. Implementation order

Each step is one work order (filed 2026-10-02, linked below) and one PR. The tier is `auto` unless a step touches a `user` path. Each step updates `docs/guide/` (at least `screens.md`), adds a changelog fragment, and follows the design-language checklist. Its Playwright pass runs at the SUPERVISOR's real width (about 1000 px), as well as at 1280 and 390 px, with seeded data.

| Step | What | Needs |
|---|---|---|
| Y1 ([ATC-376](https://linear.app/vocado/issue/ATC-376)) | **RELEASE screen.** Move the release block out of DISPATCH into `#release` and add the candidates (READY issues and agent proposals) next to the unreleased Todo issues. DISPATCH links there until Y2. | ATC-362 ✅ |
| Y2 ([ATC-377](https://linear.app/vocado/issue/ATC-377)) | **HOME, and DISPATCH taken apart.** Create `#home` with the queue, ALERTs and the brakes row. Move ATFM and the departure stop to the brakes row, CANCEL / RECALL to the FLIGHT row and drawer, MISFIRE to METRICS. Remove the verdict, CROSSCHECK and BLIND UI. The assignment history becomes a record in the FLIGHT drawer. `#dispatch` goes to `#home`. | ATC-367 ✅, ATC-371 |
| Y3 ([ATC-378](https://linear.app/vocado/issue/ATC-378)) | **SCHEDULE taken apart.** LATE WAYPOINTS to HOME. NEW drafts to RELEASE candidates. Remove the verdict UI and READINESS. `#schedule` goes to `#home`. | ATC-370 |
| Y4 ([ATC-379](https://linear.app/vocado/issue/ATC-379)) | **FLIGHTS.** One screen with list, board and radar views, built from FOLLOW, STRIPS, FIDS and RADAR. RADIO becomes a sub-view and a drawer thread. HUMAN CHECK items move to HOME. Old addresses map to the views. | Y2 |
| Y5 ([ATC-380](https://linear.app/vocado/issue/ATC-380)) | **METRICS.** Take in NETWORK and MISFIRE from every automatic lane. | Y2, Y3 |
| Y6 ([ATC-381](https://linear.app/vocado/issue/ATC-381)) | **Small moves.** AIRPORTS into settings, GLOBE to the view mode, DOCS to the help menu, the default tab to `#home`. The tab row is now five. | Y4 |

Order rationale (decision D3): firing has no home and is used every day, so it comes first. The two views whose job is gone hold most of the code and most of the words, so they go next; HOME is built in Y2 because the parts taken out of DISPATCH need a place to land. FLIGHTS changes the most habits, so it comes once the rest has settled.

### Not built yet

Everything (Y1–Y6).

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
