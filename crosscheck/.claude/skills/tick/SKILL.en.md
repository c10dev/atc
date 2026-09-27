# One CROSSCHECK pass (`/tick`)

[한국어](SKILL.md) · **English**

> English translation for readers. The skill that runs is the Korean [`SKILL.md`](SKILL.md); this file is not loaded.

**Description:** One CROSSCHECK pass — check whether the manual changed, then for each open DISPATCH proposal and SCHEDULE draft without a mark, read the FLIGHT body and leave a provisional verdict (agree/disagree) with a one-line reason. It never approves or rejects. Run it with `/loop 10m /tick`.

0. `node ../controller/atcctl.mjs manual check`. On `CHANGED`, reread `CLAUDE.md` and this file, run `node ../controller/atcctl.mjs manual ack`, then continue under the reread manual.
1. Run `node ../controller/atcctl.mjs crosscheck brief`. If `dispatch.pending`, `schedule.pending` and `landing.pending` are all empty, go to 7.
2. Read `examples` first. What the SUPERVISOR recently decided, and why, is the standard for this pass.
3. For each item in `pending` (at most 5 per pass in total, DISPATCH first):
   - Read the body and comments with `node ../controller/atcctl.mjs dispatch flight <FLIGHT key>`. A NEW draft has no FLIGHT yet; read that draft's `payload` (body, `similar`) in `schedule brief`.
   - If the body, comments or OCC note name a PR condition, check it as in "Checking PR facts" in CLAUDE.md: `gh pr view <N> --repo <owner/name> --json state,mergedAt,title`, with the repository from the AIRPORT table. Never use a gh command that writes.
   - Follow "Order of checks" in CLAUDE.md: state → already done → prerequisites → priority → the target-specific check. Treat OCC's `note` and `reason` as reference only.
   - If there are CLASSIFY or NEW drafts, first Read `../docs/fleet.md` in that pass (4.1 FLIGHT TYPE, 4.2 WAKE, 4.3 TYPE RATING) and cite the matching criterion in the reason.
   - For a CLOSE draft, check the PR with `gh pr view` as in "SCHEDULE CLOSE" in CLAUDE.md. If the body says `Part of`, or there is a revert or remaining work, disagree.
4. For a DISPATCH proposal: `node ../controller/atcctl.mjs dispatch crosscheck <D-xxxx> agree|disagree -- '<one-line reason>'`. On disagree, add `--code <code>` as in "Reason chips" in CLAUDE.md (decide first whether it is the FLIGHT's or the AIRCRAFT's problem).
5. For a SCHEDULE draft: `node ../controller/atcctl.mjs schedule crosscheck <S-xxxx> agree|disagree -- '<one-line reason>'`.
   - A 409 (not open, or on HOLD) means the SUPERVISOR decided in the meantime or the situation changed. Do not retry.
   - Run a mark command on its own, with no pipe. If the guard's real-model check blocks it ("CROSSCHECK mark 차단 — … 실제 모델"), stop marking for this pass and note it in the LOG.
5-1. If there is `landing.pending` (Codex-limited PRs, at most 2 per pass), follow "LANDING review" in CLAUDE.md: read the packet with `node ../controller/atcctl.mjs landing review <pr>`, check the acceptance criteria, forbidden changes and risks, and record `landing review <pr> --head <head> --verdict pass|findings -- '<review>'`. Severities are P0, P1 and P2; pass only with no P0 or P1. Leave `landing.excluded` alone. On 403 or 409, do not retry.
6. When the evidence is not enough to decide, leave no mark.
7. Leave a one- or two-line CROSSCHECK LOG. If nothing happened, "Nothing to report".

Never approve, reject or give a verdict. Never write to Linear or message anyone. If a guard blocks something, don't look for another way; note it in the LOG.
