# hooks — claim, rules-drift and health hooks, FUEL statusline

**English** · [한국어](README.ko.md)

A Claude Code `PostToolUse` hook that records which git worktree each session is working in. atc reads these records as **claims** (STAND occupancy): the link between a session (AIRCRAFT) and a worktree (STAND). No dependencies beyond Node.

## What it records

After every Edit, Write, MultiEdit, NotebookEdit or Bash call, `claim.mjs` looks at the paths the call worked in:

- the target file of Edit / Write / MultiEdit / NotebookEdit,
- `cd <dir>` and `git -C <dir>` targets in **command position** of a Bash command,
- the session's cwd at that moment.

For each path it walks up to the nearest directory with a `.git` entry. If `.git` is a **file**, that directory is a linked worktree and gets a claim. If `.git` is a directory (the main checkout), nothing is recorded. The walk stops at your home folder, and only paths under `/home/` are considered.

Commands that only mention a path (`ls`, `cat`, `grep` …), argument strings of `echo` / `printf` / `jq`, heredoc bodies, here-strings and comments never create a claim — so a reviewer who only reads a worktree doesn't show up as holding it.

## Claim files

```
~/.local/state/atc/claims/<sessionId>/<URL-encoded worktree path>.json
```

```json
{"sessionId":"…","workspace":"/home/…/worktrees/vocado-voc-191-…","since":"2026-09-26T07:12:03.000Z","tool":"Edit","agentId":null,"agentType":null}
```

- The file is created once (`since` = first touch). Later touches only update its **mtime**, which atc reads as the last touch. Creation uses an exclusive write, so concurrent calls are safe.
- `since` restarts in two cases:
  - the session touches the worktree again after the TTL expired;
  - another session claimed the same worktree after this session's last touch, and this session is now taking it back (A → B → A). Without the restart, handoff and conflict verdicts would be wrong.
- Subagent calls are recorded under the leader's `session_id`, with `agentId` / `agentType` filled in.
- The hook always exits 0 and swallows errors, so a failure never interrupts the session.

| Environment variable | Default | Meaning |
|---|---|---|
| `ATC_STATE_DIR` | `~/.local/state/atc` | Where claims are written |
| `ATC_CLAIM_TTL_MIN` | `180` | Minutes after the last touch before a claim counts as ended |

## Install

