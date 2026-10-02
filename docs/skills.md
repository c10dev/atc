# Skills, sub-agents and the rulebook: what atc has and how to change it

**English** · Korean guide for the SUPERVISOR: [docs/guide/skills.md](guide/skills.md) (DOCS tab, 참고)

> Reference, not a design draft. Every fact below was read from the files on `origin/main` at commit **`eb810e6`** (2026-10-01): paths exist, routing lines are quoted from the file that holds them, endpoint names come from the server code. Anything not built is marked **planned** and is collected in section 9. The research behind it stays as written: [research/skill-rulebook.md](research/skill-rulebook.md) (ATC-281) and [research/control-skills.md](research/control-skills.md) (ATC-292).

## 1. What a skill, a sub-agent and a checklist are

- **Skill**: a folder with a `SKILL.md` (frontmatter `name`, `description`, then the steps). A session opens it with the `Skill` tool, so its body enters the context only then.
- **Sub-agent**: a file `agents/<name>.md` that a session starts with the `Agent` tool in a fresh context, with its own tools and model. Only its answer comes back.
- **Rulebook checklist**: a skill for one abnormal situation, in the `atc-rulebook` plugin (`rulebook/`). The steps repeat rules that already exist in a manual; they do not add rules.
- **Control `/tick`**: each control session's loop procedure (a skill named `tick` in that session's folder), started by `/loop`.

## 2. Inventory

### 2.1 Project skills and sub-agents in the atc repository (root `.claude/`)

| Item | Kind, path | Called by whom, when (the routing line) | Source, licence | Tier to change | Added by |
|---|---|---|---|---|---|
| `atc-task` | project skill, `.claude/skills/atc-task/SKILL.md` | Team sessions and ENGINEERING when they take an ATC issue. `description`: "Linear ATC 이슈 하나(ATC-n)를 atc 저장소에서 구현해 PR로 올리고, 일을 맡긴 세션에 보고한다. "ATC-n 진행"처럼 ATC 이슈를 맡았을 때 쓴다." It is the router for the items below | atc | `user` | 8101ca7 (2026-09-27) |
| `diagnosing-bugs` | project skill, `.claude/skills/diagnosing-bugs/SKILL.md` and `scripts/hitl-loop.template.sh` | `atc-task` section 3: "FLIGHT가 버그·실패하는 테스트·회귀이면 코드를 바꾸기 전에 Skill 도구로 `diagnosing-bugs`를 부른다." The file's own `description` says "Called from atc-task section 3" | [mattpocock/skills](https://github.com/mattpocock/skills) `skills/engineering/diagnosing-bugs/`, commit `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`, MIT. Modified: header, `description`, glossary line | `user` | ATC-282, cf46f76 |
| `ui-review` | project skill, `.claude/skills/ui-review/SKILL.md` + `references/web-interface-guidelines.md`, `references/feel.md` | `atc-task` section 5: "화면 FLIGHT(`web/`나 ANNUNCIATOR 화면을 바꾸는 FLIGHT)는 PR 전에 Skill 도구로 `ui-review`(mode `diff`)를 부른다(ATC-293, …)" `audit` mode for one tab. Its output block goes into the PR body next to the section 5 checklist of [design-language.md](design-language.md). It also reads [design-taste.md](design-taste.md) as a softer third layer (ATC-326): taste findings are Should-fix or Note, never a Blocker, cite the point number only, and a conflict with the design language is listed, not applied | `SKILL.md` is atc's. The two reference files are vendored: [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) `AGENTS.md` at `e3d624baaf29dc1fc645aff3e38f03e564d2d6b1` (MIT) and [jakubkrehel/make-interfaces-feel-better](https://github.com/jakubkrehel/make-interfaces-feel-better) at `35545ea1512ad59fa463e6b1f95ca9c052981fe6` (MIT). Rules that clash with the design language are marked `CONFLICT` and not applied | `user` | ATC-293, 9163b77; taste layer ATC-326 |
| `ui-review` runtime step (layout stability) | the "Runtime step" section of `.claude/skills/ui-review/SKILL.md` and the probe `.claude/skills/ui-review/references/layout-probe.js` (plain browser JS, run with the Playwright MCP `browser_evaluate`; no dependency) | inside `ui-review`, in `diff` and `audit` mode, **early**: "once the screen renders, before polishing". It opens the screen, clicks each view control (tab, filter, chip, sort, row, detail) and reports elements that moved or resized by 1 px or more, with a likely cause and a fix | atc's own; no third-party source | `user` | ATC-311 |
| `test-server` | project skill, `.claude/skills/test-server/SKILL.md` and `testserver.mjs` (`start`, `stop <dir>`, `run -- <cmd>`) | `atc-task` section 5: end-to-end checks open it by name instead of the hand-written 7702 recipe. It picks a free port in 7702-7799 (atomic lock, so two FLIGHTs can run at once), a fresh `atc-ts-*` state folder, `ATC_GITHUB=off`, kills only by saved PID (checked against `/proc/<pid>/environ`) and always removes the folder and lock. A request for 7700 or the production state folder exits 2 `refused` | atc's own; no third-party source | `user` | ATC-357 |
| `codebase-locator` | sub-agent, `.claude/agents/codebase-locator.md` (tools `Grep, Glob`, model `sonnet`) | `atc-task` section 3: "어디에 있는지, 어떻게 도는지 찾으려고 코드를 넓게 읽기 전에 `codebase-locator`(경로만 돌려줌)와 `codebase-analyzer`(`file:line`으로 설명) sub-agent에 찾기를 맡기고, 메인 컨텍스트에는 그 결과만 둔다." | [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) `.claude/agents/`, commit `99abe673498cf8bdcd5f989aebe9406a27185b3b`, Apache-2.0. Modified: `tools` (no `LS`), attribution note | `user` | ATC-282, cf46f76 |
| `codebase-analyzer` | sub-agent, `.claude/agents/codebase-analyzer.md` (tools `Read, Grep, Glob`, model `sonnet`) | same line as above | same source and commit, Apache-2.0 | `user` | ATC-282, cf46f76 |

