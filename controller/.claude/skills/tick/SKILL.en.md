# One ATC pass (`/tick`)

[한국어](SKILL.md) · **English**

> English translation for readers. The skill that runs is the Korean [`SKILL.md`](SKILL.md); this file is not loaded.

## Two modes (CONTROL WAKE, ATC-557)

The SUPERVISOR picks the mode in the settings window, CONTROL WAKE TOWER. The first prompt and the output of `node atcctl.mjs tick tower` tell which one is on.

- **Wake mode (`wake`, the default).** There is no `/loop`. When the atc server sees something that needs a decision it wakes this session with one `[ATC WAKE W-xxxx] TOWER` message (what is new, what is still open, what was resolved since the last wake, the FLIGHTs it bears on). At start the session gets `[ATC WAKE BOOT] TOWER`.
  - On such a message, step 0 is `node atcctl.mjs tick tower --wake W-xxxx` (`--wake boot` for BOOT), and the steps below follow unchanged. Work from the whole output, not only the items in the message.
  - Do not reply to ATC (it is the server, not a session). The last line of the turn is one of `WAKE RESULT: acted` (anything was issued, recorded, sent or reported) or `WAKE RESULT: nothing` (there was nothing to do). atc counts misfires from this line.
  - Team replies (READBACK, UNABLE, questions …) still arrive by session name and wake this session. Record and report them as step 1 says and end the turn; the server wakes the session separately for anything else.
  - If step 0 of a `/tick` from a leftover `/loop` prints `TICK WAKE-MODE tower — …`, do nothing and end the turn at once (no ATC LOG line). atc relaunches the session once, without `/loop`, at a safe moment.
- **Loop mode (`loop`).** As before: `/loop 3m /tick`. Step 0 is `node atcctl.mjs tick tower` without `--wake`. If the wake job or the wake BREAKER has stopped, `/tick` also works this way in wake mode (no `TICK WAKE-MODE` is printed).

**Description:** One ATC pass — read the atc brief, issue CLEARANCEs and reports according to the decision rules in CLAUDE.md, then advance the cursor. In wake mode (the default) the server's `[ATC WAKE …]` message calls it; in loop mode `/loop 3m /tick` does.

0. `node atcctl.mjs tick tower`. It does the manual check (`manual check`), the brief, and, when there is nothing to do, the `ack`, in one call. The output decides:
   - `TICK QUIET tower — …`: nothing to act on in the brief, and the ack is already done. Do not call the brief again. Still do step 1 (record the READBACK, ROGER, UNABLE and STANDBY replies from team sessions that arrived before this pass), then go to step 5 (ATC LOG "특이 사항 없음", "nothing to report").
   - `CHANGED …` first means the manual changed (no ack was made). Reread `CLAUDE.md` and this file, run `node atcctl.mjs manual ack`, then handle the brief printed after it under the reread manual.
   - `TICK ACT tower`: `REASONS:` is the kind of work this pass has, and below it is the `brief` output (JSON) as is. Continue from step 1. If there is a `NOTE: … 서버가 판정하지 못했다` ("the server could not decide"), read it with `node atcctl.mjs brief` and work the old way.
1. If messages from team sessions arrived before this pass, handle them first. For "READBACK C-xxxx" run `node atcctl.mjs readback C-xxxx`, for "ROGER C-xxxx" `roger C-xxxx`, for "UNABLE C-xxxx — reason" `unable C-xxxx -- <reason>` (and put it on the SUPERVISOR report list), for "STANDBY C-xxxx" `standby C-xxxx`. Put refusals and questions without the fixed form on the list to report to the SUPERVISOR.
2. Read the brief printed in step 0. If it has `reset: true`, the server restarted, so go by the current state (`open`, `landingQueue`) rather than `events`. `landingQueue[].info`, `goAround` and `fix` are built from state (they compare with the last INFO, GO AROUND and FIX body), so handle them by their `action` in this pass too (ATC-128, ATC-270). A server restart that drops the events no longer drops what must be sent, and what already went out is not sent again.
2a. If `relays[]` (SUPERVISOR RELAY, ATC-271) has entries, send the text unchanged (passing the entry's `stand` as `--stand` when it has one) as the SUPERVISOR RELAY row of CLAUDE.md says and mark it with `relay issued`. If it cannot be delivered, mark it with `undeliverable` and `relay undeliverable`.
3. Apply the decision rules table in CLAUDE.md from the top. When a CLEARANCE is needed:
   - `node atcctl.mjs issue <session> <TYPE> --stand <STAND> --flight <FLIGHT> -- <text>`
   - Send the text below `---` verbatim with SendMessage to the `SEND TO` session in the output.
4. When everything is handled, run `node atcctl.mjs ack <cursor from the brief>`. (Already done on `TICK QUIET`.)
5. Leave a line or two of ATC LOG. If nothing happened, "특이 사항 없음" ("nothing to report").

When a call is unclear, don't issue a CLEARANCE in step 3; leave it in the ATC LOG as a request for the SUPERVISOR to confirm.
