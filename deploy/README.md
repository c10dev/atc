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
| `Restart=always`, `RestartSec=5` | Restarts 5 seconds after the process dies for any reason, a crash or a stray `kill` (ATC-134). A deliberate `systemctl --user stop atc` stays stopped, and `restart` (RTS) works as before |
| `StartLimitIntervalSec=600`, `StartLimitBurst=20` | If the service restarts more than 20 times in 10 minutes (a failing build, say) systemd gives up and leaves it stopped, so a broken checkout doesn't loop forever |
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

After editing `atc.service` itself, copy it again and run `systemctl --user daemon-reload` before restarting. **ATC-134 changes the unit (`Restart=always`), so the SUPERVISOR reinstalls it once** (RTS refuses a range that changes a `deploy/*.service`):

```bash
cp deploy/atc.service ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user restart atc
```

## Stopping test servers safely (ATC-134)

On 2026-09-29 07:12 a team ran `pkill -f "node server/index.ts"` to stop its test server on 7702; the pattern also matched production on 7700. Since then:

- Test servers are started with their PID saved (`( … exec node server/index.ts ) & echo $! > <tmp>/server.pid`; the `exec` makes the subshell's PID node's own) and stopped only with `kill "$(cat <tmp>/server.pid)"` (root `CLAUDE.md` "검증").
- `hooks/kill-guard.mjs`, a `PreToolUse(Bash)` hook in the root `.claude/settings.json`, blocks `pkill`/`killall` with `server/index`, `atc` or `node` in the pattern, `kill $(pgrep …)` and `pgrep … | xargs kill`, `fuser -k`, and `systemctl --user stop|restart|kill|disable|mask atc`. It is fail-closed (`… || exit 2`), and it does not block `kill <pid>` or `atc-rts`. See [hooks/README.md](../hooks/README.md).
- `Restart=always` brings 7700 back within 5 seconds if it dies anyway.
- The server prints its `pid`, `ppid` and port at start and logs `SIGTERM`/`SIGINT`/`SIGHUP` before it exits, so `journalctl --user -u atc` shows what happened. Node can't see who sent the signal; a `systemctl` stop also shows up as `Stopping …` in the same journal.

## RETURN TO SERVICE (MCC)

`atc-rts.service` is a oneshot unit that puts the merged `origin/main` into the running service ([docs/mcc.md](../docs/mcc.md) section 6). The atc server starts it with `systemctl --user start --no-block atc-rts` when the MCC switch is `land+rts`; it runs outside the service so it can watch the restart to the end. Install it once (no `enable`: it only runs on demand):

```bash
cp deploy/atc-rts.service ~/.config/systemd/user/ && systemctl --user daemon-reload
```

`deploy/rts.mjs`, in order:

1. Takes `~/.local/state/atc/rts.lock` (one RTS at a time; a lock older than 10 minutes is stale).
2. Refuses unless the main checkout is on `main`, has no uncommitted changes, and can fast-forward to `origin/main`, and CI `check` on `origin/main` passed.
3. Refuses when the range changes dependencies in `package.json` / `package-lock.json` (needs `npm ci`; a change to `license`, `scripts`, `version` and the like does not count, and unreadable files count as changed) or a `deploy/*.service` / `*.timer` (needs `daemon-reload`): the user deploys those.
4. `git merge --ff-only`, `systemctl --user restart atc` (the unit's `ExecStartPre` rebuilds the screen). If the checkout is already there but the service reports another commit, it only restarts.
5. Health check for up to 90 s: `/api/version` reports the target `head` with a later `startedAt`, and `/api/snapshot` answers.
6. Session check (ATC-102), up to 30 s more: every background session (control and team) that was live before the restart is still live, `daemonInService` from `/api/control/sessions` is `false`, and that endpoint answers. RTS only reads; it never stops or messages a session. Before the restart it snapshots `claude agents --json` (ghost rows without `pid` and `status` left out).
7. On failure of 5 or 6: ROLLBACK. `git reset --hard` to the previous commit and restart (it does not revive a session that died; the `rts.jsonl` record names the check and the dead sessions as `sessions: [{id, name}]`). RTS then stays stopped until the SUPERVISOR picks the MCC mode again in the settings window.

Every attempt appends a line to `~/.local/state/atc/rts.jsonl` (`running`, then `ok`, `refused`, `rollback` or `failed`).

## CI and LANDING CLEARANCE tier

`.github/workflows/ci.yml` runs the job `check` on every pull request and on pushes to main: `npm ci`, `npm test`, `npx tsc --noEmit -p .` and `npx vite build`. On a pull request it also writes the PR's LANDING CLEARANCE tier to the run summary.

`deploy/landing-tier.mjs` decides the tier from the changed paths only:

| Tier | Paths | Meaning |
|---|---|---|
| `user` | guards (`*guard*.mjs`), `.claude/` settings (not `skills/` in a control-session folder), everything under the root `.claude/` (team-session skills), the root `CLAUDE.md`, `.github/`, `package*.json`, `hooks/`, `deploy/` (not the README) | Needs the user's decision |
| `flagged` | `controller/`, `occ/`, `crosscheck/`, `review/`, `mcc/`, `dispatch/` (manuals, skills, the atc CLI, guard tests) | Changes what a control session does; call out the changed rules |
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
