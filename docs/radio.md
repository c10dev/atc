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
- **`GET /api/radio?since=<iso>&freq=<list>&limit=<n>`** returns `{ at, since, transmissions }`, newest last. `since` defaults to the last 6 hours, `freq` is a comma list of `DELIVERY`, `TOWER`, `GROUND`, `COMPANY` (any case), and `limit` keeps the newest n and is capped at 2000. A bad value returns `400`.
- **SSE topic `radio`** (`/api/events?topics=radio`, ATC-153) sends `event: radio` with `{ transmissions }` holding the transmissions that are new or changed since the last send (a reply arrived, `open` cleared, `overdueAt` moved by a STANDBY). It sends nothing on connect: read `GET /api/radio` first and merge by `id`. The default set is unchanged (`snapshot`, `alert`, `version`), and the server reads the files on each tick only while someone listens.

Where this differs from the design: the design said `radioOf(records)`, and it is `radioOf(input)` over the raw ops for the reason above. It adds `aircraft` and `orphan` to the transmission fields, and `ALL` as a station.

**PILOT'S DISCRETION.** Only `inspect`, `escalate`, `land` and `rts` in `mcc.jsonl` are transmitted (not `would-land`, `would-rts`, `mode`, `hold`, which are shadow or SUPERVISOR-side records). Both the `mcc.jsonl` `rts started` and the `rts.jsonl` results are transmitted, as separate GROUND lines. The AIRPORT of a CLEARANCE comes from the FLIGHT's FLIGHT PLAN (`create.airport`); a CLEARANCE for a FLIGHT with no proposal has none.

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

## Not built yet

Everything in sections 3–5.
