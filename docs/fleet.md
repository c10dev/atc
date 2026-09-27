# FLEET design (draft)

English only for now; a Korean version will follow.

atc knows each team session as an AIRCRAFT (`TEAM_B`, callsign BRAVO) and its leader as the CAPTAIN. It knows nothing else about the team: who is on board, what kind of work it can fly, which projects it usually flies, or what it is aiming for. It knows just as little about a FLIGHT: whether it is a big build, a quick fix, research or a review. This document adds both sides, in airline operations terms:

- **FLEET**: the teams, their crews, what they are rated for, their routes and targets.
- **FLIGHT classification**: the kind of work, its size and the rating it needs.

> Status: design draft (2026-09-26). Built so far: TAIL ASSIGNMENT (`tail:TEAM_X`, with `lane:TEAM_X` read as an alias until 2026-10-10), the FLEET registry and tab (step 2), observed crew and CREW CHANGE step 1 (sections 8.3 and 8.4), step 3: the planner reads the classification labels and applies the TYPE RATING, crew, WAKE and ROUTE rules (see section 5 for what is left), team building (section 8.1), the LOGBOOK with TARGETS actuals on the FLEET cards (sections 7.1 and 7.2), and CHECKRIDE recommendations for TYPE RATINGS (section 8.2). Decisions are listed at the end.

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

Per AIRCRAFT, set by the SUPERVISOR in the FLEET tab. They are shown, not scored: atc never ranks AIRCRAFT by them and the planner does not read them.

| Target | Measured from |
|---|---|
| FLIGHTs per week | LOGBOOK entries that ARRIVED this week (Monday 00:00 local time to now) |
| On-time rate | LOGBOOK entries of the last 14 days: the team's block time (start to PR opened) within the expectation of section 7.2. The wait for review and merge is shown apart as the landing wait |
| Reverted work | LOGBOOK entries of the last 14 days marked `reverted` (a `Revert "…"` PR was merged). Reopened FLIGHTs are not counted yet |
| Conflicts | LOS on the FLIGHT's STANDs while it was flown, summed over LOGBOOK entries of the last 14 days |

Stage 4 (network planning) puts these next to the project goals (section 7.3). OCC may draft target changes (section 7.4, design only); the SUPERVISOR decides.

### 7.1 LOGBOOK

An aircraft logbook records every flight an airframe has flown. atc's LOGBOOK does the same per AIRCRAFT: one line per FLIGHT that ARRIVED, that is, whose PR was merged into the AIRPORT's default branch.

Kept in `~/.local/state/atc/logbook.jsonl`, append-only like the other records. Two operations:

