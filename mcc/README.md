# mcc/ — atc's own landing session (MCC)

**English** · [한국어](README.ko.md)

The control session that inspects atc's own PRs, lands `auto` and `flagged` ones, and returns the service on port 7700 to operation with the merged code. It runs on **Claude**. The rules are [`CLAUDE.md`](CLAUDE.md) (Korean source, [English](CLAUDE.en.md)) and [`/tick`](.claude/skills/tick/SKILL.md). Design: [`docs/mcc.md`](../docs/mcc.md).

| File | Role |
|---|---|
| `CLAUDE.md`, `.claude/skills/tick/SKILL.md` | Rules and one pass (Korean originals; `*.en.md` are translations) |
| `.claude/settings.json` | Model `opus`, fail-closed hooks: Bash → `../controller/guard.mjs --mcc --gh-read`, MCP → `../occ/mcp-guard.mjs --read-only`, Read/Glob/Grep → `read-guard.mjs`, Agent/Task → `agent-guard.mjs` (only `inspector`), Edit/Write/SendMessage/Artifact blocked; a `UserPromptSubmit` hook `context-cap.mjs` |
| `.claude/agents/inspector.md` | The INSPECTOR sub-agent (Opus, read-only): reads one PR packet in a fresh context and returns the verdict block MCC records (ATC-135). English on purpose: it talks to MCC, not to the SUPERVISOR |
| `inspector-guard.mjs` | The inspector's Bash guard: only `mcc packet <PR>` and `gh pr diff <PR> --repo …`, never `mcc inspect\|land\|rts\|escalate` |
| `agent-guard.mjs` | Lets MCC call the `inspector` sub-agent and no other |
| `context-cap.mjs` | Adds a notice to the prompt when the session's context passes 150k tokens, so MCC asks the SUPERVISOR to STOP and LAUNCH it |
| `read-guard.mjs` | Reads the atc repository only: not `.env*`, not the repository root with Grep, nothing outside it except the session's own tool output |
| `packet-size.mjs`, `cost-report.mjs` | Measuring tools (read-only, run by a person): packet size in tokens for the last N inspected PRs; average context, $ per hour and $ per inspected PR for a time window ([docs/mcc.md](../docs/mcc.md) 8.2) |
| `settings.test.mjs`, `inspector.test.mjs`, `cost-report.test.mjs` | Tests for the settings, the guard mode, the model rule (same as the server's), the read rule, the inspector guards, the context cap and the cost report |

## Launch

In tmux, as the session `atc-mcc`:

```bash
tmux new-session -d -s atc-mcc -c /home/c10/projects/atc/mcc 'claude --strict-mcp-config'
tmux send-keys -t atc-mcc '/loop 5m /tick' Enter
```

- `--strict-mcp-config` loads no MCP servers. The session needs none: everything comes from `atcctl mcc`.
- The guard checks the real model in the transcript on every write (`mcc inspect|escalate|land|rts`). Only Claude names pass (`claude-opus-…`, `claude-sonnet-…`, `claude-fable-…`, `claude-haiku-…`); the server refuses writes without that model. A session routed to another model through `ocx` is refused.
- Or press LAUNCH on the MCC row of the settings window's AGENTS tab (CONTROL block): atc starts it in the background with the same folder, flags and first message ([docs/fleet.md](../docs/fleet.md) 8.5.1).
- In Claude Desktop: open the `mcc` folder, name the session MCC, keep a Claude model, then `/loop 5m /tick`.

## What it may do

`node ../controller/atcctl.mjs manual check|ack` and `mcc queue|packet|inspect|escalate|land|rts`, `jq` after a pipe, and read-only `gh pr view|diff|checks|list`, plus the `inspector` sub-agent (which does the INSPECTION; MCC itself reads no packet or diff). Nothing else: no `git`, no `systemctl`, no `gh pr merge` or `gh api`, no other atc commands. The server decides whether a landing or RTS happens (conditions L2–L8, the `mcc.json` switch), and does the merge, the PR comment and the RTS start itself.
