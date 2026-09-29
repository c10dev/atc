# controller/ — TOWER session and the shared control CLI

**English** · [한국어](README.ko.md)

The folder of the TOWER session (CONTROLLER), and the home of the scripts every control session (TOWER, OCC, CROSSCHECK, REVIEW, MCC) shares. TOWER's rules are [`CLAUDE.md`](CLAUDE.md) (Korean source, [English](CLAUDE.en.md)) and [`/tick`](.claude/skills/tick/SKILL.md).

| File | Role |
|---|---|
| `atcctl.mjs` | The atc CLI the control sessions use (`node atcctl.mjs …`, base URL from `ATC_URL`, default `http://127.0.0.1:7700`). `node atcctl.mjs` with no arguments prints every command |
| `guard.mjs` | The Bash guard of every control session, fail-closed (`… \|\| exit 2`). `--crosscheck`, `--review` and `--mcc` narrow the allowed `atcctl` commands |
| `squelch.mjs` | The SQUELCH hook: a `UserPromptSubmit` command that drops a plain `/tick` only when atc says QUIET (see below). Fail-open, and not a guard |
| `*.test.mjs` | Tests for the above |

## `atcctl squelch <role>` and the SQUELCH hook

[docs/squelch.md](../docs/squelch.md) ("S2 as built"). `<role>` is `tower`, `mcc`, `occ`, `crosscheck` or `review`.

```bash
node atcctl.mjs squelch tower     # OPEN shadow:quiet   |   QUIET since 03:03 (4)
```

- It asks `POST /api/squelch/<role>` and prints what the hook would act on: `OPEN <reason>`, or `QUIET since HH:MM (n)` (UTC, `n` ticks dropped since). A server error prints `OPEN fail-open (<message>)` and exits 0. It is for debugging; a session never needs it in its `/tick`.
- `squelch.mjs <role>` is the hook. It reads the hook JSON on stdin and only looks at a prompt that is exactly `/tick` (spaces around it are fine). Anything else, including `/tick now`, `/loop …` and team messages, exits 0 with no output. For `/tick` it calls the same endpoint with a 3 s timeout and prints `{"decision":"block","reason":"SQUELCH QUIET since 03:03Z (4)"}` only when the answer is an explicit `open: false`. Any other answer or error exits 0 with no output, so the tick runs.
- It never exits with 2. The guards fail closed and SQUELCH fails open; don't wire it as `… || exit 2`. No folder's `.claude/settings.json` calls it yet (S3), and the server is in `shadow`, so nothing is dropped today.
