# Benchmark: SUPERVISOR attention per issue, atc against Claude Code alone

**English** · [한국어](atc-vs-solo.ko.md)

> Status: **PROTOCOL, pre-registration** for [ATC-459](https://linear.app/vocado/issue/ATC-459) (merged design, decided by the SUPERVISOR on 2026-10-03), written under [ATC-462](https://linear.app/vocado/issue/ATC-462). No run has happened. The decision rule (section 6) and the analysis below are fixed by merging this file; a change after the first main run is a logged amendment (section 12), never a silent edit. Nothing here changes a manual, skill, guard, hook or setting. The pilot and the runs are SUPERVISOR work, not FLIGHTs. The repository is public: there are no real data, screenshots or private project names in this file.

Related: [ui-skill-ab.md](ui-skill-ab.md) and [ui-greenfield-ab.md](ui-greenfield-ab.md) are the earlier blind-review studies; their method (same prompt, same start commit, throwaway worktrees, blind reviewers) is reused here, and so is their warning that reviewer noise is large (section 5).

## 1. Question

Does atc cut **active SUPERVISOR attention per merge-ready issue**, at no worse quality and at most twice the Claude tokens?

- This is an internal decision first: keep investing in atc's orchestration, or not.
- An external claim needs at least 12 issues and is made from the same data, never from a separate study.

## 2. Arms

| | atc arm | Solo arm |
|---|---|---|
| Who works | Normal atc operation: DISPATCH, AIRCRAFT (CAPTAIN and CREW), MCC INSPECTION and landing | The SUPERVISOR drives one interactive Claude Code session, one issue at a time. Subagents are allowed |
| Where | The production fleet, in **exclusive experiment windows** (the fleet does nothing else) | A STAND (worktree) per issue, from the same base commit |
| Rules file | Root `CLAUDE.md` as it is | The **neutralized CLAUDE.md** (below) |
| Review before merge | MCC INSPECTION and Codex review, as usual | None of atc's; the same blind review as the atc arm (section 5) |

- Same model and effort in both arms. Model and CLI versions are logged per run.
- MCC and Codex review stay an atc-arm advantage on purpose: they are part of what atc is.
- Operator: the SUPERVISOR alone, who is also atc's designer. This is a limitation (section 10).

### The neutralized CLAUDE.md (solo arm)

The solo arm keeps every code, verification, documentation and git rule of the root `CLAUDE.md`, and drops only the radio rules: the whole "교신" section (FLIGHT PLAN and CLEARANCE reply forms, READBACK / UNABLE / STANDBY / ROGER, CREW BRIEFING and CHANGE, the `GO AROUND` and `FIX` actions, the fixed final-report header) and the one sentence in the terms section that points to it. This separates the effect of the rules from the effect of the orchestration.

It is produced, never edited by hand:

```
git show <base-sha>:CLAUDE.md > /tmp/root-claude.md
node server/solo-claude-md.ts /tmp/root-claude.md > <solo STAND>/CLAUDE.md
sha256sum <solo STAND>/CLAUDE.md        # write the hash in the run log
```

- `server/solo-claude-md.ts` exports the pure function `neutralize(md)`. `server/solo-claude-md.test.ts` checks that the radio section and its markers are gone, that the other sections are untouched, that the result is the original minus those two parts, that two runs give the same bytes, and that a changed root structure throws instead of passing silently.
- The root `CLAUDE.md` is never edited and no derived copy is committed; the file lives only in the solo STAND.
- Placing it: create the solo STAND from the issue's base commit, write the file over the STAND's `CLAUDE.md`, then run `git update-index --skip-worktree CLAUDE.md` so the replaced file never enters the solo diff. The hash goes in the run log. The model and CLI versions go there too.
- The solo session's first prompt is the issue's work-order text, unchanged (section 3). It is not told about atc's skills. If the session invokes the `atc-task` skill anyway, the run log says so (the skill still carries atc's STAND, PR and report steps; the pilot decides whether that needs a second neutralization before the main run).
- Rules that mention MCC or the landing tiers stay in the file because they govern the PR itself; the solo session has no MCC, so they act as plain guidance. That is part of the stated difference between the arms.

## 3. Issues and pairing

