# Research: how aviation signals contact, acknowledgement and completion

**English** · [한국어](aviation-signals.ko.md)

> Status: research for [ATC-118](https://linear.app/vocado/issue/ATC-118), 2026-09-29. Read-only: nothing here changes a message format, guard, manual or session. The recommendations at the end are outlines for ENGINEERING to decide on. The SUPERVISOR asked for two additions, and they are in sections 9 and 10: what the alert sounds actually are, and whether recorded voice data can be used.

## Question

atc borrows aviation's words: CLEARANCE, READBACK, FLIGHT PLAN, HANDOFF. What does aviation actually do to:

- call one party;
- confirm a message;
- report progress;
- say that something is done?

And what should atc take from it?

## Method

- **Primary sources** where they are public:
  - ICAO Doc 10037 (GOLD, CPDLC);
  - FAA AC 25.1322-1 (flightcrew alerting);
  - FAA Pilot/Controller Glossary and AIM;
  - ICAO Doc 4444 (readback items, quoted through public copies);
  - EASA Part-145.A.50 (release to service).
- **Summaries, where the specification is paywalled or not public:**
  - ARINC 714 (SELCAL) and ARINC ACARS specifications;
  - IEC 60601-1-8 (medical alarms);
  - IATA delay codes.

  These are marked below.
- **atc facts** come from the code on `origin/main` and the state records on 2026-09-29. Counts only, no message bodies:
  - `clearances.jsonl`, 2026-09-26 17:01Z to 09-29 03:46Z;
  - `proposals.jsonl`;
  - the FLIGHT RECORDER for 09-28/29.
- **Limit:** ICAO Doc 4444 and Doc 9432 aren't freely published by ICAO. Their wording is quoted from public copies and summaries, and the FAA glossary is used for the word meanings.

## Summary

| # | Aviation practice | atc today | Recommendation | Effect | Effort, tier |
|---|---|---|---|---|---|
| 1 | Voice: read back safety items; WILCO / ROGER / UNABLE / STAND BY each mean something different | One word, `READBACK <id>`, for every message. A reason instead of READBACK means "can't". FLIGHT PLAN has a `decline` op; CLEARANCE has none | **Adapt.** atc messages are text, so a datalink model fits better than voice (row 2) | — | — |
| 2 | CPDLC: each message has a response attribute (W/U, A/N, R, Y, N). A closure response closes it. STANDBY keeps it open and restarts the timers. Timeouts fall back to voice | Every CLEARANCE asks for READBACK, INFO included (81 of 110). A 10-min overdue exists, and TOWER re-sends once, then reports to the SUPERVISOR. There is no STANDBY and no UNABLE for CLEARANCE | **Take.** Put a response attribute in each header, add `UNABLE <id> — reason` and `STANDBY <id>`, and let INFO ask for ROGER or nothing | Silence and "can't" are told apart; fewer READBACKs that carry nothing | M, `user` (root and application `CLAUDE.md` READBACK rules) plus `flagged` (manuals) |
| 3 | ACARS OOOI: Out, Off, On and In, sent automatically from door, brake and gear sensors | DEPARTED (claim or READBACK) and ARRIVED (merge) are automatic. PR opened is known. "In service" (deployed) is not recorded per FLIGHT | **Take.** Record four fixed milestones per FLIGHT: OUT, OFF, ON, IN | Actual times for ETAs and FOLLOWING; a per-FLIGHT "deployed" signal | M, `auto` |
| 4 | SELCAL: crews keep a noisy frequency turned down, and a two-tone call wakes one aircraft | SQUELCH (drop empty ticks) is being built. The SUPERVISOR has no call signal; [ATC-87](https://linear.app/vocado/issue/ATC-87) adds one | **Take** the idea for ATC-87: a distinct "you are being called" sound for items waiting on the SUPERVISOR | The SUPERVISOR stops watching the screen | S, inside ATC-87 |
| 5 | Alerting: fewer than 10 unique tones; one master warning tone and one master caution tone; no aural for advisories; acknowledge to silence; nuisance alerts destroy trust | ALERT levels are in [ATC-110](https://linear.app/vocado/issue/ATC-110), sound in ATC-87 | **Take**, as a check. ATC-87 already follows it. Add the tone limits and ramps from AC 25.1322-1 (section 9) | Sounds people keep switched on | S, inside ATC-87 |
| 6 | Handoff: CONTACT means call the new unit; MONITOR means listen only. Check-in on the new frequency | HANDOFF is detected, not announced. CREW CHANGE asks for READBACK | **Skip for now.** A check-in after `/clear` or relaunch could close the RESTARTING gap (ATC-91), but that is small | — | — |
| 7 | A-CDM: 16 shared milestones with target and actual times that every airport partner sees | LANDING SEQUENCE, RTS and ARRIVED are separate views | **Adapt** through row 3: the four milestones are atc's shared milestones | One timeline per FLIGHT | with row 3 |
| 8 | Completion with accountability: a Certificate of Release to Service is signed by authorised staff after they verify the work, with exceptions stated | MCC INSPECTION `pass` is bound to the head SHA, and RTS has a health check with ROLLBACK | **Keep.** It already matches. Optionally, the arrival report lists what was "otherwise specified" (PILOT'S DISCRETION) | — | — |
| 9 | Sounds: master warning as a repeating chime, master caution as a single chime. SELCAL as a fixed tone table | No sound anywhere in atc | **Take:** synthesize a small set in the browser (section 9). Never ship recordings | — | inside ATC-87 |
| 10 | Voice data: ATC speech corpora and live feeds | Not used | **Skip.** No corpus allows redistribution in an MIT repository, and atc doesn't need speech | — | — |

## 1. Voice acknowledgement

**Readback is for safety items, not for everything.** ICAO Doc 4444 (4.5.7.5.1) lists what must always be read back:

- route clearances;
- runway entry, landing, take-off, hold-short, crossing and backtrack;
- runway in use, altimeter settings, SSR codes;
- level, heading and speed instructions;
- transition levels.

Other messages are acknowledged. ROGER and WILCO are not enough for HOLD, HOLD POSITION or HOLD SHORT; the answer there is HOLDING or HOLDING SHORT (Doc 4444, quoted via SKYbrary and public copies).

**The words mean different things** (FAA Pilot/Controller Glossary):

| Word | Meaning |
|---|---|
| ROGER | "I have received all of your last transmission." Not an answer to a yes/no question |
| WILCO | "I have received your message, understand it, and will comply with it." |
| UNABLE | "Indicates inability to comply with a specific instruction, request, or clearance." |
| STAND BY | Pause, or wait. "The caller should reestablish contact if a delay is lengthy." It "is not an approval or denial." |
| READ BACK | "Repeat my message back to me." |

**Why voice reads back content:** voice is lossy. The controller hears the readback (hearback) and catches a wrong number.

atc sends text. The CAPTAIN gets the exact words the server made, so repeating them adds nothing. atc's `READBACK <id>` works like a WILCO on datalink, not like a voice readback.

What is lost is the difference between the other answers:

- "can't" is a free-text reason today;
- "later" doesn't exist;
- "noted" (ROGER, for INFO) is the same word as "will do".

## 2. CPDLC: response attributes, closure and timers

From ICAO Doc 10037 (GOLD, First Edition 2016, advance unedited version):

- **Open and closed.** An open message "contains at least one message element that requires a response" and "remains open until the required response is received". A closed message has no element needing a response, or "has received a closure response".
- **Response attributes** (precedence W/U, A/N, R, Y, N):
  - W/U: WILCO or UNABLE close it;
  - A/N: AFFIRM or NEGATIVE close it;
  - R: ROGER closes it;
  - Y: any response;
  - N: none.
- **STANDBY isn't a closure.** "A RSPD-3 STANDBY response to an open CPDLC uplink message does not operationally close the dialogue."
- **Timers.**
  - The ground timer `tts` is 120 s after a message needing an operational response. When it expires, "the controller is notified and reverts to voice".
  - The aircraft timer `ttr` is 100 s. On ATN B1 aircraft the message times out, and "the flight crew should contact ATC by voice".
  - "If the flight crew responds to a clearance with a STANDBY, the aircraft and ground timers are re-started."
  - The LACK timer is 40 s.
- **No closure in time** (3.3.1.2): the controller keeps protecting the airspace of the outstanding clearance and uses voice to clarify.

**atc today (2026-09-26 → 09-29):**

- **CLEARANCE:**
  - 110 CLEARANCEs: 81 INFO and 29 LAND. 79 of the INFO and 25 of the LAND were read back.
  - READBACK arrived a median 0.3 min and p90 0.9 min after issue.
  - The only ops are `issue`, `readback` and `cancel`.
- **FLIGHT PLAN:**
  - 16 of 17 were accepted, a median 0.5 min after send.
  - `decline` exists and was never used.
- **Timers:**
  - READBACK is overdue after 10 min for FLIGHT PLAN, CLEARANCE and CREW CHANGE (`READBACK_OVERDUE_MS`, `OVERDUE_MS`, `CREW_CHANGE_READBACK_OVERDUE_MS`).
  - DEPARTED is overdue 30 min after READBACK.
  - A STAND-free FLIGHT's ARRIVED is overdue after 24 h.
- **Fallback:** on NO READBACK, TOWER re-sends once, then reports to the SUPERVISOR (`controller/CLAUDE.md`). That already mirrors "timeout → revert to voice": the SUPERVISOR is atc's voice channel.
- **Recording:** READBACKs are recorded by the control session with `atcctl … readback`. It reads the reply and records it; nothing is parsed automatically.

**What fits atc:**

- **A response attribute per message kind:**
  - `W/U` for LAND, HOLD, FLIGHT PLAN, RECALL and CREW CHANGE;
  - `R` for INFO and TRAFFIC.
  - The closing line then says which answers are expected.
- **An explicit `UNABLE <id> — <reason>`:**
  - it closes the message;
  - it maps to `decline` for D-, and a new `unable` for C-.
- **`STANDBY <id>`:** it keeps the message open and restarts the 10-min overdue once.
- **Keep the fallback as it is:** re-send once, then the SUPERVISOR.

## 3. ACARS OOOI and automatic reports

OOOI is the four fixed milestones of a flight: "out of the gate, off the ground, on the ground, and into the gate". They are detected from "aircraft sensors mounted on doors, parking brakes, and struts" and sent without crew action (Wikipedia "ACARS"):

| Milestone | Trigger |
|---|---|
| **Out** | parking brake released, doors closed |
| **Off** | weight off wheels |
| **On** | weight on wheels |
| **In** | parking brake set, doors opened |

Each report carries the time and data such as fuel on board. Airlines use them for block time, delay and crew pay. The exact messages are in ARINC 618/620/633, which are paywalled; this is from public summaries (airlabs.co, Wikipedia "ACARS").

IATA standard delay codes attach a reason to a late milestone (AHM 730/731, paywalled; not verified here).

**atc's equivalents already exist, but not as one set:**

| OOOI | atc signal | Recorded today |
|---|---|---|
| OUT | DEPARTED: STAND claimed after READBACK, or READBACK for a STAND-free FLIGHT | yes (`departures.jsonl`, proposals `depart`) |
| OFF | PR opened, or first push | known from GitHub; not recorded as a FLIGHT milestone |
| ON | PR merged → ARRIVED | yes (LOGBOOK) |
| IN | the merge commit is in service after RTS | **no**. `rts.jsonl` lists commits, but not per FLIGHT |

Recording all four per FLIGHT, with actual times, gives FOLLOWING and ETA a fixed timeline. It also gives "deployed" a signal. Today a FLIGHT counts as ARRIVED at merge, even though with MCC in `land+rts` it reaches service minutes later, through RTS.

## 4. Getting attention: SELCAL

HF radio is noisy, so crews keep the volume low. SELCAL lets a ground station call one aircraft (Wikipedia "SELCAL", code7700.com):

- **Code:** each aircraft has a four-letter code.
- **Call:** the ground sends two pairs of simultaneous tones, each about 1.0 ± 0.25 s long, with about 0.2 ± 0.1 s between them.
- **In the cockpit:** a chime and a light, so "crewmembers need not devote their attention to continuous radio listening".
- **Tone table:** 16 tones, A = 312.6 Hz up to S = 1479.1 Hz (ARINC 714, via public tables).

This is the SUPERVISOR's situation. Today the approval median is 3.9 min because someone watches the screen. SQUELCH does the same for control sessions: drop the noise until a SIGNAL comes. The SUPERVISOR needs the other half, a distinct call when something waits on them. ATC-87 already plans a PENDING chime; this research recommends a SELCAL-like two-tone pattern for it (section 9).

## 5. Alerting philosophy

From FAA AC 25.1322-1 (2010):

- **Number of sounds.** "The number of unique tones should be less than 10."
  - "Provide one unique tone for master warning alerts and one unique tone for master caution alerts."
  - No master aural alert for advisories, "because immediate flightcrew attention is not needed".
- **Distinguishable.** "Each sound should differ from other sounds in more than one dimension (frequency, modulation, sequence, intensity)."
- **One at a time.** Only one aural alert plays at a time, and a higher urgency interrupts a lower one.
- **Acknowledge.** The system must "permit each occurrence of attention-getting cues for warning and caution alerts to be acknowledged and then suppressed, unless the alert is required to be continuous". Repeat and allow cancelling when "a positive acknowledgement of the alert condition is required". Don't repeat when continuous awareness isn't needed.
- **Nuisance alerts.** Frequent false or nuisance alerts reduce "the flightcrew's confidence in the alerting system", and crews "may ignore a real alert".
- **Remove** the alert when the condition no longer exists.

**Checked against atc:**

- ATC-110 (levels, ADVISORY quiet) and ATC-87 (WARNING repeats until ACK, CAUTION once, ADVISORY silent, burst merging) match.
- The FLIGHT RECORDER had 46 `alert.raised` in 24.7 h:
  - up to 9 in an hour, with 11 within a minute of the one before;
  - no-workspace 16, health 14, orphan 12, stranded 2, unattended 2, conflict 0.
- So sounding every alert would be exactly the nuisance the AC warns about.

## 6. Handoff and check-in

On a frequency change the controller says CONTACT or MONITOR (FAA AIM 4-2, GOLD):

- CONTACT (facility, frequency) means call the new unit;
- MONITOR means listen only; the new unit calls first.

atc detects a HANDOFF from STAND activity (one session lets go, another takes over), and it is not an alert. CREW CHANGE uses READBACK.

A "check-in" when an AIRCRAFT returns after `/clear` or a relaunch could replace part of the RESTARTING grace (ATC-91). The gain is small, so this research does not recommend it now.

## 7. Shared milestones: A-CDM

Airport Collaborative Decision Making defines 16 milestones per flight with target and actual times, such as:

- TOBT (Target Off-Block Time: aircraft ready, doors closed);
- TSAT (Target Start-up Approval Time, from ATC);
- AOBT (Actual Off-Block Time).

Airline, handler, airport and ATC all see the same milestones. That improves "awareness of all airport partners", triggers downstream updates and flags delays early (EUROCONTROL A-CDM specification and ICAO APAC presentations).

atc's parties (OCC, TOWER, MCC, the CAPTAIN, the SUPERVISOR) each see their own view of a FLIGHT. The four milestones in section 3 are the smallest common set. Target times can follow later from TRIP FUEL and the ETA logic on NETWORK.

## 8. Completion with accountability

EASA Part-145.A.50:

- A certificate of release to service (CRS) is issued by authorised certifying staff when all ordered maintenance "has been properly carried out".
- It is issued "before flight at the completion of any maintenance".
- Its statement says the work was done "except as otherwise specified".

The trust comes from three things: an authorised signer, verification against the order, and stated exceptions.

atc already has the same shape:

- **MCC INSPECTION** is bound to the head SHA and checks the change against the ATC issue's exit criteria. Only `pass` lands.
- **RTS** declares service healthy only after the version, session and daemon checks, else ROLLBACK.
- **Stated exceptions** exist too: PILOT'S DISCRETION choices go into the PR body. The CAPTAIN's final report is where a fixed "otherwise specified" field would help (recommendation 4).

## 9. What the sounds actually are

**Airliners (public summaries, not manufacturer manuals):**

| Aircraft | Alert | Sound | Source |
|---|---|---|---|
| Airbus | Level 3, red warnings | "continuous repetitive chime or a specific sound or a synthetic voice" | Wikipedia "ECAM" |
| Airbus | Level 2, amber cautions | "a single chime" | Wikipedia "ECAM" |
| Airbus | Level 1 | no aural | Wikipedia "ECAM" |
| Airbus | autopilot disconnect / stall | "cavalry charge" / "cricket" | unverified (flight-simulation community descriptions) |
| Boeing | fire / cabin altitude, configuration, overspeed / autopilot disconnect | bell / siren / wailer | unverified (training-site descriptions) |

**Design rules that apply to any alert sound:**

- **FAA AC 25.1322-1, Appendix 2:**
  - frequencies between 200 and 4500 Hz;
  - at least two frequencies, or one with a distinct spacing;
  - onset and offset ramps of 20–30 ms "to avoid startling";
  - fewer than 10 unique tones;
  - one tone each for master warning and master caution, none for advisories.
- **IEC 60601-1-8, medical alarms (paywalled; from manufacturer application notes):**
  - fundamental frequency 150–1000 Hz, with harmonics;
  - high priority is a burst of 10 fast pulses, medium 3, low 1–2.

  It is a useful second model because it encodes priority by pulse count, which survives cheap speakers.
- **SELCAL tone table:** 16 tones from 312.6 to 1479.1 Hz, played in two pairs of about 1 s each.

**What this means for ATC-87:**

- Four sounds at most, all synthesized with Web Audio:

  | Sound | Pattern |
  |---|---|
  | **WARNING** | a two-tone burst of several fast pulses, repeating until ACK |
  | **CAUTION** | one soft two-tone chime, not repeated |
  | **CALL** (something waits on the SUPERVISOR) | a short SELCAL-like pattern: two tone pairs, shortened to about 0.3 s each |
  | *(optional, off by default)* **DONE** | one low tone for an RTS result |

- Completion is advisory, so by default it has no sound.
- Each sound differs from the others in pitch **and** rhythm.
- Stay within 200–1500 Hz for small speakers, and ramp every onset and offset by 20–30 ms.
- Don't copy an aircraft manufacturer's sound. Recordings on sample sites have unclear provenance, and a recognisable manufacturer sound brings trademark questions. Tone frequencies from a published table can't be copyrighted and are fine to use.

## 10. Voice data (recordings and corpora)

| Source | What | Terms (as published, checked 2026-09-29) | Usable in atc? |
|---|---|---|---|
| LiveATC.net | Live and archived ATC feeds | "Personal non-commercial purposes only". Redistribution, reproduction and use in third-party products are not allowed without permission | No |
| ATCOSIM (EUROCONTROL, TU Graz) | 10 h of simulated controller speech, English, non-native speakers | Free of charge, but no redistribution to third parties | Not in the repository. Local research only |
| ATCO2 (Idiap and partners) | 1 h test set free "for research purposes". 4 h test set and 5,281 h training set through ELRA | The paid sets are sold through ELRA. One public summary names CC BY-NC-ND 4.0, the project page says "commercial and non-commercial use". **Not verified**: the ELRA catalogue page didn't load | No |
| UWB-ATCC (University of West Bohemia) | About 20 h of Czech ATC, English | CC BY-NC-SA 4.0 | No (NonCommercial and ShareAlike don't fit an MIT repository) |
| LDC Air Traffic Control Complete (LDC94S14A) | About 70 h from DFW, BOS and DCA (1994) | LDC user agreement; fee for non-members | No |

**Conclusion:**

- atc doesn't need recorded speech. Its messages are text, and its sounds can be synthesized.
- None of these sources can be bundled in a public MIT repository.
- If spoken callouts are wanted later ("TEAM_G STALLED"), the browser's `speechSynthesis` makes them locally from text, with no data. ATC-87 keeps that out of scope for now.

**As built (ATC-140, spoken callouts).** The "spoken callouts later" idea above is built, but not with the browser's `speechSynthesis`: its output can't go through Web Audio, and on this machine Chrome falls back to Google voices that send the text away. A **local engine** renders the voice and the browser puts the radio on it. Guide: [docs/guide/voice.md](../guide/voice.md) (Korean).

- **Phrases** (`server/voice-phrase.ts`, pure, also used by the browser tests). A fixed English template per alert kind, read from the alert `key`, callsigns from `callsign()` and FLIGHT keys digit by digit (`ATC-120` is "ATC one two zero", 9 is "niner"). The Korean `text` is never read. Output is limited to `[A-Za-z0-9 ,.'-]` and 200 characters. Kinds: WARNING `conflict`, `stranded`, RTS `rollback`/`failed`; CALL PENDING tool approval, DISPATCH proposal, HUMAN CHECK; a `STALLED` template exists but health is CAUTION, so it is not spoken. A kind with no template returns `null` (tone only).
- **Engine adapter** (`server/tts.ts`). `piper` runs `execFile` with no shell (`-m <voice>.onnx -f <file>`, the phrase on stdin, 5 s timeout, one render at a time; the short options work with both the old `piper` binary and `piper-tts`), `stub` is for tests, `none` is the default (ATC-142: the code now matches; pick `piper` in settings or with `ATC_TTS_ENGINE=piper` after installing it). Config `ATC_TTS_ENGINE`, `ATC_TTS_PIPER`, `ATC_TTS_VOICES`, `ATC_TTS_VOICE`. A missing binary or voice is a status, not an exception. Another engine is one adapter.
- **API** (`server/voice-run.ts`, files only; the server never plays audio). `GET /api/voice/status`; `GET /api/voice/alert/:key.wav` renders the phrase of a **current** WARNING or CALL alert key (anything else, CAUTION included, is 404; the client never sends text); `GET /api/voice/preview.wav?voice=` renders a fixed sample. WAVs are cached under `~/.local/state/atc/voice-cache/` by `hash(engine, voice, phrase)` (200 files or 20 MB, oldest out; disposable, never in the repository).
- **Radio chain** (`web/src/radio.ts`, pure `radioSpecOf`, `planOf`, `driveCurve`). Key click (15 ms noise), squelch open (80 ms band-limited noise), the voice through high-pass 300 Hz, low-pass 3000 Hz, a light `WaveShaper` and a `DynamicsCompressor`, a low hiss under the voice, a squelch tail (150 ms), 25 ms ramps on every edge. One knob `radio` (0 clean to 1 full) scales all of it.
- **Rules.** Voice is only for WARNING and CALL, once after the tone (a repeating WARNING tone does not repeat it), ACK stops both, and a merged burst speaks its highest-level alert only (a lower CALL is not read when a CAUTION is on top). Leader tab, one sound at a time, quiet hours and the 10-minute re-sound guard are ATC-87's.
- **Settings.** VOICE on/off (default off, per browser), voice picker from `/api/voice/status` with a preview button, the `radio` amount; the chosen voice and engine go to `.env.local` through the settings save. `TTS 엔진 없음` with a link to the guide when no engine works.
- **Licences checked 2026-09-29.** `piper-tts` (OHF-Voice/piper1-gpl) is GPL-3.0 and is run as a separate process, never bundled. Voice models carry their own licence: `en_US-ryan-high` and `en_US-hfc_male-medium` are CC BY-NC-SA 4.0; `en_US-lessac-medium` follows the Lessac Blizzard 2013 licence at Edinburgh CSTR (commercial use not confirmed from the model card). No recording or ATC-feed audio is used.

## Recommendations (EO outlines for ENGINEERING)

### EO 1. Response attributes, UNABLE and STANDBY

- **Goal:** every atc message says which answer closes it, and the CAPTAIN can say "can't" and "later" in a fixed form.
- **Exit criteria:**
  - **Header:** CLEARANCE, FLIGHT PLAN, RECALL and CREW CHANGE headers carry the expected answer: `W/U` for LAND, HOLD, FLIGHT PLAN, RECALL and CREW CHANGE; `R` for INFO and TRAFFIC.
  - **`UNABLE <id> — <reason>`:**
    - it closes the message, as `decline` for D-, and a new `unable` op for C- and CC-;
    - it is shown on STRIPS and DISPATCH;
    - it raises a CAUTION key for ATC-87.
  - **`STANDBY <id>`:** it restarts the 10-min overdue once and records `standby`. A second STANDBY is recorded but doesn't restart the timer.
  - **`ROGER <id>` closes an `R` message.** A READBACK is still accepted, so older habits don't break.
  - **Tests:** pure fold tests for each op.
  - **Rules:** manuals (TOWER, OCC) and root and application `CLAUDE.md` READBACK rules are updated.
- **Constraints:**
  - Don't loosen any guard. `send-guard` compares text as today.
  - Keep `READBACK` valid everywhere.
- **Tier:** `user` (root `CLAUDE.md`), plus `flagged` manuals.

### EO 1 as built (ATC-122)

- `server/response.ts` (pure):
  - `responseOf` gives W/U for LAND, HOLD, CONTINUE, FLIGHT PLAN, RECALL and CREW CHANGE, and R for INFO, TRAFFIC and REPORT.
  - `answerError` accepts READBACK always, ROGER only on R, STANDBY only on W/U, and nothing but READBACK on a RECALL.
  - `closingLine` writes the closing line; `overdueBase` moves the overdue start to the first STANDBY.
- **Records:**
  - CLEARANCE gains `roger`, `unable {reason}` and `standby` ops; the first closing answer wins, and cancel still works after a READBACK.
  - FLIGHT PLAN gains a `standby` op; UNABLE is the existing `decline`.
  - CREW CHANGE gains an `unable` status and a `standby` op.
  - Old servers skip the new ops.
- **Where it shows:**
  - STRIPS stamps show ROGER, STANDBY and UNABLE with the reason.
  - DISPATCH IN FLIGHT rows show STANDBY.
  - FLIGHT FOLLOWING has an `unable` issue for a day, for UNABLEs with a FLIGHT.
  - `crew-change brief` has `unable`.
- **Recording:** atcctl records the answers: `roger`, `unable -- <reason>`, `standby`, and the `dispatch` and `crew-change` forms. Replies are still read and recorded by the control session; nothing parses team messages.
- **Rules:** root `CLAUDE.md` (both languages), the `atc-task` skill, and the TOWER and OCC manuals list the answers. `VOCADO_READBACK_SUGGESTION` is the same sentence as root `CLAUDE.md`, and a test now checks that.
- **Not done:** the application repositories' own rule lines are the SUPERVISOR's to change. Until then their CAPTAINs still see the answers in each closing line.

### EO 2. OOOI milestones per FLIGHT

- **Goal:** one fixed timeline per FLIGHT: OUT (DEPARTED), OFF (PR opened), ON (merged, ARRIVED), IN (in service after RTS).
- **Exit criteria:**
  - A pure function derives the four times from `departures.jsonl`, GitHub PR data, LOGBOOK and `rts.jsonl`. IN is the first successful RTS whose target contains the merge commit.
  - The times are shown on FOLLOWING and the FLIGHT row, and FLIGHT RECORDER events are written when each first happens.
  - Missing milestones stay empty, never guessed.
- **Constraints:**
  - No new detection of team work.
  - The ARRIVED meaning doesn't change. IN is added beside it.
- **Tier:** `auto`.

### EO 3. A fixed-field arrival report

- **Goal:** the CAPTAIN's final report has fixed fields that atc can check. It is an "In" report with its data.
- **Exit criteria:**
  - **Format:** `[TEAM_X → OCC|ENGINEERING] ARRIVED ATC-n · PR #n` plus one line each for `tier`, `tests`, `discretion` (count, then list) and `blocked` (none, or list).
  - **Check:** FOLLOWING marks a FLIGHT with a merged PR but no arrival report.
  - **Skill:** the `atc-task` skill section 8 uses it.
- **Constraints:** it complements [ATC-18](https://linear.app/vocado/issue/ATC-18) (every report covered). It doesn't replace the free-text summary.
- **Tier:** `user` (`.claude/`), `flagged` for control manuals that read it.

### EO 4. Sound set for ATC-87 (amend ATC-87, no new issue)

- **Goal:** ATC-87's sounds follow section 9.
- **Details:**
  - four sounds at most: WARNING, CAUTION, CALL, and an optional DONE;
  - they differ in pitch and rhythm;
  - 200–1500 Hz, 20–30 ms ramps, synthesized, no recordings;
  - CALL is SELCAL-like;
  - completion is silent by default.

### EO 5 (lower). Check-in after a restart

- **Goal:** when an AIRCRAFT returns after `/clear` or a relaunch, it sends `CHECK IN TEAM_X`, which ends RESTARTING at once instead of waiting for the grace (ATC-91).
- **Recommendation:** decide after EO 1, since it uses the same parser.

## What could not be verified

- **ARINC 618/620/633 and 714:** the texts are paywalled. The OOOI triggers and the SELCAL tone table come from public summaries.
- **IATA AHM 730/731 delay codes:** not read.
- **IEC 60601-1-8:** not read. Pulse counts and frequency limits come from manufacturer application notes.
- **Airbus and Boeing sounds:** from public descriptions, not manufacturer manuals. Only the Airbus warning and caution chimes were checked against a written source (Wikipedia "ECAM"). The rest are marked unverified in the table.
- **ATCO2 licence:** the ELRA catalogue page (ELRA-S0484) didn't load. Two public descriptions disagree.
- **LiveATC terms:** the page is behind a browser challenge. The terms are quoted from search-indexed text of https://www.liveatc.net/legal/.
- **ICAO Doc 4444 and Doc 9432:** quoted through public copies and summaries, not ICAO's store.

## Sources (accessed 2026-09-29)

- ICAO Doc 10037, Global Operational Data Link (GOLD) Manual, First Edition 2016, advance unedited version, via SKYbrary: https://skybrary.aero/sites/default/files/bookshelf/4134.pdf (sections: Definitions, 3.3.1.2, 3.4.3, 4.3.2, B.2.2.4)
- FAA AC 25.1322-1, Flightcrew Alerting, 2010-12-13: https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_25.1322-1.pdf (paragraphs 8, 12 and Appendix 2)
- FAA Pilot/Controller Glossary: https://www.faa.gov/air_traffic/publications/atpubs/pcg_html/ (WILCO, ROGER, UNABLE, STAND BY, READ BACK, SAY AGAIN, AFFIRMATIVE)
- FAA AIM 4-2 Radio Communications Phraseology and Techniques: https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap4_section_2.html
- ICAO Doc 4444 PANS-ATM, readback (4.5.7.5), public copy: https://www.bazl.admin.ch/dam/it/sd-web/jMIWMg9YgaoW/4444_cons_en.pdf; European Action Plan for the Prevention of Runway Incursions (SKYbrary): https://skybrary.aero/sites/default/files/bookshelf/1861.pdf
- FAA Order 7110.125A, CPDLC in the ERAM environment (response attribute precedence): https://www.faa.gov/documentLibrary/media/Order/2022-10-13_Order_7110.125A_Controller_Pilot_Data_Link_Communications_(CPDLC)_in_the_ERAM_Environment_FINAL.pdf
- SELCAL: https://en.wikipedia.org/wiki/SELCAL ; https://code7700.com/selcal.htm
- ACARS and OOOI: https://en.wikipedia.org/wiki/ACARS ; https://airlabs.co/acars-explained
- ECAM (Airbus chimes): https://en.wikipedia.org/wiki/Electronic_centralised_aircraft_monitor
- IEC 60601-1-8 summaries: https://www.newark.com/pdfs/techarticles/mallory/AudibleAlarmsMedicalEquipment.pdf ; https://www.ti.com/lit/pdf/sszt261
- EUROCONTROL A-CDM specification: https://www.eurocontrol.int/sites/default/files/2025-01/eurocontrol-specification-for-acdm.pdf ; ICAO APAC "What is A-CDM": https://www.icao.int/sites/default/files/APAC/Meetings/2025/2025%20Capacity%20Assessment%20WS/Day%201/SP-04-What-is-A-CDM-by-EUROCONTROL.pdf
- EASA Part-145.A.50 (UK CAA regulatory library copy): https://regulatorylibrary.caa.co.uk/1321-2014/Content/Regs/01652%20145.A.50%20Certification%20of%20maintenance.htm
- LiveATC terms: https://www.liveatc.net/legal/
- ATCOSIM: https://www.spsc.tugraz.at/databases-and-tools/atcosim-air-traffic-control-simulation-speech-corpus.html
- ATCO2 data: https://www.atco2.org/data ; https://github.com/idiap/atco2-corpus
- UWB-ATCC: https://huggingface.co/datasets/Jzuluaga/uwb_atcc
- LDC Air Traffic Control Complete: https://catalog.ldc.upenn.edu/LDC94S14A
