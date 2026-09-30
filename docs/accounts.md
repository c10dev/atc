# ACCOUNTS: AIRCRAFT on more than one Claude account

Status (2026-09-29): design draft for [ATC-144](https://linear.app/vocado/issue/ATC-144/claude-accounts-for-aircraft-one-claude-code-config-folder-per-account), with the step 0 measurements from [ATC-145](https://linear.app/vocado/issue/ATC-145/accounts-step-0-measure-a-second-claude-code-config-folder-on-this). Nothing here is built. Step 0 changed no code and no setting. The second folder was measured with one probe session; two things it could not measure are listed in "Not measured".

## 1. Current facts

**What atc does today** (from ATC-144):

- atc knows an ACCOUNT only as a SUPERVISOR label (`fleet.json` `account`, `control`, [fuel.md](fuel.md) section 6). FUEL REMAINING per ACCOUNT comes from the statusline; FLEET PLAN holds at `holdPct`.
- Every AIRCRAFT (11) and every control session (5) is labelled `acct-2`. All background sessions follow the one host login in `~/.claude`.
- atc reads one Claude Code folder, `config.claudeDir = ~/.claude`. LAUNCH runs `claude --bg` in a systemd scope with `cleanEnv()`, which does not pass `CLAUDE_CONFIG_DIR`.

**What was measured** (2026-09-29, Claude Code 2.1.284, second folder `~/.claude-acct-1` made and logged in by the SUPERVISOR, a different organization from `~/.claude`). One probe, `claude --bg -n ACCT-PROBE`, cwd a STAND under the trusted atc checkout, started the way `session-control.ts` does: `systemd-run --user --scope --collect --quiet --unit=atc-claude-acctprobe-1 -- claude --bg …` with a clean environment plus `CLAUDE_CONFIG_DIR=~/.claude-acct-1`. The settings for the probe came from a file passed with `--settings` (see 4). The name does not match the TEAM pattern.

| # | Question | Result |
|---|---|---|
| 1 | Second daemon? | **Yes.** `claude --bg` printed `Starting background service…`, then `backgrounded · cfec1c2f · ACCT-PROBE`, and a second `claude daemon run` was up within 20 s. It was started `--origin transient --spawned-by {"label":"claude --bg", …}`; the `~/.claude` daemon runs with `--json-path … --log-file …`. |
| 1 | Cgroup | The new daemon and its children are in the scope we named: `…/app.slice/atc-claude-acctprobe-1.scope`, parent `systemd --user`. Not in `atc.service`. The `~/.claude` daemon is in its own `atc-claude-<ms>.scope`. |
| 1 | Files under the new folder | `daemon.status.json` (`supervisorPid`, `supervisorProcStart`, `writtenAt`, `workers`), `daemon.lock`, `daemon.log`, `jobs/<id>/{state.json,timeline.jsonl}`, `jobs/pins.json`, `sessions/<pid>.json`, `projects/<encoded cwd>/<sessionId>.jsonl`. No `daemon.json` (the transient daemon has no `--json-path`). |
| 1 | Sockets | `/tmp/cc-daemon-1000/<8 hex>/` per folder: `401ce1a9` for `~/.claude`, `288ffa8b` for `~/.claude-acct-1`. The two daemons do not share a socket directory. |
| 1 | The folder is recorded in the job | `jobs/<id>/state.json` has `providerEnv: {CLAUDE_CONFIG_DIR: <folder>}`. |
| 2 | `claude agents --json` isolation | **Isolated both ways.** With `CLAUDE_CONFIG_DIR=~/.claude-acct-1` it listed 1 session (the probe, `background`). Without the variable it listed 66 sessions, none of them the probe. Before and after the whole probe the default list had the same 66 session ids (0 added, 0 removed). |
| 2 | Where the probe's files landed | `jobs/`, `sessions/` and the transcript are all under `~/.claude-acct-1`; none under `~/.claude`. |
| 3 | Stop | `CLAUDE_CONFIG_DIR=~/.claude-acct-1 claude stop cfec1c2f` printed `stopped cfec1c2f`; the job's `state.json` went to `stopped`, `claude agents --json` there listed 0. Nothing in `~/.claude` moved. |
| 3 | Remove | `claude rm cfec1c2f` (same variable) printed `removed cfec1c2f` and deleted `jobs/<id>/`. Within 3 s the transient daemon exited by itself (it was still up 5 s after `stop`, so the last job being removed is what ends it). The transcript under `projects/` stays; `claude rm` does not delete it. |
| 4 | Settings, hooks, `env` | Measured with `--settings <file>` (a copy of the `~/.claude` settings plus `ATC_STATE_DIR` pointing at a scratch folder), not with the folder's own `settings.json`. **The statusline command fired** (2 lines in `fuel/`) and the **health hook fired** (`StopFailure` with code `LIMIT`, then `idle_prompt` 60 s later), both under the second daemon. **`env` applied**: `ATC_STATE_DIR` reached the hook processes, and their records went to the scratch folder, not to `~/.local/state/atc`. |
| 5 | Statusline record and `rate_limits` | The probe's record carried its own ACCOUNT's `rate_limits`: five-hour 0 %, seven-day 100 %; the same minute `~/.claude` (acct-2) read five-hour 36 %, seven-day 54 %. So the record is per ACCOUNT, and a FUEL block over both folders would show two different values. The second ACCOUNT was at its weekly limit when measured; see 8. |
| 5 | What tells atc the folder | The record has `sessionId`, `model`, `context_window_size`, `rate_limits` and no path. The session's folder is known from where its files are: `projects/<cwd>/<sessionId>.jsonl`, `jobs/<id>/state.json` (and `providerEnv.CLAUDE_CONFIG_DIR`), `sessions/<pid>.json`. A reader that scans every registered folder maps sessionId → folder without any change to the hook. |
| 6 | `--resume` across folders | **Fails.** From `~/.claude`, `claude --resume cfec1c2f-… -p …` printed `No conversation found with session ID: cfec1c2f-…`. Recorded only; the design does not use it. |
| 7 | Memory (RSS, 2.1.284) | Second daemon `claude daemon run`: **148 MB**. Its spare worker (`bg-pty-host` 86 MB + `bg-spare` 131 MB): **217 MB**. One idle probe session (`bg-pty-host` 89 MB + the session 362 MB): **451 MB**. So a second ACCOUNT costs about **365 MB** before its first session (daemon + spare), and each session about 450 MB. The whole scope was 388 MB by cgroup accounting (peak 476 MB), lower than the RSS sum because pages are shared. |
| 8 | `~/.claude` unaffected | Same 66 session ids before and after; the `~/.claude` daemon (pid and scope) is the same; `~/.claude/settings.json` has the same hash before and after. `~/.claude-acct-1/settings.json` is still the 22-byte default: step 0 did not write it. |

**Not measured** (step 0 stopped rather than push past a block):

- **The `claim.mjs` hook.** The probe's first request was refused for the weekly limit, so it never ran a tool, and `claim.mjs` is a PostToolUse hook. The statusline and health hooks fired; `claim.mjs` uses the same `--settings` mechanism but was not seen.
- **The folder's own `settings.json`: link versus copy, and write-back.** Writing the SUPERVISOR's `~/.claude-acct-1/settings.json` was refused by the Claude Code auto-mode classifier (it overwrites a file), so the probe took its settings from `--settings` instead. Whether Claude Code writes back to `settings.json` (which a link would share with `~/.claude`), and whether a symlink survives an atomic write, are open. Until that is measured, the setup below copies the file and does not link it.

Also from the SUPERVISOR's setup (comment on ATC-145, 2026-09-29), used in section 4:

- `CLAUDE_CONFIG_DIR=~/.claude-acct-1 claude auth login --claudeai` worked. The first interactive `/login` failed with `Invalid OAuth request: redirect_uri missing`: the long login URL lost its tail when copied from wrapped terminal lines. The host is reached over SSH, so press `c` to copy the URL and paste the code if the browser shows one.
- After `claude auth login`, `claude auth status` said `loggedIn: true`, but the interactive `claude` in that folder still opened the first-run flow. The folder's `.claude.json` had no `hasCompletedOnboarding`. The SUPERVISOR set, by hand, `hasCompletedOnboarding: true`, `lastOnboardingVersion` and `projects["<atc checkout>"].hasTrustDialogAccepted: true`, with a backup. After that the session opened at the prompt. Step 0 found no safer way. It also found that the probe ran from a STAND under the trusted checkout without a trust prompt, so trust for the checkout covers its `.claude/worktrees/` children (a STAND outside the checkout was not tried).

**What Claude Code documents** (checked 2026-09-29): one config folder per account (`CLAUDE_CONFIG_DIR=~/.claude-work claude`), each with its own settings, session history, `.credentials.json` and `.claude.json`; with `CLAUDE_CONFIG_DIR` set the supervisor "runs as a separate instance with its own sessions" ([authentication](https://code.claude.com/docs/en/authentication), [agent view](https://code.claude.com/docs/en/agent-view)). The measurements above agree. Prompt cache is per account (organization), so moving a session to another ACCOUNT starts cold.

## 2. Principles

1. **One config folder per ACCOUNT, one daemon per folder.** The daemon is started by `claude --bg` with `CLAUDE_CONFIG_DIR` set and lives in its own systemd scope, outside `atc.service`, like the `~/.claude` daemon (2026-09-28 OCC a578bf15).
2. **The registry holds a label and a folder, nothing else.** No email, token, organization or plan name is stored or shown in a public place.
3. **atc never reads, copies or prints `.credentials.json`, tokens or the email.** `claude auth status --json` may be read only for `loggedIn` and `authMethod`; every other field is dropped before storing or showing.
4. **Observed, not guessed.** A session's ACCOUNT is the folder its files are found in.
5. **The SUPERVISOR does account setup.** Team sessions never run `/login`, `/logout` or `setup-token`, and never create or delete a config folder.
6. **A live FLIGHT never moves.** ACCOUNT CHANGE only between FLIGHTs, proposed by FLEET PLAN, approved by the SUPERVISOR. Nothing switches automatically.
7. **No `CLAUDE_CODE_OAUTH_TOKEN` per session, no swapping `.credentials.json`.** A background session takes its login from its daemon, so a per-session token does not reach it, atc would hold a secret, and the token cannot do Remote Control or claude.ai connectors. Swapping the file switches every session at once and races token refresh.
8. **Not two-specific.** A list of ACCOUNTS, tested with three.

## 3. Terms

- **ACCOUNT**: a registered label and its config folder. `~/.claude` stays an ACCOUNT, the current `acct-2`.
- **Folder**: the `CLAUDE_CONFIG_DIR` of an ACCOUNT.
- **DESKTOP sessions** follow the app's account and stay out of scope. TERM sessions are out of scope for v1.

## 4. SUPERVISOR setup, once per ACCOUNT

Team sessions do none of this. The label here is `acct-1`; use your own.

1. `mkdir ~/.claude-acct-1`, then `CLAUDE_CONFIG_DIR=~/.claude-acct-1 claude auth login --claudeai`. Press `c` to copy the login URL (a wrapped URL loses its tail and fails with `redirect_uri missing`) and paste the code if the browser shows one. `CLAUDE_CONFIG_DIR=~/.claude-acct-1 claude auth status --json` should say `loggedIn: true`.
2. Finish onboarding: open `CLAUDE_CONFIG_DIR=~/.claude-acct-1 claude` once. If it still shows the first-run screen, the folder's `.claude.json` needs `hasCompletedOnboarding: true` and `lastOnboardingVersion`, with a backup first. Then accept trust for the atc checkout (`projects["<checkout>"].hasTrustDialogAccepted`, or say yes in the dialog). Edit `.claude.json` yourself; agents may not.
3. **Copy, do not link, `settings.json`** (until the write-back question in section 1 is answered): the statusline `hooks/fuel-statusline.mjs`, hooks `claim.mjs` and `health.mjs`, and `env`. Review `env` first: keep `ANTHROPIC_BASE_URL` and proxy values only if this ACCOUNT should use the same route. Copying `agents/`, `skills/` and plugins is safe (they hold no login).
4. **Never share** `.credentials.json` and `.claude.json` between folders. Each carries its own login and its own folder trust. Never share the transcripts, `projects/`, `jobs/`, `sessions/` or `daemon*` files either; they are what tells atc which ACCOUNT a session is on.
5. Check the plan terms for using several subscription accounts this way. atc does not decide that.

## 5. Implementation order (ATC-144 sub-issues)

| # | Step | Needs | Tier |
|---|---|---|---|
| 1 | SURVEY step 0: this measurement and this document (ATC-145) | a logged-in second folder | `auto` (docs) |
| 2 | Registry (`fleet.json` top-level `accounts`: label → folder) and readers over every registered folder: `sources/claude.ts`, `job-state.ts`, `session-control.ts` (`jobs/`), `fuel-run.ts` and `fuel-tree.ts` (`projects/`), `absent-run.ts`, `crew-observed.ts`, `settings.ts` (hook check). A session's ACCOUNT becomes the folder it was found in | 1 | `user` (state format) |
| 3 | LAUNCH, STOP and `claude agents` per ACCOUNT with `CLAUDE_CONFIG_DIR` set (the one variable `cleanEnv()` adds), one daemon per folder outside `atc.service`; ENTRY per ACCOUNT | 2 | `user` (LAUNCH environment) |
| 4 | FLEET PLAN ACCOUNT CHANGE proposal between FLIGHTs: STOP on the full ACCOUNT, then LAUNCH with a CREW BRIEFING on one with headroom | 3 | `user` |

### 5.1 Registry and readers as built (ATC-146)

Step 2 of the table above. Read-only toward Claude Code: nothing is started, stopped or messaged, `.credentials.json` is never opened, and no email, token, organization or plan name is stored.

- **Registry.** `fleet.json` top-level `accounts`: `{ "<label>": { "configDir": "<absolute path>" } }` (`server/accounts.ts`, `validateAccounts`). The label follows `ACCOUNT_RE`. `configDir` must be absolute, without `..`, `.` or doubled `/`, under `$HOME`, and its folder name must start with `.claude`; an existing folder must also resolve under `$HOME` after following symlinks (a symlink out of `$HOME` is refused). Unknown keys in an entry (`email`, `token` …), two labels on one folder and a bad label are refused. A hand-edited file is checked again when read: a bad entry is dropped, never read as a folder. Old files have no `accounts` and read unchanged.
- **`~/.claude` without an entry.** It is always read. It carries the label of the entry that points at it, else `default`.
- **Set in the settings window** (AGENTS tab, ACCOUNTS block; `GET`/`PUT /api/accounts`): SUPERVISOR only, the same Origin check as the other settings writes. The block lists every folder with `loggedIn`/`authMethod` and whether `settings.json` has the atc statusline and the `claim.mjs` and `health.mjs` hooks (a text search, as the claim-hook check always did).
- **Readers over every folder** (`accountFolders()`; nothing assumes one folder): `sources/claude.ts` (sessions, transcript path, ended sessions), `job-state.ts` (`readJob`, with no folder given it tries each `jobs/`), `session-control.ts` (`jobStateOf`, likewise), `fuel-run.ts` and `fuel-tree.ts` (one `FuelTree` and one watch per folder's `projects/`; the cache key is the transcript's absolute path, so the folder is in the key and the same session id in two folders never mixes), `absent-run.ts` (transcript lookup by job id, folder by folder), `crew-observed.ts` (session folders by title, and by the session's own folder). Tested over a temp HOME with three folders (`server/accounts.test.ts`).
- **Observed ACCOUNT.** `Session.account` is the label of the folder its session file was found in. **PILOT'S DISCRETION:** with no registry entry at all (only `~/.claude`), sessions get no `account`, so a machine that never registers anything keeps every existing label as it was; naming that lone folder `default` would have shown `default (home acct-2)` on every row. The first registered entry turns observed labels on for all folders. A session id present in two folders is read from the first one.
- **FUEL** groups a session's statusline records by that observed ACCOUNT (`observeMembers`, [fuel.md](fuel.md) 6.2). The statusline record has no folder field (step 0, row 5), so the session's folder is the key.
- **AIRCRAFT profile `account` is the home ACCOUNT** and is not changed. When a live session runs in another folder the FLEET row and card show `acct-1 (home acct-2)`; it is not an error. LIMIT holds count that AIRCRAFT under the observed ACCOUNT.
- **Folder health.** `claude auth status --json` runs per registered folder with `CLAUDE_CONFIG_DIR` and `cleanEnv()` (10 s timeout, kept 60 s); only `loggedIn` and `authMethod` (a short plain token) are kept, every other field is dropped before storing or sending. A missing piece is a warning on the block (`FUEL blind on acct-1`, `health blind on acct-1`, `claims blind on acct-1`, `not logged in on acct-1`), never a block.
- **Not built (steps 3 and 4).** LAUNCH, STOP and `claude agents` still address `~/.claude` only, and ACCOUNT CHANGE is not proposed. A session on another folder is seen, not controlled from atc.

## 6. Design notes from the measurement

- **Reading**: a per-folder reader is enough. Nothing has to change in the statusline or health hooks, because their records carry `sessionId` and each session's files sit in exactly one folder.
- **Every folder is one scan more**: 66 sessions on `~/.claude`, 1 probe on the second. Cost is per folder, not per ACCOUNT count.
- **Daemon lifetime**: the transient daemon lives while its folder has jobs and exits after the last `claude rm`. LAUNCH on an empty folder starts it again, about 20 s. The `~/.claude` daemon (`--json-path`) is long-lived. STOP alone leaves the daemon up.
- **Memory** is the real limit on ACCOUNT count, not the design. At about 365 MB per extra ACCOUNT (idle) plus about 450 MB per session, and a machine that had about 12 GB free with about 19 GB held by Claude processes ([ATC-144](https://linear.app/vocado/issue/ATC-144/claude-accounts-for-aircraft-one-claude-code-config-folder-per-account), 15:10Z), a third ACCOUNT's fixed cost is small; its sessions are what count. Keep `ATC_MAX_LAUNCHED` machine-wide and add an optional per-ACCOUNT cap.
- **Cold cache** on every ACCOUNT CHANGE: prompt cache is per organization.

## 7. Risks

| Risk | Answer |
|---|---|
| A link shares `settings.json` writes between ACCOUNTS, or a write replaces the link | Copy, not link, until measured; the setup steps say so |
| `claim.mjs` not yet seen under a second daemon | Measure it on the first ACCOUNT with headroom, before step 3 relies on it |
| The second ACCOUNT can be at its plan limit, which the first measurement hit | FUEL REMAINING per ACCOUNT and `holdPct` already cover it; an ACCOUNT CHANGE proposal must pick an ACCOUNT below `holdPct` |
| Onboarding needs a hand edit of `.claude.json` | SUPERVISOR-only setup; do not automate |
| A wrapped login URL fails | Setup step 1: press `c` |
| A second transient daemon inside `atc.service` would die on every deploy | Always launch through the scope, as `launchCommandOf` does |
| Probing or stopping the wrong daemon | STOP only by job id with the folder's variable set; never touch `~/.claude`'s daemon (2026-09-29 pkill outage) |
| Transcripts of removed jobs stay in the folder | `claude rm` keeps `projects/`; FUEL and crew readers treat them like any ended session |
| Plan terms | SUPERVISOR decision, not atc's |

## 8. Decisions for the SUPERVISOR

1. **Copy or link `settings.json`?** Recommended: copy, until write-back is measured (needs a second folder with headroom, or a folder write this step was not allowed to make). If you want the link, allow the measurement first.
2. **Second ACCOUNT's limit.** The second ACCOUNT's weekly window read 100 % when measured, so no model call ran on it and `claim.mjs` was not seen. Decide whether to re-measure after it resets (its `resets_at` in the statusline record was the 3rd of October, 03:00 UTC) or to accept the gap.
3. **Go / no-go for step 2** given the memory numbers and the plan terms.