```json
{"op":"arrived","t":"…","key":"owner/repo#31","aircraft":"TEAM_J","flight":"VOC-201","class":{"type":"BUILD","wake":"M","ratings":["UI"],"explicit":{"type":true,"wake":true}},"airport":"ATCC","pr":{"repo":"owner/repo","number":31,"url":"…","title":"…"},"stands":["/home/…/worktrees/atc-logbook"],"departedAt":"…","departedFrom":"claim","arrivedAt":"…","blockMin":190,"landingWaitMin":122,"codexFindings":1,"changesRequested":false,"reverted":false,"los":0}
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

### 7.4 OCC target-change drafts (design only)

Not built. ROUTES and TARGETS stay the SUPERVISOR's (section 3); this is how OCC could propose changes to them the way it proposes Linear changes, without ever applying them.

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

- One card per AIRCRAFT: registration and callsign, base AIRPORT, status, CREW COMPLEMENT declared vs observed, TYPE RATINGS, ROUTES, TARGETS against the LOGBOOK actuals (section 7.2) with the last few FLIGHTs.
- Edit form for the SUPERVISOR (writes `fleet.json`, same pattern as the AIRPORT registry).
- A classification column in the DISPATCH tab and on FIDS.

### 8.1 Team building

The FLEET tab is also where teams are formed and stood down. atc never starts a Claude session itself: starting sessions from a server would bypass the user's control over cost and permissions, so atc stops at a ready-to-paste briefing.

| Action | Term | What it does |
|---|---|---|
| Add a team | **ENTRY INTO SERVICE** | Registration (the next free `TEAM_X` is suggested), base AIRPORT (defaults to where most team sessions live), and a **CONFIGURATION**. The AIRCRAFT shows as NOT IN SERVICE until a session with that name appears, then atc links it by name |
| Team template | **CONFIGURATION** | `general` (the vocado default crew; follows the defaults), `security` (Opus backend + Codex review; SEC, DATA, DOCS), `ui` (Opus backend + `ui-builder` + `ui-qa`; UI, DOCS), `research` (Opus backend + `flash-helper`; DATA, DOCS) |
| Start the session | **CREW BRIEFING** | A copyable kickoff text: session name and folder, the CREW to create with their models, TYPE RATINGS (with the SEC rules), ROUTE, and the radio rules (`tail:` labels, `READBACK C-xxxx`; `READBACK D-xxxx` only in approval mode). The user opens a session in that repository, names it, and pastes it |
| Stand a team down for a while | **AOG** | Reason plus an optional release date. The planner stops proposing to it (`AOG — reason (~date)`) |
| Remove a team | **RETIREMENT** | The AIRCRAFT leaves the FLEET list (kept under RETIRED with its date and reason) and gets no proposals. A live session is not closed. It can be restored |

Later: sending **CREW CHANGE** through OCC after approval, from OCC S2 (step 1, the text without sending, is section 8.4).

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
- `unused`: declared POSITIONs with no call in the window. A POSITION that is never a subagent (the `codex` reviewer of the `security` CONFIGURATION, which works through GitHub reviews) always shows here. Read it as "not seen", not as a fault.

**Cost.** The server rescans `~/.claude/projects` for `custom-title.json` at most every 30 seconds. Titles are cached by file mtime and each session's calls by the mtime of its `subagents/` folder, so an unchanged session is not re-read.

**Gap: agent-team teammates.** Teammates spawned by the CAPTAIN with the Agent tool (named or not, background or not) are recorded under the CAPTAIN's `subagents/` and are observed. Teammates of a Claude Code agent team that run as separate sessions (registered under `~/.claude/teams/<team>/`) are not: atc does not read the team config, and those sessions carry their own names. They show as `unused` if declared. Seeing them would need a metadata source that names the lead session; none is used yet.

### 8.4 CREW CHANGE (step 1: text, never sent)

When the SUPERVISOR changes the CREW COMPLEMENT of an in-service AIRCRAFT through `PATCH /api/fleet/:registration`, atc writes a CREW CHANGE: a text for the CAPTAIN, like the CREW BRIEFING but for a running team. Built in `server/crew-change.ts`; the only hook in `fleet.ts` is one call after the profile is saved.

- **In service** means not retired and a live session with that name exists. An AIRCRAFT that has not entered service gets its crew from the CREW BRIEFING instead. AOG AIRCRAFT count as in service.
- **Diff** (`diffCrew`): members are compared by their one-line form `position: agent (limits)`, the same as the CREW BRIEFING. A member whose agent or limits changed is removed and added; the text pairs a POSITION that leaves and returns once as "바뀌는 CREW".
- **TYPE RATING impact** (`ratingImpact`), from the planner rules of sections 4.3 and 5: losing or gaining `BUILD`/`MAINT`/`TEST` (a member who is not `flash-helper` and has no `no BUILD` or `read-only`), `CHECK` (no `no CHECK verdicts`), the ability to hold `SEC` (`canHoldSec`; `applyPatch` still refuses `SEC` without it), ratings added or removed in the same PATCH, and `UI` kept without both `ui-builder` and `ui-qa`.
- **Text** (`crewChangeText`): header `[ATC FLEET] CREW CHANGE · <CALLSIGN> (<REG>) · CC-0001`, then crew leaving, joining and changing, the full new complement, TYPE RATING with the impact, and how to apply it (stop leaving teammates after their current work, create joining ones with the given agent and model, tell changed ones their new limits), ending with `"<REG> CREW CHANGE CC-0001 COMPLETE"`.
- **Record**: `~/.local/state/atc/crew-changes.jsonl`, append-only. `{"op":"created","id":"CC-0001","registration","at","before":{complement,ratings},"after":{…},"added","removed","ratingImpact","text"}`, then `{"op":"delivered","id","at"}` or `{"op":"superseded","id","at","by"}`. Folded status: `pending` → `delivered` or `superseded`.
- **Superseding**: a new complement change while one is pending closes it (`by` the new id) and writes a new one diffed from the pending one's original `before` to the latest `after`. If that diff is empty (the crew went back), the pending one is closed with `by: null` and nothing new is written. A PATCH that changes only the ratings rewrites a pending CREW CHANGE (so its TYPE RATING lines stay true) but never starts one.
- **Never sent.** There is no send path. The FLEET card shows `pendingCrewChange: {id, at, text, added, removed, ratingImpact}` with a copy button; the SUPERVISOR pastes it to the CAPTAIN and presses 전달함, which calls `POST /api/fleet/:registration/crew-change/:id/delivered` (404 unknown, 409 already closed). `GET /api/fleet/crew-changes?registration=&limit=` returns the recent history. Sending through OCC comes later, behind a switch.

## 9. Moving from `lane:` to `tail:`

1. The planner reads `tail:` and keeps reading `lane:` as an alias for two weeks, marking it "deprecated" in the exclusion reason.
2. Create Linear labels `tail:TEAM_A` … `tail:TEAM_F` and put `tail:TEAM_E` on VOC-196 (approved by the SUPERVISOR on 2026-09-26).
3. Tell President: assignments go on Linear as `tail:TEAM_X` from now on; the OCC handover follows occ.md section 8.
4. Rename in `occ/CLAUDE.md`, README and CHANGELOG.

## 10. Implementation order

1. ✅ `tail:` in the planner with the `lane:` alias. Then the Linear labels, VOC-196 and the note to President
2. ✅ `fleet.json` registry, API and FLEET tab (read and edit), with defaults from the vocado crew rules. Observed crew next to the declared complement and CREW CHANGE step 1 are in sections 8.3 and 8.4
3. ✅ Classification labels read by the planner: TYPE RATING and FLIGHT TYPE hard rules, WAKE slots, ROUTE score (the Risk group counts as SEC; label groups are read as `group:name`)
4. ◐ The DISPATCH card shows the classification. Still to do: FIDS, and DISPATCH notes that suggest a classification when labels are missing
5. OCC S1 `CLASSIFY` drafts (with the SCHEDULE work in occ.md)
6. ◐ TARGETS actuals from the LOGBOOK on the FLEET cards (sections 7.1, 7.2), and next to the project goals in NETWORK (section 7.3). Still to do: on-time baselines from category medians, OCC target-change drafts (section 7.4, designed only)
7. ✅ Team building in the FLEET tab (section 8.1): ENTRY INTO SERVICE, CONFIGURATION, CREW BRIEFING, AOG, RETIREMENT
8. ✅ CHECKRIDE (section 8.2): TYPE RATING evidence from the LOGBOOK, GRANT and REVIEW recommendations, grant and revoke by the SUPERVISOR

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
| Team naming | Keep `TEAM_X` as the **REGISTRATION**: it is the session name the user gives, and vocado rules, President, `tail:` labels and `teamPattern` all depend on it. In atc's own words a team is an **AIRCRAFT** flown by a **CREW** under a **CAPTAIN**, spoken by its callsign (ECHO). The word "team" is kept only for the registration and when talking to people |
| Team building | In the FLEET tab: ENTRY INTO SERVICE, CONFIGURATION templates, CREW BRIEFING, AOG, RETIREMENT. atc does not start sessions |
| Linear labels | `type` (BUILD … FERRY) and `wake` (L … J) created as single-select label groups in the Vocado team; `tail:TEAM_A` … `tail:TEAM_F` stay flat labels for now (President already uses them) |
| First FLEET profiles | From flight history: TEAM_B, TEAM_D, TEAM_E hold `SEC` (security and DB FLIGHTs) with route Beta Readiness; TEAM_F route Song Experience; TEAM_C routes Vocado Visual System (SEED) and Home & Discovery; TEAM_A on defaults |

Still open: the exact TYPE RATING list (starts as `SEC`, `UI`, `DATA`, `DOCS`), the WAKE slot weights, and whether Linear estimates should mirror WAKE.