- **10 to 12 issues** from atc's Linear backlog, **drawn at random with a recorded seed**, stratified by size (S, M) and kind (screen, server, docs).
- **Two or three pairs deliberately overlap in files**: atc's merge handling shows only there.
- The draw is a script, so nobody hand-picks: `node server/benchmark-draw-run.ts --candidates <candidates.json> --out <draw.json> [--seed n] [--count 10..12] [--pairs 2..3]` (pure function in `server/benchmark-draw.ts`, offline, no Linear or GitHub call; the only write is `--out`). The candidate list is prepared by hand or exported: `[{ "key": "ATC-n", "size": "S|M", "kind": "screen|server|docs", "files": ["path or folder/"], "flags": { "blocked", "needsDecision", "userTier", "hardToReverse" } }]`. Flagged candidates are excluded (with the reason). The pairs come first (distinct issues whose `files` share a path, or a `folder/` prefix), then the six size × kind strata are filled evenly, always from the least-filled stratum. Within a stratum the arm order alternates, so atc-first and solo-first are balanced. The output holds the seed, each issue's stratum and arm order, the overlap pairs with the shared files, and warnings. A pool too small for a stratum, for the count, or for the pairs is reported as a warning and never filled silently. The same seed and the same candidates (in any order) give the same output.
- Excluded: `user`-tier issues (landing tier by changed paths, `deploy/landing-tier.mjs`), changes that are hard to reverse, and issues that need a human decision.
- Each issue is implemented in **both arms from the same base commit** with **the same work-order text** as the first prompt. Writing the work order is recorded separately and excluded from attention.
- **Carry-over control**:
  - the arm order alternates per issue;
  - the two arms of an issue run **at least one day apart**;
  - the first arm's diff is **not read** before the second arm has finished.
- The atc arm runs issues in batches (about 4 at once); the solo arm runs them serially. If the result is inconclusive, issues are added in steps (the seed and the draw rule stay).
- Server issues get **acceptance tests written before either arm starts** (section 5).

## 4. Metrics

### Primary: active attention

Summed per batch and per issue, from the Mac that the SUPERVISOR uses:

- ActivityWatch (window focus plus away-from-keyboard), with a manual start/stop timer as a cross-check.
- Attention is split three ways:
  - **active**: input is present;
  - **tethered**: the window is watched, no input;
  - **away**: the keyboard is idle past the away threshold.
  Only **active** counts for the verdict. Tethered and away are reported next to it.
- Counted windows, the same list in both arms: atc screen, ANNUNCIATOR, Claude app, terminal, GitHub, Linear. The arm is decided by the experiment window; no unrelated Claude sessions run in a window.

### Secondary

- Elapsed time from start to merge-ready; rework rounds.
- Interruptions. Solo: the SUPERVISOR's messages and approvals, read from transcripts. atc: open lines in the leak log, RELAY messages, approvals.
- Claude tokens per issue through the FUEL parser (`server/fuel*.ts`), subagents included. OCC and MCC tokens in a window are split evenly over that batch's issues. The share of the usage window used is reported too.
- **Codex tokens are not measured**: FUEL reads Claude transcripts only, and atc records only counts of Codex findings. The Codex review count is reported separately, and the token criterion (section 6) uses Claude tokens only.
- Analysis per stratum, including the **break-even task size**, below which atc's fixed overhead loses.

Known data gaps, stated before the run: the solo arm has no LOGBOOK, leak log or CLEARANCE records (rebuilt from git, `gh` and transcripts); the merger is not stored (`mergedBy`); LOGBOOK `blockMin` starts at the first departure record, so it is not a lead time.

## 5. End point and quality