Add to `~/.claude/settings.json` (use absolute paths; `async` keeps it off the critical path):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"/path/to/node\" \"/path/to/atc/hooks/claim.mjs\"",
            "timeout": 5,
            "async": true
          }
        ]
      }
    ]
  }
}
```

Keep the matcher in sync with `WORK_TOOLS` in `paths.mjs`. Read-only tools (Read, Grep, …) are deliberately not claims.

To turn it off, remove the entry. The `claims/` folder can be deleted at any time.

## rules-drift hook

`rules-drift.mjs` (ATC-42) tells running sessions when a rules file changed after they started, so nobody has to broadcast "reread CLAUDE.md". On the session's next turn it injects the unified diff through `hookSpecificOutput.additionalContext`.

| Mode | Hook event | What it does |
|---|---|---|
| `start` | `SessionStart` | Records the session's baseline: a hash per watched file, plus the content so a later diff can be made. `startup`, `clear` and `compact` start from the current files. `resume` keeps the existing baseline, so changes made while the session was closed still show on its next turn |
| `check` | `UserPromptSubmit`, `PostToolUse` | Compares hashes. If a file changed, it outputs the changed files, the unified diff and one line saying the rules changed since this session started, then records the new hash as acknowledged. On `PostToolUse` it looks at most every 30 seconds |

- **Watched files** come from the command line: `--root <repo>` (default `$CLAUDE_PROJECT_DIR`, then the hook's `cwd`), `--files` (default `CLAUDE.md,AGENTS.md`; paths inside the repo only), and optionally `--ref <git ref>`. With `--ref`, a file the ref has is read from the ref; a file it doesn't have is read from the working tree.
  - With `--ref origin/main`, rules files tracked in git follow `origin/main`, which moves whenever any session fetches, even when the checkout at `--root` lags behind. A rules file that isn't in the ref (not tracked in git) is read from the checkout at `--root`.
- **Diff cap**: at most 150 lines across files. Past that, or when the previous content is unknown, it says to Read the file again, with its path.
- **What it reads**: only the watched files. It never reads the transcript (`transcript_path`) and makes no network call. One call takes about 30 ms.
- **Fail open**: on any error (bad stdin, missing or unwritable state, a broken state file) it prints nothing and exits 0. A broken state file restarts that session's baseline at the current files. A missing watched file counts as a state of its own; when the file appears, the diff shows it.
- **State**: `~/.local/state/atc/rules-ack/<sessionId>.json` (`root`, `ref`, `files`, `acked` hashes, `startedAt`, `checkedAt`, `changedAt`) and `rules-ack/blobs/<sha256>` (content for diffs). Each `start` removes session records with no check for 7 days, and content no record points to.
- **FLEET**: each AIRCRAFT card shows its live sessions' state. It reads "RULES current", or "RULES 미확인 since <time>" with the files (the time of the last change: the ref's last commit, or the file's mtime). atc compares the records with the current files itself, so an idle session shows as behind too. An AIRCRAFT with no record shows nothing.

### Install (vocado)

The SUPERVISOR merges these entries into vocado `.claude/settings.json` (or `.claude/settings.local.json` to keep the machine paths out of the repo). The hook is synchronous so the context reaches the turn, and `timeout` bounds it:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"/home/c10/projects/atc/hooks/rules-drift.mjs\" start --root /home/c10/projects/vocado_nextjs --ref origin/main",
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"/home/c10/projects/atc/hooks/rules-drift.mjs\" check --root /home/c10/projects/vocado_nextjs --ref origin/main",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "\"/home/c10/.nvm/versions/node/v24.19.0/bin/node\" \"/home/c10/projects/atc/hooks/rules-drift.mjs\" check --root /home/c10/projects/vocado_nextjs --ref origin/main",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

To turn it off, remove the entries. The `rules-ack/` folder can be deleted at any time; sessions then restart from the current files.

## health hook

`health.mjs` (ATC-47) records the moment a session stops or waits, so atc shows the reason on FLEET right away (ATC-45's pull classifier only sees what the transcript still shows). It appends one line per event to `health/<sessionId>.jsonl`.

| Hook event | What it writes |
|---|---|
| `StopFailure` | `{t, event, code, error}` plus `line` (the first line of the error, ≤200 chars), with `code` from the server's `classifyError` |
| `Notification` `permission_prompt` / `elicitation_dialog` | `{t, event, code: "PENDING"}` — a session waiting on an approval, even while its session file says `busy` |
| `Notification` `idle_prompt` | `{t, event}`; raises no code on its own |
| `Stop`, `PostToolUse` | `{t, event}` — clears the push code |

- Only the code, the time and the first error line are stored, never message bodies. Everything else in the hook input is ignored.
- The server reads the last line of each file and prefers it over the transcript when it is newer than the transcript's last fact, so `PENDING` shows without waiting for the 30-minute `HUNG`. It clears again on `Stop` or the next `PostToolUse`.
- The hook prints nothing and always exits 0; write errors are swallowed, so it never blocks the session. It reads stdin, writes one line and exits — no network.
- Options: `ATC_STATE_DIR` (default `~/.local/state/atc`). The `health/` folder can be deleted at any time; atc then falls back to the transcript.

### Install (SUPERVISOR)

The SUPERVISOR adds these entries to `~/.claude/settings.json` (absolute paths; `async` keeps them off the critical path). The `PostToolUse` entry needs its own `matcher: "*"` — clearing matters for every tool, not only the claim tools:

```json
{
  "hooks": {
    "StopFailure": [
      { "hooks": [{ "type": "command", "command": "\"/path/to/node\" \"/path/to/atc/hooks/health.mjs\"", "timeout": 5, "async": true }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "\"/path/to/node\" \"/path/to/atc/hooks/health.mjs\"", "timeout": 5, "async": true }] }
    ],
    "Notification": [
      { "matcher": "permission_prompt|idle_prompt|elicitation_dialog", "hooks": [{ "type": "command", "command": "\"/path/to/node\" \"/path/to/atc/hooks/health.mjs\"", "timeout": 5, "async": true }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "\"/path/to/node\" \"/path/to/atc/hooks/health.mjs\"", "timeout": 5, "async": true }] }
    ]
  }
}
```

To turn it off, remove the entries.

## FUEL statusline

`fuel-statusline.mjs` (ATC-55, [docs/fuel.md](../docs/fuel.md) section 6) is a Claude Code **statusLine** command, not a hook. Claude Code runs it whenever it redraws the status line and passes JSON on stdin. From Claude Code 2.1.283 that JSON carries `session_id` and, for plan (claude.ai) logins, `rate_limits`:

| Field | Meaning |
|---|---|
| `rate_limits.five_hour` / `seven_day` | `{used_percentage, resets_at}`: share of that window used (0–100) and its reset (epoch seconds). A window is present only while its reset is in the future |
| `rate_limits.spend_limit` | Same shape, gateway logins only |
| (no `rate_limits`) | API key, Bedrock or Vertex: plan limits don't apply, nothing is written |

- It appends `{t, sessionId, rate_limits}` to `fuel/<sessionId>.jsonl`, **numbers only**, and only when a number changed since the last line. The rest of the input (model, cost, paths, workspace) is ignored.
- It prints a short line for the status line, `FUEL 5h 82% · 7d 40%`; with `--quiet` it prints nothing. It always exits 0 and swallows errors. No network.
- The server reads the last line of each file, maps session → AIRCRAFT → ACCOUNT ([docs/fleet.md](../docs/fleet.md) 8.8), and keeps the newest value per ACCOUNT.
- Options: `ATC_STATE_DIR` (default `~/.local/state/atc`). The `fuel/` folder can be deleted at any time.

### Install (SUPERVISOR)

The SUPERVISOR adds this to `~/.claude/settings.json` (absolute paths). `statusLine` holds one command, so this replaces any status line you already have:

```json
{
  "statusLine": {
    "type": "command",
    "command": "\"/path/to/node\" \"/path/to/atc/hooks/fuel-statusline.mjs\""
  }
}
```

To keep your own status line, run both from one small script and print yours: `input=$(cat); printf '%s' "$input" | node /path/to/atc/hooks/fuel-statusline.mjs --quiet; printf '%s' "$input" | your-statusline`.

If a running session doesn't show the line, restart it. Sessions on other machines and CREW subagents don't report; one live CAPTAIN session per ACCOUNT is enough. To turn it off, remove `statusLine`.

## Files

| File | Role |
|---|---|
| `claim.mjs` | The hook itself: reads the tool call from stdin, finds linked worktrees, writes or touches claim files |
| `paths.mjs` | `toolPaths(toolName, toolInput, cwd)` — the paths one tool call worked in. Shared with the atc server, which applies the same rules to transcripts for ESTIMATED TRACKs (`server/sources/claude.ts`) |
| `paths.d.mts` | Type declaration for `paths.mjs`, for the TypeScript server |
| `shell.mjs` | `workTargets(command)` — a small shell tokenizer (not a full parser) that returns `cd` / `git -C` targets in command position. Handles quotes, `;` `&` `\|` `(` `)` `` ` `` `$(`, heredocs, `VAR=…` and `if`/`then`/`time`… prefixes, and looks up to two levels into `bash -c "…"`. Only global `git` options count, so `git commit -C <commit>` is not a path |
| `shell.test.mjs` | Cases that must and must not be caught (`npm test`) |
| `rules-drift.mjs` | The rules-drift hook (`start`, `check`) and the pure functions the server reuses for FLEET (`statusOf`, `readRecords`, `readSource`) |
| `rules-drift.d.mts` | Type declaration for `rules-drift.mjs` |
| `rules-drift.test.mjs` | No change, one diff then acknowledged, new and resumed sessions, fail open, diff cap, `--ref`, cleanup (`npm test`) |
| `health.mjs` | The health hook: reads the event from stdin, appends one line to `health/<sessionId>.jsonl` |
| `health.d.mts` | Type declaration for `health.mjs` |
| `health.test.mjs` | Line format per event, no bodies, clear events, fail open (`npm test`) |
| `fuel-statusline.mjs` | The FUEL statusline command: numbers-only `rate_limits` to `fuel/<sessionId>.jsonl`, plus `parseRecord`/`lastRecord` that the server reuses |
| `fuel-statusline.d.mts` | Type declaration for `fuel-statusline.mjs` |
| `fuel-statusline.test.mjs` | Record format, numbers only, write on change, output line, fail open (`npm test`) |

How atc turns claims into handoffs and conflicts is described in the main [README](../README.md#handoffs-and-conflicts).
