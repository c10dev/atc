# Survey: control-session work as skills

**English** · [한국어](control-skills.ko.md)

> Status (2026-10-01): research, not adopted. Written for [ATC-292](https://linear.app/vocado/issue/ATC-292/survey-control-session-work-as-skills-inventory-what-tower-occ-mcc). No code, manual, guard, hook or setting was changed. The follow-up work orders in section 6 are not created in Linear.

Related: [skill-rulebook.md](skill-rulebook.md) (ATC-281, the rulebook shape this survey fills), [control-context.md](control-context.md) (ATC-274, what fills a control session's context), [control-recycle.md](../control-recycle.md), [safety-report.md](../safety-report.md), [watch.md](../watch.md).

## Question

For each thing TOWER, OCC, MCC, CROSSCHECK, REVIEW and DUTY do today: convert it into a skill, add it to an existing skill, create a new skill, move it into server code, or leave it where it is? The answer is a ranked list with follow-up work orders.

## Method and limits

- **Measured on `origin/main`** (head `55c82a0`, 2026-10-01). File sizes are bytes and characters of the Korean originals (`*.md`; the `*.en.md` files are translations and are not loaded). Tokens use the chars-per-token ratios measured in [control-context.md](control-context.md) 1: 2.0 TOWER, 1.7 OCC, 1.8 MCC, 2.6 CROSSCHECK, 3.3 REVIEW. DUTY has no measured ratio (assumed 2.0, Korean-heavy like TOWER); `inspector.md` is English (assumed 4).
- **Inventory** by three read-only helper agents (Sonnet 5.5), one per group of roles; every row was split from the manual by heading or bullet, with exact byte counts from `awk` over line ranges. I spot-checked sizes and the guard facts against the files. Frequencies in the tables are estimates unless section 2 measures them.
- **Transcripts.** Every control-session transcript of 2026-09-26 .. 2026-10-01 across the three account folders (`~/.claude`, `~/.claude-acct-1`, `~/.claude-acct-3`): TOWER 20 files, OCC 17, MCC 19, CROSSCHECK 14, REVIEW 7, DUTY 6. Streamed line by line. Kept: tool names, `atcctl` subcommand names (only words that appear as literals in `controller/atcctl.mjs`), basenames of the manual and procedure files that were Read, `Skill` names, error flags, timestamps and the *kind* of each user turn (decided by structure, such as a skill body or a queued peer message). **No message text and no command arguments were kept or are quoted.** A tick is one delivered `/tick` skill body. A tick is **quiet** when the model made two tool calls or fewer before the next tick, **worked** with three or more. This is not the idle definition of control-context.md (which used the squelch and request counts), so numbers differ a little.
- **Not done:** the optional scratch experiment (OCC CLASSIFY as a `context: fork` skill against inline). Reason: the survey's answer for forks does not depend on it (section 4, item 5 makes it the first step of that item), and the Agent permission of OCC is unverified. Spend: three helper agents of about 0.3 M tokens in total (list price, roughly 1 USD, an estimate), no scratch session.
- **Public repository:** no other AIRPORT's internals and no message text appear here.

## 1. Current facts: the inventory

### 1.1 What each role carries

| Role | File | Bytes | Chars | Tokens (est.) | Loaded |
|---|---|---|---|---|---|
| TOWER | `controller/CLAUDE.md` | 14,427 | 9,482 | 4.7 k | once per session |
| TOWER | `controller/.claude/skills/tick/SKILL.md` | 1,730 | 1,147 | 0.6 k | **every fire** |
| OCC | `occ/CLAUDE.md` | 19,878 | 12,838 | 7.6 k | once |
| OCC | `occ/.claude/skills/tick/SKILL.md` | 11,913 | 7,872 | 4.6 k | **every fire** |
| OCC | `schedule.md` | 27,882 | 17,042 | 10.0 k | on demand (in practice most sessions) |
| OCC | `flight-plan.md` | 8,171 | 5,563 | 3.3 k | on demand |
| OCC | `following.md` | 5,470 | 3,534 | 2.1 k | on demand |
| OCC | `crew-change.md` | 3,905 | 2,731 | 1.6 k | on demand (never read in the window) |
| OCC | `briefing.md` | 2,072 | 1,223 | 0.7 k | on demand |
| MCC | `mcc/CLAUDE.md` | 10,976 | 6,800 | 3.8 k | once |
| MCC | `mcc/.claude/skills/tick/SKILL.md` | 2,667 | 1,721 | 1.0 k | **every fire** |
| MCC | `mcc/.claude/agents/inspector.md` | 4,551 | 4,545 | about 1.1 k (English) | fresh context per PR |
| CROSSCHECK | `crosscheck/CLAUDE.md` | 11,914 | 7,672 | 3.0 k | once |
| CROSSCHECK | `crosscheck/.claude/skills/tick/SKILL.md` | 3,448 | 2,211 | 0.9 k | **every fire** |
| REVIEW | `review/CLAUDE.md` | 6,165 | 3,820 | 1.2 k | once |
| REVIEW | `review/.claude/skills/tick/SKILL.md` | 1,794 | 1,114 | 0.3 k | **every fire** |
| DUTY | `duty/CLAUDE.md` | 20,971 | 12,713 | about 6.4 k (assumed) | once per shift (no `/tick`, no skills) |

How the tick loads: LAUNCH sends `/loop <n>m /tick` (TOWER 3, MCC 5, OCC, CROSSCHECK and REVIEW 10; `server/session-control.ts`). Each fire delivers the `/tick` skill body as a user turn. OCC's `/tick` body tells the model to open a procedure file only when its step has work, but `schedule.md` is triggered by "no TARGET or ROUTE draft in the last 24 hours", which is almost always true, so the 27.9 KB file is effectively loaded in most sessions.

### 1.2 Procedure rows and their verdicts at a glance

| Role | Rows | memory | convert | add | create | fork | server | shared | leave | delete |
|---|---|---|---|---|---|---|---|---|---|---|
| TOWER | 30 | 4 | 1 | 2 | 0 | 0 | 14 | 3 | 1 | 5 |
| REVIEW | 18 | 2 | 1 | 5 | 0 | 0 | 1 | 3 | 4 | 2 |
| CROSSCHECK | 19 | 3 | 3 | 1 | 0 | 0 | 3 | 3 | 3 | 3 |
| MCC | 22 | 0 | 1 | 1 | 0 | 1 | 3 | 4 | 9 | 3 |
| DUTY | 17 | 0 | 3 | 0 | 0 | 0 | 0 | 3 | 11 | 0 |
| OCC | 43 | 6 | 6 | 6 | 2 | 6 | 4 | 3 | 4 | 6 |

Rows are procedures or groups of procedures with one verdict; the IDs in each row cover every procedure of that role (section 3 has the tables). The verdict words are the issue's: **memory** (stays in `CLAUDE.md`), **convert** (a skill: `sop-`, `cl-`, `qrh-`), **add** (inside a skill), **create** (new skill from an observed pattern), **fork** (a fresh context), **server** (deterministic code or a composite `atcctl` step), **shared** (one text for several roles), **leave**, **delete**.

### 1.3 What the guards allow (feasibility)

- **`Skill` tool.** No role's `settings.json` denies, allows or hooks `Skill`. It works in unattended loop sessions: the transcripts show 78 `Skill` calls (every `/tick` fire is one) with no `Skill` error. DUTY is different: `--tools`, `duty/guard.mjs` `ALLOWED_TOOLS` and its settings all omit `Skill`, so DUTY cannot open a skill at all (changing it is a `user`-tier change to three places).
- **Reading a procedure file.** OCC and MCC read inside the repo. REVIEW and CROSSCHECK may Read only their own folder and `../docs/` (`read-guard.mjs`). A top-level `rulebook/` folder would need a read-guard change for those two roles, or delivery as a plugin through the `Skill` tool (ATC-281 option, `--plugin-dir`), which needs no guard change.
- **Fork or sub-agent.** `Agent` and `Task` are denied and hook-blocked for REVIEW and CROSSCHECK, and MCC may spawn only `inspector` (`agent-guard.mjs`). TOWER has no `Agent` block and OCC has none; whether either may spawn a fork was not tested. A fork would have to return a structured verdict while the parent runs the `atcctl` writes, because the guards pin which Bash commands run (verified for MCC's inspector, `inspector-guard.mjs`; not verified for a new OCC fork).
- **Commands a skill may use** are the role's allow list: TOWER `atcctl` and `jq`; OCC the same plus `gh pr view|checks|diff|list`; MCC `manual`, `mcc queue|packet|inspect|escalate|land|rts`, `gh` read verbs; CROSSCHECK `manual`, `crosscheck brief`, `dispatch brief|flight|crosscheck`, `schedule brief|crosscheck`; REVIEW `manual`, `landing queue|review`. A skill that needs another command needs a guard change (`user` tier).
- **`manual check` covers** `CLAUDE.md` and `tick/SKILL.md` and any non-`.en` `*.md` inside `.claude/skills/tick/` (`controller/atcctl.mjs`). A new skill under another folder is not hashed unless that code changes.

## 2. Observed use (transcripts, 2026-09-26 .. 2026-10-01)

### 2.1 How much of the loop is work

| Role | Requests | Ticks | Worked | Quiet | Tool calls per tick (p50 / p90 / max) | Idle cache-read per tick (control-context.md) | Cache-read in quiet ticks (est.) |
|---|---|---|---|---|---|---|---|
| TOWER | 7,998 | 1,816 | 883 | **933 (51 %)** | 2 / 6 / 19 | 0.62 M | 0.58 G |
| OCC | 6,199 | 639 | 474 | 165 (26 %) | 5 / 13 / 54 | 0.92 M | 0.15 G |
| MCC | 3,973 | 717 | 266 | **451 (63 %)** | 2 / 7 / 31 | 0.33 M | 0.15 G |
| CROSSCHECK | 2,250 | 515 | 107 | **408 (79 %)** | 2 / 6 / 20 | 0.56 M | 0.23 G |
| REVIEW | 1,840 | 444 | 33 | **411 (93 %)** | 2 / 2 / 25 | 0.16 M | 0.07 G |
| DUTY | 18 | n/a | n/a | n/a | n/a | n/a | n/a |

About **1.2 G tokens** were read from cache in quiet ticks over five days. The most common whole tick is the quiet one: TOWER `manual check > brief > ack` 600 times (33 % of all ticks), OCC `manual check > dispatch brief > schedule brief > following > following ack` 132 times, MCC `manual check > mcc queue > mcc land > mcc rts` 62 and `… > mcc rts` 44 times, CROSSCHECK `manual check > crosscheck brief > manual check` 24 times, REVIEW `manual check > landing queue > landing review` 15 times. These are two to five calls with no judgment.

### 2.2 What the sessions call

| Role | Top `atcctl` subcommands (calls) |
|---|---|
| TOWER | manual check 1,517 · ack 1,454 · brief 986 · issue 266 · readback 140 · roger 120 |
| OCC | manual check 592 · dispatch brief 523 · schedule brief 428 · following 339 · dispatch flight 273 · following ack 257 · dispatch release 242 · dispatch note 208 · dispatch readback 184 · dispatch report 115 · schedule draft 21 |
| MCC | mcc queue 632 · manual check 624 · mcc land 201 · mcc inspect 198 · mcc rts 129 · mcc packet 94 · (Agent, the inspector, 148) |
| CROSSCHECK | manual check 519 · crosscheck brief 499 · dispatch flight 105 · dispatch crosscheck 69 |
| REVIEW | manual check 416 · landing queue 414 · landing review 255 |

`manual check` is the first call of every tick in every role (about 3,670 calls); the sequence `manual check > Read > manual ack` shows up 17 times as a TOWER trigram and 11 times in CROSSCHECK, with whole-tick matches in OCC and others: the "manual changed, re-read, ack" procedure that every manual describes.

Procedure files Read: OCC `CLAUDE.md` 37, `SKILL.md` 21, `flight-plan.md` 15, `schedule.md` 11, `following.md` 10, `briefing.md` 9, **`crew-change.md` 0**. Compare with the work: 273 `dispatch flight` calls but 15 reads of `flight-plan.md`; 428 `schedule brief` calls, 21 `schedule draft` calls, 11 reads of the 27.9 KB `schedule.md`. The procedure files are read at start-up of a session far more than per event; the sessions run the cycles from context.

### 2.3 Errors and repeats

| Command | Calls | Errors | Rate |
|---|---|---|---|
| OCC `dispatch release` | 242 | 78 | **32 %** |
| OCC `dispatch arrived` | 26 | 11 | **42 %** (before ATC-266 let `arrived` run from `accepted`) |
| OCC `dispatch flight` | 273 | 22 | 8 % |
| MCC `mcc inspect` | 198 | 29 | **15 %** |
| REVIEW `landing review` | 255 | 17 | 7 % |
| OCC `dispatch brief` | 523 | 11 | 2 % |
| MCC `mcc queue` | 632 | 10 | 2 % |
| TOWER `issue` | 266 | 4 | 2 % |

Three in a row of the same command inside one tick (a retry candidate): OCC `dispatch flight` 32 ticks, `dispatch release` 23, `dispatch readback` 20, `dispatch note` 18, `SendMessage` 21; TOWER `SendMessage` 21 and `issue` 14; MCC `Agent` 9 and `mcc packet` 8. (REVIEW's 28 are several PRs reviewed in a row, not retries.) The error text was not read, so the cause is not known from this survey. SAFETY REPORT and NEEDS YOU events were not correlated: SAFETY REPORT is a design draft with no records, and NEEDS YOU is not in the transcripts.

### 2.4 User turns by kind (structure only)

| Role | Tick fires | Queued peer messages | Queued system | Other user turns (length p50) |
|---|---|---|---|---|
| TOWER | 1,816 | 34 (27 from AIRCRAFT) | 1 | 335 (about 800 chars) |
| OCC | 639 | 53 (all from AIRCRAFT) | 0 | 366 (about 1,350 chars) |
| MCC | 717 | 0 | 142 (+16 other queued) | 153 (about 4,500) |
| CROSSCHECK | 515 | 0 | 0 | 25 (about 6,100) |
| REVIEW | 444 | 0 | 0 | 12 (about 7,900) |
| DUTY | 0 | 0 | 0 | 10 (about 12 chars) |

The "other" turns cannot be split into SUPERVISOR-typed and hook-injected by structure, so the question "what does the SUPERVISOR keep asking for by hand" is **not answered by counts** here; DUTY's ten turns are short chat lines and say nothing about kinds. A hand count of SUPERVISOR requests, as ATC-258 did for incidents, would answer it and is work order 12.

### 2.5 Repeated multi-step patterns that no manual names as one procedure

Counted from tool-name sequences inside worked ticks (names only):

1. **OCC FLIGHT PLAN cycle.** `dispatch flight > dispatch note > SendMessage > dispatch readback > dispatch report` (8 whole-tick matches), with the pieces `dispatch release > SendMessage > dispatch readback` 28, `SendMessage > dispatch readback > dispatch report` 32 and `dispatch note > dispatch release > SendMessage` 29. The manuals split it by reply type (`SKILL.md` step 4, `flight-plan.md` rows, `CLAUDE.md` send rule) and repeat the `success:false` rule in three files. No file shows the cycle as one procedure with its stop conditions.
2. **TOWER CLEARANCE cycle.** `issue > SendMessage > ack` 184, then `roger` 93 or `readback` 82; whole-tick forms 63 + 51 + 20 + 15. `CLAUDE.md` has the pieces (TWR-12, 30, 31) and the table of situations, not the cycle.
3. **"Manual changed" re-read.** `manual check > Read > manual ack` in every role (28 trigram matches in TOWER and CROSSCHECK alone). Every manual describes it; the server could do it.
4. **OCC release refused.** 78 errors in 242 calls with a recovery that the manual spreads over four rows (OCC-80..83) in prose.
5. **No-PR FLIGHT finishing.** `dispatch report` then `dispatch arrived` for SURVEY and CHECK FLIGHTs (26 `arrived` calls, 11 errors); ATC-266 changes the state machine, but the two-step procedure is described in two places.
6. **MCC inspect and land loop.** `mcc queue > Agent > mcc inspect > mcc queue > mcc land` (16 and 14 whole-tick matches). The manual names it (tick steps 2 and 3); the observed part that is not named is the `mcc inspect` syntax errors (15 %) and `mcc packet` repeats.

## 3. Verdict tables

Verdict per procedure, with the reason. Bytes are exact line-range sizes. Class: SOP every tick, CL normal checklist, COND conditional procedure, ABN abnormal (QRH), LIM limitation already enforced, BG background (FCOM). "Tick" rows are the `/tick` bodies; the other row IDs follow the manuals' order.

### 3.1 TOWER

| ID | Procedure | Bytes | Class | Verdict | Why |
|---|---|---|---|---|---|
| TWR-01 | Role; reads RADAR, sends CLEARANCE; ask when unsure | 362 | BG | **memory** | Identity plus the one rule that must hold every turn (do not issue when unsure). |
| TWR-02 | No code; Bash only atcctl and jq; quoting and jq limits | 573 | LIM | **delete** | `guard.mjs` and the Edit/Write deny already enforce it; keep one pointer line. |
| TWR-03 | No writes to Linear, git, GitHub | 149 | LIM | **memory** | One shared line for all roles (guard enforces; TOWER has no mcp-guard, see Unverified). |
| TWR-04 | Do not judge in-worktree work | 216 | BG | **memory** | Short scope rule. |
| TWR-05/06 | Tool table; CLEARANCE types | 1,065 | BG | **delete** | `atcctl` help lists the commands and `issue` validates TYPE; keep only SendMessage by session name. |
| TWR-07 | SQUELCH note | 232 | BG | **delete** | No action follows; one copy in each of five roles. Drop it. |
| TWR-08 | Response attributes W/U/R; server rejects bad answers | 484 | BG+COND | **add** | Goes into `sop-replies`; the server already rejects, keep only 'report the rejection'. |
| TWR-09 | Loss of separation: first CONTINUE, rest HOLD | 298 | COND | **server** | Deterministic; the brief can carry the exact CLEARANCEs to issue. |
| TWR-10 | Ground stop: no LAND, HOLD to holders, CONTINUE when ended | 636 | COND | **server** | Message templates are fixed; no judgment left. |
| TWR-11 | Merge slot: no LAND while slotHold | 451 | COND | **server** | `landingQueue` can omit held PRs. |
| TWR-12 | CLEARED TO LAND: LAND only if landBy is holder and no stop or slot; send landText verbatim | 1,082 | COND | **server** | A composite step computes the `issue` arguments and the send list. Left: report when no holder. |
| TWR-13 | APPROACH: no LAND; INFO from infoText on requested/blocked events | 794 | COND | **server** | Needs only event dedup and the text the server already writes. |
| TWR-14 | GO AROUND: act on goAround.action; relay UNABLE | 1,068 | COND | **server** | `action` is already computed; keep the SUPERVISOR report wording. |
| TWR-15 | Stacked PR: no LAND | 325 | COND | **delete** | Duplicate of TWR-13. |
| TWR-16 | STRANDED: report once to SUPERVISOR | 322 | COND | **server** | Key dedup; judgment is only the wording. |
| TWR-17 | Codex findings: all-P3 means send landText | 537 | BG | **delete** | landText and infoText already carry it; duplicates TWR-12/13. |
| TWR-18 | CODEX limit and REVIEW stand-in | 1,018 | COND | **add** | One line inside TWR-12 plus one for the `excluded` report. |
| TWR-19 | github.error: LANDING SEQUENCE may be stale; report once | 124 | ABN | **server** | One-liner the server can raise as a named condition (`qrhOf`). |
| TWR-20/21 | handoff and OUTSTATION events: log only | 370 | COND | **server** | The server can auto-log; no model needed. |
| TWR-22 | AIRCRAFT HEALTH: alert level once to SUPERVISOR, info logged, no message to team | 819 | ABN | **convert** | `qrh-health`; judgment left: whether the report is warranted. |
| TWR-23/24 | FUEL, FUEL LEAK, COLD CACHE: once per key | 1,320 | COND | **server** | Same key dedup mechanism for both. |
| TWR-25/26 | NORDO, UNIDENTIFIED, NO CONTACT: report new ones | 285 | ABN | **server** | Dedup by key. |
| TWR-27 | NO READBACK overdue 10 min: resend once with RESEND, then report | 209 | COND | **server** | Both steps are mechanical; same shape as OCC overdue (OCC-75). |
| TWR-28 | Team replies go to atcctl; free-form refusals to SUPERVISOR (tick step 1 repeats it) | 997 | SOP | **shared** | `sop-replies`, one skill for TOWER and OCC. |
| TWR-29 | alert.cleared: cancel the pending CLEARANCE | 107 | COND | **server** | Deterministic. |
| TWR-30/31 | Send issue output verbatim; one CLEARANCE per message, two per team per tick | 219 | CL | **memory** | Irreversible once sent and needed every time. |
| TWR-32 | Use [ref] when the SendMessage name is ambiguous | 100 | COND | **leave** | Rare; one line. |
| TWR-33 | Language: English to sessions, Korean LOG | 350 | CL | **shared** | One shared language line. |
| TWR-34 | ATC LOG: one or two lines per tick | 199 | SOP | **shared** | One shared LOG line. |
| TWR-T0..T5 | `/tick` body: manual check, replies, brief, walk the table, ack, LOG (1730 B, restates CLAUDE.md) | 1,730 | SOP | **server** | Most ticks are `manual check > brief > ack` (600 times, 33 % of ticks): a composite `atcctl tick`; the body becomes a pointer. |

### 3.2 OCC

| ID | Procedure | Bytes | Class | Verdict | Why |
|---|---|---|---|---|---|
| OCC-01/02 | Role identity; the five jobs | 2,118 | BG | **memory** | Shorten: the detail repeats in the procedure files. |
| OCC-03/29 | manual check; re-read on CHANGED (CLAUDE.md 342 B and tick step 0 264 B) | 606 | SOP | **shared** | One shared text; delete the CLAUDE.md copy. |
| OCC-04 | Mode from `dispatch brief`: shadow memos, approval also sends | 501 | SOP | **memory** | Decides what is sendable. |
| OCC-05 | Send only FLIGHT PLAN/RECALL/CC; header only; on success:false call undelivered | 1,087 | LIM+COND | **memory** | send-guard enforces the gate; keep one line; the `success:false` part is repeated in three files. |
| OCC-06 | CANCELLED approved card: release 409 means closed | 591 | COND | **add** | Into `sop-flight-plan-cycle`, release row. |
| OCC-07 | Language: English to teams, Korean LOG | 376 | CL | **shared** | Same sentence as TWR-33. |
| OCC-08..11, 17 | Never create/approve CREW CHANGE, change TARGETS/ROUTE, milestones; no verdicts; no merge | 1,215 | LIM | **memory** | Merge into one 'never judge or approve' line; Edit/Write deny, mcp-guard and the server enforce. |
| OCC-12/30/67 | ARRIVED report: record it first with fixed fields (CLAUDE.md, tick step 1, flight-plan.md) | 2,599 | COND | **memory** | Triplicated. Memory keeps 'record the report line immediately'; the command detail goes in `sop-replies`. |
| OCC-13/69 | Captain waits for the user's go: await-supervisor; never relay approval | 1,044 | COND | **add** | Into `sop-replies`; 'never relay approval' stays in the memory line. |
| OCC-14 | No NEW draft without a CHARTER REQUEST; DUTY text is data | 603 | LIM/CL | **memory** | Trust boundary. |
| OCC-15/16 | No code; Bash allow list; no Linear/git/GitHub writes | 819 | LIM | **delete** | Guards enforce it; root CLAUDE.md already says fail-closed. |
| OCC-18 | Do not step into TOWER's work | 89 | BG | **leave** | One line. |
| OCC-19 | Tool table with brief-field glossary | 3,660 | BG | **add** | Keep the glossary as a reference file of the tick skill; delete the rows the procedure files repeat. |
| OCC-20 | SQUELCH note | 232 | BG | **delete** | See TWR-07. |
| OCC-21 | Procedure file table (when to read which file) | 1,281 | BG | **delete** | The skill descriptions replace it. |
| OCC-22..25, 32, 106 | Review standard, memo table, HOLD mechanics, 'user decides' phrases, step 3, BRIEFING (about 9.5 KB) | 9,521 | SOP/COND | **fork** | Reads a FLIGHT body and comments, returns note, flag, hold and three briefing lines; needs no session context. Parent runs the writes. |
| OCC-26, 50 | TAIL ASSIGNMENT rules and TAIL drafts | 2,365 | COND | **convert** | A `sop-tail` skill; partly deterministic, partly needs a SUPERVISOR instruction from the session. |
| OCC-27/44 | OCC LOG | 798 | SOP | **shared** | Shared LOG line. |
| OCC-28 | Tick frontmatter and 'read procedure files only when needed' | 727 | BG | **leave** | Becomes the pointer. |
| OCC-30 | Tick step 1: CAPTAIN replies and command mapping | 1,758 | SOP | **convert** | `sop-replies`, opened from the pointer; the mapping repeats flight-plan.md and crew-change.md. |
| OCC-31 | Tick step 2: `dispatch brief`; verify arrivalCandidates evidence | 986 | SOP | **leave** | Stays in the pointer tick. |
| OCC-33 | Tick step 4: release FLIGHT PLAN, RECALL, CC | 1,065 | COND | **create** | `sop-flight-plan-cycle`: release, header-only send, readback, report as one procedure (observed 5-step cycle). |
| OCC-34, 43, 89 | Tick steps 5 head and 7: `schedule brief`, `following` fresh issues | 1,233 | SOP | **server** | `following ack` follows every tick (161 times); the server can ack when nothing is fresh. |
| OCC-35, 39, 41 | Draft details: candidates, WAYPOINT, WAYPOINT gap | 2,153 | SOP/COND | **fork** | With OCC-47..56 below. |
| OCC-36, 58..60 | CHARTER REQUEST and CHARTER DESK | 5,766 | COND | **create** | `sop-charter-desk`, opened by name when the `duty` zone is present; needs the live conversation, so not a fork. |
| OCC-37, 38, 52 | WAYPOINT slips, ROUTE without WAYPOINT: report fresh, then ack | 1,183 | COND | **server** | Filter `fresh` and ack server-side. Left: none. |
| OCC-40, 57 | TARGET/ROUTE drafts: once per 24 h; thresholds | 2,172 | SOP | **server** | The numeric thresholds are checked by atc; the model keeps 'is the evidence clear'. |
| OCC-42, 55 | S2 release: paste each CALL JSON into the Linear tool | 2,286 | COND | **convert** | Conditional on approval mode; long term a server copy step. |
| OCC-45, 62, 85, 91, 104 | File headers | 1,751 | BG | **leave** | Become skill descriptions. |
| OCC-46, 63, 86, 92, 105 | Command tables inside the procedure files | 6,619 | BG | **add** | Split into the matching skills. |
| OCC-47, 53 | Draft selection and CLASSIFY (reads fleet.md 4.1-4.3, up to 3 FLIGHTs) | 4,106 | SOP/COND | **fork** | Strong fork: large input, small verdict (type, wake, rating, priority and a reason). |
| OCC-48 | Axis table (summary of fleet.md 4) | 846 | BG | **delete** | Duplicate; schedule.md itself calls it a summary. |
| OCC-49 | CLOSE: gh pr view, only Fixes closes | 1,030 | COND | **fork** | Reads a PR and a body; returns a draft or a skip. |
| OCC-51, 56 | WAYPOINT attach and WAYPOINT gap | 4,568 | COND | **fork** | Reads criteria and FLIGHT bodies; returns names or uncovered criteria. |
| OCC-54, 61 | Draft limits, error handling; command shape | 1,392 | NC | **add** | Into the draft fork. |
| OCC-64..66, 68, 70..76 | FLIGHT PLAN reply rows: release, cold cache, readback, standby, arrived, recall, overdue, unable | 3,160 | COND/ABN | **add** | Into `sop-flight-plan-cycle` as rows (OCC-67, 69 are duplicates, see above). |
| OCC-77, 101 | send-guard blocked: do not retry, report | 249 | LIM | **delete** | Generic memory line; send-guard enforces. |
| OCC-78, 79, 102 | success:false on FLIGHT PLAN, RECALL, CC | 1,153 | ABN | **convert** | `qrh-send-failed` (also OCC-05). |
| OCC-80..83 | release rejected: GROUND STOP, LAUNCHING/RESTARTING, no AIRCRAFT session, LAUNCH failed | 1,462 | ABN | **convert** | `qrh-release-refused`: 78 of 242 `dispatch release` calls (32 %) errored in the window. |
| OCC-84, 87, 100 | Informational lines (DEPARTED, scope, `pending` means nothing) | 713 | BG | **delete** | No action follows. |
| OCC-88 | Issue-code table: what to report where | 3,179 | SOP | **server** | Add a `report` target to the `following` JSON; left: wording and escalation. |
| OCC-90 | On a report or request: check commit, checks, diff vs allowed scope | 730 | COND | **fork** | Small input (the claim), small output (a fact diff); or `cl-pr-check`. |
| OCC-93..99, 103 | crew-change.md: relay approved CC, waiting, readback, unable, standby, overdue, notes | 2,234 | COND/ABN | **convert** | `sop-crew-change`; 0 reads of this file in the window (56 `crew-change brief` calls). |

### 3.3 MCC

| ID | Procedure | Bytes | Class | Verdict | Why |
|---|---|---|---|---|---|
| MCC-01 | Role and switch semantics (shadow, land, rts) | 1,109 | BG | **leave** | Short FCOM; trim one tail sentence. |
| MCC-02 | No edit/SendMessage/Artifact; only the inspector as Agent; language | 445 | LIM | **leave** | Settings deny, hook and `agent-guard.mjs` enforce it. |
| MCC-03 | user-tier and ESCALATE'd PRs are not landed | 117 | LIM | **leave** | `mcc land` re-checks server-side. |
| MCC-04/05/06 | No git/systemctl/gh write; no Linear writes; read scope is the repo | 510 | LIM | **leave** | `guard.mjs --mcc`, mcp-guard, read-guard. Merge into one shared fail-closed line. |
| MCC-07 | If a guard blocks, do not work around it; LOG it | 74 | LIM | **shared** | Same sentence in four places. |
| MCC-08 | Tool table | 1,653 | BG | **leave** | Command reference; the `mcc inspect` syntax moves into the inspect step. |
| MCC-09 | The four writes need the real model; standalone, single quotes | 377 | LIM+CL | **leave** | Guard enforces the model; the syntax tip goes into the inspect step (15 % of `mcc inspect` calls error). |
| MCC-10 | SQUELCH note | 232 | BG | **delete** | See TWR-07. |
| MCC-11/23 | INSPECTION procedure (CLAUDE.md 1395 B and tick step 2 1015 B, nearly word for word) | 2,410 | COND | **fork** | Already a fork (the inspector); keep one pointer, delete the second copy. |
| MCC-12 | Inspector criteria (copy in CLAUDE.md, about 1850 B in inspector.md) | 1,761 | BG | **delete** | The main session never applies it; the 'edit both together' comment is a drift hazard. Keep the inspector.md copy. |
| MCC-13 | Severity P0/P1/P2, finding line format | 398 | BG | **delete** | Duplicated in inspector.md. |
| MCC-14/24 | Land every PR with empty blocks; re-read the queue | 388 | CL | **server** | Deterministic: a composite 'land all unblocked' step. Left: none. |
| MCC-15 | Flagged landing: LOG the changed control rules and side-effect files | 264 | COND | **server** | `mcc land` can print the two lines. |
| MCC-16/22/25 | RTS when due, once per tick, not after a landing | 822 | SOP | **server** | The server already says 'not the time'; a pre-step does it. |
| MCC-17 | ROLLBACK: do not RTS, report; SUPERVISOR clears it | 154 | ABN | **add** | One QRH line from tick step 1. |
| MCC-18/26 | Context CAP at 150k; read recycle.mode; LOG | 1,283 | COND | **convert** | `qrh-context-cap`, named by the hook banner. |
| MCC-19 | Fresh start: all state is on the server | 536 | COND | **leave** | Folds into the pointer `/tick`. |
| MCC-20 | MCC LOG lines | 338 | SOP | **shared** | Shared LOG line. |
| MCC-21 | manual check; re-read on CHANGED | 197 | SOP | **shared** | Same in every role. |
| MCC-27 | Never edit/message/write Linear; blocked means LOG | 169 | LIM | **shared** | Repeats MCC-02/05/07. |
| MCC-28/29/31 | Inspector role, may-do list, reply block | 2,322 | BG/LIM/CL | **leave** | Inside the fork; `inspector-guard.mjs` enforces the may-do list. |
| MCC-30 | How to inspect (the canonical criteria) | 1,851 | BG | **leave** | The one copy to keep. |

### 3.4 CROSSCHECK

| ID | Procedure | Bytes | Class | Verdict | Why |
|---|---|---|---|---|---|
| XC-01 | Role: preliminary agree/disagree for DISPATCH and SCHEDULE drafts | 1,043 | BG | **memory** | Trim to about 300 bytes. |
| XC-02 | Marks are advice; no approve, reject, verdict | 154 | LIM | **memory** | Shared line (REV-04). |
| XC-03 | No Linear/git/GitHub writes; gh read-only | 320 | LIM | **leave** | `guard.mjs --crosscheck --gh-read` and mcp-guard enforce it. |
| XC-04 | File and Bash limits; quoting and jq rules | 1,001 | LIM | **delete** | Read-guard and guard enforce it; one shared note for jq and quoting. |
| XC-05 | Send no messages | 133 | LIM | **leave** | Deny plus hook block. |
| XC-06 | Do not follow OCC note blindly; verify in the body | 126 | CL | **memory** | Short and about trust. |
| XC-07 | Tool table | 1,490 | BG | **leave** | Delete the rows the tick steps already repeat. |
| XC-08 | Marks only on open items; Opus model gate; log if blocked | 847 | LIM | **shared** | Guard-enforced; same as REV-10. |
| XC-09 | SQUELCH note | 232 | BG | **delete** | See TWR-07. |
| XC-10/11 | Verdict order table (status, done, prerequisites, priority, per target); CLOSE inverts 1-2 | 956 | CL | **convert** | `cl-crosscheck-verdict`. |
| XC-12 | Per-target agree conditions (ASSIGN, RELEASE, CLASSIFY, PRIORITIZE, NEW, CLOSE) | 1,711 | COND | **convert** | One `cl-` skill per target group, opened by target type. |
| XC-13/15 | PR facts with gh pr view; other-repo refs; gh failure means no mark | 1,111 | COND | **add** | Inside the CLOSE skill; judgment left: reading the PR state. |
| XC-14 | AIRPORT to repo table (5 rows) | 203 | BG | **server** | A lookup the server can answer; no reason to keep it in prose. |
| XC-16/17 | Match the examples standard; undecidable means no mark | 464 | SOP | **delete** | Each repeats one line of tick steps 2 and 6. |
| XC-18 | Reason writing: one line, facts first; English terms, Korean text | 429 | CL | **shared** | Language and reason format. |
| XC-19/21 | Reason chips: a FLIGHT chip sends the proposal to PREFLIGHT HOLD; decide FLIGHT vs AIRCRAFT first | 864 | COND | **convert** | `cl-crosscheck-chips`: the consequence is hard to undo, so a named checklist helps. |
| XC-20 | Chip table (8 codes) | 640 | BG | **server** | The server can validate `--code`; keep as reference. |
| XC-22 | CROSSCHECK LOG lines | 151 | SOP | **shared** | Shared LOG line. |
| XC-T0..T7 | `/tick` body (3448 B): brief, examples, per-pending marks, LOG | 3,448 | SOP | **server** | 79 % of ticks find nothing pending; the 5-per-tick cap and the TARGET/ROUTE criterion (fleet.md 7.4) live only here. |

### 3.5 REVIEW

| ID | Procedure | Bytes | Class | Verdict | Why |
|---|---|---|---|---|---|
| REV-01 | Role: landing review when Codex is limited; unsure means do not pass | 685 | BG | **memory** | Keep the 'do not pass when unsure' line. |
| REV-02 | CROSSCHECK does DISPATCH/SCHEDULE, REVIEW only landing | 158 | BG | **delete** | Fold into REV-01. |
| REV-03 | No Linear/git/GitHub writes; no gh; MCP read-only | 166 | LIM | **leave** | `guard.mjs --review` has no gh and mcp-guard is read-only. |
| REV-04 | No merge, approve, reject, verdict | 152 | LIM | **memory** | One shared line. |
| REV-05 | Send nobody a message | 133 | LIM | **leave** | SendMessage is denied and hook-blocked. |
| REV-06/07 | File read limits; Bash only manual/landing/jq | 491 | LIM | **leave** | `read-guard.mjs` and `guard.mjs --review` enforce it. |
| REV-08 | Excluded PRs: do not touch; server returns 403 | 406 | COND | **add** | One line in the review skill step 1. |
| REV-09 | Tool table | 800 | BG | **leave** | The tick already shows the commands. |
| REV-10 | Record command only with the real Sonnet model; log if blocked | 470 | LIM | **shared** | Guard-enforced; keep only 'log the block'. Same note as XC-08. |
| REV-11 | SQUELCH note | 232 | BG | **delete** | See TWR-07. |
| REV-12 | Targets: only pending; excluded wait | 513 | CL | **add** | Step 1 of the review skill. |
| REV-13 | What to review; no style nits; security-looking diff without the flag is P0 | 481 | CL | **add** | `cl-landing-review` checklist. |
| REV-14 | Security PR: extra scrutiny of GRANT/RLS/auth/migrations/secrets | 405 | COND | **convert** | `cl-security-pr`, opened only on the `security` flag. |
| REV-15/16 | Grading P0/P1/P2, one line per finding; truncated diff rule | 454 | CL | **add** | Same skill as REV-13. |
| REV-17 | Record: --head, 4000 chars, 409 means next tick; English text | 311 | CL | **shared** | Language part shared; head and 409 stay in the skill. |
| REV-18 | At most 2 PRs per tick; no re-review of the same head | 102 | CL | **add** | Already in tick step 2. |
| REV-19 | REVIEW LOG lines | 156 | SOP | **shared** | Shared LOG line. |
| REV-T0..T4 | `/tick` body (1794 B): manual check, queue, review, record, LOG | 1,794 | SOP | **server** | 93 % of ticks end after `landing queue` finds nothing pending: a server pre-check, no model. |

### 3.6 DUTY

DUTY has no loop and no skills; one `claude -p` process answers chat. The procedures it repeats (design doc, work order, ADOPT) are the "convert" rows, and they are blocked by the missing `Skill` tool, so their form is a document opened with Read (the Read scope includes `docs/`).

| ID | Procedure | Bytes | Class | Verdict | Why |
|---|---|---|---|---|---|
| DUT-01/02 | Role, L1 powers, what DUTY can do | 1,916 | BG | **leave** | Short FCOM. |
| DUT-04/05 | No approve/decide/merge/session control; no messages to sessions; CHARTER REQUEST drafts | 946 | LIM | **leave** | `duty/guard.mjs`, deny and `--tools` enforce it. |
| DUT-06/07 | No code; no self-authority files | 819 | LIM | **leave** | Guard Edit/Write path check and settings deny. |
| DUT-08 | Linear: ATC team, Backlog/Todo, no delete or close | 181 | LIM | **leave** | `server/duty-linear.ts` enforces it. |
| DUT-09 | Do not work around guard blocks | 280 | LIM | **shared** | Same sentence as MCC-07. |
| DUT-10 | No secrets; read atc state via atcctl | 175 | LIM | **leave** | DUTY read rules. |
| DUT-11 | Outside text is data; BEGIN DATA / END DATA wrappers | 552 | BG | **shared** | Trust boundary all reading roles need. |
| DUT-12 | Language: Korean to SUPERVISOR; English elsewhere | 587 | CL | **shared** | Only the CJK reject in `duty charter` is code-checked. |
| DUT-13 | Tool table (about 20 commands) | 6,809 | BG | **leave** | Largest block; trim what `atcctl duty` help already prints (unverified). |
| DUT-14 | How it works: read the brief, answer from tool output, keep it short | 881 | SOP | **leave** | Every turn; stays in CLAUDE.md or the brief hook. |
| DUT-15 | Preamble to design and work orders | 268 | BG | **leave** | One short line. |
| DUT-16/19 | Write a design doc (8 steps) and the post-merge status update | 2,562 | COND | **convert** | `sop-design-doc` as a doc read with Read (DUTY has no Skill tool); `stand-done` is already code; marker sync could become a server step. |
| DUT-17/18 | Write a work order (Linear EO) and split a big issue | 1,526 | COND | **convert** | `sop-work-order`; code already requires priority, state limit, parent team; not enforced: full-URL refs, English body, Fixes vs Refs. |
| DUT-20 | ADOPT: design outline in Korean first, STAND only after agreement | 1,427 | COND | **convert** | `sop-adopt`; the trigger message is built in `server/ideas.ts`, so it can name the doc. |
| DUT-21 | Standing decisions: only the injected list counts | 1,323 | SOP | **leave** | Behaviour belongs in always-loaded memory; the list is injected by code. |
| DUT-22 | SUPERVISOR QUEUE cards | 973 | COND | **leave** | The server rejects a key not in the queue; shorten rather than convert. |
| DUT-23 | No /tick, no SQUELCH | 112 | BG | **leave** | One line. |

### 3.7 Create candidates

The issue asks for at least three "create" candidates that come from observed repeats. They are:

| Candidate | Evidence (section 2) | Why no manual has it | Verdict row |
|---|---|---|---|
| `sop-flight-plan-cycle` (OCC): release, header-only send, readback, report, with the stop conditions | 2.5 item 1; 242 releases, 273 flights | The manual describes replies one by one | OCC-33, OCC-64..76 |
| `sop-clearance-cycle` (TOWER): issue, send verbatim, ack, readback or roger | 2.5 item 2; 266 issues | `CLAUDE.md` has the situations, the cycle is spread over TWR-12, 30, 31 and tick step 3 | TWR-12, 30, 31 |
| `sop-replies` (TOWER and OCC, shared): READBACK, ROGER, UNABLE, STANDBY, await-supervisor, ARRIVED | TOWER 140 + 120 + 11, OCC 184 + 115 | Two roles carry near-identical text (TWR-28, OCC-12/13/30) | TWR-28, OCC-30 |
| `qrh-release-refused` and `qrh-send-failed` (OCC) | 2.3: 32 % `release` errors | Four prose rows and three copies of `success:false` | OCC-78..83 |

Not created: a skill for the quiet tick (it is a server step, section 4 item 1), and DUTY patterns (DUTY's transcripts are too few to show a repeat; its candidates come from the manual).

## 4. The ranked top 10

Ranked by value over effort. "Measure" is what shows it worked. Tiers follow `deploy/landing-tier.mjs`: control-folder manuals and CLI `flagged`, `rulebook/` and guards `user`.

| # | What | Value (evidence) | Effort | Tier | Measure |
|---|---|---|---|---|---|
| 1 | **Quiet-tick short-circuit in the server**: a composite `atcctl tick` per role (TOWER first) that runs `manual check`, the brief and the ack and wakes the model only when the brief has work; tune SQUELCH fingerprints. Covers ATC-274 work orders 3 and 10. | 1,816 TOWER ticks, 51 % quiet; 63 % MCC, 79 % CROSSCHECK, 93 % REVIEW; about 1.2 G cache-read tokens in five days | M | `flagged` (a guard change would be `user`) | Ticks that reach the model per hour; wrong-skip count (a tick skipped while the brief had work) must be 0 in shadow |
| 2 | **One manual PR per role**: `/tick` becomes a pointer, duplicates go, guard-enforced prose goes, shared lines join one memory block. Merges ATC-274 work order 2 with ATC-281 work order 5. OCC first (the `/tick` body is 39 % of its growth), then MCC, TOWER, CROSSCHECK, REVIEW. | OCC 4.6 k tokens per fire; MCC repeats its inspect step in two places and the inspector criteria in two files (about 2.2 KB); about 4 KB of shared text sits in three manuals alone | M per role | `flagged` | Always-loaded tokens (ATC-274 ledger); re-injected tokens per hour |
| 3 | **TOWER's conditional rules computed by the server** into the `brief` (the way `landText` and `infoText` already are): TWR-09..27 are about 9.1 KB of the 14.4 KB manual and all are deterministic | A 5 k-token manual shrinks by about half; fewer wrong or missed CLEARANCEs | L | `flagged` | Manual size; TOWER LOG lines needing a manual re-read |
| 4 | **`qrh-release-refused` and `qrh-send-failed`** (OCC), named by the server on the error code (ATC-288 `qrhOf`) | 78 of 242 `dispatch release` calls errored | S, after the pilot skills | `user` (`rulebook/`) | Release error rate; calls after a refusal that follow the QRH |
| 5 | **OCC forks**: proposal review with BRIEFING (about 9.5 KB of procedure) and the draft family CLASSIFY, PRIORITIZE, CLOSE, WAYPOINT (schedule.md, 27.9 KB). Start with the scratch experiment of the issue (at most 3 USD) and check that OCC may spawn a fork. | `schedule.md` is read in most sessions yet only 21 drafts were written; a fork keeps its reading out of the parent | L | `flagged` (control-folder) and `user` if the guard or settings change | Parent-context growth per draft against inline; verdict agreement on a recorded sample |
| 6 | **`sop-flight-plan-cycle`, `sop-clearance-cycle`, `sop-replies`** | Section 3.7: the cycles run 100s of times and are spread over several places | S to M | `user` (`rulebook/`) | Retries (3 in a row) and error rate of the cycle commands |
| 7 | **Shared memory block** and deletion of the copies: SQUELCH note (5 copies), LOG format (6), language (4), manual check/ack (6), guard-block rule (4) | About 4 KB of duplicates in TOWER, REVIEW and CROSSCHECK, more in MCC, DUTY, OCC | S | root `CLAUDE.md` is `user` | Duplicated bytes (a grep) |
| 8 | **MCC**: delete the inspector criteria from `CLAUDE.md`; composite "land all unblocked, RTS when due"; put the `mcc inspect` record syntax into the inspect step | 15 % of `mcc inspect` calls error; criteria edited in two places | S to M | `flagged` | `mcc inspect` error rate; MCC manual size |
| 9 | **DUTY procedure documents** (`sop-design-doc`, `sop-work-order`, `sop-adopt`) read with Read, plus server checks for what code can verify: full-URL references, English body, `Fixes` against `Refs` | DUTY writes these from memory today; the code checks priority and state but not these three | M | docs `auto`; the checks `flagged`; a `Skill` tool for DUTY is `user` | Work orders needing a correction after review |
| 10 | **CROSSCHECK and REVIEW checklists** (`cl-crosscheck-verdict`, `cl-crosscheck-chips`, `cl-landing-review`, `cl-security-pr`) | Low volume (107 and 33 worked ticks), but a FLIGHT chip sends a proposal to PREFLIGHT HOLD, hard to undo | S each | `user` (`rulebook/`); REVIEW and CROSSCHECK need the plugin route (read-guard) | Disagree marks later overturned |

## 5. Order of work, and fit with the plans

The rule: **no file is edited twice.** The control manuals are touched by ATC-274 work order 2 (pointer), work order 3 (composite tick), ATC-281 work orders 5 and 8 (memory block, ack) and this survey's rows. One manual PR per role does the pointer, the dedupe, the memory block and the skill IDs together, so it must come after the IDs exist.

1. **Server steps that need no manual change.** Item 1 (composite tick, SQUELCH tuning) with a shadow period; the TOWER server moves (item 3) for TOWER, **before** TOWER's manual PR, so that PR is one edit.
2. **Rulebook prerequisites** (ATC-281 work orders 1 to 4): the landing-tier rule (ATC-286, in review), `qrhOf` shadow (ATC-288), the Skill-call reader (ATC-289), the pilot skills (ATC-290). Add `qrh-release-refused` and `qrh-send-failed` to the pilot set.
3. **Per-role manual PRs**, OCC, MCC, TOWER, CROSSCHECK, REVIEW, each citing skill IDs (item 2). Add the control-session delivery for REVIEW and CROSSCHECK first: `--plugin-dir` at LAUNCH (ATC-281 work order 7), because their read-guard stops a plain Read of `rulebook/`.
4. **New skills** from section 3.7 (item 6) with the manual PR of the same role.
5. **OCC forks** (item 5) last: they change the structure of OCC's tick, so run the scratch experiment first and do the OCC manual PR once.
6. **DUTY** (item 9) in parallel: it touches `duty/` and `docs/` only.

**Language (D1).** Skill bodies are English, as ATC-281 decided. A converted procedure has **one** copy, English, in `rulebook/`; its Korean summary for the SUPERVISOR goes to `docs/guide/`, and the `*.en.md` translation of the removed paragraph is deleted with it. What stays in `CLAUDE.md` is the memory block and the pointers; those keep the Korean original and `*.en.md` until D1 is settled for memory items. Tokens: the Korean files measure 1.7 to 2.0 characters per token; the same procedure in English is usually shorter in tokens, which is a second saving on top of moving it out (not measured here).

**SAFETY REPORT, CONTROL RECYCLE, WATCH.** The SAFETY REPORT `rule` field takes a checklist ID (ATC-281 work order 11), so each new skill needs a stable ID from the start. The CONTROL RECYCLE relief briefing (ATC-274 work order 5) should point at skill IDs instead of repeating text. WATCH (a future control role) starts with the pointer-tick pattern from item 2 and needs a `Skill` tool in its tool list from the beginning, which DUTY lacks.

## 6. Follow-up work orders (not created in Linear)

| # | Title | Scope | Expected tier |
|---|---|---|---|
| 1 | Composite `atcctl tick` and quiet-tick short-circuit, TOWER first | `controller/atcctl.mjs`, a server tick view, SQUELCH fingerprints; shadow log of would-skip against would-act; guard allow lists admit the command | `flagged`; `user` if a guard changes |
| 2 | TOWER conditional rules into the `brief` | server `brief` fields for TWR-09..27 (ground stop, slot, GO AROUND, FUEL, health, resend), tests | `flagged` |
| 3 | OCC manual PR: pointer, dedupe, memory block, skill IDs | `occ/CLAUDE.md`, `occ/.claude/skills/tick/*` (after 8 and the pilot skills) | `flagged` |
| 4 | MCC, TOWER, CROSSCHECK, REVIEW manual PRs, one each | the role's `CLAUDE.md` and `tick/SKILL.md` | `flagged` |
| 5 | `qrh-release-refused`, `qrh-send-failed` | `rulebook/skills/`; English; names the ATC-288 codes | `user` |
| 6 | `sop-flight-plan-cycle`, `sop-clearance-cycle`, `sop-replies` | `rulebook/skills/` | `user` |
| 7 | Shared memory block in root and folder `CLAUDE.md` | the lines listed in item 7 | `user` (root file) |
| 8 | MCC: composite "land all unblocked, RTS when due", `mcc land` prints the flagged-landing LOG lines, inspector criteria single copy | `controller/atcctl.mjs`, `server/mcc*.ts`, `mcc/CLAUDE.md` | `flagged` |
| 9 | Control-session `--plugin-dir` and read-guard decision for REVIEW and CROSSCHECK | `server/session-control.ts`; read-guard only if the plugin route is rejected | `flagged` / `user` |
| 10 | SURVEY or experiment: OCC fork (CLASSIFY, review plus BRIEFING) in scratch, and whether OCC may spawn it | scratch folder, fake `atcctl`, at most 3 USD | `auto` (docs) |
| 11 | DUTY procedure documents and the three server checks | `docs/` (`sop-design-doc`, `sop-work-order`, `sop-adopt`), `server/duty-linear.ts` checks | docs `auto`, checks `flagged` |
| 12 | SURVEY: SUPERVISOR requests by hand, by kind | a hand count over a week, as ATC-258 did | `auto` (docs) |
| 13 | CROSSCHECK and REVIEW checklists | `rulebook/skills/cl-*` | `user` |
| 14 | `manual check` covers `rulebook/` and any skill folder | `controller/atcctl.mjs` `manualFiles()` | `flagged` |

## 7. What this survey does not say

- Frequencies other than section 2 are estimates; "rare" and "occasional" in the tables are not counted.
- The error causes are unknown (no error text was read). The 32 % release error rate may include cases the server rightly refuses; the skills' value is in naming the next step, not in removing every error.
- Token figures use character-per-token ratios from ATC-274 and are rough, especially for DUTY and the English `inspector.md`.
- **Unverified:** whether a fork can run from OCC or TOWER; whether the `/loop` fire re-injects the whole `/tick` body each time (assumed, as in ATC-274); whether TOWER's Bash guard restricts atcctl subcommands (its no-flag mode showed no allow list); whether TOWER has an MCP guard; the current DISPATCH and SCHEDULE modes, which decide how live the `flight-plan.md` and S2 rows are.
- DUTY's patterns could not be observed (18 requests in the window); its candidates come from the manual and the server code.

## Sources

`controller/`, `occ/`, `mcc/`, `crosscheck/`, `review/`, `duty/` manuals, skills, guards and settings at `origin/main` on 2026-10-01; `server/session-control.ts`; `deploy/landing-tier.mjs`; [skill-rulebook.md](skill-rulebook.md); [control-context.md](control-context.md); control-session transcripts as described under Method (counts only).
