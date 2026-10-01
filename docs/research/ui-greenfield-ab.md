# Greenfield A/B: "build me a screen" from an empty project (ATC-309)

**English** · [한국어](ui-greenfield-ab.ko.md)

Status: SURVEY result, 2026-10-01. Text only: the screenshots stay on the host for the SUPERVISOR's blind look and are not in this repository, a PR or an issue (atc is public). [ATC-296](https://linear.app/vocado/issue/ATC-296) is the in-repo comparison and is unchanged.

## 1. Question and short answer

The SUPERVISOR's question: *when I say "make me a ___ screen" and there is nothing yet, how different is the result with a UI skill and without one?*

**What the sample can say** (2 runs per arm per task, one model, one reviewer family; no percentages):

- **atc's `ui-review` skill changed the build, not the look.** All four runs called it (the `CLAUDE.md` line asks for it). The dashboard (T1) came out cleaner on the mechanical checks: no hit target under 24 px in both runs (A: 20 of 26 in one run), no serious axe violation (A: one each; one C run had a *critical* `select-name`). The cost was about **1.9× the money** and **1.9–2.5× the wall time** of the blank arm. On the settings form (T2) all arms were mechanically identical (0 axe violations, 0 small targets), except that both `ui-review` runs left Save always enabled while the other arms disable it until something changes.
- **`frontend-design`, installed as a project skill, was never used.** In 4 of 4 runs the session never called it (its description did not match a Korean "build a dashboard / settings screen" request). Those runs are, in effect, blank runs. When one `CLAUDE.md` line told the session to use it (arm C2) it was called in 4 of 4 runs, cost about **1.3–1.5×** of blank, and its T1 results looked like `ui-review`'s (0 small targets, one run with 0 axe violations, the other with one serious contrast finding).
- **On overall quality the sample cannot tell.** The blind model review (Claude Sonnet 5.5, a different tier of the same family: no other family was available) scored every output 7 to 9 out of 10 and the per-heuristic sums overlap. The **primary judge, the SUPERVISOR's blind look, is still open**: see section 8.

**Recommendation (provisional until the blind ranking is in):**
1. For a new **dense or interactive** screen (a dashboard, a list-and-detail view) run `ui-review` in `diff` mode as the last step: it is the only arm that removed the small-target and contrast findings in both runs, for about twice the cost. For a **small form** it added cost and no mechanical gain here.
2. **Do not install `frontend-design` alone and expect an effect.** If the SUPERVISOR prefers the C2 look in the blind ranking, add the explicit `CLAUDE.md` line ("When you build a screen, use the `frontend-design` skill"); without it the skill is inert for this kind of request.
3. If the blind ranking shows no preference between arms, say "the sample cannot tell" for look and keep only `ui-review` as a cheap gate for dense screens.

## 2. Arms and scaffold

Every arm: the same model, **`claude-opus-5-5`** (what a plain `claude` launch uses on this host; `fleet.json` has no `launchModel`), Claude Code 2.1.286, the same prompt (section 3), the same scaffold, one headless `claude -p` session in its own throwaway folder (not an atc worktree), nothing pushed.