Rules budget (ATC-361): root `CLAUDE.md` and `atc-task` are loaded in every team session, so they have byte budgets in `deploy/rules-budget.json` and may not repeat each other (`deploy/rules-budget.test.mjs`, part of `npm test`). Rules that are needed only sometimes live in `docs/rules.ko.md`. Raising a budget is a `user`-tier change.

Precedence when they disagree (`atc-task`): root `CLAUDE.md` > `atc-task` > the vendored skills and agents. Root `.claude/` is tier `user` for every path under it (`deploy/landing-tier.mjs`: `^\.claude\/`), so the SUPERVISOR merges every change here.

### 2.2 The rulebook plugin `atc-rulebook` (`rulebook/`)

`rulebook/.claude-plugin/plugin.json` (`name: atc-rulebook`, version `0.1.0`). Bodies are English (D1). Every file in `rulebook/` is tier `user` (`deploy/landing-tier.mjs`: `^rulebook\/`, ATC-286). All four skills are at `rev 2026-10-01.1`, added by ATC-290 (f878869).

| ID, path `rulebook/skills/<id>/SKILL.md` | For | Called by whom, when | Owner (the manual it copies) |
|---|---|---|---|
| `qrh-01-lost-comms` | a team's CAPTAIN who cannot reach OCC or TOWER (SendMessage fails or no reply) | **Planned**: the CREW BRIEFING names it. Today only its `description` ("Use when you are an AIRCRAFT CAPTAIN and your messages to OCC or TOWER fail…") | CREW BRIEFING, [ATC-258 F4](research/lost-comms-and-contingency.md) |
| `qrh-02-stalled` | OCC or TOWER sees health `STALLED` or `RESUME` | **Planned**: the server names it. Today its `description` | `occ/` manual `following.md`, `controller/` manual, [fleet.md](fleet.md) 8.8 |
| `qrh-03-undelivered` | OCC: a send of a FLIGHT PLAN, RECALL or CREW CHANGE returned `success:false`, or one is overdue with no READBACK | same | `occ/` manual `flight-plan.md`, `crew-change.md` (ATC-183, ATC-251) |
| `qrh-05-arrival-missing` | OCC reads an ARRIVED report, or the brief's `arrivalMissing` lists a merged FLIGHT with `due: true` | same | `occ/` manual, `/tick` steps 1 and 2 (ATC-124, ATC-169) |
| `qrh-04-go-around` | **reserved**: GO AROUND still lives in root `CLAUDE.md`; no skill file exists | n/a | n/a |

Source: atc's own manuals. Nothing vendored. Format and rules are in [rulebook/README.md](../rulebook/README.md).

### 2.3 Control sessions (each folder's own `.claude/`)

