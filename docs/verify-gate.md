# VERIFY GATE (ATC-517)

Heavy verification commands (`npm test`, `npx tsc --noEmit -p .`, `npx vite build`) started from parallel STANDs used to pile onto the host at the same moment (the 2026-09-30 test OOM). The gate puts them in a short queue: at most N run at once on the host, across all STANDs and sessions.

## Use

```bash
node server/verify-gate-cli.ts -- npm test
node server/verify-gate-cli.ts -- npx tsc --noEmit -p .
node server/verify-gate-cli.ts -- npx vite build
```

Run from the STAND as usual. The command starts in the caller's working directory with stdin, stdout and stderr connected as they are, and the gate exits with the command's own exit code (a command killed by a signal gives 128 plus the signal number, like a shell). A command that is not run through the gate behaves exactly as before. Nothing in `CLAUDE.md` or the skills calls the gate yet; adopting it there is a `user`-tier change.

## What it does

- **N at a time.** Default N is 2 (8 vCPUs). A slot is an `flock` on `slots/slot-<i>.lock`, held by the command itself, so the kernel releases it however the command ends: finished, timed out, or killed. There is no stale slot to clean up.
- **A short queue, not a failure.** A run with no free slot takes a ticket in `queue/` and waits its turn (arrival order). stderr says `[atc verify-gate] waiting for a slot: position P in line, N slots busy, waited Ss (gives up after Ls)` at once and every 30 s. Dead tickets (their process is gone) are not counted.
- **A wait limit.** Default 1800 s. Past it the command does **not** run and the gate exits **75** with `gave up after …`. Exit 75 is only ever the gate; the exit code 64 means no command was given.
- **Bounded load per run, too.** The gate puts a `node` shim first in `PATH` for the command. A `node --test …` (which includes `npm test`) without `--test-concurrency` gets `--test-concurrency=K` (default 3). `NODE_OPTIONS` cannot carry that flag (node refuses it), so the shim does it. Two gated test runs are at most 6 test processes, not 2 × (cores − 1).
- **Fail open.** If the gate cannot work (its folder is unwritable, `flock` is missing, its own error) it says so on stderr, runs the command directly and records `fallback` with the reason. The gate is never the reason a check cannot run.
- **Switch.** `verifyGate` (Settings → OPERATIONS → VERIFY GATE, default `on`, SUPERVISOR only, recorded as `policy / verify-gate-mode`). `off`: the command runs directly, no queue and no record.

## Settings and files

The gate folder is `~/.local/state/atc-gate/` (`ATC_GATE_DIR` overrides it). It is separate from the production state folder `~/.local/state/atc/`; the gate never reads or writes that folder, port 7700, or any `.env*` file.

| File | What |
|---|---|
| `config.json` | `mode` (written by the switch), optional `slots` (1–8), `waitLimitSec`, `testConcurrency` |
| `runs.jsonl` | one append-only line per gated run |
| `slots/`, `queue/`, `bin/node` | slot locks, tickets, the node shim |

Environment overrides: `ATC_GATE_SLOTS`, `ATC_GATE_WAIT_LIMIT_SEC`, `ATC_GATE_TEST_CONCURRENCY`. A malformed value reads as the default.

## Record and misfire counter

Each line of `runs.jsonl`: `t` (start), `where` (`local`), `cmd` (the first three words only, so arguments cannot leak a secret), `cwd`, `waited`, `waitedMs`, `ranMs`, `exit`, and when they apply `killed`, `timedOut`, `fallback`. The VERIFY GATE block of the settings window shows, for all time and the last 7 days: runs, runs that waited, longest wait, wait-limit failures, direct fallbacks (gate broken), and slots released by a killed command.
