# Working on atc

[한국어](CLAUDE.md) · **English**

> English translation for readers. Sessions load the Korean [`CLAUDE.md`](CLAUDE.md), which is the source of truth; this file is not loaded.

Rules for sessions that change atc's code (team sessions, the ENGINEERING session, and sessions working directly with the user). Design and terms are in `README.md` and `docs/`.

**Control sessions are excluded.** Sessions opened in `controller/` (TOWER), `occ/` (OCC), `crosscheck/` (CROSSCHECK), `mcc/` (MCC) and `duty/` (DUTY, L1) follow the `CLAUDE.md` in their own folder. They load this file too, but control sessions never change code, so the working rules below don't apply to them. Where the two differ, the folder's `CLAUDE.md` wins. DUTY writes docs and Linear issues, so it keeps the rules in "git and PRs", "Terms and docs", "Plans and ideas" and "DUTY" as they are (the worktree and test-server parts of "Where to work" and "Verification" are replaced by DUTY's STAND and the server: `duty/CLAUDE.md`).

## Where to work

- `/home/c10/projects/atc` (the main checkout) is the **production service folder**: the systemd service builds and runs from it. Don't change code or switch branches there. Worktrees live in its `.claude/worktrees/`, so don't run `git clean` or `git stash` there, and don't run anything that could delete a worktree (a recursive delete, a sweep of the whole folder).
- Work in a worktree based on `origin/main`. Either place is fine:
  - `/home/c10/projects/worktrees/atc-<task>` (branch `claude/<task>`): `git -C /home/c10/projects/atc worktree add /home/c10/projects/worktrees/atc-<task> -b claude/<task> origin/main`.
  - `/home/c10/projects/atc/.claude/worktrees/<name>` (branch `worktree-<name>`): made by Claude Code's worktree tool (`EnterWorktree name=<name>`).
  - atc reads the branch prefixes `claude/` and `worktree-` the same way. Put the key (`atc-<n>`) in the name.
- A session that uses the worktree tool (a background AIRCRAFT) makes its STAND with `EnterWorktree name=atc-<n>-<short name>` and moves to the next FLIGHT with `ExitWorktree action=keep`, then a new `name`. `EnterWorktree path=` into a worktree outside `.claude/worktrees/` (for example `/home/c10/projects/worktrees/…`) asks for approval as a permission-root move, and a background session stops there. An existing worktree inside `.claude/worktrees/` can be entered with `path=` without asking.
- node_modules, in either place: `cp -al /home/c10/projects/atc/node_modules <worktree>/node_modules`.
- Clean a finished worktree up with `git worktree remove <path>` (or the tool's `ExitWorktree action=remove`).
- The git stash is shared by every worktree. Never use bare `git stash` / `git stash pop`; set work aside with a temporary commit.
- Don't touch the production state in `~/.local/state/atc/` (proposals, CLEARANCEs, FLEET, FLIGHT RECORDER). Test with a temporary state folder (below).

## Verification

- `npm test`, `npx tsc --noEmit -p .` and `npx vite build` must all pass.
- Pure functions are tested with `node:test` (`server/*.test.ts`, `controller/*.test.mjs`, `occ/*.test.mjs`, `hooks/*.test.mjs`).
- For an end-to-end check, run a test server on 7702: `(set -a; . /home/c10/projects/atc/.env.local; set +a; ATC_GITHUB=off ATC_STATE_DIR=<temp folder> ATC_PORT=7702 exec node server/index.ts) & echo $! > <temp folder>/server.pid`. `ATC_GITHUB=off` stops the server from calling GitHub (`gh`), so a test server never polls GitHub with the SUPERVISOR's token. Drop it only when the check needs live PR data, and then keep the run short. Copy only the registries you need (`airports.json`, `fleet.json`) into the temp folder. Never copy or print `.env.local` (the Linear API key). Stop the server and delete the temp folder afterwards. Start the test server with its PID saved (the `& echo $! > <temp folder>/server.pid` above; `exec` in the subshell makes that PID node's own) and stop it only with `kill "$(cat <temp folder>/server.pid)"`. Never kill by name or pattern (`pkill`, `killall`, `kill $(pgrep …)`), and never touch a process you didn't start (incident 2026-09-29: `pkill -f "node server/index.ts"` also stopped production 7700; `hooks/kill-guard.mjs` blocks such commands and `systemctl --user stop|restart|kill atc`). A launch script of your own must write the PID file too.
- Open the UI with Playwright. Don't message real team sessions during tests.
- atc is a public repo. Don't post screenshots to PRs, issues or branches (not even blurred, not on an image-only branch). Describe what you checked on screen in the PR body.

## Operations

- Don't restart the production service (7700). Deploys (main fast-forward and restart) go through RETURN TO SERVICE (the `atc-rts` unit). With MCC in `land+rts` mode, as now (since 2026-09-29), MCC starts RTS after it lands, batched to at most once every 5 minutes. The user may start it first from the UPDATE bar on the screen. After a ROLLBACK, RTS stays stopped until the user picks the MCC mode again in the settings window (`docs/mcc.md` 5.1, 6).
- Keep the control sessions' guards (`controller/guard.mjs`, `occ/send-guard.mjs`, `occ/mcp-guard.mjs`) fail-closed (`… || exit 2`). Ask the user before loosening what they block.

## git and PRs

- Commit, push and open PRs when the task asks for it. Commit messages and PR titles and bodies are in English.
- No attribution lines (Co-Authored-By etc.) in commit messages. PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Don't open PRs as drafts. MCC never lands a draft (`docs/mcc.md` L2), so it waits until someone marks it ready. If the work isn't finished, report instead of opening a PR.
- Team sessions, DUTY and the ENGINEERING session don't merge. Merging follows the LANDING CLEARANCE tier (`deploy/landing-tier.mjs`, decided by the changed paths).
  - `auto` (read-only server code, UI, docs, tests) and `flagged` (control-session manuals and CLI, server code with outside side effects): once CI (`check`) passes and the MCC INSPECTION is `pass`, MCC lands it (since 2026-09-29, now in `land+rts` mode, `docs/mcc.md` 5.1). The user may still merge first. For `flagged`, the PR body and the report list the changed control rules and the changed side-effect files separately. GitHub auto-merge is not used.
  - `user` (guards, `.claude/` settings, the root `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/`): the user merges. A PR that changes the production state format, is hard to undo, or leaves doubts after review is raised to `user` too (the session that opened it says so in the tier section; an MCC INSPECTION escalates it).

## Code

- Node 24 runs TypeScript directly (`node server/index.ts`). With `erasableSyntaxOnly`, don't use enums, constructor parameter properties or namespaces.
- Server: Hono. UI: Vite + React 19. Keep calculations in pure functions, separate from I/O.
- Records are append-only JSONL (`proposals.jsonl`, `clearances.jsonl`, `schedule.jsonl`, `flight-recorder/`); settings and registries are JSON rewritten atomically.
- UI colors and fonts use only the `:root` tokens in `web/src/styles.css` (so themes apply).
- Code comments are short and in Korean, like the surrounding code.

## Terms and docs

- Aviation terms stay in English everywhere: UI, docs and messages (AIRCRAFT, STAND, FLIGHT, READBACK, HOLD, CLEARANCE, HANDOFF …). Don't translate them into Korean words such as "복창". Explanatory sentences are Korean only in text the SUPERVISOR reads (UI, docs, reports, conversation with the user); text sessions exchange with each other is English (see "Radio" below).
- A team session name `TEAM_X` is a REGISTRATION. In atc's words a team is an AIRCRAFT flown by a CREW under a CAPTAIN (`docs/fleet.md`).
- Update the English (`*.md`) and Korean (`*.ko.md`) versions together for `README`, `CHANGELOG`, `docs/dispatch`, `docs/naming`, `docs/occ`, `docs/fleet`, `docs/atfm` and each folder README. In the control session folders the Korean `CLAUDE.md` / `SKILL.md` are the originals and `*.en.md` are translations.
- Changed behavior goes under `[Unreleased]` in the `CHANGELOG`. A PR doesn't edit `CHANGELOG.md` / `CHANGELOG.ko.md`; it adds a pair of fragments (`changelog.d/ATC-n.md` and `ATC-n.ko.md`, entries under a section heading such as `### Added`). ENGINEERING or the user folds them with `node server/changelog-fold.ts` (`changelog.d/README.md`).
- When how the user works changes (tabs, flows, commands, terms), update the user guide in `docs/guide/` (the DOCS tab, Korean) too. Add a new page to `DOC_NAV` in `web/src/views/Docs.tsx`.

## Plans and ideas

- Ideas not yet decided go in a GitHub Issue labelled `idea`, not in the repository docs.
- Once decided, write a design draft in `docs/<topic>.md` (Status line, Current facts, Principles, Implementation order, Risks, Decisions). New design docs start in English. Link the doc from the issue when it is adopted.
- Put a stage in `docs/guide/stages.md`, work left in that design doc's "Not built yet", and finished work in the `CHANGELOG` (as fragments).
- Status markers in design docs are DUTY's (or ENGINEERING's), updated after merge from Linear: the ✅ rows of "Implementation order" tables, `Status:` lines, moves out of "Not built yet", and stages in `docs/guide/stages.md`. Team PRs leave them alone and describe what they built only in their own section right after the section that describes the feature, without a number (`### F7 as built (ATC-57)`).
- atc's own work lives in the Linear `atc` team (ATC). atc reads every team in `LINEAR_TEAM_KEYS`, but only the configured teams (`candidateTeams` in `dispatch.json`; empty means the main team) produce DISPATCH and SCHEDULE candidates. The classification labels (`type`, `wake`, `rating:*`, `Risk`, `tail:*`) are workspace labels shared by both teams. Ideas stay in GitHub `idea` issues.

