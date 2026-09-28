# Research: rethinking Human Preview

**English** · [한국어](human-preview.ko.md)

> Status: research report for [ATC-39](https://linear.app/vocado/issue/ATC-39), 2026-09-28. The recommendation needs a SUPERVISOR decision. Nothing here changes vocado files, gates or PR bodies, and nothing changes atc's landing behavior.
> Data: every vocado PR created from 2026-08-29 to 2026-09-28 (#262–#405, 143 PRs), read with read-only `gh`, plus Linear issue bodies and the atc LOGBOOK. Reproduce with `node docs/research/human-preview-stats.mjs 2026-08-29`.

## Summary

The Human Preview gate costs a lot of text and a few long waits. In 30 days there is no recorded case of it catching something the agents had missed. Where a person was actually needed, it was for one of three things:

- choosing between designs;
- a signed-in check that needs a real account;
- a real-device feel that headless browsers can't give.

**Recommendation.** Replace the manual gate with a **risk-based evidence pack**:

- Machines check the mechanical things on every UI PR and attach before/after screenshots.
- A person is required only for three named classes (CHOICE, ACCOUNT, DEVICE), and approves from the images, opening the Preview only for ACCOUNT and DEVICE.
- Everything else lands without a human pre-merge step, with a short post-merge look on staging and a fast revert.
- Roll it out in four stages. Stage 0 is a rules change with no tooling.

For [ATC-37](https://linear.app/vocado/issue/ATC-37): **change it**. Build a smaller queue for the three classes that shows the evidence pack, and drop the long body-editing contract.

## 1. Current facts

### 1.1 What the gate asks for today

- vocado `.github/pull_request_template.md` has a "Human Preview Gate" section of **13,514 characters, 180 lines and 70 fields**. That is 77% of the whole template.
  - The fields cover deployment identity, probes, a 3–5 action checklist, the Human Visual Review disposition, a Design QA matrix, bindings, carry-forward rules, and more.
  - The canonical rules are in `docs/ai-collaboration-framework.md` ("Material Web UI/UX Human Preview Gate") and `docs/agent-output-contract.md` §3a.
- The gate applies to any diff that "can materially affect rendered Web UI/UX". Mixed or uncertain impact counts as `required`.
- The human opens the Vercel Preview (project `vocado-staging`) in their own browser, runs the actions, and a team edits the disposition in the PR body.
- vocado already has mechanical visual tooling, all run by agents, none in CI:
  - `seed:preview:verify`: headless Playwright checks on the preview bundle, part of `verify:local`;
  - `seed:visual`: regression against a captured baseline, in "metrics" mode (computed styles, boxes, overflow; deterministic) or "pixels" mode;
  - `seed:doctor`: token drift and the contrast contract, which does run in CI.

  Baselines are not committed, and app-surface baselines are captured by an operator.
- vocado `CLAUDE.md` (leader rules, changed 2026-09-28) gives screen checks to `visual` and `ui-qa`. Both default to headless Playwright on Linux, with Mac Chrome only when needed.

### 1.2 Cost over the last 30 days

| | Count |
|---|---|
| PRs created | 143 (119 merged, 19 closed, 5 open) |
| PRs touching `.tsx`/`.css` | 74 |
| PRs carrying the Human Preview section | 53; the section is a median 20% (2,031 characters) of the body, up to 7,780 characters (#307) |
| PRs ever marked `required` | 16 (15 by the template field, and #405 in prose: "Vercel Preview by a person (completion criterion)") |
| … closed without merging | 5 drafts (#279, #280, #282, #307, #308) |
| … downgraded to `not required` | 1 (#351) |
| … merged | 8 (#357, #358, #359, #362, #366, #373, #379, #385) |
| … open, waiting on the gate | 2 (#399 since 2026-09-26, #405 since 2026-09-28) |

**Merged `required` PRs and their recorded disposition:**

| PR | Ready → merge | Disposition at merge | Note |
|---|---|---|---|
| #359 | 0.2 h | `approved` | SUPERVISOR, signed in, Mac Chrome. Findings: none |
| #366 | 46.7 h | `passed` | SUPERVISOR checked actions 1–4 on 2026-09-27. Findings: none |
| #385 | 30.9 h | `pending` | |
| #373 | 1.6 h | `pending` | |
| #358 | 0.8 h | `pending` | |
| #357 | 0.4 h | `pending` | |
| #362 | 0.0 h | `pending` | "the user authorized the merge directly … after a local dev-server review was offered; no separate Human Visual Review disposition" |
| #379 | 0.0 h | `pending` | |

- **Six of eight merged `required` PRs landed with the gate still `pending` in the body.** The human merge was the real decision; the gate's record did not follow it.
- Required PRs did not wait longer overall. Median PR open → merge (atc LOGBOOK) was 3.1 h for them, against 5.7 h for other merged PRs and 4.1 h for other UI-touching PRs. The cost sits in **a few long waits**: #366 took 46.7 h, #385 30.9 h, and #399 has been blocked two days and counting.
- #399 is blocked by the signed-in part of its checklist. The previous lead could probe it only signed-out. #405 also leaves "signed-in server mode on a real account" to a person.
- #404's team could not reach its Preview through its tools (Vercel MCP timed out), and measured the layout itself with headless Chromium.

### 1.3 What the human check caught

- **No recorded catch in 30 days.** No PR records `changes requested`, and the two recorded approvals (#359, #366) list no findings.
- The human decisions that did shape the UI were **choices, not defect catches**:
  - VOC-180 built three minimal fixes (A, A′, B) as draft PRs with Previews "so the user compares them and picks". Option A landed as #383, and the user then chose B as a separate issue (VOC-192, #404).
  - VOC-172 and VOC-194 record scope and approach decisions "by the user via the President session".
- Agents, meanwhile, record what they could not check: "Not verified: real devices" (#331, #334, #336), "no Mac Safari or physical touch device run by the agent" (#378), "real device rotation and Safari toolbars" (#383), and "Not measured: Mac Chrome and Safari, retina, and signed-in states" (#404). These are the gaps a human actually fills.
- **Caveat.** A human finding given in chat and fixed before the next push would leave no trace in the PR. The zero is "none recorded", not "none happened". Stage 3 below makes this measurable.

## 2. What the check is for

| Only a person can judge | A machine can check |
|---|---|
| **Taste and brand**: does it feel like vocado, is the hierarchy right, which of A/B is better (VOC-180) | **Layout**: boxes, positions, overlap (e.g. sheet over the player), sticky and scroll behavior at fixed widths |
| **Real-device feel**: Safari toolbars, safe areas, touch and swipe, rotation, retina rendering, real iframe (YouTube) behavior | **Overflow and wrapping**: horizontal scroll, clipped text, 200% text, long Korean words |
| **Signed-in and account flows** on a real account: OAuth callbacks, logout, server-mode data (#399, #405) | **Contrast and tokens**: the contrast contract and token drift (`seed:doctor`, already in CI) |
| **Copy tone** in context, and whether an empty or error state reads right | **Regressions**: computed-style and box metrics against main (`seed:visual` metrics mode), pixel diff where stable |
| | **States**: hover, focus-visible and pressed styles; dark and light; reduced motion |

The left column is small and recognizable up front: a PR either changes something a person must choose, touches a signed-in flow, or depends on device feel. The right column is where most UI PRs live, and vocado already has most of the tools for it.

## 3. Options

| Option | Replaces | Needs | Risk | Cost |
|---|---|---|---|---|
| **A. Visual regression / screenshot diff against main** | Human spotting of layout regressions | `seed:visual` metrics mode in CI against a main baseline for the preview bundle; app surfaces need a stable fixture server | Fixture-only coverage misses real data and auth. Pixel mode is flaky on the Song surface (documented 2026-09-18) | Low–medium: CI time plus baseline upkeep. No new service if run in GitHub Actions |
| **A′. Hosted visual review (Chromatic, Percy, Argos)** | Same as A, with a review UI | A paid plan, uploading screenshots to a third party | Data egress, vendor lock-in | **SUPERVISOR decision** (paid service and egress). Not needed for the recommendation |
| **B. Agent visual QA as the gate, human spot check by risk class** | The human run on every `required` PR | `ui-qa`/`visual` produce a fixed evidence set (widths, themes, states) with pass/fail against the PR's acceptance | Agents miss taste and device feel; mitigated by the classes below | Low: agents already do this; it becomes the gate instead of a side note |
| **C. Evidence pack in the PR or atc; human approves from images** | Driving the Preview for most reviews | Before/after screenshots at fixed widths (375, 768, 1280) × light/dark for the touched routes, plus a short clip for motion; posted to the PR or shown in atc | Screenshots can hide interaction bugs; keep the Preview link for ACCOUNT and DEVICE | Low: Playwright is already pinned in vocado |
| **D. Post-merge review on staging with fast revert** | Pre-merge human wait for low-risk UI | A named daily or next-session look at staging, and a revert habit (atc LOGBOOK already records reverts) | A bad change is live on staging until seen; not for production-facing or auth changes | Very low |
| **E. Risk-based rules for when a person is required** | "Any material UI change is `required`" | Three classes written into the PR template and agent rules | A mis-classified PR skips the person; mitigated by D and by the reviewer's power to add a class | None |
| **F. Keep the gate, make it easier (ATC-37 as written)** | The Vercel hunt and body edits | atc queue, Preview link per head, one-click pass | Keeps the 70-field contract and a person on every material PR | Medium: atc work, and the process cost stays |

## 4. Recommendation: the risk-based evidence pack (E + B + C, with A and D behind it)

**Rule.** Every UI PR gets a machine-made evidence pack. A person is required only when the PR is in one of three classes:

- **CHOICE**: a new screen or visual direction, a brand or copy-tone change, or a pick between alternatives. The person approves from the evidence pack.
- **ACCOUNT**: the change touches a signed-in, OAuth, logout or real-account data flow. The person opens the Preview and runs the listed steps.
- **DEVICE**: the change depends on touch, Safari chrome, safe areas, rotation or a real iframe. The person checks on a phone or Mac Safari.

Everything else lands on green checks plus the agent QA gate, then gets a short look on staging after merge, with a revert if needed.

This matches the last 30 days. #399 and #405 are ACCOUNT, VOC-180 is CHOICE, and #378, #383 and #404 name DEVICE gaps. #357, #358, #373 and #379 would not need a person at all, which is what actually happened: they merged with the gate `pending`.

### Staged rollout

| Stage | What changes | Tooling | Exit check |
|---|---|---|---|
| **0. Rules** (now) | Replace the 70-field section with a short "UI change" block (below). Classes decide who looks. Disposition is recorded only for a class | None | A week of UI PRs with the block filled truthfully; no `pending` at merge for a classed PR |
| **1. Evidence pack** | `visual`/`ui-qa` capture before (main) / after (PR head) for touched routes at 375, 768 and 1280 in light and dark, plus a GIF for motion, and post them as a PR comment (committed images under `output/` are not needed) | vocado Playwright (already pinned) | Every UI PR has a pack; humans approve CHOICE from it without opening the Preview |
| **2. Regression in CI** | `seed:visual` metrics mode runs in CI for the preview bundle against a baseline built from main in the same job. Pixel mode stays local | GitHub Actions only | Metric regressions fail CI; flake rate recorded |
| **3. Measure** | atc records, per UI PR: class, whether a person looked, how long it waited, what they found, and reverts within 7 days. It reuses the LOGBOOK `measured` pattern (ATC-32/33) | atc | After 30 days, compare catches and reverts with this report's baseline and tune the classes |

Paid visual-review services (A′) and automated Preview access with Vercel share tokens or protection bypass are **SUPERVISOR decisions**. The recommendation does not need them.

### Proposed wording for vocado (not edited here)

**`.github/pull_request_template.md`**: replace the whole "Human Preview Gate" section with:

```markdown
## UI change

- UI impact: `none` / `changes rendered UI`
- Human check class (any that apply): `CHOICE` (new screen, visual direction, brand or copy tone, pick between options) / `ACCOUNT` (signed-in, OAuth, logout, real-account data) / `DEVICE` (touch, Safari chrome, safe areas, rotation, real iframe) / `none`
- Evidence pack: link to the PR comment with before/after screenshots (375 / 768 / 1280, light and dark) and agent QA result
- Preview (ACCOUNT or DEVICE only): exact URL for the current head
- Human steps (ACCOUNT or DEVICE only): 1–3 steps with the expected result
- Human check: `not needed` / `pending` / `done <date> <head sha> <what was seen>`
```

**`docs/ai-collaboration-framework.md`**: replace "Material Web UI/UX Human Preview Gate" with:

> Every PR that changes rendered UI carries an evidence pack made by agent visual QA: before/after screenshots of the touched routes at 375, 768 and 1280 px in light and dark, with a pass/fail against the task's done criteria. A person is required only for the classes CHOICE, ACCOUNT and DEVICE. For CHOICE the person approves from the evidence pack; for ACCOUNT and DEVICE the person opens the exact-head Preview and runs the listed steps. A human check binds to the head SHA; a later commit that changes rendered UI needs a new check, a main-only merge does not. Other UI PRs land on checks and agent QA, and get a short look on staging after merge, with a revert if needed.

**`AGENTS.md`**, one line under the delivery rules:

> For rendered-UI changes, attach the evidence pack and set the human check class. Do not wait for a person unless the class is CHOICE, ACCOUNT or DEVICE.

**`CLAUDE.md`** (leader rules), one line next to the visual/ui-qa rules:

> visual or ui-qa makes the evidence pack for every UI PR before Ready. The leader sets the human check class; for ACCOUNT or DEVICE, list 1–3 steps for the person and do not merge before they are done.

### ATC-37: change it

Keep the useful core, which is one place to see what waits on a person, with a one-click result bound to the head. Cut the rest:

- **Queue**: only open PRs whose class is CHOICE, ACCOUNT or DEVICE and whose human check isn't `done` for the current head. It is not every `required` PR.
- **Row**: PR, FLIGHT, team, class, the evidence pack (thumbnails from the PR comment), and the Preview URL for ACCOUNT and DEVICE. There is no 70-field parsing.
- **Pass / fail**: as written (head-bound, carries across main-only merges per ATC-31), writing a PR comment and the single `Human check:` line.
- **Landing**: the `human-preview` block applies only to classed PRs.
- Build it after Stage 0 is adopted, since it parses the new block.

## 5. Risks

- **Misclassification.** A PR that should be ACCOUNT is marked `none`. Mitigations: the reviewer (Codex or DeepSeek) and CROSSCHECK can add a class; changes to auth, middleware, proxy or OAuth paths get ACCOUNT by file path; Stage 3 measures reverts.
- **Evidence packs that look fine but hide interaction bugs.** Motion GIFs and agent interaction checks cover part of this. DEVICE covers the rest.
- **Staging reviews that never happen.** Stage 3 records whether the post-merge look happened, and atc can list unlooked-at UI merges.
- **Less recorded human judgment.** The current record is mostly `pending` anyway. The new one is short and truthful.

## 6. Decisions for the SUPERVISOR

1. Adopt the risk-based evidence pack and Stage 0 wording (or keep the gate and build ATC-37 as written).
2. Whether post-merge staging review with fast revert is acceptable for unclassed UI PRs.
3. Whether to allow any paid visual-review service or automated Preview access (share tokens, protection bypass). The recommendation doesn't need either.
