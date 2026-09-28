# deploy — systemd user service

**English** · [한국어](README.ko.md)

`atc.service` runs atc as an always-on **systemd user service** on the machine where your Claude Code and Codex sessions run. It serves the web UI and API on `127.0.0.1:7700`.

## What the unit does

| Line | Effect |
|---|---|
| `WorkingDirectory=/home/c10/projects/atc` | Runs from the repository checkout |
| `Environment="PATH=…/node/v24.19.0/bin:…"` | Puts Node 24 (installed with nvm) on the PATH, since user services don't load your shell profile |
| `ExecStartPre=… node --run build` | Rebuilds the web UI (`vite build`) on every start, so a plain restart picks up UI changes |
| `ExecStart=… node server/index.ts` | Starts the server (Node runs the TypeScript directly) |
| `Restart=on-failure`, `RestartSec=5` | Restarts 5 seconds after a crash |
| `WantedBy=default.target` | Starts with your user session |

The paths are for this machine. On another machine, change `WorkingDirectory`, the node path in `PATH`, `ExecStartPre` and `ExecStart` to yours (`which node` must be Node 24 or later).

## Install

```bash
cp deploy/atc.service ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now atc     # start now and at login
```

User services stop when you log out. To keep atc running without an open login session (e.g. a server you only reach over SSH):

```bash
loginctl enable-linger "$USER"
```

## Operate

```bash
systemctl --user restart atc          # after code changes (rebuilds the UI)
systemctl --user status atc
journalctl --user -u atc -f           # logs
systemctl --user disable --now atc    # stop and remove from startup
```

After editing `atc.service` itself, copy it again and run `systemctl --user daemon-reload` before restarting.

## CI and LANDING CLEARANCE tier

`.github/workflows/ci.yml` runs the job `check` on every pull request and on pushes to main: `npm ci`, `npm test`, `npx tsc --noEmit -p .` and `npx vite build`. On a pull request it also writes the PR's LANDING CLEARANCE tier to the run summary.

`deploy/landing-tier.mjs` decides the tier from the changed paths only:

| Tier | Paths | Meaning |
|---|---|---|
| `user` | guards (`*guard*.mjs`), `.claude/` settings (not `skills/` in a control-session folder), everything under the root `.claude/` (team-session skills), the root `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/` (not the README) | Needs the user's decision |
| `flagged` | `controller/`, `occ/`, `crosscheck/`, `review/`, `dispatch/` (manuals, skills, the atc CLI, guard tests) | Changes what a control session does; call out the changed rules |
| `auto` | everything else (server, UI, docs, tests) | No safety or permission surface |

The highest tier among the changed files wins. Who may merge each tier is set in the root `CLAUDE.md`.

```bash
gh pr diff 61 --name-only | node deploy/landing-tier.mjs
```

## Configuration

The server reads `.env.local` in the repository root by itself (see `.env.example`); the unit doesn't need an `EnvironmentFile`.

| Variable | Default | Meaning |
|---|---|---|
| `ATC_PORT` | `7700` | Port (always bound to `127.0.0.1`) |
| `LINEAR_API_KEY` | — | Linear personal API key. Without it, tickets come only from branch names |
| `LINEAR_TEAM_KEY` | `VOC` | Main Linear team key (new issues from S2 are created in it) |
| `LINEAR_TEAM_KEYS` | the main team | Every Linear team to read, comma-separated, e.g. `VOC,ATC`. The main team always comes first. Only the teams in `candidateTeams` in `dispatch.json` (default: the main team) get DISPATCH and SCHEDULE candidates; the rest are shown only |
| `ATC_PROJECTS_DIR` | `~/projects` | Where git repositories are discovered as AIRPORTs |
| `ATC_STATE_DIR` | `~/.local/state/atc` | Claims, AIRPORT registry, CLEARANCEs, FLIGHT RECORDER |
| `ATC_CLAIM_TTL_MIN` | `180` | Minutes after the last touch before a claim ends |
| `ATC_HANDOFF_GRACE_MIN` | `5` | Handoff / conflict threshold in minutes |

The LANDING SEQUENCE reads open PRs with the GitHub CLI, so `gh` must be installed and logged in (`gh auth status`) for the user the service runs as. Without it, PRs are simply missing and the error shows in the snapshot's `github` field. `ATC_LANDING_STATE` is no longer read; an old line in `.env.local` does nothing.

## Access from another computer

The server only listens on localhost. Reach it through an SSH tunnel:

```bash
ssh -L 7700:localhost:7700 <host>
```

Then open `http://localhost:7700`.

## SELF-LANDING lander (`atc-lander`)

`atc-lander.service` and `atc-lander.timer` run `deploy/lander.mjs` every 5 minutes, outside the atc server ([docs/self-landing.md](../docs/self-landing.md)). Steps 1 and 2 are **shadow**: for each open atc PR head it records `would-merge` or `would-skip` with reasons, then how the PR actually ended, in `~/.local/state/atc/self-landing.jsonl`. It never merges, deploys or restarts anything. The STRIPS tab shows its line in the LANDING SEQUENCE header.

| Check | Rule |
|---|---|
| Delegated | base `main`, a branch in this repository (no fork), opened by the owner account, not draft, no `hold` label, tier `auto`, CI `check` passed, not conflicting |
| Excluded | landing, AUTOLAND, switch, FLEET PLAN and session-control code; operational state format (state file paths, `…Op` / `RecordLine` types in `server/`); `SELF-LANDING: no` in the body; more than 1,500 changed lines |
| Review | the last landing review (`landing-reviews.jsonl`) on the exact head is a pass with no P0 or P1 |
| Local checks | only when nothing but the review is missing: a detached worktree of `origin/main` merged with the head, then `npm test`, tsc and vite build |

`~/.local/state/atc/self-landing.json` holds `mode` (`off`, `shadow`; missing means `shadow`; `merge` is not built yet and runs as shadow), a `groundStop` and the heads already judged.

```bash
cp deploy/atc-lander.service deploy/atc-lander.timer ~/.config/systemd/user/ && systemctl --user daemon-reload
systemctl --user enable --now atc-lander.timer
journalctl --user -u atc-lander -f       # what it judged
ATC_STATE_DIR=/tmp/x node deploy/lander.mjs   # one dry run with a separate state folder
```
