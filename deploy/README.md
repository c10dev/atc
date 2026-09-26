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

## Configuration

The server reads `.env.local` in the repository root by itself (see `.env.example`); the unit doesn't need an `EnvironmentFile`.

| Variable | Default | Meaning |
|---|---|---|
| `ATC_PORT` | `7700` | Port (always bound to `127.0.0.1`) |
| `LINEAR_API_KEY` | — | Linear personal API key. Without it, tickets come only from branch names |
| `LINEAR_TEAM_KEY` | `VOC` | Linear team key |
| `ATC_PROJECTS_DIR` | `~/projects` | Where git repositories are discovered as AIRPORTs |
| `ATC_STATE_DIR` | `~/.local/state/atc` | Claims, AIRPORT registry, CLEARANCEs, FLIGHT RECORDER |
| `ATC_CLAIM_TTL_MIN` | `180` | Minutes after the last touch before a claim ends |
| `ATC_HANDOFF_GRACE_MIN` | `5` | Handoff / conflict threshold in minutes |
| `ATC_LANDING_STATE` | `Ready to Merge` | Linear state that puts a ticket in the LANDING SEQUENCE |

## Access from another computer

The server only listens on localhost. Reach it through an SSH tunnel:

```bash
ssh -L 7700:localhost:7700 <host>
```

Then open `http://localhost:7700`.