| Session, folder | `/tick` skill | Started by | Sub-agents | Tier to change |
|---|---|---|---|---|
| TOWER, `controller/` | `controller/.claude/skills/tick/SKILL.md` (+ `SKILL.en.md`). Step 0 is `node atcctl.mjs tick tower` | LAUNCH prompt `/loop 3m /tick` (`CONTROL_SESSIONS` in `server/session-control.ts`) | none | `flagged` |
| OCC, `occ/` | `occ/.claude/skills/tick/SKILL.md` and five procedure files `briefing.md`, `flight-plan.md`, `crew-change.md`, `schedule.md`, `following.md` (each with an `.en.md`). The manual's "절차 파일" table says when to Read each one | `/loop 10m /tick` | none | `flagged` |
| CROSSCHECK, `crosscheck/` | `crosscheck/.claude/skills/tick/SKILL.md` | `/loop 10m /tick` | none | `flagged` |
| MCC, `mcc/` | `mcc/.claude/skills/tick/SKILL.md` | `/loop 5m /tick` | **`inspector`**, `mcc/.claude/agents/inspector.md` (model `opus`, tools `Read, Grep, Glob, Bash`, guarded by `inspector-guard.mjs` and `read-guard.mjs`). `mcc/CLAUDE.md`: "INSPECTION이 필요한 PR마다 Agent를 `subagent_type: inspector`로 부른다." `agent-guard.mjs` lets MCC call no other sub-agent (ATC-135, 931d66b) | `flagged` (guards `user`) |
| REVIEW, `review/` | `review/.claude/skills/tick/SKILL.md` | `/loop 10m /tick` | none | `flagged` |

- Every `/tick` and procedure file has a Korean original and an English `*.en.md` translation. Step 0 of the OCC, CROSSCHECK, MCC and REVIEW `/tick` is `atcctl manual check` (section 7). TOWER's step 0 is the composite `atcctl tick tower` (ATC-297, section 9).
- DUTY (`duty/`) has no `.claude/` folder and no skill.
- Tier for these folders: `deploy/landing-tier.mjs` `FLAGGED` (`^(controller|occ|crosscheck|review|mcc|dispatch|duty)\/`); a file named `*guard*.mjs` is `user`.

## 3. How they are organised

Three layers (survey [5.1](research/skill-rulebook.md)):

| Layer | Holds | Where |
|---|---|---|
| Limitations | what must never happen and code can check | guards and hooks (`*guard*.mjs`, `hooks/`) |
| Memory items | at most about 10 one-line rules for every turn, or irreversible ones | the top of `CLAUDE.md` (**planned**: the block does not exist yet) |
| Procedures | everything with a triggering condition | skills: `atc-task` and the vendored ones today, the rulebook for abnormal situations |

- **ID rule** `<kind>-<nn>-<slug>`, kind `sop` (every flight), `cl` (normal checklist), `qrh` (abnormal or emergency), `mel` (a capability is missing). A number is never changed or reused, even if the skill is deleted. Built today: only `qrh`.
- **Revision**: a string `rev <date>.<n>` in the skill's title line, changed when its steps change.
- **Format of a checklist** (one screen): frontmatter `name` and a narrow `description` ("Use when …"); title line with ID, `rev` and `owner`; `Condition`; numbered `Steps`; `Stop and report if` (Expected / Found / Why it matters); `End state`; `Report line`.
- **Language D1**: checklist bodies are English today, because sessions talk to each other in English. The Korean summaries are in `rulebook/README.ko.md` and the DOCS guide. The survey lists the language as a SUPERVISOR decision (D1), so the files follow it provisionally.

## 4. How a skill reaches a session

| Item | How it reaches a session | State |
|---|---|---|
| `atc-task`, `diagnosing-bugs`, `ui-review`, `test-server`, `codebase-*` | They live in the atc repository's `.claude/`, so they come with every atc checkout and every STAND (worktree) of it. A session working in another repository does **not** load them ([research 2.3](research/skill-rulebook.md): a background AIRCRAFT "loads that repository's `CLAUDE.md` and `.claude/skills`, not atc's") | built |
| Control `/tick` and `inspector` | Each control session is started in its own folder (`CONTROL_SESSIONS` in `server/session-control.ts`) and reads that folder's `.claude/` | built |
| `rulebook/` (`atc-rulebook`) | **Not loaded by any session.** `server/session-control.ts` has no `--plugin-dir`. Until LAUNCH passes `--plugin-dir <atc>/rulebook`, the files only exist in the repository; called by name they would be `atc-rulebook:<id>` | **planned** |
| Rules for AIRCRAFT at other AIRPORTs | Only the CREW BRIEFING text travels with them (survey 2.3, 5.3) | built (briefing); the plugin route is planned |

