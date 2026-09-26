# hooks — claim hook

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

## Files

| File | Role |
|---|---|
| `claim.mjs` | The hook itself: reads the tool call from stdin, finds linked worktrees, writes or touches claim files |
| `paths.mjs` | `toolPaths(toolName, toolInput, cwd)` — the paths one tool call worked in. Shared with the atc server, which applies the same rules to transcripts for ESTIMATED TRACKs (`server/sources/claude.ts`) |
| `paths.d.mts` | Type declaration for `paths.mjs`, for the TypeScript server |
| `shell.mjs` | `workTargets(command)` — a small shell tokenizer (not a full parser) that returns `cd` / `git -C` targets in command position. Handles quotes, `;` `&` `\|` `(` `)` `` ` `` `$(`, heredocs, `VAR=…` and `if`/`then`/`time`… prefixes, and looks up to two levels into `bash -c "…"`. Only global `git` options count, so `git commit -C <commit>` is not a path |
| `shell.test.mjs` | Cases that must and must not be caught (`npm test`) |

How atc turns claims into handoffs and conflicts is described in the main [README](../README.md#handoffs-and-conflicts).
