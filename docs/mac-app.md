# Mac app: what atc serves to atc-app

The SUPERVISOR's Mac gets a native menu bar app, ANNUNCIATOR, in its own repository: [chaehy5665/atc-app](https://github.com/chaehy5665/atc-app) (public, GPL-3.0-or-later). The app's design is there (`docs/design.md`). This page covers only atc's side: what the server exposes for the app, what stays out, and what changes in this repository.

> Status (2026-09-29): adopted. The SUPERVISOR asked for a native app after using the SwiftBar plugin (ATC-149) for a day. They chose a separate public repository under GPL-3.0; atc is Apache-2.0 (earlier versions stay MIT), and the two talk only over HTTP. The server side of step N1 is built (section 3, "as built" below); atc-app itself is in its own repository.

Related: [guide/menubar.md](guide/menubar.md) (the SwiftBar plugin and the SSH forward), [guide/alerts.md](guide/alerts.md), [guide/voice.md](guide/voice.md), `server/supervisor-alerts.ts` (ATC-87), `menubar/format.mjs` (ATC-149), ATC-152 (alert noise).

## 1. Current facts

- The server listens only on `127.0.0.1:7700`. The Mac reaches it through an SSH local forward kept up by a launchd agent ([guide/menubar.md](guide/menubar.md)).
- atc has no login. SUPERVISOR-only writes are guarded by a browser Origin check (`server/origin.ts`). That check stops other sites' browser requests. It is not access control, because a direct client can send `Origin: http://localhost`.
- **What a client reads today:**
  - `/api/supervisor-alerts`: 40 KB, `items[]` with `key`, `group`, `level`, `cue`, `aircraft`, `flight`, `text`, `next`, `link`, `since`;
  - `/api/events` (SSE): `version`, `snapshot`, `alert`, and `ping` (one at once on every connect, then every 25 s; ATC-210). **Each `snapshot` event is the whole snapshot, 340 KB.**
  - `/api/fleet` for `fuelAccounts`, `/api/update` for RTS, `/api/control/sessions`, and `/api/voice/alert/:key.wav`.
- The SwiftBar plugin works out the title numbers itself in `menubar/format.mjs`, and the browser does the same in its own code. Two clients already compute the same summary, and a third (the app) would be one more.

## 2. Principles

1. **The server decides, clients show.** Counts, levels, texts and "what is pending" are computed once, in a pure server function. The browser, the SwiftBar plugin and the app all read the same result.
2. **Read only.** Nothing here adds a write route or changes who may write. Writes from the app need a real authentication design first (atc-app N5), with `Risk: Security`, as its own atc issue.
3. **Additive and backward compatible.** New endpoints and an opt-in query parameter only. The browser's default behaviour doesn't change.
4. **Small payloads for a menu bar.** A client that only needs alerts doesn't receive 340 KB snapshots.

## 3. Server additions (atc-app step N1)

- **`GET /api/events?topics=alert,version`**
  - Topics are a comma list out of `snapshot`, `alert`, `version` and `summary`. With no `topics`, the endpoint sends everything except `summary`, exactly as today.
  - `ping` is always sent: one at once on connect, before the listeners are added, and then every 25 s. A stream with no initial event (`topics=radio`) therefore gets its first event immediately instead of after 25 s (ATC-210); atc-app `RadioStream` relies on it. `ping` has empty data and is not a snapshot or an alert.
  - An unknown topic returns 400.
- **`GET /api/supervisor-summary`**, and the `summary` SSE topic, which is sent when the summary changes. The body is `{ v: 1, at, … }`:
  - `master: "warning" | "caution" | null` and `counts: { warning, caution, advisory }`, taken from `supervisor-alerts` after ATC-152's noise fixes;
  - `pending: { dispatch, humanCheck, tool }`;
  - `fuel`: the most-used ACCOUNT's windows (`name`, `pct`, `resetsAt`) and its label;
  - `rts`: the last result, its time and `from → to`;
  - `working: { aircraft, control }`, and `needsYou: [names]`.
- **Pure function:** `summaryOf(alerts, snapshot, …)` goes in `server/supervisor-summary.ts`, with `node:test` coverage. The browser header and the SwiftBar plugin move to it, so all three clients agree.
- **Contract:**
  - Field names are stable within `v: 1`. A breaking change bumps `v` and keeps v1 for one release.
  - Times are ISO 8601 UTC, and clients show them as `HH:MMZ`.
  - The app pins the `v` it understands and shows "atc 버전 확인" on an unknown `v`.

### N1 as built (ATC-153)

