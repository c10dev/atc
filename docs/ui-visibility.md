# UI visibility design

> Status (2026-09-29): draft, not adopted. Written for ATC-116 from a visibility review of the running screen on 2026-09-29. Nothing here is built. The quick fixes from the same review are separate and already merged: ALERT levels (ATC-110), the dark cockpit on RADAR and STRIPS (ATC-111), the FIDS ARRIVED cap (ATC-112). DISPATCH and SCHEDULE "decisions first" (ATC-113) is a related issue. Once a step is adopted, its issue links this document. Steps 1, 4 and 10 (badges, title and notifications) and the ticker half of step 5 are redesigned by [alerting.md](alerting.md) (ATC-195). Step 2 (the queue data) is adopted by [duty.md](duty.md) as its step Q1 (ATC-192, 2026-09-30). The SUPERVISOR decided that the queue is shown in the DUTY drawer, so step 3's own drawer is not built (duty.md section 7). Section 3.2 (tabs by task) and decision 4 are replaced by [layout.md](layout.md) (2026-10-02): under the arrow the DECISIONS tab has no work left.

Related: [fleet.md](fleet.md) 8.5 (CONTROL SESSIONS and the header CONTROL strip), [dispatch.md](dispatch.md), [atfm.md](atfm.md), [guide/screens.md](guide/screens.md) (what each tab shows today).

## 1. Current facts

Measured on the running atc on 2026-09-29 at 1600×1000, and read from the code. Counts and atc's own terms only.

| Tab | Screens tall | Words | Where the first thing to act on sits |
|---|---|---|---|
| DISPATCH | 6.9 | 2,572 | The first ASSIGN is about 3,200 px down |
| FIDS | 5.5 | 3,217 | 102 of 137 rows are ARRIVED (ATC-112 caps that) |
| SCHEDULE | 5.4 | 2,464 | CANDIDATES sit two screens down |
| NETWORK | 2.3 | 542 | Nothing to act on |
| STRIPS, FLEET, RADAR | 1.2–1.4 | 377–703 | Fine |

- **What waits on the SUPERVISOR is spread over four tabs and one bar.** Proposals to judge: DISPATCH and SCHEDULE (`proposed` proposals, `draft` SCHEDULE ops). HUMAN CHECK and CLEARED PRs: STRIPS. FLEET PLAN approvals: FLEET. UPDATE: the bar under the header. Also a `blocked` background job (NEEDS YOU, ATC-99) and a CAPTAIN that waits for the SUPERVISOR's go (`await-supervisor` in FLIGHT FOLLOWING, ATC-120). No tab has a badge and there is no single list.
- **Bars above the content.** The console (brand, 10 tabs, readouts), the UPDATE bar (only when the service is behind), the scrolling ALERT ticker (only when an ALERT is actionable) and, since ATC-127, the CONTROL strip. The measured header is 109 px tall at 1280 and 1600 px and 78 px at 1800 px, before the UPDATE bar and the ticker. The ticker moves, which makes it hard to read.
- **10 tabs, ordered by data source, not by task:** RADAR, STRIPS, FIDS, AIRPORTS, FLEET, METRICS, NETWORK, DISPATCH, SCHEDULE, DOCS. NETWORK holds the route map. `LEGACY_HASH` in `web/src/App.tsx` already keeps old `#map`, `#teams` and `#tickets` links working, and a tab may own its sub-path (`#fleet/control`, `#docs/…`).
- **Keyboard and title.** `keydown` handlers exist in the settings window (Escape), in FIDS and in a few panels. There is no global shortcut, no palette and no search. `document.title` never changes, so a background browser tab says nothing. The code never calls the browser Notification API, so ATC-87 (a notification and a sound by ALERT level) is still open.
- **Data that already exists.** ALERT levels (`alertLevel` in `web/src/aviation.ts`): WARNING and CAUTION count, ADVISORY only folds. The snapshot carries `alerts`, `pulls` (with `humanCheck`), `sessions` (with `job`, health), `handoffs`. Proposals, SCHEDULE ops, FLEET PLAN, FOLLOWING and UPDATE are separate endpoints (`/api/dispatch/brief`, `/api/schedule/brief`, `/api/fleet/plan`, `/api/following`, `/api/update`) that each tab or bar reads on its own.

## 2. Principles

> Adopted on 2026-10-01 through [design-language.md](design-language.md) (DL6), which now holds these principles with a review check each. The list below is kept as written; the rest of this document stays a draft.

