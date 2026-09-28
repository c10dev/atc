# mcc/ — atc's own landing session (MCC)

**English** · [한국어](README.ko.md)

The control session that inspects atc's own PRs, lands `auto` and `flagged` ones, and returns the service on port 7700 to operation with the merged code. It runs on **Claude**. The rules are [`CLAUDE.md`](CLAUDE.md) (Korean source, [English](CLAUDE.en.md)) and [`/tick`](.claude/skills/tick/SKILL.md). Design: [`docs/mcc.md`](../docs/mcc.md).

| File | Role |
|---|---|
| `CLAUDE.md`, `.claude/skills/tick/SKILL.md` | Rules and one pass (Korean originals; `*.en.md` are translations) |
| `.claude/settings.json` | Model `opus`, fail-closed hooks: Bash → `../controller/guard.mjs --mcc --gh-read`, MCP → `../occ/mcp-guard.mjs --read-only`, Read/Glob/Grep → `read-guard.mjs`, Edit/Write/SendMessage/Agent/Artifact blocked |
| `read-guard.mjs` | Reads the atc repository only: not `.env*`, not the repository root with Grep, nothing outside it except the session's own tool output |
| `settings.test.mjs` | Tests for the settings, the guard mode, the model rule (same as the server's) and the read rule |

## Launch

In tmux, as the session `atc-mcc`:

```bash
tmux new-session -d -s atc-mcc -c /home/c10/projects/atc/mcc 'claude --strict-mcp-config'
tmux send-keys -t atc-mcc '/loop 5m /tick' Enter
```

- `--strict-mcp-config` loads no MCP servers. The session needs none: everything comes from `atcctl mcc`.
- The guard checks the real model in the transcript on every write (`mcc inspect|escalate|land|rts`). Only Claude names pass (`claude-opus-…`, `claude-sonnet-…`, `claude-fable-…`, `claude-haiku-…`); the server refuses writes without that model. A session routed to another model through `ocx` is refused.
- In Claude Desktop: open the `mcc` folder, name the session MCC, keep a Claude model, then `/loop 5m /tick`.

## What it may do

`node ../controller/atcctl.mjs manual check|ack` and `mcc queue|packet|inspect|escalate|land|rts`, `jq` after a pipe, and read-only `gh pr view|diff|checks|list`. Nothing else: no `git`, no `systemctl`, no `gh pr merge` or `gh api`, no other atc commands. The server decides whether a landing or RTS happens (conditions L2–L8, the `mcc.json` switch), and does the merge, the PR comment and the RTS start itself.
