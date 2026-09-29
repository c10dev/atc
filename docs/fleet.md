# FLEET design (draft)

**English** · [한국어](fleet.ko.md)

atc knows each team session as an AIRCRAFT (`TEAM_B`, callsign BRAVO) and its leader as the CAPTAIN. It knows nothing else about the team: who is on board, what kind of work it can fly, which projects it usually flies, or what it is aiming for. It knows just as little about a FLIGHT: whether it is a big build, a quick fix, research or a review. This document adds both sides, in airline operations terms:

- **FLEET**: the teams, their crews, what they are rated for, their routes and targets.
- **FLIGHT classification**: the kind of work, its size and the rating it needs.

> Status: design draft (2026-09-26, updated 2026-09-27). Built so far: TAIL ASSIGNMENT (`tail:TEAM_X`, with `lane:TEAM_X` read as an alias until 2026-10-10), the FLEET registry and tab (step 2), observed crew and CREW CHANGE steps 1 and 2 (sections 8.3 and 8.4; step 2, OCC sending it, only in DISPATCH approval mode), step 3: the planner reads the classification labels and applies the TYPE RATING, crew, WAKE and ROUTE rules, then STAND-free FLIGHTs for HOLDING and PARKED teams and CHECK independence (see section 5 for what is left), STAND-free departure and arrival (section 5.1.1), OCC S1 `CLASSIFY` drafts (section 6), team building (section 8.1), the LOGBOOK with TARGETS actuals on the FLEET cards (sections 7.1 and 7.2), NETWORK (section 7.3), the DEPARTURE LOG (section 7.5), CHECKRIDE recommendations for TYPE RATINGS (section 8.2), session control: LAUNCH and STOP (section 8.5), FLEET PLAN in shadow and approval with REFRESH (sections 8.6 and 8.7, ATC-69), FOB on the FLEET list (ATC-81), and one REGISTRATION for session-name spellings (ATC-67). Decisions are listed at the end.

Related: [occ.md](occ.md) (OCC writes the classification and tail labels as SCHEDULE operations), [dispatch.md](dispatch.md) (the planner that uses them).

## 1. Current facts