1. **Quiet when normal.** A screen with nothing to act on shows a few words and no color. Color, motion and counts are for things a person can act on.
2. **One place for what needs me.** Everything that waits on the SUPERVISOR is one list with one count. Each row links to where it is decided.
3. **Never hide, only fold.** Every existing view stays reachable. A fold shows a count and one click opens it; nothing is deleted or moved out of reach.
4. **Decide where the context is.** The queue links; it does not decide. A verdict, an approval or a merge stays on the screen that shows its evidence (a later step may add judge keys to that screen, not to the queue).
5. **Same words everywhere.** Aviation terms in English. The new list gets a name that is not NEEDS YOU: NEEDS YOU is the state of one background job (ATC-99), the queue is the list of decisions.
6. **Static beats moving.** Status is chips and counts. Only a new WARNING may draw the eye.

## 3. Design

### 3.1 SUPERVISOR QUEUE

**What the pattern gives.** Linear's Inbox and GitHub's "review requested" are one list of items addressed to me, newest waiting first, with a count and a link to the item. atc takes the single list, the count and the link. It leaves out mark-as-read and snooze: an item leaves the queue only when the underlying state changes (the proposal is judged, the PR is merged), so the queue can never disagree with the screens.

**Items** (kind, the state that puts it in the queue, where the row links):

| Kind | In the queue while | Links to |
|---|---|---|
| PROPOSAL | a DISPATCH proposal is `proposed` | `#dispatch`, that proposal |
| SCHEDULE | a SCHEDULE op is `draft` and no verdict yet | `#schedule`, that op |
| FLEET PLAN | a FLEET PLAN proposal is `open` and not stale | `#fleet` |
| HUMAN CHECK | a PR waits for a human UI check | `#strips`, that PR |
| LANDING | a CLEARED PR whose LANDING CLEARANCE tier is `user` (the SUPERVISOR merges) | `#strips`, that PR |
| UPDATE | the service is behind `origin/main` and main CI passed | the UPDATE bar |
| NEEDS YOU | a background job is `blocked` for longer than `health.blockedMin` (input from ATC-99, settled by ATC-133 and ATC-138) | `#fleet`, that AIRCRAFT |
| GO | a CAPTAIN waits for the SUPERVISOR's go (`await-supervisor`) | `#fleet`, that AIRCRAFT |

PRs that MCC lands (`auto`, `flagged`) are not in the queue. ADVISORY alerts are not. WARNING and CAUTION alerts stay in ALERTS: an alert says something is wrong, a queue row says something waits for a decision, and one event can be both.

**Shape.** `QueueItem { kind, key, since, title, hash }`, sorted oldest `since` first. `title` uses atc's own terms (a FLIGHT key, a REGISTRATION, a PR number). It never carries a ticket title. A pure function `supervisorQueueOf(inputs, now)` in a new `server/supervisor-queue.ts` builds the list from the inputs above; the route `GET /api/supervisor/queue` only gathers the inputs. Each kind also gets a per-kind count for the badges in 3.3.

**Where it lives** (three options):

| Option | For | Against |
|---|---|---|
| A new tab | Room for many rows, its own address `#queue` | An 11th tab; one more place to remember to look |
| A drawer opened from a header readout | Reachable from every tab in one click; same pattern as the ALERTS list | Limited room; not linkable unless it has a hash |
| Inside RADAR's header | Visible on the first screen | Only on RADAR; RADAR is not where decisions are made |

**Proposed:** the drawer, opened by a `QUEUE nn` readout next to ALERTS (amber when any row is older than a threshold, never red). It gets the address `#queue`, so a link opens it over any tab. When the tabs are regrouped (3.2), the DECISIONS tab shows the same list as its first block, so the drawer is the quick view and the tab is the working view.

### 3.2 Tabs by task

**What the pattern gives.** Task-oriented navigation groups by what the person is doing, not by which API feeds the view. atc takes the grouping. It leaves out nested menus: a tab may have a sub-nav (`#fleet/control` already does), but the top level stays one row.

