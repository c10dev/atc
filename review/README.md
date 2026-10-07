# review/ — landing review session (REVIEW)

**English** · [한국어](README.ko.md)

The control session that reviews vocado PRs when Codex can't (ATC-7, ATC-27). It runs on **Claude Sonnet** (since 2026-09-29; before that on DeepSeek V4.1 Flash through ocx). That is a different model from the teams' CAPTAINs (Opus) and from CROSSCHECK (Opus). The rules are [`CLAUDE.md`](CLAUDE.md) (Korean source, [English](CLAUDE.en.md)) and [`/tick`](.claude/skills/tick/SKILL.md). Design: [`docs/occ.md`](../docs/occ.md) 9.2.

| File | Role |
|---|---|
| `CLAUDE.md`, `.claude/skills/tick/SKILL.md` | Rules and one pass (Korean originals; `*.en.md` are translations) |
| `.claude/settings.json` | Model `claude-sonnet-5-5`, fail-closed hooks: Bash → `../controller/guard.mjs --review`, MCP → `../occ/mcp-guard.mjs --read-only`, Read/Glob/Grep → `read-guard.mjs`, Edit/Write/SendMessage/Agent/Artifact blocked |
| `read-guard.mjs` | CROSSCHECK's read rule with this folder as the root: `review/`, `../docs/` and the session's own tool output |
| `settings.test.mjs` | Tests for the settings, the guard mode and the read rule |

## Launch

Press **LAUNCH** on the REVIEW row of the settings window's CONTROL block ([docs/fleet.md](../docs/fleet.md) 8.5.1), or run the same thing by hand in this folder:

```bash
claude --bg -n REVIEW --permission-mode auto --strict-mcp-config "/loop 10m /tick"
```

- `-n REVIEW` names the session and the last argument is its first message. The model comes from `.claude/settings.json`.
- This is the `/loop` mode. In wake mode (CONTROL WAKE REVIEW `wake`, the default since ATC-557 part d) LAUNCH sends `[ATC WAKE BOOT] REVIEW` instead and the server wakes the session when a PR head waits for a review ([docs/control-recycle.md](../docs/control-recycle.md) 10).
- `--strict-mcp-config` loads no MCP servers. The session needs none: the packet comes from `atcctl landing review`.
- The guard checks the real model in the session's transcript on every record. Only `claude-sonnet-…` names pass. The server also refuses reviews from other models. Older DeepSeek records still count when a review carries over a main merge (ATC-31).
- The tmux and `ocx claude` launch (ATC-66) was removed on 2026-09-29.

## What it may do

`node ../controller/atcctl.mjs manual check|ack`, `landing queue`, `landing review <repo>#<PR>` (packet) and `landing review <repo>#<PR> --head <sha> --verdict pass|findings -- '<review>'` (record), plus `jq` after a pipe. Nothing else: no `gh`, no other atc commands, no file reads outside `review/` and `docs/`.
