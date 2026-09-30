# ACCOUNT PROVIDERS: a provider per ACCOUNT (claude · codex · OpenCode Go)

Status (2026-09-30): design draft for [ATC-241](https://linear.app/vocado/issue/ATC-241/account-providers-design-draft-docsaccount-providersmd-a-provider-per). Nothing here is built. It folds in the ChatGPT / Codex survey ([ATC-237](https://linear.app/vocado/issue/ATC-237/survey-chatgpt-accounts-in-atc-run-several-codex-cli-logins-one-codex), [research/chatgpt-codex-accounts.md](research/chatgpt-codex-accounts.md) 8.2, steps C1–C7) and adds **AIRCRAFT sessions whose main model runs on OpenCode Go**, so the registry shape is decided once. The base is [accounts.md](accounts.md) (ACCOUNTS for several Claude logins, built) and [fuel.md](fuel.md) (FUEL REMAINING).

This step changed no code, setting, `~/.claude*`, `~/.codex*`, ClaudeRipple or opencodex file. **No model call was made on OpenCode Go and no key was read.** Two config files were read for key names and non-secret fields only (section 1). What needs a real key is in "Not measured" (section 8) with the command for the SUPERVISOR.

## 1. Current facts

**atc** (read from the code and [accounts.md](accounts.md), 2026-09-30):

- Registry: `fleet.json` `accounts` = `{ "<label>": { configDir, maxLaunched? } }` (`server/accounts.ts`, `AccountsRegistry`). `checkConfigDir` accepts only a folder whose name starts with `.claude`. Unknown keys in an entry are refused.
- 38 call sites read `accountFolders()` (`grep`, non-test `server/*.ts`). Every one assumes Claude Code: `sessions/`, `jobs/`, `projects/`, `claude agents --json`, `claude auth status`, `claude --bg`.
- [accounts.md](accounts.md) principles 2 (registry is label and folder only), 3 (atc never reads, copies or prints credentials), 7 (no per-session token, no swapping the credential file). ADD ACCOUNT copies `~/.claude/settings.json` and shows `env` **key names only**. LAUNCH ACCOUNT ([accounts.md](accounts.md) 5.4) is a default switch over registered labels.
- FUEL REMAINING per ACCOUNT comes from the statusline `rate_limits` (Pro/Max logins). An ACCOUNT with no record reads "unknown", never 0 % ([research/claude-usage-accounts.md](research/claude-usage-accounts.md) 8). API key, Bedrock and Vertex sessions report no plan limits ([fuel.md](fuel.md) 6.1).

**This machine** (checked 2026-09-30, key names only; values were not printed):

- `~/.claude/settings.json` has top-level keys including `env`, `model`, `hooks`, `statusLine`, `permissions`. Its `env` has the keys `HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`. `HTTPS_PROXY` points at a loopback port, and something is listening on `127.0.0.1:8790` (`ss`). So sessions on this ACCOUNT already go through **ClaudeRipple** ([github.com/PBJ-2/clauderipple](https://github.com/PBJ-2/clauderipple)).
- `~/.clauderipple/config.json` has the keys `listen`, `upstream`, `providers`, `routes`, `direct`, `aliases`, `effortClamp`, `cli`, `health`, `log`, `picker`. `providers.opencode-go` has `type`, `url`, `preset`, `sessionHeader`, `wire`, `identity`, `caps` (`effortLevels`, `reasoning`), `headers` (the place the key sits: **not read**), and `models[]` with `id`, `name`, `wire`. Model ids `deepseek-v4.1-flash` and `muse-spark-1.3-contributor` are listed; the `wire` per model is `responses` or `chat` (the issue's 2026-09-30 reading; this draft did not re-read the values). What `routes`, `direct` and `aliases` contain was not opened.
- `~/.claude/agents/` has `flash-helper.md` (frontmatter `model: deepseek-v4.1-flash@high`), `deepseek-v4-1-flash.md`, `muse-spark-1-3-contributor.md` and `ocx-*.md`. Subagents already run on OpenCode Go through ClaudeRipple today. No whole **session** does.
- `~/.codex/opencodex.config.toml` routes Codex through the local opencodex provider; those rollouts carry no `rate_limits` ([research/chatgpt-codex-accounts.md](research/chatgpt-codex-accounts.md) 2.2).
- `secret-tool` (libsecret-tools) is **not installed**; `gnome-keyring-daemon` is, and `/run/user/1000/keyring` and the session bus exist. Whether the login keyring is unlocked for a service started by systemd was not tried.

**OpenCode Go** (public docs, fetched 2026-09-30 through a page summarizer, so wording is *unverified as exact text*: [opencode.ai/docs/go](https://opencode.ai/docs/go/)):

- Go $10/month, Go Plus $40/month. "Usage limits are defined as monthly dollar amounts" with a 5-hour cap (20 % of monthly), a weekly cap (50 %) and a monthly cap (100 %).
- Three endpoints under `https://opencode.ai/zen/go/v1/`: `/responses`, `/chat/completions` (OpenAI-compatible) and `/messages` (Anthropic-compatible). Which model is on which one is per model; this draft did not get the list (the docs page fetched did not carry it). Model ids in OpenCode's own config are `opencode-go/<model-id>`.
- "Only one member per workspace can subscribe to OpenCode Go or Go Plus." Several Go ACCOUNTS mean several workspaces.
- The docs say Go is "designed for OpenCode and other coding agents", that clients must identify with proper user agents and send `x-opencode-session`, and that Claude Code, Hermes and Codex are among the agents validated for session support.
- **A usage endpoint exists that the public docs do not list.** From the source (`anomalyco/opencode`, `packages/console/app/src/routes/zen/go/v1/usage.ts`, read 2026-09-30 through `gh api`; route table in `src/lib/inference-proxy.ts`: `GET /zen/go/v1/usage` → `/go/v1/usage`): `Authorization: Bearer <key>` (the key is matched against the workspace's key table); 401 with no or an unknown key (`AuthError`); 403 `EntitlementError` ("OpenCode Go subscription required") without a Go subscription; 200 `{ usage: { rolling, weekly, monthly } }`, each window run through `formatUsage` (the issue reports `{ status: "ok"|"rate-limited", percent, resetsAt }`; `formatUsage` itself was not opened here). No model call, no dollars, plan, email or workspace were seen in what the route selects. It is undocumented, so it can change without notice. The feature request for a documented one, [anomalyco/opencode#31084](https://github.com/anomalyco/opencode/issues/31084), is closed.

## 2. Principles

Everything in [accounts.md](accounts.md) 2 stays, with these changes and additions.

1. **One registry, a provider per entry.** The SUPERVISOR wants one ACCOUNTS list; FUEL, FLEET PLAN and `maxLaunched` already key on the label. Labels are **unique across providers** (R9 of the Codex survey).
2. **Principle 3 is split by credential kind.**
   - **Subscription OAuth logins** (Claude, Codex): unchanged. atc never reads, copies or prints `.credentials.json`, `auth.json`, tokens or the email. Reasons: the providers' terms on third-party use of subscription credentials (for Claude: Anthropic does not allow third-party apps to collect or pass on claude.ai credentials), rotating refresh tokens, swap races.
   - **API-key plans** (OpenCode Go): a **key atc holds write-only**. The SUPERVISOR enters it once; atc never shows it again, never writes it into a file that is copied (`fleet.json`, `settings.json`, the state dir, the snapshot), and uses it only server-side for the one read in section 5. The page shows at most `key configured: yes/no`.
3. **Sessions never get the key.** An AIRCRAFT on OpenCode Go reaches the provider through one gateway that already holds the key, or not at all. Agents see results, not keys. Why stricter than a desktop app: many autonomous sessions on this host can `curl localhost:7700` and read untrusted Linear and GitHub text (prompt injection). The risk to design against is atc **spreading** the key into new outputs, not uid isolation: the key file is readable by the same user anyway.
4. **Observed, not guessed, and unknown is not zero.** A session's ACCOUNT is the folder it is found in. FUEL for an ACCOUNT with no measurement, an estimate or a failed read is shown as unknown or as an estimate, never as 0 % and never as a silent copy of another ACCOUNT's number.
5. **ACCOUNT CHANGE stays within one provider and backend** (R6). A cheap-model AIRCRAFT is not moved onto a Claude subscription, or the other way, by FLEET PLAN.
6. **atc uses only a provider's own surfaces.** Codex: app-server, rollouts, `login status`. OpenCode Go: the model endpoints (by the session, not atc) and the usage route above, flagged as undocumented. No scraping of a console page with a cookie (that broke when the page became an SPA, per the issue's survey of other tools).
7. **The SUPERVISOR does account setup and enters keys.** Team sessions never run a login or see a key, as before.
8. **Terms are the SUPERVISOR's call** (section 7). atc records the wording and does not decide.

## 3. Registry shape

Compare the two models the issue asks for.

| | (a) `provider: "opencode-go"` as its own kind | (b) `provider: "claude"` + `backend: "opencode-go"` |
|---|---|---|
| What the session is | Not Claude Code; needs its own readers and launcher | **Still Claude Code** in a `CLAUDE_CONFIG_DIR` |
| Sessions, `jobs/`, transcripts, `claude --bg`, hooks, STOP, `claude agents`, CONTEXT, FUEL cost from transcripts, CREW | New code for each | **Work as they are** (the folder is a Claude folder) |
| What differs | Everything | Login (none: no OAuth), FUEL source, the model, the route, ADD ACCOUNT |
| `checkConfigDir` | New folder-name rule | Unchanged (`.claude-<label>`) |
| Risk | A third reader family next to Codex | Some Claude-only features break on a non-Anthropic model (section 4) |

**Recommendation: (b).** `fleet.json` `accounts` entries become `{ provider?: "claude" | "codex", backend?: "opencode-go", configDir, maxLaunched? }`. No `provider` means `claude`, so old files read unchanged; `backend` is allowed only with `provider: "claude"` and names where the model runs (missing = Anthropic). `provider: "codex"` is the Codex survey's entry (`configDir` = `CODEX_HOME`, folder name `.codex*`). The registry stays a label, a folder and two non-secret words: no key, email, workspace or plan (principle 2 of [accounts.md](accounts.md) carries). The key is **not** in the registry (section 5.1).

Consequences to decide in the first build step: a `backend` ACCOUNT must read as its own kind in every list (a chip `OPENCODE GO`), because "a Claude folder" no longer implies a Claude subscription; every reader that decides "logged in" from `claude auth status` must treat a backend ACCOUNT as "configured", not "NOT LOGGED IN"; and LAUNCH refuses it when the gateway or the key is missing, with the reason.

## 4. How a Claude Code session reaches OpenCode Go

Two routes, from the issue.

**(a) Direct.** The folder's `settings.json` `env` sets `ANTHROPIC_BASE_URL` to `https://opencode.ai/zen/go/v1` and a model (`ANTHROPIC_MODEL`, the small/fast model), with the key through `apiKeyHelper` or `ANTHROPIC_AUTH_TOKEN`. Only models served on `/messages` work. The key must reach that process: either a value in `settings.json` (copied by ADD ACCOUNT and by test servers, against principle 3 above) or a helper script that fetches it from the keyring (the session then runs a command that prints the key, reachable by any tool call the session makes). **Not recommended** under principle 3.

**(b) Through ClaudeRipple** (the gateway already running here). ClaudeRipple holds the key in its own config and translates `responses` and `chat` models, so more models are usable than on `/messages` alone. The ACCOUNT folder's `settings.json` copies the route keys that are already in `~/.claude/settings.json` (`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`) and sets the session model to an id ClaudeRipple knows (for example the ids in its `providers.opencode-go.models`). No key is written anywhere atc touches. **Recommended**, with these costs: a local proxy and its model routing become a dependency (the `health` block in its config suggests it tracks upstream failures; how it behaves when the upstream fails was not measured); atc must check that the proxy answers before LAUNCH; and ClaudeRipple is someone else's project that this draft may not change.

**Which models can fly a whole AIRCRAFT session.** Not measured. The things that decide it: tool use must work in a long agentic loop; the context size must fit the CAPTAIN's briefing and transcripts (ClaudeRipple's `CLAUDE_CODE_MAX_CONTEXT_TOKENS` is already set on this machine, which suggests a clamp); prompt caching is provider-specific and Claude Code's `cache_control` blocks may be ignored or rejected (then FUEL's leak and cold-cache math does not apply: [fuel.md](fuel.md) 8.2 must mark such a session "cache unknown"); effort levels are clamped (`effortClamp`, `caps.effortLevels` in its config). Section 8 lists the probe.

**What breaks or changes versus a Claude subscription** (predictions to verify, none measured):

| Thing | On an OpenCode Go backend |
|---|---|
| Statusline `rate_limits` | Absent (API-key style session). FUEL uses section 5 instead |
| `/usage`, `/status` plan screens | Not meaningful |
| Server tools (web search, web fetch) | Likely absent: they run on Anthropic's servers |
| Prompt cache | Different or none; transcripts may show zero cache fields |
| Remote Control, claude.ai connectors | Need a claude.ai login; not available |
| `claude --bg`, hooks (`claim`, `health`, statusline), jobs, transcripts, `claude agents` | Expected to work (same binary and folder); hooks seen under a second daemon in [accounts.md](accounts.md) 1 |
| LIMIT detection (`StopFailure` with `LIMIT`) | The hook keys on Anthropic's limit error; an OpenCode Go limit comes back in another shape and needs its own mapping |
| Model name on the page | The session's model id is the ClaudeRipple one, not a Claude id: pricing tables (FUEL COST) do not know it |

**Login.** A backend ACCOUNT has no OAuth login. Whether Claude Code starts in a folder with no login when `ANTHROPIC_BASE_URL` or the proxy is set, and what placeholder it needs, is not measured (section 8). ADD ACCOUNT for this kind writes the folder and a `settings.json` (section 6) and the health check reads "configured" (folder, settings, gateway answering), not `claude auth status`.

## 5. The key, and FUEL for an API-key plan

### 5.1 How atc may hold an API key

Commercial practice (cited from memory of each project's documentation, *to re-check before relying on it*): VS Code's Copilot BYOK and Zed keep keys in the OS keychain with a placeholder in settings; OpenRouter BYOK encrypts at rest and never returns the key after creation; LiteLLM encrypts provider keys (`LITELLM_SALT_KEY`) and hands callers **virtual keys**, so the real key stays in the gateway.

**Option A (recommended; ENGINEERING's 2026-09-30 proposal; the SUPERVISOR decides).** Write-only storage, and the real key in one place for atc.

- **Storage.** The Linux keyring through `secret-tool` (libsecret); this machine does not have it (section 1), so the build step installs or replaces it, and the fallback is `.env.local` under the same rules as `LINEAR_API_KEY` (never copied, printed, or put in the state dir; test servers already do not copy it). **Never in `fleet.json`**: test servers copy the registries, so a key there would land in every temp state dir. The registry carries only `key configured`. Risk: a keyring the systemd service cannot unlock; then the fallback applies and the page says which store is in use.
- **Entry.** A write-only field in the settings window; after save it shows `configured ✓` and never the key. SUPERVISOR only (`fromThisApp`: a localhost `Origin` and a JSON `Content-Type`, as every settings write since ATC-238). No route returns the key.
- **Use.** Server-side only: the usage read in 5.2 and nothing else. The key goes in an `Authorization` header built inside one function, never into a URL, a log line, an error text, the FLIGHT RECORDER, `duty.jsonl`, the snapshot or SSE. **Test**: seed a fake key, run the read and every route, and grep every output, log and state file for it; the test fails on any hit.
- **Sessions.** None gets the key (principle 3). They go through the gateway.

**(B)** A SUPERVISOR-owned helper command that prints only the usage JSON: atc never holds the key in memory, but on the same uid it adds little safety and one more script to keep. **(C)** ClaudeRipple exposing usage locally: not checked whether it can; it would need a change to a project this draft may not touch. Whatever is chosen, the page shows at most `key configured: yes/no`, never the key and never an `env` value.

### 5.2 FUEL for an OpenCode Go ACCOUNT

- **Source.** `GET https://opencode.ai/zen/go/v1/usage` (section 1), once per ACCOUNT, on a slow cadence (for example every 5 minutes and on demand from the settings window), one at a time. No model call. Keep only `status`, `percent` and `resetsAt` per window (`rolling`, `weekly`, `monthly`); drop everything else at the parser. Map `rolling` to the 5-hour window of the docs and keep the others under their own names: FUEL reads windows by length, not by name, as for Codex.
- **Shape.** A FUEL block line `OPENCODE GO 5h 32% · wk 18% · mo 9%` next to the Claude ACCOUNTS, with the same `holdPct` rule over the highest of the three.
- **Failure and staleness.** 401, 403, a timeout, a changed shape, or no key: **unknown**, with the reason on the row (`key missing`, `no Go subscription`, `route changed`). Never 0 %. A value older than three cadences reads as stale. The route is undocumented: a parser test pins the fields used, and unknown fields are ignored.
- **Cost is a different thing.** Token counts in transcripts times a price stay the per-FLIGHT cost estimate ([fuel.md](fuel.md) 8.4), marked as an estimate because the model ids and cache fields differ. They are not the plan limit. The plan limit is the section 5.2 read.
- **FLEET PLAN** must treat an estimate or an unknown as such: no proposal may rest on a 0 % that was really "unknown" (a backend ACCOUNT with no reading is neither "full" nor "empty").

## 6. ADD ACCOUNT, LAUNCH, FLEET and DISPATCH

**ADD ACCOUNT for `backend: "opencode-go"`** (SUPERVISOR only): a label, the folder `~/.claude-<label>` (mode 0700), and a `settings.json` written through a temp file and rename (mode 0600) that routes through the gateway and sets the model: `env` keys only for the route and model, no key; the hooks and statusline copied as for any ACCOUNT. The key goes in the write-only field (5.1). The registry is written last. Health: the folder, the settings, the gateway answering, `key configured`, and one usage read (status only). `.credentials.json` and `.claude.json` are not created or read by atc; onboarding for a folder with no login is part of what section 8 measures.

**ADD ACCOUNT / LOGIN / status for `provider: "codex"`:** as in [research/chatgpt-codex-accounts.md](research/chatgpt-codex-accounts.md) 8.2 (folder `~/.codex-<label>`, device-code login through app-server, `codex login status`, no copied `config.toml`). Not repeated here.

**Which FLIGHTs a cheap-model AIRCRAFT gets.** A cheap model is a weaker CAPTAIN. **Recommendation (PILOT'S DISCRETION, for the SUPERVISOR to confirm): a profile-level allow-list on the AIRCRAFT, using the existing classification labels**, not a new rating system. A backend ACCOUNT is usable by an AIRCRAFT whose profile says so, and DISPATCH only offers it FLIGHTs with wake `L` or `M` and type FERRY, MAINT, SURVEY or DOCS; never `SEC` or `DATA`, never wake `J`. Reasons: the type rating (`UI`, `DATA`, `DOCS`, `SEC`) already says what an AIRCRAFT may fly; wake already says how heavy a job is; adding "backend" as a third axis on the profile keeps one place to look. Alternatives: a rating rule per model (more flexible, more to maintain), or a CONFIGURATION preset that sets ACCOUNT and allowed FLIGHTs together (nicer to switch, but hides the rule). Decision 4.

**ACCOUNT CHANGE** stays inside one provider and backend (principle 5): two OpenCode Go ACCOUNTS (two workspaces) can swap between FLIGHTs, a Claude ACCOUNT and a backend ACCOUNT cannot.

**LAUNCH ACCOUNT** ([accounts.md](accounts.md) 5.4): the AIRCRAFT dropdown lists every registered ACCOUNT, each with a provider chip; a backend ACCOUNT whose route, key or usage read refuses is disabled with the reason, like a logged-out one today. Selecting one as the default for all AIRCRAFT is allowed but the page warns when the FLEET holds FLIGHTs outside the allow-list, and DISPATCH keeps to the allow-list regardless of the default. Control sessions (TOWER, OCC, MCC …) are **not** offered a backend ACCOUNT in this draft: their manuals rely on Claude-only behaviour.

## 7. Terms

OpenCode Go (terms page fetched 2026-09-30 through a page summarizer, *unverified as exact text*; [opencode.ai/legal/terms-of-service](https://opencode.ai/legal/terms-of-service)):

- Forbidden: "automatically or programmatically extracts data or Output" and "'crawls,' 'scrapes,' or 'spiders' any page, data, or portion of or relating to the Services or Content". This is about the service's pages and content; a coding agent calling the model endpoints is what the Go docs describe. The usage route is undocumented, so a poll of it is not clearly either.
- Forbidden: "creates, maintains, or uses multiple accounts to circumvent usage limits, access restrictions, billing obligations, promotions, suspensions, or any other restriction or policy applicable to the Services." Relevant if several Go ACCOUNTS are added to get round the caps; one per workspace is the documented limit.
- "only for your own internal use, and not on behalf of or for the benefit of any third party." Relevant to running this for others.
- Nothing retrieved says anything about sharing an API key between tools on one host. The docs page (OFFICIAL, unverified as exact) says Go is "designed for OpenCode and other coding agents" and names Claude Code, Hermes and Codex as validated agents, with a need for proper user agent and `x-opencode-session`; whether ClaudeRipple's `identity` and `sessionHeader` settings satisfy that was not checked.

**OFFICIAL / unverified marks.** Wording above came from the provider's own pages but through a summarizer: treat as unverified until the SUPERVISOR has read the pages. atc does not decide.

## 8. Not measured

- **Does Claude Code run a whole session on `/messages` from OpenCode Go** (tool use, long context, cache fields), and **does it start with no claude.ai login** when `ANTHROPIC_BASE_URL` or the proxy is set. Needs a real key and one model call, so it was not run. For the SUPERVISOR, once, in a throwaway folder and a throwaway directory, with the key read from their own keyring or shell (do not paste it anywhere):

  ```bash
  mkdir -p ~/.claude-probe-go && cd "$(mktemp -d)"
  CLAUDE_CONFIG_DIR=~/.claude-probe-go \
  ANTHROPIC_BASE_URL=https://opencode.ai/zen/go/v1 \
  ANTHROPIC_AUTH_TOKEN="$OPENCODE_GO_KEY" \
  ANTHROPIC_MODEL=<a model served on /messages> \
  claude -p "Run pwd with the Bash tool, then say done." --output-format stream-json --verbose > probe.jsonl
  ```

  Then report the exit status, whether the tool ran, and the `usage` field names in `probe.jsonl` (cache fields present or zero). The same through ClaudeRipple (proxy env as in `~/.claude/settings.json`, no `ANTHROPIC_BASE_URL`, a ClaudeRipple model id) answers route (b). Delete `~/.claude-probe-go` afterwards.
- **The usage route's live response**, including `formatUsage` output and the exact 401 and 403 bodies. One read, no model call: `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $OPENCODE_GO_KEY" https://opencode.ai/zen/go/v1/usage`, then the same with `| head -c 600` of the body (look at the field names only).
- Which models are on `/messages` versus `responses` or `chat`, and their context sizes. Needs the provider's model page.
- ClaudeRipple: what `routes`, `direct`, `aliases` mean; its behaviour when the upstream fails; whether it can expose usage (option C).
- Whether the login keyring is unlocked for a service started by systemd on this host.
- What a first session in a fresh Codex home asks, and Codex LIMIT detection ([research/chatgpt-codex-accounts.md](research/chatgpt-codex-accounts.md) 9).

## 9. Implementation order

Each row is one build issue after the SUPERVISOR answers section 11. Tier by the usual rules ([CLAUDE.md](../CLAUDE.md)): registry format and LAUNCH environment are `user`.

| # | Step | Needs | Tier |
|---|---|---|---|
| P1 | Registry `provider` (and `backend`) in `fleet.json` `accounts`, label uniqueness across providers, `checkConfigDir` per provider, **provider-aware reader loops** (38 `accountFolders()` sites) with tests that a Codex or backend entry changes nothing for the Claude readers. No new code path yet. (= C1) | this draft | `user` (registry format) |
| P2 | OpenCode Go ADD ACCOUNT and health: folder, gateway-routed `settings.json`, `key configured`, write-only key field and store (5.1), the no-leak test, chip `OPENCODE GO`. After the section 8 probe | P1, probe | `user` (writes settings, stores a secret) |
| P3 | LAUNCH, STOP and RESUME on a backend ACCOUNT, refusal reasons, LAUNCH ACCOUNT dropdown chips, the allow-list (section 6) in DISPATCH | P2 | `user` (LAUNCH environment) |
| P4 | FUEL for OpenCode Go: the usage read (5.2), unknown/stale rules, FUEL block, `holdPct`, FLEET PLAN treats unknown as unknown | P2 | `flagged` (external read) |
| P5 | Readers for Codex homes and `codex login status` health (= C2) | P1 | `auto` or `flagged` |
| P6 | ADD ACCOUNT for Codex (= C3) and LOGIN through app-server device code (= C4) | P5 | `user` (writes a folder, starts a login) |
| P7 | FUEL for Codex: `account/rateLimits/read` and `token_count` (= C5) | P5 | `flagged` |
| P8 | LAUNCH `codex exec` FLIGHTs (= C6) and Codex hooks (= C7) | P6 | `user` |

P4 can ship before P3: the FUEL row is useful as soon as a key is configured.

## 10. Risks

| Risk | Answer |
|---|---|
| atc spreads the key (log, error, snapshot, copied file) | Write-only field; never in `fleet.json` or `settings.json`; one function builds the header; a test seeds a fake key and greps every output (5.1) |
| The keyring is locked or missing for the service | Fallback to `.env.local` with the same rules as `LINEAR_API_KEY`; the page says which store is in use |
| The usage route is undocumented and changes | Parser pinned by a test; any surprise reads as unknown; FUEL never guesses |
| ClaudeRipple is a dependency owned by someone else | LAUNCH checks the gateway first and refuses with a reason; direct route (a) stays a documented fallback, not recommended |
| A weak model flies a FLIGHT it should not (SEC, DATA) | Allow-list on the AIRCRAFT and in DISPATCH; control sessions never get a backend ACCOUNT |
| Claude-only features look broken on a backend ACCOUNT (cache math, LIMIT detection, plan screens) | Mark cache unknown, map the provider's limit error, label the chip; do not show a leak warning for a session without cache data |
| A backend ACCOUNT reads "NOT LOGGED IN" everywhere | Health for a backend ACCOUNT is "configured", not `claude auth status` (section 3) |
| Reader loops over `accountFolders()` assume Claude | P1 first, before any Codex or backend entry exists |
| Several Go ACCOUNTS against the multiple-accounts clause | Section 7: SUPERVISOR's decision |
| An older atc build reads a `fleet.json` with `provider` or `backend` | The current `validateAccounts` refuses unknown keys in an entry and drops the entry (`server/accounts.ts`), so after a rollback a `provider` or `backend` entry would vanish from the list (and its sessions would read as unregistered). P1 must say what a rollback does and pin it with a test (this is why P1 is `user`) |

## 11. Decisions for the SUPERVISOR

1. **Registry shape:** (b) `provider: "claude"` + `backend: "opencode-go"` (recommended) or (a) its own `provider`.
2. **Route to OpenCode Go:** through ClaudeRipple (recommended) or direct `/messages` with a key in `settings.json` (not recommended).
3. **The key:** option A, write-only field plus keyring (with `.env.local` fallback), atc reads only the usage route (recommended); or (B) a helper command; or (C) ClaudeRipple exposes usage. Also: may atc poll the undocumented usage route at all?
4. **Which FLIGHTs a cheap-model AIRCRAFT gets:** profile allow-list with wake `L`/`M` and types FERRY, MAINT, SURVEY, DOCS (recommended), a rating rule, or a CONFIGURATION.
5. **Control sessions on a backend ACCOUNT:** never (recommended for v1) or later.
6. **Terms:** whether using OpenCode Go this way, and more than one Go ACCOUNT, is acceptable to you (section 7).
7. **Run the section 8 probe** (one real key, a handful of requests) before P2, and pick a probe model.
8. **Codex:** the ATC-237 decisions stand (one registry with `provider`; official usage read plus rollouts; `codex exec` FLIGHTs first; no proxy override on new Codex folders).
