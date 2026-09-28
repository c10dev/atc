# review/ — landing review session (REVIEW)

**English** · [한국어](README.ko.md)

The control session that reviews vocado PRs when Codex can't (ATC-7, ATC-27). It runs on **DeepSeek V4.1 Flash** through opencodex, separate from CROSSCHECK (Muse), so each family's figures stay apart. The rules are [`CLAUDE.md`](CLAUDE.md) (Korean source, [English](CLAUDE.en.md)) and [`/tick`](.claude/skills/tick/SKILL.md). Design: [`docs/occ.md`](../docs/occ.md) 9.2.

| File | Role |
|---|---|
| `CLAUDE.md`, `.claude/skills/tick/SKILL.md` | Rules and one pass (Korean originals; `*.en.md` are translations) |
| `.claude/settings.json` | Model `claude-ocx-opencode-go--deepseek-v4.1-flash`, fail-closed hooks: Bash → `../controller/guard.mjs --review`, MCP → `../occ/mcp-guard.mjs --read-only`, Read/Glob/Grep → `read-guard.mjs`, Edit/Write/SendMessage/Agent/Artifact blocked |
| `read-guard.mjs` | CROSSCHECK's read rule with this folder as the root: `review/`, `../docs/` and the session's own tool output |
| `settings.test.mjs` | Tests for the settings, the guard mode and the read rule |

## Launch

Press **LAUNCH** on the REVIEW row of the settings window's CONTROL block (ATC-66, [docs/fleet.md](../docs/fleet.md) 8.5.1), or run the same thing by hand. It is the tmux session `atc-review`:

```bash
tmux new-session -d -s atc-review -c /home/c10/projects/atc/review "env -u ANTHROPIC_BASE_URL NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost ocx claude --strict-mcp-config -n REVIEW '/loop 10m /tick'"
```

- `-n REVIEW` names the session and the last argument is its first message.

- `ocx claude` routes the settings model through the opencodex proxy. A plain `claude` stops with a "selected model" error, so it never runs silently on Claude. `env -u ANTHROPIC_BASE_URL` and `NO_PROXY` are the same fixes as for CROSSCHECK ([docs/occ.md](../docs/occ.md) "CROSSCHECK").
- `--strict-mcp-config` loads no MCP servers. The session needs none: the packet comes from `atcctl landing review`.
- The guard checks the real model in the session's transcript on every record. Only `deepseek-v4.1-flash` names pass (`claude-ocx-opencode-go--deepseek-v4.1-flash` through ocx, `deepseek-v4.1-flash` through ClaudeRipple/Desktop). The server also refuses reviews from other models.
- In Claude Desktop: open the `review` folder, name the session REVIEW, pick `deepseek-v4.1-flash` in the app's model menu (Desktop ignores the settings model), then `/loop 10m /tick`.

## What it may do

`node ../controller/atcctl.mjs manual check|ack`, `landing queue`, `landing review <repo>#<PR>` (packet) and `landing review <repo>#<PR> --head <sha> --verdict pass|findings -- '<review>'` (record), plus `jq` after a pipe. Nothing else: no `gh`, no other atc commands, no file reads outside `review/` and `docs/`.