| New tab | Holds (today's tab) | Task |
|---|---|---|
| LIVE | RADAR + STRIPS | What is flying and who holds which STAND now |
| DECISIONS | DISPATCH + SCHEDULE, with the queue on top | Judge what atc and OCC propose |
| FLIGHTS | FIDS + NETWORK (route map) | Where each FLIGHT is |
| FLEET | FLEET + AIRPORTS | Who can fly and where they are based |
| READINESS | METRICS, the stage gates and 2b checklists now inside DISPATCH and SCHEDULE | Is automation earning its next stage |
| DOCS | DOCS | Read |

Each new tab keeps the old views as sub-sections with sub-paths, and `LEGACY_HASH` gains every old address (`#dispatch` → `#decisions/dispatch`). A tab is a stack of sections with a sticky sub-nav, so a section is one click away and stays a real view, not a merge of two pages. ATC-113 (decisions first) is a prerequisite for DECISIONS: a folded readiness line at the top of DISPATCH and SCHEDULE is what makes the merge readable.

**Left out:** merging the views' code. Steps only re-route and add the sub-nav.

### 3.3 Tab badges and the browser title

**What the pattern gives.** Chat and mail apps put unread counts on tabs and in the window title, and tint the icon only for urgent items. atc takes counts on tabs, `(n) ATC` in `document.title`, and the tint. It leaves out sound and popups here: those belong to ATC-87 and stay behind that issue.

- **Tab badge** = the queue's per-kind count for that tab (DECISIONS: PROPOSAL + SCHEDULE; STRIPS or LIVE: HUMAN CHECK + LANDING; FLEET: FLEET PLAN + NEEDS YOU + GO). Zero shows nothing.
- **Title** = `(n) ATC`, where `n` is the queue count plus actionable alerts; with a WARNING it is `(n!) ATC`. Restored to `ATC` when both are 0.
- **Favicon tint** only for WARNING, never for CAUTION or the queue.
- **ATC-87 alignment.** The browser notification fires once per key when a WARNING (or CAUTION, by setting) appears, using the ATC-110 level. The queue and the title are read-only summaries and never notify. Both read the same level function so they cannot disagree.

### 3.4 Cmd+K palette and global search

**What the pattern gives.** Linear, GitHub and editors open a palette with Cmd/Ctrl+K: type to find an object or a command and jump to it. atc takes jump-to-object across FLIGHT, AIRCRAFT/REGISTRATION, STAND, PR and AIRPORT, plus the tab names. It leaves out commands that change state: the palette navigates, it never launches, stops, approves or merges.

- **Index.** Built in the browser from the snapshot (tickets, sessions, workspaces, pulls, airports): a pure function `searchIndexOf(snapshot)` and `searchOf(index, query)`, so it needs no API. Result rows carry a `hash` to open.
- **Keys.** Cmd/Ctrl+K opens, Escape closes, arrows and Enter pick. `j`/`k` move a selection and `a`/`r` (approve, reject) act on a proposal list only when the list has focus and the list's own screen defines them (a later step, DECISIONS).
- **No clash.** Shortcuts are ignored while an `input`, `textarea`, `select` or contenteditable has focus, and while the settings dialog is open (its Escape and focus trap win). The palette itself traps focus like the settings window.
- **Touch and small screens.** A header search button opens the same palette; there is no shortcut dependency.

### 3.5 One status strip

**What the pattern gives.** A single status line (an editor's status bar, an operations console's top line) replaces several banners. atc takes one line: readouts, UPDATE state, the CONTROL chips and the top-level alert summary as static chips. It leaves out the scrolling ticker.

- **Contents, left to right:** the existing readouts (AIRBORNE, STANDS, ENROUTE, HANDOFF), `QUEUE nn`, ALERTS `nn` with `+n ADV`, an UPDATE chip (state and, when behind, the start button), the CONTROL chips (ATC-127) folding into `CTRL n/6` when narrow, LINK.
- **Alerts without a ticker:** the top alert (WARNING first, then oldest CAUTION) is one static chip with its message and the count of the rest; clicking opens the list. New WARNINGs appear once (a short highlight, no motion loop) and `prefers-reduced-motion` removes even that.
- **Height budget:** at most two rows at 1280 px including the tabs row, one row under 768 px with the fold. The UPDATE bar and the ticker are removed as separate rows; the UPDATE bar's states (starting, running, restarting, refused) stay as the chip's states and its detail opens in the drawer.
- **Left out:** the NewVersion bar ("a new version was deployed, reload") stays its own bar: it needs a click and is rare.

### 3.6 Progressive disclosure for strips

**What the pattern gives.** ERAM's limited and full data blocks show one line by default and the full block when selected. FLEET's list with row expand is the model already in the code (the FLEET row and its card). atc takes that for FLIGHT STRIPS on STRIPS and for DISPATCH and SCHEDULE cards: a one-line summary with the state and the one thing to do, the full card on select, `Esc` or a second click to fold. It leaves out hiding by default anything that needs action: a row that waits on the SUPERVISOR is always at least one line and never folded into a summary count alone.

## 4. Implementation order

Each step is small enough to become one ATC issue. "Snapshot" means the SSE snapshot shape; "API" means a route.

| # | Step | Files | Snapshot / API |
|---|---|---|---|
| 1 | Title badge and tab badges from counts that already exist in the snapshot (actionable alerts, HUMAN CHECK PRs, `blocked` jobs) | `web/src/App.tsx`, new `web/src/badges.ts` (pure) | No change |
| 2 | `supervisorQueueOf` and `GET /api/supervisor/queue`, with tests for every kind | new `server/supervisor-queue.ts`, `server/index.ts` (route) | New API, read-only; no snapshot change |
| 3 | SUPERVISOR QUEUE drawer and the `QUEUE nn` readout, address `#queue` | new `web/src/SupervisorQueue.tsx`, `web/src/App.tsx`, `web/src/styles.css` | Reads the new API |
| 4 | Queue counts feed tab badges and the title (replaces step 1's sources) | `web/src/badges.ts`, `web/src/App.tsx` | Reads the new API |
| 5 | One status strip: chips replace the ALERT ticker and the UPDATE bar | `web/src/App.tsx`, `web/src/UpdateBar.tsx`, `web/src/Ticker.tsx` (removed), `web/src/ControlStrip.tsx`, `web/src/styles.css` | No change |
| 6 | Cmd+K palette: `searchIndexOf`, `searchOf`, the dialog and key handling | new `web/src/search.ts` (pure), `web/src/Palette.tsx`, `web/src/App.tsx` | No change |
| 7 | Tabs by task: sub-nav, new tab ids, `LEGACY_HASH` for every old address | `web/src/App.tsx`, the views' hash reading (`Dispatch.tsx`, `Schedule.tsx`, `fleet/Fleet.tsx`, `Network.tsx`), `docs/guide/screens.md` | No change |
| 8 | Progressive disclosure for FLIGHT STRIPS and proposal cards | `web/src/views/Teams.tsx`, `Dispatch.tsx`, `Schedule.tsx` | No change |
| 9 | `j`/`k` and judge keys on proposal lists | `Dispatch.tsx`, `Schedule.tsx`, a shared key helper | No change |
| 10 | Browser notification by ALERT level and the favicon tint (ATC-87 owns the notification) | `web/src/notify.ts`, `web/src/App.tsx` | No change |

Order rationale: 1 is a small win with no new data. 2–4 make the list, then point the badges at it. 5 removes the two bars once the chips they need exist. 6 is independent and can go any time after 1. 7 is the largest change to habits and comes after the queue proves out; it needs ATC-113. 8–10 are refinements. Every step keeps the old `#hash` links working, and the docs pair (`docs/guide/screens.md`) changes with the step that changes what the user sees.

## 5. Risks

- **The queue disagrees with a screen.** Mitigated by deriving it from the same functions the screens use (no second copy of a rule), and by having rows leave only when the underlying state changes.
- **A badge that never clears trains people to ignore it.** Each kind's condition ends by a real state change; a stale FLEET PLAN proposal (`stale`) is left out of the count.
- **Polling cost.** The queue route reads several sources. It should cache for a few seconds (like the 30 s `claude agents` cache in ATC-127) and the browser should read it about every 15 s while the tab is visible, or the count should ride on the snapshot in a later step.
- **Shortcut clashes.** Cmd/Ctrl+K is taken by some browsers (address bar in some, search in others). Keep a visible button as the primary path; ignore shortcuts inside inputs and the settings dialog.
- **Tab regrouping breaks bookmarks and habits.** `LEGACY_HASH` covers addresses; the sub-nav keeps every old view one click away; the docs guide changes in the same PR as the tabs.
- **Header height.** The status strip must stay within two rows at 1280 px; the CONTROL chips fold below 768 px already.
- **Public repository.** The queue and the palette show what the running atc knows, including ticket keys and titles. The design keeps `title` to atc's own terms and counts so screenshots, docs and PRs never need other repositories' names.

## 6. Decisions

Open, for the SUPERVISOR:

1. Queue placement: the drawer with a `#queue` address (proposed), a tab, or the RADAR header.
2. Whether LANDING belongs in the queue only for `user`-tier PRs (proposed), or for every CLEARED PR.
3. Whether the browser title counts the queue plus actionable alerts (proposed) or only the queue.
4. Tab grouping: the table in 3.2 (LIVE, DECISIONS, FLIGHTS, FLEET, READINESS, DOCS) or a smaller change (only DISPATCH + SCHEDULE → DECISIONS).
5. Whether the NewVersion bar stays separate (proposed) or joins the strip.

Decided by this draft (pilot's discretion, reversible): the palette navigates only and never changes state; the queue never notifies; ADVISORY never counts in a badge or the title.
