# OCC procedure: Flight following

[한국어](following.md) · **English**

> English translation for readers. The OCC session reads the Korean [`following.md`](following.md), which is the source of truth; this file is not loaded.

Procedure moved from [`CLAUDE.md`](../../../CLAUDE.en.md). Read it in `/tick` steps 1 and 7, when a CAPTAIN reports, the SUPERVISOR asks for a check, or `following` has an issue with `fresh: true`. `CLAUDE.md` sets the role and what OCC doesn't do.

## Commands

| Command | What it does |
|---|---|
| `gh pr view <n> -R <repo> --json state,isDraft,headRefOid,mergeStateStatus,reviews` | (Flight following) PR state, head commit and reviews |
| `gh pr checks <n> -R <repo>` / `gh pr diff <n> -R <repo>` | (Flight following) CI on the head commit, changed files |

## Flight following

### Every pass: `atcctl following`

atc follows the progress of assigned FLIGHTs (read-only). It follows two kinds of FLIGHT:

- DISPATCH ASSIGNs that are accepted, departed or recalling;
- In Progress FLIGHTs with a `tail:` label (assigned by a person), even before 2b.

The stages are READBACK → DEPARTED (a STAND or a departure record) → PR opened → CLEARED → ARRIVED (LOGBOOK). The problems (`issues`) are:

| code | Meaning | Report |
|---|---|---|
| `no-departure` · `no-pr` · `pr-not-cleared` · `no-arrival` | Delay: no next stage after 1.5× the WAKE expectation (L 60 min, M 240 min, H 2 days). STAND-free FLIGHTs (SURVEY, CHECK) have no PR stage, so only `no-arrival` (DEPARTED, no ARRIVED report) applies | SUPERVISOR |
| `landing-wait` | CLEARED for over an hour without landing (information; landing is the SUPERVISOR's call) | OCC LOG only |
| `review-no-pr` · `done-not-merged` | Mismatch: Linear says In Review or Done but there's no PR, or it isn't merged | SUPERVISOR |
| `merged-not-done` | Mismatch: the PR merged but Linear isn't Done (information; a CLOSE draft candidate) | OCC LOG only |
| `health` | The AIRCRAFT holding the FLIGHT has stopped or is waiting for something (docs/fleet.md 8.8): `LIMIT`, `NETWORK`, `MODEL`, `CONTEXT`, `PROVIDER`, `UNANSWERED`, `HUNG` … `text` has the tag, the error line and the next step. A new code comes as a new issue. Don't resend to the team | SUPERVISOR if `warn`, OCC LOG only if `info` |
| `fuel` | The ACCOUNT of the AIRCRAFT holding the FLIGHT has used at least the INFO threshold of its plan limit (default 80 %; docs/fuel.md 6, ATC-55). `text` has the share used, the reset and the AIRCRAFT on that ACCOUNT. It comes once per ACCOUNT, window and reset. Don't send it to the team (TOWER tells the SUPERVISOR) | OCC LOG only |
| `stranded` | Mismatch: the PR was merged into a non-default branch and doesn't reach main (e.g. a stack merged bottom-up, each into the branch below; ATC-29). Shown even when Linear says Done | SUPERVISOR |

- Only issues with `fresh: true` are new. Put each in one OCC LOG line; report the ones with `severity: "warn"` to the SUPERVISOR. Then run `atcctl following ack` to record that they were reported.
- `fresh: false` issues were already reported; don't report them again. If one clears and comes back, atc marks it fresh again.
- Don't message teams. If a fact needs checking, use read-only `gh` as in the table below.

### When a team reports or the SUPERVISOR asks

When a CAPTAIN reports "PR opened", "review done" or "done", or the SUPERVISOR asks for a check:

| Check | How |
|---|---|
| Is the PR at the reported head commit | `gh pr view … --json headRefOid` |
| Did every required check pass on that head | `gh pr checks …` |
| Is the review on that head | `gh pr view … --json reviews` (compare the review's commit with the head) |
| Are the changed files inside the issue's allowed scope | `gh pr diff … --name-only` against the allowed files in `dispatch flight <FLIGHT>` |

If something differs from the report, tell the SUPERVISOR the facts only. Say nothing about whether to merge or how to judge the review.
