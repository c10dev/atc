# FLEET design (draft)

**English** · [한국어](fleet.ko.md)

atc knows each team session as an AIRCRAFT (`TEAM_B`, callsign BRAVO) and its leader as the CAPTAIN. It knows nothing else about the team: who is on board, what kind of work it can fly, which projects it usually flies, or what it is aiming for. It knows just as little about a FLIGHT: whether it is a big build, a quick fix, research or a review. This document adds both sides, in airline operations terms:

- **FLEET**: the teams, their crews, what they are rated for, their routes and targets.
- **FLIGHT classification**: the kind of work, its size and the rating it needs.

> Status: design draft (2026-09-26, updated 2026-09-27). Built so far: TAIL ASSIGNMENT (`tail:TEAM_X`, with `lane:TEAM_X` read as an alias until 2026-10-10), the FLEET registry and tab (step 2), observed crew and CREW CHANGE steps 1 and 2 (sections 8.3 and 8.4; step 2, OCC sending it, only in DISPATCH approval mode), step 3: the planner reads the classification labels and applies the TYPE RATING, crew, WAKE and ROUTE rules, then STAND-free FLIGHTs for HOLDING and PARKED teams and CHECK independence (see section 5 for what is left), STAND-free departure and arrival (section 5.1.1), OCC S1 `CLASSIFY` drafts (section 6), team building (section 8.1), the LOGBOOK with TARGETS actuals on the FLEET cards (sections 7.1 and 7.2), NETWORK (section 7.3), the DEPARTURE LOG (section 7.5), CHECKRIDE recommendations for TYPE RATINGS (section 8.2), and session control: LAUNCH and STOP (section 8.5). Decisions are listed at the end.

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
| Shown as | A 0-point factor `STAND 없이` with the AIRCRAFT's state: `HOLDING — VOC-10 진행 중 — SURVEY는 STAND가 필요 없어 STAND 규칙 밖(AIRCRAFT당 1건)` |
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

