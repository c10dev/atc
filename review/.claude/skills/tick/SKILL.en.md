# One landing review pass (`/tick`)

[한국어](SKILL.md) · **English**

> English translation for readers. The skill that runs is the Korean [`SKILL.md`](SKILL.md); this file is not loaded.

0. `node ../controller/atcctl.mjs tick review` (it already runs `manual check`; do not call that separately, ATC-553). On `TICK QUIET review` there is nothing to do: go to step 4 (LOG). On `CHANGED`, reread `CLAUDE.md` and this file, run `node ../controller/atcctl.mjs manual ack`, and continue under the reread rules. On `TICK ACT review`, go to step 1.
1. Run `node ../controller/atcctl.mjs landing queue`. If `pending` is empty, go to 4. Leave `excluded` alone.
2. For each PR in `pending` (at most 2 per pass):
   - Read the packet with `node ../controller/atcctl.mjs landing review <pr>`. On 403 (excluded from external review) or 409 (Codex available again, head changed, FLIGHT unreadable), don't retry; note it in the LOG.
   - Check the acceptance criteria, forbidden changes and risks as in "How to review" in CLAUDE.md. If it turns out to be security work, don't review it; leave P0 findings.
3. `node ../controller/atcctl.mjs landing review <pr> --head <the packet's head> --verdict pass|findings -- '<review>'`. Severities P0, P1 and P2; pass only with no P0 or P1. Run it on its own, with no pipe. If the guard blocks it on the real model ("착륙 리뷰 기록 차단 — … 실제 모델"), stop this pass and note it in the LOG.
4. Leave a one- or two-line REVIEW LOG. If nothing happened, "Nothing to report".

Never merge, approve, reject or judge. Never write to Linear or GitHub, and never message anyone. If the guard blocks something, don't look for another way; note it in the LOG.
