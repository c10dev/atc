# FLEET design (draft)

English only for now; a Korean version will follow.

atc knows each team session as an AIRCRAFT (`TEAM_B`, callsign BRAVO) and its leader as the CAPTAIN. It knows nothing else about the team: who is on board, what kind of work it can fly, which projects it usually flies, or what it is aiming for. It knows just as little about a FLIGHT: whether it is a big build, a quick fix, research or a review. This document adds both sides, in airline operations terms:

- **FLEET**: the teams, their crews, what they are rated for, their routes and targets.
- **FLIGHT classification**: the kind of work, its size and the rating it needs.

> Status: design draft (2026-09-26). Built so far: TAIL ASSIGNMENT (`tail:TEAM_X`, with `lane:TEAM_X` read as an alias until 2026-10-10), the FLEET registry and tab (step 2; observed crew is not shown yet), and step 3: the planner reads the classification labels and applies the TYPE RATING, crew, WAKE and ROUTE rules (see section 5 for what is left). Decisions are listed at the end.

Related: [occ.md](occ.md) (OCC writes the classification and tail labels as SCHEDULE operations), [dispatch.md](dispatch.md) (the planner that uses them).

## 1. Current facts

| Item | Today |
|---|---|
| Teams | Six long-lived sessions `TEAM_A` … `TEAM_F` in `vocado_nextjs`, each with a leader and teammates |
| Crew rules | vocado `CLAUDE.md`: teammates default to `claude-opus-5-5`; `ui-builder` (Opus) builds UI; `ui-qa` (Muse Spark 1.3) is read-only visual and accessibility QA; `flash-helper` (DeepSeek V4.1 Flash) does search, summaries, reference collection and exactly specified mechanical edits, and never implementation, review verdicts, security, DB, auth, rights or anything needing images |
| Risky work | DB, migration, security and rights work uses the `Codex Engineering Task` template; DISPATCH marks it CAUTION |
| What atc sees of a team | Session name, status (AIRBORNE / HOLDING / PARKED), claimed worktrees, past FLIGHTs (team fit) |
| Sizing | Linear has 0 estimates. The planner counts slots (1 FLIGHT per TEAM), not effort |
| Pre-assignment | `lane:TEAM_X` label (PR #7): proposed only to that team |

What this caused on 2026-09-26:

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
      { "position": "ui-qa", "agent": "ui-qa" },
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

- **CREW COMPLEMENT** is declared, not detected. atc also shows the crew it actually observes (teammate sessions and subagent calls recorded under the CAPTAIN). The FLEET tab shows both side by side, so drift is visible.
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

- `SURVEY` and `CHECK` need no worktree, so they don't count against the 1-FLIGHT-per-TEAM STAND rule. A HOLDING team can take one.
- `CHECK` is never assigned to the team that flew the BUILD it reviews (independence, like TOWER not judging its own assignments).
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
- **On-time**: the expected block time is the baseline for the stage 4 on-time metric until real history replaces it. After about 20 FLIGHTs per category, the medians from the FLIGHT RECORDER take over.
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

Applied in this order. The first three are hard rules: a FLIGHT that fails them is excluded with the reason, never given to another team.

1. **TAIL ASSIGNMENT**: `tail:TEAM_X` → only that AIRCRAFT (what `lane:` does today).
2. **TYPE RATING**: the AIRCRAFT holds every required rating.
3. **FLIGHT TYPE vs crew**: the complement can fly it. `BUILD`, `MAINT` and `TEST` need a member who is not `flash-helper` and has no `no BUILD` or `read-only` limit; `CHECK` needs one without `no CHECK verdicts`; `SURVEY` and `FERRY` can go to any crew.
4. **WAKE slots**: the AIRPORT has enough weighted capacity left (L 0.5, M 1, H 2). An AIRBORNE team counts the largest WAKE among the FLIGHTs it holds, or 1 when unknown. `J` is excluded ("must be split").
5. **Score** (soft): as today, plus **ROUTE** (+1, weight `route` in `dispatch.json`, when the FLIGHT's project is on the AIRCRAFT's routes).

When no live AIRCRAFT could ever qualify (no one holds the rating, or no crew can fly the type), the FLIGHT is excluded with that reason. When qualified AIRCRAFT exist but are busy, it simply waits, as before.

The DISPATCH card shows the classification under the title, e.g. `BUILD · H · SEC · tail:TEAM_E`. It is greyed with "(기본값)" when there is no `type:` or `wake:` label.

Not built yet: `SURVEY` and `CHECK` going to a HOLDING team (they need no STAND), `CHECK` independence from the BUILD it reviews, and WAKE-scaled conflict risk.

## 6. Who classifies

| Stage | Who writes the labels |
|---|---|
| Now (before OCC S2) | The SUPERVISOR or President by hand. DISPATCH notes the classification it reads from the body |
| OCC S1 | OCC drafts a SCHEDULE `CLASSIFY` operation for each new or unclassified Todo: FLIGHT TYPE, WAKE, ratings, with a one-line reason. The SUPERVISOR marks it in shadow |
| OCC S2 | Approved `CLASSIFY` operations are written through linear-guard |
| OCC S3 | `CLASSIFY` may become automatic for non-`SEC` FLIGHTs if S2 agreement is high. Adding or removing `rating:SEC` always needs approval |

Classification is a bounded choice from fixed options, so it is also the first candidate for a typed-judgment model (the Jev evaluation in the DISPATCH notes), measured against the SUPERVISOR's shadow marks.

## 7. TARGETS

Per AIRCRAFT, set by the SUPERVISOR in the FLEET tab. They are shown, not scored:

| Target | Measured from |
|---|---|
| FLIGHTs per week | ARRIVED FLIGHTs in the FLIGHT RECORDER |
| On-time rate | Actual block time vs the WAKE expectation (then vs the category median) |
| Reverted work | PRs reverted or reopened FLIGHTs |
| Conflicts | LOS involving that AIRCRAFT |

Stage 4 (network planning) puts these next to the project goals. OCC may draft target changes; the SUPERVISOR decides.

## 8. FLEET tab

- One card per AIRCRAFT: registration and callsign, base AIRPORT, status, CREW COMPLEMENT declared vs observed, TYPE RATINGS, ROUTES, TARGETS against actuals.
- Edit form for the SUPERVISOR (writes `fleet.json`, same pattern as the AIRPORT registry).
- A classification column in the DISPATCH tab and on FIDS.

## 9. Moving from `lane:` to `tail:`

1. The planner reads `tail:` and keeps reading `lane:` as an alias for two weeks, marking it "deprecated" in the exclusion reason.
2. Create Linear labels `tail:TEAM_A` … `tail:TEAM_F` and put `tail:TEAM_E` on VOC-196 (approved by the SUPERVISOR on 2026-09-26).
3. Tell President: assignments go on Linear as `tail:TEAM_X` from now on; the OCC handover follows occ.md section 8.
4. Rename in `occ/CLAUDE.md`, README and CHANGELOG.

## 10. Implementation order

1. ✅ `tail:` in the planner with the `lane:` alias. Then the Linear labels, VOC-196 and the note to President
2. ✅ `fleet.json` registry, API and FLEET tab (read and edit), with defaults from the vocado crew rules. Observed crew (teammate sessions next to the declared complement) is left for later
3. ✅ Classification labels read by the planner: TYPE RATING and FLIGHT TYPE hard rules, WAKE slots, ROUTE score (the Risk group counts as SEC; label groups are read as `group:name`)
4. ◐ The DISPATCH card shows the classification. Still to do: FIDS, and DISPATCH notes that suggest a classification when labels are missing
5. OCC S1 `CLASSIFY` drafts (with the SCHEDULE work in occ.md)
6. TARGETS and on-time baselines in METRICS / stage 4

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Labels drift from reality (a "M" that is really "H") | Shadow `CLASSIFY` first; on-time data shows categories that run long; the CAPTAIN can report a reclassification |
| Too many hard rules leave nothing assignable | Every exclusion shows its rule; the SUPERVISOR can drop `tail:` or add a rating |
| Declared crew differs from the real crew | The FLEET tab shows declared vs observed side by side |
| Label clutter in Linear | Four prefixes only (`tail:`, `type:`, `wake:`, `rating:`), created once |
| `SEC` given away too easily | `rating:SEC` changes and `SEC` ratings on AIRCRAFT always need the SUPERVISOR |

## Decisions (2026-09-26, SUPERVISOR)

| Item | Decision |
|---|---|
| Team concept | Develop it further in atc terms: crew makeup and goals included |
| Pre-assignment | Proceed with the President note, the Linear labels and VOC-196, under the name settled here |
| Difficulty classification | Needed; included here as FLIGHT TYPE, WAKE CATEGORY and required TYPE RATING |
| Linear labels | `type` (BUILD … FERRY) and `wake` (L … J) created as single-select label groups in the Vocado team; `tail:TEAM_A` … `tail:TEAM_F` stay flat labels for now (President already uses them) |
| First FLEET profiles | From flight history: TEAM_B, TEAM_D, TEAM_E hold `SEC` (security and DB FLIGHTs) with route Beta Readiness; TEAM_F route Song Experience; TEAM_C routes Vocado Visual System (SEED) and Home & Discovery; TEAM_A on defaults |

Still open: the exact TYPE RATING list (starts as `SEC`, `UI`, `DATA`, `DOCS`), the WAKE slot weights, and whether Linear estimates should mirror WAKE.
