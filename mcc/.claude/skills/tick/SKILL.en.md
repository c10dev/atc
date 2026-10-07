# One MCC pass (`/tick`)

[한국어](SKILL.md) · **English**

> English translation for readers. The skill that runs is the Korean [`SKILL.md`](SKILL.md); this file is not loaded.

## Two modes (CONTROL WAKE, ATC-557)

The SUPERVISOR picks the mode in the settings window, CONTROL WAKE MCC. The first prompt and the output of `node ../controller/atcctl.mjs tick mcc` tell which one is on.

- **Wake mode (`wake`, the default).** There is no `/loop`. When the atc server sees something that needs a decision it wakes this session with one `[ATC WAKE W-xxxx] MCC` message (what is new, what is still open, what was resolved since the last wake, the FLIGHTs it bears on). At start the session gets `[ATC WAKE BOOT] MCC`.
  - On such a message, step 0 is `node ../controller/atcctl.mjs tick mcc --wake W-xxxx` (`--wake boot` for BOOT), and the steps below follow unchanged. Work from the whole output, not only the items in the message.
  - Do not reply to ATC (it is the server, not a session). The last line of the turn is one of `WAKE RESULT: acted` (anything was issued, recorded, sent or reported) or `WAKE RESULT: nothing` (there was nothing to do). atc counts misfires from this line.
  - If step 0 of a `/tick` from a leftover `/loop` prints `TICK WAKE-MODE mcc — …`, do nothing and end the turn at once (no MCC LOG line). atc relaunches the session once, without `/loop`, at a safe moment.
- **Loop mode (`loop`).** As before: `/loop 5m /tick`. Step 0 is `node ../controller/atcctl.mjs tick mcc` without `--wake`. If the wake job or the wake BREAKER has stopped, `/tick` also works this way in wake mode (no `TICK WAKE-MODE` is printed). When the BREAKER stops, atc relaunches the session once with `/loop`, and moves it back to wake mode once the BREAKER re-arms.

0. `node ../controller/atcctl.mjs tick mcc` (it already runs `manual check`; do not call that separately, ATC-553). On `TICK QUIET mcc` there is nothing to do: go to step 5 (LOG). On `CHANGED`, reread `CLAUDE.md` and this file, run `node ../controller/atcctl.mjs manual ack`, and continue under the reread rules. On `TICK ACT mcc`, go to step 1.
1. `node ../controller/atcctl.mjs mcc queue`. Look at `pulls`, `rts` and `groundStop`. If `rts.due` is true, run `node ../controller/atcctl.mjs mcc rts` here first (once, before any landing). If it is stopped after a ROLLBACK, don't; report it.
2. For each PR without an `inspection` (oldest first, at most 3 a pass):
   - Call Agent with `subagent_type: inspector`. Prompt: `PR <number>, head <head from queue>`. Call several PRs together. **Don't read the packet or the diff in this session** (not `mcc packet`, not `gh pr diff`, not the code around a diff). The standard is CLAUDE.md "How to inspect".
   - If the reply has `VERDICT: escalate` (or `ESCALATE:` other than `none`): `node ../controller/atcctl.mjs mcc escalate <PR> -- '<ESCALATE reason>'`. If `COUNTS` in the reply has any P0 or P1, also record `mcc inspect <PR> --head <HEAD of the reply> --verdict findings -- '<TEXT>'` on the same head (with no P0 or P1, the ESCALATE alone counts as the INSPECTION of that head, ATC-390).
   - Otherwise `node ../controller/atcctl.mjs mcc inspect <PR> --head <reply HEAD> --verdict <VERDICT> -- '<TEXT>'`, alone. If `HEAD` differs from the queue head, don't record; call again next pass. If the guard blocks it on the model check, stop this pass and log it.
   - If the reply isn't the block or the inspector failed, call once more; if that fails, log it and move on (don't read the PR yourself instead).
3. Read `mcc queue` again; for each PR with empty `blocks`: `node ../controller/atcctl.mjs mcc land <PR> --head <head>`. On `LAND 안 함`, log the condition.
4. Right after landing something, don't run `mcc rts` in the same pass (the landed commit is deployed by step 1 on a later pass, once `rts.due` is true).
5. Write one or two lines of MCC LOG. If nothing happened: "특이 사항 없음". If the prompt carries a `[MCC CONTEXT CAP]` notice, read `recycle.mode` in `mcc queue` as in CLAUDE.md "Context cap": `on` means atc restarts the session, so ask for nothing; otherwise write only "context <n>k — CAP 초과".

No code changes, no messages to team sessions, no Linear writes. When a guard blocks something, don't look for another way; log it.
