# One ATC pass (`/tick`)

[한국어](SKILL.md) · **English**

> English translation for readers. The skill that runs is the Korean [`SKILL.md`](SKILL.md); this file is not loaded.

**Description:** One ATC pass — read the atc brief, issue CLEARANCEs and reports according to the decision rules in CLAUDE.md, then advance the cursor. Run it with `/loop 3m /tick`.

0. `node atcctl.mjs manual check`. On `CHANGED`, reread `CLAUDE.md` and this file, run `node atcctl.mjs manual ack`, then continue under the reread manual.
1. If messages from team sessions arrived before this pass, handle them first. For "READBACK C-xxxx" run `node atcctl.mjs readback C-xxxx`, for "ROGER C-xxxx" `roger C-xxxx`, for "UNABLE C-xxxx — reason" `unable C-xxxx -- <reason>` (and put it on the SUPERVISOR report list), for "STANDBY C-xxxx" `standby C-xxxx`. Put refusals and questions without the fixed form on the list to report to the SUPERVISOR.
2. Run `node atcctl.mjs brief`. If it has `reset: true`, the server restarted, so go by the current state (`open`, `landingQueue`) rather than `events`. In that pass, don't send block INFOs for APPROACH PRs (they may have been sent already).
3. Apply the decision rules table in CLAUDE.md from the top. When a CLEARANCE is needed:
   - `node atcctl.mjs issue <session> <TYPE> --stand <STAND> --flight <FLIGHT> -- <text>`
   - Send the text below `---` verbatim with SendMessage to the `SEND TO` session in the output.
4. When everything is handled, run `node atcctl.mjs ack <cursor from the brief>`.
5. Leave a line or two of ATC LOG. If nothing happened, "특이 사항 없음" ("nothing to report").

When a call is unclear, don't issue a CLEARANCE in step 3; leave it in the ATC LOG as a request for the SUPERVISOR to confirm.
