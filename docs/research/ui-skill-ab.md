# Survey (A/B): the same screen task built three ways

**English** · [한국어](ui-skill-ab.ko.md)

> Status: SURVEY for [ATC-296](https://linear.app/vocado/issue/ATC-296), 2026-10-01. Nothing here changes a manual, skill, guard, hook or setting; the throwaway worktrees were removed and nothing was pushed. The recommendation (section 7) is for the SUPERVISOR; nothing in it is decided. No screenshots are in this repository: the SUPERVISOR has them locally (section 8).

## Question

[ATC-293](https://linear.app/vocado/issue/ATC-293) (the `ui-review` skill) and [ATC-294](https://linear.app/vocado/issue/ATC-294) (the CSS token lint) add tools for screen work on top of [design-language.md](../design-language.md). Does a team session that has them build a better screen than one with only the design language, or with nothing? Which tool makes which difference?

## Method and limits

- **Same everything but the rules.** One model, one prompt (pasted unchanged), one fixture, one starting commit, headless `claude -p` in a throwaway worktree per run.
- **Small sample.** 3 runs per arm (the issue asks for 2; I added a third because the spread turned out to matter). 9 outputs in all. Numbers below are counts per run, never percentages.
- **Builders could not see the screen.** The trial rules said no server, so no builder opened the panel in a browser. `ui-review` therefore ran from code only (its "Not verified" lists say so). A real FLIGHT may start a test server; this one did not.
- **Reviewers are not independent of the vendor.** The blind reviewers ran on Opus (the `opus` alias) and the builders on Sonnet 5.5: different models, same vendor. CROSSCHECK's non-Anthropic family was not used.
- **Reviewer noise is large** (section 5). Nine outputs cannot show a one-line difference.
- **Harness faults I corrected, and what was discarded.** (1) A pilot run with a first prompt was thrown away: it told the builder not to run "anything that needs a server" in a way that made it skip `ui-review`; the final prompt asks it to do every step up to the commit, including pre-PR reviews. (2) My first measurement script measured the wrong table on six outputs (it matched a pre-existing table) and the first round of blind reviews (9 reviewers) was stopped after seeing this and a leak of my scratch edits into the review files; both were redone. (3) The first review of A2 was done on the wrong crop; the second is the one used. (4) The empty and error screenshots shown to the reviewers did not include the panel in several outputs, so those two states were judged from code. The harness now also saves panel-only screenshots of those states for the SUPERVISOR.
- **Spend (target ≤ 15 USD).** Builder runs: 5.81 USD measured (`total_cost_usd`, 9 runs) plus 0.39 USD for the discarded pilot run. Blind reviewers (about 19 Opus runs including the stopped round): roughly 5 USD, an estimate. This orchestrating session: roughly 3 USD, an estimate. Total about 14 USD, ±2.

## 1. The arms

All arms start from `origin/main` at **`81ead8b`** (which contains both tools). The tools are removed **in the scratch worktree only**.

| Arm | What the session has | Done in the scratch worktree |
|---|---|---|
| **A: nothing** | root `CLAUDE.md` without its design-language line, no `docs/design-language.md`, no `ui-review` skill, no lint test | B's removals, plus delete `docs/design-language.md` and the one `CLAUDE.md` line |
| **B: today** | design language and the `CLAUDE.md` rule; `atc-task` without its `ui-review` step; no skill; no lint | delete `.claude/skills/ui-review/`, the `ui-review` line of `atc-task`, `server/css-lint.ts`, `server/css-lint.test.ts`, `web/css-lint-baseline.json`; restore `docs/design-language.md` to its state before ATC-294 (`b7bc10c^1`, which is also before ATC-293 `338c2f4`) so its section 5 does not mention the skill or the lint |
| **C: with tools** | `origin/main` as it is: design language, `ui-review` routed from `atc-task` section 3, lint in `npm test` | none |

For every arm: `ab-fixture/skills-usage.json` was added, and the `rules-drift` hooks in `.claude/settings.json` got a temporary state folder (so the runs wrote nothing to the real `~/.local/state/atc`). Settings sources: project only, so the large user-level plugin listing was not part of the runs. Builder model **`claude-sonnet-5-5`** (the model of the TEAM_F session; the LAUNCH model setting in `fleet.json` was not read). Budget cap 3.2 USD per run (never reached).

The 294 CSS changes (new tokens) stay in all arms' `web/src/*.css`: they are code, not rules.

## 2. The task (T1) and the fixture

T1 only; the optional T2 was not run. The prompt, verbatim, identical in every arm:

```
You are TEAM_Q's CAPTAIN. FLIGHT ATC-900 (direct brief) is yours. This folder is your STAND already. Take it as a team session would (the atc-task skill) and do everything it asks up to the point of the commit, including any review it asks for before the PR. This is a trial, so do not commit, push or open a PR, do not write to Linear, do not send any message, do not start any server, and do not read anything outside this folder. Write the PR title and body you would have used in your final message.

FLIGHT ATC-900: SKILL USAGE panel on the METRICS tab

Add a SKILL USAGE panel to the METRICS tab of the web screen (web/src), as a new section of that tab.

Data: the browser fetches GET /api/skills/usage?days=N. The shape of the response is in ab-fixture/skills-usage.json (the same JSON the server returns). `days` holds one line per past day (oldest first) and `today` is a partial line for the current day. In each line, `skills` and `agents` map a name to its number of calls, `bySession` maps a session name (TEAM_F, TOWER, OCC, ...) to its counts of skill and sub-agent calls, and `qrh` has the checklist counts. Do not change the server.

The panel shows a table of skill and sub-agent calls by day, with totals. It has one filter control (by role or session, or by day range: your choice). It has a refresh action. It handles four states: loading, empty (no calls in the range), error (the request fails, with a way to retry) and the normal state with data.

Done when the panel works with that data and `npm test`, `npx tsc --noEmit -p .` and `npx vite build` pass.
```

**Fixture.** The real response shape of `GET /api/skills/usage` ([ATC-289](https://linear.app/vocado/issue/ATC-289), `skillUsageView`): `{at, days: [7 day lines], today: {…partial: true}}`; each line has `skills`, `agents`, `bySession`, `sessions` and `qrh`. Values are made up (fixed seed): 7 days of 2026-09-24 to 2026-09-30, 107 skill calls, names such as `atc-task`, `tick`, `ui-review`, `codebase-locator`. The measurement harness serves it through a Playwright route for `/api/skills/usage`; the empty state is the same shape with nothing in it, the error state is HTTP 500, the loading state is a 6 s delay.

## 3. What the runs cost

| Run | cost USD | wall s | assistant turns | output tokens | skills called |
|---|---|---|---|---|---|
| A1 | 0.70 | 141 | 63 | 17,092 | atc-task |
| A2 | 0.59 | 116 | 52 | 14,644 | atc-task |
| A3 | 0.61 | 173 | 51 | 14,146 | atc-task |
| B1 | 0.61 | 149 | 51 | 14,635 | atc-task |
| B2 | 0.69 | 141 | 60 | 14,881 | atc-task |
| B3 | 0.57 | 127 | 48 | 14,924 | atc-task |
| C1 | 0.63 | 141 | 53 | 16,413 | atc-task, ui-review |
| C2 | 0.66 | 214 | 63 | 17,559 | atc-task, ui-review |
| C3 | 0.75 | 214 | 55 | 18,725 | atc-task, ui-review |

Means: A 0.63 USD, 143 s, 55 turns, 15.3 k output tokens; B 0.62 USD, 139 s, 53 turns, 14.8 k; C 0.68 USD, 190 s, 57 turns, 17.6 k. **The cost of C over B is about 0.06 USD (+9 %), about 50 s (+37 %) and about 2.8 k output tokens (+19 %)**; run-to-run ranges overlap for cost and turns, not for wall time (B 127–149 s, C 141–214 s).

`ui-review` was called at turn 46, 55 and 49 of 53, 63 and 55, that is **late**, after the panel was built and tested. Turns after the call: 7, 8, 6. Edits after the call: 0, 1, 1 of 13, 17 and 10 edits. Its output: C1 "no findings, Approve"; C2 one Should-fix, fixed (the dates were UTC but not labelled); C3 one Should-fix, fixed (the refresh button should keep its label while loading). All three said the review was from code, with the 4 widths x 3 themes, the keyboard path and the horizontal-scroll checks "Not verified". `npm test` (which contains the lint) never failed because of the lint in any C run.

## 4. Mechanical measures (same script for every output)

Panel measured on a test server (`ATC_GITHUB=off`, temporary state folder, PID file, stopped by PID), 1280 x 800 and 390 x 844, default theme, Playwright with axe-core. The panel root was read from each output's code.

| Output | axe violations | targets under 24 px | controls without a visible focus change | signal-coloured elements (normal state) | distinct text sizes | words | lint findings in changed files | tsc / vite / npm test |
|---|---|---|---|---|---|---|---|---|
| A1 | 0 | 0 | 0 | 0 | 2 | 75 | 0 | pass |
| A2 | 0 | 3 | 0 | 0 | 2 | 83 | 0 | pass |
| A3 | 0 | 3 | 0 | 0 | 3 | 119 | 0 | pass |
| B1 | 0 | 3 | 0 | 0 | 2 | 51 | 0 | pass |
| B2 | 0 | 3 | 0 | 0 | 3 | 67 | 0 | pass |
| B3 | 1 (colour contrast) | 3 | 0 | 0 | 3 | 98 | 0 | pass |
| C1 | 0 | 3 | 0 | 0 | 3 | 105 | 0 | pass |
| C2 | 0 | 3 | 0 | 0 | 3 | 101 | 0 | pass |
| C3 | 0 | 0 | 0 | 0 | 3 | 63 | 0 | pass |

- The "under 24 px" count is the shared `7일 / 14일 / 30일` range control (22 px tall) that seven outputs reused; the two outputs with 0 used their own select (A1, C3). It is the existing component, not a choice of the panel.
- **Horizontal scroll at 390 px:** none caused by the panel in any output (its overflow was 0). Where the panel sits under the existing DAILY table on OPERATIONS, the page already scrolls sideways by 173 px without it.
- **Keyboard:** the refresh action was reached in 2 to 4 Tab presses and worked in all 9. Every control showed a focus change. But reviewers saw (from code) that the refresh button disables itself while loading, so focus falls to the page in several outputs (section 5).
- **States** (loading, empty, error with a retry that works): present in all 9. In C3 my retry check failed in the last pass, probably because my harness wrapped that fragment-shaped panel in a new box; it passed in the first pass.
- Lint: **0 findings in every arm, A included.** The builders wrote token-only CSS in all arms (they copied neighbouring code), so the lint had nothing to catch here. During measurement `npm test` failed in some runs on four unrelated fuel-cache tests that also fail on an untouched checkout at times (they depend on host state); the final measurement of all nine passed.

## 5. Blind review

One fresh Opus reviewer per output, given the design-language section 5 checklist (the version without the skill and lint), the candidate lines of the [ATC-285](https://linear.app/vocado/issue/ATC-285) reference comment, the output's changed files and screenshots, and the proof gate (contract, evidence, correction; try to falsify). Outputs were relabelled (three letters x run) and the arm was not told; the mapping is a local file.

| Output | PASS | FAIL | N/A | FAIL lines (checklist number) |
|---|---|---|---|---|
| A1 | 10 | 2 | 3 | 3 (focus ring colour), 15 |
| A2 | 9 | 3 | 3 | 4, 7, 15 |
| A3 | 10 | 2 | 3 | 4, 15 |
| B1 | 11 | 2 | 2 | 4, 15 |
| B2 | 12 | 1 | 2 | 4 |
| B3 | 7 | 5 | 3 | 4, 7, 9, 13, 14 |
| C1 | 11 | 2 | 2 | 4, 7 |
| C2 | 11 | 2 | 2 | 7, 15 |
| C3 | 11 | 2 | 2 | 4, 15 |

Means (PASS): **A 9.7, B 10.0, C 11.0.** Range within an arm: A 9 to 10, **B 7 to 12**, C 11 to 11. A reviewer ran twice on A2 (first on a wrong crop): PASS 9 both times, FAIL 4 and 3.

- **Run-to-run spread is bigger than the gap between arms.** B alone spans 5 lines (B3 and B2). The gap between the means is 0.3 (A to B) and 1.0 (B to C). With this noise (a pooled within-arm spread of about 1.6 lines) a one-line difference would need on the order of 40 runs per arm. This sample cannot tell A, B and C apart.
- C had the narrowest spread (three outputs with identical counts). That is a hint, not a result.
- **Lines that failed most often, in every arm:** line 4 (the browser adds up counts that the server could send; disputed, as the reviewers themselves called it "display arithmetic" in A1, C2) 7 of 9; line 15 (Craft: Korean text in mono or letter-spaced, a second heading level, a shaded footer cell) 6 of 9; line 7 (an "없음"-type placeholder or a constant note) 4 of 9. Observations noted nearly everywhere: loading shown at once with no delay, hover/active states missing, hit targets right at 24 px, and **focus lost when the refresh button disables itself** (a keyboard problem; flagged as a FAIL on line 14 in B3).
- **What `ui-review` caught that the reviewers did not:** the missing "UTC" label (C2) and the loading label (C3), both small. **What the reviewers caught that `ui-review` did not:** the focus drop (C1, flagged as an observation), Korean in mono (C3), the client-side sums (C1, C3), a "SKILL USAGE 없음" placeholder shown beside an error (C2) and a constant note in the toolbar (C1). `ui-review` said "Approve" for C1.

## 6. Where C beats B, and what A shows

- **C over B.** +1.0 PASS on average, no regression in any mechanical measure, a narrower spread, at about +0.06 USD, +50 s and +19 % output tokens. Both are inside the noise of section 5. Which tool? The **lint contributed nothing observable**: zero findings in every arm, none during any run. So any real difference in C comes from the **skill** (two small fixes in two runs, and the self-review pass) and not from the lint. The sample cannot separate even these.
- **A over nothing (B vs A).** +0.3 PASS on average, nothing in the mechanical measures. What the design language alone buys is not visible on this task. A plausible reason: the builders imitated neighbouring screens (token-only CSS, `.mx-table`, `.mx-range`, the `.label` heading), so the rules had little to add to a table panel placed next to tables. A new surface with no similar neighbour might show a difference; T2 or a different task would test that.
- **Cost of C** is small in money and about a minute of wall time per FLIGHT in this trial, with the review done late.

## 7. Recommendation

| Tool | Verdict | Why |
|---|---|---|
| Design language ([design-language.md](../design-language.md) and the `CLAUDE.md` line) | **Keep.** | Cheap, and no evidence against it. A vs B shows no gain on this task; test it on a screen with no similar neighbour before changing anything |
| `ui-review` skill | **Keep as a pilot, change two things.** | (1) It ran at turn 46 to 55 of 53 to 63 and led to 0 to 1 edits: route it earlier (after the first render, before the final tests) so findings can be acted on. (2) It ran from code only; in a real FLIGHT run it with the test server so the keyboard, width and focus checks are not "Not verified". Also check that its rules cover the three most frequent independent findings: a control that disables itself on press drops focus; Korean text set in mono or letter-spaced; counts added up in the browser |
| CSS token lint | **Keep.** Cannot tell from this sample. | No findings in any arm, because builders copy neighbouring tokens; it guards other FLIGHTs against regressions at no run cost. Judge it by counting real lint failures in later FLIGHTs |
| Extending the pattern (to other AIRPORTs, other skills from [ATC-281](skill-rulebook.md)) | **Not on this evidence.** | A difference of one checklist line cannot be seen with 3 runs per arm and this reviewer noise. Use real FLIGHTs instead: the skill-call reader ([ATC-289](https://linear.app/vocado/issue/ATC-289)) already counts `ui-review` calls; add the PR-body checklist answers and reviewer FAIL counts per FLIGHT. If a controlled run is repeated, use a harder task (T2, a failing existing component, or a surface without neighbours) and more runs |

## 8. What the SUPERVISOR has locally (not in this repository)

- Screenshots, default theme, labelled by letter and run (`X1`, `X2`, `X3`, `Y1`, …, `Z3`): `/tmp/playwright-mcp/ab/<label>-1280-normal.png` (viewport), `-1280-panel.png` (the panel alone), `-1280-empty.png` and `-1280-empty-panel.png`, `-1280-error.png` and `-1280-error-panel.png`, `-390-normal.png`.
- The blind reviewers' full texts: `/tmp/playwright-mcp/ab-reviews/<label>.txt`.
- The mapping from letters to arms: `/tmp/playwright-mcp/ab-mapping.json`. Look at the screenshots first and read the mapping after. This document names arms A, B and C and runs 1 to 3 only.

## 9. What this survey did not do

- It did not run T2, other models, a different task, a real test server for the builders, or a theme other than the default.
- It did not test whether the design language helps when the neighbouring code does not show the pattern.
- It did not show that any tool is useless: it shows that this sample and this reviewer cannot tell.