| Arm | What the session has |
|---|---|
| **A: blank** | The scaffold only. No `CLAUDE.md`, no skills, no plugins |
| **B: atc `ui-review`** | A + `.claude/skills/ui-review/` copied as is (`SKILL.md`, `references/`; atc `main` at `9163b77`) + a `CLAUDE.md` with one line: "Before you finish a screen, run the `ui-review` skill in `diff` mode and fix its Blockers." Its links to `docs/design-language.md` do not resolve in a greenfield folder (left as they are); the scaffold is a one-commit git repository so `diff` has something to diff |
| **C: `frontend-design`** | A + Anthropic's `frontend-design` skill copied as a project skill (`anthropics/skills` `skills/frontend-design/`, commit `8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4`, Apache-2.0). No `CLAUDE.md` |
| **C2** (added) | C + a `CLAUDE.md` with one line: "When you build a screen, use the `frontend-design` skill." Added because C was never invoked (the symmetric counterpart of B's line) |

Arm D (B + C) was not run: C was inert and the question it would answer is unclear.

**How "no skills" was enforced.** `--setting-sources project` leaves out user-level settings, skills and plugins. Claude Code still ships built-in skills (`design`, `design-sync`, `dataviz`, …) that no setting removes, so every arm ran with `--disallowedTools "Skill(design) Skill(design-sync) Skill(dataviz) WebFetch WebSearch Task"`: the only UI skill a session can load is its own arm's. The run log shows it works: in one A run the session tried `dataviz` and was refused (`Skill execution blocked by permission rules`). Allowed tools: `Read Write Edit Skill` and a short list of `Bash(...)` patterns (`npm run build`, `npx tsc`, `ls`, `cat`, `find`, `grep`, `wc`, `git diff|status|log|show`). No dev server and no browser, in every arm: **no session saw its own screen**. `--max-budget-usd 3` per run; the survey's first-run stop rule (a first run over $2) was never close to being hit.

**Scaffold.** `npm create vite@latest -- --template react-ts`, installed once, demo content, CSS, icons and README removed (`App` renders an empty `<div />`), copied per run (`node_modules` hard-linked). **No UI library; the arm may add CSS but no npm package** (written into the prompt). Data: a fixed local `src/data.json` per task, the same for every arm: T1 20 servers (13 healthy, 4 degraded, 2 down, 1 maintenance; name, role, region, status, CPU, memory, last seen, uptime, IP, OS, two recent events), T2 four channels (email on, Slack on, push off, SMS off) and `me@example.com`.

## 3. Prompts (verbatim, Korean, same for every arm)

T1:

```text
서버 여러 대의 상태를 한눈에 보는 운영 대시보드 화면을 만들어줘. 목록, 상태, 하나를 누르면 상세가 보이게.

작업 조건:
- 이 폴더는 Vite + React + TypeScript 프로젝트이고 화면은 src/App.tsx에서 시작한다.
- 새 npm 패키지를 추가하지 않는다. CSS는 직접 써도 된다.
- 데이터는 src/data.json을 읽어 쓴다(서버 없음).
- 끝나면 `npm run build`가 통과해야 한다.
- 마지막에 한 문단으로 무엇을 만들었는지 알려줘.
```

T2: the same conditions after "알림 설정 화면을 만들어줘. 채널별로 켜고 끄고, 이메일 주소를 입력하고, 저장할 수 있게."

Runs: 2 per arm per task, A, B, C and C2 × T1, T2 = 16 runs (12 planned + 4 for C2).

## 4. Runs and cost

| Arm | T1 cost (2 runs) | T2 cost (2 runs) | T1 wall (s) | T2 wall (s) | Skill called |
|---|---|---|---|---|---|
| A blank | $1.16 | $0.63 | 197 | 85 | none (one refused attempt at the built-in `dataviz`) |
| B `ui-review` | $2.14 | $1.21 | 382 | 214 | `ui-review` 4 of 4 |
| C `frontend-design` | $1.16 | $0.69 | 191 | 104 | **0 of 4** |
| C2 | $1.50 | $0.93 | 277 | 170 | `frontend-design` 4 of 4 |

Per run: A $0.58 / $0.58 / $0.32 / $0.31; B $1.14 / $1.00 / $0.59 / $0.62; C $0.56 / $0.60 / $0.35 / $0.34; C2 $0.74 / $0.76 / $0.50 / $0.43 (T1-1, T1-2, T2-1, T2-2). All 16 builds passed (`npm run build`, re-run by the harness).

**Spend:** builders $9.42, blind reviews $0.92 on the final pass (the T2 reviews were re-run once after a harness fix, about $0.5 more), one probe $0.05: about **$11** of the $20 cap.

## 5. Mechanical measures (the same script for every arm)

Each build was served with `vite preview`, driven in headless Chrome at 1280 × 800 over the DevTools protocol (Playwright is not installed in this session): axe-core (WCAG 2/2.1/2.2 A/AA and best-practice tags), Tab presses to the main action, Enter on the focused control, visible focus change on each of 35–40 Tab stops, interactive elements under 24 px (label size counts for inputs), TSX/CSS lines.

| Run | axe violations / nodes / serious+critical | Targets < 24 px | Tabs to main control | TSX / CSS+html lines |
|---|---|---|---|---|
| A-t1-1 | 2 / 17 / **1** (`color-contrast`) | **20 of 26** | 9 | 353 / 540 |
| A-t1-2 | 2 / 27 / **1** (`color-contrast`) | 0 of 9 | 15 | 452 / 475 |
| B-t1-1 | 0 / 0 / 0 | 0 of 26 | 9 | 496 / 713 |
| B-t1-2 | 2 / 2 / 0 | 0 of 26 | 9 | 359 / 517 |
| C-t1-1 | 4 / 7 / **2** (`color-contrast`, `select-name` critical) | **5 of 12** | 15 | 364 / 480 |
| C-t1-2 | 1 / 1 / 0 | 0 of 26 | 9 | 322 / 573 |
| C2-t1-1 | 0 / 0 / 0 | 0 of 25 | 8 | 300 / 351 |
| C2-t1-2 | 2 / 18 / **1** (`color-contrast`) | 0 of 46 | 6 | 356 / 618 |
| A-t2-1, A-t2-2 | 0 / 0 / 0 | 0 of 7 | 6 | 209 / 192, 156 / 188 |
| B-t2-1, B-t2-2 | 0 / 0 / 0 | 0 of 7 | 6 | 235 / 269, 266 / 303 |
| C-t2-1, C-t2-2 | 0 / 0 / 0 | 0 of 7 | 6 | 227 / 233, 206 / 252 |
| C2-t2-1, C2-t2-2 | 0 / 0 / 0 | 0 of 7 | 6 | 188 / 301, 198 / 323 |

- Moderate axe findings were `region` / `landmark-one-main` (the page has no landmark): no arm avoided them reliably (B-t1-1 and C2-t1-1 did).
- **Visible focus:** every sampled Tab stop in every run showed a style change, so this measure does not separate the arms.
- **Feature checklist** (written before the runs). T1: all 20 servers listed, status, CPU, last seen, a summary of counts, detail opens on a click and on Enter: **all 8 runs yes** on every item. T2: four channel toggles, e-mail input pre-filled and labelled, an invalid address gives a message, saving gives a confirmation: **all 8 runs yes**. The one difference is "unsaved changes": A, C and C2 disable Save until something changes (and show "unsaved changes" text); both B runs keep Save always enabled (they do show a text for unsaved changes).
- Loading / empty / error states: the runs have no loading state (local data); T1 runs mention an empty-result text; none was reached by a script, so this is source evidence only.

## 6. Blind model review

A fresh `claude -p` reviewer per output (Sonnet 5.5; builders were Opus 5.5: **a different tier of the same family. A reviewer of a different family was not available**, say so before reading the scores). It saw only the random label and the 1280 × 800 screenshots, not the arm, the code or the measures, and used a **neutral rubric** (Nielsen's 10 heuristics 0–2, WCAG 2.2 AA basics visible in a screenshot, "did it do what was asked", overall 1–10), **not** the `ui-review` checklist, so arm B was not graded by its own rules.

| Task | A | B | C | C2 |
|---|---|---|---|---|
| T1 overall (run 1, run 2) | 9, 8 | 8, 8 | 8, 8 | 8, 8 |
| T2 overall (run 1, run 2) | 8, 8 | 8, 8 | 7, 8 | 8, 8 |

Nielsen sums fell between 12 and 17 of the points the reviewer could judge with no pattern by arm; the reviewer's "biggest problems" were the same across arms (small grey secondary text, no next action for a *down* server, only about 10 of 20 servers on the first screen, a small success message). **The model review does not separate the arms.** Its WCAG pass/fail marks (screenshot-based) disagree with axe on some runs (it failed contrast in B-t1 where axe found none): treat them as impressions.

## 7. Where B and C differ from A

- **B vs A.** B costs about 1.9× (T1) and 1.9× (T2) and takes about 1.9× / 2.5× longer: the session builds, runs the review (28–35 turns for T1 against 10–11), and edits. T1 mechanical results improve in the direction of the review's rules (hit targets, contrast, labelled controls). On T2 nothing mechanical improved, and Save became always enabled (a regression against A/C/C2 on "unsaved changes"). Both B runs reported "no Blockers" and listed open Notes and "not checked: contrast, keyboard in a real browser": the review cannot run a browser here.
- **C vs A.** No difference to explain: the skill was not called in any C run. C's T1 runs include the worst axe result (C-t1-1) and one of the best (C-t1-2): that is run-to-run spread, not a skill effect.
- **C2 vs A and B.** Calling the skill added about 30–50% cost over A (B: about 90%). T1 mechanical results look like B's (0 small targets in both runs; one run with no axe findings, one with 17 contrast nodes). T2 identical to A.
- **Spread between runs is as large as the spread between arms** (for example A-t1-1 against A-t1-2 on small targets, 20 of 26 against 0 of 9; C-t1-1 against C-t1-2 on axe, 4 against 1).

## 8. For the SUPERVISOR: the blind set

- Screenshots, 1280 × 800: **`/tmp/playwright-mcp/greenfield/`** (`INDEX.txt` explains the files). T1: 8 outputs × (`normal`, `detail`); T2: 8 outputs × (`normal`, `error`, `saved`). Labels are random letters per task (`T1-K`, `T2-P` …).
- **Please rank each task's 8 outputs before opening the mapping file.** Mapping (label → run → arm): **`/tmp/greenfield-mapping/mapping.json`**, a separate local file. Nothing here lets you tell the arm from the screenshot name.
- If your ranking disagrees with the mechanical or model results above, trust your ranking for the "look" question and the mechanical tables for accessibility; send the ranking back and the recommendation in section 1 is updated.

## 9. Limits

- **Small sample.** Two runs per arm per task, one model (Opus 5.5), two tasks, one session per run. Run-to-run spread is as large as arm-to-arm spread. No percentages.
- **One reviewer family.** The reviewer is Claude (Sonnet); builder and reviewer share a family. The reviewer saw screenshots only.
- **Script limits.** States are reached by text heuristics (the first *degraded* server, an e-mail input, the "save" button); every state was reached in all 16 runs. The small-target count includes every visible interactive element, so one clickable row control can count many times. axe-core cannot see everything. The harness had three bugs found and fixed before the final numbers (an e-mail toggle typed into as if it were the address field, an Enter key without its text, and a focus measure that could not fail); all runs were re-measured with the final script. The visible-focus measure still does not discriminate.
- **No arm saw its own screen** (no browser, no dev server), so `ui-review`'s runtime evidence step could not run; B reviewed from source and said so.
- **`ui-review` in a greenfield folder** has no `docs/design-language.md` to rank above its references: its value here is the vendored rule sets and the review format, not atc's design language. That is the situation a new project outside atc would have.
- **Mobile** was not a criterion. No state other than the listed ones was measured.
- **Skill invocation is part of the result.** C's skill did not fire on a Korean, short prompt; with another prompt it might. The survey did not test that.

## 10. Reproducing

Scaffold and prompts as in sections 2–3; per run: copy the scaffold (without `node_modules`, then hard-link it), add the arm's files, `git init` and commit, then `claude -p "<prompt>" --setting-sources project --model claude-opus-5-5 --permission-mode acceptEdits --allowedTools "Read Write Edit Skill Bash(npm run build:*) …" --disallowedTools "Skill(design) Skill(design-sync) Skill(dataviz) WebFetch WebSearch Task" --max-budget-usd 3 --output-format stream-json --verbose`. The scripts lived in the job's scratch folder and are not kept in the repository; the numbers above are the record.
