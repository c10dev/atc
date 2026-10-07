# Control plane: routine control as code, judgment as one-shot calls

Status (2026-10-06): design draft. The SUPERVISOR decided to go ahead and answered the open questions (section 7). Nothing in this document is built; the work orders in section 4 are filed as Backlog issues after this document is merged.

Why now: control sessions (TOWER, MCC, OCC, CROSSCHECK, REVIEW) spend most of their tokens re-reading, not deciding. A set of controlled studies of atc-style coordination (section 1) points the same way as atc's own measurement: routine control belongs in server code, and an LLM should be woken only for judgment, with only the delta.

## 1. What the evidence says

Evidence comes from two places. E1 is atc's own data ([squelch.md](squelch.md) section 1). E2-E6 are numbers from controlled studies of atc-style coordination: pre-registered rules, Claude Sonnet sessions, five runs per arm, tasks a few minutes long on a codebase of about a thousand lines. The studies are private; this document cites their numbers only.

| # | Finding | Numbers |
|---|---|---|
| E1 | Control cost is re-reading, not deciding (atc's own data) | In a 4-hour window on 2026-09-29, 95% of control-session tokens were spent in ticks that did nothing; 6 of 202 ticks did work; TOWER re-reads about 620K of context per call |
| E2 | Detecting a stuck team depends on what wakes the controller, not on the phraseology | Three arms (plain, phraseology, phraseology with enforcement) all detected a blocked aircraft 5 of 5, in the same time, set by the tick. The phraseology's value is machine-readable traffic: a ledger a script can read |
| E3 | Send long work orders by reference and let a hook attach the text | Against pasting the text: relaying a revision 39 s to 3 s, time to finish -26%, controller tokens -25%, same accuracy |
| E4 | A small task is cheapest in one session | Same work, same accuracy, about the same time: one session 0.88M tokens; subagents 2.1x; script-dispatched aircraft 2.7x; LLM-controlled aircraft 3.8x |
| E5 | A script dispatcher with one-shot judgment handles faults as well as an LLM controller | Four fault kinds (missing credential, dependency on another work order, policy question, silent aircraft). An LLM controller, a script with `claude -p`, and a script with Jev were all 20 of 20 with no unnecessary escalation. Control tokens 1.32M vs 111k vs 28.5k; total tokens 0.66x; finish 23% sooner |
| E6 | Jev is a good first judge if the policy is checked before any answer | On 96 fresh exception messages, Jev at confidence 0.8 or more took 69% of cases, all right. Jev first, then Claude: 95.8% right against 88.5% for Claude alone, saving about 70% of Claude calls. After a "does the policy settle this point?" check was added, no decision outside the policy was answered |

Limits that matter for atc:

- The tasks were minutes long, not hours, and the faults were clear-cut, one of each kind.
- Hard, ambiguous or simultaneous exceptions, and exceptions outside a fixed action menu, were not tested.
- Splitting large, long work across sessions (DISPATCH across issues) may still pay. Only splitting one small task was tested.

## 2. Current facts

Read from `origin/main` on 2026-10-06; the work orders re-read them before building.

- Control sessions run `/loop <n>m /tick`: TOWER 3 min, MCC 5 min, OCC, CROSSCHECK and REVIEW 10 min ([fleet.md](fleet.md) 8.5-8.6, [squelch.md](squelch.md) section 1).
- SQUELCH is further along than its status line says. S1 (ATC-94, server decision), S2 (ATC-108, hook script and `atcctl squelch`) and S3 (ATC-109, hook wired into the five folders) are built. ATC-297 added fingerprint v2 (only TOWER differs from v1), the opens-by-field table (`GET /api/squelch/opens`), `wrongSkips`, and the composite `atcctl tick <role>`; TOWER's and OCC's `/tick` use it. Two steps stand between this and a saving, and they are separate: (1) a role's `fingerprint` switches from v1 to v2 (`config.fingerprint.<role>`, per role), and (2) `mode` in `squelch.json` goes from `shadow` to `on`, the step that actually drops quiet ticks. The state shape documented in [squelch.md](squelch.md) section 3 holds one `config.mode` and one `heartbeatMin`, so **`mode` is not per role**; only `fingerprint` is. There is no endpoint or screen that edits either: the SUPERVISOR edits the state file by hand ("S1 as built"). S5 in the squelch.md order is only the CONTROL row display, not a switch screen. The two squelch.md sections disagree on the live mode: S3 says `shadow`, and the ATC-297 section says it went to `on` on 2026-09-30 (measured from `squelch.jsonl`). This document does not settle which is true now; W1 starts by reading `GET /api/squelch`. Not built: flipping any role to v2, a switch for `mode` and `fingerprint`, MCC, CROSSCHECK and REVIEW adopting `atcctl tick`, and the CONTROL row display (S5).
- OCC sends only the FLIGHT PLAN header; send-guard puts in the text atc stored ([occ.md](occ.md)). That is already "send by reference, attach by hook" (E3).
- Flight following is server code (`server/following.ts`, `atcctl following`). OCC reports and acknowledges.
- The Jev judges exist in `server/judges/` (CLASSIFY ATC-36, DISPATCH marks ATC-88, REPORT of the CAPTAIN's last message ATC-89), behind `judges.jev` with a SUPERVISOR-only switch. Export is allowlisted ([fleet.md](fleet.md) 6.1). A new export destination is K2 ([autonomy.md](autonomy.md) L22).
- [autonomy.md](autonomy.md) principle 7: decisions are not bound to their input (`clearances.jsonl` has no head, and no record stores a hash of what was judged). WO-23 there is the planned fix.
- [control-recycle.md](control-recycle.md) records how a control session is restarted on purpose, including what a fresh session must pick up. Fresh-session wakes (section 3, rule 2) build on it.
- A solo-by-default rule for the CAPTAIN is recorded in [dispatch.md](dispatch.md) for vocado work.

## 3. Principles

1. **Routine control is code.** Dispatch, READBACK tracking, resend after silence, reassign after a second silence, hold until a dependency lands, relays and auto-tier landing are server actions, each with its own switch. A standing LLM session should not re-read 600K tokens to run them (E1, E5).
2. **Wake an LLM only for judgment, and only with the delta.** No fixed `/loop` for the roles this applies to. The server sends one prompt per event that needs judgment: UNABLE, a CAPTAIN's question, a second silence, review findings, an event outside the menu. Prefer a fresh short session or a one-shot call over a long-lived context (E1, E5). The SUPERVISOR's decision: TOWER, MCC and OCC keep one standing review turn a day; everything else is an event wake.
3. **Judge exceptions from a fixed menu, cheapest first.** Menu: RESEND, HOLD_UNTIL, REASSIGN, ANSWER, ESCALATE, ACCEPT_UNDONE.
   - Jev answers typed questions first.
   - Below confidence 0.8, a one-shot Claude call decides.
   - An ANSWER is acted on only when the judge says the policy settles that exact point. Otherwise it becomes ESCALATE, a SUPERVISOR card (E6).
   - "None of these" is ESCALATE from day one.
4. **Bind every message to its input.** A FLIGHT PLAN header carries a short hash of the stored work-order text. A READBACK must quote it. A reply to a closed or superseded clearance is refused with "answer the latest call" (E3, E5, autonomy.md principle 7).
5. **Do not split small work.** WAKE L and M flights default to a solo CAPTAIN with no CREW; split only WAKE H or multi-area work. DISPATCH keeps its parallelism across flights (E4).
6. **Every control change ships with an off switch and a misfire counter.** Live first, with the switch; shadow only for an irreversible step. A new switch is the SUPERVISOR's.
7. **Measure first.** Control share of tokens and tokens per working control turn are shown per role before any of the above is turned on (W8).

## 4. Implementation order

Each is filed as its own Backlog issue after this document merges. DUTY sets the K effects, priority and blockedBy then. Most touch a guard or a control and are probably K3, which means the SUPERVISOR fires them from the RELEASE screen.

| # | Work order | Done when | Measure | Notes |
|---|---|---|---|---|
| W8 | METRICS: control share (control tokens over all tokens) and tokens per working control turn, per day and per role | The panel shows both per role | The panel itself | Lets W1-W7 be judged |
| W9 | SQUELCH switch: a SUPERVISOR-only route and a settings-window control for `mode`, `heartbeatMin` and `fingerprint`, with `mode` per role (for example `config.roles.<role>.mode`, falling back to the global value) | The SUPERVISOR changes each setting for one role from the screen, with no state-file edit; the change is logged with who and when; a missing or bad value reads as `shadow` and `v1` | Hand edits of `squelch.json` per week, down to 0 | Today there is no way to edit the config except by hand, and `mode` is global, so a role cannot go `on` alone. K3 (it sets a control); SUPERVISOR-only route, no Origin, 403 like the other switches. W1 is blocked by it. Re-read `server/squelch.ts` and `squelch-run.ts` for the current config shape before starting |
| W1 | SQUELCH S4, per role, in two steps: (1) after a week with `wrongSkips` 0 and small `unknown` for that role, set its `fingerprint` to `v2`; (2) set that role's `mode` to `on`, which is what drops quiet ticks (REVIEW and CROSSCHECK first, then MCC and OCC, TOWER last) | A role's quiet ticks no longer reach the model; the misfire counter is `wrongSkips` after the flip; either step reverses from the W9 control | Control-session tokens per day, down, 7 d | Biggest and cheapest saving (E1), and it saves nothing until step (2). Starts by reading `GET /api/squelch`: if a role is already `on`, step (2) is done for it and only the v2 flip is left. Also MCC, CROSSCHECK and REVIEW adopt `atcctl tick`, which needs a guard allow-list change (tier `user`). K3 |
| W2 | The server executes mechanical decisions: MCC auto-tier LAND and RTS from the gate, FLIGHT FOLLOWING resend and acknowledge, undelivered FLIGHT PLAN retry | Each runs without a control turn behind its own switch; misfires counted (for example a LAND the gate would refuse) | Control turns per landed PR, down | E5. One work order per action keeps each K3 effect small. Re-read the MCC gate's current mode before starting |
| W6 | Stale reply refusal: a reply to a closed or superseded clearance id is refused with "answer the latest call R-n" | A guard test covers it | Stale replies refused per week | Seen in a study: an aircraft answered a resent call with the old id |
| W5 | Hash hearback: the FLIGHT PLAN header carries the hash of the stored text, a READBACK must quote it, and the send-guard and the team guard check it | A READBACK without the right hash is refused with the reason | READBACK mismatches caught (above 0 when a work order changes after release) | Overlaps WO-23 (input binding, autonomy.md). Fold into WO-23 or file as its follow-up; the check for it is made when W5 is filed. Makes "never edit an accepted work order" enforceable |
| W3 | Event wakes instead of `/loop`: the server prompts a control role only for judgment events, with the delta and the open FLIGHTs; fresh session per wake; one standing review turn a day for TOWER, MCC and OCC | No `/loop` in these roles when the switch is on; every UNABLE, A/N or second silence produces exactly one wake | Median context per control call, down; time from exception to action, down | After W1 and W2. Builds on control-recycle.md |
| W4 | Exception judge: Jev typed questions (action, wait_for, answer_yes, policy_covers), `claude -p` below confidence 0.8, ESCALATE card when the policy does not cover the point | Judgments and their source are recorded; ANSWER only with coverage; `judges.jev` gains an exceptions family and a SUPERVISOR switch | Share of exceptions handled without a control session; wrong-action rate from SUPERVISOR marks | Live from the start, with the switch and a misfire counter (SUPERVISOR decision). Export of CAPTAIN messages to Jev is K2 (L22); reuse the REPORT masking (1,500 characters at most) and make the allowlist stricter than CLASSIFY's |
| W7 | Solo by default for WAKE L and M (no CREW) | DISPATCH BRIEFING says solo for L and M; CREW only for H or multi-area | Tokens per landed flight by WAKE, down; landing time, not up | Last, after measurement: E4 is minutes-long work |

Suggested sequence: W8 and W9, W1, then W2 and W6, then W5, then W3 and W4, W7 last.

### W8 as built (ATC-551)

- **Panel.** METRICS has a CONTROL tab (`#metrics/control`). For the last 14 UTC days it shows, for all control sessions and for each role (TOWER, MCC, OCC, CROSSCHECK, REVIEW), **control share** (control-session tokens divided by all tokens) and **tokens per working control turn**. `GET /api/control-share?days=N` returns the same rows.
- **Where the numbers come from.** Tokens are the FUEL reader's per-request usage (CREW included, keyed by the parent session). A control session is a session opened in a control folder, found by the ATC-289 reader (`readSessionCalls` with `uses`). A turn starts at a user turn (a person or another session; tool results and system messages are not turns) and ends at the next one. A **working** turn made 3 or more tool calls, the same threshold as the opens table in [squelch.md](squelch.md). No text is read and no new data leaves atc.
- **Pilot's discretion.** Tokens per working turn is the role's tokens for the day divided by its working turns, so the quiet turns' cost is charged to the work (that is the cost of one useful turn). A day with no working turn shows a dash. Days are UTC; a turn is counted on the day it starts.
- **Measure names.** `control:share`, `control:tokens-per-turn`, and per role `control:share-<role>` and `control:tokens-per-turn-<role>` (role: tower, mcc, occ, crosscheck, review). `share` is in percent, `tokens-per-turn` in thousands of tokens. They are judged like the flow medians: at least 3 samples (days for `share`, working turns for `tokens-per-turn`) on both sides and a transcript record that covers the whole before window, otherwise `too little data`. Transcripts are read lazily, only when a Measure uses `control:`, for twice the window.

### W7 as built (ATC-559)

- **Brief.** The FLIGHT PLAN and the DIRECT assignment text carry one line: `SOLO (WAKE L|M): …` for WAKE L and M, `CREW (WAKE H): …` for H and J, and `CREW (multi-area: …): …` when the labels name two or more `Area` group labels or two or more TYPE RATINGs other than DOCS. Details in [dispatch.md](dispatch.md) "Solo by default as built".
- **Switch.** Per AIRPORT, SUPERVISOR only, settings AUTOMATION → OPERATIONS → SOLO (`solo-default.json`). Shipped on for every AIRPORT (SUPERVISOR decision, 2026-10-06: no measure-first gate); off leaves the FLIGHT PLAN as before.
- **Misfire counters.** Per AIRPORT, last 7 days, against the 7 days before the first start after deploy: SOLO FLIGHTs that took CREW or were blocked for lack of one, SOLO FLIGHTs whose block time is above the same-WAKE baseline median, and tokens per landed FLIGHT by WAKE (LOGBOOK `fuel`). Shown only.

### W4 as built (ATC-558)

- **Judge.** A fixed menu (`RESEND`, `HOLD_UNTIL`, `REASSIGN`, `ANSWER`, `ESCALATE`, `ACCEPT_UNDONE`; "none of these" is `ESCALATE`). Jev answers typed questions first (`action`, `wait_for`, `answer_yes`, `policy_covers`, plus `policy_point` so "covers that exact point" names the point); at confidence 0.8 or more its answer is used, otherwise one `claude -p` call decides. Details in [fleet.md](fleet.md) "Exception judge as built".
- **Where it plugs in.** Team replies reach OCC and TOWER by SendMessage, so the control session runs `atcctl exception <D-|C-id> --kind unable|question|silence` and carries out the returned action from a table in its manual. The server judges the second silences it sees (ATC-562 FLIGHT PLAN resends, ATC-557 b CLEARANCE resends) in the wake pass before waking the role: an ESCALATE card replaces the wake, any other action rides in the wake line. No guard change was needed: `controller/guard.mjs` has no atcctl allow-set for TOWER and OCC.
- **Executed from the first release.** The switch `judges.exceptions` has `on` (default) and `off` only. `off` leaves the old manual paths.
- **Misfire counter.** Actions the SUPERVISOR marks wrong and ESCALATEs marked unnecessary, with the wrong-action rate, on Settings → JUDGES next to the share decided without a control session's own judgment and the Jev / Claude split.
- **K2.** The masked CAPTAIN message (REPORT masking plus code, secret values and key-like strings, at most 1,500 characters), the menu and the policy go to TypeSafe and `claude -p`; approved by the SUPERVISOR on 2026-10-07.

## 5. Risks

| Risk | Guard |
|---|---|
| Judgment outside the menu: real exceptions are messier than the studies' | "None of these" is ESCALATE from day one (W3, W4); the misfire counter and SUPERVISOR marks show the wrong-action rate |
| Losing cross-flight context: a standing controller accumulates awareness, a one-shot call knows only what the server passes | The delta prompt carries the relevant open FLIGHTs; a daily review turn per standing role |
| Jev data export (K2, L22): team messages can carry code or secrets | Stricter allowlist than CLASSIFY's; reuse the REPORT masking; the SUPERVISOR owns the switch |
| Hours-long work is untested: the cost gap may shrink, or splitting may pay | W7 is measure-first; DISPATCH's cross-flight parallelism stays |
| A server action goes wrong without a controller watching | Each action has its own switch and misfire counter; the first misfire turns up on the SUPERVISOR's screen, not in a transcript |
| A dropped tick that should have run | SQUELCH's own guards: HEARTBEAT, per-role switch, `wrongSkips` before any flip (squelch.md section 8) |

## 6. Not in scope

Changing the CAPTAIN's own way of working, the CREW model, or DISPATCH's planner; those are untouched except W7's default.

## 7. Decisions

Decided by the SUPERVISOR on 2026-10-06:

1. **Public citation.** Findings are cited as numbers only ("a controlled study found ..."). The study repository is not named and its contents are not quoted.
2. **W4 starts live**, with a switch and a misfire counter, not in shadow. Standing direction: live first, shadow only for irreversible steps.
3. **Standing sessions.** TOWER, MCC and OCC keep one review turn a day. Everything else is an event wake.
4. **Scope.** This document is the first PR. W1-W9 become Backlog issues after it merges.

Corrections to the first draft of the brief, found while reading the repository: SQUELCH is further along than its status line says (section 2), so W1 is S4, a flip per role, not S2; and W5 overlaps WO-23. Added on 2026-10-06 at the SUPERVISOR's request: W1 covers both the v2 flip and `mode` `on`, and the missing switch for them is W9.
