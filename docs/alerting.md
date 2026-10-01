# ALERTING: what gets the SUPERVISOR's attention, and where it goes

Status (2026-09-30): design draft for [ATC-195](https://linear.app/vocado/issue/ATC-195/alerting-split-bell-into-master-attention-alerts-conditions-queue). The SUPERVISOR said it is unclear what ALERTS and the BELL each do and asked for their goals to be redesigned. Nothing here is built. The SUPERVISOR's decisions are in section 7.

## 1. Current facts

**The header has two lists and a moving strip for overlapping things** (2026-09-30, `web/src/App.tsx`, `web/src/AlertBell.tsx`):

| Element | Source | What it holds | Count | Goes away when |
|---|---|---|---|---|
| **ALERTS** readout, list and the moving **ALERT** ticker under the header | snapshot `alerts` (`AlertKind`: `conflict`, `orphan`, `unattended`, `no-workspace`, `stranded`, `health`) plus recent HANDOFFs | Conditions, by ATC-110 level | WARNING + CAUTION, with `+n ADV` beside it | The condition clears |
| **BELL** readout and list | `supervisorAlertsOf` (`server/supervisor-alerts.ts`, ATC-87), 8 groups | Conditions, decisions, results and FYI, mixed (below) | WARNING, CAUTION and `cue: call` items not yet ACKed | The item's key disappears, **or the SUPERVISOR ACKs it** |
| SUPERVISOR QUEUE (designed, not built) | `supervisorQueueOf` (Q1, [ATC-194](https://linear.app/vocado/issue/ATC-194/duty-q1-supervisor-queue-data-supervisorqueueof-and-get)) | Decisions that wait | Open rows | The decision is made |

**What the BELL mixes**, item by item (`supervisorAlertsOf`, keys unchanged since ATC-87):

| Key prefix | Group | Level · cue | What it really is |
|---|---|---|---|
| `alert\|…` | `alert`, `health` | the ATC-110 level | A **condition**. The same item is also in ALERTS |
| `pending\|tool\|…` | `pending` | advisory · call | A **decision**: a tool call waits for approval (NEEDS YOU) |
| `pending\|proposal\|…`, `pending\|schedule\|…`, `pending\|humancheck\|…` | `pending` | advisory · call | **Decisions**: a DISPATCH or SCHEDULE verdict, HUMAN CHECK |
| `following\|…` | `following` | warn → caution, info → advisory | Mostly **conditions** (UNABLE, LAUNCH failed). `await-supervisor` is a **decision** (GO) |
| `land\|…` | `land` | advisory | CLEARED TO LAND. It is a **decision** for `user`-tier PRs and an **event** for PRs that MCC lands |
| `rts\|…` | `rts` | ok: done cue; refused: caution; failed or rollback: warning | **Events**. A ROLLBACK also leaves a **condition**: RTS stays stopped until the SUPERVISOR picks the MCC mode again |
| `recycle\|<session>\|<t>` | `recycle` | ok: advisory; failed: caution | **Events**. A failed LAUNCH also leaves a **condition**: the control session is down |
| `recycle\|over\|…`, `recycle\|wait\|…`, `cap\|other\|…` | `recycle` | advisory, caution, advisory | **Conditions** |
| `reposition\|…` | `reposition` | auto: advisory; failure: caution; flap: advisory | **Events**. A failure can leave a condition (the base changed but LAUNCH failed) |

**Other facts:**

- **ACK means two things.** In the BELL, ACK hides an item from the count. For a condition, that means "seen". For a decision, the count drops while the decision still waits.
- **Sound and notifications follow the BELL items** (`web/src/alerts-runtime.ts`, `soundOfAlert`):
  - WARNING repeats until ACK;
  - CAUTION and CALL sound once;
  - DONE is off by default;
  - ADVISORY is silent.
- **The summary already has a "master".** `GET /api/supervisor-summary` (`server/supervisor-summary.ts`, [mac-app.md](mac-app.md)) returns `master: "warning" | "caution" | null`, `counts` by level over all BELL items, and `pending` counts by key prefix. ANNUNCIATOR (the Mac app) and the SwiftBar plugin show it. `counts` also include decisions and events, because they are counted over the same mixed list.
- **Other header elements:** the UPDATE bar (a decision), the CONTROL strip (a condition per control session) and the sound-lock chip.
- **Related designs:**
  - [ui-visibility.md](ui-visibility.md): step 1 and step 4 badges, step 5 "one status strip", which removes the ticker and the UPDATE bar, and step 10 notifications (done as ATC-87);
  - [duty.md](duty.md): the QUEUE lives in the DUTY drawer.

## 2. Principles

> The screen-wide design rules, including principle 8 below, are gathered in [design-language.md](design-language.md) (adopted 2026-10-01). The alerting-specific principles stay here.

1. **One question per place.**
   - MASTER: *is there something new?*
   - ALERTS: *what is wrong now?*
   - QUEUE: *what waits for my decision?*
   - LOG: *what happened?*
2. **Every item lives in exactly one place.** A server function assigns each item one destination. No item is counted twice.
3. **ACK means one thing: "seen, stop the attention-getter."**
   - It silences the sound and stops the MASTER light.
   - It never removes a condition from ALERTS or a decision from QUEUE.
4. **Conditions come from state, not from events.**
   - An event that leaves something broken shows twice: the event in LOG, and the broken state in ALERTS. Example: an RTS ROLLBACK is a LOG line, and "RTS stopped after ROLLBACK" is an ALERTS WARNING until the MCC mode is picked again.
   - The ALERTS row clears when the state clears, never by ACK.
5. **Decisions leave only when decided.** The QUEUE row goes away when its underlying state changes (ui-visibility 3.1).
6. **Two numbers.** The header counts ALERTS (WARNING + CAUTION) and QUEUE. MASTER is a light, not a number, and LOG has no number. The same two numbers go to the tab title, ANNUNCIATOR and SwiftBar.
7. **The cockpit model, in aviation words.**
   - MASTER WARNING and MASTER CAUTION get attention, and pressing them silences.
   - ALERTS is the ECAM/EICAS condition list, with WARNING, CAUTION and ADVISORY.
   - QUEUE rings a CALL (SELCAL-like chime) when a new request arrives.
   - LOG is the normal-events log.
8. **Server decides, clients show** ([mac-app.md](mac-app.md) principle 1). The destination, the counts and the master state are computed once, and the browser, SwiftBar and ANNUNCIATOR read them.

## 3. The model

### 3.1 Destination

- `supervisorAlertsOf` gains `dest: "alerts" | "queue" | "log"` on every item. The keys stay the same, so the browser, SwiftBar and ANNUNCIATOR still de-duplicate by key.
- The rule is a pure function `destOf(item)` with a test for every key prefix:

| Items | dest | Level in ALERTS | New condition items it needs |
|---|---|---|---|
| `alert\|…` (both groups) | alerts | as today | — |
| `following\|…` except `await-supervisor` | alerts | as today | — |
| `recycle\|over`, `recycle\|wait`, `cap\|other` | alerts | as today | — |
| — | alerts | WARNING | **`rts\|halted`**: RTS stopped after a ROLLBACK, until the MCC mode is picked again |
| — | alerts | CAUTION | **`control\|down\|<session>`**: a control session that a RECYCLE stopped and did not start again |
| — | alerts | CAUTION | **`reposition\|stuck\|<aircraft>`**: the base moved but the LAUNCH failed |
| `pending\|tool\|…`, `pending\|proposal\|…`, `pending\|schedule\|…`, `pending\|humancheck\|…` | queue | — | — |
| `following\|…await-supervisor` | queue (GO) | — | — |
| `land\|…` for a `user`-tier PR | queue (LANDING) | — | — |
| UPDATE (the UPDATE bar's condition) | queue | — | from `/api/update` |
| `land\|…` for an `auto`/`flagged` PR (MCC lands it) | log | — | — |
| `rts\|…`, `recycle\|<session>\|<t>`, `reposition\|…` | log | kept as the tone of the log line | — |
| HANDOFF (today in the ALERTS list) | log | — | — |

- QUEUE rows and `supervisorQueueOf` (Q1) must agree. Q1 builds its rows **from the same conditions** as the `pending|…` items. One function feeds both, so the queue and the CALL cue never disagree.

### A1 as built (ATC-197)

- **`destOf(item, landBy?)`** in `server/supervisor-alerts.ts` (pure) and `dest` on every item of `supervisorAlertsOf` (so on `/api/supervisor-alerts` and the `alert` SSE event). The keys are unchanged. Clients ignore the field until A3/A4. The rule follows the table above by the first segment of the key (`DEST_PREFIXES`); the rest of the key splits `recycle|over|wait` (alerts) from `recycle|<session>|<t>` (log), `reposition|stuck|…` (alerts) from the other `reposition|…` (log), `rts|halted` (alerts) from `rts|<at>|<result>` (log), and `following|…|await-supervisor` (queue) from the other `following|…` (alerts). `follow|…` (FOLLOW, ATC-278, [follow.md](follow.md) 3.5): `ready` and `approve` queue, `landed` and `deployed` log, `stuck` and `failed` alerts. An unknown prefix falls back to `alerts` so nothing is hidden; a test reads the key shapes in `supervisor-alerts.ts` and fails when a prefix has no rule.
- **`land|…`** goes to the queue when the SUPERVISOR has to land it and to the log when MCC or the team lands it. It reuses `landByOf` (`server/land-by.ts`, which uses the `deploy/landing-tier.mjs` tier that MCC already measures); there is no second tier rule. `mccLandInfoCached` (`server/mcc-run.ts`) builds the same `MccLandInfo` as the TOWER brief from the tiers already in the cache without calling GitHub, so it can run every 5 s. A PR whose tier is not cached yet is `supervisor` (queue) until the next brief or MCC pass measures it; with no data at all the item goes to the queue, so the SUPERVISOR is never left out.
- **Three condition items**, built from the current state, not from events (pure `rtsHaltedOf`, `controlDownOf`, `repositionStuckOf`); each clears by itself:
  - `rts|halted` (WARNING, `rts`): while `rtsState().stop` is set (RTS stopped after a ROLLBACK), until the MCC mode is picked again.
  - `control|down|<session>` (CAUTION, `recycle`): the session's last non-`would` RECYCLE record is `launch-failed`, or `stop-unconfirmed` with a refused LAUNCH, and no live session of that name (or folder) is running. Looks back 24 h of the FLIGHT RECORDER.
  - `reposition|stuck|<aircraft>` (CAUTION, `reposition`): the AIRCRAFT's last REPOSITION record is a failure at stage `launch` (the base moved, the LAUNCH failed) and no live session has that REGISTRATION. Looks back 24 h.
- The three items show in the BELL as ordinary conditions until A3, and they count in the summary `counts` and `master` like any other item.

### PENDING approval that lasts, as built (ATC-327)

- **Level by time or by waiting calls.** `pending|tool|<session>|<since>` is ADVISORY under `pendingMin` (default 10, env `ATC_HEALTH_PENDING_MIN`, `health.pendingMin`) and CAUTION from then on. It is CAUTION at once when the AIRCRAFT has at least one open RADIO call from TOWER, OCC or MCC (a CLEARANCE, FLIGHT PLAN, RECALL or CREW CHANGE). The key does not change, so an ACK carries over and the level only rises. Pure `pendingLevelOf` in `server/pending.ts`; the calls come from `readRadio()` (read only). A dead session is ignored.
- **What it asks.** Claude Code writes `state: working` together with `needs: "approve Write: …"` for a session standing on an approval prompt. `parseJob` keeps it as `pendingNeeds` (only for `working`; the `blocked` rules of ATC-133 and ATC-138 are unchanged) and it is shown only while the session's health is `PENDING` (`pendingNeedsOf`). The item text reads `TEAM_O — PENDING approval 5h45m · 3 calls waiting (GO AROUND C-0291, FLIGHT PLAN D-0336, D-0340) · approve Write: …` and `next` adds the attach command of the card (with `CLAUDE_CONFIG_DIR` for a non-default folder). FLEET rows, the FLEET card's alert band and STRIPS show `PENDING · <needs>` in `--blue`.
- **RADIO.** An open call whose receiver is PENDING gets `reason: "receiver waiting for approval since 04:07Z"` from the server (`annotatePending`); the NO REPLY line shows it as one faint line.
- **MASTER and counts.** The item counts in the summary `counts` and lights MASTER only from CAUTION on. The BELL already counted every item with the `call` cue, so it shows the ADVISORY PENDING item too; that is unchanged. Nothing new is sent to any session.

### 3.2 MASTER (attention)

- **The light** is at the BELL's place in the header. It is off, MASTER CAUTION (amber) or MASTER WARNING (red). It lights when a new key arrives at `dest: alerts` with WARNING or CAUTION, and stays lit until it is ACKed.
- **ACK** is a click on the light:
  - it records the keys as seen, stored per browser as today and shared across tabs;
  - it stops the WARNING repeat and turns the light off;
  - it opens nothing and removes nothing.
- **A second click, or a click while the light is off,** opens the ALERTS list.
- **New QUEUE rows** do not light MASTER. They sound CALL once and pulse the QUEUE readout until the queue is opened.
- **LOG** lights nothing. DONE sounds only if it is switched on (default off, as today).
- The server's summary `master` is the highest current ALERTS level. Each client applies its own ACK (decision 7.3), so a light that one browser ACKed can still be lit in ANNUNCIATOR.

### 3.3 ALERTS (conditions)

- The list is the `dest: alerts` items, grouped by level as today (ATC-110). The ADVISORY items fold under `+n ADV`.
- It has no ACK button. Each row shows its **next step** (the `next` field) and a link.
- The moving ticker is removed. The readout colour (red or amber) says the same thing without motion (ui-visibility principles 1 and 6).

### 3.4 QUEUE (decisions)

- The rows come from `supervisorQueueOf` (Q1). Its home is the DUTY drawer ([duty.md](duty.md) section 7).
- Until DUTY's drawer exists, the QUEUE readout opens a small popover with the same rows and links. The drawer replaces the popover later: same component, new place.
- The count is the number of open rows. Nothing can be ACKed away.

### 3.5 LOG (events)

- The last 50 `dest: log` items, newest first, each with a time, a tone (ok, refused or failed) and a link.
- It has no count and makes no sound unless DONE is on.
- The source is the same event records as today (RTS, RECYCLE, REPOSITION, MCC landing, HANDOFF). The LOG is a view; it adds no new state file.
- Its home is a header popover (decision 7.2).

### 3.6 Notifications, sound and voice

| Arrives | Browser notification | Sound | Voice (if on) |
|---|---|---|---|
| New ALERTS WARNING | yes | WARNING, repeats until ACK | yes |
| New ALERTS CAUTION | yes | CAUTION once | no |
| New ALERTS ADVISORY | no | none | no |
| New QUEUE row | yes | CALL once | yes (as today for CALL) |
| New LOG item | only if the SUPERVISOR turns LOG notifications on (off by default) | DONE if on | no |

- The notification settings (settings → 알림) choose by destination and level instead of by the 8 groups:
  - ALERTS: WARNING, CAUTION;
  - QUEUE;
  - LOG.
- Stored preferences map old groups to the new switches on first load.
- Quiet hours, the 10-minute flap rule, the 2-second burst rule and the audio-lock handling (ATC-162) are unchanged.

### 3.7 Summary v2

`GET /api/supervisor-summary` gains `v: 2`:

- `alerts: { warning, caution, advisory }` counts over `dest: alerts` only;
- `queue: { total, byKind }`;
- `master: "warning" | "caution" | null`, the highest current ALERTS level;
- `logLast`, the newest LOG item's time.

`counts` and `pending` stay in v2 for one release, marked deprecated in the server README, so that atc-app (which pins the fields) can move first.

## 4. Screens

**Header, left to right:**

- `MASTER` light;
- `ALERTS n`, red or amber, `+n ADV`;
- `QUEUE n`, pulsing on a new row;
- `LOG`, no number;
- the sound-lock chip, only when locked;
- then the rest as today.

The ticker is removed. The UPDATE bar stays until ui-visibility step 5, but its condition is also a QUEUE row.

- **Tab title:** `(<ALERTS W+C>·<QUEUE>) ATC`, for example `(2·3) ATC`. `🔇n` for missed sounds stays.
- **ANNUNCIATOR and SwiftBar** show the MASTER light and the two numbers from summary v2. Their lists open the matching screen.
- **The guide** `docs/guide/alerts.md` is rewritten around the four questions, with the same examples.

## 5. Implementation order

Each step is one issue.

| # | Step | Output |
|---|---|---|
| A1 | Server: `destOf` and `dest` on every item; the three new condition items (`rts\|halted`, `control\|down`, `reposition\|stuck`); tests per key prefix. No UI change | `dest` in `/api/supervisor-alerts` |
| A2 | Q1 and A1 share one source for `pending\|…` and QUEUE rows. It needs ATC-194; if ATC-194 lands first, this is a small follow-up | The queue and the CALL cue agree |
| A3 | Header: MASTER light replaces the BELL (ACK = silence); ALERTS list from `dest: alerts` with no ACK; ticker removed; HANDOFF moved out | Two meanings separated in the header |
| A4 | QUEUE readout with a popover over `supervisorQueueOf`; LOG readout with a popover over `dest: log`; tab title with two numbers | Every item has a home |
| A5 | Notifications and sound by destination; settings 알림 switches by destination; migration of stored prefs | Sounds match the four questions |
| A6 | Summary v2 (`alerts`, `queue`, `master`, `logLast`), `counts`/`pending` deprecated; SwiftBar reads v2 | One set of numbers everywhere |
| A7 | atc-app (ANNUNCIATOR) reads summary v2 (atc-app repo) | Mac app matches |
| A8 | `docs/guide/alerts.md`, `docs/guide/screens.md` and `menubar.md` rewritten | Guide matches |

- A1 comes first.
- A3 and A4 need A1.
- A4 needs Q1 (ATC-194).
- A5 needs A3 and A4.
- A6 can follow A1.
- DUTY's D3 later moves the QUEUE popover into its drawer.

## 6. Risks

| Risk | Mitigation |
|---|---|
| A condition that only existed as an event is lost when events move to LOG | A1 adds the three condition items before anything moves. A test lists every key prefix and its destination, so a new prefix without a rule fails the test |
| The SUPERVISOR misses a decision because the BELL no longer shows it | QUEUE has its own count, the CALL sound and a notification. The tab title carries the QUEUE number |
| Muscle memory: the BELL was the place to click | The MASTER light sits where the BELL was. The guide's first lines say what moved where. The old `#bell`-style links, if any, open ALERTS |
| ANNUNCIATOR and SwiftBar break on a summary change | v2 keeps `counts` and `pending` for one release; atc-app moves in A7 before they are removed |
| Too much red | Only new WARNING/CAUTION light MASTER. ALERTS without news is a readout colour, not a light. ADVISORY never counts |

## 7. Decisions

Decided by the SUPERVISOR (2026-09-30), all as proposed:

1. **Names:** **MASTER** (the light), **ALERTS**, **QUEUE**, **LOG**.
2. **LOG's home:** a header popover.
3. **ACK:** per browser, as today, shared across tabs of the same browser. No server-side ACK.
4. **CLEARED TO LAND for `auto`/`flagged` PRs:** LOG only (MCC lands them). `user`-tier PRs are QUEUE rows (LANDING).

Decided by this draft (pilot's discretion, reversible):

- ACK never removes anything.
- ADVISORY never counts or sounds.
- Keys are unchanged.
- The ticker is removed.
- LOG adds no state file.
