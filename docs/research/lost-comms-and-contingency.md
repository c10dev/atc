# Research: how aviation handles lost communications and abnormal situations

**English** · [한국어](lost-comms-and-contingency.ko.md)

> Status: research for [ATC-258](https://linear.app/vocado/issue/ATC-258), 2026-10-01. Read-only: nothing here changes a message format, guard, manual, timer or session. The proposals in section 10 are outlines for DUTY/ENGINEERING and the SUPERVISOR to pick from; none is decided.

## Question

On 2026-10-01, in one morning, atc lost contact or state in six different ways (section 1). Each time the SUPERVISOR found it by asking "why is this slow?", not atc. atc borrows aviation's words (NORDO, HOLD, GO AROUND, READBACK, ALERTS, SAFETY REPORT) but not the procedures behind them. What does aviation do, and what should atc take from it?

## Method and limits

- **Sources.** Public ones, cited by document and chapter:
  - ICAO Annex 2 (rules of the air), Annex 10 vol II (voice), Annex 11 (ATS, ch. 2 and 5), Annex 12 (SAR), Annex 15 (NOTAM), Annex 19 (safety management); PANS-ATM Doc 4444 (ch. 15 and the readback items); Doc 9426 (ATS planning manual); GOLD (Doc 10037, CPDLC).
  - FAA: 14 CFR 91.185 and 91.213, AIM chapters 4 and 6, JO 7110.65 chapter 10, JO 7210.3 and JO 1900.47 (contingency), AC 00-46 (ASRS).
  - EASA and Eurocontrol: Reg (EU) 2017/373, Reg (EU) 376/2014, SKYbrary articles.
- **Honest limit.** This was written by the CAPTAIN of TEAM_G from what it knows of these documents. No web page was fetched in this session, and the ICAO texts are not freely published. So paragraph numbers are given only where well known; for the others the chapter is named. **Check a paragraph number against the current edition before quoting it** in a design or a manual. The shape of each procedure (who does what, which timer) is the part this report relies on.
- **atc facts** come from `origin/main` as of 2026-10-01 (docs and code named in each table). Counts and incident details are only at the level of the ATC-258 issue. Nothing was read from or written to `~/.local/state/atc/`.

## 1. The six incidents, in one line each

| # | What happened | Class |
|---|---|---|
| I1 | OCC could not reach AIRCRAFT on another ACCOUNT; four FLIGHT PLANs and a RECALL sat unsent, one team waited 33 min for a RECALL ([ATC-251](https://linear.app/vocado/issue/ATC-251)) | Lost comms (a path that never worked, not noticed for hours) |
| I2 | APPLY NOW waited for sends, sends waited for OCC to move: a deadlock (ATC-251 comment) | Contingency: circular dependency |
| I3 | Four background AIRCRAFT stalled on a permission prompt with nobody to answer; TOWER said "awaiting supervisor approval" ([ATC-252](https://linear.app/vocado/issue/ATC-252)) | Silent wait; no timer, no escalation |
| I4 | An `ARRIVED` report reached OCC, OCC ended before recording it, the CAPTAIN did not resend | Lost report; no acknowledgement |
| I5 | Host reboot ended every session; first boot failed with "Cannot fork"; control sessions came back one by one in an unwritten order ([ATC-255](https://linear.app/vocado/issue/ATC-255)) | "ATC zero" and recovery |
| I6 | TOWER kept a TEAM_I block after the RECALL; an Urgent issue was dispatched after its fix had landed ([ATC-243](https://linear.app/vocado/issue/ATC-243), [ATC-245](https://linear.app/vocado/issue/ATC-245)); TOWER showed "NORDO 10" for STANDs whose AIRCRAFT were not launched yet | Stale information; a word used for the wrong state |

## 2. Lost communications, pilot side

**What aviation does.** The rule exists so that *everyone can predict the aircraft without talking to it*.

- **Squawk 7600** (Annex 10 vol IV; PANS-ATM ch. 15; AIM 6-4-1). The code tells every controller "radio failure" with no words.
- **Fly the plan everyone knows.** Annex 2 §3.6.5.2 and 14 CFR 91.185 differ in detail but have one idea:
  - in visual conditions: stay visual, land at the nearest suitable aerodrome, report the arrival;
  - otherwise: **route** = last assigned, else vectored-to fix, else expected (an "expect further clearance" given earlier), else filed; **level** = the highest of assigned, minimum safe, expected; **time** = leave the holding fix at the expected-further-clearance time, begin descent at the filed/estimated time. FAA adds the "as you were told to expect" rule so that a pilot never has to guess.
- **Transmit blind.** Say the position and intentions on the working frequency and on **guard 121.5**, even when you cannot hear a reply (Annex 10 vol II; AIM 6-4-1); relay through another aircraft that can hear both ends.
- **Out-of-band signals.** ATC light-gun signals (steady green, flashing red, …; AIM 4-3-13 and Annex 2 appendix 1) work with no radio. The channel differs from the failed one on purpose.
- **Make it known afterwards.** Land, then report the failure; the controller decides whether the aircraft may leave.

**What this teaches atc.** A NORDO aircraft is **not frozen and not free**. It follows a rule that is the same for every aircraft, written in advance, so the controller can still protect its path.

## 3. Lost communications, controller side

**What aviation does** (PANS-ATM ch. 15 "communication failure"; JO 7110.65 ch. 10 "radio communications failure"):

1. **Establish the failure is on your side or theirs.** Try the other frequencies (the aircraft may be on the wrong one), ask the previous and next sectors, ask other aircraft to relay, and ask the aircraft to answer by another means: "if you hear me, squawk ident / change code".
2. **Transmit instructions blind** on the aircraft's frequency (and guard), in case the receiver works and the transmitter does not.
3. **Assume the aircraft follows the lost-comms rule** and keep other traffic separated from that predicted path; do not give clearances that rely on the aircraft's reply.
4. **Escalate by time** into the alerting phases (section 4). "Radar contact lost" and "no position report within X" start the same ladder.
5. **Tell others**: the next sector, the airline operator and, when the ladder starts, the rescue coordination centre.

**What this teaches atc.** A controller does not wait for a reply before acting on the assumption. It tries a *different path*, not the same one again. And it declares the state (NORDO) *only after* it has tried.

## 4. Alerting service and phases

**What aviation does** (Annex 11 ch. 5; Doc 4444 ch. 15; Annex 12; FAA JO 7110.65 ch. 10 sec. 3 for overdue aircraft). Three phases, each with a trigger in time, and each phase calls more people:

| Phase | Trigger (Annex 11 5.2.2, in short) | Action |
|---|---|---|
| **INCERFA** (uncertainty) | No communication within 30 min after the time one should have been received, **or** the aircraft is not seen within 30 min of its last estimate for arrival | Inquire at once: other units, the operator, the aerodrome |
| **ALERFA** (alert) | INCERFA inquiries gave no news; **or** cleared to land but not landed within 5 min of the estimate and no contact; **or** efficiency is impaired but a forced landing is not likely | Alert the rescue centre; widen the inquiry |
| **DETRESFA** (distress) | ALERFA ended without result; **or** fuel is used up; **or** a forced landing is likely or has happened | Full search and rescue |

Three points matter for atc:

- **The timers are in the unit's procedures, not in a person's head.** The controller does not "feel" an hour has passed; the strip shows it.
- **Each step names the next action and who does it.** INCERFA is *ask*, ALERFA is *call help*, DETRESFA is *act*.
- **The trigger is a missing event, not a bad event.** Nothing "goes wrong"; something simply fails to arrive on time. That is the case atc handles worst (I1, I3, I4).

## 5. Message assurance

**What aviation does.**

- **Readback and hearback** (Doc 4444 ch. 12 and 4; JO 7110.65 4-2-3). The pilot reads back clearances and safety-critical items (level, heading, runway, altimeter, frequency); the controller **listens to the readback** (hearback) and corrects it. The *sender* closes the loop, because the receiver can be wrong without knowing it.
- **"Say again."** An unclear message is re-requested, never guessed.
- **CPDLC** (GOLD, Doc 10037): every uplink gets a **logical acknowledgement** (it arrived and was understood by the avionics) separate from the pilot's **operational response** (WILCO / UNABLE / STANDBY). The ground system runs **timers**; if the response does not come in time, the controller is told and uses voice. A message with no acknowledgement is treated as *not delivered*, and the system says so on the screen.
- **AFTN/AMHS** (Annex 10 vol II, Doc 9880): messages carry a **channel sequence number** (a gap is visible) and AMHS gives **delivery reports** and **non-delivery reports**. A non-delivery report goes back to the *originator*, who must act on it. Service messages ask for repeats.
- **Position reports** are acknowledged ("radar contact", "position received"); on oceanic routes a report missing after its expected time starts the lost-comms search at once (the periodic ADS-C report plays the same role).

**What this teaches atc.** Each *kind* of message needs its own answer: "arrived" (delivery), "understood" (READBACK), "doing it" (departed), "done" (ARRIVED). The *originator* owns the timer. A missing answer is a state with a name and a next step, never silence.

## 6. ATS contingency and continuity

**What aviation does** (Annex 11 §2.30 contingency arrangements; Doc 9426; Reg (EU) 2017/373; FAA JO 1900.47 and JO 7210.3 "ATC zero"/facility evacuation).

- **Every unit has a written contingency plan** for degraded service and for no service: loss of a frequency, loss of radar, loss of the centre. It is agreed with adjacent units and the operators *before* the event.
- **"ATC zero"** means the facility cannot give any service. The plan says: traffic is stopped or routed away (a ground stop and flow restrictions), neighbours take or refuse traffic, a NOTAM says that no service is given, and pilots follow their own lost-comms and see-and-avoid rules.
- **Fallback** goes to a *different* unit or a reduced sector layout (bandboxing, a backup centre), never to a path that needs the failed thing.
- **Coming back** is a planned sequence: the supervisor confirms equipment and staffing first, the unit takes traffic *gradually* (flow restrictions are lifted in steps), and **neighbours are told in a fixed order** which positions are open. The first controller on a frequency makes a "contact" check, not a clearance.
- **Practice.** Contingency procedures are tested and recorded; the plan is reviewed after real use.

**What this teaches atc.** A plan written *before* the outage, whose steps do not depend on the thing that failed (I2), and with an order for coming back (I5).

## 7. Position handover

**What aviation does** (Annex 11; JO 7110.65 2-1 position responsibility; JO 7210.3 and facility **position relief briefing** checklists; Eurocontrol/SKYbrary "position handover").

- A **relief briefing** has a checklist: traffic and its plans, pending coordination, **unacknowledged messages**, open clearances and restrictions, equipment status, weather, special conditions. The outgoing controller stays until the incoming one says **"I have the position"**. Responsibility changes hands at a named moment.
- The checklist exists because **pending items are what a replacement loses**: a clearance given but not yet read back, a call waiting for a callback. Studies of operational errors point to handover as a recurring point of failure, which is why the checklist is mandatory in many units.
- **Some positions are never left unattended**: the unit may not release the old controller until the new one is in contact.

**What this teaches atc.** The briefing is written by the *leaving* position, from the record, while it is still running (before STOP), not reconstructed by the new one.

## 8. Abnormal and emergency handling

**What aviation does.**

- **Distress and urgency**: MAYDAY (grave and imminent danger) and PAN-PAN (urgency, not imminent danger), squawk **7700**, with fixed content: who, what, intentions, endurance. ATC gives priority and asks nothing that is not needed.
- **Aviate – Navigate – Communicate.** Fly the aircraft first, then know where it is, then talk. Under stress, a crew *keeps the aircraft safe* before it spends effort reporting.
- **Checklists** (QRH, ECAM/EICAS actions): written in advance, ordered by the first action that stops harm; "memory items" for the few that cannot wait. A crew does not invent a procedure in the middle of a failure.
- **Dispatch with known defects**: the **MEL** (14 CFR 91.213; Annex 6) lists what may be inoperative, under which conditions and for how long (a rectification interval). The aircraft is *released knowing* the defect.
- **NOTAM** (Annex 15) tells everyone about a known outage, with a *validity period* and an issue time.
- **Information has an age.** An ATIS carries a letter and a time; METARs carry the observation time; a pilot who has "information Delta" is expected to say so, and the controller knows when it is old. Data without a time is not accepted as current.

**What this teaches atc.** A blocked AIRCRAFT should act in a fixed order, a deferred defect should be *known and dated* (not rediscovered), and every statement about state (TOWER, OCC) should carry the time it was true.

## 9. Learning loop

**What aviation does** (Annex 19 ch. 5 and appendix 2; Reg (EU) 376/2014; NASA ASRS, AC 00-46).

- **Mandatory occurrence reporting**: defined events (airprox, a lost-comms event, an emergency) must be reported by the operator or unit within a time limit.
- **Voluntary reporting** (ASRS and equivalents): confidential, non-punitive; ASRS reports are de-identified and the reporter gets protection from enforcement if filed within 10 days. Safety information is **protected from use for blame** so that people report.
- **Closing the loop**: reports are analysed in aggregate, trends drive safety bulletins and rule changes, and the reporter or unit sees what was done.

**What this teaches atc.** Occurrences should file themselves when a defined trigger fires (as mandatory reporting does), and voluntary SAFETY REPORTs should keep being cheap. The loop closes only if the report leads to a visible change.

## 10. Map: practice → atc today → gap → proposal

atc facts are cited from `docs/` and code on `origin/main`.

| Practice | atc today | Gap | Proposal |
|---|---|---|---|
| **Pilot NORDO rule** (predictable behaviour) | CREW BRIEFING and CLEARANCE/FLIGHT PLAN reply lines ask for the reply by session name (`addressLine`, `server/response.ts`, [control-recycle.md](../control-recycle.md) section 4). No rule says what an AIRCRAFT does when OCC or TOWER cannot be reached | A team that gets no answer waits (I1: 33 min) or guesses | **F4** lost-comms rule in the CREW BRIEFING |
| **Transmit blind / guard** | The CAPTAIN replies to one session | No second path | **F4**, **F3** |
| **Light-gun (out-of-band) signal** | The only channel is `SendMessage` between sessions | A failed channel is a dead end | **F3** a different path (a file or Linear comment the CAPTAIN reads) |
| **Controller: try another path, relay** | [dispatch.md](../dispatch.md) "Undelivered FLIGHT PLANs as built (ATC-183)": `dispatch undelivered`, CAUTION, resend when the AIRCRAFT is back. ATC-251 tracks the cross-ACCOUNT cause | Records and tells; does not try another route or relay. Nothing times the second failure | **F3**, **F2** |
| **Assume the lost-comms path** | A RECALL that cannot be delivered has no effect on the team; `RECALL` `overdue` resends once ([dispatch.md](../dispatch.md)) | OCC cannot tell the team "assume X" | **F3** (RECALL by the alternate path), **F4** (what the team does) |
| **Alerting phases and timers** | [occ.md](../occ.md): `no-departure` (1.5× WAKE); NO READBACK (10 min, OCC resends once, then reports; [dispatch.md](../dispatch.md)); `no-report` and `arrivalMissing` (30 min; `no-report` is only an ADVISORY info item); [alerting.md](../alerting.md) levels WARNING/CAUTION/ADVISORY; [fleet.md](../fleet.md) NEEDS YOU | Each rule is separate; no shared ladder, no named phase, no "who is called next". A NEEDS YOU stall has no clock and no escalation (I3) | **F2** one phase ladder |
| **Overdue arrival** | FLIGHT FOLLOWING `no-report` (OCC records, reports once) | Does not escalate; I4 stayed "accepted" until a person recorded it | **F1**, **F2** |
| **Readback / hearback / ack** | READBACK, UNABLE, STANDBY, ROGER are required for FLIGHT PLAN and CLEARANCE; guards read them | `ARRIVED` has **no acknowledgement back**: the sender cannot know it was recorded (I4) | **F1** OCC acknowledges ARRIVED |
| **Logical ack vs operational response** | One word (READBACK) means both "received" and "will do" | A message that arrived but was never read cannot be told from one never delivered | **F1** (ack kinds), small |
| **Delivery failure fed back to the originator** | `dispatch undelivered` (ATC-183); `success:false` is recorded by OCC. CREW CHANGE has no `undelivered` op (named as a known gap) | Gap for CREW CHANGE; no sequence check | **F3** (covers CREW CHANGE) |
| **ATS contingency plan** | CONTROL RECYCLE ([control-recycle.md](../control-recycle.md)); GROUND STOP and ATFM ([atfm.md](../atfm.md)); MCC modes ([mcc.md](../mcc.md)) | No written plan for "a control session is gone" or "everything is gone". The ATC-251 deadlock (I2) shows a step that depends on the failed thing | **F9**, **F11** |
| **ATC zero and recovery order** | Control sessions are LAUNCHed one by one (a SUPERVISOR button); the order is not written (I5). ATC-255 proposes bulk actions | No order; nothing holds DISPATCH and MCC while the system comes back; no preflight of the host | **F9**, **F10** |
| **Position relief briefing** | OCC: `restartSafetyOf` (four conditions), record-on-arrival, `schedule wip` ([control-recycle.md](../control-recycle.md) section 4). TOWER: "already reported" keys are on the session side (2.3 item 3, open) | Not a briefing the leaving session writes; MCC, CROSSCHECK, TOWER and ACCOUNT moves have no equivalent | **F8** |
| **MAYDAY/PAN-PAN, 7700** | WARNING/CAUTION levels, BELL cues, sound ([alerting.md](../alerting.md)) | Not a gap that matters; levels exist | none |
| **A-N-C order, checklists** | CREW BRIEFING, `atc-task` skill, per-role manuals | A blocked AIRCRAFT has no fixed order (keep work safe, commit WIP, then report) | **F4** |
| **MEL / known defects** | AOG with `until` and RETURN ([fleet.md](../fleet.md) 8.6) for AIRCRAFT; FOLLOWING `mismatch` between Linear and the PR | A *dispatch* does not re-check that the issue is still open and not already fixed (I6b) | **F7** |
| **NOTAM for known outages** | ALERTS; the BELL; TOWER LOG | No short, dated "known outage" line that every session reads (for example "cross-ACCOUNT delivery is down") | **F6** (age stamps) with **F3** |
| **Information has an age** | [squelch.md](../squelch.md) fingerprints; `ageMin` in `arrivalMissing`; FLEET "last activity" | TOWER and OCC summaries and the BELL do not say how old a statement is (I6a). A RECALL does not clear a block | **F6** |
| **NORDO means "was in contact, then lost it"** | FLEET: NORDO = a dead session with no live one of that name ([fleet.md](../fleet.md) section 8.6, AOG row); TOWER counts NORDO STANDs as `open.orphans` ([controller/CLAUDE.md](../../controller/CLAUDE.md)) | A STAND whose AIRCRAFT was never launched is not NORDO (I6c) | **F5** |
| **Occurrence reporting** | SAFETY REPORT ([safety-report.md](../safety-report.md)): a control session reports friction from its own manual; groups; a fix path via ENGINEERING | Reported by the session that lived it, *if* it notices. The morning's six incidents were found by the SUPERVISOR. No automatic file on a defined trigger | **F12** |

## 11. Proposed follow-ups

Ranked by value for the effort. **Tier** is by `deploy/landing-tier.mjs` rules on the likely files, as a guess. **Size** is the wake letter (L small, M medium, H large). **Design doc?** says whether a `docs/<topic>.md` should come first. None is a decision.

| Rank | ID | Proposal | Fixes | Tier | Size | Design doc? |
|---|---|---|---|---|---|---|
| 1 | **F1** | **OCC acknowledges ARRIVED.** A fixed reply `[OCC → TEAM_X] ROGER ARRIVED ATC-n` after `dispatch report`. The CAPTAIN resends once after 15 min with no ROGER, then says so in its final line. `arrivalMissing` stays as the second check | I4 | `user` if `occ/send-guard.mjs` changes (a new send kind); else `flagged` | L–M | No (a short addition to [occ.md](../occ.md)) |
| 2 | **F5** | **Stop calling a never-launched STAND NORDO.** NORDO only when there *was* a live session (or a launch) and it is gone. Otherwise `NOT LAUNCHED` or `AWAITING LAUNCH`, and not in `open.orphans` | I6c | `auto` | L | No |
| 3 | **F6** | **Age stamps.** Every TOWER LOG line, OCC summary and `brief` field says `as of <time>`; the BELL and summaries mark a statement older than N minutes as `STALE (Nm)`. A RECALL or CLEARANCE answer clears the block it refers to in the same step | I6a | `flagged` (control manuals) | M | Short |
| 4 | **F4** | **Lost-comms rule for AIRCRAFT**, in the CREW BRIEFING (one paragraph, same for every AIRPORT): order of actions when OCC or TOWER cannot be reached (*keep work safe → commit WIP → continue the accepted FLIGHT per its plan → report to both OCC and TOWER by name → state the lost-comms time in the PR body*); never start unrelated work; ask the SUPERVISOR through the tab only if the plan itself is unsafe | I1, I3 | `flagged` (server text) | L | No |
| 5 | **F2** | **One phase ladder** for missing events, named after aviation: `INCERFA` (nothing yet: inquire), `ALERFA` (alert the SUPERVISOR: CAUTION), `DETRESFA` (act: WARNING, with the next action named). A pure function over the existing rules (NO READBACK, `no-departure`, `no-report`, `undelivered`, NEEDS YOU age, a control session with no tick). Each rung has a timer in one table and says *who is called next* | I1, I3, I4 | `flagged` | M | **Yes** (timers and the vocabulary need agreement) |
| 6 | **F7** | **Re-check at release.** Before `dispatch release`, OCC re-reads the issue state and whether a merged PR already carries `Fixes ATC-n` (the MEL idea: a release is valid only if its conditions still hold) | I6b | `flagged` | L | No |
| 7 | **F3** | **A second path.** (a) A server-side **mailbox** for FLIGHT PLAN, RECALL and CREW CHANGE text that a CAPTAIN can read through a hook or its tick, so a failed `SendMessage` does not end the delivery; (b) **relay**: a session that can reach both ends (TOWER, or a same-ACCOUNT peer) forwards. Include CREW CHANGE `undelivered` | I1 | `user` (hooks, guards) | H | **Yes** |
| 8 | **F8** | **Relief briefing for control sessions.** Before STOP, the server writes a `handover` record per session (open items from the data it already has: unacked reports, open CLEARANCEs, `sent` under 10 min, `wip`); a fresh session reads it and says "I have the position" in its LOG. Extend to TOWER, MCC and ACCOUNT moves | I4, I5 | `flagged` | M | **Yes** (small) |
| 9 | **F9** | **`docs/contingency.md`: ATC zero plan.** What each control session does when another is gone; a **recovery order** (proposal to confirm: the server, then TOWER, then OCC, then CROSSCHECK/REVIEW, MCC last; DISPATCH and MCC hold until the AIRCRAFT list is known), and a "recovery mode" that holds landings and RTS until a person ends it. Ties to ATC-255 bulk LAUNCH | I5 | docs `auto`; the build `user` | M–H | **Yes** (this is the doc) |
| 10 | **F11** | **No circular gates.** A design-review rule and a test: a fallback must not wait on the thing that failed (the APPLY NOW and send deadlock). Sends of already approved FLIGHT PLANs do not depend on OCC acting | I2 | `flagged` | L | No (add to F9) |
| 11 | **F10** | **Host preflight.** One check before LAUNCH ALL / RTS: kernel task limits vs the number of sessions to start, free memory, `claude` daemon state; shown as an ALERT "do not launch" | I5 | `auto` | L–M | No |
| 12 | **F12** | **Occurrences file themselves.** When the F2 ladder reaches `ALERFA`, or a defined condition holds (a delivery failed twice, a session NORDO over 10 min), atc opens a SAFETY REPORT draft (S0) with the facts it has. Voluntary reports stay as they are. A monthly "what changed because of reports" list closes the loop | all | `flagged` | M | Short (in [safety-report.md](../safety-report.md)) |

**Order of work that makes sense:** F1, F5, F6, F4, F7 are small, independent and fix real cases; they can start without a design. F2 is the structure that makes the others consistent, so write its short design while F1 and F5 are built. F3, F8, F9 are the larger ones and need a design each; F9 (the plan) before any bulk-launch build.

## 12. What this report does not say

- It does not say aviation's numbers (30 minutes, 5 minutes) fit atc. They are **starting shapes**: atc's FLIGHTs last from minutes to a day, so each rung needs its own value (the existing NO READBACK 10 min and `no-report` 30 min are the first guesses).
- It does not propose to copy the full ICAO phase wording on screen. SUPERVISOR-facing text stays as `docs/alerting.md` has it (WARNING/CAUTION/ADVISORY); INCERFA/ALERFA/DETRESFA are internal names for the ladder (the SUPERVISOR may prefer them on screen too; a decision for the F2 design).
- It does not cover accounts and quotas ([accounts.md](../accounts.md), [ATC-251](https://linear.app/vocado/issue/ATC-251)), only what the loss of a path should *do*.

## Sources

- ICAO: Annex 2 (§3.6.5, appendix 1 light signals), Annex 10 vol II and vol IV (distress, 7500/7600/7700), Annex 11 (§2.30; ch. 5 alerting), Annex 12, Annex 15, Annex 19; Doc 4444 PANS-ATM (ch. 12, 15); Doc 9426; Doc 9880 (AMHS); Doc 10037 GOLD.
- FAA: [14 CFR 91.185](https://www.ecfr.gov/current/title-14/section-91.185) (IFR two-way radio failure), 91.213 (inoperative equipment); [AIM](https://www.faa.gov/air_traffic/publications/atpubs/aim_html/) 4-3-13, 6-4-1, 6-4-2; [JO 7110.65](https://www.faa.gov/air_traffic/publications/atpubs/atc_html/) 2-1, 4-2-3, ch. 10; JO 7210.3; JO 1900.47; AC 00-46 (ASRS).
- EU: [Reg (EU) 376/2014](https://eur-lex.europa.eu/eli/reg/2014/376/oj) (occurrence reporting); Reg (EU) 2017/373 (ATM/ANS, contingency).
- [NASA ASRS](https://asrs.arc.nasa.gov/); [SKYbrary](https://skybrary.aero/) (radio communication failure, alerting service, position handover, ATC zero).
- atc: [alerting.md](../alerting.md), [fleet.md](../fleet.md), [occ.md](../occ.md), [dispatch.md](../dispatch.md), [control-recycle.md](../control-recycle.md), [radio.md](../radio.md), [squelch.md](../squelch.md), [safety-report.md](../safety-report.md), [atfm.md](../atfm.md), [mcc.md](../mcc.md), [aviation-signals.md](aviation-signals.md) (the earlier study of calls, acknowledgements and completion, ATC-118).