Not built yet: WAKE-scaled conflict risk (a same-area approach is sketched in [issue #41](https://github.com/chaehy5665/atc/issues/41)), automatic ARRIVED detection for STAND-free FLIGHTs (section 5.1.1), and LOGBOOK entries for them (a STAND-free ARRIVED does not count toward TARGETS). ATFM's auto-eligibility (A8) still requires an assignable AIRCRAFT, so a STAND-free proposal to a HOLDING team is never auto-eligible (A3 excludes SURVEY and CHECK anyway).

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

**The switch** `judges.jev` in `~/.local/state/atc/judges.json`: `off` (default), `replay` or `shadow`. Only the SUPERVISOR changes it: in Settings → AGENTS → JUDGES, or `PUT /api/settings {judgesJev}` from this screen's Origin, like AUTOLAND. atcctl has no command for it, so control sessions can't change it. A missing or unknown value reads as `off`.

| Mode | What it judges |
|---|---|
| `off` | Nothing is read or sent |
| `replay` | CLASSIFY drafts the SUPERVISOR has already judged and that have no mark from this family, oldest first. The body read today is used, which may differ from when the draft was written |
| `shadow` | Open CLASSIFY drafts without a mark |

The server runs at most 3 drafts a minute. It backs off an hour after an error and stops the pass on 401 or 429. Settings shows the last run and error.

**Egress rule.** Turning the switch to `replay` or `shadow` is the SUPERVISOR's data-egress decision. What leaves is an allowlist: the title and three body sections (goal, allowed scope, done criteria), each clipped to 600 characters. The FLIGHT key, labels, comments, assignee, project and every other section stay home. A FLIGHT with a `rating:SEC` or `Risk:*` label, one whose labels atc doesn't know, or a draft that adds `rating:SEC` sends **the title only**, and its body isn't even read. Each mark records what was sent (`sent`) and why a body was withheld (`withheld`).

**Records.** `~/.local/state/atc/judges.jsonl`, append-only: one `judge` line per draft and family (the classification, probabilities, verdict, engine, model, run), and a `mode` line per switch change. `schedule.jsonl` and the single CROSSCHECK slot are untouched.

**Measuring without anchoring.** A mark is shown only on drafts the SUPERVISOR has judged: a chip in RECENT, like `JEV agree`, with the classification and what was sent in its tooltip. Marks on open drafts are counted but hidden. The gate panel's `JEV 일치 m/n` line is `crosscheckRateOf` per family over human verdicts, `replay` marks included (the judge's input never contains the verdict). ATFM auto-verdicts are left out. Marks never change a draft's status and never count toward the 20 / 80% gate.

Not built yet: DISPATCH judges, other families, and using a judge's agreement for S3.

## 7. TARGETS

Per AIRCRAFT, set by the SUPERVISOR in the FLEET tab. They are shown, not scored: atc never ranks AIRCRAFT by them and the planner does not read them.

| Target | Measured from |
|---|---|
| FLIGHTs per week | LOGBOOK entries that ARRIVED this week (Monday 00:00 local time to now) |
| On-time rate | LOGBOOK entries of the last 14 days: the team's block time (start to PR opened) within the expectation of section 7.2. The wait for review and merge is shown apart as the landing wait |
| Reverted work | LOGBOOK entries of the last 14 days marked `reverted` (a `Revert "…"` PR was merged). Reopened FLIGHTs are not counted yet |
| Conflicts | LOS on the FLIGHT's STANDs while it was flown, summed over LOGBOOK entries of the last 14 days |

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
| `aircraft` | The REGISTRATION of the team session that flew it (below), upper case. `null` when atc cannot tell; the line is still written |
| `flight` | Ticket key from the PR branch (`voc-<n>`) or the title's trailing `(VOC-n)`. `null` for AD HOC work |
| `class` | `classOf(labels)` of that FLIGHT's Linear labels at arrival (FLIGHT TYPE, WAKE, ratings, and whether type and wake came from labels). `null` for AD HOC or when Linear does not know the ticket |
| `airport` | AIRPORT code of the repository |
| `pr` | `{repo, number, url, title}` |
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
| Recent | The last 5 entries: team block time (or `—`), `+` landing wait, ON TIME / DELAYED |

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
| Start the session | **CREW BRIEFING** | A copyable kickoff text: session name and folder, the CREW to create with their models, TYPE RATINGS (with the SEC rules), ROUTE, and the radio rules (`tail:` labels, `READBACK C-xxxx`; `READBACK D-xxxx` only in approval mode). The user opens a session in that repository, names it, and pastes it |
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

**Which sessions.** A session belongs to an AIRCRAFT when its name equals the REGISTRATION: a live Claude session in the snapshot (the way atc links AIRCRAFT today), or any session folder whose `custom-title.json` says so and that was active in the window. When there is none, `observedCrew` and `crewDrift` are `null` (the card shows nothing observed, not "unused").

**Mapping to POSITIONs** (`positionOf`, against the declared complement):

| Observed | POSITION |
|---|---|
| An `agentType` equal to a member's `position` or `agent` (`ui-builder`, `ui-qa`, `flash-helper`, or anything the SUPERVISOR declared by agent type) | That member's POSITION |
| `general-purpose` or `claude` with a `model` | The member whose `agent` contains the model family (`opus` → `claude-opus-5-5` → `backend`). No such member: none |
| `general-purpose` or `claude` without a `model` | Treated as Opus: the call inherits the CAPTAIN's model, and CAPTAINs run on Opus. atc cannot see the real model, so `model` stays `null` |
| Built-ins (`Explore`, `Plan`, `claude-code-guide`, `statusline-setup`) and other agent types | None, unless declared by name |

Calls are grouped by `agentType` and `model`: `observedCrew: {agentType, position, model, count, lastAt}[]`, newest first.

**Drift** (`crewDrift`):

- `undeclared`: observed calls with no POSITION, by agent type, with the model when one was given (`Explore`, `general-purpose (sonnet)`). The card shows "선언에 없음: Explore".
- `unused`: declared POSITIONs with no call in the window. A POSITION that is never a subagent (the `reviewer` POSITION of the `security` CONFIGURATION, agent `codex (GitHub 리뷰)`, which works through GitHub reviews) always shows here. Read it as "not seen", not as a fault.

**Cost.** The server rescans `~/.claude/projects` for `custom-title.json` at most every 30 seconds. Titles are cached by file mtime and each session's calls by the mtime of its `subagents/` folder, so an unchanged session is not re-read.

**Gap: agent-team teammates.** Teammates spawned by the CAPTAIN with the Agent tool (named or not, background or not) are recorded under the CAPTAIN's `subagents/` and are observed. Teammates of a Claude Code agent team that run as separate sessions (registered under `~/.claude/teams/<team>/`) are not: atc does not read the team config, and those sessions carry their own names. They show as `unused` if declared. Seeing them would need a metadata source that names the lead session; none is used yet.

### 8.4 CREW CHANGE

When the SUPERVISOR changes the CREW COMPLEMENT of an in-service AIRCRAFT through `PATCH /api/fleet/:registration`, atc writes a CREW CHANGE: a text for the CAPTAIN, like the CREW BRIEFING but for a running team. Built in `server/crew-change.ts`; the only hook in `fleet.ts` is one call after the profile is saved. Step 1 (below, first part) is the text and the SUPERVISOR's manual delivery. Step 2 (the rest) lets OCC send it in DISPATCH approval mode (2b).

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

**2b checklist.** The `crew-change` item ("CREW CHANGE 발부", `selfCheckCrewChange`) checks these transitions, the refusals, the message, the overdue rule, the endpoints and the `atcctl` commands from code facts. The `vocado-readback` item is ready only when vocado `CLAUDE.md` also answers `[OCC CC-xxxx]` with `READBACK CC-xxxx` ([dispatch.md](dispatch.md) "2b readiness checklist").

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
- **Tab.** A card with no session shows **LAUNCH** (permission mode, optional model, background count against the cap). A background session shows `BG <id>` and **STOP**. RETIREMENT of an AIRCRAFT flying a background session then asks whether to stop it too.

Not built yet: automatic STOP of idle sessions (FLEET PLAN step 4; shadow proposals and approval are built in 8.6 and 8.7); RESTART as scheduled maintenance for long sessions; CREW CHANGE by relaunching with the new complement; a usage budget per AIRCRAFT (FUEL, ATC-46).

#### 8.5.1 Control sessions (built 2026-09-28)

The same LAUNCH and STOP work for atc's own control sessions, from the settings window's AGENTS tab (block CONTROL), so the SUPERVISOR doesn't open a tmux window per session.

| Session | Folder | First message | Extra flags |
|---|---|---|---|
| TOWER | `controller/` | `/loop 3m /tick` | |
| OCC | `occ/` | `/loop 10m /tick` | |
| MCC | `mcc/` | `/loop 5m /tick` | `--strict-mcp-config` |

- **Mechanism.** `claude --bg -n <NAME> --permission-mode auto [flags] "<first message>"` in the atc repository's folder, with the same clean environment as 8.5. The folder's `.claude/settings.json` applies: model, allow list and the fail-closed guards. `auto` is fixed because a background session can't answer a permission prompt; the guards do the blocking. Checked on 2026-09-28 with a background MCC: `/loop` scheduled `/tick`, the guard hook ran, and `atcctl manual check` and `mcc queue` ran with no prompt.
- **Already running.** A session counts as that control session if its name matches or it was opened in that folder (a tmux session opened without a name, such as `mcc-b4`, is recognised by its folder). LAUNCH is refused while one is live, so two copies never do the same work. STOP stops a background session with `claude stop`, and a session running in a tmux pane (its pid or an ancestor is the pane's first process, from `tmux list-panes -a` and `/proc/<pid>/stat`) with `tmux kill-pane` on that pane only; other windows of the tmux session stay. The screen asks before closing a tmux pane. The conversation is kept either way (`claude --resume`). Desktop (Claude app) sessions are closed where they run.
- **Not these.** REVIEW and CROSSCHECK run on other model families through `ocx claude`, which `claude --bg` can't do; they stay on tmux.
- **Cap.** Control sessions don't count toward `ATC_MAX_LAUNCHED` for teams.
- **API** (`server/session-control.ts`): `GET /api/control/sessions` (`{manual, sessions: [{name, dir, prompt, live}]}`), `POST /api/control/:name/launch`, `POST /api/control/:name/stop`, both SUPERVISOR-only (this screen's Origin). Pure parts: `controlLaunchPlanOf`, `controlStopTargetOf`, `controlRowsOf`, `isControlRow`.
- **Record.** FLIGHT RECORDER `{kind: "control", op: "launch" | "stop", session, by: "SUPERVISOR", ok, jobId, cwd, error}`.

### 8.6 FLEET PLAN: proposing LAUNCH, STOP and the rest

Status: steps 1 and 2 built (shadow, 2026-09-28); SUPERVISOR decisions recorded below. Section 8.5 gave the SUPERVISOR the controls; this section decides when atc suggests using them, so that forming, parking, servicing and retiring teams stops being manual bookkeeping.

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
- **API.** `GET /api/fleet/plan` returns `{mode, config, ranAt, error, demand, open, waiting, recent, gate}`. `open[].now` holds the reasons as computed now. `waiting` lists candidates still inside the persistence window, without the ones resting after a verdict. `POST /api/fleet/plan/:id/verdict` takes `{verdict: "agree" | "disagree", reason?}`. It needs this screen's Origin (403 otherwise) and returns 409 on a closed proposal.
- **Tab.** The FLEET PLAN block sits above the cards: gate, one demand line per AIRPORT with what blocks a LAUNCH, open proposals with reasons and 반대 / 동의, candidates still waiting, and recent closed ones.
- **First look at live data (2026-09-28 07:15 UTC):** no proposals. ATC-35 would go to TEAM_I, and the other open ATC FLIGHTs have no priority. All team sessions are desktop sessions. There is no NORDO or LOS, and every AIRCRAFT ARRIVED within 30 days.

Not built yet: step 4 (automatic STOP). Step 3 (approval) and the follow-up of an expired AOG (`RETURN`) are built in 8.7; merge-slot fill in the runway rule; the weekly-usage line (FUEL); CROSSCHECK marks on FLEET PLAN proposals.

**Implementation order.**

1. ✅ Pure `fleetPlanOf(snapshot, fleet, dispatchPlan, logbook, sessions, atfm, config, now)` with tests for every kind and for the anti-thrash rule.
2. ✅ Shadow: records, API, FLEET PLAN block, agree / disagree, gate.
3. Approval mode (switch in `dispatch.json` or its own file): approve executes through 8.5 and profile patches.
4. Automatic STOP of idle atc-launched sessions only: switch, daily cap, off after two SUPERVISOR reversals in 7 days.

**Risks.**

| Risk | Mitigation |
|---|---|
| Launch and stop oscillate | two-cycle persistence, `minDwell`, reserve as hysteresis |
| Usage runs out | background cap (8.5), LAUNCH never automatic, weekly-usage line on the block once FUEL exists |
| Wrong demand signal (parent issues, missing labels) | count only FLIGHTs that pass the planner's exclusions; excluded FLIGHTs are shown, not counted |
| More teams, same landing queue | the runway rule (principle 3) |
| A RESTART loses useful context | only PARKED sessions; the old conversation is kept and resumable |

**Decisions (2026-09-28, SUPERVISOR).**

- Defaults as proposed: `reserve` 1, `waitMin` 120, `idleHours` 12, `restartDays` 3, `retireDays` 30, `minDwell` 2 h. Shadow data and the gate decide later changes.
- ATC FLIGHTs count as demand. FLEET PLAN counts the open FLIGHTs of every team in `LINEAR_TEAM_KEYS`, not only `candidateTeams`, with the same exclusions as the planner (parent issues, closed states, `tail:` to another AIRCRAFT). DISPATCH assigns only `candidateTeams`; ATC was added there on 2026-09-28, so ATC FLIGHTs are dispatched too. ATC FLIGHTs carry the workspace classification labels; where one has none, the rating check is skipped and the reason says so.
- Step 4 (automatic STOP) stays in the plan but is built last, with its switch off by default. Turning it on is a separate SUPERVISOR decision after the shadow gate passes.

Sources: [Jeppesen crew pairing](https://ww2.jeppesen.com/airline-crew-optimization-solutions/airline-crew-pairing/), [Lufthansa Systems NetLine/Crew](https://www.lhsystems.com/solutions/operations-control-center/netline-crew), [airline disruption recovery survey (arXiv 2510.26831)](https://arxiv.org/html/2510.26831), [OAG on wet leasing](https://www.oag.com/blog/what-is-wet-leasing), [SKYbrary: MEL](https://skybrary.aero/articles/minimum-equipment-list-mel), [EASA AI levels (Halldale)](https://www.halldale.com/civil-aviation/easa-ai-framework-aviation-safety-regulations), [ICAO on aircraft parking](https://www.icao.int/operational-safety/Aircraft-Parking).

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

Not built yet: step 4 (automatic STOP); the weekly-usage line (FUEL); CROSSCHECK marks on FLEET PLAN proposals.

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
| Usage | background cap (8.5), one approval per LAUNCH; FUEL later |
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

Status: steps 1–2 built (ATC-45): the manual and the pull classifier. Step 4 built (ATC-48): FLEET PLAN proposals from health. The push hook (step 3) is not built yet.

**Why.** On 2026-09-28 TEAM_H got an ATC-44 BRIEF at 07:37:13Z and hit its account's session limit three seconds later. Until someone typed "Try again" at 07:40:57Z, atc showed TEAM_H as `idle`, so FLEET, DISPATCH and TOWER all saw an AIRCRAFT free for work. atc knew only `dead`, `busy` and `idle`; it never read why a session stopped or what it was waiting for.

**Current facts.**

- A transcript line for a failed turn is an `assistant` entry with `isApiErrorMessage: true`, an `error` code (`rate_limit`, `server_error`, `model_not_found`, `invalid_request`, `unknown` …) and one text line. A usage-limit line also has `quotaLimits` with `resetsAt` (epoch seconds) and `rateLimitType` (`five_hour` …).
- A `user` line that opens a turn has `turnOrigin`. A message from another session (a BRIEF) is also `isMeta: true` with `origin.kind: "peer"`.
- Auto-mode denials and hook blocks are `tool_result` entries with `is_error` whose text starts with "Permission for this action was denied …" or "PreToolUse:<Tool> hook error".
- In 162 transcripts from 2026-09-24 to 09-28: 58 `server_error` (SSL), 58 session limits, 11 `model_not_found`, 12 provider errors, 3 "Prompt is too long", 3 server throttles; 81 auto-mode denials and 75 hook blocks.

**Principles.**

- Detect and propose, never act on a team session. atc does not resend prompts, approve prompts, switch accounts or restart sessions.
- Cause, not just state: each code carries the error line, when it started, and the one next step from the manual.
- Host-level versus AIRCRAFT-level: `NETWORK`, and a `LIMIT` shared by sessions with the same reset time (the same account window), are raised once.
- Store only the code, the time and the error line, never message bodies. atc reads only the last 64 KB of each live transcript, again only when its size or time changes.
- When unsure, `UNKNOWN` with the raw error line, not a wrong code.

**Codes and the response manual** (`server/health.ts`, pure `healthOf`).

| Code | Detected by | Level | DISPATCH/SCHEDULE | Who responds, and how |
|---|---|---|---|---|
| `LIMIT` | `rate_limit` with a usage-limit line; `resetsAt` from `quotaLimits`, else "resets 7:40am (UTC)" | ALERT, once per reset time | skip until `resetsAt` | Wait. After the reset the code turns into `UNANSWERED` if the prompt is still unanswered; structure or the SUPERVISOR resends it |
| `THROTTLE` | `rate_limit` "not your usage limit", overloaded, other `server_error` | INFO; ALERT at 3 in 30 min | — | Retry after a few minutes. After 10 min without a reply it turns into `UNANSWERED` |
| `NETWORK` | "Unable to connect", SSL/TLS, connection errors | ALERT, once for the machine | — | SUPERVISOR checks the network, proxy and `ANTHROPIC_BASE_URL`/`NO_PROXY`, then resends |
| `MODEL` | `model_not_found` | ALERT | skip | SUPERVISOR fixes the model or route and relaunches. Never retry as is |
| `CONTEXT` | "Prompt is too long", compaction failed | ALERT | skip | RESTART with a new CREW BRIEFING; the STAND and PR are HANDED OFF |
| `PROVIDER` | `unknown` errors from an OpenAI-compatible route (400 schema, `name` too long, status with no body) | ALERT | skip | Relaunch on the default route, and file a bug for the route |
| `PENDING` | idle, and the last reply's `tool_use` has no `tool_result` | INFO | — | SUPERVISOR approves or denies in that session |
| `UNANSWERED` | idle, the last turn-opening prompt has no reply for 10 min (or a `LIMIT`/`THROTTLE` ended with it unanswered) | ALERT | — | structure or the SUPERVISOR resends. atc never resends |
| `HUNG` | busy, no transcript write for 30 min | INFO; ALERT at 60 min | skip | SUPERVISOR looks at it; RESTART if it stays |
| `DENIED` | 3 or more denials or hook blocks in 10 min | INFO | — | SUPERVISOR allows it with a permission rule, or re-briefs |
| `UNKNOWN` | any other API error | ALERT | — | SUPERVISOR reads the error line and decides |
| `NORDO` | process dead (8.6, unchanged) | — | — | as before (FLEET PLAN AOG / LAUNCH) |

- A code clears on the next reply, or on a new prompt after the error.
- Thresholds are defaults; the service reads `ATC_HEALTH_UNANSWERED_MIN`, `ATC_HEALTH_HUNG_MIN`, `ATC_HEALTH_HUNG_ALERT_MIN`, `ATC_HEALTH_THROTTLE_ALERT_COUNT`, `ATC_HEALTH_THROTTLE_WINDOW_MIN`, `ATC_HEALTH_DENIED_COUNT` and `ATC_HEALTH_DENIED_WINDOW_MIN`.

**Where it shows.**

- `/api/snapshot`: `sessions[].health` (`code`, `level`, `since`, `resetsAt`, `detail`, `next`, `holds`), and `alerts` of kind `health` for ALERT codes. Raised and cleared alerts become `alert.raised`/`alert.cleared` events and FLIGHT RECORDER lines like other alerts.
- FLEET status list: a tag in the FLYING cell, for example `HOLD · LIMIT until 07:40Z`, `PENDING approval 12m`, `CONTEXT — RESTART`. The tooltip has the error line and the next step.
- DISPATCH skips an AIRCRAFT whose code holds (`LIMIT`, `MODEL`, `CONTEXT`, `PROVIDER`, `HUNG`), with the tag as the reason. SCHEDULE NEW does not accept it as a tail.
- FLIGHT FOLLOWING: a `health` issue on the FLIGHT the AIRCRAFT holds (`warn` for ALERT, `info` otherwise). OCC reports it like the other issues.
- TOWER brief: `open.health` (every AIRCRAFT with a code) and `open.healthAlerts`.

**Implementation order.**

1. ✅ Design and manual: this section, TOWER rows in `controller/CLAUDE.md`, the OCC FOLLOWING row, `docs/guide/`.
2. ✅ Pull: pure `factsOf` and `healthOf`, `healthAlerts` for host-level grouping, tests from real transcript line shapes (the TEAM_H replay among them); snapshot, FLEET row, FLIGHT FOLLOWING, TOWER brief, DISPATCH and SCHEDULE filters.
3. Push: a `hooks/health.mjs` hook on `StopFailure` and `Notification` (`permission_prompt`, `idle_prompt`, `elicitation_dialog`), cleared on `Stop`/`PostToolUse`, appending to `health/<sessionId>.jsonl` in the state folder. `user` tier.
4. ✅ FLEET PLAN proposals (ATC-48): AOG for `MODEL` and a weekly `LIMIT` (until the reset day), RESTART for `CONTEXT` and `HUNG` at ALERT level. Reasons carry the health line and the next step; the proposal expires when the code clears. Health alerts already reach the FLIGHT RECORDER as `alert.raised`/`alert.cleared`, so there are no separate `health.*` lines.

**Risks.**

| Risk | Mitigation |
|---|---|
| Transcript format is not a public API | one pure classifier with tests; unknown errors become `UNKNOWN` with the raw line |
| Reading transcripts shows prompt content | only the code, the time and the error line are kept |
| A false `HUNG` during long tests | INFO first; it holds DISPATCH, which a busy AIRCRAFT never gets anyway |
| A permission prompt while the session file says `busy` is seen as `HUNG` after 30 min | the push hook (step 3) reports `PENDING` directly |

Not built yet: the push hook (step 3); grouping `LIMIT` by account rather than by reset time (needs an account per AIRCRAFT, ATC-46).

**Pilot's discretion (ATC-45).**

- `LIMIT` is an ALERT and is grouped by reset time, because sessions on one account share the same window and atc does not know accounts.
- `DENIED` counts per session, not per STAND: a session holds one STAND at a time.
- `NETWORK`, `UNANSWERED` and `UNKNOWN` do not hold DISPATCH (not in the spec's list): the next prompt may well go through.
- `THROTTLE` and a passed `LIMIT` turn into `UNANSWERED`, so an unanswered BRIEF does not sit behind a stale code.

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
10. ◐ AIRCRAFT health (section 8.8, ATC-45): the manual and the pull classifier in the snapshot, FLEET row, FLIGHT FOLLOWING, TOWER brief and DISPATCH/SCHEDULE filters. Left: the push hook, FLEET PLAN proposals from health

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
