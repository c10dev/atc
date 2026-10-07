# One landing review pass (`/tick`)

[한국어](SKILL.md) · **English**

> English translation for readers. The skill that runs is the Korean [`SKILL.md`](SKILL.md); this file is not loaded.

In wake mode (the default) the server's `[ATC WAKE …]` message calls this skill; in loop mode `/loop 10m /tick` does.

## Two modes (CONTROL WAKE, ATC-557)

The SUPERVISOR picks the mode with CONTROL WAKE REVIEW in the settings window. The first prompt and the output of `node ../controller/atcctl.mjs tick review` tell you which one is on. CROSSCHECK is retired (ATC-371) and has no wakes.

- **Wake mode (`wake`, the default).** No `/loop`. When a PR head is waiting for a landing review, the atc server wakes the session with one `[ATC WAKE W-xxxx] REVIEW` message (up to 2 new PRs, PRs still open, PRs resolved since the last wake, the FLIGHTs they bear on). A freshly launched session gets `[ATC WAKE BOOT] REVIEW`.
  - On that message, do step 0 as `node ../controller/atcctl.mjs tick review --wake W-xxxx` (`--wake boot` for BOOT) and follow the steps below as they are. In step 2, pick the PRs in the message first (at most 2 per pass). atc puts the remaining PRs in the next wake.
  - Do not reply to ATC (it is the server, not a session). The last line of the turn is one of `WAKE RESULT: acted` (you recorded a review, or wrote a 403, 409 or guard block in the LOG) or `WAKE RESULT: nothing` (nothing to do). atc counts misfires from this line.
  - If step 0 of a `/tick` from a leftover `/loop` prints `TICK WAKE-MODE review — …`, do nothing and end the turn at once (no REVIEW LOG line). atc relaunches the session once, without `/loop`, at a safe moment.
  - If the message's second line is `Daily review turn (ATC-557)`, it is the daily review turn (every day at 01:45Z, CLAUDE.md "How this session is woken"): do the steps from step 0, then look back over the last 24 hours as the message says and file what you find as CLAUDE.md says. The last line is the same `WAKE RESULT`.
- **Loop mode (`loop`).** As before: `/loop 10m /tick`. Step 0 is `node ../controller/atcctl.mjs tick review` without `--wake`. If the wake job or the wake BREAKER has stopped, `/tick` also works this way in wake mode (no `TICK WAKE-MODE` is printed). When the BREAKER stops, atc relaunches the session once with `/loop`, and moves it back to wake mode once the BREAKER re-arms.

0. `node ../controller/atcctl.mjs tick review` (it already runs `manual check`; do not call that separately, ATC-553). On `TICK QUIET review` there is nothing to do: go to step 4 (LOG). On `CHANGED`, reread `CLAUDE.md` and this file, run `node ../controller/atcctl.mjs manual ack`, and continue under the reread rules. On `TICK ACT review`, go to step 1.
1. Run `node ../controller/atcctl.mjs landing queue`. If `pending` is empty, go to 4. Leave `excluded` alone.
2. For each PR in `pending` (at most 2 per pass):
   - Read the packet with `node ../controller/atcctl.mjs landing review <pr>`. On 403 (excluded from external review) or 409 (Codex available again, head changed, FLIGHT unreadable), don't retry; note it in the LOG.
   - Check the acceptance criteria, forbidden changes and risks as in "How to review" in CLAUDE.md. If it turns out to be security work, don't review it; leave P0 findings.
3. `node ../controller/atcctl.mjs landing review <pr> --head <the packet's head> --verdict pass|findings -- '<review>'`. Severities P0, P1 and P2; pass only with no P0 or P1. Run it on its own, with no pipe. If the guard blocks it on the real model ("착륙 리뷰 기록 차단 — … 실제 모델"), stop this pass and note it in the LOG.
4. Leave a one- or two-line REVIEW LOG. If nothing happened, "Nothing to report". If a wake started the turn, the last line after it is `WAKE RESULT: acted` or `WAKE RESULT: nothing`.

Never merge, approve, reject or judge. Never write to Linear or GitHub, and never message anyone. If the guard blocks something, don't look for another way; note it in the LOG.
