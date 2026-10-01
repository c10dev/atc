# Survey: skills as atc's rulebook

**English** · [한국어](skill-rulebook.ko.md)

> Status: SURVEY for [ATC-281](https://linear.app/vocado/issue/ATC-281), 2026-10-01, Claude Code 2.1.286. Docs only. Nothing here changes a manual, skill, guard, hook, setting or session; no real session was messaged, stopped, launched or compacted; `~/.local/state/atc/` was not touched. Section 5 is a recommendation for the SUPERVISOR; nothing in it is decided or built.

## Question

atc borrows aviation's words (CLEARANCE, READBACK, GO AROUND, NORDO) but keeps most of its rules as prose that a session reads once at boarding: the root and folder `CLAUDE.md`, the CREW BRIEFING, and six skills. Aviation splits its manuals by *when* they are used. **Should atc make skills its rulebook and response manual, a set of named procedures that a session opens when a defined condition occurs, and if so, how?**

## Method and limits

- **Aviation (section 1)** is written from the author's knowledge of public documents, named by document and chapter as in [ATC-258](lost-comms-and-contingency.md). No web page was fetched for it and the ICAO texts are not freely published. **Check any reference against the current edition before quoting it** in a manual.
- **atc facts (section 2)** are read from `origin/main` at `e5ebb70`. Token figures use the ratios measured in [ATC-274](control-context.md) (root `CLAUDE.md` 15.9 KB is 7.1 k tokens, so about 0.44 tokens per byte of these Korean-heavy files). They are estimates, not a new measurement.
- **Claude Code mechanics (section 3)** come from the official docs fetched on 2026-10-01 by a helper agent through a summarising fetch tool, so exact numbers are *as relayed*, and from the scratch runs of section 4.
- **Reference skills (section 1.2)**: the eleven public repositories named in the issue were cloned and every claim was checked at `HEAD`. All `HEAD`s equal the pre-read commits (no drift). Wording that differed is marked CHANGED.
- **Experiments** (section 4.2) ran in a scratch folder with fake procedures and a fake `atcx` command, on Haiku 4.5, a single turn each, 2 repetitions. It is a small sample and a harder test than the real one on model strength; read it as "does the mechanism work", not as a rate.
- **Spend.** The 80 scratch runs of section 4.2 cost 2.22 USD (summed `total_cost_usd`); a smoke run, the plugin check and one listing probe add about 0.1 USD. The two helper agents (about 217 k tokens in total) and this session are an estimate, not a measurement: about 4 to 5 USD in all (the target was 5).
- **Public repo.** Other AIRPORTs are described generically. No transcript text was used, no screenshots.

## 1. Aviation's manual system, mapped to atc

### 1.1 What to borrow

| Aviation document or device | What it is for | atc today | Gap |
|---|---|---|---|
| **Operations Manual** parts A (general), B (aircraft operating), C (route and aerodrome), D (training) (ICAO Annex 6 Part I, operations manual contents; EASA ORO.MLR.100; 14 CFR 121.133). Approved by the authority; changed through a **revision service**, **temporary revisions** and a **list of effective pages** | One owned, approved set of rules with a known revision | Root `CLAUDE.md` (general), folder `CLAUDE.md` per control role, `docs/` (route and airport facts) | Revision is a file hash (`atcctl manual check`, `rules-drift`); no revision ID, no effective date, no temporary revision |
| **AFM limitations** (14 CFR 25.1581; the AFM is part of the type certificate) | Hard limits that are not advice | Guards (`*guard*.mjs`, `hooks/kill-guard.mjs`): fail-closed code | Correctly code, not prose. Keep it so |
| **FCOM** (systems and the *why*), **FCTM** (technique) | Background and good practice; read in training and when in doubt | `docs/*.md` design documents (not loaded); `atc-task` sections as technique | Fine: never auto-loaded |
| **SOP** and **normal checklists** (14 CFR 121.315 cockpit check procedure; challenge-response or **do-verify** after a flow) | Every flight, same order, short | `atc-task` sections 0 to 8; `/tick` bodies; CLAUDE.md "검증", "git과 PR" | Long prose with the checklist items inside. No separate "before push" or "arrival report" list |
| **QRH** abnormal and emergency checklists (Boeing QRH, Airbus ECAM actions): condition statement, ordered steps, **read-do**, end state ("land at the nearest suitable airport"), opened when the alert fires | A crew does not invent a procedure in the middle of a failure | Nothing named. GO AROUND is in CLAUDE.md "교신"; RECALL, undelivered and overdue are in `occ/.claude/skills/tick/*.md`; NORDO is a word in `controller/CLAUDE.md` | The gap this survey is about (section 2.2) |
| **Memory or recall items** (a few steps flown from memory, then the checklist) | Seconds that cannot wait for a book | None named. The nearest are one-line rules ("never `pkill`", "READBACK format") inside `CLAUDE.md`, and the guards | Decide the line (option 5) |
| **ECAM or EICAS**: the system shows the failure *and* the procedure, so the crew does not search the QRH | No search step, no guessing which checklist | The brief names a code (`undelivered`, `overdue`, `arrivalMissing`, FOLLOWING issue codes, health `RESUME`, `STALLED`), NEEDS YOU and the BELL show the failure | The failure is shown; the procedure is not named |
| **MEL / CDL / MMEL** (14 CFR 91.213; Annex 6): dispatch with an item inoperative under stated (O) operations and (M) maintenance procedures and a rectification interval | A known defect is *dispatched with*, by rule, not rediscovered | AOG with `until` and RETURN for an AIRCRAFT ([fleet.md](../fleet.md) 8.6); `ATC_GITHUB=off` for test servers | No procedure for "this capability is missing" (no `gh`, Codex rate-limited, a review lane down) |
| **Position relief briefing** checklist | The leaving position hands over open items | `restartSafetyOf`, `schedule wip`; F8 in ATC-258 | Separate work, see [ATC-258](lost-comms-and-contingency.md) section 7 |
| **Checklist philosophy** (Degani and Wiener, NASA CR-177549, 1990, "The Normal Checklist"; and "Cockpit checklists: concepts, design, and use", Human Factors, 1993) | Short, in the order of the task, items the crew can verify, few checklists, a stated owner | — | Applies to the format in section 5 |

Three points carry over to atc:

1. **Manuals are split by when they are used**, and the abnormal manual is opened *by an event*, not read in advance.
2. **A QRH item has a fixed shape**: condition, ordered steps, an end state, and what to report. The crew follows it; it does not reinterpret it.
3. **The system names the procedure** (ECAM). The crew is not asked to find the right book while the alert is on.

### 1.2 Reference skills, checked at the current commit

Every `HEAD` equals the commit the pre-reader recorded. Skill counts are `SKILL.md` files.

| Source (commit) | Verified | Corrections or additions | Use for atc |
|---|---|---|---|
| [mattpocock/skills](https://github.com/mattpocock/skills) (`d81f3a1`, MIT, 36 skills, 30 outside `skills/in-progress`) | `.agents/invocation.md` ("Model-invoked vs user-invoked": user-invoked descriptions are written for humans, model-invoked keep "Use when…" triggers); `skills/engineering/diagnosing-bugs/SKILL.md` has Phases 1 to 6 and "Do not proceed until you have reproduced and minimised"; `ask-matt` is a router and is itself user-invoked (`disable-model-invocation: true`); `Call the Skill tool with "X"` is a written convention; `skills/misc/git-guardrails-claude-code` is a `PreToolUse` hook whose script does `exit 2`; `.changeset/` (14 pending), `.agents/adr/` (2), `.out-of-scope/` (3 files) and `skills/productivity/writing-for-agents` exist | A user-invoked skill cannot be called by another skill; a step that needs one has to tell the human to run it. It is one of two repositories with real versioning (changesets and `CHANGELOG.md`; the other is noodle) | Revision trail and "rejected procedures" memory (`.out-of-scope/`); hard limits in a hook; gated phases with "done when" |
| [poteto/noodle](https://github.com/poteto/noodle) (`82d2921`, MIT) | `schedule:` frontmatter says *when* a skill runs (e.g. `.agents/skills/schedule/SKILL.md`); `stage_message` `blocking: true` (or omitted) stops the loop's auto-advance, `blocking: false` advances and still forwards the message (`.agents/skills/quality/references/stage-message-schema.md`); 29 skills in `.agents/skills` | Counting `skills/` and `examples/` gives about 36. Has `CHANGELOG.md` and `VERSION` | Trigger separate from content; a blocking verdict as the end state |
| [poteto/brainmaxxing](https://github.com/poteto/brainmaxxing) (`ec4d8e4`, MIT, 6 skills) | `reflect → ruminate → meditate`; `brain/principles.md` links `encode-lessons-in-structure`; meditate runs a read-only Auditor then Reviewer ("All agents are read-only") | No versioning | Lessons go into structure; read-only review before a rule changes (compare SAFETY REPORT, [safety-report.md](../safety-report.md)) |
| [poteto/verification-skill-example](https://github.com/poteto/verification-skill-example) (`d5abe70`) | Per-feature files under `.cursor/skills/verify-atlas/references/features/` (about 35) with an index `README.md` | **CHANGED**: the four headings are `Sub-features`, `How to get to it (user POV)`, `Driving it with control-atlas`, `Gotchas` (not "How to reach / drive it") | Fixed headings plus an index used as a sweep order |
| [poteto/how](https://github.com/poteto/how) (`b1ef429`) | One skill that explains how something works in a codebase | — | None |
| [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) (`99abe67`, Apache-2.0; 27 commands and 6 agents in `.claude/`, 0 skills) | `create_plan` has "Automated Verification" and "Manual Verification" per phase and a pause for human confirmation; `implement_plan` has "Expected / Found / Why this matters" after "STOP and think deeply"; `create_handoff` has fixed frontmatter fields and `resume_handoff` says "Never assume handoff state matches current state"; `codebase-analyzer` requires `file:line`, `codebase-locator` returns paths | — | Fixed-field handoff the receiver verifies; STOP-on-mismatch block |
| [humanlayer/skills](https://github.com/humanlayer/skills) (`ca7c808`, MIT, 6 plugins), [advanced-context-engineering-for-coding-agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents) (`f2bc7ae`), [rpi-coordination-template](https://github.com/humanlayer/rpi-coordination-template) (`90a4e7b`), [dexhorthy/slopfiles](https://github.com/dexhorthy/slopfiles) (`f7a350a`, MIT, 3 skills) | 40 to 60 % context utilisation target; `improve-claude-md` uses `<important if="condition">` blocks; distribution through `.claude-plugin/marketplace.json` | The template's README warns that the Workspaces feature may replace it | Conditional blocks inside a memory file; plugin marketplace as the distribution form |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) (`d16ebe6`, MIT, 14 skills) | `animate` and `review-animations` share "Initial Response" and "Operating Posture"; the reviewer says "Default to flagging; approval is earned" with a Block/Approve verdict; the same easing and duration tables recur across five or more skills; no version or owner metadata | **CHANGED**: only the reviewer cites `STANDARDS.md` (the builder carries its own tables plus `RECIPES.md`); `improve-animations` says a model with "zero context" must be able to run the plan but there is **no literal "STOP and report"** (it says stop and wait for the user to select findings) | The counter-example: copied tables drift |

**MEL gap confirmed.** None of the eleven repositories has a skill that is a procedure for working with a missing tool or degraded capability. The nearest are fallbacks inside a single skill. atc has to design its MEL itself (option 6).

**Patterns to test against atc** (decisions are in section 5): the description is the trigger and the body loads on demand; invocation mode is a safety choice, and hard limits live in hooks and code; steps end in "done when" and a stop-on-mismatch rule; single-source wording with a revision trail; lessons go into structure; handoffs have fixed fields the receiver verifies. **Avoid**: skill sprawl (noodle 29, Pocock 30 promoted), agents rewriting their own procedures, "never block on the human" (wrong for TOWER and OCC).

## 2. atc today

### 2.1 Rule inventory and load cost

Sizes are bytes of the Korean original (the `*.en.md` translations are not loaded). Tokens use 0.44 tokens per byte (ATC-274: root 7.1 k, TOWER 6.4 k, OCC 8.4 k measured).

| Source | Size | ≈ tokens | Loaded | What kind of rules |
|---|---|---|---|---|
| Root `CLAUDE.md` | 15.9 KB | 7.1 k (measured) | **always**, every session started in the repo (AIRCRAFT working in atc, control folders, DUTY) | SOP (work place, git and PR, language, terms), normal checklist ("검증"), limitations ("운영": no prod restart, `pkill`), the GO AROUND procedure and READBACK formats ("교신"), background ("코드") |
| `controller/CLAUDE.md` (TOWER) | 14.4 KB | 6.4 k (measured) | always, in that folder | role, tools, judgement criteria, messages |
| `occ/CLAUDE.md` | 19.9 KB | 8.4 k (measured) | always | role, review criteria, TAIL ASSIGNMENT, a list of procedure files |
| `mcc/CLAUDE.md` · `crosscheck/CLAUDE.md` · `review/CLAUDE.md` · `duty/CLAUDE.md` | 11.0 · 11.9 · 6.2 · 21.0 KB | ≈ 4.8 k · 5.2 k · 2.7 k · 9.2 k | always, in that folder | same shape |
| `/tick` `SKILL.md` per control role | OCC 11.9 KB, MCC 2.7, CROSSCHECK 3.4, REVIEW 1.8, TOWER 1.7 | measured per tick (ATC-274): OCC ≈ 3,200, MCC ≈ 870, CROSSCHECK ≈ 770, TOWER ≈ 440, REVIEW ≈ 310 | **body re-sent on every `/loop` tick** (ATC-274 transcripts) | the loop's SOP and normal checklist |
| OCC procedure files `occ/.claude/skills/tick/*.md` | 47.5 KB in all (`schedule.md` 27.9, `flight-plan.md` 8.2, `following.md` 5.5, `crew-change.md` 3.9, `briefing.md` 2.1) | ≈ 21 k if all were read | **on demand**: read only when a step has work (SKILL.md step text) | the nearest thing atc has to QRH and FCTM, per step, not per condition |
| `.claude/skills/atc-task/SKILL.md` | 10.8 KB | ≈ 4.7 k | when a session takes an ATC issue (model- or `/`-invoked) | SOP + normal checklist for team sessions (sections 0 to 8) |
| CREW BRIEFING (`crewBriefing`, `server/fleet.ts`) | about 2.4 KB | ≈ 0.6 k | once, pasted at LAUNCH (`claude --bg … <briefing>`, `server/session-control.ts`) | identity, complement, language, STAND paragraph, reply addresses |
| Guards and hooks | code | 0 | run by the harness, not read | limitations (fail-closed), `rules-drift` notice |
| `docs/*.md` | large | 0 | never auto-loaded | FCOM-like background |

Two numbers matter. Rules a session carries **all the time**: 7.1 k (root) plus its folder file (2.7 to 9.2 k), about 10 to 16 k, on top of the roughly 20 k of listing and plugin context that ATC-274 section 1.1 could not split. Rules re-sent **per tick**: up to 18.5 k tokens per hour for OCC. Everything situational is either inside those always-loaded files or buried in step text.

### 2.2 Abnormal situations: is there a procedure today, and was it found?

The six incidents of 2026-10-01 are [ATC-258](lost-comms-and-contingency.md) section 1 (I1 to I6). SAFETY REPORT kinds are [safety-report.md](../safety-report.md) 3.1 (`false-block`, `guard-block`, `ambiguous-rule`, `repeat-ask`; `no-rule` was left out of S0). "Found?" says whether the situation was noticed by the session or by the SUPERVISOR, from ATC-258 and the SAFETY REPORT draft; where neither says, it is **not measured**. There is no record of whether a session *opened* a procedure, because there is nothing to open.

| Situation | Procedure today (where) | Found by | Proposed |
|---|---|---|---|
| I1 OCC cannot reach an AIRCRAFT (other ACCOUNT); plans and a RECALL unsent | `dispatch undelivered` and CAUTION in `occ/.claude/skills/tick/flight-plan.md`; no rule for the *AIRCRAFT* side | SUPERVISOR | `qrh-undelivered` (OCC) and `qrh-lost-comms` (AIRCRAFT) |
| I2 APPLY NOW waits for sends, sends wait for OCC (deadlock) | none; a design rule (ATC-258 F11) | SUPERVISOR | design-review rule, not a checklist |
| I3 Background AIRCRAFT stalled on a permission prompt | the STAND paragraph of the CREW BRIEFING, `CLAUDE.md` "작업 위치" (prevention only, ATC-252); nothing for a team that *is* stalled or for TOWER reading it | SUPERVISOR | `qrh-stalled` |
| I4 `ARRIVED` reported, OCC ended before recording | tick step 1 ("record on reading", ATC-169); `arrivalMissing` | SUPERVISOR | `cl-arrived` (normal) and `qrh-arrival-missing` |
| I5 Host reboot, "Cannot fork", unwritten recovery order | none (ATC-258 F9) | SUPERVISOR | `qrh-atc-zero` (after the contingency design) |
| I6 Stale block, issue dispatched after its fix, NORDO used for a never-launched STAND | `controller/CLAUDE.md` (NORDO as a word) | SUPERVISOR | server fixes (F5, F6, F7); a `qrh-stale-block` only if the manual still misleads |
| GO AROUND | `CLAUDE.md` "교신" (the only full ordered procedure) and `atc-task` | session (it is a CLEARANCE) | `qrh-go-around`, moved verbatim |
| RECALL / NO READBACK overdue | `flight-plan.md` (OCC), `CLAUDE.md` "교신" (team) | not measured | `qrh-no-readback` (OCC), `qrh-recall` (team) |
| NORDO (dead session) | `controller/CLAUDE.md` (counts orphans), [fleet.md](../fleet.md) 8.6 | not measured | `qrh-nordo` for TOWER |
| `pkill` outage (ATC-134, 2026-09-29) | `CLAUDE.md` "검증" + `hooks/kill-guard.mjs` (a hook) | SUPERVISOR (outage) | stays a memory item + guard (option 5) |
| LIMIT / RESUME / rate limit | `following.md`, `schedule.md` (OCC stops drafting), health `RESUME` code | not measured | `qrh-usage-limit` (team and OCC) |
| BLOCKED waits | `CLAUDE.md` 교신 final-report line `BLOCKED …`, `mcc/CLAUDE.md` | not measured | folds into `qrh-stalled` |
| SAFETY REPORT `false-block` (TOWER BLOCKED with only orphan claims) | `controller/CLAUDE.md` 판단 기준 | SUPERVISOR (badge) | a rule fix; the report's `rule` field gets a checklist ID |
| SAFETY REPORT `guard-block`, `ambiguous-rule` (tier mismatch on PR #244), `repeat-ask` | the manual that was complained about | SUPERVISOR | `rule` = checklist ID plus revision; add `no-rule` once procedures exist |
| Missing capability (no `gh`, Codex rate-limited, review lane down) | AOG for AIRCRAFT only | not measured | `mel-*` skills (option 6) |

Reading the table: of 15 rows, **one** (GO AROUND) has a complete ordered procedure written for the session that needs it, and ATC-258 records that all six incidents were found by the SUPERVISOR. This repeats ATC-258's finding and adds a cause: the procedures that exist are *inside always-loaded files or inside step text*, so a session in the middle of an incident has to know which paragraph to remember.

### 2.3 How rules reach AIRCRAFT at other AIRPORTs today

- A background AIRCRAFT is started by `claude --bg -n <REG> --permission-mode … <CREW BRIEFING>` from the AIRPORT's own repository folder (`server/session-control.ts`). It loads **that repository's** `CLAUDE.md` and `.claude/skills`, not atc's. atc's `CLAUDE.md` and `atc-task` therefore do not travel with it.
- What travels is the CREW BRIEFING, a pasted text of about 2.4 KB: identity, complement, language, reply addresses, and (for background sessions) the STAND paragraph that exists *because* the rule lived only in atc's `CLAUDE.md` ([ATC-252](https://linear.app/vocado/issue/ATC-252)).
- `rules-drift` watches `CLAUDE.md` and `AGENTS.md` (`DEFAULT_FILES`, option `--files`); `atcctl manual check` hashes the control folder's `CLAUDE.md`, `SKILL.md` and tick procedure files. Neither covers a skill outside those lists.

So every cross-AIRPORT rule is either pasted into the briefing (and grows it) or absent. A skill set is a way to give those AIRCRAFT a rulebook without touching their repository.

## 3. Claude Code mechanics (version 2.1.286)

Source: official docs fetched on 2026-10-01 through a summarising tool (S = skills page, H = hooks, L = plugin loading, P = plugins reference), plus scratch runs of section 4. **V** verified, **U** unverified or undocumented.

| Topic | Finding |
|---|---|
| **V** Context per skill | Name, description and `when_to_use` are always in context, capped at 1,536 characters per skill. The body loads on invocation; sibling files load only when read. (S) |
| **V** Listing budget | The listing as a whole has a budget of 1 % of the model's context window (`skillListingBudgetFraction`, or `SLASH_COMMAND_TOOL_CHAR_BUDGET`). Over budget, **descriptions are dropped, least-used skills first; names stay listed** and the skill stays invocable by name. (S) |
| **V** Scratch run | With 8 project skills the listing shows their descriptions. With 88 project skills (8 procedures and 80 look-alike decoys) the model reported that **every project skill was listed without a description**, while a few bundled skills kept theirs (the model's account of its own context, consistent with the budget rule). The consequence is measured in section 4.2. |
| **V** Invocation | Model auto-invocation from the description, explicit `/name`, and the `Skill` tool called by name. `disable-model-invocation: true` makes a skill user-only; `user-invocable: false` hides it from the menu. Other frontmatter: `allowed-tools`, `disallowed-tools`, `model`, `effort`, `context: fork` with `agent`, `hooks`, `paths`, `argument-hint`, `arguments`, `when_to_use`, `shell`, `metadata`, `license`, `compatibility`; setting `skillOverrides`. (S) |
| **V** Once invoked | The body enters as one message and stays for later turns. Re-invoking with identical rendered content appends only a short note; different rendered content appends it again. Auto-compaction re-attaches the most recent invocation of each skill, first 5,000 tokens per skill and 25,000 tokens in all. (S) |
| **U** `/loop` re-injection | The docs say nothing about a loop. [ATC-274](control-context.md) measured the `/tick` body written again on every fire; that measurement stands, and this survey did not re-test it. |
| **V** Distribution | Precedence: enterprise, personal (`~/.claude/skills`), project (`.claude/skills`); plugin skills are namespaced `/plugin:skill`. A project skill does **not** reach a session whose working folder is another repository. A plugin loaded from a local directory is read in place at every session start; marketplace plugins are cached by version (manifest `version`, else commit SHA) and **auto-update is off by default for third-party marketplaces**; a running session keeps the old version until `/reload-plugins`. Edits to a personal or project `SKILL.md` are picked up mid-session. (S, L, P) |
| **V** Hooks | `additionalContext` is accepted from `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` and others, capped at 10,000 characters. `FileChanged`, `ConfigChange` (matcher includes `skills`) and `InstructionsLoaded` exist. (H) **U**: the exact payload of `ConfigChange` for a single `SKILL.md` edit. |
| **U** A server text naming a skill | No documented guarantee that a user message or hook text naming a skill makes the model call `Skill`. Section 4.2 measured it: 16 of 16 and 16 of 16. |
| **V** Plugin directory (scratch) | `claude -p --plugin-dir <dir>` from a working folder with no skills of its own loaded the plugin's skill under the namespace `atc-rulebook:`, and the `Skill` tool accepted the plain name from the alert text. |
| **V** Headless | `claude -p` runs the `Skill` tool; `--setting-sources project`, `--strict-mcp-config`, `--allowedTools` and `--output-format stream-json` gave a clean log of every tool call (this survey's harness). |
| **U** Not tested | A skill invoked from a `/loop` fire; compaction quality for a rule-following role; a send from a headless run to a real session (as in ATC-274). |

Interaction with `rules-drift` and `manual check`: `rules-drift` takes `--files` (paths relative to the repository), so a skill file can be watched by passing it, but only for sessions whose hook command lists it. `atcctl manual check` already hashes the OCC procedure files, so a role's skills could be added to `manualFiles` the same way. **U**: whether Claude Code's own skill-change detection (S) makes this redundant for personal and project skills.

## 4. Options

### 4.1 Assessment

Reliability = does the session open the right procedure at the right time. Tier follows `deploy/landing-tier.mjs`: a skill under `.claude/` of the repository root is `user`; under a control folder's `.claude/` it is `flagged`; a new top-level folder such as `rulebook/` is **`auto`** (no rule lists it; checked with the script), which is wrong for agent instructions and is itself a `user` change to make first.

| # | Option | Reliability | Tokens | What changes | Tier | Effort | Shadow? | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | **Status quo**: rules in `CLAUDE.md`; skills only for loops and tasks | Good in a small file (15 of 16 in the scratch run); falls as the file grows and the abnormal rule is one paragraph among 15 KB (ATC-274: a rule far above in a long context is followed less well) | all rules always paid (7 to 17 k) | nothing | — | — | — | **Keep for memory items only** |
| 2 | **QRH skills picked by description** | 15 of 16 with 8 skills; **2 of 16 right skill and 4 of 16 in order with 88 skills**, because the descriptions were dropped (section 4.2). The accounts atc runs on can carry a large plugin listing (ATC-274 puts listing and plugin context at about 20 k tokens), so the second case is plausible for the real sessions; that was not measured on a real control session | name + description in the listing; body only when opened | new skills | `flagged`/`user` | M | yes | **Reject as the only mechanism** |
| 3 | **ECAM-style link**: the server names the checklist in the text it sends | **16 of 16 and 16 of 16**, also with 88 skills | one short line per message; body only when opened | a code → checklist table in the server; one line added to the texts the server composes | `flagged` (server code that composes sends) | M | yes: log "would name QRH-x" first | **Build first** |
| 4 | **Normal checklists as skills** (before-push, before-PR, arrival report from `atc-task` 4 to 8) | Same as 2 if picked by description; same as 3 if the briefing or the previous step names it | `atc-task` is 4.7 k loaded at once; split lists load per step | split `atc-task` | `user` (root `.claude/`) | M | partly | **Second wave**, after the abnormal set shows the format works |
| 5 | **Memory items** stay in `CLAUDE.md`; the rest moves out | The line: a rule is a memory item only if (a) breaking it is irreversible or hard to undo, or (b) it applies to every turn with no triggering event. Everything with an identifiable trigger is a skill. Rules already enforced by a hook leave prose | smaller always-loaded file | edit `CLAUDE.md` files | `user` (root), `flagged` (folders) | S | yes | **Adopt as the rule for the split** |
| 6 | **MEL skills**: what a session does when a capability is missing | n/a in the reference set (none exists); needs a server-side signal ("no `gh`", "Codex limited") to name it | per procedure | new design plus signals | `flagged`/`user` | M–L | yes | **Later; design first** (needs a list of capabilities and rectification intervals) |
| 7 | **Rulebook plugin** loaded by LAUNCH (`--plugin-dir`), versus per-repo copies | Same as 2 and 3 (the mechanism is the same); the point is *distribution* | n/a | `session-control.ts` adds `--plugin-dir`; a `rulebook/` folder | `flagged` (SIDE_EFFECT file), plus `user` for the landing-tier rule | M | yes (one test AIRCRAFT) | **Adopt for distribution** (section 5.3) |
| 8 | **Checklist IDs as knowledge IDs**: tie to `docs/knowledge.md` KIDs and SAFETY REPORT `rule` | n/a (labelling) | 0 | an ID scheme; `rule` accepts an ID | `auto` for docs, `flagged` for the server check | S | yes | **Adopt**: the ID is how reports and fixes become exact |
| 9 | **Hooks only** (guards, code) for what can be enforced | Highest: not probabilistic | 0 | exists today | `user` | — | — | **Keep and extend** wherever a rule can be checked by code; skills are for what code cannot check |
| 10 | **Forked-context skills** (`context: fork`) for heavy, self-contained procedures | n/a in this survey | the parent keeps one line | per procedure | `flagged` | M | yes | **Use for INSPECTION-like heavy procedures only** (same as ATC-274 option 6) |

Rejected with reasons: **option 2 alone** (probabilistic and, in this account, measured to collapse); **putting a safety rule only in a description** (no reference repository does; they put hard limits in hooks); **agents rewriting their own procedures** (noodle `reflect`), because a revision must go through a PR and the `user` tier.

### 4.2 Scratch experiment: does the session open the right procedure?

**Setup.** Scratch folder; eight fake procedures (`QRH-01` to `QRH-08`) mapped to atc situations (undelivered FLIGHT PLAN, no READBACK, ARRIVED unrecorded, GO AROUND, stalled on approval, lost comms, usage limit, server down). Each has 3 or 4 steps that are commands of a fake `./atcx <word>`; the words cannot be guessed, so a correct sequence proves the procedure was read. Eight situation texts are written in different words from the descriptions, including two near neighbours (undelivered versus lost comms). Judge: the required words appear in order among the `Bash` calls of the stream-json log; "right skill" means a `Skill` call with the procedure's name. Haiku 4.5, `claude -p`, `--setting-sources project`, 2 repetitions per situation, 16 runs per condition.

| Condition | What the session has | In order | Right skill opened | No skill call | Runs with steps of another or unknown procedure | Mean tokens read per run | Cost |
|---|---|---|---|---|---|---|---|
| **A** | all 8 procedures in `CLAUDE.md` (≈ 1.3 k tokens) | 15/16 | — | — | 1 | 106 k | 0.37 USD |
| **B** | 8 skills, picked by description | 15/16 | 15/16 | 0 | 1 | 149 k | 0.46 USD |
| **C** | B, and the alert text ends with "Checklist: QRH-xx (name). Open that skill" | **16/16** | 16/16 | 0 | 0 | 144 k | 0.42 USD |
| **D** | B plus 80 look-alike decoy skills (88 project skills) | **4/16** | **2/16** | 11 | 12 | 159 k | 0.51 USD |
| **E** | D, with the alert text naming the checklist (as C) | **16/16** | 16/16 | 0 | 0 | 143 k | 0.45 USD |

"Mean tokens read" is the sum of input and cache-read tokens over all requests of a run, so it counts the extra request of a `Skill` call; it is not the size of one request. Cost is `total_cost_usd` of the run.

What happened in the misses: in A and B the same situation failed once, the undelivered FLIGHT PLAN ("no such session") taken for lost comms, its neighbour (in A the steps of lost comms and of GO AROUND were mixed; in B the lost-comms skill was opened). In D, the sessions mostly **did not call `Skill` at all** (11 of 16) and invented commands (`--help`, `declare-emergency`, `approve`), which is the dangerous failure: confident action without the procedure. A probe in the same folder showed the cause: all 88 project skills were listed by name only.

**Reading.**

1. With a small, clean set, description-picking and in-file rules both work on a small model (15/16). Do not read this as a rate: the sample is 16 runs, the procedures are fake and short, and a single turn is easy.
2. D may be closer to the real setting than B. The listing in this very session is long (many plugin skills show a name only), ATC-274 puts listing and plugin context at about 20 k tokens, and the docs say descriptions are dropped over budget. Whether a real control session crosses the budget was not measured. If it does, description-only selection fails silently.
3. Naming the checklist in the text (C, E) removed the failure, **including under D**, because names stay in the listing and the `Skill` tool takes a name. This is the argument for option 3. It does not need the model to guess.
4. Condition A shows a cost that the table hides: with a large always-loaded file the procedures are paid on every request; with skills they are paid once, when opened.

**Not measured**: Sonnet 5.5 (control sessions) or Opus; a long conversation between the alert and the use; a skill opened inside a `/loop`; compaction; real procedures with judgement steps. Repeat on the real model and with real procedures during the shadow period (section 5.4).

## 5. Recommendation

### 5.1 The structure

**Three layers**, as in aviation, with a rule for the line:

| Layer | Holds | Form | Loaded |
|---|---|---|---|
| **Limitations** | what must never happen and can be checked by code | guards and hooks (`*guard*.mjs`, `hooks/`) | by the harness, not read |
| **Memory items** | at most about 10 one-line rules: breaking them is irreversible or applies to every turn (never pattern-kill, fail-closed guards, READBACK format and reply-to-session-name, language rule, never message another team, never push `main`) | a short block at the top of the root and folder `CLAUDE.md` | always |
| **Procedures** | everything with a triggering condition | skills: `sop-*` (every flight), `cl-*` (normal checklists), `qrh-*` (abnormal and emergency), `mel-*` (missing capability) | the listing name always; the body when opened |

Background (the FCOM) stays in `docs/` and is never loaded.

**Skill format** (a QRH item), short enough to read in one screen:

```
---
name: qrh-04-go-around
description: Use when TOWER sends a GO AROUND clearance for your PR.
---
# QRH-04 go-around   rev 2026-10-01.1   owner: TOWER manual
Condition: <one sentence>
Steps (one Bash call each, in order): 1. … 2. … 
Stop and report if: <mismatch rule, as in humanlayer's "Expected / Found / Why">
End state: <what is true when done>
Report line: <the fixed READBACK or report text>
```

- **ID**: `<kind>-<nn>-<slug>` with kind in `sop`, `cl`, `qrh`, `mel`; the number never changes and is never reused. A revision string `rev <date>.<n>` sits in the body. The ID is also what SAFETY REPORT `rule` carries and what `docs/knowledge.md` can link.
- **Language.** English for the skill bodies: sessions read them, they speak English to each other (ATC-126), and English costs fewer tokens than the Korean files (about 0.25 against 0.44 tokens per byte as a rough figure; not measured here). The SUPERVISOR-facing summary of each checklist stays in the Korean guide. Today the control manuals are Korean originals with `*.en.md` translations; this is a **SUPERVISOR decision (D1)**.

### 5.2 How the right procedure is opened

Use **option 3** (the server names it) with **option 9** (hooks and guards for what code can check). Concretely, the server already has a stable code for most situations: `undelivered`, `overdue`, `arrivalMissing`, FOLLOWING issue codes (`no-pr`, `pr-not-cleared`, `unable`, `undelivered`), health `RESUME` and `STALLED`, CLEARANCE `GO AROUND`. A pure table `qrhOf(code)` maps a code to a checklist name, and the text the server already composes (brief fields, CLEARANCE and FLIGHT PLAN replacement text from the send guards, TOWER LOG lines) ends with one line `Checklist: qrh-04-go-around`. The model does not choose; the description is a fallback for conditions the server cannot see.

### 5.3 How it reaches AIRCRAFT at every AIRPORT

LAUNCH is atc's own code (`claude --bg …`, `server/session-control.ts`). Add `--plugin-dir <atc>/rulebook` there, so one folder of skills (a plugin, so names are namespaced `atc-rulebook:qrh-04-go-around`) reaches every AIRCRAFT and control session atc starts, whatever repository it works in. This was checked in scratch: `claude -p --plugin-dir <dir>` from an unrelated working folder listed the plugin's skill, and the `Skill` call resolved to the namespaced `atc-rulebook:qrh-04-go-around` from the plain name in the alert text. The docs say a plugin loaded from a local directory is read in place at each session start (documented for local-directory marketplaces; **U** for `--plugin-dir` itself), so on this host there would be no cache and no auto-update to manage: a revision is a commit that lands, and the next LAUNCH sees it. The CREW BRIEFING gets one line naming the rulebook and keeps the memory items inline for AIRCRAFT that start without the plugin (a session started by hand). Running sessions keep the old text until restarted or `/reload-plugins`; the revision string in the body makes that visible.

- **Revision and ack.** Extend `atcctl manual check` and the `rules-drift` hook list to the rulebook's files, so a changed skill produces the same `CHANGED … ack` notice as a changed manual (the control manuals already do it for the OCC procedure files). **U**: whether Claude Code's own skill-change pickup (section 3) is enough for AIRCRAFT; test it in shadow.
- **Landing tier.** Add `rulebook/` to the `USER` list of `deploy/landing-tier.mjs` first. Today it would land as `auto`, which is wrong for agent instructions. After that, a rulebook PR is `user`, like a guard.
- **Other hosts or a remote AIRPORT** (generic): a plugin directory is not shared across machines. Distribution there is a marketplace with a pinned `version`, or a copy kept by the same LAUNCH code. Not designed here.

### 5.4 What to build first

1. **Shadow first (flagged, no behaviour change):** `qrhOf(code)` and a FLIGHT RECORDER line `qrh.named` whenever the server would have named a checklist; a Skill-call reader over transcripts (names and timestamps only). This gives the denominator.
2. **Four pilot skills** where there is no procedure and the cost was real: `qrh-lost-comms` (AIRCRAFT; ATC-258 F4), `qrh-stalled`, `qrh-undelivered` (OCC), `qrh-arrival-missing`. Move `qrh-go-around` out of `CLAUDE.md` verbatim as the first test of the move.
3. **Memory-items block** at the top of the root `CLAUDE.md` (≤ 10 lines) in the same change that moves GO AROUND out.
4. **Plugin delivery and `--plugin-dir`** after the landing-tier rule.
5. Then the normal checklists split from `atc-task`, the MEL design, and the SAFETY REPORT `rule` = ID change.

### 5.5 Fit with the earlier surveys

- **ATC-274 recommendation 2** moves rules from `/tick` into `CLAUDE.md` (the `/tick` body becomes a pointer, because it is re-sent every tick and `CLAUDE.md` is loaded once). **This survey agrees on the `/tick` body and refines where the moved rules go**: per-tick SOP rules go to `CLAUDE.md` (they apply to every turn, so they are memory items by section 5.1); rules for a *condition* go to a skill, not to `CLAUDE.md`, so the always-loaded file does not grow back. The two recommendations touch the same files: order them as ATC-274 work order 2 first (pointer), then move conditions into skills.
- **ATC-258 F4** (lost-comms rule for AIRCRAFT) becomes `qrh-lost-comms`, delivered by the plugin instead of a longer CREW BRIEFING; F2's phase ladder supplies the codes that name `qrh-*` skills; F12 (occurrences file themselves) reports with the checklist ID.
- **SAFETY REPORT** `rule` becomes a checklist ID plus revision, so a group of reports points at one procedure. `no-rule` (left out of S0 as hard to tell from a one-off) becomes cheap to use once a procedure list exists: "no checklist for this condition".

### 5.6 What to measure to know it worked

| Measure | How | Target to judge |
|---|---|---|
| **Named-and-opened rate**: share of `qrh.named` lines followed by a `Skill` call to that name within the same turn | FLIGHT RECORDER lines against transcript `Skill` tool calls (names and times only) | ≥ 95 % in shadow before the table is widened; below 90 % stop and look |
| **Wrong-procedure and no-procedure rate** | steps of a different procedure after a named one; actions with no `Skill` call in a named situation | falling toward 0 |
| **Time from condition to first correct step** per class (undelivered, stalled, lost comms) | server records (condition code time) against the first step's record | shorter than the 33 min wait of ATC-258 I1 |
| **Incidents found by the SUPERVISOR** vs by the session | the same hand count as ATC-258 | the share found by sessions rises |
| **SAFETY REPORT** | `ambiguous-rule` and `repeat-ask` counts per checklist ID | falling after a revision; each report points at an ID |
| **Always-loaded tokens** | root + folder file size, listing size, per ATC-274's ledger | the always-loaded part falls as procedures move out |
| **Revision ack lag** | `manual check` / `rules-ack` records after a skill change | every live session acked within one tick or one LAUNCH |

## 6. Follow-up work orders (not created in Linear)

DUTY or ENGINEERING will create them. New skills under the repository root `.claude/` are tier `user`.

| # | Title | Scope | Expected tier |
|---|---|---|---|
| 1 | Rulebook landing tier: put `rulebook/` in the `USER` list | `deploy/landing-tier.mjs` (+ test) | `user` (`deploy/`) |
| 2 | `qrhOf(code)` and `qrh.named` shadow log | `server/` pure table over existing codes; FLIGHT RECORDER line; no text change yet | `flagged` |
| 3 | Skill-call reader for the named-and-opened rate | read transcripts, names and times only; one daily line like the READABILITY pattern | `auto` |
| 4 | Four pilot QRH skills + format (`qrh-lost-comms`, `qrh-stalled`, `qrh-undelivered`, `qrh-arrival-missing`) | new `rulebook/` plugin folder; English bodies; each links its ATC-258 incident | `user` after WO 1 |
| 5 | Move GO AROUND to `qrh-go-around` and add the memory-items block | root `CLAUDE.md` and `rulebook/` in one PR; reconcile with ATC-274 work order 2 | `user` |
| 6 | Server names the checklist in composed texts | brief fields, send-guard replacement text, TOWER LOG; after the shadow rate holds | `flagged` (guard text changes need the SUPERVISOR first) |
| 7 | `--plugin-dir` at LAUNCH and the CREW BRIEFING line | `server/session-control.ts`, `server/fleet.ts` | `flagged` |
| 8 | Revision and ack for the rulebook | `atcctl manual check`, `rules-drift --files`; test that a running AIRCRAFT sees a changed skill | `flagged`/`user` (hook) |
| 9 | Normal checklists split from `atc-task` | `cl-*` skills; keep `atc-task` as the router | `user` |
| 10 | SURVEY or design: MEL (missing-capability) skills | list capabilities, signals, rectification intervals | `auto` (docs) |
| 11 | SAFETY REPORT `rule` takes a checklist ID; `no-rule` kind | [safety-report.md](../safety-report.md) S0/S2 | `flagged` |
| 12 | Repeat the invocation experiment on the real model and real procedures, including a loop-delivered alert | scratch only; part of the shadow period | `auto` (docs) |

## 7. What this survey does not say

- It does not say skills are *more correct* than a rule in a file. In the scratch run a small in-file rule set did as well as skills (15/16). The argument is about size, about the listing budget, about distribution to AIRCRAFT that do not read atc's files, and about having an ID and a revision.
- It does not show a rate. The experiment is a mechanism check on a small model with short fake procedures.
- It does not decide the language of the skills (D1), the line of the memory items beyond the criteria of option 5, or whether the rulebook is one plugin or several.
- It does not cover accounts and quotas, or the cost of a bigger skill listing; the listing is part of ATC-274's unexplained 20 k floor, and a work order there (N2) measures it.

## Sources

- atc: [lost-comms-and-contingency.md](lost-comms-and-contingency.md) (ATC-258), [control-context.md](control-context.md) (ATC-274), [safety-report.md](../safety-report.md) (ATC-180), [knowledge.md](../knowledge.md) (ATC-104, ATC-105), [fleet.md](../fleet.md), [occ.md](../occ.md); `CLAUDE.md` and the control folders' `CLAUDE.md`; `.claude/skills/atc-task/SKILL.md`; `occ/.claude/skills/tick/`; `server/fleet.ts` (`crewBriefing`), `server/session-control.ts`; `hooks/rules-drift.mjs`; `controller/atcctl.mjs` (`manualFiles`); `deploy/landing-tier.mjs`.
- Claude Code docs, fetched 2026-10-01: [skills](https://code.claude.com/docs/en/skills.md), [hooks](https://code.claude.com/docs/en/hooks.md), [plugin loading](https://code.claude.com/docs/en/plugins/loading.md), [plugins reference](https://code.claude.com/docs/en/plugins-reference.md).
- Reference skills (commits read): [mattpocock/skills](https://github.com/mattpocock/skills) `d81f3a1`; [poteto/noodle](https://github.com/poteto/noodle) `82d2921`, [brainmaxxing](https://github.com/poteto/brainmaxxing) `ec4d8e4`, [verification-skill-example](https://github.com/poteto/verification-skill-example) `d5abe70`, [how](https://github.com/poteto/how) `b1ef429`; [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer) `99abe67`, [skills](https://github.com/humanlayer/skills) `ca7c808`, [advanced-context-engineering-for-coding-agents](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents) `f2bc7ae`, [rpi-coordination-template](https://github.com/humanlayer/rpi-coordination-template) `90a4e7b`; [dexhorthy/slopfiles](https://github.com/dexhorthy/slopfiles) `f7a350a`; [emilkowalski/skills](https://github.com/emilkowalski/skills) `d16ebe6`.
- Aviation (named, not fetched in this session): ICAO Annex 6 Part I (operations manual contents; MEL provisions); EASA ORO.MLR.100; 14 CFR 25.1581, 91.213, 121.133, 121.315; manufacturers' QRH, FCOM, FCTM and ECAM/EICAS documentation; Degani and Wiener, NASA CR-177549 (1990) and Human Factors 35, 1993; NASA ASRS. See also the source list of [ATC-258](lost-comms-and-contingency.md).
