# Research: reading Claude plan usage and running several Claude accounts

**English** · [한국어](claude-usage-accounts.ko.md)

> Status: SURVEY for [ATC-188](https://linear.app/vocado/issue/ATC-188/survey-how-other-projects-read-claude-plan-usage-and-run-several), 2026-09-30. Docs only; no code, setting or `~/.claude*` folder was changed, nobody logged in or out, no credential file was read and no model call was made. Everything about other projects comes from their public README, docs or source, fetched on 2026-09-30. Star counts are approximate (read off repo pages) and last-activity dates were not all confirmable; both are marked. The recommendation needs a SUPERVISOR decision.

## 1. Question

atc runs several Claude subscription ACCOUNTS ([accounts.md](../accounts.md)). FUEL knows an ACCOUNT's plan usage only from the statusline `rate_limits` of a running session ([fuel.md](../fuel.md) section 6). An ACCOUNT with no running session reads as "no record" and FLEET PLAN counts it as 0 %. On 2026-09-30 one ACCOUNT was at 100 % of its weekly limit yet looked like the emptiest for ENTRY and ACCOUNT CHANGE.

Three questions (from the issue): how do other projects read plan usage without a model call; how do they run several accounts; and is there a documented, stable way.

## 2. Method

- Public sources only: project READMEs and source files, Claude Code docs (`code.claude.com/docs`), the Claude Code changelog, Anthropic's public terms pages, and issue threads.
- Every mechanism below was read in fetched text. Where a fact came from an issue thread or a search summary and not from code or docs, it is marked *unverified*.
- The one local measurement is the issue's own (Claude Code 2.1.285): `CLAUDE_CONFIG_DIR=<folder> claude -p "/usage" --no-session-persistence --output-format json` prints `Current session: N% used · resets …` and `Current week (all models): N% used · resets …`, with `num_turns` 0, `total_cost_usd` 0, about 3.9 s and 275 MB peak RSS. This session did not run it again.

## 3. Ways to read plan usage

| Source | Documented? | Credential needed | Model call | What it gives |
|---|---|---|---|---|
| **(a)** Statusline stdin JSON `rate_limits` | **Yes**, [statusline](https://code.claude.com/docs/en/statusline) | none (the session hands it to the command) | none (piggybacks on the session's own requests) | `five_hour` and `seven_day` `{used_percentage, resets_at}` (epoch s); `spend_limit` for gateway logins. Present only for Pro and Max, only after the first API response, each window may be absent |
| **(b)** `/usage` text (`claude -p "/usage"`) | The command is documented ([commands](https://code.claude.com/docs/en/commands), [costs](https://code.claude.com/docs/en/costs)); its **text is not a schema** | none read by the caller | none (measured: 0 turns, 0 USD) | Session and weekly percent and reset text. Per-model weekly windows appear in `/usage` too |
| **(c)** `GET /api/oauth/usage` with the OAuth token | **No** (internal; docs only say "the usage endpoint") | **Yes**, the access token | none | `five_hour`, `seven_day`, per-model weekly, `extra_usage`: `utilization` 0–100 and ISO `resets_at` (different names from (a)) |
| **(d)** Transcript sums (ccusage style) | n/a (own files) | none | none | Tokens and cost estimates, **not** the server's plan percent |
| **(e)** `anthropic-ratelimit-unified-*` response headers | **No** (public rate-limit docs list only the API headers) | **Yes** | **Yes**: a real request (about 1 output token) | 5h and 7d utilization, reset, status |
| **(f)** claude.ai web API with the browser cookie | No | the web `sessionKey` cookie | none | Web-account numbers; not the Claude Code CLI login |
| **(g)** Public usage API | Admin Usage & Cost API: **not for individual accounts** ("The Admin API is unavailable for individual accounts"); Enterprise has a separate Analytics API | Admin or Analytics key | none | Organization data. Nothing for Pro and Max |

Not in headless output: `--output-format json` and the Agent SDK result carry cost and token fields (`total_cost_usd`, `usage`, `modelUsage`), no plan limits.

Notes on each:

- **(a)** is the only source documented as a schema. The 60-minute "last-known usage" fallback in `/usage` (docs: costs) is an in-process thing; the issue found no cache file in the config folder.
- **(c)** appears in no official page. Reported by projects, not by Anthropic: it wants the `user:profile` scope, so a `setup-token` (inference scope only) gets 403 (CodexBar issue #1894, *unverified*); it rate-limits (429) hard, and several tools send `User-Agent: claude-code/<version>` and cache 3–5 minutes with backoff (Claude Code issue #31021, *unverified* for the cause). Claude Code's own changelog (2.1.281–2.1.284) has "Fixed repeated calls to the plan-usage endpoint after it rate-limits or rejects your login".
- **(e)** is used by two small projects and one mainstream menu bar app. It works with any token but is a real model request against that ACCOUNT.
- The statusline `rate_limits` field is reported to have shipped in Claude Code 2.1.80 (*unverified*); atc verified it present in 2.1.283 ([fuel.md](../fuel.md) 6.1).

## 4. Projects that read usage

Stars are approximate. Legend for the mechanism column is the table above.

| Project | Mechanism | Cadence | Tokens |
|---|---|---|---|
| [ccusage](https://github.com/ccusage/ccusage) (~19k, MIT) | (d) | on demand | none. Does not read plan percent |
| [ccstatusline](https://github.com/sirmalloc/ccstatusline) (~13k, MIT) | (a) first, (c) fallback | statusline every 10 s, API cache 180 s | reads the token for (c) |
| [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) (~8.7k, MIT) | (a) `--statusline`, (c) opt-in `--api`, (d) | TUI | opt-in |
| [Claude-Usage-Tracker](https://github.com/hamed-elfayome/Claude-Usage-Tracker) (~3.6k, MIT, macOS) | (e) headers (and (c)) | timer | reads the token |
| [claude-dashboard](https://github.com/uppinote20/claude-dashboard) (~580, MIT) | (c) | cache 300 s, honors `retry-after` | reads the token |
| [claude-pulse](https://github.com/NoobyGains/claude-pulse) (~460, MIT) | (a) only ("no OAuth") | statusline repaint | none |
| [weekstat](https://github.com/butschster/weekstat) (~2, MIT) | (a) only, by design | daemon 5 s | none |
| [claude-code-usage-guard](https://github.com/eltonylfgi-blip/claude-code-usage-guard) (~3, MIT) | (a), (d) proxy when absent | statusline 30 s | none |
| [itsPG/claude-code-statusline](https://github.com/itsPG/claude-code-statusline) (~3, MIT) | (a), (c) fallback | 120 s | reads the token for (c) |
| [cc-usage-cli](https://github.com/abruption/cc-usage-cli) (~0, MIT) | (e): a `max_tokens: 1` Haiku request | 60 s | reads the token |
| [claude-limits](https://github.com/figueiredouc/claude-limits) (~1, MIT) | (c) | 180 s, 429 backoff 5–30 min | in memory only |
| [claude-usage-limits](https://github.com/eduardo-veras/claude-usage-limits) (~0, MIT) | **(b)** `claude -p "/usage" --output-format json`, parses the text | on demand | none. README-level fragility: "depends on the wording of /usage" |
| [ClaudeMeter](https://github.com/eddmann/ClaudeMeter), [usage4claude](https://github.com/f-is-h/usage4claude), [AgentLimits](https://github.com/Nihondo/AgentLimits) | (f) | ~60 s | web cookie, kept in the OS keychain |

Patterns across roughly thirty projects:

- The newest tools take **(a) first** (no network, no credential) and use (c) only for what the statusline lacks (per-model weekly windows, extra usage).
- Only one project parses `/usage` text (b). No project parses `/status`.
- **Format changes:** dual-source fallbacks (stdin, then endpoint, then transcripts), tolerant parsing (`// empty` in `jq`, missing means 0 or "unknown"), TTL caches, negative caching and `retry-after` backoff. The (c) tools say themselves the endpoint "can change or disappear without notice".
- **Token storage:** most read the credential on each poll and cache only usage numbers. The exception is claude-swap, which rotates and rewrites tokens.
- ccusage's maintainers declined to add plan percent to its statusline (issue #658, closed as not planned): transcript tokens are not the server's meter.

## 5. Ways to run several accounts

| Project | Method | Picks an account at the limit | Terms statement |
|---|---|---|---|
| **Claude Code itself** ([authentication](https://code.claude.com/docs/en/authentication)) | One `CLAUDE_CONFIG_DIR` per account; each folder has its own settings, history and login | you choose | Documented: "give each account its own configuration directory" |
| [claude-profile-manager](https://github.com/JakubKontra/claude-profile-manager) (~22, MIT) | `CLAUDE_CONFIG_DIR` per profile, launchers, symlinked skills, copied settings | you choose | none |
| [account-switcher-for-claude-code](https://github.com/timvgl/account-switcher-for-claude-code) (~0, MIT) | `CLAUDE_CONFIG_DIR` per account, concurrent | you choose | "make sure your use of multiple accounts complies with Anthropic's terms of service" |
| [claude-multiprofile](https://github.com/jmdarre-v/claude-multiprofile) (~87, MIT) | `--user-data-dir` (Desktop), `CLAUDE_CONFIG_DIR` (Code) | you choose | warns the token can land on the wrong instance if two run at once |
| [claude-swap](https://github.com/realiti4/claude-swap) (~2.9k, MIT) | swaps the stored login (keychain or `.credentials.json`), keeps encrypted backups; also `setup-token` and API keys | auto-switch at a threshold (default 90 % of 5h or 7d) to the account with most quota left | none |
| [clauth](https://github.com/uwuclxdy/clauth) (~245, MIT) | per-profile snapshot swap, and `clauth start` in an isolated `CLAUDE_CONFIG_DIR` | fallback chain when an account hits its limit | none |
| [clyde](https://github.com/abiroot/clyde) (~2, MIT) | rewrites the keychain login in place; reads `/api/oauth/usage` for gauges | manual | explicit: rotating "may run against Anthropic's Terms of Service" |
| [teamclaude](https://github.com/KarpelesLab/teamclaude) (~360, MIT) | local proxy pooling OAuth tokens, refreshes and writes them back | rotate at 98 % of 5h or 7d, prefers the earliest weekly reset | `docs/compliance.md`: "Anthropic hasn't explicitly blessed *automated* pooling" |
| [claude-rotate](https://github.com/doxaras/claude-rotate) (~29, MIT), [CC-Router](https://github.com/VictorMinemu/CC-Router) (~34, MIT), [claude-proxy](https://github.com/p4u/claude-proxy) (~1, AGPL) | proxy on `ANTHROPIC_BASE_URL` with per-account `setup-token` or stored OAuth tokens | quota headers or 429, sticky per conversation in claude-proxy | all warn (gray area, possible bans, "you must only use credentials you personally own") |

Four mechanisms: **folder isolation** (concurrent, documented), **credential swap** (one active login, races token refresh), **proxy pooling** (holds the tokens, automates rotation), and **API keys**. Only the proxies and swappers auto-pick an account at the limit; the isolation tools leave the choice to the person.

## 6. What Anthropic says

From [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) and the [consumer terms](https://www.anthropic.com/legal/consumer-terms), quoted exactly:

- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
- Anthropic "does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users", and developers "may not collect, store, or intermediate Claude.ai credentials or session tokens".
- Consumer terms: no sharing of "account login information … or account credentials with anyone else", and no access "through bots, scripts or other automated or non-human means, except where you access our Services through your Anthropic API key or where we explicitly permit it".
- Anthropic "reserves the right to take measures to enforce these restrictions and may do so without prior notice".
- Nothing found caps how many subscriptions one person may hold. Separate `CLAUDE_CONFIG_DIR` folders and `claude setup-token` for one's own scripts are both documented.
- Agent SDK: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products".

atc does not decide what the plan terms allow ([accounts.md](../accounts.md) section 4, step 5). This survey only records the wording.

## 7. How atc compares

- **Accounts:** atc follows the documented pattern (one folder per ACCOUNT, one daemon per folder), and adds the SUPERVISOR-only setup, no token swap and no proxy ([accounts.md](../accounts.md) principles 3, 5, 7). It never holds or intermediates a token, and nothing switches an ACCOUNT automatically: ACCOUNT CHANGE is a FLEET PLAN proposal the SUPERVISOR approves. That is the folder-isolation class in the table, not the swap or pool classes.
- **Usage:** atc uses (a), which is what the best-known tools prefer and the only documented schema. Its gap is the same as theirs: (a) needs a running session on that ACCOUNT, so an idle ACCOUNT has no record.
- **Sources (c), (e) and (f) are closed to atc by its own principles**: they need the OAuth token or a web cookie (principle 3), and (e) also makes a model call on the ACCOUNT being read, which this survey's constraints exclude ("no model calls on another ACCOUNT").

## 8. Recommendation

Recommended: **keep the statusline as the source of truth, and add `/usage` on demand as a fallback for ACCOUNTS with no record.** Concretely, for the SUPERVISOR to decide:

1. **Statusline stays (a).** No change for ACCOUNTS with a running session.
2. **Add a REFRESH read (b):** a REFRESH button on the FUEL ACCOUNT block, and one read just before FLEET PLAN uses an ACCOUNT that has no record. Run `claude -p "/usage" --no-session-persistence --output-format json` with that ACCOUNT's `CLAUDE_CONFIG_DIR` in a clean environment, read only the two percent-and-reset lines, cache 30 minutes per ACCOUNT, at most one read at a time. No token is read by atc, no model call runs (measured: 0 turns, 0 USD), and it is `claude`'s own documented command.
3. **A failed or unparsable read means "unknown", never 0 %.** Independent of the above, FLEET PLAN should treat "no record" as unknown and hold ENTRY and ACCOUNT CHANGE to it (or ask), instead of counting it as empty. This alone would have stopped the 2026-09-30 mistake, and it costs nothing.
4. **Mark the source.** Show `statusline` or `/usage (12 min ago)` next to the number, so a cached value is not read as live.

Risks of each option:

| Option | Risk |
|---|---|
| Statusline only (status quo) | Idle ACCOUNTS stay "no record"; wrong ENTRY choices continue unless item 3 is done. Zero new cost |
| `/usage` on demand (recommended) | The text is not a schema and can change, so the parser must be tolerant and fail to "unknown". About 3.9 s and 275 MB peak per read, and the `claude` process runs under that ACCOUNT's login, which counts as ordinary use of it. A `--no-session-persistence` run should leave no session, but this survey did not re-measure that. One project does this, so there is little field experience |
| OAuth usage endpoint (c) | Undocumented, 429-prone, needs the `user:profile` token scope. atc would have to read `.credentials.json`, which principles 3 and 7 forbid, and would hold a secret |
| Header probe (e) | A real model request on the ACCOUNT, and the token again. Ruled out by the constraints |
| Web cookie (f) | A different login (claude.ai, not the CLI), a stored cookie, and an undocumented API |

If the SUPERVISOR wants no new read at all, item 3 alone is the minimum: it removes the wrong-ACCOUNT choice without any source change.

## 9. Not verified

- Star counts are approximate. GitHub's REST API returned 403 partway through the survey, so exact last-commit dates were not confirmed for most projects.
- The `rate_limits` first-release version, the (c) response shape and its 429 remedies, and CodexBar's use of (e) come from community sources, not from Anthropic.
- One project's README says MIT while its repository license field is empty; licenses here are read from repo pages.
- No tool was run. No claim here is a measurement except the `/usage` line in section 2, which is the issue's own.