- **End point: merge-ready** = CI `check` green and the blind review passed. Merge action: solo = the SUPERVISOR's review and merge time; atc = 0 (autoland), with escalation time counted.
- **Blind review, two reviewers, both arms**: Claude (`/code-review high`) and Codex. The atc arm has already passed a similar MCC review, so both arms get the same outside review.
- **Review packages strip style giveaways**: branch names, PR headers and bodies, `changelog.d/` fragments. The mapping from package to arm is kept locally and is not opened until all reviews are in.
  - Packaging is `server/blind-pack-run.ts` (pure functions in `server/blind-pack.ts`, offline, no GitHub writes): `node server/blind-pack-run.ts pack --base <sha> --atc-diff <file> --solo-diff <file> --out <package dir> --mapping <file outside the package> [--seed n] [--strip path] [--leak word]`. It writes `X.diff`, `Y.diff`, `PROMPT.md` and `FINDINGS-TEMPLATE.md`; the label to arm mapping (with the seed and the stripped-file list per label) goes only to the mapping file, which must be outside the package. The diff files are made by hand, one per arm, from the base commit (`git diff <base> <ref>`; for a PR, fetch `refs/pull/<n>/head` first). It strips `changelog.d/` and any `--strip` path, and refuses a diff body that still holds a `--leak` word (pass the branch names and PR numbers).
  - Running Claude (`/code-review high` style) and Codex on the package stays manual: each saves its `FINDING <X|Y> <P0|P1|P2> <file>:<line> — <text>` lines to a file. `node server/blind-pack-run.ts merge --mapping <file> --claude <file> --codex <file>` prints P0/P1/P2 and P1+ per arm and reviewer, and the sum.
- **Server issues get acceptance tests first**, written before either arm starts, so correctness is judged by something neither arm saw.
- Findings are graded P0 to P2 per reviewer. **P1+** means P0 or P1. The earlier studies found large reviewer noise: the count that decides is the sum over both reviewers, and the per-reviewer counts are reported so a one-reviewer artefact is visible.
- The atc PR lands as usual. The solo PR is closed after review unless it clearly wins on quality.

## 6. Decision rule (pre-registered)

atc wins if **all three** hold:

1. Active attention is **at most 60%** of solo's (summed over the drawn issues);
2. **P1+ findings** are at most solo's;
3. Claude tokens per issue are **at most 2×** solo's.

If any one is reversed, solo wins. Otherwise the result is **inconclusive** and issues are added (section 3). The analysis script is committed before the main run and is not changed after it. A per-stratum view and the break-even size are reported either way; they do not change the verdict.

## 7. Schedule

- **Pilot**: one issue in both arms on today's setup, to check logging, the timer, extraction, the token split and review packaging. Excluded from the results.
- **Main run on today's setup.** It does not wait for the ANNUNCIATOR app. When the app has Linear writes ([ATC-249](https://linear.app/vocado/issue/ATC-249)) and a terminal, **re-measure the atc arm only**, to test whether working from the app cuts attention further.
- Budget: roughly 2 to 3 weeks given the one-day gap; 1 to 2 hours a day of the SUPERVISOR.

## 8. Phase 2 (only if atc wins phase 1)

- A parallelism-matched comparison: solo with N sessions against N AIRCRAFT.
- A solo arm that also follows the same checklist.
- A multi-day study with a task injected mid-run, to measure the value of atc while nobody watches.

## 9. Publication

Aggregates and a per-issue table (issue key, attention, tokens, findings), negative results included. Raw focus logs stay on the Mac. The limitations of section 10 come first in any write-up.

## 10. Limitations and known gaps

- **One operator, who is the author of atc.** The SUPERVISOR knows atc's habits; this favours the atc arm and cannot be removed.
- **Small n** (10 to 12 issues, one run per arm and issue). Counts and the per-issue table are the result; no percentages from a handful of runs are presented as general.
- **Codex is unmeasured** for tokens and for attention; only its finding count is.
- **One repository** (atc), one model family, the same vendor for builders and the Claude reviewer.
- The solo arm's data are rebuilt from git, `gh` and transcripts (section 4).
- The neutralized CLAUDE.md separates the radio rules only; the atc arm also differs by the fleet, MCC and Codex review (section 2). The comparison is "atc as a whole against Claude Code alone", not a test of one feature.
- Attention tooling measures windows, not thought; the manual timer is the cross-check.

## 11. Results

Empty until the main run. One row per issue, filled from the run log; times in minutes, tokens in the FUEL unit.

| Issue key | Stratum | Arm order | Active (min) atc / solo | Tethered (min) atc / solo | Away (min) atc / solo | Elapsed to merge-ready atc / solo | Rework rounds atc / solo | Claude tokens atc / solo | Codex reviews atc / solo | P0 / P1 / P2, Claude reviewer atc / solo | P0 / P1 / P2, Codex reviewer atc / solo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | |

Summary rows (sum, ratio against solo, verdict by section 6) are added after the table is full.

## 12. Amendments

| Date | Change | Why | Before or after the first main run |
|---|---|---|---|
| 2026-10-03 | Protocol written from ATC-459 | B1 (ATC-462) | before |
