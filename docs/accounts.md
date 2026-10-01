# ACCOUNTS: AIRCRAFT on more than one Claude account

Status (2026-09-29): design draft for [ATC-144](https://linear.app/vocado/issue/ATC-144/claude-accounts-for-aircraft-one-claude-code-config-folder-per-account), with the step 0 measurements from [ATC-145](https://linear.app/vocado/issue/ATC-145/accounts-step-0-measure-a-second-claude-code-config-folder-on-this). Nothing here is built. Step 0 changed no code and no setting. The second folder was measured with one probe session; two things it could not measure are listed in "Not measured".

**More than Claude logins** (Codex, OpenCode Go, API-key plans): the registry `provider`, the write-only API key and FUEL for API-key plans are in the design draft [account-providers.md](account-providers.md) (ATC-241). Nothing there is built.


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
3. **atc never reads, copies or prints `.credentials.json`, tokens or the email.** `claude auth status --json` may be read only for `loggedIn` and `authMethod`; every other field is dropped before storing or showing. One exception (SUPERVISOR decision A, 2026-09-30, ATC-187): right after a LOGIN from the page, atc reads that folder's `.claude.json` in memory only to merge three onboarding fields back into it. It never stores, logs, sends or shows any value from that file.
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

### ADD ACCOUNT as built (ATC-186)

Steps 1 (the folder), 3 (the settings) and the registry entry can be done from the settings window: ACCOUNTS section, **ADD ACCOUNT** (`GET`/`POST /api/accounts/add`, `server/account-add.ts`). Login and onboarding stay in the terminal; the page lists them after the folder is ready.

- **Form.** A label (`ACCOUNT_RE`) and a folder, `~/.claude-<label>` unless another path is typed (the `checkConfigDir` rules). When `~/.claude` is not registered yet, a second field registers it in the same save, prefilled with the label most used by the FLEET profiles and control sessions; without it every `~/.claude` session would read `default (home acct-2)` once the first entry exists.
- **Folder.** Created with mode 0700 when missing; an existing folder is used as is. A path that exists but is not a folder is refused.
- **Settings.** `~/.claude/settings.json` is copied whole (statusline, hooks, permissions, `env` …) and written with mode 0600 through a temp file and rename. The page gets `env` **key names only**, never values, and each key can be left out (proxy and `ANTHROPIC_BASE_URL` only when this ACCOUNT should take the same route). A folder whose `settings.json` has its own `hooks`, `statusLine`, `env`, `permissions` or `apiKeyHelper`, is unreadable JSON, or is a symlink is kept as is and only registered. A trivial one (the measured `{ "theme": "auto" }`) is backed up next to it (`settings.json.atc-bak-<time>`, 0600) and replaced.
- **Register last.** The registry is written only after the folder and the settings are done; a refused request writes nothing. Only `settings.json` is read or written: `.credentials.json` and `.claude.json` are never opened, and `claude auth status` stays filtered to `loggedIn` and `authMethod`. SUPERVISOR only (the same Origin check as `PUT /api/accounts`).
- **After.** The page shows what it did and the remaining steps: `CLAUDE_CONFIG_DIR=<folder> claude auth login --claudeai` (with a copy button; skipped when the folder row already reads LOGGED IN) and onboarding (step 2 above). The folder row then shows LOGGED IN and the statusline and hook checks.
- **Login and onboarding from the page:** see "LOGIN as built" below.

### LOGIN as built (ATC-187)

Setup steps 1 (login) and 2 (onboarding) from the settings window: a **LOGIN** button on every registered folder row that reads NOT LOGGED IN (`server/account-login.ts`; `GET`/`POST`/`DELETE /api/accounts/<label>/login`, `POST /api/accounts/<label>/login/code`).

**Measured first** (2026-09-30, Claude Code 2.1.285, no TTY, the same clean environment atc uses, an empty temp folder, login not completed):
- `claude auth login --claudeai` runs without a terminal. It prints `If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?…` on stdout, then `Paste code here if prompted >`, and reads the code from stdin.
- The `redirect_uri` is `https://platform.claude.com/oauth/code/callback`, a page that shows the code. A browser on another machine (the SUPERVISOR's Mac) works: copy the code back.
- It also opens a `127.0.0.1:<random>` listener for a browser on the same machine; atc doesn't use it.
- The flow uses PKCE (`code_challenge`), so the code is useless without the verifier held by that process.
- `--email` only pre-fills the login page; atc doesn't take an email.
- The folder's `.claude.json` is created at start without `hasCompletedOnboarding`, so login alone leaves the first-run screen.

**How it works.**
- **Refusals.** Only a registered folder that is not `~/.claude` (its login is the one every running session uses) and not already LOGGED IN.
- **Start.** atc spawns `claude auth login --claudeai` with `cleanEnv(folder)`, one process per folder, stopped after 10 minutes. The page shows the login URL only if it is `https` on a Claude or Anthropic host with an `/oauth/authorize` path.
- **Code.** The SUPERVISOR logs in in the browser and pastes the code. The code must match `[A-Za-z0-9._~#-]{8,2048}`. It is written to the process stdin and nowhere else: not stored and not logged.
- **Output stays on the server.** The process output is used only to find the URL; it is never sent to the page, because it can name the account. Errors are fixed sentences.
- **Result.** When the process ends, `claude auth status` is read again (still only `loggedIn` and `authMethod`).
- **Onboarding (SUPERVISOR decision A).** After a successful login, atc merges three things into that folder's `.claude.json` and changes no other field:
  - `hasCompletedOnboarding: true`;
  - `lastOnboardingVersion` (from `claude --version`);
  - `projects[<path>].hasTrustDialogAccepted: true` for every open AIRPORT path.

  The old file is backed up (`.claude.json.atc-bak-<time>`, 0600) and the new one written 0600 through a temp file. A symlink or a file that isn't a JSON object is left alone, and the row says to open `claude` once in that folder.
- **The page.** The row shows the URL link, a code field, and CANCEL. Reloading the page picks the running LOGIN back up. After success the row reads LOGGED IN with the onboarding result.
- **Not measured.** Whether a first `claude --bg` LAUNCH would skip the first-run screen by itself. The onboarding fields make the question moot for folders logged in from the page. A folder logged in from the terminal still needs `claude` opened once, as before.

### Memory as built (ATC-191)

Claude Code keeps its auto-memory under the config folder: `<configDir>/projects/<cwd key>/memory/`, where the key is the working directory with every non-alphanumeric character turned into `-`. Every ACCOUNT folder therefore had its own copy, and a session LAUNCHed or moved onto `acct-1` started without what the `~/.claude` sessions had learned. **SHARE MEMORY** links them (`server/account-memory.ts`; `GET`/`POST /api/accounts/memory`).

**Which mechanism.** Claude Code 2.1.285 has a setting `autoMemoryDirectory` (userSettings, ignored in the checked-in project settings). It names **one** directory and replaces the per-project path, so it would mix every project's memory into one folder. atc uses a symlink per project key instead: `<acctDir>/projects/<key>/memory` → `~/.claude/projects/<key>/memory`. `~/.claude` is the source because it holds the working memory (PILOT'S DISCRETION).

**Not measured.** Whether a model session on an ACCOUNT reads through the symlink and writes new memories into the shared folder was not measured: it needs a model call on a real ACCOUNT folder, and the team may not write into those. The SUPERVISOR can check once after SHARE MEMORY: in a session on `acct-1`, ask it to save a throwaway memory, then look for the new file under `~/.claude/projects/<key>/memory/`. A directory symlink is an ordinary path to the OS, so the expectation is that it works.

- **Keys.** The atc checkout and the paths of the AIRPORTs that are not closed (with the resolved path too, when a path is itself a symlink). Worktree sessions have their own keys and are not linked.
- **Plan (pure, `memoryPlanOf`).** For each registered folder other than `~/.claude` and each key:
  - no memory directory, or an **empty** one → make the link (the empty directory is removed first);
  - already a link → left alone (a link to somewhere else too);
  - a directory with files, or something that is not a directory → **conflict**: never replaced. Only file names are listed.
- **Never lose a memory.** The IO part reads directory and file **names** only, never contents, and never opens `.credentials.json` or `.claude.json`. It looks again right before each link and removes an empty directory with `rmdir` only, which fails if a file appeared meanwhile. A missing source directory is created so that memories written later are shared too.
- **Settings window.** Each folder row in ACCOUNTS shows `MEMORY shared ✓`, `MEMORY separate` or `MEMORY conflict` and, unless shared, a **SHARE MEMORY** button (SUPERVISOR only, the same Origin check). A conflict lists the key and the file names; the SUPERVISOR merges them by hand, removes the folder, and the next SHARE MEMORY links it.
- **ADD ACCOUNT** runs the same link step for the new folder after the registry is saved; a failure there leaves the folder and the registration as they are (the result carries `memory: null`).
- **This machine.** `acct-1` (empty memory directory) and `acct-3` (none yet) are linked only when the SUPERVISOR presses SHARE MEMORY. Nothing here touches the real folders.

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
- **Set in the settings window** (ACCOUNTS section, the AGENTS tab before ATC-189; `GET`/`PUT /api/accounts`): SUPERVISOR only, the same Origin check as the other settings writes. The block lists every folder with `loggedIn`/`authMethod` and whether `settings.json` has the atc statusline and the `claim.mjs` and `health.mjs` hooks (a text search, as the claim-hook check always did).
- **Readers over every folder** (`accountFolders()`; nothing assumes one folder): `sources/claude.ts` (sessions, transcript path, ended sessions), `job-state.ts` (`readJob`, with no folder given it tries each `jobs/`), `session-control.ts` (`jobStateOf`, likewise), `fuel-run.ts` and `fuel-tree.ts` (one `FuelTree` and one watch per folder's `projects/`; the cache key is the transcript's absolute path, so the folder is in the key and the same session id in two folders never mixes), `absent-run.ts` (transcript lookup by job id, folder by folder), `crew-observed.ts` (session folders by title, and by the session's own folder). Tested over a temp HOME with three folders (`server/accounts.test.ts`).
- **Observed ACCOUNT.** `Session.account` is the label of the folder its session file was found in. **PILOT'S DISCRETION:** with no registry entry at all (only `~/.claude`), sessions get no `account`, so a machine that never registers anything keeps every existing label as it was; naming that lone folder `default` would have shown `default (home acct-2)` on every row. The first registered entry turns observed labels on for all folders. A session id present in two folders is read from the first one.
- **FUEL** groups a session's statusline records by that observed ACCOUNT (`observeMembers`, [fuel.md](fuel.md) 6.2). The statusline record has no folder field (step 0, row 5), so the session's folder is the key.
- **AIRCRAFT profile `account` is the home ACCOUNT** and is not changed. When a live session runs in another folder the FLEET row and card show `acct-1 (home acct-2)`; it is not an error. LIMIT holds count that AIRCRAFT under the observed ACCOUNT.
- **Folder health.** `claude auth status --json` runs per registered folder with `CLAUDE_CONFIG_DIR` and `cleanEnv()` (10 s timeout, kept 60 s); only `loggedIn` and `authMethod` (a short plain token) are kept, every other field is dropped before storing or sending. A missing piece is a warning on the block (`FUEL blind on acct-1`, `health blind on acct-1`, `claims blind on acct-1`, `not logged in on acct-1`), never a block.
- **Not built here.** LAUNCH, STOP and `claude agents` per ACCOUNT are step 3 (5.2); ACCOUNT CHANGE proposals (step 4) are not built.

### 5.2 LAUNCH per ACCOUNT as built (ATC-147)

Step 3. Tested without launching a real session: the launch plans are pure functions, and the `claude agents` reads are tested against a fake `claude` script in a temp HOME with three folders (`server/accounts-launch.test.ts`).

- **Environment.** `cleanEnv(configDir)` (`server/clean-env.ts`) adds `CLAUDE_CONFIG_DIR` and nothing else when the folder is not `~/.claude`. With no folder, or `~/.claude`, the environment is exactly what it was; secrets still don't pass. `launchCommandOf` is unchanged, so every ACCOUNT's daemon starts in its own `systemd-run --user --scope` outside `atc.service`. `daemonCgroups` already lists every `claude daemon run` on the machine whatever its folder, so the daemon-in-service check covers all daemons.
- **Which ACCOUNT** (`launchAccountOf`, pure). With no registry entry nothing changes (and naming an ACCOUNT is refused: "register it first"). Otherwise the request's `account` (`POST /api/fleet/:registration/launch`, `POST /api/control/:name/launch`, SUPERVISOR only), else the AIRCRAFT's profile `account` or the control session's `control` label. **PILOT'S DISCRETION:** a home label that is not in the registry goes to `~/.claude`, as before. An ACCOUNT that `claude auth status` says is not logged in, or that FUEL puts at the hold level (`holdPct`, whatever the D3 switch says, as FLEET PLAN does), is refused with its reason; login unknown (`null`) does not block. Naming another ACCOUNT does not bypass either check, and the home ACCOUNT at hold is refused too (choosing another one is the SUPERVISOR's call).
- **The LAUNCH panel** on the FLEET card has an ACCOUNT picker when accounts are registered (`GET /api/fleet/launch-accounts`): refused ACCOUNTs are shown disabled with the reason (not logged in, FUEL hold, ACCOUNT cap reached). The control-session LAUNCH takes `account` in the API; its FLEET row has no picker yet (it uses the `control` label).
- **`claude agents --json` per folder** (`agentRowsOf`): each folder is read with its own `CLAUDE_CONFIG_DIR`, rows are merged and tagged `account`. `~/.claude` is always read (a failure still throws). **PILOT'S DISCRETION:** another folder is read only while its daemon is up (`daemon.status.json` `supervisorPid` alive with a `daemon` command line). An unscoped `claude agents` in a folder without a daemon could start one inside `atc.service`, which the scope rule exists to prevent; a folder without a daemon has no jobs anyway. A folder whose read fails is listed in `failed`; a LAUNCH onto it is refused ("session list unreadable") and every other LAUNCH goes on. The 30 s cache keeps its shape (one merged list); `stop` and the job-state reads use the session's own folder (`configDirOfRow`, `jobStateOf` with that folder's `jobs/`).
- **STOP** runs `claude stop <id>` with the row's folder. **RESUME after LIMIT** (ATC-129) reads the ACCOUNT from the AIRCRAFT's last atc LAUNCH in the FLIGHT RECORDER (`account` on the record) and launches there, so it stays on the same ACCOUNT. No `respawn` call exists in atc; if one is added it takes the row's folder the same way.
- **Caps.** `ATC_MAX_LAUNCHED` stays machine-wide (control sessions excluded, as before). The registry entry may carry `maxLaunched` (1–100, off by default; the ACCOUNTS block has a field for it): background AIRCRAFT sessions read from that ACCOUNT's folder, STALE rows excluded.
- **ENTRY** ([fleet.md](fleet.md) 8.6): with accounts registered, FLEET PLAN ENTRY names the ACCOUNT the new AIRCRAFT would fly on and sets it as the new profile's `account`.
- **Live check.** None was needed; no session was launched, stopped or messaged. The 7713 test server ran with a fake `claude` binary, a temp HOME and a fake daemon process.

### 5.3 ACCOUNT CHANGE as built (ATC-148)

Step 4. FLEET PLAN proposes moving an AIRCRAFT to an ACCOUNT with headroom. It stops and launches sessions, so it happens only when the SUPERVISOR approves; **no automatic mode exists, not even behind a switch** (an automatic mode would be a separate SUPERVISOR decision). The rule, expiry and execution are in [fleet.md](fleet.md) 8.6 ("ACCOUNT CHANGE as built"); the FUEL label is [fuel.md](fuel.md) 6.3.

- **What it proposes.** Between FLIGHTs only, and never a live FLIGHT: idle background session, no FLIGHT held or kept, no open PR, not given a FLIGHT. A limit cut mid-FLIGHT stays RESUME on the same ACCOUNT. Reason: the observed ACCOUNT at `holdPct`, or a LIMIT with more than 60 min to its reset (`accountChangeLimitMin`), or a way back to home once home is below `infoPct`. Target: a registered ACCOUNT not known to be logged out, below `infoPct` and under `maxLaunched`, lowest use.
- **On approve**: STOP on the old ACCOUNT's folder, LAUNCH with the CREW BRIEFING on the new one (the new ACCOUNT's login and FUEL are checked before anything is stopped), one `account-change` FLIGHT RECORDER event. The profile's home ACCOUNT is unchanged and the card reads `flying on acct-1 (home acct-2)`. On 반대 or expiry nothing happens.
- **PILOT'S DISCRETION.** (1) Only background sessions atc can stop are proposed; a desktop or terminal session gets no ACCOUNT CHANGE. (2) The way back to home is proposed whenever home is below `infoPct` and the AIRCRAFT is between FLIGHTs, even if the ACCOUNT it is on has room (the SUPERVISOR can 반대; a decided proposal rests 24 h). (3) With a target available, a weekly LIMIT alone no longer proposes AOG. (4) The pre-check before STOP means a refused target returns 409 and the old session keeps running.
- **Tests** are fixtures only (`server/fleet-plan.test.ts`, `server/fuel-leaks.test.ts`, `server/accounts.test.ts`); nothing was stopped or launched.

### 5.4 LAUNCH ACCOUNT as built (ATC-239)

One choice in the settings window for everything that starts next, instead of editing every FLEET card or picking the ACCOUNT in every LAUNCH panel (SUPERVISOR decisions 2026-09-30): **a default switch, not a bulk edit.** Each AIRCRAFT's home (`fleet.json` profile `account`) stays as it is; the setting only changes which ACCOUNT the next LAUNCH uses, and "each home" is today's behaviour. Two dropdowns: one for AIRCRAFT (team sessions), one for control sessions (`launchControl`).

- **Setting.** An optional top-level `fleet.json` key `launchAccount: { aircraft?: "<label>", control?: "<label>" }` (`server/launch-account.ts`, pure; written atomically by `saveLaunchAccount`, like the other `fleet.json` writers). `loadFleet` keeps only well-formed labels. A label that is no longer registered has no effect (the LAUNCH falls back to home) and shows as a warning on the FLEET header and in the settings block.
- **LAUNCH order** (`launchAccountOf`): the ACCOUNT named in the request → the LAUNCH ACCOUNT of that kind → home (profile `account`, or the control session's label) → `~/.claude`. The existing refusals apply to whichever ACCOUNT was chosen, and nothing falls back to another ACCOUNT silently: a LAUNCH ACCOUNT that is logged out or at FUEL hold refuses the LAUNCH with its reason. A request that names an ACCOUNT still wins: the LAUNCH panel picker, ACCOUNT CHANGE approve, RESUME after a limit (it names its ACCOUNT), and CONTROL RECYCLE (it relaunches on the ACCOUNT the session was on). **Running sessions never move**; that stays ACCOUNT CHANGE, approved per AIRCRAFT.
  - *Fix (ATC-245).* LAUNCH on approve of a DISPATCH card for an ABSENT AIRCRAFT used to name the ACCOUNT of that AIRCRAFT's last LAUNCH, so it beat the LAUNCH ACCOUNT (2026-09-30: approved cards went to the old ACCOUNT at FUEL hold and were refused). Now only a RESUME card names its ACCOUNT; any other approved card passes the last ACCOUNT as a `fallback`, so the order there is LAUNCH ACCOUNT → last LAUNCH's ACCOUNT → home. An unregistered fallback is ignored.
- **FLEET PLAN** (`fleet-plan.ts`; the rule is in [fleet.md](fleet.md) "ACCOUNT CHANGE as built"). While the AIRCRAFT LAUNCH ACCOUNT is set and registered it is the effective home: no "way back to home" proposal toward the profile home, and "way back" means back to the LAUNCH ACCOUNT; an ENTRY names the LAUNCH ACCOUNT for the new AIRCRAFT and is blocked with a reason (not sent elsewhere) when that ACCOUNT is logged out or at hold; the FUEL hold check for a LAUNCH or ENTRY proposal reads the LAUNCH ACCOUNT's FUEL. The REPOSITION pre-check for an unnamed relaunch uses it too.
- **Routes.** `PUT /api/fleet/launch-account` with `{aircraft?, control?}`; only the keys present change; `null` or `""` clears one ("each home"); a label must be registered (409), unknown keys and empty bodies are 400. It is SUPERVISOR only (`fromThisApp`: a localhost `Origin` **and** `Content-Type: application/json`; a request without the JSON content type is refused with 403 like every other settings write, ATC-238). `GET /api/fleet/launch-accounts` also returns `launchAccount` (only registered labels) and `launchAccountWarnings`; `GET /api/fleet` returns `launchAccount` for the FLEET header.
- **Screens.** Settings window, ACCOUNTS: two dropdowns "LAUNCH ACCOUNT — AIRCRAFT" and "— 관제 세션" with "각 home (프로필)" and every registered ACCOUNT; an ACCOUNT with a refusal (not logged in, FUEL hold, `maxLaunched` reached) is disabled with its reason, as in the LAUNCH panel; one line says it applies to the next LAUNCH only. FLEET LAUNCH panel preselects the LAUNCH ACCOUNT (`(LAUNCH ACCOUNT)` next to its name; an ACCOUNT is sent only when the SUPERVISOR picks a different one). The FLEET header shows `LAUNCH ACCOUNT acct-3` (and the control one) while the setting is on; the card keeps `flying on acct-3 (home acct-2)`.
- **Format tolerance.** `launchAccount` is a new optional top-level key. The previous build's `loadFleet` builds its result from the keys it knows and ignores the rest, its `accounts.ts` reader reads only `accounts`, and every writer (`saveAccounts`, `saveControlAccount`, `saveAircraft`) rewrites the raw file, so a rollback reads the file and **keeps** the key. A test pins both directions, including an unknown future key (`server/launch-account.test.ts`). So the PR stays `flagged`, not `user`.
- **PILOT'S DISCRETION.** (1) The setting does not change RESTART or REFRESH relaunches' ACCOUNT selection rule: they do not name an ACCOUNT, so with the setting on they relaunch on the LAUNCH ACCOUNT like any unnamed LAUNCH. (2) Disabled options in the settings dropdown keep the currently saved value selectable, so an ACCOUNT that later hits FUEL hold does not make the saved choice unreadable. (3) The FLEET PLAN ENTRY check blocks instead of falling back when the LAUNCH ACCOUNT is refused, to match "refusals apply to the chosen ACCOUNT".
- **Tests** are temp state, fake `claude` and temp HOME only (`server/launch-account.test.ts`, `server/launch-account-route.test.ts`, `server/accounts-launch.test.ts`, `server/fleet-plan.test.ts`); nothing was launched, stopped or messaged.

### 5.5 APPLY NOW as built (ATC-244)

LAUNCH ACCOUNT (5.4) only steers the next LAUNCH. On 2026-09-30, with acct-2 at FUEL hold, the SUPERVISOR moved four control sessions by hand (change the ACCOUNT, STOP, LAUNCH each). A running Claude Code session is bound to its config folder and `--resume` fails across folders, and switching mid-session by swapping credentials in a proxy is what principle 7 rejects for subscriptions. So "apply" means **STOP + LAUNCH, as one confirmed click that does those steps safely**: an **APPLY NOW** button beside the LAUNCH ACCOUNT dropdowns (settings window, ACCOUNTS) and in the FLEET header note. Nothing moves without the click.

- **Plan** (`applyNowPlanOf`, pure, `server/apply-now.ts`). One row per running session that is not on the LAUNCH ACCOUNT of its kind (a kind set to "각 home" has no rows). Each row has one action:
  - `move-now`: a background AIRCRAFT that passes the ACCOUNT CHANGE between-FLIGHTs test (idle, no FLIGHT held or kept, no open PR, not given a FLIGHT in this DISPATCH plan, not launched within `minDwellMin`, not a `LIMIT` cut), or a control session at a safe moment (`safeBlocksOf` with the job between turns, the same test as CONTROL RECYCLE; OCC through `occSafetyOf`).
  - `after-flight`: an AIRCRAFT that fails one of those tests. `wait-safe`: a control session that is not at a safe moment.
  - `skip` with a reason: desktop or terminal sessions (atc cannot stop them; ENGINEERING), AOG, a control session not started with `claude --bg`, and a target ACCOUNT that refuses (not logged in, FUEL hold, not registered, `maxLaunched` reached counting this batch).
- **Execute** (`runApplyRows`, `server/apply-now-run.ts`). One session at a time, and the plan is **read again before each STOP**, so a FLIGHT or PR that appeared since the confirm is never stopped. It stops at the first failure and leaves the rest running on the old ACCOUNT. No new STOP path: AIRCRAFT go through the ACCOUNT CHANGE executor (`moveAircraftAccount`: target pre-check before any STOP, STOP, LAUNCH with the CREW BRIEFING and the last LAUNCH's permission mode and model on the target), control sessions through `performRecycle` with the target ACCOUNT instead of `row.account` (`applyNowControl`, under the same one-at-a-time lock as CONTROL RECYCLE). It does not depend on the DISPATCH LAUNCH-on-approve path.
- **Pending.** `after-flight` and `wait-safe` rows are not dropped. `apply-now.json` in the state folder keeps `{at, aircraft, control}` (only the kinds that still had waiting rows), and the one-minute tick next to CONTROL RECYCLE moves them as they become safe. It ends when nothing is left waiting, when the LAUNCH ACCOUNT of that kind changed, after 24 hours, or on the SUPERVISOR's cancel (`DELETE /api/fleet/apply-now/pending`). A failed move ends it too: a retry needs another click.
- **Routes.** `GET /api/fleet/apply-now` (plan, read only). `POST /api/fleet/apply-now` needs `{confirm: true, launchAccount}` where `launchAccount` must equal the current setting (409 otherwise: what was confirmed is what runs), is SUPERVISOR only (`fromThisApp`, JSON Content-Type), and runs one at a time (409 while running).
- **FLIGHT RECORDER.** `account-change` per AIRCRAFT (`by` SUPERVISOR, or `APPLY NOW (pending)` from the tick), the usual `recycle` line per control session (reason `APPLY NOW: a → b`), and one `apply-now` summary (`op apply`: `by`, the two targets, counts of moved, failed, waiting, skipped; `op pending-end` with a note).
- **Screen.** The confirm lists the rows grouped as "지금 옮김", "FLIGHT 뒤에 옮김", "안전한 순간을 기다림", "옮기지 않음", says that every moved session starts with a **cold prompt cache** (FUEL cost), shows per-row results after the run, and a line for a pending APPLY with a cancel.
- **DUTY** is not stopped. [ATC-242](https://linear.app/vocado/issue/ATC-242/duty-account-in-the-settings-window-pick-the-account-duty-runs-on) (DUTY's ACCOUNT in the settings window) is not part of this change, so the confirm says DUTY's ACCOUNT is changed in its own block.
- **PILOT'S DISCRETION.** (1) `after-flight` is **pending for 24 hours** (the issue's recommendation), persisted in `apply-now.json`; `wait-safe` rides the same record. (2) A kind whose LAUNCH ACCOUNT is "각 home" has no rows; APPLY NOW never moves sessions back to their profile homes. (3) The POST carries the confirmed `launchAccount` and is refused when it changed. (4) A failed move ends the pending APPLY (no silent retry loop). (5) New state file `apply-now.json`; nothing existing changes shape, and a previous build ignores it.
- **Tests** (`server/apply-now.test.ts`): the plan per row type and refusal, ordering, pending expiry, and the executor with fake move deps (re-plan before each move, stop at the first failure, one kind only). No real session is stopped; the confirm was checked on a 7702 test server with a temp state folder.

### 5.6 Cross-ACCOUNT delivery as built (ATC-251)

With LAUNCH ACCOUNTs split (AIRCRAFT `acct-1`, control sessions `acct-3`), OCC could not reach its AIRCRAFT and every FLIGHT PLAN went undelivered, found only by a failed send.

- **Probe (2026-10-01, TEAM_E on `acct-1`).** `ListAgents` from a session on `~/.claude-acct-1` listed 12 peers (OCC, MCC, TOWER, CROSSCHECK, REVIEW, TEAM_A–D, H, I, M), all of them sessions whose files are under `~/.claude-acct-1/sessions/`. TEAM_L, a background session on `~/.claude-acct-3` (idle, own socket), and an interactive session on `acct-3` were **not listed**, so a name-addressed `SendMessage` cannot find them. Each session file carries a `messagingSocketPath` in the shared `/run/user/1000/cc-socks/` and a `peerFeatures` list (`reply_across_default_dirs`, which this probe did not exercise), so the sockets are not folder-private, but the name lookup that `SendMessage` uses is. Not tried: sending to the other folder's session (team sessions are not messaged during a probe) and talking to the socket directly (not a supported path, and `occ/send-guard.mjs` allows only `SendMessage`). **Result: cross-ACCOUNT delivery by name does not work; the supported answer is to keep OCC and the AIRCRAFT it sends to on one ACCOUNT.**
- **Rule** (`server/account-reach.ts`, pure). Unreachable when the sender's and the receiver's *observed* ACCOUNT (the folder the session's files are in) are both known and differ. An unknown ACCOUNT never blocks.
- **Warnings.** (1) Settings window and `GET /api/fleet/launch-accounts` / `PUT /api/fleet/launch-account`: `LAUNCH ACCOUNT가 갈라졌다(AIRCRAFT acct-1, 관제 세션 acct-3)` when both kinds are set and differ (the setting is still saved). (2) FLEET header (`launchAccount.warnings`): the same line, plus `OCC(ACCOUNT x)가 닿지 못하는 AIRCRAFT: TEAM_H(y), …` for running AIRCRAFT on another ACCOUNT than OCC. (3) DISPATCH card: an open or approved ASSIGN whose AIRCRAFT is on another ACCOUNT than OCC shows `ACCOUNT 불일치 — …` in the card's waiting chip (`waitingOf`).
- **Refusal.** `POST /api/dispatch/proposals/<id>/release` (`atcctl dispatch release`) answers 409 with the reason and records nothing, for a first send and for a resend, so no FLIGHT PLAN is produced that cannot be delivered. A `launch` card is exempt (the LAUNCH carries the FLIGHT PLAN as the first prompt, on the LAUNCH ACCOUNT).
- **Unchanged.** APPLY NOW (5.5), `occ/send-guard.mjs` and every guard. The fix for a refusal is to move one side (ACCOUNT CHANGE for the AIRCRAFT, APPLY NOW, or set both LAUNCH ACCOUNTs to the same label).
- **PILOT'S DISCRETION.** A split setting warns but is not refused (the SUPERVISOR may be mid-move: APPLY NOW moves one kind at a time). The refusal looks at observed sessions, not at settings, so a stale setting alone never blocks a send.

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
| Onboarding needs a hand edit of `.claude.json` | After a page LOGIN atc merges the three fields (ATC-187, decision A); a terminal login still needs `claude` opened once |
| A wrapped login URL fails | Setup step 1: press `c` |
| A second transient daemon inside `atc.service` would die on every deploy | Always launch through the scope, as `launchCommandOf` does |
| Probing or stopping the wrong daemon | STOP only by job id with the folder's variable set; never touch `~/.claude`'s daemon (2026-09-29 pkill outage) |
| Transcripts of removed jobs stay in the folder | `claude rm` keeps `projects/`; FUEL and crew readers treat them like any ended session |
| Plan terms | SUPERVISOR decision, not atc's |

## 8. Decisions for the SUPERVISOR

1. **Copy or link `settings.json`?** Recommended: copy, until write-back is measured (needs a second folder with headroom, or a folder write this step was not allowed to make). If you want the link, allow the measurement first.
2. **Second ACCOUNT's limit.** The second ACCOUNT's weekly window read 100 % when measured, so no model call ran on it and `claim.mjs` was not seen. Decide whether to re-measure after it resets (its `resets_at` in the statusline record was the 3rd of October, 03:00 UTC) or to accept the gap.
3. **Go / no-go for step 2** given the memory numbers and the plan terms.