## DUTY (design and work orders, formerly ENGINEERING)

- Design and work orders are **DUTY's** (`duty/`, L1, `docs/duty.md` 3.4 and 3.5), the work an airline's Technical Services used to do. DUTY is a standing control session; the SUPERVISOR talks to it on the atc screen.
- What it does: writes design docs (`docs/<topic>.md`) in its own STAND (`.claude/worktrees/duty-*`, branch `claude/duty-*`, created by the server through `atcctl duty stand`) and raises them as PRs. It creates, updates and comments on Linear issues (work orders, EO) in the ATC team (the server writes with its own key; DUTY has no MCP). It splits large issues (wake `J`) into sub-issues. The details are in `duty/CLAUDE.md`.
- The guard sets the limits of its power (`duty/guard.mjs`, fail-closed): it writes only `.md` docs inside its own STAND; git only in the fixed forms of `-C <STAND>` (`add`, `commit`, `push -u origin claude/duty-*`, `fetch`, `merge origin/main`); and only `gh pr create --base main --head claude/duty-*` (never a Draft). It cannot write the files that set its own powers (`duty/`, guards, `.claude/`, `.github/`, `package*.json`, `deploy/`, `hooks/`, the root `CLAUDE.md`, `.env*`). There is no code or test server (L2), no merge or deploy (L3), no messages to team sessions (L4). Linear is the ATC team only, states up to Backlog and Todo, and it never deletes or closes an issue. The switch is `l1` in `duty.json`, off by default.
- DUTY's PRs follow the same rules: English, no Draft, no ATC key in a design PR's title or branch, `Fixes` only when the PR completes the issue, GitHub references in Linear bodies as full URLs, a priority on every work order. The tier decides the merge (docs only is `auto`, so MCC lands it; files such as `duty/` cannot be written anyway).
- An **ENGINEERING session** (a working session that opens this repository, for example in Claude desktop, to do the same work) stays as break-glass. It follows the same rules and doesn't merge, deploy or message team sessions. Sending work to teams is for DISPATCH, OCC and the user; `GET /api/dispatch/flight/<FLIGHT>/brief?to=TEAM_X` gives the text for a direct assignment.
- DUTY (up to Backlog and Todo), the user and, as break-glass, ENGINEERING create Linear issues and change their state. Team sessions don't write to Linear (`Fixes ATC-n` closes the issue on merge).

