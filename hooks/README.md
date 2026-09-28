# hooks — claim and rules-drift hooks

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
  - In vocado, `CLAUDE.md` is excluded from git (`.git/info/exclude`) and lives only in the main checkout, which is at a detached HEAD behind `origin/main`, while `AGENTS.md` is tracked. So `--root /home/c10/projects/vocado_nextjs --ref origin/main` reads `CLAUDE.md` from the main checkout and `AGENTS.md` from `origin/main`. `origin/main` moves whenever any session fetches.
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

How atc turns claims into handoffs and conflicts is described in the main [README](../README.md#handoffs-and-conflicts).