## 5. How the right procedure is opened

- **By name, from a routing line.** The session is told, in text it reads (`atc-task`, the brief, a manual), to call a named skill. Every built item in 2.1 and the `inspector` work this way. A routing line is a sentence in a manual: to add a skill the session must be told its name there.
- **By `description` matching** is only a fallback. ATC-281 measured it: with the alert text naming the checklist the session opened the right skill 16 of 16 times (also with 88 skills installed); when it had to choose from a long list by description alone it did 4 of 16 ([research 4.2](research/skill-rulebook.md)). So the server, not the model, should name the checklist.
- **`qrhOf(code)` and `qrh.named` (shadow only).** `server/qrh.ts` is the one table from the server's existing condition codes to checklist IDs (`STALLED` → `qrh-02-stalled`; `undelivered` and `overdue` → `qrh-03-undelivered`; `GO AROUND` → `qrh-04-go-around`; `arrivalMissing` → `qrh-05-arrival-missing`). Each time the server first sees a condition it records one FLIGHT RECORDER line `{ kind: "qrh", op: "named", id, code, subject, … }`. **No text names a checklist yet** and `qrh-04-go-around` has no skill file. Details: [radio.md](radio.md) "QRH shadow as built (ATC-288)".

## 6. Measurement

| What | Where | What it counts |
|---|---|---|
| Conditions the server would name | `GET /api/qrh/named?since=<ISO or ms>` (`server/qrh-run.ts`) | the `qrh.named` lines (default last 24 h): `{ since, count, lines }` |
| Skill and sub-agent calls | `GET /api/skills/usage?days=N` (`server/skill-calls-run.ts`, ATC-289) | per day from 2026-10-01 in `skill-usage.jsonl`: `skills` (calls by name, with the plugin prefix), `agents` (calls by `subagent_type`), `bySession`, `sessions`; today is computed on the request. Names and times only, no message text. Counts come from the `Skill` and `Agent`/`Task` tool calls in transcripts |
| **Named → opened rate** | same route, field `qrh`: `{ named, opened, openedOther, notOpened, noTranscript, openedRate }` | of the `qrh.named` lines, how many were followed by a `Skill` call to that id within the same turn (at most 10 minutes). `openedRate = opened / (named − noTranscript)`. All zero until `qrh.named` lines exist, and until the rulebook is loaded nothing can be opened. See [readability.md](readability.md) "Skill-call reader as built (ATC-289)" |
| ATC-282 pilot (`diagnosing-bugs`, `codebase-locator`, `codebase-analyzer`) | same route: `skills["diagnosing-bugs"]`, `agents["codebase-locator"]`, `agents["codebase-analyzer"]` and `bySession` | how often and by which team the pilot items were called each day. The repository holds **no target number** for the pilot; the counts say whether they are used, not whether they helped |

Not verified: whether a `/loop … /tick` or a typed slash command shows up as a `Skill` call in transcripts, so `skills["tick"]` may be missing for the control sessions. There is no screen for any of these; the endpoints are the only view.

## 7. Revision and drift

- **`rules-drift` hook** (`hooks/rules-drift.mjs`, ATC-42; [hooks/README.md](../hooks/README.md)): on a running session's next turn it injects the diff of a changed rules file. atc's own `.claude/settings.json` wires it (ATC-295) for every session in the atc checkout or a STAND (`SessionStart` → `start`; `UserPromptSubmit` and `PostToolUse` → `check`), watching `CLAUDE.md,AGENTS.md,docs/design-language.md,.claude/skills/atc-task/SKILL.md` against `origin/main`. **`diagnosing-bugs`, `ui-review`, the agents and `rulebook/` are not watched.** FLEET shows "RULES current" or "RULES 미확인" per live session.
- **`atcctl manual check` / `manual ack`** (`controller/atcctl.mjs`): for a control folder it hashes `CLAUDE.md`, `<folder>/.claude/skills/tick/SKILL.md` and the Korean procedure files in that tick folder; `CHANGED` makes the session reread them and `manual ack`. It does **not** cover `rulebook/` (**planned**, control-skills work order 14).
- **`THIRD_PARTY_NOTICES.md`** is the record of vendored files: path, source, commit, licence, what changed, with the licence texts. Updating one is a PR that changes the commit there and shows the upstream diff.

## 8. How to add or change one