## Radio

- Text that sessions exchange with each other is English (ATC-126): FLIGHT PLAN, READBACK/UNABLE/STANDBY/ROGER, CLEARANCE, CREW BRIEFING, CREW CHANGE, and reports or messages to team and control sessions. Text the SUPERVISOR reads (conversation with the user, UI, logs a control session leaves for the SUPERVISOR) stays Korean. The `[DISPATCH D-xxxx]`, `[OCC CC-xxxx]` and `[ATC C-xxxx]` headers and `READBACK …`, `UNABLE …`, `STANDBY …`, `ROGER …` are read by guards, so they stay byte for byte.
- Write what the SUPERVISOR reads (your turn text in this session, questions, summaries) in Korean, never Japanese or Chinese (ATC-150). Text between sessions stays English.
- Don't message other team sessions. Report results and blockers only to the session (usually ENGINEERING) or user that gave you the task.
- When atc OCC (the operations control session) sends a `[DISPATCH D-xxxx]` FLIGHT PLAN, the leader answers that message with `READBACK D-xxxx`, with `UNABLE D-xxxx — reason` if it can't take the work, or with `STANDBY D-xxxx` if it needs time. A `[DISPATCH D-xxxx] RECALL` stops the work and gets `READBACK D-xxxx RECALL`. A `[OCC CC-xxxx]` CREW CHANGE gets `READBACK CC-xxxx` and the crew change goes ahead as told (or `UNABLE CC-xxxx — reason`). An `[ATC C-xxxx]` CLEARANCE gets the answer its closing line asks for (`READBACK`, `UNABLE` or `STANDBY` for an instruction, `ROGER C-xxxx` for a notice). A STAND-free (no worktree) SURVEY/CHECK FLIGHT reports its result link or one line to OCC when it finishes.
- TOWER's `GO AROUND` (ATC-128) is an instruction to act, not an INFO. Answer `READBACK C-xxxx`, merge `origin/main` into the branch or rebase onto it, resolve, show the conflict hunks in the conversation, run all the checks (`npm test`, `tsc`, `vite build`), push with `--force-with-lease` only (never a plain `--force`), and say in the PR body what was resolved and how. If the two PRs change the same behaviour differently and one side has to be chosen, don't resolve it; answer `UNABLE C-xxxx — reason`.
- TOWER's `FIX` (ATC-270) is also an instruction to act: the current head of the PR has review findings (MCC INSPECTION, REVIEW, Codex). Answer `READBACK C-xxxx`, fix the findings on the same branch (or say in the PR body why one stays: PILOT'S DISCRETION), run the checks, push, and report to the session that gave you the work. If you cannot, answer `UNABLE C-xxxx — reason`. Don't ROGER it and wait, as with an `INFO`. The new head is inspected again.
- A direct assignment from ENGINEERING or the user (`BRIEF: DIRECT`) is answered with `READBACK ATC-n` to that session (`.claude/skills/atc-task/SKILL.md`). The final report always goes to whoever gave the work — OCC for a FLIGHT PLAN, ENGINEERING or the user for a direct assignment. That report starts with a fixed header (ATC-124, `atc-task` skill section 8): `[TEAM_X → OCC] ARRIVED ATC-n · PR #n`, then the fixed lines `TIER auto|flagged|user`, `TESTS <pass>/<total> · tsc ✓ · build ✓` (`TESTS n/a` for a PR with no code or test changes), `DISCRETION <n> — …` (`none` if there is none) and `BLOCKED none | …`, then the free summary. A SURVEY or CHECK FLIGHT without a PR uses `RESULT <link>` in place of `PR #n`. The session that receives it (OCC, or ENGINEERING) records the fixed fields with `atcctl dispatch report`.
