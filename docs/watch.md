# WATCH: supervised autonomy while the SUPERVISOR is away

Status (2026-09-30): design draft for [ATC-223](https://linear.app/vocado/issue/ATC-223). The SUPERVISOR chose the name, the v1 actions and the "supervised autonomy" model (section 7). Nothing is built.

**WATCH** is the session that holds control when the SUPERVISOR hands it over, for a set time and a set scope. The SUPERVISOR's model is Tesla's FSD (Supervised):

- The system drives inside a declared operating domain.
- The human takes over at any moment with one action.
- Every takeover or correction is counted, and the counts decide how much the system is trusted next time.

In aviation terms, the handover is the positive transfer of control ("YOU HAVE CONTROL" / "I HAVE CONTROL"). The scope is an operations specification (OPS SPEC), and the report at the end is a handback briefing.

WATCH replaces the ad-hoc overnight ENGINEERING loop of 2026-09-29 (section 1). It is not DUTY. DUTY talks and never decides ([duty.md](duty.md) principle 2). WATCH decides, but only inside an OPS SPEC that the SUPERVISOR granted on atc's screen, and only through server routes that check it again.

Related: [duty.md](duty.md) (L0–L4, G2 MERGE, G3 state button, D0 NEEDS YOU routes), [mcc.md](mcc.md) (server does the write, session judges, shadow first), [squelch.md](squelch.md), [alerting.md](alerting.md), [control-recycle.md](control-recycle.md), [fleet.md](fleet.md) ("NEEDS YOU as built"), `server/session-control.ts`, `controller/guard.mjs`.

## 1. Current facts

### 1.1 The overnight run (ENGINEERING-NIGHT)

The run lasted from 2026-09-29 17:25Z to 2026-09-30 00:30Z. The facts come from bg job `ab64d4c7` (`~/.claude/jobs/ab64d4c7/state.json`, only the state fields were read), from its log `/tmp/atc-overnight-log.md`, and from the two files it was started with. No team session was contacted.

| Part | How it was done | What went wrong |
|---|---|---|
| Start | `claude --bg -n ENGINEERING-NIGHT --permission-mode auto --settings ~/projects/worktrees/night-settings.json --model sonnet` at the repository root. First message: `/loop 55m` plus "read `~/projects/worktrees/night-prompt.txt` and run this patrol" | atc did not know the session existed. It was not a control session, so it took an `ATC_MAX_LAUNCHED` slot and showed up nowhere (found later, [ATC-184](https://linear.app/vocado/issue/ATC-184)) |
| Authority | `permissions.deny` for atc merges, `systemctl` and the guard files, plus `autoMode.allow` sentences such as "approving … ATCA proposals … including LAUNCH cards sent with the header `Origin: http://localhost:7700`" and "merging pull requests in chaehy5665/atc-app … is authorized" | The auto-mode classifier judges prose, so results varied. When the SUPERVISOR widened the scope at 17:32Z, `CronCreate` with the new prompt was **denied**. The old cron had already been deleted, so no loop was scheduled until the SUPERVISOR stepped in |
| LAUNCH cards | The settings allowed an `Origin` header on approvals; the prompt said "never fake an Origin header" | Sending that header gets around `fromThisApp`, the only thing that makes a LAUNCH approval SUPERVISOR-only (`server/proposals.ts`, ATC-129). The two files contradicted each other |
| Delegation and expiry | A Claude memory file (`overnight-delegation-2026-09-30.md`) holding "valid until 00:30Z". The model read the clock each tick and deleted the memory at the end | atc enforced nothing. Before 00:30Z nothing on the server side stopped an action, and after it the only stop was the model's reading of the clock |
| Patrol | Each tick: curl `/api/fleet`, `/api/dispatch/brief`, `/api/update`; the tail of `mcc.jsonl`; `gh pr list` in two repositories. `*/10` cron | 43 ticks, about 40 of them "unchanged, no action". The GitHub GraphQL limit (5,000/h, shared with the atc server's own polling) ran out **every hour at about :20**, and those ticks skipped the PR lists |
| Something wrong | atc PR #236 had an MCC INSPECTION `pass` at 17:23Z and did not land. `mcc.jsonl` had no line after 17:24Z | WATCH noticed at 18:30Z and wrote "still unlanded" in 36 ticks, but it had no way to wake the SUPERVISOR. The item reached them in the 00:30Z report |
| Log and report | `/tmp/atc-overnight-log.md`; the morning report in chat only | Neither is in atc's state or on a screen |
| Result | One atc-app PR merged (chaehy5665/atc-app#3, ATC-156) after review and `Tools/test-linux.sh` 49/49. No proposal was approved (none came in scope). Five items were left for the SUPERVISOR | The work itself was sound. The gaps were in structure, not in judgment |

### 1.2 What atc already has

- **The server writes, the session asks.** MCC lands atc PRs through `atcctl mcc land` (head-pinned, and the server re-checks tier, CI and mode). AUTOLAND merges delegated PRs at their exact head. G2 (`server/pr-merge.ts` `mergeVerdictOf`) merges `user`-tier PRs from a SUPERVISOR click. G3 (`server/flight-state.ts` `moveVerdict`, `isReady`) moves a Linear issue between Backlog, Todo and Canceled from a SUPERVISOR click. Each write leaves a FLIGHT RECORDER line.
- **One lander per AIRPORT.** MCC lands the MCC AIRPORT (atc) for `auto` and `flagged`, the SUPERVISOR lands `user`, and AUTOLAND `merge` lands the AIRPORTs in `autoland.json` `airports` (default `VCDO`). An AIRPORT such as ATCA (atc-app) has no lander today. The SUPERVISOR or a delegated session merges it by hand.
- **SUPERVISOR-only means `fromThisApp`.** LAUNCH, STOP, settings, AUTOLAND, G2 and G3 check for a localhost `Origin` on a JSON request. `atcctl` sends none, and control-session guards block `curl`. **But DISPATCH approve and reject for a non-LAUNCH proposal do not check the Origin** (`server/proposals.ts`, the `approve`/`reject` branch). atcctl has no approve command, so no control session approves; any process that can reach 7700 can.
- **Guards are per role.** `controller/guard.mjs` has one profile per control session (`--mcc`, `--crosscheck`, `--review`, `--gh-read`). A write command of one role (for example `mcc land`) is refused in every other profile. `occ/send-guard.mjs` swaps a head line for the text the server stored, so OCC can only send what the server recorded.
- **Control sessions** are listed in `CONTROL_SESSIONS` (`server/session-control.ts`): folder, `/loop` command and flags. The SUPERVISOR LAUNCHes and STOPs them from the FLEET tab (`claude --bg … --permission-mode auto`, guards do the blocking). They are left out of the team LAUNCH cap. ENGINEERING is listed by name only (`dir: null`, no LAUNCH). `claude --bg` refuses a folder the ACCOUNT has not trusted ([duty.md](duty.md) "D0 as probed" 9).
- **SQUELCH** (S1 built, shadow) decides QUIET/OPEN per role before a `/tick` reaches the model.
- **NEEDS YOU** (ATC-99) reads `~/.claude/jobs/<id>/state.json`. atc shows `needs` and `suggestedReply` and never sends them. D0 found two answer routes: a pty around `claude attach`, which is fragile, and `can_use_tool` for a `-p` process that atc owns. For a question as opposed to a tool approval, the CAPTAIN is waiting for a message, and a `SendMessage` answers it.
- **ALERTING** carries `cue: call` items to the BELL, the ANNUNCIATOR and voice callouts.
- **atc-app has CI** (`.github/workflows/ci.yml`, jobs `mac` and `linux`, "stable so they can be made required checks"). The night run ran `Tools/test-linux.sh` by hand, but the same check exists on the exact head in CI.

## 2. Principles

1. **Authority lives in atc, not in the session.** The SUPERVISOR grants a WATCH on atc's screen (Origin). The server records it, checks every WATCH action against it, and ends it at its time. The session's settings and prompt cannot widen it. No prose permissions, no memory files, no Origin headers.
2. **The server writes; WATCH asks.** WATCH never runs `gh pr merge`, `gh api` writes, `curl`, or a Linear write of its own. Each action is one `atcctl watch …` command. The server re-checks the OPS SPEC, then the same verdict function the SUPERVISOR's button uses (G2, G3, the proposal rules), then writes, and records `by: WATCH W-n`.
3. **Takeover is instant and always wins.** One click ("I HAVE CONTROL") ends the WATCH. From that moment the server refuses every WATCH action, whatever the session is doing, and STOPs the session. Expiry works the same way. Nothing waits for the model to notice.
4. **Shadow first, per action kind.** Each action kind is `off`, `shadow` (WATCH records what it *would* do) or `on`. A kind moves to `on` only after its shadow record meets a gate (section 5). Interventions move it back.
5. **Interventions are the measure** (FSD's disengagements). Every takeover before time, and every WATCH action the SUPERVISOR marks wrong or reverses, is counted per action kind. The count decides the gate, the automatic step back, and what the SUPERVISOR reads each morning.
6. **Never on its own authority.** WATCH does not merge or approve anything that changes WATCH itself (`watch/`, the guards, the server's WATCH files, `deploy/landing-tier.mjs`). It does not touch an AIRPORT that has another lander (MCC, AUTOLAND `merge`). It does not answer tool-approval prompts. Each of these is a WAKE, not an action.
7. **Wake the SUPERVISOR for what WATCH cannot do.** Anything stuck, failing or outside the OPS SPEC becomes a WAKE alert (`cue: call`) through the existing ALERTING chain, at the level the SUPERVISOR chose for this WATCH.
8. **Cheap when quiet.** The brief has a cursor and comes from the server's snapshot. SQUELCH drops a tick when nothing in scope changed, and WATCH does no GitHub polling of its own.
9. **Language.** Korean to the SUPERVISOR (HANDBACK, WAKE text). English to sessions (NEEDS YOU answers, PR and Linear comments), per ATC-126.

## 3. The model

### 3.1 Terms

| Term | Meaning |
|---|---|
| **WATCH** | The control session (folder `watch/`), and one period of handed-over control, `W-n` |
| **YOU HAVE CONTROL** | The SUPERVISOR's handover on the screen: OPS SPEC, `until`, WAKE level. Starts the session |
| **I HAVE CONTROL** | Two uses. (1) WATCH's readback on its first tick. The WATCH becomes `active` only then. (2) The SUPERVISOR's takeover button, which ends the WATCH at once |
| **OPS SPEC** | What this WATCH may do: per action kind `off` · `shadow` · `on`, the AIRPORTs, and caps. The FSD "operating domain" |
| **WOULD** | A shadow action: recorded, not done |
| **WAKE** | An alert that calls the SUPERVISOR during a WATCH |
| **HANDBACK** | The end-of-WATCH card: what was done, what was only WOULD, interventions, what waits |
| **INTERVENTION** | A takeover before `until`, or a WATCH action (or WOULD) the SUPERVISOR marks ✗ on the HANDBACK card |

### 3.2 The WATCH record

`~/.local/state/atc/watch.jsonl`, append-only. A pure `watchStateOf(records, now)` (`server/watch.ts`) folds it:

| op | Written by | Fields |
|---|---|---|
| `handover` | SUPERVISOR (Origin) | `id` `W-n`, `at`, `until`, `spec`, `wake` (`all` · `critical` · `none`), `account`, `note?` |
| `readback` | WATCH (`atcctl watch readback`) | `id`, `at`, `model` (the guard fills it in from the transcript, like CROSSCHECK) |
| `act` | server, after a WATCH request | `id`, `at`, `kind`, `target`, `mode` (`on` · `shadow`), `result` (`done` · `would` · `refused` · `failed`), `why?`, `reason` (WATCH's one line) |
| `wake` | server (conditions) or WATCH (`atcctl watch wake`) | `id`, `at`, `key`, `level`, `text` |
| `takeover` | SUPERVISOR (Origin) | `id`, `at`, `codes?` (reason chips), `text?` |
| `end` | server | `id`, `at`, `why` (`expired` · `takeover` · `session-lost` · `fuel`) |
| `handback` | WATCH (`atcctl watch handback`) | `id`, `at`, `text` (Korean, capped) |
| `review` | SUPERVISOR (Origin), on the HANDBACK card | `id`, `act` (index), `ok` (true/false), `codes?` |

The states are `handing-over` (from the handover until the readback, at most 10 min, then `end: session-lost`), `active`, and `ended`. Only one WATCH can be open at a time.

### 3.3 OPS SPEC

```jsonc
{
  "airports": ["ATCA"],                  // AIRPORT codes in scope. The MCC AIRPORT may be listed for every kind but merge (decision 3)
  "approve": { "mode": "on", "launch": false, "max": 6 },     // DISPATCH approve/reject; launch = LAUNCH cards allowed; max per WATCH
  "merge":   { "mode": "shadow", "max": 3 },                   // PR merge on AIRPORTs with no other lander
  "needsYou":{ "mode": "shadow", "max": 10 },                  // question-type NEEDS YOU answers
  "linear":  { "mode": "on", "max": 10 }                       // READY Backlog → Todo only
}
```

- The screen offers only the modes a kind has earned. `on` is greyed out until the kind's gate is met (section 5), and the SUPERVISOR can always choose less.
- `max` stops the kind for the rest of the WATCH and raises a WAKE (`critical`).
- The spec is frozen for the WATCH. A change is a takeover and a new handover. The night run changed scope twice, and both times the loop broke; this makes each change a clean new record.

### 3.4 Actions

Every command is `atcctl watch <kind> … -- '<reason>'`. The server checks in this order: a WATCH is `active` → `until` not passed → the kind's mode → the AIRPORT is in the spec → `max` → **no-self-authority** (principle 6) → the kind's own rules below. In `shadow` it stops there and records `would`. In `on` it writes and records `done`, or `refused` or `failed` with the reason.

| Kind | Command | Kind's own rules (server) | Write |
|---|---|---|---|
| **approve** | `watch approve <D-xxxx>` · `watch reject <D-xxxx> --codes …` | The same checks as the SUPERVISOR's button (approval mode, status, HELD, BLIND, reason chips for a reject). A LAUNCH card needs `launch: true`, and then goes through the same `approveLaunch` (cap, live session) | The proposal op with `via: "watch"` and `by: "W-n"` |
| **merge** | `watch merge <AIRPORT> <n> --head <sha>` | The AIRPORT has no other lander (not the MCC AIRPORT, not an AUTOLAND `merge` AIRPORT). Open, not a draft, not a fork, to the default branch. `head` equals the live head. The AIRPORT's required checks are green **on that head** (for ATCA, `mac` and `linux`). No SUPERVISOR HOLD. The PR's FLIGHT is known. No changed file under the AIRPORT's `watch.protect` paths | `PUT …/merge` with `sha` and the AIRPORT's method. Never auto-merge |
| **needsYou** | `watch answer <session> -- '<English text>'` | The session is an AIRCRAFT of a spec AIRPORT with a live FLIGHT. Its job is `blocked`, and `needs` is a question, not a tool approval (a tool approval raises a WAKE). The text is at most 600 characters and must not contain a `[DISPATCH`/`[OCC`/`[ATC` head | The server records the answer and returns `[WATCH W-n] <text>` and the address. WATCH sends it with `SendMessage`, and `watch/send-guard.mjs` passes only a text the server recorded (the OCC pattern) |
| **linear** | `watch move <KEY> --to Todo` | `isReady` (Backlog, all blockers Done or Canceled). The issue belongs to a spec AIRPORT's team or project. It has a priority (the planner drops No-priority issues). Only Backlog → Todo | The G3 write (`linear-write.ts`) with `by: "W-n"` |

Also allowed during any WATCH, as ENGINEERING's own work and not counted as actions: PR review comments (`gh pr review --comment` and `gh pr comment` on spec AIRPORTs, English) and Linear comments. They are listed in the HANDBACK.

### 3.5 The session

- **Folder `watch/`** as a control session:
  - `CLAUDE.md` (Korean original) and `CLAUDE.en.md`;
  - `.claude/settings.json` with the allow and deny lists (below);
  - the guard as a new profile `--watch` in `controller/guard.mjs`, plus `watch/send-guard.mjs` and a read-only MCP guard mode that allows comments only;
  - a `/tick` skill;
  - `settings.test.mjs` to pin the lists.
- **Tools.**
  - Allowed: `atcctl watch …` and the read commands TOWER and OCC use, `jq`, `gh pr view|diff|checks|list`, `gh pr review --comment`, `gh pr comment`, `Agent(reviewer)` (fresh-context PR review, the ATC-135 pattern), and `SendMessage` through the send-guard.
  - Denied: `Edit`, `Write`, `NotebookEdit`, `CronCreate` and `CronDelete` (the `/loop` belongs to atc's LAUNCH, not to the model), `curl`, `gh api`, `gh pr merge`, `systemctl`, `kill`, `claude`.
  - Every guard ends in `… || exit 2`.
- **Lifecycle.**
  - YOU HAVE CONTROL LAUNCHes `WATCH` from its `CONTROL_SESSIONS` entry (`/loop 10m /tick`, ACCOUNT from the handover).
  - The first tick answers `atcctl watch readback`.
  - `end` (takeover, expiry, FUEL hold) makes the server STOP the session after one grace tick for `watch handback`. When the session is gone the HANDBACK card still stands, built from the records.
  - While no WATCH is open the session is not running.
  - Because it is in `CONTROL_SESSIONS`, it is listed on FLEET and kept out of the team LAUNCH cap (ATC-184).
- **Brief.** `atcctl watch brief` (cursor per WATCH) gives:
  - the WATCH (`until`, spec, counts used);
  - in-scope proposals waiting;
  - in-scope PRs with head, checks, HOLD and lander;
  - in-scope NEEDS YOU;
  - READY issues;
  - WAKE conditions already raised;
  - FUEL for the WATCH's ACCOUNT.

  It carries keys and states, not bodies. The model reads a body (`gh pr diff`, the G1 detail routes) only when it acts.
- **SQUELCH.** Role `watch` is OPEN only when the brief's cursor has moved, when `until` is under 15 min away, or on a WAKE. It starts in S1 shadow like the other roles.

### 3.6 WAKE

Raised by the server (conditions) or by WATCH (`atcctl watch wake -- '<Korean>'`), as alerts `watch|<W-n>|<key>` with `cue: call`. The WATCH's `wake` level filters them: `none` records only; `critical` passes the rows marked C; `all` passes every row.

| Condition | Level |
|---|---|
| The WATCH session is gone while `active` (no live row for 2 intervals) | C |
| RTS ROLLBACK or failure, GROUND STOP, MCC mode stopped | C |
| An in-scope PR with MCC `pass` or all checks green has not landed for 60 min while a lander should have taken it (the #236 case) | C |
| An in-scope AIRCRAFT is `blocked` on a **tool approval** for `health.blockedMin` | C |
| A kind reached its `max`; three `refused` in a row for one kind | C |
| FUEL of the WATCH's ACCOUNT over its hold level (the session also stops acting) | C |
| WATCH asked (`watch wake`) | its level, default C |
| A `user`-tier PR became CLEARED; a proposal outside the spec waits over 30 min | — (all only) |

### 3.7 HANDBACK and interventions

- **HANDBACK card** (the WATCH view in the header and the FLEET row) opens at `end`. It holds:
  - time in control;
  - every `act` in order with its result: `done`, `would`, `refused` (with the reason) or `failed`;
  - the comments WATCH left;
  - the WAKEs;
  - what waits for the SUPERVISOR (from the queue, not the model);
  - FUEL used;
  - WATCH's own `handback` text, marked as the model's words.
- **Review.** Each `done` and `would` row has ✓ and ✗. A ✗ asks for a reason chip (`wrong-scope`, `wrong-judgment`, `too-early`, `should-wake`, …). A ✗ and a takeover before `until` are INTERVENTIONs. An unreviewed row counts for nothing.
- **Stats** (pure `watchStatsOf`), per kind over the last 30 days: done, would, ✓, ✗, and interventions per 100 actions. The same numbers go into the handover dialog, next to each kind's mode picker.
- **Step back.** Two ✗ on `on` rows of one kind within 7 days set that kind's highest offered mode back to `shadow` until the gate is met again. The SUPERVISOR can always lower a kind; raising one needs the gate.

## 4. Screens

- **Header.** Next to the other readouts, a `WATCH` readout:
  - off: dim;
  - `WATCH · 00:30Z` while active, with a small count of actions;
  - `HANDBACK` after `end`, until the card is reviewed.

  A click opens the WATCH panel.
- **WATCH panel.**
  - With no WATCH, a **YOU HAVE CONTROL** form:
    - `until` (presets: morning 09:00 local, 2 h, 4 h);
    - AIRPORTs;
    - per kind a mode picker (`off` · `shadow` · `on`, with the gate numbers) and `max`;
    - WAKE level;
    - ACCOUNT;
    - a confirm step that repeats the spec in one sentence.
  - While active: the spec, the time left, the live act list, and a large **I HAVE CONTROL** button (confirm is one click; reason chips are optional, afterwards).
  - After `end`: the HANDBACK card.
- **FLEET.** WATCH is a CONTROL SESSIONS row like MCC. Its STOP is a takeover.
- **ANNUNCIATOR (later, atc-app).** The WATCH readout and I HAVE CONTROL in the menu bar, with the same Origin rules through the forward.

## 5. Implementation order

Each step is one issue. Until W4, every action is WOULD only.

| # | Step | Output | Tier |
|---|---|---|---|
| W1 | **Record and handover.** `watch.jsonl`, pure `watchStateOf` and the OPS SPEC parser, `GET /api/watch`, `POST /api/watch/handover` and `/takeover` (Origin), server expiry. The header readout and the panel (form, active view, I HAVE CONTROL). Close the gap in 1.2: DISPATCH approve/reject require `fromThisApp` or a WATCH `approve` (W4); until W4, Origin only. No session yet | Handover and takeover work on the screen. Nothing acts | user (new authority record, approval route change) |
| W2 | **Session at WOULD.** `watch/` folder, manual, settings, the `--watch` guard profile, `/tick`, `CONTROL_SESSIONS` entry (LAUNCH on handover, STOP on end), `atcctl watch brief|readback|wake|handback` and every action command answering `would` whatever the spec says. PR and Linear comments. SQUELCH role `watch` | A WATCH runs a night in shadow: WOULD rows, comments, HANDBACK text | user (guard, settings) |
| W3 | **WAKE and HANDBACK.** The conditions in 3.6 as alerts, the HANDBACK card with ✓/✗ and chips, `watchStatsOf`, the step-back rule | The SUPERVISOR is woken for #236-type cases and reviews the night in one card | flagged |
| W4 | **approve and linear on.** The server paths in 3.4 for `approve` (LAUNCH only with `launch: true`) and `linear`, the gate check on the handover form | WATCH approves and releases work | user |
| W5 | **merge on.** The merge path with required checks on the exact head, `watch.protect` per AIRPORT, one lander per AIRPORT, `Agent(reviewer)` | WATCH lands atc-app PRs | user |
| W6 | **needsYou on.** `watch answer`, `watch/send-guard.mjs`, question vs tool-approval split from `needs` | WATCH answers CAPTAINs' questions in scope | user |

- W1 has no dependencies. W2 needs W1. W3 needs W2 (it reviews WOULD rows). W4–W6 need W3, because the gate is W3's stats, and each can go separately.
- **Gate (proposed, section 7):** a kind can be set to `on` after 20 reviewed WOULD rows of that kind with at least 90 % ✓. This is DISPATCH's shadow gate shape. The SUPERVISOR can waive it for a kind, as they did for MCC's 5 days.

## 6. Risks

| Risk | Mitigation |
|---|---|
| WATCH does something wrong while nobody watches | Kinds start at WOULD. `max` per kind. Server re-checks with the SUPERVISOR's own verdict functions. Takeover is instant. Interventions step a kind back |
| WATCH widens its own authority | The OPS SPEC lives in the server and is written only from the screen. `CronCreate`, `Edit`, `Write`, `curl`, `gh api` are denied. No-self-authority on merges and approvals (principle 6). Every WATCH file is `user` tier |
| Another session calls the WATCH routes | WATCH actions are `atcctl watch …`, which every other guard profile refuses (the MCC pattern). The routes also need an `active` WATCH. As 1.2 says, the local HTTP API is not authenticated. A team session outside a guard could reach it, as it can reach DISPATCH approve today; W1 narrows that, it does not close it |
| Prompt injection from PR text, issue bodies and team questions | The brief carries keys and states. Bodies are read only to act. Every write is re-checked on facts (head, checks, READY, state), not on WATCH's words. NEEDS YOU answers go only to in-scope AIRCRAFT with a live question, capped and without control heads |
| Session lost at night | The WAKE (`critical`) and `end: session-lost` after 2 intervals. The server-built HANDBACK does not need the session |
| Cost | SQUELCH, brief cursor, no own GitHub polling, `Agent(reviewer)` only for a merge candidate. FUEL hold stops acting |
| A WATCH merges on an AIRPORT that another lander also works | One lander per AIRPORT, checked by the server (not the MCC AIRPORT, not AUTOLAND `merge` AIRPORTs) |
| The name "autopilot" | Not used ([dispatch.md](dispatch.md): it suggests gates are off). WATCH is a person-like role that hands back, which is what happens |

## 7. Decisions

**Made (SUPERVISOR, 2026-09-30):**

- The mode is called **WATCH**.
- The model is supervised autonomy like Tesla FSD: it acts inside a scope, the SUPERVISOR takes over at any time, and interventions measure trust.
- v1 action kinds: DISPATCH approve/reject, PR merge, NEEDS YOU answers, Linear state moves.
- Design doc and work orders first, then build through DISPATCH.

**Proposed here, for the SUPERVISOR to accept or change:**

1. Authority as a server record written from the screen (3.2), not settings prose. The night run's `autoMode.allow` file is retired.
2. **The DISPATCH approve route gets an Origin check** in W1 (1.2). Today any local process can approve a non-LAUNCH proposal.
3. WATCH never merges on the MCC AIRPORT (atc). There, `auto` and `flagged` are MCC's and `user` is the SUPERVISOR's. WATCH's merge is for AIRPORTs with no lander (ATCA today).
4. Tool-approval NEEDS YOU is never answered by WATCH; it is a WAKE. Only questions get answers.
5. The gate: 20 reviewed WOULD rows at 90 % ✓ per kind. Step back: two ✗ on `on` rows in 7 days.
6. Session model and ACCOUNT: `claude-sonnet-5-5` on acct-2, the night run's choice. The merge review runs in `Agent(reviewer)` on Opus in a fresh context, like MCC INSPECTION.
7. One WATCH at a time; the spec is frozen for its length.
8. `until` at most 12 h.

## Not built yet

Everything above: W1–W6.
