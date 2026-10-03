# Working on atc

[한국어](CLAUDE.md) · **English**

> English translation for readers. Sessions load the Korean [`CLAUDE.md`](CLAUDE.md), which is the source of truth; this file is not loaded.

Only the rules that sessions changing atc's code (team sessions, ENGINEERING, sessions working directly with the user) follow on every turn. Procedure and checklists are in `.claude/skills/atc-task/SKILL.md`, the other rules in `docs/rules.ko.md` (read only when needed), design and terms in `README.md` and `docs/`. A rule lives in one place only.

**Control sessions are excluded.** Sessions opened in `controller/` (TOWER), `occ/`, `crosscheck/`, `mcc/` and `duty/` (DUTY) follow the `CLAUDE.md` in their own folder (the folder's wins when they differ) and do not change code, so the work rules below do not apply. DUTY follows "git and PRs" and the docs and planning rules in `docs/rules.ko.md`.

## Where to work

- `/home/c10/projects/atc` (the main checkout) is the **production service folder**. Do not edit code or switch branches there, and do not run `git clean`, `git stash` or any command that can delete `.claude/worktrees/` (recursive delete).
- Work in a STAND (worktree) based on `origin/main`. A background AIRCRAFT creates it with `EnterWorktree name=atc-<n>-<short name>` (for the next FLIGHT, `ExitWorktree action=keep`, then a new `name`) and never enters a path outside `.claude/worktrees/` with `path=` (it asks for approval and the session stalls). Commands and order: `atc-task` section 2.
- The git stash is shared by all worktrees. No bare `git stash` or `git stash pop`; set work aside as a temporary commit.
- Do not touch the production state `~/.local/state/atc/`. Test with a temporary state folder.

## Verification

- `npm test`, `npx tsc --noEmit -p .` and `npx vite build` must all pass. Run the three through `node server/verify-gate-cli.ts -- <command>` (VERIFY GATE, `docs/verify-gate.md`); use the plain command only when the gate is reported unavailable. Do not use `ssh` or `scp` yourself. A gate transport failure (exit 75 or 76, a local fallback) is not a test failure. Report the exit code and output you got, wherever it ran. Test pure functions with `node:test`.
- To check the server, use the skill `test-server` (7702-7799, temporary state folder, `ATC_GITHUB=off`). If you start one by hand, save the PID to a file and stop it only with `kill "$(cat <pid file>)"`. Never kill by name or pattern (`pkill`, `killall`, `kill $(pgrep …)`), and never touch a process you did not start or production 7700 (2026-09-29 incident; `hooks/kill-guard.mjs` blocks it).
- Do not message real team sessions during a test. Do not copy or print `.env.local`.
- atc is a public repository. No screenshots on PRs, issues or branches (not blurred, not on an images-only branch). Describe what you saw in the PR body in words.

## Operations

- Do not restart the production service (7700). Deploy with RETURN TO SERVICE (the `atc-rts` unit, usually started by MCC after a landing) (`docs/mcc.md` 5.1, 6).
- The control sessions' guards (`controller/guard.mjs`, `occ/send-guard.mjs`, `occ/mcp-guard.mjs`) stay fail-closed (`… || exit 2`). Ask the user first before weakening what they block.

## Git and PRs

- Commit, push and open PRs when the assignment asks. Commit messages and PR titles and bodies are in English; no attribution line (Co-Authored-By etc.) in commit messages. The PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Never open a PR as a Draft (MCC does not land a Draft). Report unfinished work without a PR.
- Team sessions, DUTY and ENGINEERING do not merge. Merging follows the LANDING CLEARANCE tier (`deploy/landing-tier.mjs`, decided by the changed file paths).
  - `auto` (read-only server, screen, docs, tests) and `flagged` (control-session manuals and CLI, server code with external side effects): MCC lands it when CI (`check`) passes and the MCC INSPECTION is `pass`; the user may merge first. For `flagged`, list the changed control rules and external-side-effect files separately in the PR body and the report. No GitHub auto-merge.
  - `user` (guards, `.claude/`, root `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/`, `rulebook/`): the user merges. Exception: a PR within the K3 effects approved at release lands via MCC (`docs/mcc.md`). A PR that changes a production state format or is hard to reverse, or that leaves doubt in review, is also raised as `user` (write it in the body's tier; MCC INSPECTION escalates).
  - A `user` or ESCALATE PR has a "Behavior change" section in its body (a BEFORE/AFTER text diagram, format in `atc-task` section 7). MCC INSPECTION flags a missing diagram or one that disagrees with the diff as P1.

## Code

- Node 24 runs TypeScript directly. With `erasableSyntaxOnly`, no enums, constructor parameter properties or namespaces. The server is Hono, the screen is Vite + React 19. Keep computation in pure functions, apart from I/O.
- Records are append-only JSONL; settings and registries are JSON written atomically.
- Screen colours and fonts come only from the `:root` tokens in `web/src/styles.css`. A PR that changes a screen follows `docs/design-language.md` (principles, 3.5 Craft, the section 5 checklist) and answers the relevant lines in the PR body.
- Code comments are short and in Korean, like their surroundings.

## Terms and docs

- Aviation terms are in English (AIRCRAFT, STAND, FLIGHT, READBACK, HOLD, CLEARANCE, HANDOFF …); do not translate them ("복창"). Explanatory sentences are Korean only in text the SUPERVISOR reads (screen, docs, reports, conversation with the user), never Japanese or Chinese (ATC-150). Text sessions exchange is English (see "Radio" below).
- `TEAM_X` is a REGISTRATION. A team is an AIRCRAFT flown by a CREW led by a CAPTAIN (`docs/fleet.md`).
- Docs are edited in English and Korean together, changed behaviour goes into a `changelog.d/ATC-n.md` and `.ko.md` fragment, and a change in how users work also updates `docs/guide/`. Checklist: `atc-task` section 4; all rules: `docs/rules.ko.md` "문서".

## Planning, DUTY and Linear

- Ideas go to GitHub Issues (label `idea`); what is decided becomes a `docs/<topic>.md` design draft. Team PRs do not change a design doc's status markers (`docs/rules.ko.md` "계획").
- Design and work orders (Linear) belong to **DUTY** (`duty/CLAUDE.md`). An ENGINEERING session is break-glass: same rules, and it does not merge, deploy or talk to team sessions (`docs/rules.ko.md` "DUTY").
- Team sessions do not write to Linear (`Fixes ATC-n` closes the issue at merge). A PR that only partly finishes an issue does not put `ATC-n` in its title.

## Radio

- Text exchanged between sessions (FLIGHT PLAN, READBACK, UNABLE, STANDBY, ROGER, CLEARANCE, CREW BRIEFING and CHANGE, reports) is English; text the SUPERVISOR reads is Korean (ATC-126). The `[DISPATCH D-xxxx]`, `[OCC CC-xxxx]` and `[ATC C-xxxx]` headers and `READBACK …`, `UNABLE …`, `STANDBY …`, `ROGER …` are read by guards, so write them exactly.
- Do not message other team sessions. Report results and blockers only to the session that gave the work (OCC, ENGINEERING, the user).
- On an `[OCC]` message: a `[DISPATCH D-xxxx]` FLIGHT PLAN is answered by the leader with `READBACK D-xxxx` (`UNABLE D-xxxx — reason` if it cannot take it, `STANDBY D-xxxx` if it needs time); a `[DISPATCH D-xxxx] RECALL`: stop work and answer `READBACK D-xxxx RECALL`; an `[OCC CC-xxxx]` CREW CHANGE: `READBACK CC-xxxx`, then change the crew (`UNABLE CC-xxxx — reason` if it cannot); an `[ATC C-xxxx]` CLEARANCE is answered as its last line asks (an instruction with `READBACK`, `UNABLE` or `STANDBY`, a notice with `ROGER C-xxxx`). A SURVEY or CHECK FLIGHT without a STAND reports a result link or one line to OCC when done.
- A direct assignment (`BRIEF: DIRECT`) is answered with `READBACK ATC-n`. `GO AROUND` and `FIX` CLEARANCEs are action instructions, not notices:
  - `GO AROUND` (ATC-128): `READBACK C-xxxx`, then merge `origin/main` (no rebase), resolve the conflict and show the conflict hunks in the conversation, verify, push with a plain `git push` (no force), and describe the resolution in the PR body. If two PRs change the same behaviour differently and one must be chosen, do not resolve it: `UNABLE C-xxxx — reason`.
  - `FIX` (ATC-270, review findings on the current head): `READBACK C-xxxx`, fix on the same branch (anything not fixed gets a reason in the PR body, PILOT'S DISCRETION), verify, push, report to the assigning session. `UNABLE C-xxxx — reason` if it cannot.
- The final report for finished work starts with the fixed header (`[TEAM_X → OCC] ARRIVED ATC-n · PR #n` and the `TIER`, `TESTS`, `DISCRETION`, `BLOCKED` lines). Format: `atc-task` section 8.