- **`GET /api/events?topics=`** (`parseTopics` in `server/supervisor-summary.ts`): a comma list out of `snapshot`, `alert`, `version`, `summary`. No `topics` (or an empty list) sends the old set, everything except `summary`. `ping` is always sent. An unknown topic returns `400 {error}` before the stream opens. Duplicates are fine.
- **`GET /api/supervisor-summary`** returns `summaryNow(snapshot)`; `503` until the first snapshot. The `summary` topic sends the current summary on connect, then a new one only when its content changes (`summaryKey` ignores `at`). It is evaluated each tick right after the alert list, from the same cached `currentAlerts()`, so the summary and the alert list never disagree; nothing extra is read from disk except the RTS record file the alert list already reads.
- **Body `{ v: 1, at, master, counts, pending, fuel, rts, working, needsYou }`.** The field list is in the [server README](../server/README.md) endpoint table, which is what atc-app pins.
  - `counts` are the level counts of the alert list (a test builds a real list with `supervisorAlertsOf` and compares). Items without a level (old shape) are not counted, so `counts` can be below the list length.
  - `pending.dispatch|humanCheck|tool|schedule` count the `pending|proposal|`, `pending|humancheck|`, `pending|tool|` and `pending|schedule|` keys (`schedule` was added by ATC-162; SCHEDULE decisions only exist in approval mode).
  - `fuel` is the ACCOUNT with the highest window `pct` (ties: the first); `label` is its ACCOUNT label, or its `group` when it has none.
  - `working.aircraft` is the number of distinct AIRCRAFT REGISTRATIONs with a live busy session, `working.control` the number of busy sessions named like a control session (TOWER, OCC, MCC …), both from the snapshot (no `claude agents` call).
  - `needsYou` lists the AIRCRAFT of items whose cue is `call`, sorted and distinct. HUMAN CHECK items have no AIRCRAFT and show only in `pending.humanCheck`.
- **SwiftBar plugin.** `menubar/format.mjs` no longer counts: the title numbers and colour, FUEL, DISPATCH approvals, the last RTS and the working counts come from the summary. The plugin reads `/api/supervisor-alerts` (the item lines and notifications) and `/api/supervisor-summary`, and shows the unreachable line if either fails, so it needs the new server. The RTS line lost the free-text `detail` and shows `from → to` instead, because the summary carries no detail text.
- **Browser header: unchanged.** Its ALERT number counts the snapshot's `alerts` (not the SUPERVISOR alert list), which is a different set, so switching it to the summary would change what it means. Moving the browser is not part of this step.
- **Not built:** `atc-app` itself, its connection handling, and anything write-side (principle 2).

## 4. Other atc changes this brings

- **AIRPORT flag "teams don't merge here".** atc-app, like atc itself, is merged only by the SUPERVISOR. ATC-151 stopped LAND to teams on the MCC AIRPORT. Other AIRPORTs still get `landBy: "holder"`, so every atc-app PR would draw a LAND that ends in UNABLE. The fix is an optional per-AIRPORT setting (`airports.json`, `teamsMerge: false`) that makes `landBy` `supervisor` there. It is a small follow-up to ATC-151.
- **AIRPORT registration.** The atc-app checkout (`/home/c10/projects/atc-app`) sits under `ATC_PROJECTS_DIR`, so atc finds it. The SUPERVISOR gives it an AIRPORT code in the AIRPORTS screen (for example `ATAP`); atc sessions don't write `airports.json`.
- **The SwiftBar plugin** stays as the documented fallback. It switches to `/api/supervisor-summary` in N1 and is otherwise frozen.

### `teamsMerge` as built (ATC-154)

- `airports.json` entries take an optional `teamsMerge`. Only `false` is written; `true` removes the field, so old files read unchanged and mean `true`. `AirportStatus.teamsMerge` is always a boolean on `GET /api/airports`; the open-AIRPORT list in the snapshot carries `teamsMerge` only when it is `false`.
- `landByOf` (`server/land-by.ts`) returns `supervisor` for any PR on an AIRPORT with `teamsMerge: false`, whatever the tier or MCC mode. The MCC AIRPORT keeps its ATC-151 rules first. `landText` is `null` there, so TOWER sends no `LAND`; GO AROUND and the other rules are unchanged.
- The SUPERVISOR sets it from the AIRPORTS screen ("팀 머지" ON/OFF), which sends `PATCH /api/airports/:id {teamsMerge}`. That field alone needs the screen's own JSON request (`fromThisApp`); sessions and `atcctl` get `403` and never write `airports.json`. Name, code and CLOSE keep their old behaviour.
- After atc-app is registered, the SUPERVISOR turns "팀 머지" OFF for its AIRPORT. TOWER needs no restart: the manual already reads `landBy`.

## 5. Implementation order (atc side)

| Step | What | Needs | Tier | Size |
|---|---|---|---|---|
| 1 | ATC-152: SUPERVISOR alert noise (no-report scope, expiring old proposals, STAND names in texts) | — | auto or flagged | M |
| 2 | N1: `topics` on `/api/events`, `/api/supervisor-summary` with the `summary` topic, and the browser header and SwiftBar plugin on the summary | 1 | auto | M |
| 3 | Per-AIRPORT `teamsMerge: false` in `landBy` (follow-up to ATC-151) | — | flagged (TOWER brief) | S |

## 6. Risks

| Risk | Mitigation |
|---|---|
| The summary drifts from what the alert list shows | The summary is built from the same `supervisor-alerts` items in one pure function, with tests that compare the two |
| A client subscribes with old code after a breaking change | The `v` field; v1 stays for one release after v2 |
| Someone adds a write route "for the app" | Principle 2: writes need their own security design and issue |
