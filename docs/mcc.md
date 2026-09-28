# MCC design (atc's own landing and RETURN TO SERVICE)

MCC (Maintenance Control) is a control session that lands atc's own PRs and puts the merged code back into service on the machine. An airline's maintenance control centre decides when an aircraft that has been worked on may fly again. MCC does the same for atc: it inspects an atc PR, lands it when the rules allow, and returns the service on port 7700 to operation with the new code. Today a temporary `structure` session does this work, opened in a conversation and gone after it.

> Status (2026-09-28): design draft. The SUPERVISOR decided to give atc's landing a dedicated MCC session rather than leave it to `structure` (see "Decisions"). Nothing is built. The open questions at the end need answers before step 2.

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
3. For each PR without an INSPECTION on its head (oldest first, at most 5 a pass): `atcctl mcc packet <PR>` (PR body, changed files, diff, tier reasons, the ATC issue's goal and exit criteria when the branch or body names one), then `atcctl mcc inspect <PR> --head <sha> --verdict pass|findings -- '<text>'`, or `atcctl mcc escalate <PR> -- '<reason>'`.
4. For each PR the server reports as landable: `atcctl mcc land <PR> --head <sha>`.
5. If `origin/main` is ahead of the commit in service and its CI passed: `atcctl mcc rts`.
6. Report to the SUPERVISOR in its own session: each LANDED PR with its tier (for `flagged`, the control rules that changed), each RTS with the commit, each ROLLBACK and ESCALATE with the reason.

MCC does not fix code, comment on PRs, message team sessions, or touch Linear.

### 4.1 INSPECTION checklist

CI already runs tests, types and the build. The INSPECTION is what CI can't see, taken from root `CLAUDE.md`:

- Pure logic is split from I/O and has `node:test` tests; the tests cover the new behaviour, not only the old.
- `erasableSyntaxOnly` (no enum, parameter properties, namespace); colours and fonts only from `web/src/styles.css` tokens.
- Aviation terms in English; comments short and Korean like the surrounding code.
- Changed behaviour is in `CHANGELOG` `[Unreleased]`; paired docs changed in both languages; `docs/guide/` updated when how the user works changed.
- Nothing from vocado's internals, no secrets, no screenshots (public repository).
- Records stay append-only JSONL and settings stay atomically written JSON. A change to an operating-state format → ESCALATE.
- The change does what the PR body and the ATC issue say, and nothing else.

`findings` blocks the landing until a new head passes. Findings are written for the author, but MCC doesn't send them; the PR's author sees them on the atc screen (and TOWER relays them as it does today).

## 5. What the server checks before a landing

`POST /api/mcc/land {pr, head}` merges only when all of these hold. Each failed condition is returned by name, and `mcc queue` shows the same list.

| # | Condition |
|---|---|
| L1 | MCC mode is `land` or `land+rts` (in `shadow` the server records `would-land` instead) |
| L2 | The PR is open, not a Draft, based on `main`, and its head is `head` |
| L3 | Tier from the changed files (`deploy/landing-tier.mjs` `tierOf`) is `auto` or `flagged`, and MCC has not ESCALATEd it |
| L4 | CI `check` on `head` succeeded |
| L5 | GitHub merge state is clean (no conflict, not behind a required check) |
| L6 | An INSPECTION `pass` on `head` |
| L7 | No SUPERVISOR hold on the PR, no GROUND STOP on ATCC |
| L8 | No RTS running and no ROLLBACK waiting for the SUPERVISOR |

The merge goes through REST (`PUT /repos/…/pulls/N/merge` with `sha: head`, merge commit), so GitHub refuses it if the head moved, and GraphQL rate limits (hit on 2026-09-28) don't block it.

For ATCC PRs, CLEARED TO LAND counts an INSPECTION `pass` on the head as the review, so `no-review` clears the same way a Codex 👍 or a DeepSeek pass does for vocado. `findings` shows as `review-findings`.

## 6. RETURN TO SERVICE

The service can't restart itself from inside its own process, so RTS runs as a separate systemd user unit, `atc-rts.service` (oneshot), started by the server with `systemctl --user start --no-block atc-rts`. Its script, `deploy/rts.mjs`:

1. Takes a lock file in the state directory; one RTS at a time.
2. Refuses unless the main checkout is on `main` and clean, and `HEAD` is an ancestor of `origin/main` (fast-forward only).
3. Target = `origin/main` after `git fetch`. Refuses unless CI `check` on the target succeeded.
4. Refuses, and reports that the user must do it, when the range changes `package.json`, `package-lock.json` (needs `npm ci`) or `deploy/atc.service` (needs `daemon-reload`).
5. `git merge --ff-only <target>`, `systemctl --user restart atc`.
6. Health check for up to 90 s: `/api/version` reports the target commit (a new `head` field) and a later `startedAt`, and `/api/snapshot` answers 200.
7. On failure: ROLLBACK. `git reset --hard <previous>` (the tree was clean and the move was a fast-forward, so nothing else is lost), restart, health check again, and set RTS off until the SUPERVISOR turns it back on.
8. Appends one line to `rts.jsonl` for every attempt: from, to, result, duration, and the reason for any refusal or ROLLBACK.

A restart takes the screen and API away for a few seconds. MCC runs RTS after a landing, and at most once every 5 minutes, so a burst of merges goes out as one RTS.

The user can still deploy by hand. RTS only needs the checkout to be clean and behind `origin/main`.

## 7. Records and switches

- `~/.local/state/atc/mcc.json` (atomic): `mode` `shadow` (default) | `land` | `land+rts`, `holds` (PR numbers). It is changed only from the settings window (AGENTS tab, MCC row), like AUTOLAND. `atcctl` has no command for it.
- `~/.local/state/atc/mcc.jsonl` (append-only): `inspect` (PR, head, verdict, text, model), `escalate`, `land` / `would-land` (PR, head, tier, result), `mode`.
- `~/.local/state/atc/rts.jsonl` (append-only), written by `deploy/rts.mjs`.
- The server accepts an INSPECTION only from a model named in `MCC_MODELS`. As with CROSSCHECK, the guard reads the model from the session transcript and passes it as `ATC_MCC_MODEL`.

## 8. The session

- Folder `atc/mcc/`: `CLAUDE.md` (Korean source) and `CLAUDE.en.md`, `.claude/skills/tick/SKILL.md`, `.claude/settings.json`, `read-guard.mjs`, `settings.test.mjs`.
- Launch in tmux as `atc-mcc`, `claude --strict-mcp-config` (no MCP servers), then `/loop 5m /tick`.
- Bash: `controller/guard.mjs --mcc --gh-read`. It allows `atcctl manual`, `atcctl mcc queue|packet|inspect|escalate|land|rts`, `jq` after a pipe, and read-only `gh pr view|diff|checks|list`. Everything else is blocked, including `git`, `systemctl`, `gh pr merge`, `gh api` and every other atcctl command.
- Read, Glob and Grep: the atc repository, so an INSPECTION can read the code around a diff. Not `.env*`, `~/.local/state/`, `~/.claude/` or other repositories.
- Denied: Edit, Write, NotebookEdit, SendMessage, Agent, Artifact.

### 8.1 Changes elsewhere

- **TOWER**: for ATCC PRs, `no-review` means "MCC hasn't inspected it yet", not something the team must fix. While MCC runs, TOWER doesn't send `LANDING 불가` INFO for it. `review-findings` from an INSPECTION is still relayed.
- **Root `CLAUDE.md` and `deploy/landing-tier.mjs`**: "structure" becomes "MCC" in the landing and deploy rules once MCC is in `land` mode.
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

**Shadow gate** (proposed): at least 20 atc PRs over at least 5 days; every PR `structure` or the user merged was either `would-land` or held by MCC for a reason the SUPERVISOR agrees with; no `would-land` PR was reverted afterwards.

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

## 11. Not built yet

Everything above.

## Decisions

- 2026-09-28, SUPERVISOR: atc's landing gets a dedicated control session, MCC, instead of the temporary `structure` session. The mechanical route alone (AUTOLAND for ATCC plus a deploy script) was offered and not chosen, because atc PRs need an inspection that CI can't do.

## Questions for the SUPERVISOR

1. **Model.** Proposed: a Claude model (not DeepSeek), so MCC's INSPECTION is independent of REVIEW and can read the whole repository. Which one?
2. **Deploying the user's merges.** Proposed: RTS also deploys `user` PRs the user merged, except the cases in section 6 step 4. Or should RTS only follow MCC's own landings?
3. **Shadow gate.** Is the gate in section 9 right (20 PRs, 5 days, nothing reverted)?
4. **Findings.** Proposed: MCC only records findings (the screen and TOWER carry them). Should MCC also comment on the PR?
