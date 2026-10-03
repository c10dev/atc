# VERIFY GATE (ATC-517)

Heavy verification commands (`npm test`, `npx tsc --noEmit -p .`, `npx vite build`) started from parallel STANDs used to pile onto the host at the same moment (the 2026-09-30 test OOM). The gate puts them in a short queue: at most N run at once on the host, across all STANDs and sessions.

## Use

```bash
node server/verify-gate-cli.ts -- npm test
node server/verify-gate-cli.ts -- npx tsc --noEmit -p .
node server/verify-gate-cli.ts -- npx vite build
```

Run from the STAND as usual. When the LAN desktop is reachable, these three commands run there instead (see "Remote execution"); the caller cannot tell from the result except through the run record. The command starts in the caller's working directory with stdin, stdout and stderr connected as they are, and the gate exits with the command's own exit code (a command killed by a signal gives 128 plus the signal number, like a shell). A command that is not run through the gate behaves exactly as before. Root `CLAUDE.md` "Verification" and `atc-task` section 5 tell sessions to run the three checks through the gate and to use the plain command only when the gate is reported unavailable (ATC-519). A transport failure of a remote run (exit 75 or 76, a local fallback) is not a test failure; a session reports the exit code and output it got and never uses `ssh` or `scp` itself.

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

Each line of `runs.jsonl`: `t` (start), `where` (`local` or `desktop`), `cmd` (the first three words only, so arguments cannot leak a secret), `cwd`, `waited`, `waitedMs`, `ranMs`, `exit`, and when they apply `killed`, `timedOut`, `fallback`, `syncMs` (how long sending and preparing on the desktop took), `localReason` (why a run was local, below) and `lost`. The VERIFY GATE block of the settings window shows, for all time and the last 7 days: runs, runs that waited, longest wait, wait-limit failures, direct fallbacks (gate broken), and slots released by a killed command.

## Remote execution (ATC-518)

When the desktop is reachable, a heavy verification command runs there and the gate exits with the command's own exit code, with its stdout and stderr passed through unchanged (stdin is not forwarded). When it is not, the same command runs locally through the gate, with no error and no long hang. A session's behavior never depends on whether the desktop is up.

### What may run there

Only these three commands, matched word for word: `npm test`, `npx tsc --noEmit -p .`, `npx vite build`. A command with one more or one different word (`npm test -- --watch`, `bash -c …`) never goes to the desktop: it runs locally through the gate (`localReason: not-listed`). The target is one fixed desktop, read from the gate folder (below). The command also has to be started in the STAND's top folder, because `npm` runs from there.

### Steps of one run

1. **Reachability.** `ssh true` with a hard limit (default 3 s; `remoteProbeSec` in `config.json` or `ATC_GATE_REMOTE_PROBE_SEC`, 1–30). No answer: run locally (`desktop-absent`). After `wsl --shutdown` this costs at most the limit.
2. **Send.** `tar` of the tracked and untracked source (`git ls-files -co --exclude-standard`) minus the exclusion list, streamed over ssh into `~/atc-verify/runs/<id>` on the desktop. Files over 20 MB are skipped.
3. **Prepare.** On the desktop: a fresh empty `git init` and `git add -A` (some tests call `git ls-files`; no remote, no credentials, nothing from the caller's `.git`), and `node_modules` as hard links of a cache keyed by the hash of `package-lock.json` (one `npm ci` per lock file; the three newest caches are kept; run folders older than a day are pruned).
4. **Run.** The fixed command with `ATC_GITHUB=off`. The script writes `.atc-started` before and `.atc-exit` after the command.
5. **Clean up.** The run folder is removed. Nothing from the desktop is written back into the STAND except the command's output.

### Failures: transport versus the command

`ssh` returns the command's exit code, but its own failure is 255 too, so the gate reads the two marker files when it sees 255.

| What happened | What the gate does |
|---|---|
| desktop did not answer, or sending/preparing failed | runs locally (`desktop-absent` or `transport-error`), says so on stderr |
| command ran and exited with code N (including 255) | exits N; N is the command's own result, never counted as a transport failure |
| connection lost before `.atc-started` | runs locally (`transport-error`): the command never started remotely |
| connection lost after `.atc-started` and no `.atc-exit` (or the markers cannot be read) | **exit 76**, `lost: true`, message on stderr. It is not a test failure and the command is **not** re-run (a second run could repeat side effects). Run it again yourself, or turn remote execution off |

76 is only ever this case (75 is the wait limit, 64 is usage). A Ctrl-C during a remote run kills the local `ssh`; the remote command may finish by itself, and the folder is pruned after a day.

### What is never sent

The file list is filtered by an explicit exclusion list in `server/verify-remote.ts` (`isExcluded`, tested): `.git` anywhere, `node_modules`, `.env*` (except `.env.example` and `.env.sample`), `.npmrc`, `.netrc`, `.ssh`, `.aws`, `.gnupg`, `.local`, `.config`, `.claude/worktrees/` and `.claude/settings.local.*`, private keys and certificates (`id_*`, `*.pem`, `*.key`, `*.p12`), `credentials*`, `*.sqlite`, and any absolute or `..` path. `~/.claude*` and `~/.local/state/atc` are never read (the list is built from the working tree only). A test fails if the list would drop a tracked file of this repository, so tests keep the sources they need.

### Where the desktop is configured

Not in the repository (it is public). The repository only knows the name of the file: `remote.json` in the gate folder (`~/.local/state/atc-gate/`, `ATC_GATE_DIR` overrides it):

```json
{ "host": "<name or address>", "user": "<login>", "port": 22, "identityFile": "~/.ssh/<key>" }
```

`port` and `identityFile` are optional. Values are checked (a host or user starting with `-` or containing a space or shell character is rejected, so a value can never become an ssh option) and passed as separate arguments with `--` before the host. ssh runs with `BatchMode=yes` and `StrictHostKeyChecking=yes`: the desktop's host key must already be in `known_hosts`. Without a valid file the gate runs locally (`desktop-absent`).

### Test servers on the desktop

The three commands start no server of their own. The run sets `ATC_GITHUB=off`. Anything a test starts follows the local rules (ports 7702–7799, a temporary state folder); the desktop has no production 7700 and no atc state folder, and no run sends messages to real team sessions.

### Switch and counters

- **Switch** `verifyRemote` (Settings → OPERATIONS → VERIFY GATE, default `on`, SUPERVISOR only, recorded as `policy / verify-remote-mode`; stored as `remote` in `config.json`). `off`: everything runs locally through the gate as before (`switch-off`). The existing `verifyGate` switch off still means no queue and no record at all.
- **Misfire counters** (next to the gate's, all time and last 7 days): runs on the desktop; remote runs that failed for transport reasons (fell back before start plus lost); remote runs whose command failed (non-zero, not a transport problem); local runs by reason (`desktop-absent`, `transport-error`, `not-listed`, `switch-off`); runs started on the desktop and lost midway.