| Item | Today |
|---|---|
| Teams | Six long-lived sessions `TEAM_A` … `TEAM_F` in `vocado_nextjs`, each with a leader and teammates |
| Crew rules | vocado `CLAUDE.md`: teammates default to `claude-opus-5-5`; `ui-builder` (Opus) builds UI; `ui-qa` (Muse Spark 1.3) is read-only visual and accessibility QA; `flash-helper` (DeepSeek V4.1 Flash) does search, summaries, reference collection and exactly specified mechanical edits, and never implementation, review verdicts, security, DB, auth, rights or anything needing images |
| Risky work | DB, migration, security and rights work uses the `Codex Engineering Task` template; DISPATCH marks it CAUTION |
| What atc sees of a team | Session name, status (AIRBORNE / HOLDING / PARKED), claimed worktrees, past FLIGHTs (team fit) |
| Sizing | Linear has 0 estimates. The planner counts WAKE-weighted AIRPORT slots (L 0.5, M 1, H 2; section 5), 1 FLIGHT per TEAM under the STAND rule, plus at most one STAND-free FLIGHT per TEAM (section 5.1) |
| Pre-assignment | `tail:TEAM_X` label: proposed only to that team. `lane:TEAM_X` (PR #7) is still read as an alias until 2026-10-10 (section 9) |

What the old state (1 slot per FLIGHT, `lane:` only) caused on 2026-09-26:

- VOC-196 (a security static gate) was proposed to TEAM_D, then TEAM_B, while its body said "TEAM_E, on Opus". Nothing in atc could express that.
- A security ticket and a one-line docs fix look the same to the planner: one slot each, any team.
- The "on-time" metric for stage 4 has no expected duration to compare against.

## 2. Terms

| Concept | Term | Meaning | Example |
|---|---|---|---|
| All teams | **FLEET** | The AIRCRAFT the operator (the user) runs | TEAM_A … TEAM_F |
| Team identity | **REGISTRATION** / **callsign** | Registration is the fixed name (the session name); callsign is how it is spoken | `TEAM_B` / BRAVO |
| Team leader | **CAPTAIN** | Unchanged | TEAM_B's leader session |
| Team members | **CREW** | Everyone on board under the CAPTAIN, each with a **POSITION** | `backend` (Opus), `ui-builder`, `ui-qa`, `flash-helper` |
| Standard team makeup | **CREW COMPLEMENT** | The crew an AIRCRAFT normally flies with | CAPTAIN + backend (Opus) + Codex review |
| What a team may fly | **TYPE RATING** | Kinds of work the crew is qualified for | `SEC`, `UI`, `DATA`, `DOCS` |
| Pre-assigning a FLIGHT to a team | **TAIL ASSIGNMENT** | Airline scheduling term for binding a flight to a specific aircraft. Replaces `lane:` | Linear label `tail:TEAM_E` |
| A team's usual area | **ROUTE** | The Linear projects it mostly flies | TEAM_B → Beta Readiness |
| A team's goals | **TARGETS** | Operating goals the SUPERVISOR sets per AIRCRAFT | FLIGHTs per week, on-time rate, zero reverted work |
| Kind of work | **FLIGHT TYPE** | What the FLIGHT is for (section 4.1) | `BUILD`, `SURVEY`, `CHECK` |
| Size of work | **WAKE CATEGORY** | How much capacity it takes (section 4.2) | `L`, `M`, `H`, `J` |

"TYPE RATING" belongs to a crew and "FLIGHT TYPE" to a FLIGHT; the full names are always used so they don't blur.

## 3. FLEET registry

Kept in `~/.local/state/atc/fleet.json`, like the AIRPORT registry (`airports.json`): the SUPERVISOR edits it in a FLEET tab, and atc falls back to defaults when it is missing.

```json
{
  "defaults": {
    "complement": [
      { "position": "backend", "agent": "claude-opus-5-5" },
      { "position": "ui-builder", "agent": "ui-builder" },
      { "position": "ui-qa", "agent": "ui-qa", "limits": ["read-only"] },
      { "position": "flash-helper", "agent": "flash-helper", "limits": ["no BUILD", "no CHECK verdicts", "no SEC"] }
    ],
    "ratings": ["UI", "DATA", "DOCS"]
  },
  "aircraft": {
    "TEAM_B": { "base": "VCDO", "ratings": ["SEC", "DATA", "DOCS"], "routes": ["Beta Readiness"], "targets": { "flightsPerWeek": 3, "onTime": 0.8 } },
    "TEAM_E": { "base": "VCDO", "ratings": ["SEC", "DATA"], "routes": ["Beta Readiness"] },
    "TEAM_F": { "base": "VCDO", "ratings": ["UI", "DOCS"], "routes": ["Song Experience"] }
  }
}
```

- **CREW COMPLEMENT** is declared, not detected. atc also shows the crew it actually observes (subagent calls recorded under the CAPTAIN's sessions, section 8.3). The FLEET tab shows both side by side, so drift is visible.
- **TYPE RATING** starts from what the complement allows. A crew whose only helper is `flash-helper` cannot hold `SEC`, because vocado forbids DeepSeek for security work.
- **ROUTES** and **TARGETS** are set by the SUPERVISOR. OCC may draft changes (stage 4) but never applies them.

### REGISTRATION spellings as built (ATC-67)

atc reads one REGISTRATION the same way everywhere, whatever the session name's spelling. `server/registration.ts` `registrationOf(name, teamPattern)` maps any name that DISPATCH's `teamPattern` accepts to the canonical form: upper case with `_` (`Team G`, `TEAM-G`, `team_g`, `TEAMG` → `TEAM_G`). With no separator it inserts `_` at the first place the pattern accepts, so a custom `teamPattern` still decides. Names the pattern rejects (TOWER, OCC, President) give `null` and are compared in upper case, as before.

- **Reads.** Every place that compares a session or AIRCRAFT name with a REGISTRATION uses it: FLEET (`fleetView`, card APIs, ENTRY INTO SERVICE), DISPATCH (tails, CHECK independence, FUEL lookup, profile and ACCOUNT via `crew.ts`), CREW CHANGE, observed crew, CHECKRIDE, BRIEFING, FLEET PLAN, ATFM auto eligibility, FUEL members and FUEL BURN, FLIGHT FOLLOWING, session control (`sameName`), `tail:` labels (`tail:team-g` is `TEAM_G`) and TAIL drafts. A `fleet.json` key written as `Team_G` is still found and is not rewritten.
- **New records.** LOGBOOK `aircraft`, DEPARTURE LOG lines, FLIGHT RECORDER `fleet` and `checkride` lines, FLEET PLAN proposals and sessions launched by atc use the canonical REGISTRATION. Old lines keep their spelling and match on read. Two records keep the live session name on purpose, because they name the SendMessage recipient that `occ/send-guard.mjs` compares exactly: DISPATCH proposals' `aircraftName` and CREW CHANGE `registration` (SUPERVISOR decision, 2026-09-28). The guard is unchanged.
- **FLEET.** A live team session whose name is not canonical shows a one-line hint on its AIRCRAFT, `세션 이름 Team G → TEAM_G로 바꾸면 좋다`, and a small `이름` tag in the status list; the session stays linked. Two or more live sessions that read as the same REGISTRATION are shown as a conflict (`세션 2개가 TEAM_H로 읽힘: …`, a solid `세션 2개` tag) and are not merged. Deciding which one is SUPERSEDED is idea [#96](https://github.com/chaehy5665/atc/issues/96).

## 4. FLIGHT classification

Three independent axes. Each is a Linear label that OCC owns (a plan field in occ.md section 4).

### 4.1 FLIGHT TYPE: what kind of work

| FLIGHT TYPE | Aviation sense | Work | Needs a STAND | Crew that may fly it | Example |
|---|---|---|---|---|---|
| `BUILD` | Scheduled revenue flight | Implement a change and open a PR | Yes | Opus / `ui-builder`; never `flash-helper` | VOC-193 caller checks |
| `MAINT` | Maintenance check | Refactor, cleanup, infra, CI, tests, no product behavior change | Yes | Opus | VOC-195 lock race fix |
| `TEST` | Test flight | Spike or prototype that may be thrown away | Usually | Opus | A new replay architecture tried in a scratch branch |
| `SURVEY` | Survey flight | Research, audit or inventory, producing a document or findings, no code | No | Opus; `flash-helper` for non-security search and summaries | Linear usage research, Mobbin references |
| `CHECK` | Check ride | Review a PR or audit a claim; the output is a verdict | No | Opus (the CAPTAIN or an independent session); never `flash-helper` | The exact-head review of PR #400 |
| `FERRY` | Ferry flight | Mechanical move with no design decision: dependency bump, rename, docs fix of 5 lines or less | Sometimes | Any, including `flash-helper` for exactly specified edits | VOC-56 closure evidence, a typo fix |

What it changes:

- `SURVEY` and `CHECK` need no worktree, so they don't count against the 1-FLIGHT-per-TEAM STAND rule. A HOLDING or PARKED team can take one, one per AIRCRAFT (section 5.1).
- `CHECK` is never assigned to the team that flew the BUILD it reviews (independence, like TOWER not judging its own assignments; section 5.2).
- `FERRY` FLIGHTs can be batched: one CAPTAIN takes several in one pass.

### 4.2 WAKE CATEGORY: how big

Aircraft are sorted by wake turbulence category, and heavier aircraft need more spacing and runway time. A FLIGHT's WAKE CATEGORY says how much capacity it takes.

| WAKE | Size | Rough shape | Expected block time | AIRBORNE slots it takes |
|---|---|---|---|---|
| `L` Light | Small | One file or a few lines, no new tests needed | < 1 hour | 0.5 |
| `M` Medium | Normal | One feature or fix with tests, one PR | a few hours | 1 |
| `H` Heavy | Large | Several modules or services, migration or security surface, multiple review rounds expected | 1–2 days | 2 |
| `J` Super | Very large | Crosses teams or AIRPORTs, needs a design first, likely split | several days | Not assignable. Must be split (a SCHEDULE `SPLIT`) or become a parent issue |

What it changes:

- **Slots**: AIRPORT capacity is counted in WAKE-weighted slots. VCDO's 4 means, for example, two `H` or four `M`.
- **Separation**: two `H` FLIGHTs linked by `related` or touching the same area get a larger conflict penalty than two `L`.
- **On-time**: the expected block time is the baseline for the stage 4 on-time metric until real history replaces it. After about 20 LOGBOOK entries per category, their median is meant to take over. Not built yet (section 7.2).
- **`J`** is a signal to plan, not to fly.

### 4.3 Required TYPE RATING: what it touches

| Rating | Covers | Rule |
|---|---|---|
| `SEC` | DB, migration, RLS, auth, permissions, security, rights, deployment, payment (the `Codex Engineering Task` scope) | Only AIRCRAFT holding `SEC`. Always CAUTION. Never automatic in any stage |
| `UI` | Screens, components, visual design, accessibility | Prefer AIRCRAFT whose complement includes `ui-builder` and `ui-qa` |
| `DATA` | Language data, pipelines, content, analytics | — |
| `DOCS` | Documentation, rule files, handoff notes | — |

A FLIGHT may need more than one (`SEC` + `DATA`). An AIRCRAFT must hold all of them.

### 4.4 Labels

| Axis | Linear label | Default when missing |
|---|---|---|
| TAIL ASSIGNMENT | `tail:TEAM_E` | Any team |
| FLIGHT TYPE | `type:BUILD` … `type:FERRY` | `BUILD` |
| WAKE CATEGORY | `wake:L` … `wake:J` | `M` |
| Required TYPE RATING | `rating:SEC`, `rating:UI`, …, or any label in vocado's existing **Risk** group (Security, Migration, Rights, Contract) → `SEC` | None. A CAUTION from DISPATCH does not add `SEC` by itself; OCC turns it into a `rating:SEC` label through a `CLASSIFY` operation (section 6) |

Labels rather than Linear estimates: estimates are one number per team setting, while four axes need four fields. Labels are visible in Linear and easy to filter. Linear estimates can mirror WAKE later if Linear-native reporting is wanted.

**Label groups.** atc reads a label inside a Linear label group as `group:name`: the Risk group's "Security" arrives as `Risk:Security`. So each axis works either as flat labels (`type:BUILD`) or as a Linear label group named `type` with children `BUILD` … `FERRY`. Groups are preferred for `type`, `wake` and `tail` because Linear's single-select groups allow only one value per issue. The old standalone labels `Risk: Security` etc. are read the same way. vocado's `Area` group (Database, Backend, Web, RN) is not used for ratings yet.

### TAIL drafts as built (ATC-68)

Who puts `tail:` on a FLIGHT (TAIL ASSIGNMENT). OCC drafts a SCHEDULE `TAIL` operation ([occ.md](occ.md) "TAIL as built"), from the SUPERVISOR's instruction at the CHARTER DESK or from the atc signal for a FLIGHT a team is already flying (STAND, DEPARTURE LOG or READBACK) with no `tail:`. Once approved and released, it sets the FLIGHT's `tail:` to that one REGISTRATION: other `tail:` labels come off, every other label stays (`lane:` too). The AIRCRAFT must be in FLEET and not RETIRED, and the flat Linear label `tail:TEAM_X` must already exist; ENGINEERING or the user creates it, OCC never does. The workspace uses flat `tail:TEAM_X` labels, not a `tail` group; a group child would not be found, so the draft is refused. Changing another team's `tail:` while it is AIRBORNE or holds the FLIGHT's STAND carries CAUTION. ENGINEERING and the user may still add a `tail:` by hand.

## 5. Planner rules

Applied in this order. The first four are hard rules, and so is the `J` exclusion in rule 5: a FLIGHT that fails them is excluded with the reason, never given to another team.

1. **TAIL ASSIGNMENT**: `tail:TEAM_X` → only that AIRCRAFT (what `lane:` does today).
2. **TYPE RATING**: the AIRCRAFT holds every required rating.
3. **FLIGHT TYPE vs crew**: the complement can fly it. `BUILD`, `MAINT` and `TEST` need a member who is not `flash-helper` and has no `no BUILD` or `read-only` limit; `CHECK` needs one without `no CHECK verdicts` or `read-only`; `SURVEY` and `FERRY` can go to any crew.
4. **CHECK independence**: a `CHECK` never goes to an AIRCRAFT that built what it reviews (section 5.2).
5. **WAKE slots**: the AIRPORT has enough weighted capacity left (L 0.5, M 1, H 2). An AIRBORNE team counts the largest WAKE among the FLIGHTs it holds, or 1 when unknown. `J` is excluded ("must be split"). STAND-free FLIGHTs take slots too.
6. **STAND**: the STAND rule, then STAND-free FLIGHTs outside it (section 5.1).
7. **Score** (soft): as today, plus **ROUTE** (+1, weight `route` in `dispatch.json`, when the FLIGHT's project is on the AIRCRAFT's routes). No bonus for idle AIRCRAFT.

When no live AIRCRAFT could ever qualify (no one holds the rating, no crew can fly the type, or only the builder could fly the CHECK), the FLIGHT is excluded with that reason. When qualified AIRCRAFT exist but are busy, it simply waits, as before.

The DISPATCH card shows the classification under the title, e.g. `BUILD · H · SEC · tail:TEAM_E`. It is greyed with "(기본값)" when there is no `type:` or `wake:` label.

### 5.1 STAND rule and STAND-free FLIGHTs

`SURVEY` and `CHECK` need no worktree (`needsStand` in `server/crew.ts`). `FERRY` "sometimes" needs one (section 4.1), so the planner treats it as needing a STAND. A FLIGHT with no `type:` label is `BUILD` and needs one.

The plan is made in two passes over the same eligible FLIGHTs:

1. **STAND rule** (unchanged): an AIRCRAFT that is PARKED, or HOLDING only the STAND of a finished FLIGHT, with no STAND-needing proposal in flight, gets at most one FLIGHT. STAND-free FLIGHTs take part too, as before.
2. **STAND-free pass**: the STAND-free FLIGHTs left over are matched again, outside the STAND rule:

| | Rule |
|---|---|
| Eligible AIRCRAFT | **HOLDING** (idle, holding the STAND of an unfinished FLIGHT) and **PARKED**. Both: section 4.1 says a HOLDING team can take one, and a PARKED team with a BUILD proposal in flight (approved, sent or accepted, not yet DEPARTED) can take one for the same reason |
| Not eligible | **AIRBORNE** (the session is busy): the CAPTAIN is mid-turn and a FLIGHT PLAN would queue behind it. A team flips back to HOLDING between turns and the planner runs every 5 minutes, so it is picked up then. Also AOG, RETIRED, no base AIRPORT, another AIRPORT |
| Cap | One STAND-free FLIGHT per AIRCRAFT, counting its in-flight proposals (`Reserved.aircraftFlights` from `reservedOf`). One proposal per AIRCRAFT per plan across both passes, so a PARKED team never gets a BUILD and a SURVEY in the same plan |
| Open proposals | Not counted apart: an undecided proposal is a pair of the previous plan, and `syncOps` supersedes any pair the new plan no longer makes, so the same AIRCRAFT cannot collect two |
| Reservations are split | An in-flight STAND-free proposal does not block the STAND rule (a team doing a SURVEY can still be given a BUILD), and an in-flight BUILD proposal does not block a STAND-free FLIGHT. `AircraftState.reserved` is the STAND-needing reservation, `reservedLight` the STAND-free one. A reserved FLIGHT the snapshot no longer knows counts as needing a STAND |
| Same rules | TAIL ASSIGNMENT (a HOLDING tail team can take a STAND-free FLIGHT), TYPE RATING, crew, CHECK independence, WAKE slots |
| Order | STAND rule first, so BUILD work keeps its place; STAND-free FLIGHTs fill what is left. Within the pass, by score |
| Shown as | A 0-point factor `STAND 없이` with the AIRCRAFT's state: `VOC-10 아직 진행 중(PR 없음) — SURVEY는 STAND가 필요 없어 STAND 규칙 밖(AIRCRAFT당 1건)` |
| Approval mode | An approved STAND-free proposal stays valid while its AIRCRAFT is HOLDING (`canTakeNow`); `syncOps` uses the same rule for the SUPERSEDED reason. Departure and arrival: section 5.1.1 |

Only labelled FLIGHTs take this path. The SCHEDULE `classify` candidates put titles that look like research, review, comparison or planning first (`standFreeHint` in `server/schedule.ts`), so OCC classifies likely `SURVEY` and `CHECK` FLIGHTs sooner. The order is a hint; the label is still OCC's call.

#### 5.1.1 Departure and arrival without a STAND

A STAND-needing FLIGHT DEPARTS when its STAND appears and ARRIVES when its PR merges (LOGBOOK). A STAND-free FLIGHT has neither signal, so in approval mode (2b) atc uses the READBACK and the CAPTAIN's report instead (built 2026-09-27):

```
CAPTAIN: "READBACK D-0012"  → OCC: atcctl dispatch readback D-0012
                            → atc: ACCEPTED and DEPARTED at the same moment (departedStand null, departedVia "readback")
CAPTAIN: "done: <link>"     → OCC: atcctl dispatch arrived D-0012 -- '<result link or one line>'
                            → atc: ARRIVED (arrivedNote, arrivedUrl)
```

| Point | Rule |
|---|---|
| Which FLIGHTs | `needsStand` false for the FLIGHT's labels at READBACK time (`type:SURVEY`, `type:CHECK`). An unknown FLIGHT counts as needing a STAND. An `accepted` STAND-free proposal left over (old records, or the FLIGHT was not in the snapshot) departs on the next sync |
| Reservation | A STAND-free `departed` proposal stays in `inFlight` and keeps its AIRCRAFT (`reservedLight`) and FLIGHT until ARRIVED or RECALLED. It never expires and is never superseded, whatever Linear says. After 24 hours without a report it shows in `overdue` |
| After ARRIVED | The reservation is released. For 7 days the planner excludes the FLIGHT as `이미 완료됨 — D-0012 ARRIVED(CAPTAIN 보고)`, because nothing reaches the LOGBOOK and Linear may still say Todo. After that, Linear decides |
| RECALL | Allowed on a STAND-free `departed` proposal, like `sent` and `accepted`. The RECALL text asks for any partial result instead of "leave the STAND". A STAND-needing DEPARTED is still not recalled. RECALLED releases the reservation like any other RECALL |
| gate3 | STAND-free READBACKs count toward the READBACK rate but not the DEPARTED rate (they would inflate it); `gate3.standFree` shows their READBACK and ARRIVED counts |
| ATFM A8 | An AIRCRAFT flying a STAND-free FLIGHT that has not ARRIVED is not auto-eligible, even when its session is idle |

**Why a report, not detection.** Automatic ARRIVED was considered: a review on the target PR for a CHECK, a docs PR or an issue comment for a SURVEY. It needs per-type heuristics (which review, whose comment) and a wrong match would release an AIRCRAFT early. The CAPTAIN already reports back to OCC, so the report is the first step; detection can later be added as a suggestion OCC confirms.

**ARRIVED candidates, as built (2026-09-28, ATC-72).** Detection now exists, but only as a suggestion that OCC confirms. atc never marks ARRIVED on its own.

- **Who did it.** GitHub and Linear writes all come from one shared account, so the author login can't name a team. atc reads the flying AIRCRAFT's own session transcripts instead. The `post` events (`briefs.ts` `ghPostOf`) are its `gh pr review|comment <N>`, `gh issue comment <N>`, `gh api …/pulls/<N>/reviews` or `…/issues/<N>/comments` with a body, and Linear MCP `save_comment` calls. A GitHub review or comment counts only when it exists on GitHub within 1 min before to 10 min after that call (read-only `gh`). With no AIRCRAFT there is no suggestion.
- **CHECK** (`checkSuggestionOf`): a review in any state, or a PR comment (a different `kind`), by the checking team on a target PR after departure. Targets come from `checkTargetOf` (5.2): PR numbers in the title, in the FLIGHT's AIRPORT repository; open PRs whose ticket is a target; LOGBOOK PRs of a target FLIGHT.
- **SURVEY** (`surveySuggestionOf`), by the flying team after departure, in this order:
  1. a merged PR that changed only docs (`docs/`, `.md`, `.txt`, …) and names the FLIGHT key, attributed by the LOGBOOK's AIRCRAFT;
  2. a GitHub PR or issue comment whose command names the FLIGHT key;
  3. a Linear comment on the FLIGHT with a result link. This one is from the session record only; the reason tells OCC to check it in Linear.
- **Candidate.** FLIGHT, AIRCRAFT, D-xxxx (or none), `kind`, evidence (`url`, `author`, `at` = when the work was done), a `reason` line, and the `command` OCC runs after checking. It is refreshed every 5 minutes (`standfree-run.ts`) and shown in `dispatch brief` as `arrivalCandidates`, on the DISPATCH card's IN FLIGHT row as "ARRIVED 후보", and for direct assignments in an "ARRIVED 후보" list below it. `GET /api/standfree` has the list and the metric.
- **Direct assignment (shadow, no D-xxxx).** A team's READBACK of a STAND-free FLIGHT is its departure. It can be a SendMessage or a plain `READBACK <KEY>` answer line. It is written to the DEPARTURE LOG as `{via: "readback", stand: null}` (7.5), once per FLIGHT and AIRCRAFT, again only after that pair has ARRIVED. A pair already sent as a FLIGHT PLAN is left to DISPATCH. OCC confirms with `atcctl dispatch arrived <FLIGHT> --aircraft <TEAM_X> -- '<link>'` (`POST /api/dispatch/standfree/:flight/arrived`). It is refused for a STAND-needing or unknown FLIGHT, while a D-xxxx for it is in flight, without a readback departure, or when that departure has already ARRIVED.
- **LOGBOOK.** A confirmed STAND-free ARRIVED, by D-xxxx or direct, writes an `arrived` line with no `pr`. It has `key: "standfree:<FLIGHT>@<departedAt>"`, `departedFrom: "readback" | "departure"`, `stands: []`, `landingWaitMin: null` and `blockMin` = departure → work done (the candidate's evidence time, else the confirm time). It also carries `standFree: {arrivedVia: "report" | "confirmed-suggestion", evidence: {url, note}, workDoneAt, proposal}`.
  - TARGETS, CHECKRIDE and FUEL F4 (the FLIGHT window of that AIRCRAFT) count it.
  - Anything that needs a PR or a landing wait skips it: MCC gate, SCHEDULE CLOSE, landing-wait medians, brief measurement. So does anything that needs a STAND: DEPARTURE LOG matching for PRs, EN ROUTE FUEL spans.
  - The planner treats the FLIGHT as done ("이미 완료됨 — STAND 없이 ARRIVED(LOGBOOK)").
  - If the same FLIGHT and AIRCRAFT already reached the LOGBOOK through a PR after departure, no second line is written.
  - Old lines read unchanged.
- **Metric** (`timelinessOf`, next to `gate3.standFree` as `timely`): over 30 days, the share of STAND-free ARRIVED lines confirmed within 24 h of the work being done. A report-only line counts as on time, because the report is the signal. Candidates left unconfirmed for more than 24 h count as misses.

### 5.2 CHECK independence

Pure functions in `server/dispatch.ts`, applied to every `CHECK` in both passes.

**What it reviews** (`checkTargetOf`): the FLIGHTs in its Linear relations (`blockedBy`, `related`, `blocks`, `parent`), and the FLIGHT keys and PR numbers in its title (`VOC-205`, `PR #400`, `#400`, `…/pull/400`). The snapshot has no issue body, so the body is not read.

**Who built it** (`checkBuildersOf`), every source that answers:

| Source | Match |
|---|---|
| LOGBOOK | Entries whose `flight` is a target, or whose PR number is a target in the CHECK's AIRPORT → `aircraft` |
| Open PRs | A PR whose number is a target in the AIRPORT's repository, or whose ticket key is a target → the TEAM sessions with a claim on its `standPath`. A PR found by number adds its ticket key as a target |
| STANDs | Worktrees whose ticket key is a target → the TEAM sessions with a claim on them (handed-off claims included) |
| Claim history | Sessions whose claim records name a target FLIGHT (`readFlightHistory`) |

Session names are matched against `teamPattern` and upper-cased, like the LOGBOOK. Every builder found is excluded (after a HANDOFF both AIRCRAFT count). If only builders could fly the CHECK, it is excluded: `CHECK 독립성 — 검토 대상을 만든 TEAM_D 말고 이 CHECK를 날 AIRCRAFT 없음 (…)`.

**When the builder is unknown** (no target, or no source names one), the CHECK is not blocked. The card carries a 0-point factor `CHECK 독립성` saying `확인 못 함 — …`, so the SUPERVISOR checks it by hand. When it is known, the factor names the builder that was left out.

Not built yet: WAKE-scaled conflict risk (a same-area approach is sketched in [issue #41](https://github.com/chaehy5665/atc/issues/41)), and ARRIVED without a person: atc now finds ARRIVED candidates for STAND-free FLIGHTs and OCC confirms them, which writes a PR-less LOGBOOK line that TARGETS count (ATC-72, 5.1.1 as built). ATFM's auto-eligibility (A8) still requires an assignable AIRCRAFT, so a STAND-free proposal to a HOLDING team is never auto-eligible (A3 excludes SURVEY and CHECK anyway).

### File overlap as built (ATC-71)

DISPATCH now reads which files each FLIGHT in flight changes and which files a Todo FLIGHT will change, and scores the overlap (WAKE-scaled, `파일 겹침`) or, behind the `dispatch.json` `overlap.hold` switch (default off), holds the FLIGHT until the one holding the files merges. A team that already flies the overlapping FLIGHT gets `이어서 하면 충돌 없음`. The rules, the sources and the `DIRTY` metric are in [dispatch.md](dispatch.md) 5.3.1.

## 6. Who classifies

| Stage | Who writes the labels |
|---|---|
| By hand (any stage) | The SUPERVISOR or President. Not built yet: DISPATCH notes that suggest a classification from the body |
| OCC S1 (built) | OCC drafts a SCHEDULE `CLASSIFY` operation for each Todo or Backlog FLIGHT missing a `type:` or `wake:` label (`candidatesOf` in `server/schedule.ts`, likely `SURVEY` and `CHECK` first): FLIGHT TYPE, WAKE, ratings, with a one-line reason. The SUPERVISOR marks it in shadow |
| OCC S2 (built, off by default) | Approved `CLASSIFY` operations are written through linear-guard, when the SCHEDULE `mode` is `approval` (occ.md) |
| OCC S3 (not built yet) | `CLASSIFY` may become automatic for non-`SEC` FLIGHTs if S2 agreement is high. Adding or removing `rating:SEC` always needs approval |

Classification is a bounded choice from fixed options, so it is also the first candidate for a typed-judgment model (the Jev evaluation in the DISPATCH notes), measured against the SUPERVISOR's shadow marks.

### 6.1 Typed judges (Jev)

Status: built, **off by default** (ATC-36). A judge family marks SCHEDULE `CLASSIFY` drafts. It never decides them.

**How it judges** (`server/judges/`). One CLASSIFY interface: a Choice for FLIGHT TYPE (the six types of 4.1, in the order CHECK → SURVEY → TEST → FERRY → MAINT → BUILD), a Choice for WAKE (4.2), and a Noul for each TYPE RATING (4.3; yes when the probability is ≥ 0.5). atc compares that classification with the axes the OCC draft wrote. If they match, the mark is `agree`, otherwise `disagree`, with a reason such as `TYPE MAINT(80%) ≠ 초안 BUILD`. For RATING, "the draft adds it or the FLIGHT already has the label" is compared per rating. Two engines:

| Engine | What it is |
|---|---|
| `stub` | Recorded responses, no network. Used by the tests, and by a test server with `ATC_JUDGE_ENGINE=stub` |
| `jev` | TypeSafe System One: `POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`, `Authorization: Bearer $TYPESAFE_API_KEY` (from `.env.local`; never logged, printed or recorded) |

**The switch** `judges.jev` in `~/.local/state/atc/judges.json`: `off` (default), `replay` or `shadow`. Only the SUPERVISOR changes it: in Settings → AUTOMATION → JUDGES, or `PUT /api/settings {judgesJev}` from this screen's Origin, like AUTOLAND. atcctl has no command for it, so control sessions can't change it. A missing or unknown value reads as `off`.

| Mode | What it judges |
|---|---|
| `off` | Nothing is read or sent |
| `replay` | CLASSIFY drafts the SUPERVISOR has already judged and that have no mark from this family, oldest first. The body read today is used, which may differ from when the draft was written |
| `shadow` | Open CLASSIFY drafts without a mark |

The server runs at most 3 drafts a minute. It backs off an hour after an error and stops the pass on 401 or 429. Settings shows the last run and error.

**Egress rule.** Turning the switch to `replay` or `shadow` is the SUPERVISOR's data-egress decision. What leaves is an allowlist: the title and three body sections (goal, allowed scope, done criteria), each clipped to 600 characters. The FLIGHT key, labels, comments, assignee, project and every other section stay home. A FLIGHT with a `rating:SEC` or `Risk:*` label, one whose labels atc doesn't know, or a draft that adds `rating:SEC` sends **the title only**, and its body isn't even read. Each mark records what was sent (`sent`) and why a body was withheld (`withheld`).

**Records.** `~/.local/state/atc/judges.jsonl`, append-only: one `judge` line per draft and family (the classification, probabilities, verdict, engine, model, run), and a `mode` line per switch change. `schedule.jsonl` and the single CROSSCHECK slot are untouched.

**Measuring without anchoring.** A mark is shown only on drafts the SUPERVISOR has judged: a chip in RECENT, like `JEV agree`, with the classification and what was sent in its tooltip. Marks on open drafts are counted but hidden. The gate panel's `JEV 일치 m/n` line is `crosscheckRateOf` per family over human verdicts, `replay` marks included (the judge's input never contains the verdict). ATFM auto-verdicts are left out. Marks never change a draft's status and never count toward the 20 / 80% gate.

Not built yet: other families, using a judge's agreement for S3, and using the DISPATCH marks for anything (below). The same family also classifies the CAPTAIN's last message at Stop (REPORT, [8.8](#88-aircraft-health)).

### DISPATCH judges as built (ATC-88)

The same family, switch, engines, back-off and 3-a-minute limit also mark **open DISPATCH ASSIGN proposals** (`kind: ASSIGN`, status `proposed`, HELD ones included; `replay` takes the ones the SUPERVISOR has already judged). CLASSIFY drafts and ASSIGN proposals share the limit and take turns, so neither starves the other. Shadow only: no planner weight, no HOLD, no status or score change, and `proposals.jsonl` is never written. Using the marks is a later SUPERVISOR decision, after 20+ judged proposals.

| Question | Type | Asks |
|---|---|---|
| `ready` | Noul | Does the body give enough to start: what to change and how to tell it is done? |
| `prerequisite` | Noul | Does the body say it waits on other work (a FLIGHT, a PR, a release, a decision)? |
| `same_area` | Score, 5 levels | How close is the FLIGHT to the AIRCRAFT's recent FLIGHTs? Stored as the raw score and as a 0–1 level |

**What leaves.** The FLIGHT is the ATC-36 allowlist unchanged: the title and the three sections (goal, allowed scope, done criteria), clipped to 600 characters; a `rating:SEC` or `Risk:*` FLIGHT, or one whose labels atc doesn't know, sends the title only and its body isn't read. For `same_area` only, the **titles** of the AIRCRAFT's last 3 LOGBOOK FLIGHTs go too, and only when all three are atc FLIGHTs (AIRPORT `ATCC`, no AD HOC, distinct FLIGHTs counted once) and every title is known. If any is not, `same_area` is not asked. No REGISTRATION, FLIGHT key, comments or scores are sent. Each line records `sent`, `withheld` (why the body was cut) and `recentWithheld` (why `same_area` wasn't asked).

**Record.** `judges.jsonl` gets a `judge` line with `target: "dispatch"`, the proposal `id`, `flight`, `run`, `engine`, `model`, `judgment` (`ready` and `prerequisite` as yes probabilities, `sameArea` as `{score, level, confidence}` or `null`), `sent`, `withheld` and `recentWithheld`.

**Screen, without anchoring.** A `JEV` chip shows only on closed proposals in RECENT, with the three answers, what was sent and why anything was withheld in its tooltip. Open and HELD cards never show it (it is only counted). The gate panel adds three reference lines, not gate criteria:

| Line | Counts |
|---|---|
| `JEV Ready = no → 거절` | Of the marks with Ready = no on a proposal the SUPERVISOR judged, how many were rejections (disagree, reject) |
| `JEV Prerequisite = yes → 선행 대기` | Of the marks with Prerequisite = yes on a judged or HELD proposal, how many carry a `waiting-on-prior` chip or an OCC HOLD (a HOLD with a blocking FLIGHT, or one set without a PREFLIGHT mark; a HOLD requeued by the SUPERVISOR is no longer visible as OCC's) |
| `JEV Same area 가까움 → 승인` | Of the marks whose `same_area` level is ≥ 50% on a judged proposal, how many were approvals (agree, approve) |

## 7. TARGETS

Per AIRCRAFT, set by the SUPERVISOR in the FLEET tab. They are shown, not scored: atc never ranks AIRCRAFT by them and the planner does not read them.

| Target | Measured from |
|---|---|
| FLIGHTs per week | LOGBOOK entries that ARRIVED this week (Monday 00:00 local time to now) |
| On-time rate | LOGBOOK entries of the last 14 days: the team's block time (start to PR opened) within the expectation of section 7.2. The wait for review and merge is shown apart as the landing wait |
| Reverted work | LOGBOOK entries of the last 14 days marked `reverted` (a `Revert "…"` PR was merged). Reopened FLIGHTs are not counted yet |
| Conflicts | LOS on the FLIGHT's STANDs while it was flown, summed over LOGBOOK entries of the last 14 days |
| FUEL per FLIGHT (`fuelPerFlight`, USD, optional) | Average NET FUEL COST of the priced LOGBOOK entries of the last 14 days, at or below the target ([fuel.md](fuel.md) 8.6, ATC-56) |
| CACHE HIT (`cacheHit`, 0–1, optional) | CACHE HIT over the LOGBOOK entries of the last 14 days that carry `fuel` (CAPTAIN + CREW), at or above the target |

Stage 4 (network planning) puts these next to the project goals (section 7.3). OCC drafts target and ROUTE changes in shadow (section 7.4, S1 built); the SUPERVISOR decides.

### 7.1 LOGBOOK

An aircraft logbook records every flight an airframe has flown. atc's LOGBOOK does the same per AIRCRAFT: one line per PR merged into the AIRPORT's default branch, which is when its FLIGHT (or AD HOC work) ARRIVED. A FLIGHT flown in several PRs has several lines; a `Revert` PR adds none of its own.

Kept in `~/.local/state/atc/logbook.jsonl`, append-only like the other records. Two operations:

```json
{"op":"arrived","t":"…","key":"owner/repo#31","aircraft":"TEAM_J","flight":"VOC-201","class":{"type":"BUILD","wake":"M","ratings":["UI"],"explicit":{"type":true,"wake":true}},"airport":"ATCC","pr":{"repo":"owner/repo","number":31,"url":"…","title":"…"},"branch":"claude/logbook","stands":["/home/…/worktrees/atc-logbook"],"departedAt":"…","departedFrom":"claim","arrivedAt":"…","blockMin":190,"landingWaitMin":122,"codexFindings":1,"changesRequested":false,"reverted":false,"los":0}
{"op":"reverted","t":"…","key":"owner/repo#31","by":{"number":35,"url":"…"}}
```

| Field | Meaning |
|---|---|
| `key` | `owner/repo#number`, the dedupe key. A PR is written once |
| `aircraft` | The REGISTRATION of the team session that flew it (below), canonical (`TEAM_G`, ATC-67; older lines are upper case as written). `null` when atc cannot tell; the line is still written |
| `flight` | Ticket key from the PR branch (`voc-<n>`) or the title's trailing `(VOC-n)`. `null` for AD HOC work |
| `class` | `classOf(labels)` of that FLIGHT's Linear labels at arrival (FLIGHT TYPE, WAKE, ratings, and whether type and wake came from labels). `null` for AD HOC or when Linear does not know the ticket |
| `airport` | AIRPORT code of the repository |
| `pr` | `{repo, number, url, title}`. Missing on a STAND-free line, which has `standFree` instead (5.1.1, ATC-72) |
| `stands` | The STANDs (worktree paths) the FLIGHT was flown from |
| `departedAt` | The earliest of the claim `since` on those STANDs (`departedFrom: "claim"`) and the first matching DEPARTURE LOG line (`"departure"`, section 7.5); anything after the merge is ignored. When neither exists, or the PR was opened earlier, the PR's `createdAt` (`departedFrom: "pr"`): a claim restarts its `since` after 3 idle hours, so the PR can be the earlier sign |
| `branch` | The PR's head branch, used to match the DEPARTURE LOG. Missing on lines written before 2026-09-27 |
| `arrivedAt` | The PR's `mergedAt` |
| `blockMin` | The team's block time: PR `createdAt − departedAt` in whole minutes (wall clock, nights included). `null` when `departedFrom` is `"pr"`: with no claim before the PR was opened, atc does not know when the team started (the zero it would compute is not a real duration) |
| `landingWaitMin` | The landing wait: `arrivedAt − ` PR `createdAt` in whole minutes, time spent on review and merge by the SUPERVISOR. Not part of the on-time rate |
| `codexFindings` | Number of Codex `COMMENTED` reviews on the PR over all its commits, i.e. review rounds in which Codex found something. Not only the head: by merge time the head's findings are normally resolved, so the head count would almost always be 0 |
| `changesRequested` | Anyone left a `CHANGES_REQUESTED` review at some point |
| `reverted` | Set by a later `reverted` line |
| `los` | `alert.raised` LOSS OF SEPARATION events in the FLIGHT RECORDER on those STANDs between `departedAt` and `arrivedAt` |

**Which STANDs.** In order, the first that gives any: the `workspacePath` of the PR's `landing.*` events in the FLIGHT RECORDER (30 days), the worktree that still has the PR branch checked out, worktrees whose name carries the FLIGHT's ticket key (the rule `readFlightHistory` uses), and finally the STANDs in the DEPARTURE LOG for that branch (the worktree may be gone by then).

**Which AIRCRAFT.** Of the sessions with a claim on those STANDs, only those whose name matches the team pattern (`TEAM_X`). When several did, the one with the latest claim activity: after a HANDOFF, the AIRCRAFT that landed it gets the entry. Session names come from the session registry, so a session whose file is gone is unknown. When no claim is left, the last AIRCRAFT in the DEPARTURE LOG for that branch (else that FLIGHT or STAND) before the merge (section 7.5); otherwise `null`.

**How ARRIVED is found.** The open-PR reader stays as it is. A second, light reader runs every 10 minutes: `gh pr list --state merged --limit 30` per AIRPORT with a GitHub remote, keeping PRs into the repository's default branch. PRs already in the LOGBOOK are skipped, so the first run after a restart also back-fills the last 30 merged PRs (with `aircraft: null` where the claims are gone).

**Reverts.** A merged PR titled `Revert "…"` is not a FLIGHT of its own. It adds a `reverted` line for the PR it reverts, found by `Reverts owner/repo#N` in its body or, failing that, by the quoted title in the same repository. A revert of a PR that is not in the LOGBOOK is ignored.

**Filling in later.** A third operation fills a line whose AIRCRAFT was unknown, without rewriting the file:

```json
{"op":"attributed","t":"…","key":"owner/repo#32","aircraft":"TEAM_J","via":"departures","departedAt":"…","blockMin":30}
```

Each LOGBOOK run looks up every `aircraft: null` line of the repositories it read in the DEPARTURE LOG (by branch, else FLIGHT or STAND, before the merge). A match writes one `attributed` line; when the line had no departure (`departedFrom: "pr"`) and the DEPARTURE LOG is earlier than the PR, it also carries `departedAt` and `blockMin`. Folding applies it only to a line that is still `null` (the entry then shows `attributedBy: "departures"`), so a known AIRCRAFT is never overwritten and nothing is written twice. Lines from before the DEPARTURE LOG existed mostly stay `null`; that is expected.

**Measuring briefs** (ATC-32). A fourth operation, `measured`, records per ARRIVED FLIGHT from the last 30 days whether it was briefed DIRECT or VECTORS, whether it was flown SOLO or CREW, its mid-task questions and READBACK time, rework commits after the PR opened, and P0–P2 findings. It fills only empty fields; the fields, sources and the VECTORS · DIRECT comparison are in [dispatch.md](dispatch.md) "DIRECT briefs". `GET /api/logbook/briefs?days=30` returns the comparison.

**API.** `GET /api/logbook?aircraft=TEAM_X&days=14` returns the folded entries, newest arrival first. `aircraft` is optional (case-insensitive); `days` defaults to 14 and is capped at 90.

### 7.2 Actuals on the FLEET card

`fleetView` adds `actuals` to each AIRCRAFT, computed from the LOGBOOK:

| Actual | Rule |
|---|---|
| This week | Entries that ARRIVED since Monday 00:00 (server local time), shown against `flightsPerWeek`: "이번 주 2/3" |
| On-time | Of the entries of the last 14 days that have both an expectation and a `blockMin`, the share with `blockMin` within the expectation, shown against `onTime`. Entries with `blockMin: null` are left out, not counted as on time |
| Landing wait | Median `landingWaitMin` of the entries of the last 14 days (all of them, since the PR times are always known): "착륙 대기 중앙값 5h" |
| Reverted | Entries of the last 14 days marked `reverted` |
| LOS | Sum of `los` over entries of the last 14 days |
| Recent | The last 5 entries: team block time (or `—`), `+` landing wait, ON TIME / DELAYED; under each, its FUEL: NET (tokens when unpriced), LEAK, and `TRIP ✓` or `UNEXPECTED` against TRIP FUEL, or `FUEL —` for a line without `fuel` |
| FUEL (ATC-56) | `fuelBurn` over the entries of the last 14 days: FUEL COST and NET per priced FLIGHT, CACHE HIT (CAPTAIN, CREW), CREW share of FUEL COST, the top three leak rules, CREW warning counts (F7), unpriced models, and how many FLIGHTs went past TRIP FUEL p90. A value with nothing behind it is `—`, never 0. The FLEET row shows `$6.10/FLT · CACHE 93%` in its own FUEL column, beside F6's FUEL REMAINING |

**Expectation.** A FLIGHT whose WAKE comes from a label uses the section 4.2 block time, read as an upper bound: `L` 60 min, `M` 240 min ("a few hours" taken as 4 hours), `H` 2880 min (2 days). `J`, an unlabeled WAKE and AD HOC work have no fixed expectation; they are compared with the median `blockMin` of other LOGBOOK entries of the same FLIGHT TYPE and WAKE (AD HOC is its own group), once there are at least 3. Only entries with a known AIRCRAFT and a known `blockMin` feed the median. Otherwise the entry is not counted in the on-time rate. When a category reaches about 20 entries its median may replace the fixed number (section 4.2); that switch is not built yet.

### 7.3 NETWORK (stage 4, read-only)

Stage 4 puts TARGETS next to the project goals in one read-only view: `GET /api/network` (`server/network.ts`), shown in the NETWORK tab. It writes nothing and changes no score or assignment. Every number is a pure function over the snapshot, the LOGBOOK, the FLEET registry, the DISPATCH and SCHEDULE logs and one Linear project query.

| Part | Rule |
|---|---|
| ROUTE rows | One per Linear project that has open FLIGHTs, ARRIVED FLIGHTs in the last 14 days, an AIRCRAFT with it in `routes`, or is a team project whose status type is not `completed` / `canceled`. Busiest first (open + ARRIVED), then by name |
| Open FLIGHTs | By the UI's phase rule: `todo` = state type `unstarted`, `inReview` = state named `In Review` or `Ready to Merge`, `inProgress` = any other `started`. Backlog, triage, finished and parent issues are not counted. Only tickets in atc's snapshot (updated in the last 45 days) |
| `arrived14` | LOGBOOK entries of the last 14 days whose FLIGHT's ticket is in that project. Entries whose ticket the snapshot does not know, and AD HOC entries, belong to no ROUTE |
| `aircraft` | Registrations whose FLEET `routes` include the project (retired AIRCRAFT left out) |
| `landingWaitMedianMin` | Median `landingWaitMin` of the same 14-day entries |
| `goal` | `{targetDate, progress, state}` of the Linear project from `server/sources/linear-projects.ts`: one read-only query (`projects` filtered by the team key; `name targetDate progress status { name type }`), cached 10 minutes. `state` is `status.type` (`backlog`, `planned`, `started`, `paused`, `completed`, `canceled`), else `status.name`; the deprecated `Project.state` is not read. `null` when there is no key, the query failed, or the project is not in the list |
| AIRCRAFT rows | `targets` (`flightsPerWeek`, `onTime`) and `actuals` copied from `fleetView` (section 7.2): `weekDone` = `week`, `onTimeRate` = `onTime.rate`, `landingWaitMedianMin`, `reverts` = `reverted`, `los`. The same numbers as the FLEET cards. Retired AIRCRAFT are left out |
| `trend.days` | 28 days (server local dates, oldest first, today last): ARRIVED that day, the median landing wait of those entries, and reverts whose Revert PR merged that day |
| `trend.gates` | 28 days: DISPATCH and SCHEDULE shadow decisions (`agreed` / `disagreed`) made that day, the cumulative agreement up to the end of that day (the last day equals each gate's `agreement`), and the cumulative CROSSCHECK match rate over both logs (`crosscheckRateOf`). Approval-stage approve / reject is not counted, as in the gates |
| `sources` | Whether Linear (fetched), GitHub (fetched) and the LOGBOOK file were available |

### 7.4 OCC target-change drafts (S1 built 2026-09-27, ATC-25)

S1 (shadow) is built; S2 (apply on approve) is not. See "As built" at the end of this section. ROUTES and TARGETS stay the SUPERVISOR's (section 3); this is how OCC could propose changes to them the way it proposes Linear changes, without ever applying them.

**Operations.** Two new SCHEDULE kinds, each about one AIRCRAFT, with `flight: null` and an `aircraft` field:

| Kind | Payload | Example |
|---|---|---|
| `TARGET` | `{registration, flightsPerWeek?: number \| null, onTime?: number \| null}`; `null` clears a target | TEAM_I `flightsPerWeek` 3 → 5 |
| `ROUTE` | `{registration, add?: string[], remove?: string[]}` (Linear project names) | TEAM_C remove `Home & Discovery` (completed) |

**Evidence.** OCC writes the one-line reason; atc attaches the numbers itself when the draft is made, from the same functions as `GET /api/network`, so the SUPERVISOR sees what OCC saw and OCC cannot misquote it:

- `TARGET`: the AIRCRAFT row (targets and actuals), ARRIVED per week for the last 4 weeks from the LOGBOOK, and the ROUTE rows of its routes (open FLIGHTs waiting).
- `ROUTE`: the ROUTE rows of the projects added or removed (open FLIGHTs, `arrived14`, AIRCRAFT already on it, `goal.state`), and where the AIRCRAFT's last 14 days of ARRIVED FLIGHTs actually went, by project.

**Limits.**

- Same validation as `PATCH /api/fleet` (`applyPatch`): `flightsPerWeek` 0–100, `onTime` 0–1. `ROUTE` names must be team projects that are not `completed` or `canceled`, except in `remove`.
- A step limit per draft: `flightsPerWeek` by at most 2 or 50%, `onTime` by at most 0.1. Bigger changes are the SUPERVISOR's to make by hand.
- `TARGET` needs at least 3 ARRIVED entries in the 14-day window as evidence; no drafts for retired or AOG AIRCRAFT; at most one open draft per AIRCRAFT and kind (a newer one supersedes); at most one applied `TARGET` per AIRCRAFT per 14 days (one actuals window).
- They count toward the SCHEDULE open-draft limit (5) and expire after 3 days like the others.
- Never automatic: not an S3 candidate, whatever the agreement rate.

**Verdict and approval.**

- **S1 (shadow).** The draft shows in the SCHEDULE tab with its evidence; the SUPERVISOR marks would-approve / would-reject with a reason, and CROSSCHECK may mark it first. Nothing is written. These verdicts are counted apart (per kind) so they neither help nor hurt the Linear-write gate (20 decisions, 80%).
- **S2 (approval).** There is no Linear call and no linear-guard step: approving is the write. On approve atc applies the payload through `applyPatch` and the atomic `fleet.json` save (the path `PATCH /api/fleet/:registration` uses), records it in the FLIGHT RECORDER, and marks the operation `applied` at once. OCC never writes `fleet.json`.
- **Superseded** when `fleet.json` already has the proposed value (set by hand), or the AIRCRAFT is retired.

**Where it plugs in.** `SCHEDULE_KINDS` gains `TARGET` and `ROUTE`; `parsePayload` validates them; `changesOf` compares with the FLEET profile instead of a ticket; `syncLines` checks `loadFleet()`; `callsOf` returns no calls, and in S2 `approve` applies directly instead of waiting for `release`. OCC gets `atcctl schedule draft TARGET|ROUTE` and reads `GET /api/network` before drafting.

**As built (S1, ATC-25).**

- `server/network-drafts.ts` holds the pure checks and evidence (`parseTarget`, `parseRoute`, `networkChangesOf`, `networkSupersedeReason`); `server/schedule.ts` plugs them in. There is no separate `aircraft` field: the payload's `registration` is the AIRCRAFT, and `flight` is `null`.
- The payload also keeps `from` (the values when drafted) and `evidence` (`TARGET`: the NETWORK AIRCRAFT row, `arrived14`, `weekly` ARRIVED for 4 weeks, the ROUTE rows of its routes; `ROUTE`: the ROUTE rows of the touched projects and `where`, its 14-day ARRIVED by project).
- Step limit: `flightsPerWeek` by at most 2 or 50% of the current value, **whichever is larger**; no limit when there is no current value (a first target) or when clearing. `onTime` by at most 0.1 the same way.
- Verdicts: `TARGET` and `ROUTE` take the shadow `verdict` in **both** modes, because nothing applies them yet; in approval mode `approve`/`reject` answer 409 and `callsOf` refuses. The SCHEDULE tab shows their cards with shadow buttons in both modes.
- Counting: `gateOf` leaves them out of the gate and the CROSSCHECK match rate and reports them in `gate.network` (`TARGET`, `ROUTE`: decided, agreed, agreement); NETWORK's gate trend leaves them out too (`countsForGate`).
- `syncLines` supersedes an open draft when the AIRCRAFT is gone or retired, or when `fleet.json` already has the change (the SUPERVISOR set it on the FLEET tab).
- OCC reads `atcctl network` at most once in 24 hours and writes at most 1 draft per pass (`occ/.claude/skills/tick/schedule.md` "TARGET and ROUTE drafts").
- Not built yet: S2 apply on approve (`applyPatch` + atomic `fleet.json` save + FLIGHT RECORDER), and the "one applied `TARGET` per AIRCRAFT per 14 days" rule that comes with it.

### 7.5 DEPARTURE LOG

Why: by the time a PR merges, the claims are often cleaned up or restarted after 3 idle hours, and the worktree deleted, so on 2026-09-27 48 of the 62 LOGBOOK lines of the last 14 days had no AIRCRAFT. The DEPARTURE LOG writes down who started a FLIGHT at the moment it happens.

Kept in `~/.local/state/atc/departures.jsonl`, append-only (`server/departures.ts`). Every warm server tick compares the snapshot with the last AIRCRAFT recorded per STAND and writes only changes:

```json
{"t":"…","flight":"VOC-201","aircraft":"TEAM_J","stand":"/home/…/worktrees/atc-logbook","branch":"claude/logbook","repo":"/home/…/atc","via":"claim"}
```

| `via` | When | `t` | `aircraft` |
|---|---|---|---|
| `stand` | A worktree appears while the server runs | Now | `null` (no claim yet) |
| `claim` | The first `TEAM_X` session with an active claim on a STAND that had none | That claim's `since` | That AIRCRAFT |
| `handoff` | Another `TEAM_X` session takes the STAND after the recorded one no longer holds an active claim | The new claim's `since` | The new AIRCRAFT |
| `readback` | A team READBACKs a STAND-free FLIGHT assigned directly, with no D-xxxx (5.1.1, ATC-72). `stand` and `branch` are `null`; STAND and PR matching ignore these lines | The READBACK | That AIRCRAFT |

- The main checkout and non-`TEAM_X` sessions are ignored. `flight` is the branch's ticket key, `null` for AD HOC.
- During a LOSS OF SEPARATION both sessions are active, so the recorded AIRCRAFT stays; a HANDOFF is written once the first one lets go.
- On start the server folds the file to rebuild the last AIRCRAFT per STAND, so a restart writes nothing twice. The first warm snapshot is the baseline: worktrees that already exist get a `claim` line if a team holds them, but no `stand` line.

## 8. FLEET tab

- A status list by default (ATC-44, UI report #99): one row per AIRCRAFT with callsign and registration, AIRPORT, status (AIRBORNE / HOLDING / PARKED / AOG / NORDO / NOT IN SERVICE), the first FLYING FLIGHT with its title (`+N` for more), time since the STAND was taken, last session activity, and ARRIVED and on-time rate this week. It is sorted AIRBORNE → HOLDING → PARKED, then by AIRPORT (pure `fleetRows`, `server/fleet-status.ts`). A row opens that AIRCRAFT's card below it. A 목록 / 카드 switch brings back the all-cards view and is remembered in `localStorage` (`atc.fleet.layout`, list when unavailable). Narrow screens fold each row into two lines.
- One card per AIRCRAFT: registration and callsign, base AIRPORT, status, CREW COMPLEMENT declared vs observed, TYPE RATINGS, ROUTES, TARGETS against the LOGBOOK actuals (section 7.2) with the last few FLIGHTs.
- A RULES line when the [rules-drift hook](../hooks/README.md#rules-drift-hook) runs in the AIRCRAFT's sessions (ATC-42): "RULES current", or "RULES 미확인 since <time>" with the rules files a live session hasn't acknowledged yet. That session gets the diff on its next turn.
- Edit form for the SUPERVISOR (writes `fleet.json`, same pattern as the AIRPORT registry).
- The classification on each DISPATCH card, under the title (section 5). Not built yet: the classification on FIDS.

### 8.1 Team building

The FLEET tab is also where teams are formed and stood down. Until 2026-09-28 atc never started a Claude session itself and stopped at a ready-to-paste briefing. It now starts and stops background sessions when the SUPERVISOR presses LAUNCH or STOP (section 8.5); the briefing is what the new session receives first.

| Action | Term | What it does |
|---|---|---|
| Add a team | **ENTRY INTO SERVICE** | Registration (the next free `TEAM_X` is suggested), base AIRPORT (defaults to where most team sessions live), and a **CONFIGURATION**. The AIRCRAFT shows as NOT IN SERVICE until a session with that name appears, then atc links it by name |
| Team template | **CONFIGURATION** | `general` (the vocado default crew; follows the defaults), `security` (Opus backend + Codex review; SEC, DATA, DOCS), `ui` (Opus backend + `ui-builder` + `ui-qa`; UI, DOCS), `research` (Opus backend + `flash-helper`; DATA, DOCS) |
| Start the session | **CREW BRIEFING** | A copyable kickoff text: session name and folder, the CREW to create with their models, TYPE RATINGS (with the SEC rules), ROUTE, and the radio rules (`tail:` labels, `READBACK C-xxxx`; `READBACK D-xxxx` only in approval mode). The user opens a session in that repository, names it, and pastes it. The text is English (ATC-126); a running session keeps the CREW BRIEFING it started with until it is launched again |
| Stand a team down for a while | **AOG** | Reason plus an optional release date. The planner stops proposing to it (`AOG — reason (~date)`) |
| Remove a team | **RETIREMENT** | The AIRCRAFT leaves the FLEET list (kept under RETIRED with its date and reason) and gets no proposals. A live session is not closed. It can be restored |

A running AIRCRAFT whose complement changes gets a **CREW CHANGE** instead (section 8.4): the SUPERVISOR pastes it, or in DISPATCH approval mode approves it and OCC sends it.

### 8.2 CHECKRIDE

A checkride is the flight in which a pilot shows an examiner that they can hold a rating. atc's CHECKRIDE collects, for each AIRCRAFT and each TYPE RATING (`SEC`, `UI`, `DATA`, `DOCS`), the LOGBOOK FLIGHTs that needed that rating, and recommends a grant or a review. It only recommends: a rating changes only when the SUPERVISOR presses 부여 (grant) or 회수 (revoke), and nothing is granted or revoked automatically.

**Which rating a FLIGHT needed.** In order; the first that gives any ratings wins, and each piece of evidence shows its source:

1. **Label**: the ratings `classOf` reads from the FLIGHT's Linear labels (`rating:X`, or the Risk group for `SEC`), from the current ticket, or from the LOGBOOK line's `class` when the ticket is no longer loaded. Few tickets carry `rating:` labels yet.
2. **SCHEDULE**: the ratings of the latest CLASSIFY draft for that FLIGHT that the SUPERVISOR accepted (`agree` in shadow, `approve` in approval, so the status is agreed, approved, released or applied) and that names ratings.
3. Otherwise the FLIGHT is not evidence for any rating. AD HOC FLIGHTs never are.

Only LOGBOOK entries with a known AIRCRAFT count, so every piece of evidence is a FLIGHT that AIRCRAFT flew.

**Proposed thresholds** (first values, to be tuned; constants in `server/checkride.ts`):

| Recommendation | When |
|---|---|
| **GRANT** (부여 추천) | The AIRCRAFT does not hold the rating; in the last 30 days it ARRIVED at least 3 FLIGHTs needing it; none of them was reverted; their average Codex finding rounds (`codexFindings`) is below 3 |
| **REVIEW** (재검토 추천) | The AIRCRAFT holds the rating; in the last 14 days a FLIGHT needing it was reverted, or at least 2 such FLIGHTs averaged 3 or more Codex finding rounds |
| **BLOCKED** | GRANT would apply to `SEC`, but the CREW COMPLEMENT has no member who can do security work (`canHoldSec`). The reason is shown and there is no grant button |
| **BUILDING** | Not holding it, with some evidence but not enough yet ("근거 1/3") |
| **HOLDS** | Holding it, nothing to review |

**Grant and revoke.** `POST /api/fleet/:registration/checkride` with `{rating, action: "grant" | "revoke"}` goes through the same path as the FLEET edit form (`applyPatch`, then the atomic write of `fleet.json`), so the `SEC` rule still holds. It then writes a `checkride` line to the FLIGHT RECORDER: the AIRCRAFT, the rating, the action, who (`SUPERVISOR`, the FLEET tab has no other user), whether it was recommended, and the evidence (LOGBOOK keys with their sources). A grant turns a default rating list into an explicit one.

**API.** `GET /api/fleet/checkride` returns one row per AIRCRAFT in service and rating, with its status, reason, counts (FLIGHTs, reverts, average Codex rounds in each window) and evidence.

### 8.3 Declared vs observed crew

The complement is what the SUPERVISOR declared. The observed crew is what the AIRCRAFT's sessions actually called in the last 14 days (`OBSERVED_WINDOW_DAYS`, also returned as `observedWindowDays` by `GET /api/fleet`). Built in `server/crew-observed.ts`.

**Privacy.** atc reads session metadata only:

| Read | For |
|---|---|
| `~/.claude/projects/<project>/<sessionId>/custom-title.json` → `customTitle` | The session name, to link past sessions to a REGISTRATION |
| `…/<sessionId>/subagents/agent-<id>.meta.json` → `agentType`, `model` | Who was called and on which model (`model` is there only when the call passed one) |
| mtime of the meta file | The call time (the meta file has no timestamp; in the files checked its mtime equals its birth time, but a rewritten meta file moves the time later) |
| mtime of the session folder, `subagents/` and `<sessionId>.jsonl` | Whether the session was active in the window. Only `stat`, never opened |

Transcripts (`*.jsonl` bodies), prompts and the meta `description` are never read, stored or returned. The meta file is parsed and everything except `agentType` and `model` is dropped at once (`parseMeta`).

**Which sessions.** A session belongs to an AIRCRAFT when its name reads as the REGISTRATION (`Team G` is `TEAM_G`, ATC-67): a live Claude session in the snapshot (the way atc links AIRCRAFT today), or any session folder whose `custom-title.json` says so and that was active in the window. When there is none, `observedCrew` and `crewDrift` are `null` (the card shows nothing observed, not "unused").

**Mapping to POSITIONs** (`positionOf`, against the declared complement):

| Observed | POSITION |
|---|---|
| An `agentType` equal to a member's `position` or `agent` (`ui-builder`, `ui-qa`, `flash-helper`, or anything the SUPERVISOR declared by agent type) | That member's POSITION |
| `general-purpose` or `claude` with a `model` | The member whose `agent` contains the model family (`opus` → `claude-opus-5-5` → `backend`). No such member: none |
| `general-purpose` or `claude` without a `model` | The model that actually answered, once FUEL has read the subagent's usage lines (ATC-57, [fuel.md](fuel.md) 5). Before that, treated as Opus: the call inherits the CAPTAIN's model, and CAPTAINs run on Opus, so `model` stays `null` |
| Built-ins (`Explore`, `Plan`, `claude-code-guide`, `statusline-setup`) and other agent types | None, unless declared by name |

Calls are grouped by `agentType` and `model`: `observedCrew: {agentType, position, model, count, lastAt}[]`, newest first.

**Drift** (`crewDrift`):

- `undeclared`: observed calls with no POSITION, by agent type, with the model when one was given or seen (`Explore`, `general-purpose (sonnet)`). The card shows "선언에 없음: Explore". Since ATC-57 a call whose actual model differs from the model its POSITION declares (COMPLEMENT DRIFT, [fuel.md](fuel.md) 5) is listed here too, as `type (actual model)`.
- `unused`: declared POSITIONs with no call in the window. A POSITION that is never a subagent (the `reviewer` POSITION of the `security` CONFIGURATION, agent `codex (GitHub 리뷰)`, which works through GitHub reviews) always shows here. Read it as "not seen", not as a fault.

**Cost.** The server rescans `~/.claude/projects` for `custom-title.json` at most every 30 seconds. Titles are cached by file mtime and each session's calls by the mtime of its `subagents/` folder, so an unchanged session is not re-read.

**Gap: agent-team teammates.** Teammates spawned by the CAPTAIN with the Agent tool (named or not, background or not) are recorded under the CAPTAIN's `subagents/` and are observed. Teammates of a Claude Code agent team that run as separate sessions (registered under `~/.claude/teams/<team>/`) are not: atc does not read the team config, and those sessions carry their own names. They show as `unused` if declared. Seeing them would need a metadata source that names the lead session; none is used yet.

### 8.4 CREW CHANGE

When the SUPERVISOR changes the CREW COMPLEMENT of an in-service AIRCRAFT through `PATCH /api/fleet/:registration`, atc writes a CREW CHANGE: a text for the CAPTAIN, like the CREW BRIEFING but for a running team. It is English like the CREW BRIEFING (ATC-126), except the `ratingImpact` lines, which are Korean because the FLEET tab shows them too. Built in `server/crew-change.ts`; the only hook in `fleet.ts` is one call after the profile is saved. Step 1 (below, first part) is the text and the SUPERVISOR's manual delivery. Step 2 (the rest) lets OCC send it in DISPATCH approval mode (2b).

- **In service** means not retired and a live session with that name exists. An AIRCRAFT that has not entered service gets its crew from the CREW BRIEFING instead. AOG AIRCRAFT count as in service.
- **Diff** (`diffCrew`): members are compared by their one-line form `position: agent (limits)`, the same as the CREW BRIEFING. A member whose agent or limits changed is removed and added; the text pairs a POSITION that leaves and returns once as "바뀌는 CREW".
- **TYPE RATING impact** (`ratingImpact`), from the planner rules of sections 4.3 and 5: losing or gaining `BUILD`/`MAINT`/`TEST` (a member who is not `flash-helper` and has no `no BUILD` or `read-only`), `CHECK` (no `no CHECK verdicts`), the ability to hold `SEC` (`canHoldSec`; `applyPatch` still refuses `SEC` without it), ratings added or removed in the same PATCH, and `UI` kept without both `ui-builder` and `ui-qa`.
- **Text** (`crewChangeText`): header `[ATC FLEET] CREW CHANGE · <CALLSIGN> (<REG>) · CC-0001`, then crew leaving, joining and changing, the full new complement, TYPE RATING with the impact, and how to apply it (stop leaving teammates after their current work, create joining ones with the given agent and model, tell changed ones their new limits), ending with `"<REG> CREW CHANGE CC-0001 COMPLETE"`.
- **Record**: `~/.local/state/atc/crew-changes.jsonl`, append-only. `{"op":"created","id":"CC-0001","registration","at","before":{complement,ratings},"after":{…},"added","removed","ratingImpact","text"}`, then status lines `{"op":"approved"|"acknowledged"|"delivered","id","at"}`, `{"op":"sent","id","at","message"}` and `{"op":"superseded","id","at","by"}`.
- **Manual delivery** (both modes): the FLEET card shows the open CREW CHANGE with a copy button; the SUPERVISOR pastes it to the CAPTAIN and presses 전달함, which calls `POST /api/fleet/:registration/crew-change/:id/delivered`. `GET /api/fleet/crew-changes?registration=&limit=` returns the recent history with every status and timestamp.

**States** (`foldCrewChanges`; an op that does not fit the current state is ignored):

| From | Op | To | Who |
|---|---|---|---|
| `pending` | `approved` | `approved` | SUPERVISOR, FLEET tab or API, approval mode only |
| `approved` | `sent` | `sent` | OCC, `atcctl crew-change send CC-xxxx` |
| `sent` | `acknowledged` | `acknowledged` | OCC, `atcctl crew-change readback CC-xxxx` after the CAPTAIN's `READBACK CC-xxxx` |
| `pending`, `approved` | `delivered` | `delivered` | SUPERVISOR, 전달함 (pasted by hand) |
| `pending`, `approved` | `superseded` | `superseded` | atc, on a newer complement change |

`acknowledged`, `delivered` and `superseded` are closed. OCC never creates, requests or approves a CREW CHANGE: `atcctl` has no approve command and the OCC Bash guard allows nothing but `atcctl`, `jq` and read-only `gh`.

**Decisions (2026-09-27):**

- **Approval needs approval mode.** `POST /api/fleet/:registration/crew-change/:id/approve` returns 409 unless `dispatch.json` `mode` is `approval`. There is no approve-then-wait: in shadow nobody would send it, and 전달함 is the shadow path.
- **An `approved` one can still be delivered by hand.** If the SUPERVISOR switches back to shadow, or pastes it first, 전달함 closes it and OCC never sends it. A `sent` one cannot be marked delivered (409): it is already with the CAPTAIN and waits for READBACK.
- **Superseding.** A newer complement change while one is `pending` or `approved` closes it (`by` the new id) and writes a new one diffed from its original `before` to the latest `after`; an approved one needs approval again. If that diff is empty (the crew went back), the open one is closed with `by: null` and nothing new is written. A PATCH that changes only the ratings rewrites an unsent CREW CHANGE (so its TYPE RATING lines stay true) but never starts one. A `sent` one is never superseded: it stays open until READBACK. A newer change is diffed from the current declaration (the `sent` one's `after`), can be approved, and waits: `crew-change send` refuses it (409, "READBACK 대기 중인 CC-xxxx") until the `sent` one is acknowledged.
- **Sending** (`POST /api/fleet/crew-changes/:id/send`, approval mode only): `approved` → `sent`, stores the exact message and returns `{change, sendTo, message}`. On a `sent` one it returns the same message again (resend). The message (`crewChangeMessage`) is the header `[OCC CC-0001] CREW CHANGE · <CALLSIGN> (<REG>)`, a blank line, the text without its `[ATC FLEET] …` header (an `[OCC CC-xxxx] …` header is stripped too, so it never doubles), a blank line and `— 받았으면 이 메시지에 "READBACK CC-0001"로 답장해 주세요.`, the same form as the FLIGHT PLAN and RECALL.
- **READBACK** (`POST /api/fleet/crew-changes/:id/readback`): `sent` → `acknowledged`, in any mode (a sent one must be closable after switching back to shadow). A "CREW CHANGE CC-xxxx COMPLETE" line alone also shows the CAPTAIN got it; OCC records the READBACK for it.
- **Overdue**: a `sent` one with no READBACK after 10 minutes (`CREW_CHANGE_READBACK_OVERDUE_MS`). OCC resends the same text once (`crew-change send` again), then reports to the SUPERVISOR.

**send-guard** (`occ/send-guard.mjs`, the OCC session's SendMessage hook, fail-closed): a message starting with `[OCC CC-xxxx]` passes only when `GET /api/fleet/crew-changes/:id` answers `{change, mode}` with `mode: "approval"`, `change.status: "sent"` (so `crew-change send` ran first), the recipient's bare name equal to `change.registration`, and the trimmed body equal to the stored `change.message`. atc unreachable, an unknown id or any mismatch blocks with exit 2. The DISPATCH checks are unchanged.

**Views.** `GET /api/fleet` returns `dispatchMode` and, per AIRCRAFT, `pendingCrewChange: {id, at, text, added, removed, ratingImpact, status: "pending" | "approved" | "sent", message, approvedAt, sentAt, overdue, waitingFor}` (`openCrewChangeOf`): the unsent one when there is one, otherwise the `sent` one, until it is acknowledged, delivered or superseded. `waitingFor` is the id of the `sent` one an unsent one waits behind. `GET /api/fleet/crew-changes/brief` (`atcctl crew-change brief`) returns `{mode, approved, waiting, sent, overdue, pending}` for OCC: `approved` ready to send, `waiting` approved but behind a `sent` one, `sent` waiting for READBACK, `overdue` ids, `pending` ids waiting for the SUPERVISOR.

**2b checklist.** The `crew-change` item ("CREW CHANGE 발부", `selfCheckCrewChange`) checks these transitions, the refusals, the message, the overdue rule, the endpoints and the `atcctl` commands from code facts. Each `readback-*` item (one per AIRPORT `candidateTeams` can assign to, including `vocado-readback`) is ready only when that AIRPORT's `CLAUDE.md` also answers `[OCC CC-xxxx]` with `READBACK CC-xxxx` ([dispatch.md](dispatch.md) "2b readiness checklist").

### 8.5 Session control: LAUNCH and STOP

Decision changed 2026-09-28 (SUPERVISOR): atc starts and stops AIRCRAFT sessions itself, so the SUPERVISOR runs the fleet from the FLEET tab instead of opening each session by hand. Pasting a CREW BRIEFING into a session you open yourself still works; atc links it by name as before.

- **Mechanism.** Claude Code background sessions. LAUNCH runs `claude --bg -n <REG> --permission-mode <mode> [--model <model>] "<CREW BRIEFING>"` in the base AIRPORT's main checkout. `claude agents --json` lists live sessions (desktop, terminal and background). STOP runs `claude stop <id>`: the conversation is kept, and `claude attach <id>` or `claude --resume` opens it again. The session shows up in `~/.claude/sessions/` with `kind: "bg"`, so RADAR, STRIPS and the planner see it like any other session.
- **API** (`server/session-control.ts`): `GET /api/fleet/sessions` returns `{max, permissionModes, sessions}` for sessions whose name matches `teamPattern`. `POST /api/fleet/:registration/launch` takes `{permissionMode?, model?}`. `POST /api/fleet/:registration/stop`.
- **SUPERVISOR only.** LAUNCH and STOP need this screen's Origin (`fromThisApp`, like the AUTOLAND switch). `atcctl` sends none, so TOWER, OCC, CROSSCHECK and REVIEW cannot start or stop sessions.
- **Refusals** (`launchPlanOf`, `stopTargetOf`, pure): the AIRCRAFT is RETIRED; it has no base AIRPORT; a live session with that name exists (any kind); `ATC_MAX_LAUNCHED` background sessions are already live (default 6, counting every background session on the machine); the permission mode is not `auto`, `acceptEdits` or `default` (`bypassPermissions` is never offered); the model name has characters outside `[\w.:[\]-]`. STOP refuses desktop and terminal sessions: close those where they run.
- **Outside the service.** LAUNCH runs `claude` through `systemd-run --user --scope --collect` (a transient `atc-claude-<ms>.scope`). The first `claude --bg` on the machine starts the daemon that hosts every background session (`claude daemon run`); started from inside atc it landed in the `atc.service` cgroup, and `KillMode=control-group` then killed every background session on each `systemctl restart atc` (2026-09-28: OCC `a578bf15` ended `failed` at a deploy). `ATC_BG_SCOPE=off` launches directly. `GET /api/control/sessions` reports `daemonInService`, and the CONTROL block warns while the daemon still runs inside the service.
- **Environment.** The session gets a clean environment (HOME, USER, locale, XDG runtime, and a PATH with the claude CLI and node), not the atc service's, so `.env.local` secrets (Linear, TypeSafe) never reach it. The CLI is `ATC_CLAUDE_BIN` (default `~/.local/bin/claude`; the service PATH does not include it).
- **Workspace trust.** Claude Code refuses a background session in a folder whose trust prompt was never accepted. atc reports it and does not touch trust settings: open `claude` in that repository once and accept.
- **Record.** Every LAUNCH and STOP is a FLIGHT RECORDER line `{kind: "fleet", op: "launch" | "stop", aircraft, by: "SUPERVISOR", ok, jobId, cwd, permissionMode, model, error}`.
- **Tab.** A card with no session shows **LAUNCH** (permission mode, optional model, background count against the cap). Every live session shows its origin (`BG`, `DESKTOP`, `TERM`) and permission mode (8.5.2); a background session also has **STOP**. RETIREMENT of an AIRCRAFT flying a background session then asks whether to stop it too.

Not built yet: automatic STOP of idle sessions (FLEET PLAN step 4; shadow proposals and approval are built in 8.6 and 8.7); RESTART as scheduled maintenance for a long session in the middle of a FLIGHT (a resting AIRCRAFT gets REFRESH, 8.6, ATC-69); CREW CHANGE by relaunching with the new complement; a usage budget per AIRCRAFT (FUEL, ATC-46, [fuel.md](fuel.md)).

#### 8.5.1 Control sessions (built 2026-09-28)

The same LAUNCH and STOP work for atc's own control sessions, from the FLEET tab (section CONTROL SESSIONS, ATC-130), so the SUPERVISOR doesn't open a tmux window per session. Every row has a live badge (ATC-66).

| Session | Folder | How | First message | Extra flags |
|---|---|---|---|---|
| TOWER | `controller/` | `claude --bg` | `/loop 3m /tick` | |
| OCC | `occ/` | `claude --bg` | `/loop 10m /tick` | |
| MCC | `mcc/` | `claude --bg` | `/loop 5m /tick` | `--strict-mcp-config` |
| CROSSCHECK | `crosscheck/` | `claude --bg` | `/loop 10m /tick` | `--strict-mcp-config` |
| REVIEW | `review/` | `claude --bg` | `/loop 10m /tick` | `--strict-mcp-config` |
| ENGINEERING | repository root | badge only | | |

- **Badge.** `BG <id>` (a background session), `tmux <session>` (a session in a tmux pane), `interactive` (open elsewhere, e.g. Claude Desktop) or `not running`. Added after 2026-09-28, when CROSSCHECK was down and nothing on the screen showed it.

- **Mechanism.** `claude --bg -n <NAME> --permission-mode auto [flags] "<first message>"` in the atc repository's folder, with the same clean environment as 8.5. The folder's `.claude/settings.json` applies: model, allow list and the fail-closed guards. `auto` is fixed because a background session can't answer a permission prompt; the guards do the blocking. Checked on 2026-09-28 with a background MCC: `/loop` scheduled `/tick`, the guard hook ran, and `atcctl manual check` and `mcc queue` ran with no prompt.
- **Already running.** A session counts as that control session if its name matches or it was opened in that folder (a tmux session opened without a name, such as `mcc-b4`, is recognised by its folder). LAUNCH is refused while one is live, so two copies never do the same work. STOP stops a background session with `claude stop`, and a session running in a tmux pane (its pid or an ancestor is the pane's first process, from `tmux list-panes -a` and `/proc/<pid>/stat`) with `tmux kill-pane` on that pane only; other windows of the tmux session stay. The screen asks before closing a tmux pane. The conversation is kept either way (`claude --resume`). Desktop (Claude app) sessions are closed where they run.
- **CROSSCHECK and REVIEW** (ATC-66, changed 2026-09-29). Until 2026-09-29 they ran on other model families through `ocx claude`, which `claude --bg` can't do, so LAUNCH opened a tmux session (`atc-crosscheck`, `atc-review`). Since then CROSSCHECK runs on Claude Opus and REVIEW on Claude Sonnet, both launched with `claude --bg` like TOWER, OCC and MCC ([occ.md](occ.md) 9.9 and "CROSSCHECK on Claude Opus"). The tmux and `ocx` launch code is gone. STOP still recognises a control session running in a tmux pane and closes only that pane.
- **ENGINEERING** is a working session opened at the repository root, where team sessions also run, so it is recognised by name only and has no LAUNCH or STOP.
- **Cap.** Control sessions don't count toward `ATC_MAX_LAUNCHED` for teams.
- **STALE rows, as built (2026-09-29, ATC-93).** Claude Code 2.1.284 can keep listing a job that was stopped while it was `done`. On 2026-09-29 the TOWER job `3bf04645` stayed in `claude agents --json` as `"state": "working"` with no `pid` and no `status` for over an hour. It blocked TOWER's LAUNCH and counted as a live session.
  - **Rule** (`isStaleRow`): a row is STALE when it is `background`, has no `pid` and no `status`, its job file `~/.claude/jobs/<id>/state.json` says `state` `done`, `stopped` or `failed`, and its `startedAt` is at least 2 minutes old.
    - `agentRows()` reads only that one field, and only for rows without `pid` and `status`. It never writes under `~/.claude/jobs/`.
    - Healthy background rows always carry a `pid`, idle or busy.
    - A just-spawned job shows for about 0.4 s with no `pid` or `status`, but its state isn't terminal (checked 2026-09-29).
    - A live job's state is `done` after each turn, so the state alone doesn't decide.
    - An unreadable job file counts as not stale.
  - **Effect**: a STALE row is not a live session anywhere.
    - `controlRowsOf` / `refuseLive`, team `launchPlanOf` and the `ATC_MAX_LAUNCHED` count skip it.
    - So do FLEET PLAN inputs and the RESTART wait (`liveRowsOf`).
    - STOP on a session with only STALE rows returns 409 with the reason and doesn't run `claude stop` again.
  - **Display**: `GET /api/control/sessions` returns `stale: [{id, name}]` per control session, and `GET /api/fleet/sessions` marks rows `stale: true`. The CONTROL block and the FLEET card show `STALE <id>` with "Claude Code가 멈춘 job을 아직 목록에 둠 — 무시해도 된다", and LAUNCH stays available.
- **API** (`server/session-control.ts`): `GET /api/control/sessions` (`{daemonInService, sessions: [{name, dir, prompt, launch: "bg" | null, blocked, live}], accounts}`), `POST /api/control/:name/launch`, `POST /api/control/:name/stop`, both SUPERVISOR-only (this screen's Origin). Pure parts: `controlLaunchPlanOf`, `launchBlockOf`, `controlStopTargetOf`, `controlRowsOf`, `isControlRow`.
- **Record.** FLIGHT RECORDER `{kind: "control", op: "launch" | "stop", session, by: "SUPERVISOR", ok, jobId, tmux, cwd, permissionMode, error}` (`permissionMode` since ATC-76): `jobId` for background sessions, `tmux` for tmux ones (the session on launch, `<session> <pane>` on stop).

##### CONTROL SESSIONS on the FLEET tab, as built (ATC-130)

- **Moved, not changed.** The block moved from the settings window's AGENTS tab to a FLEET section, `CONTROL SESSIONS`, under the AIRCRAFT list. It shows the same things: LAUNCH and STOP (same tmux confirm), badges, job state and NEEDS YOU, STALE rows, ACCOUNT labels, the daemon warning and the model note. The API and `session-control.ts` are unchanged, and LAUNCH and STOP stay SUPERVISOR-only.
- **Order.** The daemon-in-service warning is the first line of the section, above the rows.
- **Refresh.** While FLEET is shown the section re-reads `GET /api/control/sessions` at most once a minute (skipped while the browser tab is hidden), and right after each LAUNCH or STOP. Opening the tab again within a minute shows the last reading instead of calling the API. The screen never polls faster than 60 s, with or without a server-side cache of `claude agents`.
- **Pointer.** The settings AGENTS tab keeps one line that links to `#fleet/control`. That address opens the FLEET tab and scrolls to the section, and the header CONTROL strip (ATC-127) uses the same target.
- **Header CONTROL strip as built (ATC-127).** `web/src/ControlStrip.tsx` (its own component, so ATC-116 can merge it with the other header bars) draws one chip per control session under the tab row: `TWR OCC MCC XCHK REV ENG`, e.g. `MCC ● 5m · 2분 전`. The rules are one pure, browser-safe function, `controlStripOf` in `server/control-strip.ts`: `down` (no live row, or every session of that name is dead), `needs` (job `blocked`, `needs` set, or a health code at `alert` level), `late` (last tick older than 2 × interval + 1 min; interval is the `/loop <n>m` of the first message, and without one nothing is late), `working` (job `working`), else `ok`. ENGINEERING shows only up or down. The last tick is the SQUELCH time when there is a SQUELCH record and the session's `lastActiveAt` only when there is none (the tooltip says so). Click goes to `#fleet/control` (one constant, `CONTROL_TARGET`). Below 768 px it folds into `CTRL n/6`. Display only: no LAUNCH or STOP, no new alert kind. Whether a `down` or `late` control session should raise an ALERT (and at which ATC-110 level) is a follow-up.
- **Data for the strip (ATC-127).** `GET /api/control/sessions` gained `squelch` per session (the last decision time from the tail of `squelch.jsonl`, plus `openedAt`, `quietSince`, `quietCount` from `squelch.json`; read only, `null` when there is no record) instead of a new endpoint. The server caches the `claude agents --json` read for 30 s (`server/agents-cache.ts`), shared by the strip and the FLEET section; `?fresh=1` skips the cache and the FLEET section sends it after LAUNCH or STOP. LAUNCH and STOP still read `agentRows()` fresh. The browser reads the endpoint at most once a minute, with the last value shared by the strip and the section (`web/src/controlData.ts`), each on its own 60 s clock (the section also reads the ACCOUNT labels). An old server (no `squelch`, no `job`) still renders with what it has.
- **Code.** `web/src/views/fleet/ControlSessions.tsx` draws it. The row logic (badge, tone, which button, NEEDS YOU, STALE) and the 60 s rule are pure functions in `server/control-view.ts`, tested in `server/control-view.test.ts`.

##### CONTROL group as built (ATC-132)

- **Same row as AIRCRAFT.** CONTROL SESSIONS is now a second group in the same list, under the AIRCRAFT rows (a group header row `CONTROL 6`), not a card block. The row shell is shared with the AIRCRAFT list (`FleetRowShell` in `StatusList.tsx`), so the two line up in the same columns: name (role and folder, hidden when the folder is just the lower-case name), AIRPORT `ATCC`, STATUS (`BUSY`, `IDLE`, `NEEDS YOU`, `NOT RUNNING`, tones of AIRBORNE, HOLDING, amber and NOT IN SERVICE), FLYING (the job's `detail`, or the NEEDS YOU chip), 경과 (the loop interval, `3m`), 마지막 활동, FOB and FUEL 14일. The 이번 주 column is left empty. In list layout the group hangs under the list; in card layout it stands alone with its own column heads.
- **Expand (▸, also with Enter or Space).** STOP or LAUNCH (same tmux confirm, still SUPERVISOR-only), folder and first message, a muted `STALE n` chip (tooltip: the ids and "Claude Code가 멈춘 job을 목록에 남긴 것, 무시해도 됨"; never amber and never on the collapsed row) and the ACCOUNT edit (`PUT /api/control/:name/account`, as before). A NEEDS YOU row starts expanded; if the SUPERVISOR collapses it, it stays collapsed.
- **Shared facts once.** The group header carries what every session shares: `CONTROL 6 · claude --bg · auto · acct-2 · model: TOWER·OCC Sonnet, MCC·CROSSCHECK Opus`. The common value is the most frequent one; a row shows a chip only when it differs (ACCOUNT, launch method such as `tmux에서 연 세션`, permission mode on the BG/TERM chip). The model comes from what each session actually used in the last 14 days (`/api/fuel`), and falls back to the folder-settings note when there is no record yet. The daemon-in-service warning stays at the top of the group.
- **Origin chip.** The same `fl-origin` chip ATC-98 puts on AIRCRAFT rows: `BG` (with the job id in the tooltip), `TERM` for a tmux pane, `DESKTOP` for a desktop session.
- **Data.** Refresh is as ATC-130 built it (`/api/control/sessions` at most once a minute). Last activity, origin and permission mode come from the snapshot. FOB and the 14-day FUEL COST come from one `GET /api/fuel?days=14` read when the group opens (reused for 60 seconds); no new polling. A session with no FUEL record or no context shows `—`, not 0. No API changed.
- **One ACCOUNT view.** The FUEL ACCOUNT block under the AIRCRAFT list is the single ACCOUNT view on FLEET. It now also says what a `hold` level does (`LAUNCH·ENTRY 제안 안 함`, the effect text FLEET PLAN used to carry). FLEET PLAN's own account line is dropped, and shows again only when the FLEET response has no `fuelAccounts` (an old server).
- **Code.** Row model, group facts (common values and per-row differs flags), the status rules and the account-view choice are pure functions in `server/control-view.ts` (`controlRow2Of`, `controlGroupOf`, `controlGroupFacts`, `accountViewOf`), tested in `server/control-view.test.ts`. `web/src/views/fleet/ControlSessions.tsx` draws them.

#### 8.5.2 Session origin as built (ATC-76)

`claude agents --json` only says `background` or `interactive`. On 2026-09-28 all ten interactive team sessions turned out to be desktop sessions, and the difference mattered for control (atc can stop and relaunch only background sessions), account (background uses the host CLI login, desktop the app's), lifetime (desktop sessions depend on the app's connection) and 2b delivery (a session in another permission mode may hold cross-session messages for its user).

- **Origin** (pure `originOf` in `server/session-origin.ts`): `background` when the session file's `kind` is `bg` or the `claude agents` row's `kind` is `background`. Otherwise the process command line decides, read once per pid and start time from `/proc/<pid>/cmdline` and the parent's (`server/session-proc.ts`): an executable under `~/.claude/remote/` (desktop sessions run as `~/.claude/remote/ccd-cli/<version>` under `~/.claude/remote/srv/<hash>/server`) is `desktop`; a plain `claude`, `…/bin/claude` or `…/claude/versions/<version>` is `terminal`; a process under the background daemon (`bg-spare`, `bg-pty-host`) is `background`; anything else is `unknown`. When the process can't be read, the session file's `entrypoint: "claude-desktop"` still gives `desktop`. Read-only: no signal, no attach, and no account identity is read or stored.
- **Permission mode** (`permissionModeOf`): `--permission-mode <m>` or `--permission-mode=<m>` on the command line. Background sessions don't carry it there, so it comes from the LAUNCH that started them: a successful FLIGHT RECORDER launch within 2 minutes of the session's start (`launchModeOf`). Control launches now record `permissionMode` too; older control records count as `auto`, which `controlLaunchPlanOf` always passed. Unknown otherwise.
- **API.** Each live Claude session in the snapshot has `origin` and `permissionMode`; `GET /api/fleet` has them on every AIRCRAFT view (`null` without a session), and the FLEET list rows carry an `origin` badge.
- **Shown.** The list row and the card show `BG`, `DESKTOP`, `TERM` or `?` with the permission mode. This replaces the `BG <id>` badge; the id is in the tooltip. A card whose session isn't background also shows the manual steps for its origin, and the ACCOUNT line notes that a BG session follows the host CLI login and a DESKTOP session the app's account (display only).
- **Used.** STOP on the card, the STOP API (`stopTargetOf` with `rowOriginOf`) and FLEET PLAN execution (`STOP`, `RESTART`, `REFRESH`, and stopping on `RETIRE`) act only when the origin is `background`. Other origins get their manual steps (`manualStepsOf`): close in the Claude app, `/exit` in the terminal, or `/clear` and paste the CREW BRIEFING for REFRESH. FLEET PLAN's `session` reason names the origin; its stored `value` stays `interactive` or `background`.
- **2b delivery.** `GET /api/dispatch/brief` has `delivery` per proposal AIRCRAFT: origin, permission mode, OCC's permission mode and a `warn` when both are known and differ (`deliveryOf`). The DISPATCH card and the IN FLIGHT row show `MODE <m> ≠ OCC <m>` as a possible held message. It never blocks.
- **BG chip with the job id (ATC-98).** The `BG` chip on the list row and the card already existed (ATC-76). ATC-98 adds the id it points to: the `Session` in the snapshot gains `kind?: "background" | "interactive"` and `jobId?` from the session file (pure `sessionKindOf` in `server/sources/claude.ts`; a missing or unknown `kind`, old snapshots and Codex sessions carry neither). `AircraftView` and `FleetRow` carry `background: { jobId: string | null } | null` from the AIRCRAFT's *live* session, computed from the snapshot alone (`liveViewOf`), so `claude agents` is not called more often. The chip's tooltip reads `BG <jobId> — claude attach <jobId>`, and the card has an `ATTACH 복사` button that copies `claude attach <jobId>`. A dead session, a STALE job (ATC-93) and an AIRCRAFT without a session have `background: null`: no chip. A background session whose `jobId` can't be read keeps the chip but has no attach command.

### RESTARTING as built (ATC-91)

A desktop `/clear` ends the session and gives the next one a new id; the name carries over. For a while the AIRCRAFT has no session, and FLEET showed `absent`, DISPATCH dropped its approved proposals ([dispatch.md](dispatch.md) 6.4). ATC-91 makes that gap a state: `RESTARTING`, for up to `restartGraceMin` (default 30, `dispatch.json`).

**Step 0, on real files (2026-09-29).**

- **What a `/clear` leaves.** Two cases on this machine. TEAM_J's own `/clear` at 17:07:14Z on 09-28: the old transcript `4a0c058e…` was last written at 17:07:14.911Z; the new one `7e5461b1…` was born 5 ms earlier (17:07:14.906Z), already carrying `custom-title` and `agent-name` `TEAM_J`, the `/clear` command line and its empty output; the first prompt came at 17:07:28Z. TEAM_I's `/clear` (the ATC-91 case): the old transcript `04a9a868…` last written at 01:41:20Z, and no new transcript until `085b1336…` was born at 01:49:24.583Z with the first prompt `TEAM_I` and `custom-title TEAM_I`. So a new file may or may not appear at the `/clear` itself, and the session file (`~/.claude/sessions/<pid>.json`) is gone in between; atc cannot rely on either. Neither transcript has an end marker: the last lines are `stop_hook_summary` and `last-prompt`.
- **The name is kept.** In both cases the new session's `custom-title` is the old one (`TEAM_J`, `TEAM_I`), and its session file (once it exists) carries the same name. The ids are new. (TEAM_I is now a `cli` session; that is a separate change of entrypoint, not a `/clear` effect.)
- **Hooks.** No `SessionStart` or `SessionEnd` hook is installed on this machine (`~/.claude/settings.json` has `PreToolUse`, `PostToolUse`, `StopFailure`, `Stop`, `Notification`), and no transcript records a `hookEvent` for them, so whether they fire for desktop sessions can't be told from files. The Claude Code 2.1.284 binary defines `SessionEnd` with `reason` `clear | resume | logout | prompt_input_exit | other`. Testing needs a hook in the SUPERVISOR's `settings.json`, which this change does not touch. **Decision: no hook.** Detection uses files only, so the PR stays out of `hooks/`; a hook would only make it immediate and can be added later.

**Detection** (`server/restarting.ts`, pure `restartingOf`; the read is `readEndedSessions` in `server/sources/claude.ts`). A transcript with no session file (any status: a dead pid's file is a crash, not a clear), written within `restartGraceMin`, whose last `custom-title` reads as a REGISTRATION, and whose last fact is a reply with no pending tool call (a normal end: not an API error, an approval wait, or a prompt left unanswered, which `health` handles), makes that REGISTRATION `RESTARTING` for `restartGraceMin` after its last write. It ends as soon as a live session with the same REGISTRATION appears (`Team I` counts), and after the grace it is over. The transcript's last write is the clock, not atc's memory, so a server restart does not lose it. `snapshot.restarting` lists them. A session someone closes on purpose looks the same for the grace period; that is the price of not needing a hook.

**Where it shows.** `GET /api/fleet` gives `restarting: {registration, name, sessionId, since, until}` (or `null`) with `status: "absent"` unchanged, so FLEET PLAN keeps its view except that it no longer proposes a `LAUNCH` for a `RESTARTING` AIRCRAFT (the SUPERVISOR is about to talk to it). The FLEET status list shows the status `RESTARTING` and the tag `세션 없음 — /clear 뒤 첫 메시지 대기` in the FLYING cell; the card says the same with the time it waits until and that approved proposals stay open. DISPATCH: [dispatch.md](dispatch.md) 6.4.

### Idle exit and LAUNCH from DISPATCH as built (ATC-129)

A background AIRCRAFT that finishes a FLIGHT and waits is gone an hour later, and until ATC-129 it dropped out of DISPATCH: the planner only sees live sessions. Now an absent background AIRCRAFT stays a candidate, and approving its card launches it (8.5's `launchAircraft`) before OCC sends the FLIGHT PLAN. The DISPATCH side is in [dispatch.md](dispatch.md), "LAUNCH on approve and RESUME as built (ATC-129)".

**Step 0: the idle exit (2026-09-29, Claude Code 2.1.284, read-only).**

- **What happens.** The background daemon (`claude daemon run`, 8.5) retires a background worker that has been idle for about 60 minutes. Its log `~/.claude/daemon.log` says so line by line:
  - `05:34:30Z bg retire 2b7110c1: settled, idle 60m` and `bg settled 2b7110c1 (done)`: TEAM_G, last turn 04:34:21Z.
  - `05:44:30Z bg retire a7bd6d77: idle-prompt, idle 60m` and `bg retire 0edf3386: idle-prompt, idle 60m`: TEAM_I and TEAM_K.
  - `06:20:30Z bg retire 647369e3: idle-prompt, idle 97m`: TEAM_J, last turn 05:19:44Z.
  - Earlier: `2026-09-28T19:10:30Z bg retire 44a0a5d5: settled, idle 61m` (TEAM_K), `2026-09-29T04:21:30Z bg retire dd6ea8ef: stale-spare, idle 61m` (an unused spare worker).
- **The reasons in the log** are `settled` (the turn ended and the job is `done`), `idle-prompt` (waiting at the prompt) and `stale-spare` (a pre-spawned spare nobody claimed). The check runs on a one-minute tick (every retire is at `:30` seconds), so the exit comes 60 to 61 minutes after the job last changed. J's 97 minutes: the idle time counts from the job's `updatedAt`, and something else held the retire off until 06:20Z (recent input or a task in flight, see the rule below).
- **Afterwards.** `~/.claude/jobs/<id>/state.json` shows `state: "done"` with `lastTerminalAt` at the retire time (G `05:34:30.488Z`, J `06:20:30.456Z`), the session file under `~/.claude/sessions/` is gone, `claude agents --json` has no row with a `pid`, and FLEET shows `absent`. The transcript is untouched: its last write is the last turn, so RESTARTING (ATC-91) does not mistake a retire for a `/clear` (the grace is over long before).
- **The rule in the binary** (`retireIfSettled` in the 2.1.284 daemon code, read with `grep`/`dd`, nothing run). A sweep runs every 60 s (`Me=60000`). A worker is retired when its job has been idle, counted from `updatedAt` in `~/.claude/jobs/<id>/state.json`, for at least `3600000` ms (1 hour; `28800000`, 8 hours, for a session bridged to a remote client; 60 s under low memory). It is not retired while a client is attached (`claude attach`), while it is pinned, after recent input, while a routine or a session cron (`/loop`) is scheduled, or while tasks are in flight. The cause is `settled` when the job state is terminal, `idle-prompt` otherwise, `stale-spare` for an unclaimed spare. The threshold is a constant: no environment variable or setting feeds it.
- **Why control sessions survive.** TOWER, OCC, MCC and CROSSCHECK run `/loop`, which schedules a session cron, so they are never "settled" and a tick starts a turn every few minutes.
- **A setting.** Neither `claude --help` nor the settings list in 2.1.284 names an idle timeout for background sessions, and nothing documented extends it. Pinning (agent view) or keeping a client attached would stop the retire, and a `/loop` would keep a session busy; atc uses none of these. It relaunches on approval instead of keeping sessions alive, and it sends no keep-alive messages.
- **Documented.** Claude Code's agent view page (code.claude.com/docs/en/agent-view) says a session that is finished or waiting for the next message and unattached for about an hour is stopped by the supervisor to free resources, and that only pinning it (Ctrl+T in agent view) keeps it running. No setting extends it.
- **Resume paths (not used).** The conversation is kept. `claude --help` (2.1.284) documents three ways back: `claude attach <id>` (interactive, needs a terminal), `claude --resume <session-id>`, and `claude --bg --resume <session-id> "<prompt>"`, which "continues that session in the background under the same ID". The last one could resume a cut FLIGHT with its whole context. `claude respawn <id>` only restarts a running session on the current binary. ATC-129 keeps the spec's fresh LAUNCH (`launchAircraft`, the FLEET button's path) and carries the STAND, branch, last commit and last report in the FLIGHT PLAN instead. Resuming with `--bg --resume` is a possible later change, untested here.

**Which AIRCRAFT count** (`snapshot.absent`, read by `server/absent-run.ts`, pure `absentOf` in `server/dispatch-launch.ts`).

- No live session (any origin) with that REGISTRATION, not `RESTARTING`, in the registry (`fleet.json`) and not RETIRED.
- **Background origin:** a successful atc LAUNCH in the FLIGHT RECORDER (`kind: "fleet"`, `op: "launch"`, `ok`) in the last 14 days. A desktop or terminal AIRCRAFT has no such line, so it is never launched this way. The permission mode and model of that LAUNCH are used again.
- **Cut** (ATC-86): the job id of that LAUNCH finds the transcript (`~/.claude/projects/*/<jobId>-….jsonl`, also after the session moved into a worktree). If its tail ends in a limit cut (a `wrap_up` note after the last prompt and after the last `release`), `cut` carries the cut time, the reset from the ACCOUNT's FUEL records (`cutResetOf`, the same as a live cut) and the last line of the CAPTAIN's last message. A new prompt after the cut means no cut. The transcript lookup tries the project folders of the launch's repository (and its worktrees) first and walks every folder only if that misses; a found path is kept, a miss is retried after 10 minutes. The FLIGHT RECORDER is read once a minute; the transcript tail is cached by size and mtime.
- `GET /api/snapshot` has `absent: [{registration, launchedAt, jobId, permissionMode?, model?, cut: {sessionId, cutAt, resetsAt | null, weekly?, report} | null}]`.

**LAUNCH from a card.** Only the approve of a `launch` card in DISPATCH, clicked on this screen (`fromThisApp`), calls `launchAircraft`; no tick or timer does. The FLIGHT RECORDER line is the 8.5 one with `by: "SUPERVISOR"` and the new field `proposal: "D-xxxx"`. A refusal before `claude --bg` runs (cap, already live, RETIRED) is now recorded too when it came from a card. The cap (`ATC_MAX_LAUNCHED`) counts live background sessions plus approved `launch` cards whose session has not appeared yet.

**RESUME.** A FLIGHT cut by the limit comes back after the reset as a RESUME card for the same REGISTRATION ([dispatch.md](dispatch.md)). This replaces the SUPERVISOR's manual "continue" only for an absent background AIRCRAFT. A live session in `RESUME` keeps the ATC-86 behaviour above: `RESUME 필요`, and the SUPERVISOR sends "continue" in that session.

### 8.6 FLEET PLAN: proposing LAUNCH, STOP and the rest

Status: steps 1 and 2 built (shadow, 2026-09-28), with the `REFRESH` kind (cabin turnaround, ATC-69); SUPERVISOR decisions recorded below. Section 8.5 gave the SUPERVISOR the controls; this section decides when atc suggests using them, so that forming, parking, servicing and retiring teams stops being manual bookkeeping.

**Current facts (2026-09-28 06:30 UTC).**

| Signal | Where atc already has it | Value now |
|---|---|---|
| Demand | DISPATCH plan (`assign`, `excluded` with reason codes, per-AIRPORT slots) | 0 dispatchable FLIGHTs; 2 excluded (parent issues) |
| Supply | FLEET view and `claude agents --json` | 10 AIRCRAFT: VCDO 6 (TEAM_A–F), ATCC 3 (TEAM_H–J), RNPU 1 (TEAM_K); all VCDO teams HOLDING or PARKED |
| Output | LOGBOOK actuals | 14-day ARRIVED: VCDO teams 1–5 each, ATCC teams 15–19 each |
| Runway | LOGBOOK landing wait, ATFM (ground stop, merge slots) | Landing-wait median: VCDO 12–48 h, ATCC 2–3 min |
| Health | Session status (NORDO), LOS, AOG, crew drift | no AOG, no LOS |
| Usage | none per AIRCRAFT (FUEL, idea #53) | Claude Code showed 87% of the weekly limit on 2026-09-28 |

Two things follow. VCDO throughput is bounded by landing, not by the number of teams: another VCDO team today would add PRs to the queue, not ARRIVED FLIGHTs. And with no dispatchable demand, the first useful proposals are parking ones, not launches.

**Principles** (from how airlines run fleet planning, crew control and maintenance; sources at the end of this section):

1. **Propose with reasons, the SUPERVISOR decides.** Airline optimizers (crew pairing and rostering, disruption recovery) produce ranked options with explicit trade-offs, and ops control approves. FLEET PLAN proposals carry reason codes with numbers, and start in shadow: agree or disagree only, the same gate as DISPATCH and SCHEDULE (20 verdicts, 80% agreement) before approval mode.
2. **Automate only what is reversible.** Of all fleet actions only STOP of an idle, atc-launched background session can undo itself (the conversation is kept and resumes). It is the only candidate for automation, after approval mode has run, behind a switch with a daily cap and an automatic off condition. LAUNCH spends usage; RETIREMENT, TYPE RATING and CREW CHANGE are never automatic.
3. **Capacity follows demand and the runway.** No LAUNCH is proposed for an AIRPORT under GROUND STOP, or where landing is the bottleneck (landing-wait median above the median block time, or open PRs already filling the merge slots).
4. **Keep a reserve.** Like airline standby crews, each AIRPORT with demand keeps `reserve` AIRCRAFT PARKED (default 1). Demand beyond the reserve suggests LAUNCH; idle capacity beyond it suggests STOP.
5. **Qualifications are hard constraints.** A LAUNCH or ENTRY proposal names the TYPE RATING or CONFIGURATION that the waiting FLIGHTs need (FLIGHTs excluded for lack of an `SEC` AIRCRAFT suggest a `security` CONFIGURATION), exactly as the planner's rules do.
6. **No thrash.** A proposal needs its condition to hold for two plan cycles, and an AIRCRAFT launched or stopped in the last `minDwell` (default 2 h) gets no opposite proposal.

**Proposal kinds.**

| Kind | Airline analogue | Proposed when | Executes (approval mode) |
|---|---|---|---|
| `LAUNCH` | reserve call-out | countable FLIGHTs (see Decisions) at an AIRPORT have waited `waitMin` (default 120 min) with no available AIRCRAFT holding the needed ratings, the reserve is short, the runway is not the bottleneck, and the background cap has room; a registered AIRCRAFT not in service fits | 8.5 LAUNCH |
| `ENTRY` | wet lease | as `LAUNCH`, but no registered AIRCRAFT fits; proposes REGISTRATION, AIRPORT and CONFIGURATION | ENTRY INTO SERVICE, then LAUNCH |
| `STOP` | parking | an atc-launched background session has had no STAND, no FLIGHT and no activity for `idleHours` (default 12) and the AIRPORT keeps its reserve without it | 8.5 STOP (resumable) |
| `RESTART` | scheduled check | a background session is PARKED and older than `restartDays` (default 3); or AIRCRAFT health (8.8) says `CONTEXT`, or `HUNG` at ALERT level (ATC-48) | STOP, then LAUNCH with a fresh CREW BRIEFING (a desktop or terminal session is closed and reopened by hand) |
| `REFRESH` | cabin turnaround | the AIRCRAFT is PARKED or HOLDING only STANDs of ARRIVED FLIGHTs, has no open PR and no FLIGHT in this plan, was not launched in the last `minDwell`, and its conversation is over `refreshTokens` (default 300k) or `refreshPct` of its window (default 40 %) (ATC-69) | background session: as `RESTART`. Desktop or terminal session: nothing runs; the SUPERVISOR types `/clear` in that session and pastes the CREW BRIEFING |
| `AOG` | MEL deferral with an expiry | the session is NORDO or had a LOS in the last 24 h; or AIRCRAFT health (8.8) says `MODEL`, or a weekly `LIMIT` (ATC-48) | AOG with `until` = now + 24 h (a weekly `LIMIT` alone: the reset day); when it expires unresolved, a `RETIRE` or return proposal follows |
| `RETIRE` | phase-out | no ARRIVED in `retireDays` (default 30), not needed for the reserve, no open PR | SUPERVISOR only, never automatic |

**Records and screens.** `fleet-plan.jsonl`, append only: `{op: "create", id: "F-0001", kind, aircraft, airport, reasons: [{code, detail, value}], at}`, then `{op: "verdict", id, verdict: "agree" | "disagree", by, at}`, `{op: "expire" | "supersede", id, at}`, and in approval mode `{op: "approve" | "executed", id, at, jobId?}`. `GET /api/fleet/plan` returns open proposals, recent ones and the gate. The FLEET tab gets a FLEET PLAN block above the cards with each proposal's reasons and agree / disagree; approval mode adds approve, which runs the same code as the buttons in 8.5 and writes the FLIGHT RECORDER line with `by: "FLEET PLAN F-0001"`. The plan runs on the DISPATCH cycle (5 min) and only reads.

**Built (steps 1 and 2, shadow, 2026-09-28).**

- **Pure** (`server/fleet-plan.ts`): `fleetPlanOf(inputs)` returns the candidates and one demand row per AIRPORT. `persistOf` holds a candidate for two cycles, and LAUNCH and ENTRY for `waitMin`. `syncFleetPlan` writes the lines: `create`; `expire` when the condition clears; `supersede` when the same key now names another kind or AIRCRAFT. It never re-proposes a judged proposal within 24 h, and never proposes the opposite (LAUNCH ↔ STOP, RESTART) within `minDwell`. `fleetPlanGateOf` is the gate.
- **Demand.** The planner runs a second time with `candidateTeams` set to every `LINEAR_TEAM_KEYS` team. Its new `unserved` list holds FLIGHTs that passed every exclusion but got no AIRCRAFT: `no-aircraft`, `unqualified` or `no-tail`. FLIGHTs left over only because the AIRPORT's AIRBORNE slots are full are not counted.
- **Readings of the rules above.**
  - "The reserve is short" for LAUNCH follows from unserved demand: a qualifying PARKED AIRCRAFT would have been assigned. The reserve rule does its work in STOP and RETIRE.
  - The runway is the bottleneck when the AIRPORT's 14-day landing-wait median exceeds its block-time median. No records means no bottleneck.
  - Only `kind: stop` GROUND STOPs block a LAUNCH, shadow or enforced.
  - STOP and RESTART look at every background session (`claude agents --json`, `kind: background`), not only atc-launched ones.
  - ENTRY never serves `tail:` FLIGHTs.
  - LOS is an `alert.raised` conflict in the FLIGHT RECORDER in the last 24 h. NORDO is a dead session with no live one of that name.
  - RETIRE skips an AIRCRAFT entered less than `retireDays` ago.
- **Runner** (`server/fleet-plan-run.ts`): runs on the DISPATCH cycle. It skips a cycle when Linear or GitHub has not been read yet or `claude agents` fails, and leaves open proposals as they are. The persistence counter is in memory, so a restart counts again from zero.
- **API.** `GET /api/fleet/plan` returns `{mode, config, ranAt, error, demand, fuel, open, waiting, recent, gate}`. `open[].now` holds the reasons as computed now. `waiting` lists candidates still inside the persistence window, without the ones resting after a verdict. `POST /api/fleet/plan/:id/verdict` takes `{verdict: "agree" | "disagree", reason?}`. It needs this screen's Origin (403 otherwise) and returns 409 on a closed proposal.
- **Tab.** The FLEET PLAN block sits above the cards: gate, one demand line per AIRPORT with what blocks a LAUNCH, one FUEL line per ACCOUNT (below), open proposals with reasons and 반대 / 동의, candidates still waiting, and recent closed ones.
- **FUEL (ATC-63, [fuel.md](fuel.md) 6).** FLEET PLAN reads FUEL REMAINING per ACCOUNT (`snapshot.fuelAccounts`, control sessions included).
  - **Hold level** (`holdPct`, default 95 %): no LAUNCH for an AIRCRAFT whose ACCOUNT is there; the next fitting AIRCRAFT is picked, and a LAUNCH that skipped a held one carries a `fuel-held` reason. When every fitting AIRCRAFT is held, nothing is proposed, not even ENTRY, and the AIRPORT's demand line says why: `FUEL 사용 100% (account acct-1) until 21:48Z — TEAM_Q — ENTRY도 제안 안 함(새 세션이 열릴 계정을 모름)`. A new session opens on whatever account this machine is logged in to, which atc doesn't know (ENGINEERING decision: with all AIRCRAFT on one ACCOUNT, an ENTRY would put a new session on the same empty account).
  - The ordinary ENTRY (no registered AIRCRAFT fits at all) counts the new AIRCRAFT against the `default` ACCOUNT and is not proposed when `default` is at hold: `FUEL 사용 97% (account default) until 21:49Z — 새 AIRCRAFT(ENTRY)가 들 ACCOUNT`.
  - This uses the hold level whatever the DISPATCH FUEL HOLD switch (D3) says (ENGINEERING decision): a proposal is advice, and a session on an empty ACCOUNT is never useful. DISPATCH is unchanged.
  - **Info level** (`infoPct`, default 80 %): the proposal is made and carries a `fuel` reason line (`FUEL 사용 85% · resets 21:00Z (account acct-1) — 한도에 가까움(INFO) · TEAM_I · control OCC`).
  - **Lookup**: by the AIRCRAFT's ACCOUNT label, since an AIRCRAFT that isn't flying has no session and no value of its own; an ACCOUNT that only control sessions report is found too. Without any labels an AIRCRAFT uses only its own sessions' value, and ENTRY has no ACCOUNT to check. With no FUEL record, nothing changes.
  - **Expiry**: an open LAUNCH or ENTRY whose ACCOUNT reaches hold is expired on the next cycle with the FUEL text as its reason, even when the same candidate would still be produced. A new candidate for the same AIRPORT is then created, not superseded.
  - **Block**: one line per ACCOUNT with the most-used window and its reset, `LAUNCH·ENTRY 제안 안 함` at hold or `제안에 FUEL 사유 줄` at info, and its AIRCRAFT and control members. `GET /api/fleet/plan` returns them as `fuel`, read from the snapshot when the view is served, not from the last plan cycle.
  - STOP, RESTART, AOG, RETIRE and RETURN, approval-mode execution and the record formats are unchanged.
- **First look at live data (2026-09-28 07:15 UTC):** no proposals. ATC-35 would go to TEAM_I, and the other open ATC FLIGHTs have no priority. All team sessions are desktop sessions. There is no NORDO or LOS, and every AIRCRAFT ARRIVED within 30 days.

Not built yet: step 4 (automatic STOP). Step 3 (approval) and the follow-up of an expired AOG (`RETURN`) are built in 8.7; merge-slot fill in the runway rule; CROSSCHECK marks on FLEET PLAN proposals. The weekly-usage line (FUEL) is built (ATC-63, above).

**Implementation order.**

1. ✅ Pure `fleetPlanOf(snapshot, fleet, dispatchPlan, logbook, sessions, atfm, config, now)` with tests for every kind and for the anti-thrash rule.
2. ✅ Shadow: records, API, FLEET PLAN block, agree / disagree, gate.
3. Approval mode (switch in `dispatch.json` or its own file): approve executes through 8.5 and profile patches.
4. Automatic STOP of idle atc-launched sessions only: switch, daily cap, off after two SUPERVISOR reversals in 7 days.

**Risks.**

| Risk | Mitigation |
|---|---|
| Launch and stop oscillate | two-cycle persistence, `minDwell`, reserve as hysteresis |
| Usage runs out | background cap (8.5), LAUNCH never automatic; no LAUNCH or ENTRY into an ACCOUNT at the FUEL hold level, and the FUEL line per ACCOUNT on the block (ATC-63) |
| Wrong demand signal (parent issues, missing labels) | count only FLIGHTs that pass the planner's exclusions; excluded FLIGHTs are shown, not counted |
| More teams, same landing queue | the runway rule (principle 3) |
| A RESTART loses useful context | only PARKED sessions; the old conversation is kept and resumable |

**Decisions (2026-09-28, SUPERVISOR).**

- Defaults as proposed: `reserve` 1, `waitMin` 120, `idleHours` 12, `restartDays` 3, `retireDays` 30, `minDwell` 2 h. Shadow data and the gate decide later changes.
- ATC FLIGHTs count as demand. FLEET PLAN counts the open FLIGHTs of every team in `LINEAR_TEAM_KEYS`, not only `candidateTeams`, with the same exclusions as the planner (parent issues, closed states, `tail:` to another AIRCRAFT). DISPATCH assigns only `candidateTeams`; ATC was added there on 2026-09-28, so ATC FLIGHTs are dispatched too. ATC FLIGHTs carry the workspace classification labels; where one has none, the rating check is skipped and the reason says so.
- Step 4 (automatic STOP) stays in the plan but is built last, with its switch off by default. Turning it on is a separate SUPERVISOR decision after the shadow gate passes.
- REFRESH (ATC-69, PILOT'S DISCRETION in the EO, open to SUPERVISOR review): a kind of its own rather than a third RESTART trigger, so the gate counts its verdicts apart and a desktop session gets hand steps instead of a refusal. Thresholds `refreshTokens` 300k and `refreshPct` 40 %, whichever comes first. Nothing restarts a desktop or terminal session automatically, and step 4 still decides any automatic STOP.

Sources: [Jeppesen crew pairing](https://ww2.jeppesen.com/airline-crew-optimization-solutions/airline-crew-pairing/), [Lufthansa Systems NetLine/Crew](https://www.lhsystems.com/solutions/operations-control-center/netline-crew), [airline disruption recovery survey (arXiv 2510.26831)](https://arxiv.org/html/2510.26831), [OAG on wet leasing](https://www.oag.com/blog/what-is-wet-leasing), [SKYbrary: MEL](https://skybrary.aero/articles/minimum-equipment-list-mel), [EASA AI levels (Halldale)](https://www.halldale.com/civil-aviation/easa-ai-framework-aviation-safety-regulations), [ICAO on aircraft parking](https://www.icao.int/operational-safety/Aircraft-Parking).

### REFRESH as built (ATC-69)

A team that finished its FLIGHTs keeps their whole conversation. On 2026-09-28 TEAM_J sat PARKED with 504k of its 1M window after ATC-63 merged; every turn re-read that prefix, and the first wake after the cache went cold re-wrote it (F3's COLD CACHE, [fuel.md](fuel.md) 5). The cheapest moment to start over is right after a FLIGHT, while the team rests. REFRESH proposes it.

- **CONTEXT SIZE** (`server/fuel-context.ts`, pure). Per session, the last CAPTAIN (non-sidechain) request's `input + cacheRead + cacheWrite`, with its time and model, from the records FUEL F1 already parses; CREW requests don't count. A `compact_boundary` after that request replaces it with the compaction's `postTokens` (unknown if the line has none). `base` is the session's first CAPTAIN request (system prompt, rules and CREW BRIEFING, about 50k on 2026-09-28): what a fresh session writes again anyway.
- **Window.** Transcripts record `claude-opus-5-5`, never the `[1m]` suffix, so the window is read in this order: `contextWindows` in `fleet-plan.json` (`{"claude-opus-5-5": 1000000}`, model name, a `-YYYYMMDD` suffix is ignored), a `[1m]` in the model name, a request over 200k already seen in the session (so the window must be 1M), else 200k. The source (`config`, `model`, `observed`, `default`; ATC-85 adds `statusline` and `model-command`, below) goes with the size. The `refreshPct` rule applies only when the window is not the 200k guess; then only `refreshTokens` counts.
- **Saving.** `(context − base)` priced with the F5 table: the cache write at the session's current tier (1 h for CAPTAIN) that the next cold wake would not need, and the cache read every turn would not need. On 2026-09-28 TEAM_J's 504k session: about $3.64 per cold wake and $0.09 per turn on Opus 5.5. Unpriced models show tokens only.
- **Reasons.** `context` (`502k / 1M (50%) — claude-opus-5-5, 2026-09-28 17:07Z (기준 300k 또는 40%, 창은 본 크기로 짐작)`), `saving`, `arrived` (last ARRIVED FLIGHT, and any STAND still held for one), `session` (`background` or `interactive` in its value).
- **With RESTART.** When the same AIRCRAFT already has a RESTART candidate (age or health), REFRESH adds its `context` and `saving` lines to it instead of a second proposal. `minDwell` treats a LAUNCH or RESTART proposal as the opposite of REFRESH.
- **Approval.** A background session runs the RESTART steps (8.5 STOP, then LAUNCH with the last LAUNCH's permission mode and model). A desktop or terminal session is refused by approve (409): the card says to `/clear` in that session and paste the CREW BRIEFING, has a **CREW BRIEFING 복사** button, and in approval mode **했음** closes it as an agree verdict, the only agree allowed in approval mode.
- **API.** `GET /api/fleet` gives each AIRCRAFT `context: {contextTokens, window, at, pct, model, windowSource, compacted}` for its live session (latest one if several); `GET /api/fuel` gives the same per session and per AIRCRAFT (its latest session in the window). Sizes are computed from the transcripts changed in the last 7 days and kept for 60 s.
- **Screens.** The FLEET list has a CONTEXT column (`502k / 1M`, the share as a colour from 40 %), and the card a `context 502k / 1M (50%)` line with the time and the window's source. ATC-81 renamed both as FOB (below).

### FOB as built (ATC-81)

Two numbers were both called fuel on a FLEET row and read alike: the ACCOUNT's plan limit (the share **used**, the same on every AIRCRAFT of the ACCOUNT) and, since ATC-69, the AIRCRAFT's own context. ATC-81 (display text only) gives each its own word.

- **FOB (FUEL ON BOARD)** is the AIRCRAFT's own fuel: the context window left. The list column is `FOB 50% · 504k/1M` and the card line `FOB 50% · 504k / 1M`. The colour follows the meaning: amber at 60 % left or less, alert at 30 % or less (ATC-69's 40 % / 70 % used, the same points), decided on the whole-number percentage that is shown. When the window is only the 200k guess, the token points (300k, 500k) still decide. `GET /api/fleet` keeps the field name `context` and adds `fobPct` (0–100, `null` when a compaction left the size unknown). The `context` reason line of REFRESH in FLEET PLAN is unchanged: it reports what is used.
- **ACCOUNT plan limit** leaves the row. It stays in the FLEET FUEL block, on the card and in the FLEET PLAN FUEL lines, and the row keeps one thing: the tag `HOLD · FUEL (account pro-2) until 21:00Z` when the ACCOUNT is at the hold level (the level of `holdPct`, whatever the DISPATCH switch says, as the row colour did before), because a held ACCOUNT blocks assignment. The tag carries no percentage; the tooltip does.
- **Wording.** Every plan-limit text says it is used: `사용 87% · resets 21:00Z` on screen, `FUEL 사용 87% · resets 21:00Z (account pro-2) — TEAM_K` in the TOWER `open.fuel` and FOLLOWING `fuel` texts and the FLEET PLAN FUEL lines, `HOLD · FUEL (account pro-2) until 21:00Z — 5h 한도 사용 96%` as the DISPATCH reason. No value, threshold or rule changed.

### CONTEXT window from the session as built (ATC-85)

ATC-69 guessed the window because transcripts drop `[1m]`. ATC-85 lets a session say its own window; the guess stays the fallback. Display and source only: no threshold, FOB label or REFRESH rule changed.

- **Order.** Per session, the first that applies: `statusline` (the `context_window_size` a CLI session's statusline command recorded), `model-command` (the session's last `/model` output in its transcript), `config` (`contextWindows`), `model` (`[1m]` in the model name), `observed` (a request over 200k seen), `default` (200k). `windowSource` in `GET /api/fleet` and `GET /api/fuel` names which one, and the FLEET CONTEXT/FOB tooltip says it (`창: 세션이 알림(statusline context_window_size)` or `창: 세션의 마지막 /model 출력`).
- **`statusline`** (CLI sessions: TOWER, OCC, MCC). The hook records `context_window_size` and the model id next to `rate_limits` ([fuel.md](fuel.md) 6.1). The value is exact, so a conversation over it is shown as it is (FOB 0 %). A record is stale, and skipped, when a later `/model` came after it or the session's last request used another model than the record's.
- **`model-command`** (desktop sessions, which write no statusline record). A transcript holds the `/model` result as a user line `<local-command-stdout>Set model to \`claude-sonnet-5-5[1m]\`</local-command-stdout>`. `[1m]` means 1M; a `claude-*` id without it means 200k. A non-Claude id (DeepSeek, Muse through a proxy) or a display name (`Sonnet 5`) says nothing about the window but still ends what came before. If a request after the command is larger than the window it named, the command was wrong for that model and the window falls back to `observed`.
- **Reset.** Requests from before the session's last `/model` belong to another model and no longer count as `observed`; a new session starts from nothing. TEAM_J on 2026-09-29 switched from Opus (1M) to `claude-sonnet-5-5` with a 324k conversation: the window is now 200k and FOB reads 0 % until the auto compaction (324k to 14k) lands, where before it read a 1M window and 68 % left.
- **Step 0, what else a desktop transcript says about its window.** Checked on the 207 transcripts on this machine (2026-09-29). `compactMetadata` has `trigger`, `preTokens`, `postTokens`, `durationMs` and no window. Auto compactions of 200k sessions fire at 167k–178k and of 1M sessions at 968k–974k, which looks like a window signal, but it is not exact and is **not used**: the compaction right after TEAM_J's switch fired at 324,404 (the earlier model's conversation), and proxied models fire elsewhere (394k, 796k). `usage` has no window field (`context_management` is empty, `iterations` is `[]`). The CLI picker also writes display names such as `Opus 5.5 (1M context)` (`Kept model as …`), which is not an id and is left alone. The statusline input carries `context_window.context_window_size` and `model.id` (read from the Claude Code 2.1.284 binary).
- **Tier.** The hook and the record format in the state folder (`fuel/<sessionId>.jsonl`, still numbers and a model id only) are `user` tier. Old lines (`rate_limits` only) are read as before.

### 8.7 FLEET PLAN step 3: approval

Status: built (2026-09-28), SUPERVISOR decisions recorded below. Section 8.6 built the shadow: atc proposes and the SUPERVISOR agrees or disagrees, and nothing moves. Step 3 lets the SUPERVISOR's approval run the proposal. Each proposal is still approved by a person, one at a time. Automatic STOP stays step 4, off by default.

**Current facts (2026-09-28 07:30 UTC).**

| Fact | Value |
|---|---|
| FLEET PLAN | shadow since 07:25 UTC, 0/20 verdicts, no open proposal |
| Executors that exist | 8.5 LAUNCH and STOP (`launchPlanOf`, `stopTargetOf`, `claude --bg`, `claude stop`), `entryIntoService` (ENTRY INTO SERVICE), `applyPatch` with `aog` and `retired` (AOG, RETIREMENT) |
| How other switches work | DISPATCH `mode` (`POST /api/dispatch/mode`) and SCHEDULE `mode`: no gate check and no Origin check, a `mode:` line in the FLIGHT RECORDER. AUTOLAND and the settings window: Origin check (`fromThisApp`). ATFM OFF: anyone may turn things off |
| Sessions | 10 team sessions, all desktop; 0 of 6 background |

**Principles.**

1. **Approve is execute.** In approval mode the SUPERVISOR's approval runs the proposal right away, through the same code as the FLEET tab buttons. There is no approved-then-waiting state and no OCC in between. Nothing here sends a message to a team: a LAUNCH delivers the CREW BRIEFING as the session's first prompt, the same as the 8.5 button.
2. **Check again at approval.** A proposal can be up to 24 h old. Approval runs only if the latest plan cycle (at most 10 min old) still produces the same kind for the same AIRCRAFT, and every 8.5 refusal still passes. Otherwise it answers 409 and the proposal stays open.
3. **SUPERVISOR only, on this screen.** The switch into approval mode and every approval need this screen's Origin, like LAUNCH, STOP and AUTOLAND. `atcctl` has no FLEET PLAN commands, so TOWER, OCC, CROSSCHECK and REVIEW can neither approve nor turn it on. Going back to shadow is allowed from anywhere: turning something off must never be blocked.
4. **The gate opens the switch.** Approval mode can be turned on only when the shadow gate is ready (see Decisions for the count). The block keeps showing the gate. In approval mode, approve counts as agree and reject as disagree.
5. **Every step leaves a line.** A proposal gets an `approve` line and then one `executed` line with each step's result. The FLIGHT RECORDER gets a `fleet` line per step with `by: "FLEET PLAN F-0001"`.

**Execution per kind.**

| Kind | Steps on approval | Options on the approval form |
|---|---|---|
| `LAUNCH` | 8.5 LAUNCH of the proposed AIRCRAFT | permission mode (default `auto`), model (optional) |
| `ENTRY` | ENTRY INTO SERVICE (proposed REGISTRATION, AIRPORT, CONFIGURATION), then LAUNCH | as LAUNCH. The REGISTRATION is checked again and refused if taken |
| `STOP` | 8.5 STOP | none |
| `RESTART` | STOP, then LAUNCH with a fresh CREW BRIEFING | permission mode and model, pre-filled from the AIRCRAFT's last LAUNCH line in the FLIGHT RECORDER |
| `AOG` | profile `aog: {reason: "FLEET PLAN F-0001: <reason codes>", until}` | the `until` date (default from the proposal) |
| `RETIRE` | profile `retired: {reason: "FLEET PLAN F-0001"}`, then STOP when the AIRCRAFT flies a background session | "stop the background session too" (default on) |
| `RETURN` (new) | profile `aog: null` | none |

`RETURN` is the follow-up the 8.6 AOG row promised. An AIRCRAFT whose AOG was set by FLEET PLAN gets a RETURN proposal when its `until` date has passed. The reasons say whether the cause is gone (a live session, no LOS in 24 h) or still there. A still-NORDO AIRCRAFT then shows up as a normal LAUNCH candidate. RETIRE keeps coming only from the 30-day rule.

**Partial failure.** ENTRY and RESTART have two steps. When the second step fails, the first stays done and the `executed` line says which step failed: the AIRCRAFT is in the FLEET but not flying, or a session was stopped but not relaunched. The card buttons fix either by hand. A failed execution closes the proposal as `failed` without the 24 h cooldown, so the next cycles can propose it again.

**Records and screens.**

- `fleet-plan.jsonl` adds `{op: "approve", id, by, at, options}` and `{op: "executed", id, at, ok, steps: [{action, ok, jobId?, error?}]}`. The statuses become `open → executing → executed | failed`, and `open → disagreed` when rejected. `executing` is set only during the request, and a per-id lock keeps a double click from running twice.
- The mode lives in its own file, `~/.local/state/atc/fleet-plan.json` (`{mode: "shadow" | "approval"}`), written atomically. Each switch writes a FLIGHT RECORDER line `{kind: "fleet-plan", op: "mode:approval" | "mode:shadow", by}`, so step 4 can measure how long approval mode has run (the same `approvalRunOf` as ATFM).
- The FLIGHT RECORDER `fleet` line gains the ops `entry`, `aog`, `return` and `retire`, next to `launch` and `stop`.
- API:
  - `POST /api/fleet/plan/mode {mode}`: approval needs Origin and a ready gate (409 otherwise). Shadow is always accepted.
  - `POST /api/fleet/plan/:id/approve {permissionMode?, model?, until?, stopSession?}` (Origin): returns the `executed` result. It refuses in shadow mode (409), on a closed proposal (409) and on a stale one (409, "조건이 바뀜").
  - `GET /api/fleet/plan` adds `mode`, `approvalSince` and, per open proposal, `stale` (the latest cycle no longer produces it).
- The block gets a switch next to the gate. In approval mode, 동의 becomes **승인(실행)**. It opens a small form with what will run and the options above; for LAUNCH, ENTRY and RESTART it also shows the background count against the cap. Recent proposals show the executed steps.

**Built (2026-09-28).** Steps 1 to 6 below. A few details the draft left open:

- **Agree in approval mode.** In approval mode 동의 is replaced by 승인(실행). An `agree` verdict without execution is refused (409). Reject is a `disagree` verdict, as in shadow.
- **Failure and retry.** A failed execution comes back on the next cycle while its condition still holds; the persistence counter keeps running. An unexpected server error during execution closes the proposal as `failed` with no steps, so nothing stays `executing`.
- **RESTART timing.** RESTART waits up to 5 s for the stopped session to leave `claude agents` before it launches again.
- **Turning off.** A switch back to shadow from outside the screen is recorded with `by: "API"`.
- **Where to see it.** The open list also shows `executing` proposals. `approvalSince` comes from the last `mode:` line in the FLIGHT RECORDER (30-day retention).
- **Test on 7702 (temp state, seeded gate).**
  - The switch into approval was refused without Origin (403). It turned on from the screen, and the approval form showed the RETIRE checkbox.
  - Approving RETIRE TEAM_C wrote `approve` and `executed`, retired TEAM_C in the temp FLEET, and wrote a FLIGHT RECORDER `retire` line with `by: "FLEET PLAN F-0022"`.
  - A second approval, and `agree` in approval mode, got 409. The refactored LAUNCH and STOP still refuse a desktop session.

Not built yet: step 4 (automatic STOP); CROSSCHECK marks on FLEET PLAN proposals.

**Implementation order.**

1. ✅ Mode file, switch API with Origin and gate checks, `mode:` lines, and the switch in the block.
2. ✅ Pure `executionOf(proposal, latestCandidates, context)`: the steps and refusals (stale, mode, 8.5 refusals, REGISTRATION taken). Tests for every kind and for partial failure.
3. ✅ Split the 8.5 handlers into `launchAircraft(reg, options, by)` and `stopAircraft(reg, by)`, used by both the buttons and approval. Add the approve endpoint with the per-id lock and the records.
4. ✅ Approval form in the block, with executed steps in recent proposals.
5. ✅ `RETURN` for expired FLEET PLAN AOGs.
6. ✅ DOCS guide and CHANGELOG.

**Risks.**

| Risk | Mitigation |
|---|---|
| Approving an old proposal on changed facts | re-check against the latest cycle (at most 10 min) and every 8.5 refusal |
| Double execution (two clicks, two tabs) | per-id lock, and a single `open` → `executing` transition |
| Usage | background cap (8.5), one approval per LAUNCH; no LAUNCH or ENTRY proposed into an ACCOUNT at the FUEL hold level (8.6, ATC-63) |
| Half-done ENTRY or RESTART | steps recorded one by one, no cooldown, card buttons to finish by hand |
| Another session approving | Origin check on approve and on the switch into approval; no `atcctl` command |
| Approval mode on too early | switch refuses until the gate is ready |

**Decisions (2026-09-28, SUPERVISOR): all as proposed.**

1. **Turn-on condition:** the shadow gate as it is (20 verdicts, 80%).
2. **Switch location:** its own file `fleet-plan.json`, so DISPATCH and FLEET PLAN switch independently.
3. **LAUNCH default permission mode on approval:** `auto`, the same as the LAUNCH button.
4. **RETIRE stops the background session:** yes by default, with a checkbox to keep it.
5. **Failed execution:** no 24 h cooldown; the proposal comes back after the persistence window.

### 8.8 AIRCRAFT health

Status: steps 1–6 built (ATC-45, ATC-47, ATC-48, ATC-51, ATC-55): the manual, the pull classifier, the push hook, FLEET PLAN proposals from health, `LIMIT` held by ACCOUNT, and FUEL REMAINING per ACCOUNT. States from events are built too (ATC-86): a limit-cut `LIMIT`, `RESUME` after the reset, and `STALLED` FLIGHTs, with the FLIGHT kept on the FLEET row. DISPATCH still proposes to them (ATC-90).

**Why.** On 2026-09-28 TEAM_H got an ATC-44 BRIEF at 07:37:13Z and hit its account's session limit three seconds later. Until someone typed "Try again" at 07:40:57Z, atc showed TEAM_H as `idle`, so FLEET, DISPATCH and TOWER all saw an AIRCRAFT free for work. atc knew only `dead`, `busy` and `idle`; it never read why a session stopped or what it was waiting for.

**Current facts.**

- A transcript line for a failed turn is an `assistant` entry with `isApiErrorMessage: true`, an `error` code (`rate_limit`, `server_error`, `model_not_found`, `invalid_request`, `unknown` …) and one text line. A usage-limit line also has `quotaLimits` with `resetsAt` (epoch seconds) and `rateLimitType` (`five_hour` …).
- A `user` line that opens a turn has `turnOrigin`. A message from another session (a BRIEF) is also `isMeta: true` with `origin.kind: "peer"`.
- Auto-mode denials and hook blocks are `tool_result` entries with `is_error` whose text starts with "Permission for this action was denied …" or "PreToolUse:<Tool> hook error".
- In 162 transcripts from 2026-09-24 to 09-28: 58 `server_error` (SSL), 58 session limits, 11 `model_not_found`, 12 provider errors, 3 "Prompt is too long", 3 server throttles; 81 auto-mode denials and 75 hook blocks.

**Principles.**

- Detect and propose, never act on a team session. atc does not resend prompts, approve prompts, switch accounts or restart sessions.
- Cause, not just state: each code carries the error line, when it started, and the one next step from the manual.
- Host-level versus AIRCRAFT-level: `NETWORK` is raised once for the machine. A `LIMIT` is raised once per ACCOUNT when the SUPERVISOR has labelled accounts (ATC-51), and otherwise once per reset time (the same account window).
- Store only the code, the time and the error line, never message bodies. atc reads only the last 64 KB of each live transcript, again only when its size or time changes.
- Push and pull agree: the server uses a push record only when it is newer than the transcript's last fact, and the hook maps `StopFailure.error` through the same `classifyError`.
- When unsure, `UNKNOWN` with the raw error line, not a wrong code.

**Codes and the response manual** (`server/health.ts`, pure `healthOf`).

| Code | Detected by | Level | DISPATCH/SCHEDULE | Who responds, and how |
|---|---|---|---|---|
| `LIMIT` | `rate_limit` with a usage-limit line; `resetsAt` from `quotaLimits`, else "resets 7:40am (UTC)" | ALERT, once per ACCOUNT (once per reset time without labels) | skip until `resetsAt`, and the other AIRCRAFT on the same ACCOUNT too | Wait. After the reset the code turns into `UNANSWERED` if the prompt is still unanswered; whoever sent the prompt (OCC, the user) or the SUPERVISOR resends it |
| `LIMIT` (cut) | idle, a `usageLimitNote: "wrap_up"` line after the last prompt and after the last `release`, and no API error after it (ATC-86): the turn ended normally with no error line. Tag `HOLD · LIMIT (cut 18:10Z)`; `resetsAt` from the ACCOUNT's FUEL history when known | ALERT, once per ACCOUNT | as `LIMIT` | Wait. After the reset with no new prompt it turns into `RESUME` |
| `RESUME` | a cut `LIMIT` whose reset has passed and no new activity since (ATC-86). Tag `RESUME 필요` | ALERT | — (shown only) | SUPERVISOR sends "continue" in that session. atc never messages a team |
| `STALLED` | idle for `stalledMin` (60 min), holding an In Progress FLIGHT (STAND claim or `tail:` label) with no open PR, and no other code (ATC-86) | INFO | — (shown only) | SUPERVISOR looks at the session: "continue" if nothing blocks it, RESTART if it can't be revived |
| `THROTTLE` | `rate_limit` "not your usage limit", overloaded, other `server_error` | INFO; ALERT at 3 in 30 min | — | Retry after a few minutes. After 10 min without a reply it turns into `UNANSWERED` |
| `NETWORK` | "Unable to connect", SSL/TLS, connection errors | ALERT, once for the machine | — | SUPERVISOR checks the network, proxy and `ANTHROPIC_BASE_URL`/`NO_PROXY`, then resends |
| `MODEL` | `model_not_found` | ALERT | skip | SUPERVISOR fixes the model or route and relaunches. Never retry as is |
| `CONTEXT` | "Prompt is too long", compaction failed | ALERT | skip | RESTART with a new CREW BRIEFING; the STAND and PR are HANDED OFF |
| `PROVIDER` | `unknown` errors from an OpenAI-compatible route (400 schema, `name` too long, status with no body) | ALERT | skip | Relaunch on the default route, and file a bug for the route |
| `PENDING` | idle, and the last reply's `tool_use` has no `tool_result`; push: a `permission_prompt` or `elicitation_dialog` notification, even while the session file says `busy` | INFO | — | SUPERVISOR approves or denies in that session |
| `UNANSWERED` | idle, the last turn-opening prompt has no reply for 10 min (or a `LIMIT`/`THROTTLE` ended with it unanswered) | ALERT | — | whoever sent the prompt (OCC, the user) or the SUPERVISOR resends. atc never resends |
| `HUNG` | busy, no transcript write for 30 min | INFO; ALERT at 60 min | skip | SUPERVISOR looks at it; RESTART if it stays |
| `DENIED` | 3 or more denials or hook blocks in 10 min | INFO | — | SUPERVISOR allows it with a permission rule, or re-briefs |
| `UNKNOWN` | any other API error | ALERT | — | SUPERVISOR reads the error line and decides |
| `NORDO` | process dead (8.6, unchanged) | — | — | as before (FLEET PLAN AOG / LAUNCH) |

- A code clears on the next reply, or on a new prompt after the error. The push hook also writes a code-less line on `Stop` and `PostToolUse`, which clears a pushed code.
- Thresholds are defaults; the service reads `ATC_HEALTH_UNANSWERED_MIN`, `ATC_HEALTH_HUNG_MIN`, `ATC_HEALTH_HUNG_ALERT_MIN`, `ATC_HEALTH_THROTTLE_ALERT_COUNT`, `ATC_HEALTH_THROTTLE_WINDOW_MIN`, `ATC_HEALTH_DENIED_COUNT` and `ATC_HEALTH_DENIED_WINDOW_MIN`.

**ACCOUNT (ATC-51, [fuel.md](fuel.md) section 6).** A plan limit belongs to an account, not to one AIRCRAFT. The SUPERVISOR labels which account each AIRCRAFT flies on with the optional profile field `account` in `fleet.json` (edited on the FLEET card; lowercase letters, digits and `-`, like `main` or `pro-2`; never an email). atc never reads credentials or account settings to find it.

- AIRCRAFT without a label count as the default account (`default`). If no AIRCRAFT has a label, atc does not know accounts: `LIMIT` is grouped by reset time as before and nothing else is held.
- A `LIMIT` on one AIRCRAFT holds every other live AIRCRAFT on the same ACCOUNT until that reset (the latest one if several AIRCRAFT on the account are limited; until the `LIMIT` clears if the reset is unknown). DISPATCH skips them, STAND-free FLIGHTs included, and SCHEDULE NEW does not accept them as a tail. The reason reads `HOLD · LIMIT (account pro-2) until 07:40Z — 같은 ACCOUNT의 TEAM_K가 사용 한도에 걸림`.
- The held siblings get no health code of their own (they have not stopped), so they raise no alert and no FLEET PLAN proposal. The one `LIMIT` alert for the ACCOUNT names them: `LIMIT (account pro-2) — TEAM_K 사용 한도, reset 07:40Z까지 HOLD · 같은 ACCOUNT도 HOLD: TEAM_L`.
- A `LIMIT` on a session that is not an AIRCRAFT (a control session such as ENGINEERING, or any other) is still grouped by reset time and holds no AIRCRAFT. Control sessions can carry an ACCOUNT label for FUEL (ATC-60, below), but that label does not change the `LIMIT` rule.

**FUEL REMAINING (ATC-55, [fuel.md](fuel.md) section 6).** `LIMIT` says an account ran out; FUEL says how close it is. The `hooks/fuel-statusline.mjs` statusline command (installed by the SUPERVISOR, [hooks/README.md](../hooks/README.md#fuel-statusline)) appends the numbers-only `rate_limits` Claude Code passes to the status line (`five_hour`, `seven_day`, `spend_limit`: share used and reset) to `fuel/<sessionId>.jsonl`.

- The server maps session → AIRCRAFT → ACCOUNT and keeps the newest value per ACCOUNT, so an AIRCRAFT whose own session hasn't reported shows its ACCOUNT's value. Without an ACCOUNT an AIRCRAFT shows only its own sessions' value. Windows past their reset are dropped.
- Control sessions (TOWER, OCC, CROSSCHECK, MCC, ENGINEERING; ATC-60) are members of an ACCOUNT too. The SUPERVISOR labels them in the settings window (AGENTS tab, CONTROL block; `fleet.json` `control`, optional). Unlabelled, they count under `default` when any label exists, else under their own name. Their records feed the ACCOUNT's value, the TOWER INFO and the DISPATCH HOLD of that ACCOUNT's AIRCRAFT; they are never held themselves. The FLEET tab's FUEL block lists each ACCOUNT with its AIRCRAFT and, separately, its control sessions.
- The FLEET FUEL block and the card show `사용 82% · resets 21:00Z` per ACCOUNT: the share **used** of the window that is most used, and that window's reset (ATC-81: always worded as used; "FUEL 82%" read like a gauge of what is left). Grey below 80 %, amber from 80 % (INFO), red from 95 % (HOLD threshold). The tooltip lists every window and which session reported it when. The list row does not repeat it per AIRCRAFT, because every AIRCRAFT of the ACCOUNT would show the same number as if it were its own; the row shows the AIRCRAFT's own fuel, FOB ("FOB as built (ATC-81)" below), and the ACCOUNT only as the `HOLD · FUEL (account pro-2) until 21:00Z` tag at the hold level, without a percentage.
- From 80 % (`dispatch.json` `fuel.infoPct`), TOWER gets an INFO item in `open.fuel` (once per ACCOUNT, window and reset), and FLIGHT FOLLOWING gets a `fuel` issue (`info`) on the FLIGHTs that ACCOUNT's AIRCRAFT hold.
- From 95 % (`fuel.holdPct`), DISPATCH skips every AIRCRAFT on that ACCOUNT until the reset, with `HOLD · FUEL (account pro-2) until 21:00Z`, **only if** the SUPERVISOR has turned on the DISPATCH HOLD switch (settings window, AUTOMATION tab, FUEL block; `fuel.hold`, off by default, decision D3). SCHEDULE NEW is not affected. Nothing is ever switched between accounts.

**Push (`hooks/health.mjs`, ATC-47).** A Claude Code hook reports a stop the moment it happens, so a session waiting on a permission prompt shows `PENDING` right away instead of `HUNG` after 30 minutes. It appends one line per event to `health/<sessionId>.jsonl` in the state folder: `{t, event, code?, error?, line?}` (`StopFailure`, `Notification`, `Stop`, `PostToolUse`; only the code, the time and the first error line, never bodies). The server reads the last line of each file, and a push record newer than the transcript's last fact wins (`mergeHealth`); otherwise the pull result stands. Install for the SUPERVISOR is in [hooks/README.md](hooks/README.md).

**Where it shows.**

- `/api/snapshot`: `sessions[].health` (`code`, `level`, `since`, `resetsAt`, `detail`, `next`, `holds`), and `alerts` of kind `health` for ALERT codes. Raised and cleared alerts become `alert.raised`/`alert.cleared` events and FLIGHT RECORDER lines like other alerts.
- FLEET status list: a tag in the FLYING cell, for example `HOLD · LIMIT until 07:40Z`, `PENDING approval 12m`, `CONTEXT — RESTART`. The tooltip has the error line and the next step. An AIRCRAFT held by its ACCOUNT shows a dashed tag `HOLD · LIMIT (account pro-2) until 07:40Z`, and a labelled ACCOUNT shows as a small chip next to the REGISTRATION. The card has an ACCOUNT line and the same hold line.
- DISPATCH skips an AIRCRAFT whose code holds (`LIMIT`, `MODEL`, `CONTEXT`, `PROVIDER`, `HUNG`), or whose ACCOUNT is held, with the tag as the reason. SCHEDULE NEW does not accept it as a tail. With the FUEL switch on, DISPATCH also skips an ACCOUNT at or above 95 % (above).
- FLIGHT FOLLOWING: a `health` issue on the FLIGHT the AIRCRAFT holds (`warn` for ALERT, `info` otherwise). OCC reports it like the other issues.
- TOWER brief: `open.health` (every AIRCRAFT with a code) and `open.healthAlerts`.

#### CAPTAIN report judge as built (ATC-89)

The judge family of [6.1](#61-typed-judges-jev) also reads how an atc AIRCRAFT's turn ended. At Stop (the session is `idle` and its last activity changed) Jev classifies the CAPTAIN's last message with one Choice: `done` (reported done, with a PR or a result), `decision` (asks the SUPERVISOR to decide), `stopped` (stopped mid-work), `ready` (idle and ready) or `unknown` (can't tell). It never changes a health code, DISPATCH or FLEET PLAN, and it needs no hook: the server sees the turn end from the session file and reads the message from the transcript at judge time.

- **What is read.** Only sessions that are AIRCRAFT (`TEAM_*`) whose working folder belongs to the `ATCC` AIRPORT, and the check comes before any read: any other session (a vocado AIRCRAFT, a control session) never has its transcript opened. Only the last 128 KB of the transcript is read, for the last `assistant` line that ends in text (not a `tool_use`) with no newer prompt after it.
- **What is sent.** The message with paths, URLs, e-mail addresses and token-like strings replaced by `<path>`, `<url>`, `<email>`, `<token>`, and at most the last 1,500 characters (conclusions and questions come last). The message is never stored: the record keeps `sent: {chars}` only.
- **Switch and limit.** The same `judges.jev`: `off` reads and sends nothing. `shadow` judges turns that end while the server runs (a session seen for the first time only sets a baseline); `replay` also judges the last turn of sessions already idle at the first look. The 3-a-minute limit is shared with CLASSIFY and DISPATCH; the three take turns.
- **Record.** `judges.jsonl`: a `judge` line with `target: "report"`, `id` (`R-<session 8>-<message time>`), `session`, `aircraft`, `turnAt`, `judgment` (`class`, `probabilities`, `confidence`) and `sent`. A `mark` line (`target: "report"`, `id`, `verdict: right|wrong`) is the SUPERVISOR's mark.
- **Screen.** A chip with the class on the FLEET row (amber when "needs a decision" is at or above the threshold), the probabilities in its tooltip. The AIRCRAFT card has a `JEV REPORT` line with **맞음 / 틀림** buttons for the SUPERVISOR (this screen's Origin only, like the switch; control sessions can't mark). The FLEET PLAN panel's meta line shows `JEV REPORT 맞음 m/n`. It does not count toward any gate. The chip disappears when the session is busy again.
- **FLIGHT FOLLOWING.** `decision` with a probability at or above the threshold (`judges.json` `reportDecisionMin`, default 0.7) adds one `report` issue (`info`) to the FLIGHT the AIRCRAFT holds, once per turn (the key carries the judged turn), and only while the session is still idle.

Pilot's discretion (ATC-89): the marking buttons live on the card, not in the row's tooltip (a tooltip cannot hold buttons, and the row is itself a button); the issue is `info` (OCC LOG only) until the marks show it is reliable; the turn end is seen from the session state, so the hook (`user` tier) is unchanged.

#### CAPTAIN report judge, rule first and wider input as built (ATC-141)

- **Rule first.** A turn that a usage limit cut (the ATC-86 test: a `usageLimitNote: "wrap_up"` line after the last prompt and after the last `release`) is recorded as `stopped` with `engine: "rule"`, `reason: "limit-cut"` and `sent: {chars: 0}`. Jev is not called and nothing is sent. The record shape is unchanged, so the tooltip, marks and agreement work as before.
- **Input.** When the masked message is longer than 1,500 characters, the first 500 and the last 1,000 are sent, joined by " … " (the head says how the turn opened, the tail how it closed). The cap is unchanged.
- **Criteria.** `decision` is "asks the supervisor to decide, approve or choose something now, and it waits for that answer before it goes on"; notes for later ("confirm after installing", "the supervisor merges") are not decisions. `stopped` also names "cut by a usage limit". "Both → decision" applies only when the ask blocks the work.
- **Check.** `node --env-file=<env> server/judges/report-rerun.ts [--all] [--rule-only] [--only R-…]` re-runs recorded judgments in shadow (reads `judges.jsonl`, writes nothing, sends the masked ATCC message only) and prints the agreement before and after. R-29953b2d-1790672807 comes out `stopped` by rule.

**Implementation order.**

1. ✅ Design and manual: this section, TOWER rows in `controller/CLAUDE.md`, the OCC FOLLOWING row, `docs/guide/`.
2. ✅ Pull: pure `factsOf` and `healthOf`, `healthAlerts` for host-level grouping, tests from real transcript line shapes (the TEAM_H replay among them); snapshot, FLEET row, FLIGHT FOLLOWING, TOWER brief, DISPATCH and SCHEDULE filters.
3. ✅ Push: a `hooks/health.mjs` hook on `StopFailure` and `Notification` (`permission_prompt`, `idle_prompt`, `elicitation_dialog`), cleared on `Stop`/`PostToolUse`, appending to `health/<sessionId>.jsonl` in the state folder. `user` tier.
4. ✅ FLEET PLAN proposals (ATC-48): AOG for `MODEL` and a weekly `LIMIT` (until the reset day), RESTART for `CONTEXT` and `HUNG` at ALERT level. Reasons carry the health line and the next step; the proposal expires when the code clears. Health alerts already reach the FLIGHT RECORDER as `alert.raised`/`alert.cleared`, so there are no separate `health.*` lines.
5. ✅ ACCOUNT (ATC-51): the `account` profile field and FLEET card field, `LIMIT` alerts grouped by ACCOUNT, and the sibling hold in DISPATCH, SCHEDULE NEW and the FLEET row (pure `accountHolds`).
6. ✅ FUEL REMAINING (ATC-55): the statusline command, the per-ACCOUNT value on the FLEET row, TOWER `open.fuel`, the FOLLOWING `fuel` issue and the DISPATCH HOLD switch (pure `fuelRemainingOf`, `fuelHolds`). `user` tier (`hooks/`, settings). ATC-60 adds control sessions as ACCOUNT members (`fuelAccountsOf`, `fleet.json` `control`) and the FLEET FUEL block.

**Risks.**

| Risk | Mitigation |
|---|---|
| Transcript format is not a public API | one pure classifier with tests; unknown errors become `UNKNOWN` with the raw line |
| Reading transcripts shows prompt content | only the code, the time and the error line are kept |
| A false `HUNG` during long tests | INFO first; it holds DISPATCH, which a busy AIRCRAFT never gets anyway |
| A permission prompt while the session file says `busy` is seen as `HUNG` after 30 min if the hook is not installed | the push hook (step 3) reports `PENDING` directly; without it the pull path still catches a stalled tool call once the session reads `idle` |

FUEL on the FLEET PLAN block (8.6, "weekly-usage line") is built (ATC-63).

**Pilot's discretion (ATC-45).**

- `LIMIT` is an ALERT and is grouped by reset time, because sessions on one account share the same window and atc does not know accounts.

**Pilot's discretion (ATC-51).**

- "Labels exist" means at least one AIRCRAFT in `fleet.json` has `account` (since ATC-60, a control session's `control` label counts too). Until then nothing changes, so a fleet that never uses labels keeps the ATC-45 behaviour.
- The default account is named `default`. The FLEET row shows the chip only for an explicit label; the card shows `default` with a 기본값 mark.
- Labels are 1–24 characters of lowercase letters, digits and `-`, stored lowercase. The rule rejects `@`, so an email cannot be saved.
- Several limited AIRCRAFT on one ACCOUNT: the siblings are held until the latest known reset, and the alert shows that reset.
- The alert key for an ACCOUNT is `health|LIMIT|account:<label>`, so a second AIRCRAFT hitting the limit does not raise a new alert.
- `DENIED` counts per session, not per STAND: a session holds one STAND at a time.
- `NETWORK`, `UNANSWERED` and `UNKNOWN` do not hold DISPATCH (not in the spec's list): the next prompt may well go through.
- `THROTTLE` and a passed `LIMIT` turn into `UNANSWERED`, so an unanswered BRIEF does not sit behind a stale code.

### AIRCRAFT health from events as built (ATC-86)

On 2026-09-28 at 18:10Z TEAM_G and TEAM_H stopped on the usage limit and sat unnoticed for seven hours: no error line, no `StopFailure`, plain `idle` rows, and no FLIGHT on the FLEET row. ATC-86 makes an AIRCRAFT's state follow its events (transcript lines, hook records, known reset times), so nobody has to check. Nothing polls a session.

**Step 0, on the G and H transcripts (2026-09-29).**

- **The marker of a limit cut.** When the limit is reached, Claude Code writes a `user` line with `isMeta: true`, `turnCompanion: true` and `usageLimitNote: "wrap_up"` (G 18:10:48Z, H 18:10:15Z); its text says a short grace allowance remains and to wrap up. The turn then ends with a normal `Stop` (G 18:11:06Z, H 18:10:39Z). There is no `isApiErrorMessage` line and no `StopFailure`, so the hook and the pull classifier saw an ordinary idle session. When the human comes back, the next prompt (G 01:33:25Z, H 01:36:56Z on 09-29) is followed by a line with `usageLimitNote: "release"`. Across all transcripts: 9 `wrap_up` and 4 `release` lines, all `user` lines. The note carries no reset time.
- **How atc sees it: the pull classifier.** `factsOf` turns the line into a fact with only its time and kind (`limit-note`, `wrap_up` or `release`); the text is never read or kept. Decided against the `Stop` hook checking the transcript tail: the server already reads the tail whenever it changes, a hook that opens the transcript risks blocking a session, a hook change only covers sessions after the SUPERVISOR merges and re-installs it, and one classifier keeps push and pull from disagreeing. The hook still records the new activity events (below).
- **Why the FLEET row lost its FLIGHT.** The FLIGHT on a row is the STAND its session holds: an active hook claim. A claim's `lastAt` is the file's mtime, and the snapshot drops claims older than `ATC_CLAIM_TTL_MIN` (180 min). G's claim was touched at 18:10:58Z, so from 21:10Z on the row had `flights: []`. Nothing else kept the FLIGHT: the `tail:` label sits on the Linear ticket, which the row never read. The hooks had recorded everything; the snapshot let it go.
- **`quota_auto_resume_*`.** They show up only in CLI sessions: ten `informational` lines in `cli` transcripts ("Usage limit reached · continuing automatically at 7:40am", "Usage limit reset · continuing automatically"), none in the 162 `claude-desktop` transcripts. The notification types exist in Claude Code 2.1.284 (`quota_auto_resume_fired`, `_stale`, `_disabled`), but the hook dropped every Notification except `idle_prompt` and the approval prompts, so `health/` cannot say whether one fired. From ATC-86 it records all three. Desktop sessions here never auto-resume, so `RESUME` is the state that matters for them.

**States** (pure, `server/health.ts`; `hooks/`-independent except where noted).

- **`LIMIT` with `cut: true`.** The session is idle, a `wrap_up` note came after the last prompt and after the last `release`, and no API error came after it. ALERT, a hold like any `LIMIT`: DISPATCH skips it and holds its ACCOUNT's other AIRCRAFT until the reset (until the code clears when the reset is unknown). Tag `HOLD · LIMIT (cut 18:10Z)`, and `until 23:10Z` when the reset is known. **The reset** is not in the note: `cutResetOf` finds it in the ACCOUNT's FUEL records. Per session of the ACCOUNT it takes the last statusline record before the cut (up to 5 min after), and from those the windows used at `holdPct` (95 %) or more whose reset was still ahead at the cut, the latest reset if several. The history is used, not the current FUEL REMAINING value, because that drops a window once its reset has passed. With no CLI session in the ACCOUNT (a desktop session writes no statusline record) the reset stays unknown and the AIRCRAFT stays on `LIMIT (cut)` until it is used again.
- **`RESUME`.** A cut `LIMIT` whose reset has passed, with no new activity. ALERT, `holds: false`: shown only. Tag `RESUME 필요`. The manual's next step: the SUPERVISOR sends "continue" in that session; atc never messages a team.
- **`STALLED`.** A live session, idle for `stalledMin` (default 60, `ATC_HEALTH_STALLED_MIN`), that holds an In Progress FLIGHT (Linear `started`; a STAND claim of the session or a `tail:` label naming it) with no open PR, and has no other code. INFO, shown only. FLIGHTs that never open a PR (SURVEY, CHECK) don't count. Tag `STALLED 1h20m`.
- **Any new activity clears all three.** A prompt in the transcript (a peer message counts, as everywhere), a `release` line, and, before the transcript catches up, the hook's `UserPromptSubmit` or `PostToolUse` record. A `Stop` does not clear a cut: it is the cut turn's own end. `quota_auto_resume_fired` clears `RESUME`. `STALLED` clears when the session's activity time moves.
- Reset and `RESUME` come from event times and recorded reset times, computed on each snapshot; nothing pings a session.

**The FLEET row keeps the FLIGHT.** For an AIRCRAFT in one of these three states, the snapshot puts the FLIGHTs it no longer holds a fresh STAND for into `sessions[].keptFlights`: the `tail:`-labelled In Progress FLIGHTs and the FLIGHTs of its stale claims whose Linear ticket is not Done or Canceled. `GET /api/fleet` lists them in `flights` after the STAND-held ones, marked `kept: true`, and every FLIGHT there carries `detail: {commit: {sha, at} | null, pushed: boolean | null, pr: {number, url, draft} | null}`: the FLIGHT's worktree's last commit, whether `origin/<branch>` equals it (the remote-tracking ref, so a push counts as soon as it is done), and its open PR (`null` for none). `flying` (the STAND held now) is unchanged, so FLEET PLAN and SCHEDULE see what they saw. The row is HOLDING and shows the FLIGHT beside the tag with `59a9fdc 7h ago · pushed · no PR` (amber when not pushed); the card lists `HOLDING ATC-72` and the same line.

**Everywhere else.** FLIGHT FOLLOWING already raises a `health` issue for the AIRCRAFT that holds a FLIGHT; it now carries the new codes (`warn` for a cut `LIMIT` and `RESUME`, `info` for `STALLED`, a new key per code so a change reports again). The TOWER brief's `open.health` lists them with the tag and the next step, and `open.healthAlerts` gets the `LIMIT (cut …)` and `RESUME` alerts. The OCC FOLLOWING manual lists the two new codes. DISPATCH treats a cut `LIMIT` like `LIMIT` (already a hold); `RESUME` and `STALLED` change nothing in DISPATCH, SCHEDULE or FLEET PLAN. Notifications to the SUPERVISOR are a separate issue.

**The hook (`user` tier).** `hooks/health.mjs` records `UserPromptSubmit` (clears) and `Notification` `quota_auto_resume_fired`/`_stale`/`_disabled` (no code, time only). The SUPERVISOR adds `UserPromptSubmit` and the three notification types to the matchers in `~/.claude/settings.json` ([hooks/README.md](../hooks/README.md)); until then the transcript alone drives every state and only the early clearing and `fired` are missing. Records keep codes and times only; `last_assistant_message`, prompts and transcript text are never stored.

**Pilot's discretion (ATC-86).**

- `RESUME` is an ALERT and `STALLED` is INFO: a `RESUME` always needs the SUPERVISOR, while an idle session with an open FLIGHT and no PR is often just waiting for a decision.
- A cut with an unknown reset holds until the session is used again, like any `LIMIT` without a reset. If that turns out too strict for a silent ACCOUNT, the fix is a labelled ACCOUNT with a CLI session, not a guess.
- `tail:`-labelled In Progress FLIGHTs count as held even without a claim; SURVEY and CHECK FLIGHTs are excluded from `STALLED` because they never open a PR.
- `RESUME` and `STALLED` are not holds: an AIRCRAFT with the limit over can take a new assignment, and that assignment is the "continue".

### NEEDS YOU as built (ATC-99)

A background session (session file `kind: "bg"`, with its `jobId`) keeps a richer record than atc's busy/idle: `~/.claude/jobs/<jobId>/state.json`, the source of the `state` column in `claude agents --json`. atc reads it, read-only, and puts `job: {state, detail, needs, suggestedReply, since}` on the `Session`; it is `null` for anything else.

- **Reader.** `server/job-state.ts`: `parseJob` (pure) takes only `state` (`working`, `blocked`, `done`, `stopped`, `failed`; any other value gives `null`), `detail`, `needs` and `suggestedReply` (the last two only while `blocked`), and `updatedAt`. It never reads or returns `intent` (for a team, the whole CREW BRIEFING), `output`, `providerEnv` or `linkScanPath`. `since` is the first line of the run of the current state at the end of `timeline.jsonl` (16 KB tail), or `updatedAt` when there is no timeline. `readJob` caches per job by mtime and size of both files, and never writes, deletes or locks anything. ATC-93's `jobStateOf` (STALE rows) reads the same file's `state`.
- **Screens.** A `NEEDS YOU · <needs>` chip while `blocked`, with `detail` and the way to answer in its tooltip: on the FLEET list row and card (the card also shows `suggestedReply` as a copy-only line; atc never sends it), on the STRIPS strip (a blocked session is shown there even when PARKED), and on the CONTROL block row of a control session. A `working` job shows its `detail` as a dim line on the FLEET list and card.
- **Alert.** A job `blocked` for `health.blockedMin` minutes (default 3, `ATC_HEALTH_BLOCKED_MIN`) raises a `health` alert `BLOCKED — <name>이 N분째 사람을 기다림: <needs>` with key `health|BLOCKED|<session>`. It is its own alert, not a `HealthCode`: `Health` does not hold DISPATCH and has no manual entry for it. It clears when the state leaves `blocked`, so `alert.raised` / `alert.cleared` follow.
- **A `blocked` that is already over (ATC-133).** The job file can stay `blocked` after the SUPERVISOR answered. `settleJob` (pure, `server/job-state.ts`) treats `blocked` as over and shows the job as `working` when `tempo` is `active`, or when the session's last activity (the transcript mtime atc already reads as `lastActiveAt`; no new scan) is later than `since` plus a 30-second grace (the last turn is written as `blocked` begins). It drops `detail` (it may be the reply itself, or old text), `needs` and `suggestedReply`, and keeps the file's own view in `settled` for the `working` chip's tooltip ("job file says blocked since 07:04, working since 07:05"). `blockedAlerts` applies the same rule, so no alert fires; the alert text is `needs` or nothing, never `detail`. A real block (no later turn, tempo `blocked` or `idle`) still shows and alerts.
- **A `blocked` that came back (ATC-138).** `since` is the first line of the run of `blocked` in `timeline.jsonl`, so a job that answers, works and blocks again without a `working` line in between keeps the old `since`, and ATC-133's rule took its later turns for an answer. `settleJob` now compares the last turn with the time `state.json` was last written (`writtenAt`: its `updatedAt`, else its mtime, else `since`), which is when the current `needs` and `detail` were put down. `blocked` is over only when `tempo` is `active`, or when the last turn is later than `writtenAt` plus the 30-second grace and `tempo` is not `blocked`. `tempo: blocked` with a `needs` is never settled, whatever turns follow. The alert's "N분째" still counts from `since` (PILOT'S DISCRETION: `updatedAt` also moves for reasons other than a new wait, so using it could hide a long real wait).
- **Checked against** Claude Code 2.1.284 (2026-09-29). The file is a Claude Code internal: a missing file, other version or unknown state shows nothing and raises no error.

### ACTIVITY as built (ATC-97)

Each live Claude AIRCRAFT carries one ACTIVITY line: the last tool it called, a short label, whether that tool is still running, the session is waiting on the model, or it is idle, and how long ago that started. It never holds message bodies.

- **Reader.** `server/activity.ts` (pure). `activityTrackOf(tail)` reads main-chain `assistant` `tool_use` blocks and `user` lines (skipping sidechain, meta and unparseable lines, so a tail cut mid-line is fine). A `tool_use` stays pending until its `tool_result`; a new prompt (or interrupt) ends the previous turn's tools. `activityFromTrack(track, status)` adds the phase: `idle` when the session is idle, `tool` when a call has no result yet (the latest pending one is shown, so parallel calls work), otherwise `model`. `at` is the tool call for `tool`, the last result or prompt for `model`, and the last entry for `idle`.
- **Label.** `Bash`, `Agent` and `Task`: `description`. `Read`, `Edit`, `Write`: the file's basename. `mcp__<server>__<tool>`: `<server> <tool>`. `Skill`: the skill name. `SendMessage`: the recipient. Anything else has no label. Control and bidi characters are removed and the label is cut to 60 characters. The Bash `command`, file contents, prompts, tool results, thinking and assistant text are never read into the result; `server/activity.test.ts` checks this.
- **No second read.** `healthOfSession` computes the track from the same 64 KB tail and keeps it in the same cache entry (size and mtime key), and now returns `{ health, activity }`. The snapshot puts `activity` on `Session` for live Claude sessions only; `fleet-live.ts` carries it to `AircraftView` and the FLEET list rows, so FLEET and STRIPS update at snapshot speed. The FLIGHT RECORDER's `sample` and `event` lines don't include it.
- **Screens.** A dim line `Bash · Run the test suite · 12s` (`idle · …` dimmed, `model · …` or `thinking · …` while waiting on the model, a colored dot for the phase). The phase word comes first and the elapsed time always stays visible; a narrow column cuts the label. It sits under the callsign on the STRIPS strip, as a second line in the FLEET list's FLYING column, and under FLYING on the FLEET card.

## 9. Moving from `lane:` to `tail:`

All four steps are done:

1. ✅ The planner reads `tail:` and keeps reading `lane:` as an alias until 2026-10-10. An exclusion reason for a `lane:` FLIGHT adds `(옛 lane: 라벨 — tail:로 바꿀 것)`. From 2026-10-10 (KST, `LANE_CUTOFF`) the planner stops reading `lane:`: a FLIGHT with only a `lane:` label is proposed to no team and excluded with `옛 lane:TEAM_X 라벨은 2026-10-10부터 읽지 않음 — tail:TEAM_X로 바꿀 것`, and a FLIGHT that also has `tail:` follows the `tail:`.
2. ✅ Linear labels `tail:TEAM_A` … `tail:TEAM_F` were created and VOC-196 got `tail:TEAM_E` (approved by the SUPERVISOR on 2026-09-26).
3. ✅ President was told: assignments go on Linear as `tail:TEAM_X`; the OCC handover follows occ.md section 8.
4. ✅ Renamed in `occ/CLAUDE.md`, README and CHANGELOG.

## 10. Implementation order

1. ✅ `tail:` in the planner with the `lane:` alias. Then the Linear labels, VOC-196 and the note to President
2. ✅ `fleet.json` registry, API and FLEET tab (read and edit), with defaults from the vocado crew rules. Observed crew next to the declared complement and CREW CHANGE (the text, and OCC sending it in approval mode) are in sections 8.3 and 8.4
3. ✅ Classification labels read by the planner: TYPE RATING and FLIGHT TYPE hard rules, WAKE slots, ROUTE score (the Risk group counts as SEC; label groups are read as `group:name`), STAND-free FLIGHTs for HOLDING and PARKED teams and CHECK independence (sections 5.1, 5.2)
4. ◐ The DISPATCH card shows the classification. Still to do: FIDS, and DISPATCH notes that suggest a classification when labels are missing
5. ✅ OCC S1 `CLASSIFY` drafts (with the SCHEDULE work in occ.md; `server/schedule.ts`, section 6)
6. ◐ TARGETS actuals from the LOGBOOK on the FLEET cards (sections 7.1, 7.2), and next to the project goals in NETWORK (section 7.3). Still to do: on-time baselines from category medians, OCC target-change drafts in S2 (section 7.4; S1 built)
7. ✅ Team building in the FLEET tab (section 8.1): ENTRY INTO SERVICE, CONFIGURATION, CREW BRIEFING, AOG, RETIREMENT
8. ✅ CHECKRIDE (section 8.2): TYPE RATING evidence from the LOGBOOK, GRANT and REVIEW recommendations, grant and revoke by the SUPERVISOR
9. ✅ Session control (section 8.5): LAUNCH and STOP from the FLEET tab. Left: automatic STOP (FLEET PLAN step 4; shadow and approval built, 8.6 and 8.7), RESTART outside FLEET PLAN, relaunch CREW CHANGE, usage budget
10. ✅ AIRCRAFT health (section 8.8, ATC-45·47·48·51·55·86): the manual, the pull classifier in the snapshot and the push hook, FLEET row, FLIGHT FOLLOWING, TOWER brief, DISPATCH/SCHEDULE filters, FLEET PLAN proposals from health, `LIMIT` grouped and held by ACCOUNT, FUEL REMAINING per ACCOUNT, and the event states limit-cut `LIMIT`, `RESUME` and `STALLED`

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Labels drift from reality (a "M" that is really "H") | Shadow `CLASSIFY` first; on-time data shows categories that run long; the CAPTAIN can report a reclassification |
| Too many hard rules leave nothing assignable | Every exclusion shows its rule; the SUPERVISOR can drop `tail:` or add a rating |
| Declared crew differs from the real crew | The FLEET tab shows declared vs observed side by side |
| Label clutter in Linear | Four axes only, created once: `tail:` and `rating:` as flat labels, `type` and `wake` as label groups. vocado's existing Risk group is also read as `SEC`, so it needs no new label |
| `SEC` given away too easily | `rating:SEC` changes and `SEC` ratings on AIRCRAFT always need the SUPERVISOR |
| Sessions atc starts spend usage and act with permissions | Only a SUPERVISOR click starts one; a cap on live background sessions; no `bypassPermissions`; a clean environment without atc's secrets; every LAUNCH and STOP in the FLIGHT RECORDER (8.5) |

## Decisions (2026-09-26, SUPERVISOR)

| Item | Decision |
|---|---|
| Team concept | Develop it further in atc terms: crew makeup and goals included |
| Pre-assignment | Proceed with the President note, the Linear labels and VOC-196, under the name settled here |
| Difficulty classification | Needed; included here as FLIGHT TYPE, WAKE CATEGORY and required TYPE RATING |
| Team naming | Keep `TEAM_X` as the **REGISTRATION**: it is the session name the user gives, and vocado rules, President, `tail:` labels and `teamPattern` all depend on it. In atc's own words a team is an **AIRCRAFT** flown by a **CREW** under a **CAPTAIN**, spoken by its callsign (ECHO). The word "team" is kept only for the registration and when talking to people |
| Team building | In the FLEET tab: ENTRY INTO SERVICE, CONFIGURATION templates, CREW BRIEFING, AOG, RETIREMENT. atc does not start sessions (changed 2026-09-28, below) |
| Session control (2026-09-28) | atc starts and stops AIRCRAFT sessions itself (`claude --bg`, `claude stop`), on a SUPERVISOR click in the FLEET tab. Automatic proposals come later and are judged in shadow first (8.5) |
| Linear labels | `type` (BUILD … FERRY) and `wake` (L … J) created as single-select label groups in the Vocado team; `tail:TEAM_A` … `tail:TEAM_F` stay flat labels for now (President already uses them) |
| First FLEET profiles | From flight history: TEAM_B, TEAM_D, TEAM_E hold `SEC` (security and DB FLIGHTs) with route Beta Readiness; TEAM_F route Song Experience; TEAM_C routes Vocado Visual System (SEED) and Home & Discovery; TEAM_A on defaults |

Still open: the exact TYPE RATING list (starts as `SEC`, `UI`, `DATA`, `DOCS`), the WAKE slot weights, and whether Linear estimates should mirror WAKE.
