# Research: rethinking Human Preview (summary)

**English** · [한국어](human-preview.ko.md)

> Status: public summary of the [ATC-39](https://linear.app/vocado/issue/ATC-39) research, 2026-09-28. **The full report and its evidence are in a private Linear document (ATC-39).** The recommendation needs a SUPERVISOR decision; nothing here changes an application repository's gates or atc's landing behavior.

## Question

A private application repository (Next.js, deployed with per-PR Vercel Previews) has a manual **Human Preview** gate. For any PR that changes rendered UI, a person opens the PR's Preview, runs a checklist and records a disposition in the PR body. The research asked two things:

- Should the gate itself change, instead of only being made easier ([ATC-37](https://linear.app/vocado/issue/ATC-37))?
- If so, how?

## Method

- **PRs:** every PR created in the 30 days before 2026-09-28 was read with read-only `gh` (GraphQL):
  - the PR body and its **edit history**, which shows when a PR was marked as needing a human check and when the recorded disposition changed;
  - ready-for-review events, merge times and review threads.
- **Other sources:** issue bodies for why UI decisions were made, and the atc LOGBOOK for landing waits.
- **Buckets:** the repository's existing visual tooling (headless browser checks, metric and pixel regression) was listed, and each thing a person checks was sorted into "only a person can judge" or "a machine can check".
- **Limit:** all PR body edits come from one shared owner account, so human and agent edits can't be told apart by author. A finding given in chat and fixed before the next push leaves no trace, so "no recorded catch" means none recorded, not none happened.

## What we found (generalized)

- **The gate costs more in text than in waiting.** The gate's section is most of the PR template and a large share of each UI PR body. Most human-check PRs didn't wait longer than others; the cost sits in a few multi-day waits.
- **The record doesn't match practice.** Most PRs marked as needing a human check merged with the check still recorded as pending. The human merge was the real decision.
- **No recorded catch.** Over the period, no human check recorded a defect that automated or agent QA had missed.
- **A person was genuinely needed for three things:**
  - choosing between designs;
  - checking signed-in flows on a real account, which agents can't do;
  - real-device feel (touch, mobile Safari, rotation), which agents repeatedly reported as not verified.
- **The mechanical side is mostly covered already.** Layout, overflow, contrast and regressions have tools in the repository; they just aren't the gate.

## Recommendation: a risk-based evidence pack

- **Every UI PR** gets a machine-made **evidence pack**: before/after screenshots of the touched routes at three widths in light and dark, a short clip for motion, and the agent visual-QA result against the task's done criteria.
- **A person is required only for three classes:**
  - **CHOICE**: a new screen or visual direction, brand or copy tone, or a pick between alternatives. The person approves from the evidence pack.
  - **ACCOUNT**: signed-in, OAuth, logout or real-account data flows. The person opens the exact-head Preview and runs 1–3 listed steps.
  - **DEVICE**: touch, mobile browser chrome, safe areas, rotation or embedded players. The person checks on a real device.
- **Everything else** lands on checks and agent QA, then gets a short look on staging after merge, with a fast revert if needed.
- **A human check binds to the head SHA.** A later UI-changing commit needs a new check; a main-only merge carries it (the ATC-31 rule).

### Staged rollout

| Stage | Change | Tooling |
|---|---|---|
| 0. Rules | Replace the long gate section with a short "UI change" block: impact, class, evidence link, Preview and steps (ACCOUNT/DEVICE only), human check result | None |
| 1. Evidence pack | Agent QA posts before/after screenshots to the PR | The repository's pinned Playwright |
| 2. Regression in CI | Deterministic metric regression against a main baseline in CI; pixel diffs stay local | CI only |
| 3. Measure | atc records per UI PR: class, whether a person looked, wait, findings, and reverts within 7 days. It reuses the LOGBOOK `measured` pattern (ATC-32/33) | atc |

Paid visual-review services and automated Preview access (share tokens, protection bypass) are SUPERVISOR decisions. The recommendation doesn't need them.

## ATC-37: change it

Keep the core: one place to see what waits on a person, and a one-click, head-bound result. Scope it down:

- the queue holds only CHOICE, ACCOUNT and DEVICE PRs;
- each row shows the evidence pack and, for ACCOUNT and DEVICE, the Preview link;
- a pass or fail writes one PR comment and one short result line;
- landing blocks only classed PRs.

Build it after stage 0 is adopted, since it reads the new block.

## Decisions for the SUPERVISOR

1. Adopt the evidence pack and the stage 0 rules, or keep the gate and build ATC-37 as written.
2. Whether a post-merge staging look with fast revert is acceptable for unclassed UI PRs.
3. Whether to allow any paid visual-review service or automated Preview access. Neither is needed.
