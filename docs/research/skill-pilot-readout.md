# Skill pilot readout: were the pilot items called on the FLIGHTs that needed them?

**English** · [한국어](skill-pilot-readout.ko.md)

> CHECK FLIGHT [ATC-358](https://linear.app/vocado/issue/ATC-358), the readout [ATC-282](https://linear.app/vocado/issue/ATC-282) section C planned. Read-only: nothing in Linear, GitHub issues, skills, manuals, guards, settings or `~/.local/state/atc/` was written, and no session was messaged. Read on 2026-10-02 around 04:50 UTC.

## 1. Summary

| Item | Expected | Called | Missed | No data | Verdict |
|---|---|---|---|---|---|
| `diagnosing-bugs` | 1 | 0 | 1 | 0 | **keep, re-route** (sample of one: no verdict on its value) |
| `ui-review` | 23 | 9 | 13 | 1 | **keep, re-route** |
| `codebase-analyzer` | none | 3 calls on 3 FLIGHTs, 1 session | n/a | n/a | **keep**, look again later |
| `codebase-locator` | none | 0 | n/a | n/a | **drop** |

- The routing line in `atc-task` is not what opens these skills. Of 19 AIRCRAFT sessions that flew an eligible FLIGHT, 6 opened `atc-task` at all, and 5 of the 13 that did not still called `ui-review`. A session that calls a skill once keeps going without calling it again: `ui-review` was called on the first screen FLIGHT of a session and skipped on the later ones (section 4).
- The counts in `GET /api/skills/usage` are right for what they count, but three reader quirks hide the per-FLIGHT picture (section 7).
- FUEL per FLIGHT is about 20% above the baseline median, but the sample is small and the mix differs; it does not separate called from missed FLIGHTs (section 6).

**Check on 2026-10-06 (read-only, `GET /api/skills/usage?days=7`).** The daily lines up to 2026-10-05 show the same pattern: `diagnosing-bugs` and `codebase-locator` were not called on any day, `codebase-analyzer` was called 2 times on each of 2026-10-02 and 2026-10-03, and `ui-review` kept being called (11 and 15 times on 2026-10-02 and 2026-10-03, 1 on 2026-10-05). No verdict changes, so the per-FLIGHT counts above (from 2026-10-02) are not recomputed.

## 2. Window and method

- **Window.** The pilot (`diagnosing-bugs`, `codebase-*`) reached `main` at 2026-10-01 06:04Z (#345), `ui-review` at 06:20Z (#350). The window runs to 2026-10-02 04:50Z. Merged atc PRs in it: 49, of which 41 are FLIGHTs whose STAND started at or after 06:04Z, and 23 of those change `web/src` and started at or after 06:20Z.
- **Eligible FLIGHT.** One whose STAND was claimed after the routing line reached `main` (the STAND checks out `origin/main`, so an older STAND holds an older `atc-task`). Eight PRs that merged in the window are left out: six FLIGHTs whose STAND started earlier (for example ATC-270, ATC-283, ATC-293) and two PRs without an ATC key. ATC-268 (a screen FLIGHT claimed at 06:12Z) counts for the pilot but not for `ui-review`, which reached `main` at 06:20Z.
- **Expected.** `diagnosing-bugs`: the Linear issue has the `Bug` label (the title or body alone was not used). `ui-review`: the PR diff touches `web/src`. `atc-task`: every FLIGHT. No expectation for `codebase-*`.
- **Called.** A `Skill` call (or an `Agent` call for the sub-agents) in a transcript of the AIRCRAFT that flew the FLIGHT, within the FLIGHT's time (claim time minus 5 minutes to merge plus 5 minutes). Sessions are matched to FLIGHTs by AIRCRAFT name and time from `departures.jsonl`. A session often flies several FLIGHTs one after another, so a call belongs to the FLIGHT in whose window it falls.
- **Data read.** Names, timestamps and `subagent_type` only, streamed line by line from the transcripts of atc folders and STANDs; no message text. `GET /api/skills/usage?days=3` for the daily lines; `GET /api/logbook?days=14` for FUEL; `gh pr list --state merged`; Linear labels through a read-only list.
- **Limits.** Transcripts of finished STANDs are being removed, so the daily line of 2026-10-01 holds calls that no transcript on disk shows any more (section 7, quirk 3). One eligible FLIGHT has no session record at all. Sub-agent (sidechain) calls are not counted by the reader.
- **Other AIRPORTs: 3 named sessions** appear in the daily line (1 skill call, 12 agent calls, none of the four pilot items). Nothing else about them is used here.

## 3. Calls per day (the daily line)

| | 2026-10-01 (UTC, full day) | 2026-10-02 (to 04:42Z) |
|---|---|---|
| `atc-task` | 12 | 1 |
| `ui-review` | 13, plus 2 under a worktree-prefixed name | 0 |
| `diagnosing-bugs` | 0 | 0 |
| `codebase-analyzer` (agent) | 3 | 0 |
| `codebase-locator` (agent) | 0 | 0 |
| built-in `Explore` / `general-purpose` (agent) | 23 / 111 | 0 / 0 |
| `tick` | 16 | 3 |

The 2026-10-01 line covers the 6 hours before the pilot reached `main` as well, so it over-counts the window. The built-in agents are called far more than the pilot ones, and `general-purpose` is the one sessions reach for (111; MCC's `inspector` is a separate agent, 91).

## 4. Per item

### 4.1 `ui-review` (expected 23)

- **Called (9):** ATC-263, ATC-287, ATC-300, ATC-313, ATC-315, ATC-316, ATC-325, ATC-327, ATC-328. ATC-263 and ATC-325 were called by a worktree-prefixed name (quirk 1).
- **Missed (13), session transcript exists:** ATC-271, ATC-284, ATC-301, ATC-305, ATC-308, ATC-310, ATC-312, ATC-314, ATC-317, ATC-330, ATC-334, ATC-346, ATC-73.
- **No session record (1):** ATC-348.
- **ATC-305 note:** its only `web/src` change is one navigation entry of the DOCS tab. It is borderline; counting it out moves 9/22.
- **Question 2 (did the session open `atc-task`; did that revision carry the line).** Of the 13 misses, the session opened `atc-task` for 6 (ATC-317, ATC-330, ATC-334 in one session that opened it once at its first FLIGHT; ATC-271 in a session whose `atc-task` predated the routing line; ATC-301 and ATC-314). For the other 7 it never opened `atc-task` at all. Where `atc-task` was opened after 06:20Z (ATC-301, ATC-314, ATC-317, ATC-330, ATC-334) the file held the screen-FLIGHT line, so the line was in front of the session and was not followed.
- **Pattern.** Per session, the first screen FLIGHT after the session started got `ui-review`, the later ones did not: one session called it on ATC-263 and ATC-325 but not on ATC-308 and ATC-312, which came between them; another on ATC-287 and not ATC-284 or ATC-310; another on ATC-316 and not on ATC-317, ATC-330 or ATC-334. The brief for each FLIGHT arrives as a message; the routing line sits in a file read once.
- **ATC-281 predicted this.** A skill named in the text the session reads for this FLIGHT is opened 16 of 16 times; one it must remember from a long list, 4 of 16 ([research/skill-rulebook.md](skill-rulebook.md) 4.2). Here 9 of 22 FLIGHTs with data: above the 4 of 16, far below the 16 of 16.
- **Verdict: keep, re-route.** The skill is called when the session is reminded and costs nothing until then. Move the reminder from `atc-task` to the per-FLIGHT text: the brief and FLIGHT PLAN name `ui-review` when the issue has the `rating:UI` label or the diff will touch `web/src`; and `atc-task` gets one sentence saying a session that takes a further FLIGHT without restarting reads the section 3 lines again for it (written out in work order W2).

### 4.2 `diagnosing-bugs` (expected 1)

- **Expected:** ATC-330 (label `Bug`: the AUTOLAND GROUND STOP never latched). No other FLIGHT in the window carries `Bug`.
- **Called: 0. Missed: ATC-330.** The session had opened `atc-task` at its first FLIGHT of the session, 70 minutes earlier, after the routing line was on `main`, and flew ATC-330 as its third FLIGHT without calling `diagnosing-bugs`. The same pattern as `ui-review`.
- **Verdict: keep, re-route.** One expected FLIGHT is no sample: it says nothing for or against the skill. The scratch test in #345 (the skill opened on a bug FLIGHT told to follow `atc-task` section 3) shows the skill works when asked. Re-route like `ui-review`: the brief names it when the issue has `Bug`. Check again when 10 `Bug` FLIGHTs have run (work order W5).
- Title-based "bug" FLIGHTs without the label (for example ATC-301, ATC-312, ATC-314) were not counted; none of them called it either.

### 4.3 `codebase-analyzer` (no expectation)

- **Calls:** 3, all in one session, on ATC-332 (a survey), ATC-333 (a design draft) and ATC-334 (a build). Three FLIGHTs of 41 eligible; one of 19 sessions.
- **No evidence either way on context savings:** the pre-pilot baseline sessions are gone from disk (only one of the ten baseline FLIGHTs has a transcript folder left), so main-context size at PR time cannot be compared.
- **Verdict: keep.** It is used where a FLIGHT needs reading across many files. Look again in the next readout; if it is still one session's habit, treat it as a personal tool and stop routing to it.

### 4.4 `codebase-locator` (no expectation)

- **Calls: 0** on the full 2026-10-01 line and on 2026-10-02. In the ATC-282 scratch check it was called once, after two plain searches.
- **Overlap:** the built-in `Explore` agent (23 calls on 2026-10-01) does the same job (paths from a wide search) and is already in every session. `codebase-locator` adds a vendored file, a third-party notice and a routing line for a call nobody makes.
- **Verdict: drop.** Remove `.claude/agents/codebase-locator.md`, its `THIRD_PARTY_NOTICES.md` entry, and name only `codebase-analyzer` and the built-in `Explore` in the `atc-task` line (work order W4). The vendored file stays in git history for a later return.

## 5. `atc-task` (the router)

- 41 eligible FLIGHTs ran in 19 sessions on disk; 6 sessions opened `atc-task`. The sessions flew 1 to 6 FLIGHTs each, so a FLIGHT-level "every FLIGHT calls it" expectation is too strict: a session that already holds the skill does not need to call it again, and a skill that is in context is not a miss.
- The 13 sessions that never opened it include 5 that called `ui-review`, so a skill is also found without its routing line (the listing and `description` carry it, or the brief did).

## 6. FUEL and context against the baseline

FUEL is the logbook's captain plus crew tokens per FLIGHT, weighted for comparison (input 1, cache write 5 m 1.25, cache write 1 h 2, cache read 0.1, output 5, in millions; a proxy, not a bill). Only Sonnet FLIGHTs, so one Opus FLIGHT is left out.

| Group | n | median | mean |
|---|---|---|---|
| Baseline (the 10 FLIGHTs in #345) | 10 | 2.16 | 1.93 |
| Window BUILD FLIGHTs | 37 | 2.57 | 2.77 |
| Window BUILD, `rating:UI` | 18 | 2.55 | 2.78 |
| Window BUILD, not UI | 19 | 2.57 | 2.76 |
| Eligible screen FLIGHTs where `ui-review` was called | 9 | 3.08 | |
| Eligible screen FLIGHTs where it was not | 13 | 2.83 | |

- The window is about 19% above the baseline median. The baseline has 6 UI and 4 non-UI FLIGHTs (medians 2.38 and 1.11), so the baseline's mix differs; the window has no meaningful UI split.
- Called versus missed differs by 9% (3.08 against 2.83) on 9 and 13 FLIGHTs, inside what two FLIGHTs of different size move. **Small-sample caveat:** n is 9 and 13, FLIGHTs in one session share a cache, and sizes range from 0.2 to 7.1. No conclusion on whether any item saves or costs tokens.
- **Context size at PR time was not measured:** transcripts of the baseline sessions are gone and most window sessions run several FLIGHTs, so the last `usage` of a session is not one FLIGHT's.

## 7. Reader quirks (`server/skill-calls.ts`, `server/skill-calls-run.ts`)

| # | Quirk | Evidence | Proposed fix |
|---|---|---|---|
| 1 | A skill called by a directory-scoped name (`.claude/worktrees/<stand>:ui-review`) is counted under its own key. | 2 calls on 2026-10-01 under two keys, none under `ui-review`. Claude Code lists directory-scoped skills with a path prefix, so a session may type it. | In `usageOf`, count by `baseName` (the function exists for `qrh`) and keep the raw spelling in a `names` list. Test: the two keys add to `ui-review`. |
| 2 | The `unknown` bucket: 12 skill calls on 2026-10-01. | `usageOf` names a session from its `agent-name` line, else the control-folder role, else `unknown`. Likely sessions without a name: `claude -p` runs (the A/B and scratch checks) and unnamed user sessions. Their transcript folders are now empty, so the 12 cannot be broken down. | Record the folder kind with each session (`stand`, `repo`, `scratch`, `control`) and split `unknown` into `unnamed` and `scratch`. Skip scratch folders (`…-tmp-scratch…`, job `tmp`) in the day count. |
| 3 | The only durable record is the day total; per-FLIGHT data lives in transcripts that are removed. | 2026-10-01 holds 13 plain `ui-review` calls; the transcripts still on disk show 7 plain ones. 6 are gone. The folders of the pre-pilot baseline STANDs are gone too. | Add a `calls` list to each day line: short session id, folder kind, STAND name (from the folder), name, time. No text. The next CHECK then needs no transcript. |
| 4 | `tick` counts one per loop start, not one per firing. | 16 on 2026-10-01 = TOWER 3 + OCC 3 + CROSSCHECK 2 + MCC 6 + REVIEW 2 exactly, while TOWER's 3-minute loop fires about 480 times a day. A `/loop … /tick` is visible as a `Skill` call at each (re)start; later firings reuse the loaded skill. | Document it (section 8). Do not read `tick` as a count of ticks. |
| 5 | Sidechain calls are skipped on purpose (`isSidechain`), so a skill a sub-agent opens is not counted; a typed `/ui-review` is a user message, not a `Skill` call. | `scanLine` | Document in `docs/skills.md` section 6. No code change. |
| 6 | Counts are per day and per session; a FLIGHT is not a key. | the endpoint | Quirk 3's `calls` list plus a `?flight=` view. |

## 8. Correction to `docs/skills.md` section 6

The "Not verified" line is settled and corrected in this PR (and its Korean guide): `/loop … /tick` does show up as a `Skill` call named `tick`, once per loop (re)start. Reading `skills["tick"]` as the number of ticks is wrong.

## 9. Follow-up work orders (to file; none is filed here)

| ID | Title | Scope | Expected tier |
|---|---|---|---|
| W1 | Reader: count `ui-review` and `diagnosing-bugs` by base name; split `unknown`; add a per-call list | `server/skill-calls.ts`, `server/skill-calls-run.ts` and tests (quirks 1, 2, 3, 6); one new field `calls` in the day line, old lines still read; no change to `GET /api/skills/usage` fields that exist | `auto` (read-only server code) |
| W2 | Name the pilot skills in the per-FLIGHT text | the brief generator and FLIGHT PLAN text add one line: `Before the PR, call Skill ui-review (mode diff)` when the issue has `rating:UI` or the plan lists `web/src`; `Before changing code, call Skill diagnosing-bugs` when it has `Bug`. `atc-task` section 3 gets one sentence: a session taking a further FLIGHT reads these lines again. Do not change when a plan is sent or the record format | `user` for the `atc-task` edit (root `.claude/`); `flagged` for the server text. Two PRs |
| W3 | `docs/skills.md` section 6: `tick` once per loop start; sidechain and slash-command notes | documentation; also the Korean guide | `auto` (done in this PR for the `tick` line) |
| W4 | Drop `codebase-locator` | delete the agent file and its `THIRD_PARTY_NOTICES.md` entry; edit the `atc-task` line to name `codebase-analyzer` and the built-in `Explore`; update `docs/skills.md` 2.1 and the guide | `user` (root `.claude/`) |
| W5 | CHECK: pilot readout after W1 and W2 | open after 10 `Bug` FLIGHTs and 10 more screen FLIGHTs; read the `calls` list instead of transcripts; compare called against missed FUEL again | `auto` (docs) |
| W6 | Find out why finished STANDs' transcript folders disappear | read-only survey of what removes them and whether the retention setting can be longer for atc folders; the day line cannot recover what it did not record | docs only |

## 10. Pilot's discretion

- Counted `Bug` by the Linear label only.
- Counted the three older STANDs out of "eligible" by claim time rather than by merge time.
- Gave FUEL as a weighted proxy from the logbook, not the logbook's own cost field, so the groups compare on one scale.
- Wrote `codebase-locator` as drop: the evidence is one day and zero calls, and the vendored file can come back from git; the SUPERVISOR may choose to keep it for one more readout.