1. **Pick the kind and the ID.** A situation with a trigger → a rulebook checklist (`qrh-<next number>-<slug>`; never reuse a number; the owner is the manual it copies). A method for every FLIGHT of one kind → a project skill. A read-only helper in a fresh context → a sub-agent.
2. **Write the format** (section 3): narrow `description`, ID, `rev`, `owner`, `Condition`, `Steps`, `Stop and report if`, `End state`, `Report line`. Copy rules from a manual; a new rule is decided in the manual first.
3. **Add the routing line by name** where the session will be told to call it (`atc-task`, a control manual or `/tick`, the brief). Do not rely on `description` matching (section 5). For a rulebook checklist the server text should name it: add the code to `qrhOf` and measure first (**planned** wiring).
4. **If it is vendored** (check each, in this order): the licence allows it (MIT, Apache-2.0 so far); pin the upstream commit; put an attribution header in the file that says what was modified and that atc's rules win; add the row and licence text to `THIRD_PARTY_NOTICES.md`; mark every rule that clashes with atc's rules `CONFLICT` and leave it unapplied for the SUPERVISOR instead of resolving it yourself.
5. **Tier and who merges.** Root `.claude/` and `rulebook/` are `user`: the SUPERVISOR merges. A control folder is `flagged`. Run `node -e 'import("./deploy/landing-tier.mjs")…'` or read the PR's tier line, and write it in the PR body.
6. **How to measure it**: a routing-line skill or agent shows in `GET /api/skills/usage`; a checklist also needs a code in `qrhOf` so `qrh.named` has a denominator.
7. **Revision**: bump `rev` when steps change. For a skill that sessions should notice mid-run, the hook or `manual check` must watch its file (today none of the above do; section 7).

## 9. Built and not built yet

**Built** (on `origin/main` at `eb810e6`): the five project items of 2.1, the four rulebook skills (not loaded), the control `/tick` skills and `inspector`, `THIRD_PARTY_NOTICES.md`, the landing-tier rule for `rulebook/`, `qrhOf` and `qrh.named` (shadow), the skill-call reader and `GET /api/skills/usage`, the `rules-drift` wiring for atc's own sessions, `atcctl manual check`, and the composite `atcctl tick tower` with `GET /api/tick/:role` (ATC-297, TOWER first).

**Not built yet** (planned; do not rely on it):

| Work | Where it is tracked |
|---|---|
| Load the rulebook: LAUNCH passes `--plugin-dir <atc>/rulebook`, the CREW BRIEFING line | [research/skill-rulebook.md](research/skill-rulebook.md) section 6 item 7 |
| Server texts that name a checklist (`Checklist: qrh-03-undelivered`): brief fields, send-guard replacement text, TOWER LOG; after the shadow rate holds | same, item 6 |
| `qrh-04-go-around` and the memory-items block at the top of `CLAUDE.md` | same, item 5 |
| `manual check` and `rules-drift` covering `rulebook/` and the skill files | same, item 8; [control-skills.md](research/control-skills.md) item 14 |
| Normal checklists (`cl-*`, `sop-*`) split from `atc-task`; MEL (`mel-*`) design | skill-rulebook items 9 and 10 |
| Composite tick for roles other than TOWER, OCC manual slim-down (the `/tick` becomes a pointer that runs `atcctl tick occ`), MCC composite | [ATC-297](https://linear.app/vocado/issue/ATC-297), [ATC-298](https://linear.app/vocado/issue/ATC-298), [ATC-292](https://linear.app/vocado/issue/ATC-292) section 6 |
| UI A/B: the same screen task built three ways | [ATC-296](https://linear.app/vocado/issue/ATC-296) |
| `qrh-release-refused`, `qrh-send-failed`, `sop-*` skills, CROSSCHECK and REVIEW checklists, DUTY procedure documents | [control-skills.md](research/control-skills.md) section 6 items 5, 6, 11, 13 |
| A screen for skill usage (today the endpoints are the only view) | [readability.md](readability.md) "Not built yet" |

Linear issues behind the built items: [ATC-281](https://linear.app/vocado/issue/ATC-281) (survey), [ATC-282](https://linear.app/vocado/issue/ATC-282) (pilot), [ATC-286](https://linear.app/vocado/issue/ATC-286), [ATC-288](https://linear.app/vocado/issue/ATC-288), [ATC-289](https://linear.app/vocado/issue/ATC-289), [ATC-290](https://linear.app/vocado/issue/ATC-290), [ATC-293](https://linear.app/vocado/issue/ATC-293), [ATC-295](https://linear.app/vocado/issue/ATC-295).
