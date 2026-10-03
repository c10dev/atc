# Cloud AIRCRAFT: running FLIGHTs in Claude Code cloud sessions

[한국어](cloud-aircraft.ko.md) · **English**

How atc starts, sees, hears and lands an AIRCRAFT that runs in a Claude Code cloud session ([claude.ai/code](https://claude.ai/code), `claude --cloud`, Desktop "Cloud"), while the control sessions (TOWER, OCC, MCC, DUTY) stay on this host.

> Status (2026-10-03): design draft. Nothing here is built. It sits on top of two existing work orders and does not change them: ATC-451 (repo hooks find node on any host, kill-guard stays fail-closed) and ATC-452 (Node 24 and `npm ci` on cloud session start, a cloud subsection in `atc-task`, the how-to `docs/cloud.md`). The how-to for the SUPERVISOR (GitHub access, environment settings, how to send a FLIGHT) is ATC-452's `docs/cloud.md`. This document is only about what atc itself would have to do.

Related: [fleet.md](fleet.md) (AIRCRAFT, LAUNCH), [accounts.md](accounts.md) (ACCOUNT folders), [dispatch.md](dispatch.md) (FLIGHT PLAN, READBACK, ARRIVED reports), [radio.md](radio.md), [fuel.md](fuel.md).

## 1. Current facts

Read from `origin/main` on 2026-10-03.

- **LAUNCH is local only.** `launchAircraft` (`server/session-control.ts`) picks an ACCOUNT (`launchAccountOf`: requested, preferred, fallback, the AIRCRAFT's home), refuses on login or FUEL hold, and runs `claude --bg …` in a `systemd-run --user --scope` with that ACCOUNT's `CLAUDE_CONFIG_DIR`. Success means `jobIdOf` found `backgrounded · <id> · <name>` in the output. `agentRowsOf` then lists sessions per ACCOUNT folder with `claude agents --json`.
- **What FLEET, health and FUEL read.** `server/sources/claude.ts` reads `<config dir>/projects/<cwd>/<session>.jsonl`, `sessions/`, `jobs/<id>/state.json`, and the local git worktrees (`readWorkspaces`). FUEL REMAINING comes from the statusline `rate_limits` record of a local session, per ACCOUNT (`docs/fuel.md` 6.1); cost per FLIGHT comes from transcripts. A cloud session writes none of these here.
- **atc does not read team messages.** The radio is a relay: OCC sends the FLIGHT PLAN with `SendMessage`, the CAPTAIN answers in the same chat, and OCC copies the answer into atc with `atcctl dispatch readback D-xxxx`, `unable`, `standby` and `dispatch report` (`controller/atcctl.mjs`; `server/arrival-report.ts` header: "atc는 팀 메시지를 읽지 않는다"). A cloud session cannot send a message back, so nothing reaches OCC.
- **What a stored ARRIVED report is.** Fixed fields only (`parseReport`): `flight`, `pr` or `result`, `tier`, `tests`, `discretion`, `blocked`. The free summary is never stored. Anyone who can call `dispatch report` can record it; it does not matter where the facts were read.
- **PR to FLIGHT.** `ticketKeyFromBranch` (`server/sources/git.ts`, `server/linear-keys.ts`) matches `(^|[/_-])atc-?<n>($|[/_-])`, any case, so `claude/atc-452-cloud-hooks` is ATC-452. `buildPulls` (`server/landing.ts`) uses the branch, then the PR title suffix `(ATC-n)`; it does not use `Fixes`. `Fixes` is used only for PRs merged somewhere else (`sources/github.ts` `fixesKeyOf`). A PR whose branch and title carry no key has no FLIGHT: it shows under "PRs WITHOUT A FLIGHT", and PR HOLDER routes it to DUTY (`server/pr-holder.ts` `holderOf`).
- **A missing STAND does not break LANDING.** `buildPulls` looks the STAND up by branch (`workspaces.find`), and only `standPath` and the LOS alert use it; with none, `standPath` is null and `Boolean(stand && losStands.has(…))` is false. CLEARED, MCC INSPECTION and MCC landing read the PR, not the STAND.
- **A missing STAND does break the DISPATCH life cycle.** `syncOps` moves a FLIGHT PLAN from `accepted` to `departed` only when it sees a STAND for the FLIGHT (`standOf`) or the ticket is STAND-free (SURVEY or CHECK). Otherwise it expires after 24 hours: "READBACK 뒤 24시간 동안 STAND가 생기지 않음" (`server/proposals.ts` ~line 808). FOLLOWING tracks only FLIGHTs that have a proposal (`accepted`, `departed`, `recalling`, …), so a FLIGHT with no proposal is simply not followed, and none of its delay checks fire.
- **PR HOLDER already covers "no session holds this PR".** For a PR in the landing queue with a GO AROUND or FIX waiting and no STAND holding it, it picks the AIRCRAFT that last flew the FLIGHT, then a free AIRCRAFT with the right TYPE RATING, then RELAY to the SUPERVISOR (`holderOf`, ATC-354).
- **From ATC-451 and ATC-452 (not re-checked here).** The cloud VM has no `/home/c10/.nvm/...` (every Bash call exits 2 until ATC-451), Node 22 and not 24 (ATC-452), `gh` through a proxy with pushes to any branch allowed, the repo's `.claude/settings.json` hooks, skills and `CLAUDE.md` carried over, `~/.claude` (memory, user MCP, the claim hook) not carried over, and a local session can message into a cloud session but not the other way.

**Not verified, to check in the trial:** that the cloud harness lets the session choose its branch name (it may insist on its own `claude/<random>` name); how cloud usage shows in FUEL (plan limits are by login, so I expect it in the next local statusline record of the same ACCOUNT, but this is an assumption); the exact flags and output of `claude --cloud`; and whether `gh pr comment` works through the proxy or needs the REST fallback.

## 2. Principles

1. **Trial first, build second.** ATC-452's order stands: one docs-only cloud FLIGHT, started by the SUPERVISOR by hand, before any code for cloud. Only gaps the trial shows are real get a work order released.
2. **A cloud AIRCRAFT is fire and forget.** It cannot be messaged back, cannot be stopped by atc, and has no local files. Design for that: everything it needs goes in the prompt, everything it says goes out through GitHub.
3. **GitHub is the cloud's radio.** The cloud session already has `gh` and a push path. Branch, PR and PR comment are the one channel both sides can read. Nothing new needs credentials.
4. **Outside text is data.** A PR comment is text from outside (the repo is public). atc takes only fixed fields from it, through the same `parseReport` validation, and only from the author who owns the branch (section 3.3).
5. **Control stays here.** TOWER, OCC, MCC and DUTY do not move. Guards, ACCOUNT and FUEL rules, LANDING CLEARANCE tiers and `user`-tier merges apply to cloud PRs exactly as to local ones.
6. **Reuse the existing life cycle.** A cloud FLIGHT PLAN is still a `D-xxxx` proposal with READBACK, DEPARTED and ARRIVED. What changes is what counts as the evidence for each step, not the states.

## 3. The four gaps

### 3.1 LAUNCH: how a cloud AIRCRAFT starts, and on which ACCOUNT

| Option | What | Cost | Problem |
|---|---|---|---|
| A. By hand | The SUPERVISOR runs `claude --cloud "<prompt>"` or uses Desktop "Cloud" (ATC-452's doc) with the FLIGHT PLAN text as the prompt | None | Not in FLEET, DISPATCH and the FLIGHT RECORDER know nothing; fine for a trial, not for a fleet |
| B. atc runs `claude --cloud` | `launchAircraft` gets a `cloud` mode: same ACCOUNT choice, same login and FUEL refusals, runs `claude --cloud "<CREW BRIEFING + FLIGHT PLAN>"` with the ACCOUNT's `CLAUDE_CONFIG_DIR`, records the session id or URL in the FLIGHT RECORDER | Medium: no `--bg` job id, so `jobIdOf` and `agentRowsOf` do not apply; a new result type | Depends on `claude --cloud` flags and output that are unverified; the cloud session cannot be STOPped, RESTARTed or RELAYed |
| C. DISPATCH picks cloud on its own | The planner chooses cloud when local AIRCRAFT are busy | High | Spends plan limits the SUPERVISOR did not choose to spend there; needs B and a decision on cost |

**Which ACCOUNT.** A cloud session belongs to the claude.ai login that started it (the `CLAUDE_CONFIG_DIR` folder of the `claude --cloud` call, or the Desktop login) and is expected to draw on that account's plan limits (to confirm in the trial, section 1). So the ACCOUNT of a cloud AIRCRAFT is the folder it was launched from, and option B reuses `launchAccountOf` and `launchAccountRefusal` unchanged: a cloud LAUNCH on an ACCOUNT in FUEL hold is refused exactly like a local one. For the trial the SUPERVISOR picks the ACCOUNT with the most headroom (today `acct-2` at 14% weekly) and notes it.

**Identity.** Keep the REGISTRATION model: a cloud AIRCRAFT is a FLEET entry with `launch: "cloud"` (a REGISTRATION at an AIRPORT, with TYPE RATINGS), and every FLIGHT PLAN to it starts a **new** cloud session. The proposals, ratings, capacity limit and ACCOUNT accounting all key on REGISTRATION, so none of them changes. The session is one-shot: no RESTART, no CREW CHANGE, no REFRESH.

**Recommendation.** Trial: A. After a good trial: B, behind a switch that is off by default and a misfire counter, as for the other controls. C is not proposed. **Does not block the trial.**

### 3.2 FLEET, FUEL and state

What a cloud session leaves in atc today: nothing in `projects/`, `sessions/`, `jobs/` or local worktrees, so no FLEET row, no STALLED or LIMIT health, no per-FLIGHT cost, no CLAIM or DEPARTURE LOG line. What it leaves outside: a remote branch `claude/atc-<n>-…`, a PR, and (if it uses them) PR comments.

| Option | What | Problem |
|---|---|---|
| A. Nothing | Treat the cloud FLIGHT as visible through its PR only (LANDING, FOLLOWING after a proposal) | No "in the air" signal before the PR; a cloud FLIGHT that never opens a PR is silent |
| B. Derive from GitHub | The snapshot's GitHub source also lists remote branches matching the claude prefix and a FLIGHT key. A remote branch with no local worktree counts as a **remote STAND**: it gives `departed` (first push time), `no-pr` after the WAKE expectation, and a FLEET line "CLOUD · branch · last push" | New read of branch lists (an extra `gh api` call per airport; GitHub rate limit); the branch time is the push time, not the start time |
| C. Cloud session list | Ask Claude for the list of cloud sessions (status, id) | Not known to exist as a CLI or API; would need the SUPERVISOR's login; do not build on it |

**FUEL.** Account-level FUEL REMAINING should include cloud use if limits are per login (assumption). Per-FLIGHT cost for a cloud FLIGHT stays unknown: show it as "n/a (cloud)" and keep it out of the FLIGHT cost baselines and leak detection (not checked: `fuel-leaks.ts` takes a session with no known FLIGHT into the baseline only, which may already be the wanted behaviour for a FLIGHT with no transcript at all; C2 pins it). Do not estimate it.

**Recommendation.** Trial: A. After the trial: B, because section 3.3 and the DISPATCH life cycle need a "departed" fact for a cloud FLIGHT and a remote branch is the only one that exists. C only if Claude publishes a stable interface. **Does not block the trial.**

### 3.3 Radio: READBACK, UNABLE, STANDBY, ARRIVED

The cloud session can write only to GitHub (push, PR, PR comment, issue comment) and into its own chat. The channels:

| Option | What | Verdict |
|---|---|---|
| A. The SUPERVISOR relays | The SUPERVISOR reads the cloud chat and runs `atcctl dispatch report …` | Zero code; fine for the trial. Does not scale and defeats the purpose |
| B. PR comment with the fixed report block | At the end the session posts the final-report header (`atc-task` section 8) and lines (`[TEAM_X → OCC] ARRIVED ATC-n · PR #n`, `TIER`, `TESTS`, `DISCRETION`, `BLOCKED`) as a PR comment. A reader on the host (the server, on its GitHub tick, or OCC) parses the fixed lines with `parseReport` and records `dispatch report` | **Recommended.** It is the same data OCC copies today. The comment is outside text, so only the validated fixed fields are kept, only from a comment by the PR's author and only on a PR whose head branch is in this repo (not a fork) |
| C. Status file on the branch | `.atc/flight-ATC-n.json` pushed with the work | Rejected as default: the file is part of the PR diff, so it changes the changed-file list that LANDING CLEARANCE tiers read, and it can be edited by later pushes. Possible only on a side branch that is never opened as a PR |
| D. Linear comment | The session writes it on the issue | Rejected: team sessions never write Linear (root `CLAUDE.md`), and the cloud has no Linear access unless a connector is enabled |

**READBACK, UNABLE, STANDBY.** In a cloud FLIGHT the launch **is** the delivery, so do not wait for a READBACK: treat the cloud LAUNCH like a STAND-free FLIGHT's READBACK (`departedVia: "readback"` already exists for that case). The proposal goes `sent`, then `accepted` and `departed` at LAUNCH, and `departed` is true without a local STAND. The remote branch (3.2 B) is the later evidence that work started. UNABLE has no channel except an ARRIVED-style PR comment with `BLOCKED` set, or no PR at all; the second case is caught by `no-pr` after the WAKE expectation. This makes UNABLE slower than local (hours, not minutes), which is the price of fire-and-forget. STANDBY is not used.

**Inbound.** A GO AROUND or FIX for a cloud PR needs no new path. PR HOLDER already picks a local AIRCRAFT when no STAND holds the PR. Whether a local AIRCRAFT can continue a branch made in the cloud (fetch it into its own STAND, merge `origin/main`, push) is untested: make it the second trial after a first merged cloud PR. Messaging into the cloud session (`claude -p … --cloud <id>`) is not needed and not proposed.

**Recommendation.** Trial: A, with one addition to the prompt (no work order): "also post the section 8 report block as a PR comment". That makes B's text real, and the trial shows whether `gh pr comment` works. B's reader comes after the trial. **Does not block the trial.**

### 3.4 PR to FLIGHT, and a missing STAND

Confirmed above (section 1), now as a checklist for the trial:

- **The branch name carries the link**, and nothing else does for LANDING. ATC-452 already says the branch is `claude/atc-<n>-<short name>`. If the cloud harness forces a branch name with no key, the PR has no FLIGHT, shows under "PRs WITHOUT A FLIGHT" and goes to DUTY. A title suffix `(ATC-n)` also links it, but root `CLAUDE.md` forbids the key in a PR title unless the PR finishes the issue. So the key stays in the branch, and the title key is only for a PR that finishes the issue (a docs-only trial issue does).
- **`Fixes ATC-n` closes the Linear issue on merge**; it does not link the PR to the FLIGHT in atc. It is the second line of defence only for a PR already merged.
- **No STAND:** LANDING, CLEARED, MCC INSPECTION and the merge work; the LOS alert cannot name a STAND for it (no worktree to conflict with); `standPath` is null, and nothing reads it as an error. It does mean a `D-xxxx` proposal never reaches `departed` by STAND, which section 3.3 solves by treating the cloud LAUNCH as DEPARTED.
- **A cloud FLIGHT with no proposal** (the trial) is not in FOLLOWING at all. It has a PR in LANDING and nothing else. That is correct for a trial.

**Recommendation.** No code. A test in the first work order that touches this (3.2 B) pins `ticketKeyFromBranch("claude/atc-452-x")`, a missing STAND in `buildPulls`, and the proposal life cycle with a remote STAND. **Does not block the trial**, but the trial must record the branch name the harness really produced.

## 4. What blocks the first trial

| Gap | Blocks the trial? | Why |
|---|---|---|
| ATC-451, ATC-452 | **Yes** | Without them every Bash call exits 2 and there is no Node 24 (existing work orders) |
| 3.1 LAUNCH | No | The SUPERVISOR starts it by hand |
| 3.2 FLEET, FUEL | No | A PR is visible in LANDING; a missing FLEET row is the point of the trial to observe |
| 3.3 Radio | No | One prompt line makes the report a PR comment; the SUPERVISOR can record it by hand |
| 3.4 PR to FLIGHT | No, but observe | Only the branch name matters, and the trial shows what the harness produces |

**The trial to run after ATC-452 lands:** a docs-only issue in Backlog (not Todo, so DISPATCH does not also give it to a local AIRCRAFT), no FLIGHT PLAN, started by the SUPERVISOR with `claude --cloud` on the lowest-FUEL-risk ACCOUNT. Record: the branch name produced, whether `Fixes` and the title key survive, FUEL before and after, whether `gh pr comment` works, whether the PR reaches CLEARED and MCC INSPECTION, and what FLEET and FOLLOWING showed.

## 5. Implementation order

None of these is released. Each is filed in Backlog and blocked by ATC-452. The SUPERVISOR decides after the trial which are real; the order below is the order that follows from the trial, not a promise.

| Step | What | Needs | Tier | Wake |
|---|---|---|---|---|
| C1 (ATC-484) | Cloud report reader: parse a section 8 report block from a PR comment of the PR's author on an in-repo branch into `dispatch report`; off by default, with a misfire counter; the fixed fields only | Trial, ATC-452 | `flagged` | M |
| C2 (ATC-485) | Remote STAND: list remote branches with a FLIGHT key, give `departed`, `no-pr` and a FLEET line for a branch with no local worktree; a pinning test for the missing-STAND cases in section 3.4 | Trial, ATC-452 | `auto` | M |
| C3 (ATC-486) | LAUNCH CLOUD: a `cloud` mode for `launchAircraft` (ACCOUNT, login and FUEL refusals reused), FLIGHT PLAN as the prompt, session id in the FLIGHT RECORDER, DEPARTED at LAUNCH; behind a switch, off by default | Trial, ATC-452, C2 | `flagged` | H |
| Later | A second trial: a local AIRCRAFT continues a cloud branch after GO AROUND or FIX | A merged cloud PR | — | — |

## 6. Risks

| Risk | Handling |
|---|---|
| The harness forces its own branch name | The trial records it. If it cannot be changed, link by PR title key and widen `buildPulls` to the `Fixes` line, a code change in `server/landing.ts` and a second look at the "PR title key closes the issue" rule |
| A PR comment on a public repo is outside text | Fixed fields only, through `parseReport`; only the PR author; only in-repo branches; the comment never becomes an instruction (C1) |
| Duplicate work: DISPATCH gives a Todo issue to a local AIRCRAFT while a cloud session also works on it | The trial uses a Backlog issue. After C3 the proposal itself is the single owner |
| Cloud use spends an ACCOUNT's limits that FUEL cannot attribute to a FLIGHT | Account FUEL still shows it (assumption); per-FLIGHT cost is "n/a (cloud)" |
| A cloud session cannot be stopped from atc | The SUPERVISOR stops it in the claude.ai UI; C3 has no STOP and says so on the card |
| Hooks and guards in the cloud | ATC-451 keeps kill-guard fail-closed; a guard that cannot run blocks everything |
| `claude --cloud` is a research preview and may change | C3 waits for the trial, and the exact command line lives in one function |

## 7. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Cloud AIRCRAFT identity | A FLEET REGISTRATION with `launch: "cloud"`; each FLIGHT PLAN starts a new session (proposed) |
| D2 | Where the cloud ARRIVED report goes | A PR comment with the section 8 block, read by a host reader (proposed) |
| D3 | What counts as READBACK and DEPARTED for a cloud FLIGHT | The cloud LAUNCH is the READBACK and DEPARTED; the remote branch is the later evidence (proposed) |
| D4 | The first trial's ACCOUNT | The SUPERVISOR picks the one with the most headroom |
| D5 | Does atc launch cloud sessions at all | Decide after the trial (C3 stays in Backlog until then) |

## Not built yet

Everything in sections 3 to 5.
