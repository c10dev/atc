# MCC design (atc's own landing and RETURN TO SERVICE)

MCC (Maintenance Control) is a control session that lands atc's own PRs and puts the merged code back into service on the machine. An airline's maintenance control centre decides when an aircraft that has been worked on may fly again. MCC does the same for atc: it inspects an atc PR, lands it when the rules allow, and returns the service on port 7700 to operation with the new code. Today a temporary `structure` session does this work, opened in a conversation and gone after it.

> Status (2026-09-28): the SUPERVISOR answered the open questions and chose MCC over the parallel SELF-LANDING draft (#105, #107); see "Decisions". Steps 2–5 are built: the server side in shadow, `atcctl mcc`, the `mcc/` session with guard mode `--mcc`, and the `atc-rts` unit (section 11). The shadow gate is measured on the settings window (ATC-49). What is left is operation: install the unit, launch the session, run shadow until the gate is met.
>
> 2026-09-29: the SUPERVISOR waived the 5-day part of the shadow gate. `land` goes on now; `land+rts` follows ATC-101 (SHOW tier) and ATC-102 (RTS session checks). See "Landing baseline" (5.1) and "Decisions".

Related: root `CLAUDE.md` "git과 PR" (LANDING CLEARANCE tiers), `deploy/landing-tier.mjs`, `deploy/atc.service`, [occ.md](occ.md) section 9 (CLEARED TO LAND, REVIEW, AUTOLAND), [atfm.md](atfm.md) (shadow before action), `review/` (the DeepSeek REVIEW session).

## 1. Current facts

Read on 2026-09-28 from GitHub (read-only REST), the running atc (`/api/snapshot`, `/api/version`) and the main checkout. Nothing was written to the operating state.

| Area | Today | What it means |
|---|---|---|
| Who lands atc PRs | The rules say `structure` reviews and merges `auto` and `flagged` PRs, then deploys. `structure` is a temporary session. When none is open, PRs wait: on 2026-09-28 PR #106 had CI passing and a clean merge state and still did not land until the user asked | Landing depends on a session that may not exist |
| Volume | 96 atc PRs merged in the last 7 days | About 14 a day, bursty: 6 merged between 07:38 and 08:01 UTC |
| Review | 0 of the last 29 merged atc PRs had a GitHub review. The "review" was `structure` running tests, types, build and conflicts, which CI `check` already runs | atc's CLEARED TO LAND shows every atc PR as `APPROACH` with `no-review`, and TOWER relays that as `LANDING 불가` to team sessions (C-0059). The check has no way to clear |
| External review | REVIEW (DeepSeek) excludes a PR without a FLIGHT in every mode. Many atc PRs have no ATC issue. AUTOLAND covers only `VCDO` (`autoland.json` `airports`), "atc's own landing is out of scope" (occ.md 9) | No existing path reviews or lands atc PRs |
| Landing wait | Last 29 merged: median 1.9 min from opened to merged, p90 35, max 101 | Fast when `structure` is around. MCC must not make the common case much slower |
| Deploy | "The side that merged deploys": fast-forward `/home/c10/projects/atc` and `systemctl --user restart atc`. `ExecStartPre` rebuilds the web screen. No health check and no rollback | At 08:10 UTC the running service was 1 merged PR (#104) behind `origin/main`. A broken build leaves 7700 down until a person notices |
| What the service reports | `/api/version` gives the built asset name and `startedAt`, not the git commit | Nothing can tell which commit is in service |
| Merge style | atc uses merge commits ("Merge pull request #N …"); vocado uses squash through AUTOLAND | MCC merges the way atc already does |
| Public repository | atc is public. PRs, issues and branches must not carry vocado internals or screenshots (#104) | MCC's review checks this too |

## 2. Principles

1. **Mechanics in the server, judgment in the session.** As with TOWER and OCC, the server decides what is allowed and does every write (merge, RETURN TO SERVICE). The MCC session reads, judges, and asks the server through `atcctl`. It never gets a raw `gh pr merge`, `git` or `systemctl`.
2. **The tiers don't move.** MCC lands only `auto` and `flagged` PRs, exactly what `structure` may land today. `user` PRs stay with the user. MCC can raise a PR to `user` (a doubt, a change to the operating-state format, something hard to revert); it can never lower one.
3. **Head-pinned.** A review, a landing and a RETURN TO SERVICE each name a commit. If the head or `origin/main` moved, the step is refused and redone on the next pass.
4. **Shadow before action** ([atfm.md](atfm.md) principle 1). MCC starts by recording what it would do next to what `structure` and the user actually do. The SUPERVISOR switches it on after the shadow record meets the gate.
5. **Service first.** A RETURN TO SERVICE that fails its health check rolls back to the previous commit by itself and turns RETURN TO SERVICE off until the SUPERVISOR turns it back on.
6. **Fail closed, same as the other control sessions.** MCC's guard ends in `… || exit 2`. Weakening it is the user's decision.

## 3. Terms

| Concept | Term | Meaning |
|---|---|---|
| The session | **MCC** | Maintenance Control: lands atc PRs and returns atc to service |
| MCC's look at a PR | **INSPECTION** | The review MCC records on a head: `pass` or `findings` |
| Putting merged code into the running service | **RETURN TO SERVICE** (RTS) | Fast-forward the main checkout, restart 7700, health check |
| Undoing a failed RTS | **ROLLBACK** | Reset the main checkout to the commit that was in service and restart |
| Raising a PR to the user | **ESCALATE** | MCC marks a PR `user` tier with a reason |

Landing itself keeps the existing words: CLEARED TO LAND, LANDING, ARRIVED.

## 4. What MCC does in one pass (`/tick`)

1. `atcctl manual check`: reread the manual if it changed.
2. `atcctl mcc queue`: open atc PRs with head, tier and its reasons, CI `check` on the head, merge state, INSPECTION on the head, holds; plus the commit in service against `origin/main`.
3. For each PR without an INSPECTION on its head (oldest first, at most 3 a pass): call the `inspector` sub-agent with the PR number and head (section 8.2). It reads the packet (`atcctl mcc packet <PR>`: PR body, changed files, diff, tier reasons, the ATC issue's goal and exit criteria when the branch or body names one) in a fresh context and returns the verdict. MCC copies it into `atcctl mcc inspect <PR> --head <sha> --verdict pass|findings -- '<text>'`, or `atcctl mcc escalate <PR> -- '<reason>'`. MCC reads no packet or diff itself.
4. For each PR the server reports as landable: `atcctl mcc land <PR> --head <sha>`.
5. If `origin/main` is ahead of the commit in service and its CI passed: `atcctl mcc rts`.
6. Report to the SUPERVISOR in its own session: each LANDED PR with its tier (for `flagged`, the control rules that changed), each RTS with the commit, each ROLLBACK and ESCALATE with the reason.

MCC does not fix code, comment on PRs, message team sessions, or touch Linear.

### 4.1 INSPECTION checklist

CI already runs tests, types and the build. The INSPECTION is what CI can't see, taken from root `CLAUDE.md`:

- Pure logic is split from I/O and has `node:test` tests; the tests cover the new behaviour, not only the old.
- `erasableSyntaxOnly` (no enum, parameter properties, namespace); colours and fonts only from `web/src/styles.css` tokens.
- Aviation terms in English; comments short and Korean like the surrounding code.
- Changed behaviour is in a pair of CHANGELOG fragments (`changelog.d/*.md` and `*.ko.md`), not in `CHANGELOG.md` / `CHANGELOG.ko.md` directly (ATC-64); paired docs changed in both languages; `docs/guide/` updated when how the user works changed.
- Team PRs leave design-doc status markers (✅ rows, `Status:` lines, "Not built yet" moves) to ENGINEERING.
- Nothing from vocado's internals, no secrets, no screenshots (public repository).
- Records stay append-only JSONL and settings stay atomically written JSON. A change to an operating-state format → ESCALATE.
- The change does what the PR body and the ATC issue say, and nothing else.

`findings` blocks the landing until a new head passes. The server also posts them as a PR comment (`**MCC INSPECTION — findings** …`), in every mode including shadow, so the author sees them on the PR as well as on the atc screen. A comment is information; it merges and deploys nothing. MCC doesn't message team sessions.

If the packet's diff was cut (`diffTruncated`), MCC writes what it read and does not pass.

## 5. What the server checks before a landing

`POST /api/mcc/land {pr, head}` merges only when all of these hold. Each failed condition is returned by name, and `mcc queue` shows the same list.

| # | Condition |
|---|---|
| L1 | MCC mode is `land` or `land+rts` (in `shadow` and `rts` the server records `would-land` instead) |
| L2 | The PR is open, not a Draft, based on `main`, its head is `head`, and it comes from a branch of this repository, not a fork (atc is public) |
| L3 | Tier from the changed files (`deploy/landing-tier.mjs` `tierOf`) is `auto` or `flagged`, and MCC has not ESCALATEd it |
| L4 | CI `check` on `head` succeeded |
| L5 | GitHub merge state is clean (no conflict, not behind a required check) |
| L6 | An INSPECTION `pass` on `head` |
| L7 | No SUPERVISOR hold on the PR, no GROUND STOP on ATCC |
| L8 | No RTS running and no ROLLBACK waiting for the SUPERVISOR |

The merge goes through REST (`PUT /repos/…/pulls/N/merge` with `sha: head`, merge commit), so GitHub refuses it if the head moved, and GraphQL rate limits (hit on 2026-09-28) don't block it.

For ATCC PRs, CLEARED TO LAND counts an INSPECTION `pass` on the head as the review, so `no-review` clears the same way a Codex 👍 or a DeepSeek pass does for vocado. `findings` shows as `review-findings`.

### 5.1 Landing baseline (SHIP / SHOW / ASK)

The goal is a bar that is not strict but keeps accidents out. The evidence of 2026-09-27/29 is below.

**Code review was not where accidents came from.**
* 150 atc PRs were merged, with no revert and no fix-up PR.
* MCC inspected 22 PRs in shadow: 24 `pass`, and 3 correct ESCALATEs (state-format changes).
* REVIEW found one problem in atc, a truncated diff.

**What did go wrong was out of a reviewer's sight:**
* A deploy killed every background session: the Claude daemon was in `atc.service`'s cgroup.
* CROSSCHECK marks were recorded under the wrong model.
* The ATC-63 EO had a spec error.
* `/clear` lost an approved proposal (ATC-91).

So the bar is set by blast radius and reversibility, and the safety net sits after the deploy. The doors follow the Ship / Show / Ask model (Rouan Wilsenach, martinfowler.com, 2021):

| Door | Tier | What | How it lands |
|---|---|---|---|
| SHIP | `auto` | Docs, tests, screens, read-only server code | CI `check` + INSPECTION `pass` → MCC lands (L1–L8); RTS deploys in `land+rts` and `rts` |
| SHOW | `flagged` | Control manuals and CLI, and server code with outside side effects: merges, PR comments, Linear/GitHub writes, starting/stopping sessions or units, sending messages (ATC-101) | As SHIP; MCC's report names the changed rules and side-effect files |
| ASK | `user` | Guards, hooks, `.claude/`, root `CLAUDE.md`, CI, dependencies, `deploy/`, operating-state formats, anything hard to reverse | The SUPERVISOR merges |

**SHOW as built (ATC-101):** `tierOf` stays pure and path-based. `deploy/landing-tier.mjs` keeps two exported lists beside it, each entry a path and a one-line reason:
* `SIDE_EFFECT` (`flagged`, reason `외부 부작용`): `server/autoland-run.ts` (merges, branch updates, comments), `server/mcc-run.ts` (merges, INSPECTION comments, starts `atc-rts`), `server/human-check-run.ts` (edits PR bodies, comments), `server/session-control.ts` (starts and stops `claude --bg` sessions, closes tmux panes).
* `READ_ONLY` (`auto`): the other server files that run commands or call an outside API but only read (`server/index.ts`, `airports.ts`, `rules-state.ts`, `sources/git.ts`, `sources/github.ts`, `standfree-run.ts`, `sources/linear*.ts`, `judges/engines.ts`).
* The USER and control-session rules are unchanged, and a path in both a USER rule and `SIDE_EFFECT` stays `user`.
* `deploy/landing-tier.test.mjs` scans `server/**/*.ts` (not tests). A file that imports `node:child_process` or calls `fetch` with `POST`/`PUT`/`PATCH`/`DELETE` must be in one of the two lists, or the test fails and says where to list it. A new command-running file therefore can't land as `auto` unclassified. The scan is a floor: code that reaches outside some other way (a socket, for instance) still needs a person to list it.
* Callers count too (ATC-114): `SIDE_EFFECT_HELPERS` names the exports that cause a side effect (`startRtsUnit`, `runAutoland`, `recordHumanCheck`, `launchAircraft`, `stopAircraft`, `launchControl`, `stopControl`), and the test fails for any server file that imports one without being in `SIDE_EFFECT` or `READ_ONLY`, so `update-run.ts` (when the UPDATE bar starts `atc-rts`), `fleet-plan-run.ts` and `index.ts` (the AUTOLAND cycle) are `flagged` even though they run no command themselves.
* For a landed `flagged` PR, MCC's report names the changed control rules and the changed side-effect files, one line each (`mcc/CLAUDE.md`).

**After the deploy:** RTS is healthy only when three things hold (ATC-102). Otherwise it runs ROLLBACK and stops RTS.
* atc answers on the target head.
* The background sessions that were live before the restart are still live.
* The Claude daemon is outside the service.

**Later, not a precondition:**
* MCC does not pass a PR whose diff it could not read in full (`diffTruncated`, already in 4.1).
* A change-failure measure: ROLLBACK + revert + fix-up PR within 24 h, per landing, with a target under 5 % (DORA's change failure rate).
* An automatic GROUND STOP of a door after a failure it caused.

## 6. RETURN TO SERVICE

The service can't restart itself from inside its own process, so RTS runs as a separate systemd user unit, `atc-rts.service` (oneshot), started by the server with `systemctl --user start --no-block atc-rts`. Its script, `deploy/rts.mjs`:

1. Takes a lock file in the state directory; one RTS at a time.
2. Refuses unless the main checkout is on `main` and clean, and `HEAD` is an ancestor of `origin/main` (fast-forward only).
3. Target = `origin/main` after `git fetch`. Refuses unless CI `check` on the target succeeded.
4. Refuses, and reports that the user must do it, when the range changes `package.json`, `package-lock.json` (needs `npm ci`) or `deploy/atc.service` (needs `daemon-reload`).
5. `git merge --ff-only <target>`, `systemctl --user restart atc`.
6. Health check for up to 90 s: `/api/version` reports the target commit (a new `head` field) and a later `startedAt`, and `/api/snapshot` answers 200. Then the session checks (ATC-102, below).
7. On failure: ROLLBACK. `git reset --hard <previous>` (the tree was clean and the move was a fast-forward, so nothing else is lost), restart, health check again, and set RTS off until the SUPERVISOR turns it back on.
8. Appends one line to `rts.jsonl` for every attempt: from, to, result, duration, and the reason for any refusal or ROLLBACK.

A restart takes the screen and API away for a few seconds. MCC runs RTS after a landing, and at most once every 5 minutes, so a burst of merges goes out as one RTS.

The user can still deploy by hand. RTS only needs the checkout to be clean and behind `origin/main`.

### Session checks as built (ATC-102)

A RETURN TO SERVICE is healthy only if atc is up **and** it did not take the fleet down with it (2026-09-28: a deploy killed OCC `a578bf15` because the Claude daemon sat in `atc.service`'s cgroup). RTS only reads here: it never stops, restarts or messages a session.

* **Before the restart** RTS snapshots the live background sessions from `claude agents --json` (`snapshotOf`: `id`, `name`, `kind`, `pid`). Interactive rows and ghost rows (no `pid` and no `status`, ATC-93) are left out. If `claude` can't be read, the session comparison is skipped and the record says so; the other two checks still run.
* **After the version check** (`sessionsHealth`, retried every 3 s for up to 30 s more) `checkSessions` needs all three:
  1. every snapshotted session is still listed live (same `id`; a new `pid` is fine while the job runs);
  2. `daemonInService` from `GET /api/control/sessions` is `false`;
  3. that endpoint answers.
* **On failure** the existing ROLLBACK runs, and RTS stays stopped until the SUPERVISOR picks the MCC mode again. The `rts.jsonl` record's `detail` names the check (`sessions`, `daemon-in-service`, `control-sessions`) and the dead sessions by name, and carries `sessions: [{id, name}]`. ROLLBACK does not revive a killed session: the record and the stop keep the next deploy from repeating the damage, and show the SUPERVISOR which sessions to relaunch.
* Pure functions `snapshotOf`, `diedOf`, `checkSessions` are tested in `deploy/rts.test.mjs`. Tests never run the real unit or restart 7700.

### UPDATE bar as built (ATC-82)

The top bar of the screen shows when the running service is behind `origin/main`, and lets the SUPERVISOR start RETURN TO SERVICE from the screen, like a desktop app update: `업데이트 있음 · c0ca22e → 4678e03 · PR 2 · CI ✓ [업데이트]`. It starts the same `atc-rts` unit MCC starts (section 6), in any MCC mode, including `shadow`. Nothing in `deploy/` changed.

- `GET /api/update` (read only, polled by the screen): `kind`, `why`, `deployed` (the service's `head`), `main` and its CI, `prs` (number and title of the PRs merged between the two, read from GitHub `compare` and cached per range), `refusal`, and the last `rts.jsonl` record. `refusal` is what is known before starting: the range changes `package*.json` or `deploy/*.service`/`*.timer`. It comes from `planRts` itself, loaded at run time like `tierOfFiles` loads `landing-tier.mjs`, so the rule lives in one place. `prs` is `null` when GitHub could not be read; the bar then omits the PR count and RTS still checks the range itself.
- `POST /api/update/start` (SUPERVISOR only: the screen's own JSON request, like the switches in the settings window). It runs the checks of `/api/mcc/rts` (`rtsDueOf`: RTS running, stop after ROLLBACK, main CI) plus `refusal`, and refuses while its own last start has no result yet (`starting`, `running`). It has no 5-minute spacing (2026-09-29, SUPERVISOR: the click is the deploy time), then `systemctl --user start --no-block atc-rts.service`, and appends `{op: "rts", by: "supervisor", from, to, result}` to `mcc.jsonl`. The MCC session's records keep their `model`; the two are told apart by `by`. MCC's own RTS keeps the 5-minute spacing (to batch merges), counted from either kind of start.
- Test servers never start the unit. A server with a state directory other than the account's real `~/.local/state/atc` (compared against the passwd home, not `$HOME`) or a port other than 7700 answers `409` and starts nothing, on both endpoints. Tests stub the unit start.
- Bar `kind`: `available` (button), `waiting` (main CI running, or 5 minutes not yet passed), `manual` (a person must deploy; the bar shows the reason instead of the button), `starting` (clicked, `rts.jsonl` not yet `running`), `running`, `refused`/`failed` (the reason from `rts.jsonl`, with "다시 시도"), `rollback` (RTS stopped; the reason says to pick the MCC mode again in the settings window). The screen adds `restarting` (the SSE dropped while RTS was running: "재시작 중", LINK shows "재시작", not "끊김") and `done` (the service came back on the target and no new bundle bar follows, for a server-only change). When the restart brings a new bundle, `NewVersionBar` takes over as before.
- Pure functions in `server/update.ts` (`prsOfMessages`, `rangeRefusalOf`, `updateStateOf`, `barKindOf`); tests in `server/update.test.ts` and `server/update-run.test.ts`.
- PILOT'S DISCRETION: the bar sits for the MCC AIRPORT only (`mcc.json` `airport`). `refused`/`failed` keep showing until the next start or the next `main` head. A clicked-but-not-yet-recorded start shows `starting` for at most 2 minutes.

### RTS race as built (ATC-121)

MCC used to land a PR in the same pass that started RTS, and RTS could read a main whose CI belonged to another commit. Four changes:

- **One commit.** `readMain` (`server/sources/github.ts`) resolves the default branch's head SHA first (the one the poll already read, or one more `gh api` call) and reads `check-runs` and `status` for that SHA, never for the branch name. `MainStatus.sha` and `state` therefore describe the same commit.
- **A commit with no check yet is pending.** `mainStateOf(runs, statuses, expectCheck)` (`server/atfm.ts`) returns `pending` when the repo's usual main check (`mcc.json` `ciCheck`, `check` for ATCC; passed in for the MCC AIRPORT only) is not among the SHA's runs or statuses, unless another check has already failed. Repos with no configured check keep `none`.
- **Refused starts don't hold the next one.** `spacingStartOf(records, rts)` (`server/mcc.ts`) gives the last `mcc.jsonl` `rts started` whose result in `rts.jsonl` is not `refused` (results are matched by time and target; an unfinished start counts). `rts.due` and `POST /api/mcc/rts` use it for the 5-minute spacing. The UPDATE bar keeps the plain last start, because it shows that start's refusal.
- **RTS before landing.** `rtsDueOf` also answers not due when the last `land` `ok` in `mcc.jsonl` is newer than the time atc read main's CI (`main.at`), which covers a tick that lands first anyway. `mcc/CLAUDE.md` and `/tick` say to run `mcc rts` first when `rts.due`, and not right after a landing in the same pass. `deploy/rts.mjs` is unchanged; its own check stays the last line of defence.

### Mode `rts` and the server's own RTS as built (ATC-84)

A fourth MCC mode, `rts`: the SUPERVISOR merges atc PRs by hand, and the atc server starts RETURN TO SERVICE by itself when it is due, without waiting for the MCC session's `/tick`. `land+rts` keeps MCC's landing and uses the same server-side trigger. "When to deploy" needs no judgment, so the server does it. Nothing in `deploy/` changed; `rts.mjs` keeps its refusals.

| Mode | MCC lands (L1) | Server starts RTS by itself | `mcc rts` from the session |
|---|---|---|---|
| `shadow` | no (`would-land`) | no | `would-rts` |
| `land` | yes | no | `would-rts` |
| `land+rts` | yes | yes | starts when due |
| `rts` | no (`would-land`) | yes | starts when due |

- `mccLands(mode)` and `mccDeploys(mode)` (`server/mcc.ts`) are the two predicates; `mcc.json` and the settings window accept `rts` (`MCC_MODES`).
- **The pass.** `mountUpdate` (`server/update-run.ts`) returns `pass`, and `server/index.ts` runs it every 30 s (`unref`'d). It does nothing unless the mode is `rts` or `land+rts`. When RTS is due (`rtsDueOf`: main CI passed, the 5-minute spacing, not stopped after ROLLBACK, service behind main) it reads the range (`compare`, once per range, cached) and starts the unit with the same `deps.startUnit` as the UPDATE bar, appending `{op: "rts", by: "server", from, to, result}` to `mcc.jsonl`. It never calls `claude agents` and reads no LOGBOOK or FUEL.
- **The decision is a pure function**, `autoRtsOf` (`server/mcc.ts`), tested in `server/mcc.test.ts`; the pass and the stubbed unit start are tested in `server/update-run.test.ts`. It says no when: the mode is not `rts`/`land+rts`; the server is a test server (`rtsUnitGuard`: a temporary `ATC_STATE_DIR` or a port other than 7700 never starts the real unit); RTS is not due; the range changes `package*.json` or `deploy/*.service`/`*.timer` (`rangeRefusalOf`, the SUPERVISOR deploys those; the UPDATE bar shows `manual`); the last `rts.jsonl` line for the same `main` is `refused` or `failed` (automatic deploys stop for that `main`; the SUPERVISOR retries from the UPDATE bar, and a new `main` is tried again); or a unit start for this `main` failed less than 5 minutes ago.
- **`mcc rts` still works.** In `rts` and `land+rts` it starts the unit when due (no `by`, with the session's `model`). When the server already started it, it answers `409` with `serverStarted: true` and a `why` of `서버가 이미 RTS를 시작함(<time>) — <reason>`; `atcctl` prints it as `RTS 안 함 — …`.
- **UPDATE bar.** `GET /api/update` carries `auto: {on, nextAt}`. In these modes the bar adds `자동 배포 켜짐`, with `· 다음 HH:MM` while it waits out the 5-minute spacing. The bar itself still shows only when the service is behind. The SUPERVISOR's [업데이트] click keeps working and has no spacing.
- **ROLLBACK** stops the server's RTS like MCC's, until the SUPERVISOR picks the MCC mode again.
- PILOT'S DISCRETION: the pass runs every 30 s (the snapshot refreshes about every 20 s); after a `refused` RTS the server does not retry the same `main` (the refusal needs a person); `rts` mode's `would-land` records use `detail: "rts"`; root `CLAUDE.md` is `user` tier and is not changed here (it describes `land+rts`, the mode in use).

## 7. Records and switches

- `~/.local/state/atc/mcc.json` (atomic): `mode` `shadow` (default) | `land` | `land+rts` | `rts`, `holds` (PR numbers). It is changed only from the settings window (AGENTS tab, MCC row), like AUTOLAND. `atcctl` has no command for it.
- `~/.local/state/atc/mcc.jsonl` (append-only): `inspect` (PR, head, verdict, text, model), `escalate`, `land` / `would-land` (PR, head, tier, result), `mode`.
- `~/.local/state/atc/rts.jsonl` (append-only), written by `deploy/rts.mjs`.
- Every MCC write (`inspect`, `escalate`, `land`, `rts`) must carry a model named in `MCC_MODELS`. As with CROSSCHECK, the MCC guard reads the model from the session transcript and passes it as `ATC_MCC_MODEL`; `atcctl mcc` sends it. The TOWER and OCC guards let any `atcctl` command through but never set it, so an `atcctl mcc` write from those sessions is refused by the server.

## 8. The session

- Folder `atc/mcc/`: `CLAUDE.md` (Korean source) and `CLAUDE.en.md`, `.claude/skills/tick/SKILL.md`, `.claude/settings.json`, `.claude/agents/inspector.md`, `read-guard.mjs`, `inspector-guard.mjs`, `agent-guard.mjs`, `context-cap.mjs`, `packet-size.mjs`, `cost-report.mjs`, `settings.test.mjs`, `inspector.test.mjs`, `cost-report.test.mjs`.
- Launch in tmux as `atc-mcc`, `claude --strict-mcp-config` (no MCP servers), then `/loop 5m /tick`.
- Bash: `controller/guard.mjs --mcc --gh-read`. It allows `atcctl manual`, `atcctl mcc queue|packet|inspect|escalate|land|rts`, `jq` after a pipe, and read-only `gh pr view|diff|checks|list`. Everything else is blocked, including `git`, `systemctl`, `gh pr merge`, `gh api` and every other atcctl command.
- Read, Glob and Grep: the atc repository, so an INSPECTION can read the code around a diff. Not `.env*`, `~/.local/state/`, `~/.claude/` or other repositories.
- Denied: Edit, Write, NotebookEdit, SendMessage, Artifact. Agent is allowed for `inspector` only (`agent-guard.mjs`, fail-closed).

### 8.2 INSPECTION in a fresh context (ATC-135)

**Why.** MCC is one long session on a `/loop 5m /tick`. Every call re-reads the whole context, and a packet read in a pass stays in it for the rest of the session. Measured on 2026-09-29 (00:00 UTC to about 07:40): 420 calls, an average context of 491k tokens per call (peak 887k), 23 INSPECTIONs, about $7.6 an hour and $2.5 per inspected PR. The packet itself is small: the last 19 inspected PRs averaged 11.8k tokens (median 11.6k, p90 22.1k, max 23.1k; 2 were cut). The cost is the packet riding along in every later call, not reading it once.

**What changed.**
- `mcc/.claude/agents/inspector.md`: a sub-agent on Opus (same as the session's `model: opus`). Tools: Read, Grep, Glob, Bash. Its Bash hook (`inspector-guard.mjs`) allows exactly `atcctl mcc packet <PR>` and `gh pr diff <PR> --repo chaehy5665/atc [--name-only]`, on top of the MCC Bash guard, so it can never run `mcc inspect`, `land`, `rts` or `escalate`. Its Read/Glob/Grep go through `read-guard.mjs`. Input: the PR number and head. It reads the packet once and the whole diff through `gh pr diff` only when the packet says `diffTruncated`. Output: one block, `VERDICT` (`pass|findings|escalate`), `HEAD`, `COUNTS` (P0/P1/P2), `ESCALATE` (reason or `none`), `TEXT` (the INSPECTION text with the scope read, at most 4,000 characters). It is written in English because it talks to MCC and, through the PR comment, to the team (ATC-126).
- MCC (`mcc/CLAUDE.md`, `.en.md`, `/tick`): calls `inspector` for each PR that needs an INSPECTION and copies the block into `mcc inspect` / `mcc escalate` unchanged. It doesn't read a packet or a diff. If the block is malformed, its `HEAD` differs from the queue head, or the inspector fails, MCC records nothing, retries once, then logs it.
- The guard's model check is untouched: the four writes still run only from the MCC session, whose real model is checked (`ATC_MCC_MODEL`). The inspector has no path to a write.
- Context cap: when the MCC session's context passes 150k tokens, `context-cap.mjs` (a `UserPromptSubmit` hook; it reads the transcript's last request, the same number as the statusline record, because MCC can't read the state folder) adds a notice and MCC writes in its log line for the SUPERVISOR to STOP and LAUNCH it. It never restarts itself. It only informs, so it can't block a pass.

**Control rules changed (for the landing report).**
- `mcc/.claude/settings.json`: `Agent` is no longer denied; `Agent(inspector)` is allowed; the blanket Agent|Task block hook is replaced by `agent-guard.mjs`, which passes only `subagent_type: inspector`; a `UserPromptSubmit` hook `context-cap.mjs` is added.
- `mcc/CLAUDE.md`, `.claude/skills/tick/SKILL.md` (and `.en.md`): INSPECTION goes through `inspector`; the context cap.
- New `mcc/.claude/agents/inspector.md`, `mcc/inspector-guard.mjs`, `mcc/agent-guard.mjs`, `mcc/context-cap.mjs`.
- Unchanged: L1–L8, the tiers, `controller/guard.mjs`, `occ/mcp-guard.mjs`, `read-guard.mjs`, who merges.

**Measure before and after.** `node mcc/packet-size.mjs --last 20` (packet tokens) and `node mcc/cost-report.mjs --since <ISO> [--until <ISO>] --label <name>` (average context per MCC call, $ per hour, $ per inspected PR counting the sub-agent transcripts under `<session>/subagents/`, from `server/fuel-prices.json`). Both are read-only and run by a person. "Hours" is the wall-clock window, so a window with a paused MCC counts as cheaper per hour than it was while running.

| Window | Avg context per call | $ per hour | $ per inspected PR | INSPECTIONs | Calls (main + sub) |
|---|---|---|---|---|---|
| before: 2026-09-29 00:00 → ~07:40 UTC | 490,649 | 7.58 | 2.52 | 23 | 420 + 0 |
| after: one day from the first `/tick` on the new manual | _to fill (ATC-135 follow-up)_ | | | | |

**Quality check (shadow, not recorded).** Before this landed, 10 already-inspected PRs were re-inspected through an inspector-style sub-agent (Opus, same standard) and compared with the recorded INSPECTION: see the PR body for the table.

### 8.1 Changes elsewhere

- **TOWER**: for ATCC PRs, `no-review` means "MCC hasn't inspected it yet", not something the team must fix. While MCC runs, TOWER doesn't send `LANDING 불가` INFO for it. `review-findings` from an INSPECTION is still relayed.
- **Root `CLAUDE.md` and `deploy/landing-tier.mjs`**: the landing and deploy rules name MCC once MCC is in `land` mode. Until then they name the user (since GitHub #121, 2026-09-28, `structure` is no longer used; its design and work-order role is ENGINEERING).
- **`/api/version`**: adds `head`, the commit the service started from.
- **`landing-tier.mjs`**: `mcc/` joins the `flagged` paths (its guard is already `user`).

## 9. Implementation order

| Step | What | Tier |
|---|---|---|
| 1 | This design | auto |
| 2 | Server: `server/mcc.ts` (pure: landability L1–L8, RTS spacing, INSPECTION as review for ATCC), `mcc.json` / `mcc.jsonl`, the `/api/mcc/*` endpoints in shadow, `/api/version` `head`, the settings row, tests | auto |
| 3 | `atcctl mcc …` commands | flagged |
| 4 | The `mcc/` folder and guard mode `--mcc`, the read-guard, settings tests | user |
| 5 | `deploy/rts.mjs`, `deploy/atc-rts.service`, deploy README (both languages) | user |
| 6 | Shadow: MCC inspects and records `would-land` / would-RTS while `structure` and the user keep landing | — |
| 7 | Gate met → SUPERVISOR sets `land`; later `land+rts`. Update root `CLAUDE.md`, the TOWER manual and `landing-tier.mjs` | user, flagged |

**Shadow gate** (measured by atc since ATC-49, section 11): at least 20 atc PRs over at least 5 days; every PR `structure` or the user merged was either `would-land` or held by MCC for a reason the SUPERVISOR agrees with; no `would-land` PR was reverted afterwards.

## 10. Risks

| Risk | Mitigation |
|---|---|
| MCC lands a bad change | Tiers unchanged, CI, head-pinned INSPECTION, shadow gate, SUPERVISOR holds, ROLLBACK |
| A broken build takes 7700 down | Health check and automatic ROLLBACK; RTS turns itself off after a ROLLBACK |
| atc restarts while it is running the RTS | RTS runs in its own systemd unit, outside the service |
| Someone edits the main checkout | RTS refuses a dirty or diverged checkout and reports it |
| MCC and a person merge at the same time | Merges are head-pinned; RTS is fast-forward only |
| Landing gets slower than with `structure` | Pass every 5 minutes; INSPECTION of a small PR is one packet. Watch the landing wait during shadow |
| MCC's model inspects its own session's rules | `mcc/` and its guard are `flagged` / `user`, so MCC never lands a change to itself |
| GitHub rate limits | REST for merges and checks; a refusal is retried on the next pass |

## 11. What is built (step 2, 2026-09-28)

- `server/mcc.ts` (pure, `mcc.test.ts`): `mcc.json` (`mode`, `airport` `ATCC`, `ciCheck` `check`, `holds`), `mcc.jsonl` records, `parseInspect` (current head, P0–P2 rules as REVIEW, Claude models only: `MCC_MODELS`), `landBlocksOf` (L2–L8), `rtsStopOf` / `rtsDueOf`, the findings comment, and the tier from `deploy/landing-tier.mjs` (loaded at run time, so `deploy/` is untouched).
- `server/mcc-run.ts`: `GET /api/mcc/queue`, `GET /api/mcc/packet/:pr`, `POST /api/mcc/inspect/:pr`, `POST /api/mcc/escalate/:pr`, `POST /api/mcc/land/:pr`, `POST /api/mcc/rts`, `GET /api/mcc`, `POST /api/mcc/hold` (SUPERVISOR only). GitHub is read and written through REST only. In `shadow`, `land` and `rts` record `would-land` / `would-rts`; `rts` in `land+rts` starts `atc-rts.service`, which does not exist until step 5.
- CLEARED TO LAND: for the MCC AIRPORT, an INSPECTION `pass` on the head counts as the review, `findings` is `review-findings`, and a PR without one shows `MCC INSPECTION 대기`.
- `/api/version` has `head`, the commit the service started from.
- The settings window's AGENTS tab has an MCC row (`shadow` · `land` · `land+rts` · `rts`), changed only from the screen.

Step 3 (2026-09-28): `atcctl mcc queue|packet|inspect|escalate|land|rts` (`parseMccArgs`, `mccText`, tests in `controller/atcctl.test.mjs`). The writes send `ATC_MCC_MODEL` when the guard set it; the server now requires it on all four writes (`mccModelOf`) and records the model on `land`, `escalate` and `rts` lines.

Step 4 (2026-09-28): the `mcc/` folder (`CLAUDE.md` and `/tick` in Korean with English translations, `README`, `.claude/settings.json` with model `opus`, `read-guard.mjs`, `settings.test.mjs`). `controller/guard.mjs --mcc` allows `manual` and `mcc …` (with `--gh-read`, read-only `gh pr view|diff|checks|list`), checks the transcript model on the four writes (`MCC_MODELS`, the same rule as the server's) and attaches it as `ATC_MCC_MODEL`. The other modes (TOWER, OCC, CROSSCHECK, REVIEW) now block `mcc inspect|escalate|land|rts`. `mcc/` is a `flagged` path in `landing-tier.mjs`.

Step 5 (2026-09-28): `deploy/rts.mjs` (pure `planRts`, `healthyVersion`, `ciOf` with `rts.test.mjs`) and `deploy/atc-rts.service`, as in section 6. One addition: if the checkout is already at the target but the service reports another commit (a restart that failed last time), RTS only restarts.

Shadow gate (ATC-49, 2026-09-28): atc now measures the gate in section 9 itself. It only reads `mcc.jsonl` and the LOGBOOK, and changes neither format nor the MCC mode.

- `mccGateOf` (pure, `server/mcc.ts`, tests in `mcc.test.ts`) takes the LOGBOOK's merged PRs for the MCC AIRPORT (`ATCC`) from the first MCC record (`inspect`, `escalate`, `would-land` or `land`). For each merged PR it records the last INSPECTION on the merged head (or `staleInspection` when only an older head was inspected), whether that head was `would-land` or LANDED by MCC, whether MCC ESCALATEd it, and whether the LOGBOOK later marked it reverted. Records after the merge are ignored.
- Progress: PRs MCC judged (an INSPECTION on the merged head, or an ESCALATE), days since the first MCC record, and `would-land` / LANDED PRs that were reverted. `ready` holds at 20 PRs, 5 days and 0 reverted (`MCC_GATE`).
- Mismatches, left for the SUPERVISOR to judge: a PR a person or `structure` merged while the INSPECTION on its head was `findings` (`findings`); one merged with no INSPECTION on its head and no ESCALATE (`no-inspection`, noting when only an older head was inspected); a `would-land` or LANDED PR that was reverted (`reverted-would-land`). `ready` counts only the three numbers. Whether each mismatch was "held by MCC for a reason the SUPERVISOR agrees with" (section 9) stays the SUPERVISOR's call.
- The LOGBOOK has no merged head. The server reads it from GitHub's closed-PR list (REST, read-only, at most 5 pages of 100, at most once every 5 minutes while a head is missing) and keeps it per PR, since a merged head never changes. If GitHub can't be read, the gate matches on the last INSPECTION before the merge and reports the error.
- `GET /api/mcc/gate` returns the gate, its rows and mismatches, and a one-line summary. `/api/mcc/queue` carries that line as `gate`, so `atcctl mcc queue` shows it without a CLI change.
- The settings window's AGENTS tab shows a SHADOW GATE panel under the MCC row, shaped like the DISPATCH gate panel: the three criteria with target and state, the window, and up to eight mismatches linked to their PRs. Nothing on it changes the mode; the SUPERVISOR still raises it in the MCC row.

### Not built yet

- Step 6 in operation: MCC runs in shadow until the SHADOW GATE panel reads `ready`.
- Step 7: `land` / `land+rts`, and the rule changes in root `CLAUDE.md`, the TOWER manual and `landing-tier.mjs`.

## Decisions

- 2026-09-28, SUPERVISOR: atc's landing gets a dedicated control session, MCC, instead of the temporary `structure` session. The mechanical route alone (AUTOLAND for ATCC plus a deploy script) was offered and not chosen, because atc PRs need an inspection that CI can't do.

- 2026-09-28, SUPERVISOR, the open questions:
  1. **Model**: Claude. The server takes an INSPECTION only from `claude-opus|sonnet|fable|haiku…`.
  2. **The user's merges**: RTS deploys them too, except the cases in section 6 step 4.
  3. **Shadow gate**: as in section 9 (20 PRs, 5 days, nothing reverted).
  4. **Findings**: posted as a PR comment as well as recorded.
- 2026-09-28, SUPERVISOR: a second session had drafted the same goal as SELF-LANDING ([#105](https://github.com/chaehy5665/atc/pull/105), [#107](https://github.com/chaehy5665/atc/pull/107): a lander outside the server, DeepSeek review, `auto` tier only). The SUPERVISOR chose MCC as the one design, with `auto` and `flagged` landed. From SELF-LANDING, MCC takes the fork exclusion (L2).

- 2026-09-29, SUPERVISOR: no week of shadow.
  * Shadow so far: 22 PRs inspected, 0 missed, 0 reverted, but only two days (section 9 asked for 5).
  * Order: set `land` now (merging only; deploys stay a SUPERVISOR click on the UPDATE bar). Set `land+rts` once ATC-101 (SHOW tier) and ATC-102 (RTS session checks) are merged.
  * The baseline is section 5.1.
  * After `land` is on, ENGINEERING updates step 7's texts: root `CLAUDE.md`, the TOWER manual and `landing-tier.mjs` comments, all `user` or `flagged`.

## Questions for the SUPERVISOR (answered above)

1. **Model.** Proposed: a Claude model (not DeepSeek), so MCC's INSPECTION is independent of REVIEW and can read the whole repository. Which one?
2. **Deploying the user's merges.** Proposed: RTS also deploys `user` PRs the user merged, except the cases in section 6 step 4. Or should RTS only follow MCC's own landings?
3. **Shadow gate.** Is the gate in section 9 right (20 PRs, 5 days, nothing reverted)?
4. **Findings.** Proposed: MCC only records findings (the screen and TOWER carry them). Should MCC also comment on the PR?
