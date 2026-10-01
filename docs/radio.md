# RADIO: watching and listening to the agents' radio traffic

A RADIO tab lets the SUPERVISOR follow the traffic between atc's sessions the way people listen to a tower frequency on LiveATC or a scanner. The traffic includes TOWER's CLEARANCEs and the teams' READBACKs, OCC's FLIGHT PLANs and the CAPTAINs' replies, and MCC's landings and RTS. The tab shows it as text, and optionally as audio.

> Status (2026-09-30): adopted, draft. Idea: [#249](https://github.com/chaehy5665/atc/issues/249). The SUPERVISOR chose the name RADIO, a tab of its own, and a monitor toggle in atc-app (section 7). Nothing is built yet.

Related: [guide/voice.md](guide/voice.md) (voice callouts, ATC-140, 142, 143, 162), [mac-app.md](mac-app.md) (what atc serves to atc-app), [control-recycle.md](control-recycle.md) (missing replies after a restart), SAFETY REPORT idea [#246](https://github.com/chaehy5665/atc/issues/246), transcript sensor idea [#151](https://github.com/chaehy5665/atc/issues/151).

## 1. Current facts

- **The traffic is already recorded as structured, append-only lines.** A first version needs no transcript parsing.
  - `clearances.jsonl`: `issue` (`id`, `at`, `to`, `toName`, `type`, `stand`, `flight`, `text`) and replies `readback`, `roger` and `unable` (`id`, `at`, sometimes `reason`). In the last 400 lines on 2026-09-30 there were 100 `issue`, 48 `readback`, 41 `roger` and 11 `unable`.
  - `proposals.jsonl`: `send` carries the FLIGHT PLAN `message` (`[DISPATCH D-xxxx] FLIGHT PLAN · <callsign> (<REGISTRATION>)` …), then `accept` (the READBACK) and `depart`, plus RECALL.
  - `arrival-reports.jsonl`: the CAPTAIN's ARRIVED report fields (`flight`, `proposal`, `pr`, `result`, `tier`, `tests`, `discretion`, `blocked`; ATC-124).
  - CREW CHANGE send and readback (`crew-change` records), and MCC and RTS (`mcc.jsonl`, `rts.jsonl`).
- **Message text is mostly English, not always.** Session-to-session text is English (ATC-126). But a CLEARANCE `text` can carry Korean copied from a server field: `C-0177`, an INFO on 2026-09-30, relayed a landing block text that was in Korean.
- **Voice exists.**
  - A local TTS renders WAV on the server (Piper with 13 English voices, espeak-ng and Kokoro; `server/tts.ts`, `server/voice-cache.ts`).
  - The browser plays it through a radio chain (`web/src/radio.ts`).
  - `/api/voice/alert/:key.wav` renders only template phrases built from alert fields (`server/voice-phrase.ts`): free text is never read aloud (ATC-140). ATC-162 added audio-lock handling.
- **Events.** `/api/events` has opt-in `topics` (`snapshot`, `alert`, `version`, `summary`; ATC-153). atc-app reads `summary` and alerts.
- **Names already in use.** DOCS has a guide page `radio`, "교신 규칙" (the radio rules). `web/src/radio.ts` is the voice radio chain. Both are about the same subject, so the tab can share the word. The guide page for the new tab needs a different id (section 7, D5).

## 2. Principles

1. **Read only.** The tab never sends, ACKs, approves or recalls anything.
2. **Derived from existing records.** RADIO is a view over the lines above. It adds no new state file. The server merges and pairs the records in a pure function, and clients only show the result.
3. **Say what was recorded; read aloud only templates.**
   - The text view shows the recorded text.
   - Audio reads a phrase built from structured fields (station, callsign, kind, FLIGHT, short verb), never the free `text` or `message`, the same rule as ATC-140.
4. **Local and quiet by default.**
   - Audio renders on the host only while someone listens.
   - It is off by default, follows quiet hours and the ATC-162 lock handling, and nothing leaves the host.
5. **Aviation shape.** Frequencies, stations, callsigns and Z time, as on the rest of atc.

## 3. The model

A **transmission** is one recorded call or reply:

`{ id, at, freq, from, to, kind, flight?, airport?, head, body?, replyTo?, open?, overdueAt? }`

- `from` and `to` are stations: `TOWER`, `OCC`, `MCC`, or an AIRCRAFT by callsign and REGISTRATION.
- `head` is a short one-line summary. `body` is the recorded text, if any.
- A reply (`readback`, `roger`, `unable`, `accept`) carries `replyTo` = the call's `id`.
- A call with no reply is `open`, and `overdueAt` comes from the rule that already exists: for example, a FLIGHT PLAN is `overdue` after 10 minutes.

**Frequencies:**

| Frequency | Traffic | Source |
|---|---|---|
| **DELIVERY** (clearance delivery) | FLIGHT PLAN, READBACK, RECALL | `proposals.jsonl` |
| **TOWER** | CLEARANCE (`LAND`, `GO AROUND`, `INFO`, …), READBACK, ROGER, UNABLE | `clearances.jsonl` |
| **GROUND** | MCC INSPECTION, land and ESCALATE; RTS started, ok and rollback | `mcc.jsonl`, `rts.jsonl` |
| **COMPANY** | CREW CHANGE and its READBACK; ARRIVED reports | crew-change records, `arrival-reports.jsonl` |
| **PREFLIGHT** | CROSSCHECK marks, PREFLIGHT HOLD, DISPATCH HOLD (not calls, see "PREFLIGHT as built") | `proposals.jsonl`, `schedule.jsonl` |

## 4. Screens

**RADIO tab (browser):**

- The frequency selector (one, several, or "monitor all" like a scanner), plus AIRPORT and AIRCRAFT filters.
- A chronological log: `HH:MM:SSZ · FREQ · FROM → TO · head`, with the reply threaded under its call.
  - An open call shows its age and turns amber after `overdueAt`.
  - Clicking a line opens the CLEARANCE, proposal or PR it belongs to.
- Live via an SSE topic `radio`, and a replay scrubber over the last hours from the same records (1× or faster).
- **Audio (opt-in):**
  - a fixed voice per control station (TOWER, OCC, MCC);
  - each AIRCRAFT gets a voice picked from its callsign among the installed voices, so it is stable;
  - the radio chain, a queue with skip and 1× or 1.5×, and a "calls only / unanswered only / everything" choice to keep the noise down.

**atc-app monitor toggle:** a "RADIO monitor" switch in the ANNUNCIATOR plays one frequency (TOWER by default) through the app's own audio. It uses the same server WAVs and needs no browser tab. It builds on the app's sound work (atc-app N4, ATC-158).

## 5. Implementation order

| Step | What | Needs | Tier | Wake |
|---|---|---|---|---|
| R1 | Server: `radioOf(records)` pure merge and pairing, `GET /api/radio?since=&freq=`, SSE topic `radio`, tests | — | auto | M |
| R2 | RADIO tab: text log, frequency filters, threaded replies, open-call timers, click-through, replay; a guide page | R1 | auto | M |
| R3 | Audio: phrase templates per kind (pure, tested), station voices, `GET /api/radio/:id.wav` on demand with the voice cache, browser queue and speed, off by default | R1, R2 | auto | M |
| R4 | atc-app: RADIO monitor toggle (one frequency, TOWER by default) | R3, atc-app N4 (ATC-158) | atc-app (SUPERVISOR merges) | M |
| Later | Traffic that is only in transcripts (free replies), through the transcript sensor idea (#151) | R1 | — | — |

### R1 as built (ATC-170)

`server/radio.ts` (pure) and `server/radio-run.ts` (reads the files, mounts the route, feeds SSE). Nothing is written, no state file is added, no record format changes, and no transcript is read.

- **`radioOf(input)`** takes the raw ops and records, not the folded state, so a reply is never lost: `clearances.jsonl` ops, `proposals.jsonl` ops, `crew-changes.jsonl` ops, `arrival-reports.jsonl`, `mcc.jsonl` and `rts.jsonl`. It returns transmissions oldest first.
- **Ids.** A call keeps the record id (`C-0007`, `D-0012`, `CC-0003`). A reply is `<call id>#<reply>` (`C-0007#readback`, `D-0012#unable`), and a RECALL is `D-0012#recall` with its reply `D-0012#recall#readback`. ARRIVED and GROUND lines get `report:<FLIGHT>:<at>`, `mcc:<at>:<op>[:<pr>]` and `rts:<at>:<result>`.
- **Stations.** `TOWER`, `OCC`, `MCC`, `ALL` (a GROUND broadcast) and an AIRCRAFT as `GOLF (TEAM_G)` (callsign plus REGISTRATION, `server/callsign.ts`, `server/registration.ts`). `aircraft` carries the REGISTRATION for filtering. A session name that is not a team name is used as it is.
- **Frequencies** as in section 3. Pairing:
  - `issue` / `send` / `recall` / CREW CHANGE `sent` are calls; `readback`, `roger`, `unable`, `standby`, `accept`, `decline`, `recalled`, `acknowledged` are replies with `replyTo`.
  - A call is `open` until a closing reply is recorded. `standby` does not close it. A CLEARANCE `cancel`, a FLIGHT PLAN `expire` / `supersede` and a CREW CHANGE `superseded` / `delivered` close it without a reply.
  - A `recall` closes the FLIGHT PLAN call it withdraws and opens its own RECALL call.
  - A reply with no call record is kept and marked `orphan: true`.
- **`overdueAt`** is the existing rule and nothing new: FLIGHT PLAN, RECALL (`READBACK_OVERDUE_MS`, 10 min), CREW CHANGE (`CREW_CHANGE_READBACK_OVERDUE_MS`, 10 min), CLEARANCE (10 min, `controller.ts`). The first STANDBY counts the time again from the STANDBY (`overdueBase`, ATC-122). `isOverdue(t, now)` is `open && now > overdueAt`.
- **Order.** By time; at the same time a call comes before a reply, then the order of the records (stable).
- **`head`** is built from fields only: `TOWER → GOLF · GO AROUND · ATC-147`, `GOLF → TOWER · READBACK · ATC-147`, `OCC → GOLF · FLIGHT PLAN · ATC-170`, `GOLF → OCC · ARRIVED · ATC-170 · PR #252 · TIER auto`, `MCC → ALL · INSPECTION · PR #5 · PASS`. `body` is the recorded text unchanged (CLEARANCE `text`, FLIGHT PLAN and RECALL `message`, CREW CHANGE `message`, UNABLE `reason`, INSPECTION `text`, ESCALATE `reason`, MCC `detail`). ARRIVED has no body: atc does not keep the free summary (ATC-124).
- **`GET /api/radio?since=<iso>&freq=<list>&limit=<n>`** returns `{ at, since, transmissions }`, newest last. `since` defaults to the last 6 hours, `freq` is a comma list of `DELIVERY`, `TOWER`, `GROUND`, `COMPANY`, `PREFLIGHT` (any case), and `limit` keeps the newest n and is capped at 2000. A bad value returns `400`.
- **SSE topic `radio`** (`/api/events?topics=radio`, ATC-153) sends `event: radio` with `{ transmissions }` holding the transmissions that are new or changed since the last send (a reply arrived, `open` cleared, `overdueAt` moved by a STANDBY). It sends nothing on connect: read `GET /api/radio` first and merge by `id`. The default set is unchanged (`snapshot`, `alert`, `version`), and the server reads the files on each tick only while someone listens.

Where this differs from the design: the design said `radioOf(records)`, and it is `radioOf(input)` over the raw ops for the reason above. It adds `aircraft` and `orphan` to the transmission fields, and `ALL` as a station.

**PILOT'S DISCRETION.** Only `inspect`, `escalate`, `land` and `rts` in `mcc.jsonl` are transmitted (not `would-land`, `would-rts`, `mode`, `hold`, which are shadow or SUPERVISOR-side records). Both the `mcc.jsonl` `rts started` and the `rts.jsonl` results are transmitted, as separate GROUND lines. The AIRPORT of a CLEARANCE comes from the FLIGHT's FLIGHT PLAN (`create.airport`); a CLEARANCE for a FLIGHT with no proposal has none.

### R2 as built (ATC-171)

`web/src/views/Radio.tsx` (+ `Radio.css`), pure logic in `web/src/radio-log.ts` (tests in `server/radio-log.test.ts`). Tab id `radio`, lazy like the other tabs. Guide page `docs/guide/radio-tab.md` (id `radio-tab`, D5). Read only: no button sends, ACKs or approves, and there is no audio (R3).

- **Data.** `GET /api/radio` once, then the SSE topic `radio` merged by `id` (`mergeTx`). The EventSource `open` (also after a reconnect) fetches again to close any gap. The list is kept to the R1 window of 6 hours.
- **Filters.** `MONITOR ALL` or any set of DELIVERY, TOWER, GROUND, COMPANY (pressing one while all are on selects only that one; turning all off goes back to all), AIRPORT and AIRCRAFT selects filled from the transmissions. Kept in `localStorage` as `atc.radio.freqs`, `atc.radio.airport`, `atc.radio.aircraft`; unreadable or invalid storage means all.
- **Log.** Oldest first, newest last. A line is `time · FREQ · head` where `head` (`FROM → TO · …`) starts with the stations in mono; time follows the clock setting (Z or L). Replies are threaded under their call (`threadsOf`); a reply whose call is not in the list is its own line. An open call shows `답 대기 <age>`, and after `overdueAt` the text `NO REPLY · <age>째 답 없음` with an amber left rule. UNABLE, orphan replies and NO REPLY are text badges, not colour alone. `body` expands in a `pre-wrap` block exactly as recorded.
- **Links.** `pr` → the GitHub PR, `D-…` → `#dispatch`, `C-…` → `#strips`, `CC-…` and any `TEAM_X` → `#fleet/<REGISTRATION>`. R2 adds the optional `pr` field to the R1 transmissions of ARRIVED reports and MCC INSPECTION, ESCALATE and LAND.
- **Scroll.** At the bottom the log follows new lines; scrolled up it stays put and a `N new ↓` pill (counted by visible transmissions) brings the reader down.
- **REPLAY.** A slider over the last 6 hours (1 min steps), PLAY/PAUSE, 1×, 4×, 16× (a 250 ms clock), LIVE. At a chosen time the screen shows only what existed then (`asOf`): a call answered later is open again, and it is `NO REPLY` when 10 minutes have passed since the call. The server drops `overdueAt` once a reply arrives, so replay uses the fixed 10-minute rule (`REPLAY_OVERDUE_MS`) and ignores the re-count after a STANDBY. Reaching now returns to LIVE.

**PILOT'S DISCRETION.** CLEARANCE lines link to `#strips` (the CLEARANCE stamps), as there is no per-CLEARANCE view; DISPATCH links go to the tab, as cards have no anchors. The REPLAY slider starts one hour back. The AIRPORT of a CLEARANCE is the R1 rule (its FLIGHT's FLIGHT PLAN), so CLEARANCEs without a FLIGHT PLAN have no AIRPORT and disappear when one is chosen.

### R3 as built (ATC-172)

`server/radio-phrase.ts` (pure: phrases and voices), `GET /api/radio/:id.wav` in `server/radio-run.ts`, `web/src/radio-listen.ts` (pure: what to hear, queue, saved choices) and the LISTEN bar in `web/src/views/Radio.tsx`. Local only; the server renders a WAV only when asked and never plays sound.

- **Phrases.** `radioPhraseOf(transmission)` builds one short line from fields only: the stations (`Tower`, `Delivery` or `Company` for OCC by frequency, `Ground` for MCC, a callsign for an AIRCRAFT), the kind as a short verb (`go around`, `flight plan`, `recall`, `crew change`, `information` …), the FLIGHT as words and, for GROUND, the PR number and the recorded result (`inspection pass`, `landed`, `return to service complete` …). A reply repeats the call it answers (`Tower, GOLF, readback, go around, ATC one four seven.`). The free `body`, `text` and `message` are never read, and the same `PHRASE_CHARS` and `PHRASE_MAX` as the alert phrases apply. A kind or result with no template gives no phrase. To carry what the phrase needs, R3 adds two optional fields to the R1 transmissions: `re` (a reply's call kind) and `result` (a GROUND line's result, lower case).
- **Voices.** `voiceOf` picks from the installed voices of the selected engine. The four control seats are fixed by their order (TOWER, DELIVERY, GROUND, COMPANY, wrapping when there are fewer voices), an AIRCRAFT gets a voice from a stable hash of its callsign, and one installed voice serves everyone. A seat can be overridden per browser with `?voices=TOWER:name,…` (an installed voice only; the choice is saved in `atc.radio.listen`).
- **`GET /api/radio/<id>.wav[?voices=]`.** Finds the transmission, builds its phrase, renders it with the selected engine through the existing voice cache (`wavFor`). `404` for an unknown transmission or one without a phrase, `400` without `.wav`, `503` when no engine or voice is available.
- **Browser.** A `LISTEN` switch, off by default and saved per browser. When on, only transmissions that arrive over SSE after that are queued (the loaded list is never read). Choices: calls only (default), unanswered calls only, everything; 1× or 1.5×; SKIP. One transmission at a time through the radio chain (`playRadioVoice`, now with a playback rate); the queue holds 5 and drops the oldest, showing how many were skipped. RADIO speech yields to a WARNING or CALL tone (it waits, and a starting tone stops it), stays silent in the alert quiet hours and during REPLAY, and when the browser has locked audio it shows the lock chip and only counts what it could not read.

**PILOT'S DISCRETION.** The four station voices are chosen in the RADIO tab (saved per browser) rather than in the server settings, so no new server setting or state is added. Missed transmissions while audio is locked are counted, not replayed after unlocking (the text log has them). The queue cap is 5. Nothing is read in REPLAY or in quiet hours.

### PREFLIGHT as built (ATC-267)

A fifth frequency, `PREFLIGHT`, for the check before departure. `server/radio.ts` (pure) reads records it used to skip; `server/radio-run.ts` also passes the lines of `schedule.jsonl` (`readScheduleLines`). Read only, no new state, no record format change.

- **CROSSCHECK marks.** Every `op: "crosscheck"` line on a DISPATCH proposal or a SCHEDULE draft is one transmission: `from: "CROSSCHECK"`, `to: "OCC"`, `kind: "CROSSCHECK"`, `result: "agree" | "disagree"`, `head` `CROSSCHECK → OCC · D-0254 ATC-254 · DISAGREE` (the S-id and the draft's FLIGHT for SCHEDULE), `body` the recorded reason. A newer mark on the same record is a new line with its own verdict in its head; the older line stays.
- **PREFLIGHT HOLD** (`op: "preflight"`): `kind: "PREFLIGHT HOLD"`, from the station recorded in `by`, to OCC, `body` the recorded reason. **DISPATCH HOLD** (`op: "hold"`): `kind: "HOLD"`, from OCC to ALL, `body` `blocked by <FLIGHTs>`, or the latest recorded note when no FLIGHT blocks it.
- **Not calls.** No `open`, `overdueAt` or `replyTo`. READABILITY's call test excludes the frequency, and a test checks that its numbers do not change when PREFLIGHT lines are added.
- **Screen.** PREFLIGHT is a chip beside the other four and part of `MONITOR ALL`. A saved choice of exactly the old four frequencies is read as all five.
- **Voice (R3).** From fields only: `Crosscheck, disagree, ATC two five four.`, `Crosscheck, preflight hold, ATC two five four.`, `Delivery, hold, ATC two five four.` The reason text is never read.

**PILOT'S DISCRETION.** `hold` records no author, so HOLD is shown as from OCC (the only station that can write it). A mark's line id is `<id>#crosscheck:<at>` so repeated marks do not collide. The PREFLIGHT HOLD `to` is OCC. SUPERVISOR approve/reject, atc-app's `RadioFreq` and GLOBE drawing are not part of this.

## 6. Risks

| Risk | Handling |
|---|---|
| Noise: 100+ TOWER calls in a few hours | Filters, "unanswered only", audio off by default, one voice at a time |
| TTS CPU on the host | Render on demand only while listening, cache by phrase, skip when the queue is long |
| Free text read aloud | Never: audio uses templates over fields (principle 3) |
| Korean inside a recorded `text` | The text view shows it as recorded. Separately, a CLEARANCE that relays Korean to a team breaks ATC-126 and is worth its own look |
| A reply that atc never recorded (for example after a control-session restart) | It shows as an open call, which is the point. ATC-169 closes the OCC gap |
| Name confusion with the guide page `radio` and `web/src/radio.ts` | Tab id `radio`; the new guide page gets a different id (D5) |

## 7. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Name | **RADIO** (SUPERVISOR, 2026-09-30) |
| D2 | A tab of its own or a panel | **Its own tab** (SUPERVISOR, 2026-09-30) |
| D3 | atc-app | **A monitor toggle** in the app (SUPERVISOR, 2026-09-30), TOWER by default |
| D4 | Audio default | Off, opt-in per browser (proposed) |
| D5 | Guide page id | `radio-tab` ("RADIO 탭"), keeping `radio` for the radio rules (proposed) |

## QRH shadow as built (ATC-288)

Why here: RADIO is where the texts the server sends to sessions are collected, and the QRH step that follows this shadow (the survey's work order 6) changes those texts. This section records only the shadow.

- **What it does.** The server names a checklist for a condition it already detects, and writes one FLIGHT RECORDER line the first time it sees it. It changes **no text** a session receives and touches no guard. The denominator for the later "named → opened" rate is these lines.
- **Line (fixed, ATC-289 reads it).** `{ t, kind: "qrh", op: "named", id, code, session?, aircraft?, flight?, subject }`. No message text. `id` is the checklist (`qrh-02-stalled`), `code` the server's condition code, `subject` a key that does not change while the condition holds (`D-0305`, `C-0123`, a REGISTRATION, a FLIGHT).
- **Table.** `server/qrh.ts` `qrhOf(code) → { id, title } | null` is the one list of checklist IDs (`<kind>-<nn>-<slug>`, a number is never changed or reused). Only conditions with a stable code today are in it.

| Checklist | Server code | Where it arises |
|---|---|---|
| `qrh-02-stalled` | health `STALLED` | `server/health.ts` `stalledOf` (session `health`) |
| `qrh-03-undelivered` | `undelivered` | `server/following.ts` `undeliveredOf` (a proposal's `undelivered`; the FOLLOWING `undelivered` issue is the same condition) |
| `qrh-03-undelivered` | `overdue` (only `sent` and `recalling`) | `server/proposals.ts` `overdueOf` |
| `qrh-04-go-around` | TOWER CLEARANCE type `GO AROUND`, open (no READBACK, cancel or UNABLE) | `server/clearances.ts` (`ClearanceType`) |
| `qrh-05-arrival-missing` | `arrivalMissing` with `due: true` | `server/following.ts` `arrivalMissingOf` |

- **Not mapped, and why.** health `RESUME` (resuming a session cut by a LIMIT is a different procedure from a stalled one); FOLLOWING `no-pr`, `pr-not-cleared` (delays in the work, not a procedure the SUPERVISOR or OCC runs) and `unable` (the CAPTAIN answered; OCC reports it); `overdue` for `accepted` and STAND-free `departed` (no departure, no arrival: other procedures). **No server code yet:** `qrh-01-lost-comms` (an AIRCRAFT that cannot reach OCC or TOWER, ATC-258 F4).
- **Once per subject.** `qrhSweep` (pure) takes the conditions that are true now and the keys already written and still open. It writes a line for a new key, nothing for a key already open, and drops a key that is no longer true, so a condition that returns is named again. Two codes of one checklist with the same subject (`undelivered` and `overdue` on one proposal) give one line. After a restart the open keys are rebuilt from the last 24 hours of lines, so a condition that is still true is not written twice.
- **Run and read.** `server/qrh-run.ts` sweeps from the server tick (at most every 10 s; it reads values the server already computes). `GET /api/qrh/named?since=<ISO or ms>` returns `{ since, count, lines }` (default the last 24 h; read only). It is its own route because no existing read endpoint carries FLIGHT RECORDER lines.
- **Not here.** No change to any text, brief field or guard, and no UI.

## Not built yet

Everything in sections 3–5.
