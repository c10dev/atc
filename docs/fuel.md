# FUEL design (token burn per FLIGHT, leaks, and plan limits)

FUEL is the tokens a FLIGHT uses. atc records how long a FLIGHT took (block time, landing wait) and how well it went (rollbacks, LOS, Codex findings), but not what it burned, why some of that burn was waste, or how close each account is to its plan limit. FUEL adds those three things from records atc can already read.

> Status (2026-09-28): draft for ATC-46 (moved from GitHub idea #53, whose research comment is the source for the pricing and cache facts below). F1 is built (`server/fuel.ts`, `server/fuel-run.ts`, `GET /api/fuel`) and F2 (ACCOUNT label, `LIMIT` held by ACCOUNT) is built (ATC-51); F3 (COLD CACHE and MODEL SWITCH leaks, `server/fuel-leaks.ts`) is built (ATC-52); F4 (FLIGHT attribution, the LOGBOOK `fuel` field, `UNATTRIBUTED`) is built (ATC-53); F6 (FUEL REMAINING per ACCOUNT from the statusline) is built (ATC-55), with control sessions counted in their ACCOUNT (ATC-60); F5 (price table, FUEL COST, NET FUEL, `server/fuel-cost.ts`) is built (ATC-54), with per-FLIGHT cost from LOGBOOK `byModel` (ATC-59); F7 (COMPACTION, SESSION CHANGE, UPGRADE / EFFORT CHANGE, the `proxied` bucket, CREW misses and CREW warnings, `server/fuel-crew.ts`) is built (ATC-57); F8 (screens, TRIP FUEL, brief warnings, FUEL TARGETS, `server/fuel-view.ts`) is built (ATC-56). All eight issues are built; what is left is under "Not built yet". Each AIRCRAFT's own fuel, FOB (context window left), is on the FLEET list (ATC-69, ATC-81; [fleet.md](fleet.md) "FOB as built"), and every ACCOUNT plan-limit text says it is used. Sections 8 and 9 hold the split into issues and the SUPERVISOR decisions this needs.

Related: [fleet.md](fleet.md) 8.3 (observed crew, never read bodies), 8.6 (FLEET PLAN, "Usage: none per AIRCRAFT"), 8.8 (AIRCRAFT health, `LIMIT` after a limit is hit); `server/logbook.ts` (LOGBOOK), `server/health.ts` (`quotaLimits`), `server/crew-observed.ts`; GitHub #41 (ontology graph projection, K1).

## 1. Current facts

Read on 2026-09-28 from local transcripts (field names and numbers only, no bodies), the atc code and `~/.claude/settings.json`. Nothing was written.

| Area | Today | What it means |
|---|---|---|
| Per-FLIGHT usage | None. LOGBOOK `arrived` lines have time and quality fields only | No way to say what a FLIGHT cost or compare teams by cost |
| Per-account limits | None. ATC-45 sees a `LIMIT` only after a session is refused (`quotaLimits.resetsAt`, `rateLimitType`). atc does not know which AIRCRAFT share an account | On 2026-09-28 TEAM_K's Pro account was nearly spent and atc could not tell |
| Where usage lives | Each assistant line in `~/.claude/projects/<cwd>/<sessionId>.jsonl` carries `message.usage` with `cache_creation.ephemeral_5m/1h_input_tokens`, plus `message.model`, `stop_reason`, `version`. CREW is in `<sessionId>/subagents/agent-*.jsonl` | Everything needed is on disk, read-only |
| Volume (last 7 days) | 176 main transcripts, 214 subagent files, 19,760 unique requests | A full scan is small enough for the LOGBOOK cycle |
| Duplicates | 47,796 assistant lines with usage for 19,760 unique `(message.id, requestId)`: 2.42 lines per request | Summing lines without dedupe inflates totals about 2.4× |
| Cache | Every request that wrote cache wrote the 1 h tier (15,809 requests, 0 at 5 m). Totals: 40.0 M uncached input, 83.6 M cache writes, 6,596 M cache reads, 14.1 M output. CACHE HIT (Σ read / Σ(input + write + read)) = 0.982 | Reads dominate the token count; writes and output dominate the cost. Show both |
| Models seen | `claude-opus-5-5` 15,431 requests, then DeepSeek and Muse routes (~3,800) and `claude-sonnet-5` 375 | The price table must know non-Anthropic routes or leave them out of cost |
| Transcript reading in atc | `readTail` reads the last 1 MB; ATC-45 reads the last 64 KB; `talkEventsFile` reads on from a byte offset | FUEL needs the offset reader, not the tail |
| Statusline | No `statusLine` is configured in `~/.claude/settings.json` | The plan-limit source #53 proposed (statusline `rate_limits`) is not wired and must be verified first. Verified in ATC-55: present (section 6.1) |

## 2. Principles

1. **Measure from records, never from bodies.** Filter lines on `"usage"` / `"compact_boundary"` before parsing and drop `message.content` right after. Same rule as fleet.md 8.3 and 8.8.
2. **One request counts once.** Dedupe globally by `(message.id, requestId)`, falling back to `(message.id, sessionId, timestamp)`. Among copies, keep the non-sidechain one, then the larger token sum.
3. **Show, don't steer.** FUEL numbers are displayed next to TARGETS and in briefs. They never feed DISPATCH scores or assignments, except a plan-limit HOLD that the SUPERVISOR switches on (section 6).
4. **Tokens and cost side by side.** Cost uses a config price table; a model with no price is left out of cost with a warning, never guessed.
5. **Name the cause.** A leak is only counted with a rule that says why (cold cache, control wake, model switch …). Anything else is `UNEXPLAINED`, not blamed on a team.
6. **Accounts are declared, not discovered.** atc does not read credentials or account settings. The SUPERVISOR labels which account an AIRCRAFT flies on.

## 3. Terms

| Term | Meaning |
|---|---|
| FUEL | Tokens, counted as `input` (uncached), `cacheWrite5m`, `cacheWrite1h`, `cacheRead`, `output` |
| FUEL BURN | Actual use, CAPTAIN (main transcript) and CREW (subagents) separately |
| FUEL COST | The kinds combined by list price (nominal on subscription plans) |
| FUEL LEAK | Excess from re-writing context that was already cached: `rewritten × P_in × (writeMult − readMult)` |
| NET FUEL | FUEL BURN minus FUEL LEAK; TRIP FUEL learns from this |
| TRIP FUEL | Pre-departure estimate: p50–p90 of past NET FUEL COST for the same TYPE × WAKE |
| CACHE HIT | Σ `cacheRead` / Σ(`input` + `cacheWrite` + `cacheRead`), summed over requests |
| FUEL REMAINING | An account's plan limit, always shown as the share **used** (`사용 87% · resets 21:00Z`), never as a gauge that reads like what is left |
| FOB (FUEL ON BOARD) | An AIRCRAFT's own fuel: the share of its model's context window still free, `FOB 50% · 504k/1M` on the FLEET row (amber at 60 % left or less, alert at 30 % or less). The context window is what an AIRCRAFT actually carries; the plan limit is shared by every AIRCRAFT of the ACCOUNT ([fleet.md](fleet.md) 8.6, "FOB as built (ATC-81)") |
| ACCOUNT | A SUPERVISOR-chosen label for the plan an AIRCRAFT flies on (e.g. `main`, `pro-2`); never an email |

## 4. Measuring and attributing

- **Parser** (`server/fuel.ts`, pure): lines → per-request records `{key, session, sidechain, t, model, input, cacheWrite5m, cacheWrite1h, cacheRead, output, stopReason, version, effort}`. Unknown line shapes are skipped and counted.
- **Reader**: per-file byte offsets like `talkEventsFile`; start over when a file shrinks. Main transcripts and `subagents/*.jsonl`; `agent-*.meta.json` gives `agentType`, `toolUseId`, `spawnDepth`.
- **CREW output is a lower bound.** Subagent lines are often start-of-response snapshots (`stop_reason: null`, a few output tokens). Mark CREW output `outputLowerBound` and record the share of such lines.
- **Codex**: sum `last_token_usage` from `token_count` events; `uncached = input − cached − cache_write`; skip the parent history a MultiAgent rollout replays.
- **FLIGHT attribution**: cut usage by the FLIGHT interval (STAND occupancy, `departures.jsonl`, LOGBOOK `departedAt`–`arrivedAt`), CAPTAIN and CREW separately. What fits no FLIGHT is `UNATTRIBUTED`. Built in F4 (ATC-53), see 8.3. The LOGBOOK `arrived` line gains an optional `fuel` field (old lines have none): `{captain, crew, cost, netCost, cacheHit, leak: {coldCache, controlWake, sessionChange, compaction, modelSwitch, unexplained}, crewWarnings, models}`.

## 5. Leaks and CREW warnings

A **miss** follows Claude Code: re-processing more than 5 % of what could have been read from cache, and at least 2,000 tokens. Rebuilds explained by compaction or tool-result clearing are "expected rebuilds".

| Rule | Test | Confidence |
|---|---|---|
| COLD CACHE: expired during HOLD | Gap since the previous request in the session exceeds the TTL read from that response (1 h if `ephemeral_1h > 0`, else 5 m), and a miss | High |
| COLD CACHE: woken by a control message | As above, and the waking input is a message atc sent (CLEARANCE, FLIGHT PLAN, RECALL, CREW CHANGE). atc caused it | High (matched on message times) |
| MODEL SWITCH | Consecutive CAPTAIN requests with a different `message.model`, and a miss | High |
| COMPACTION | The summary request after `compact_boundary`; a leak only if the cache was cold | Medium |
| SESSION CHANGE | A new `sessionId` on the same FLIGHT/STAND, minus the AIRPORT's measured new-session baseline | Low |
| UPGRADE / EFFORT CHANGE | A miss right after `version` or `effort` changes | Medium |
| UNEXPLAINED | Any other miss | — |

How large the rewrite would be is the session's CONTEXT SIZE: the last CAPTAIN request's `input + cacheRead + cacheWrite`. FLEET shows it per AIRCRAFT, and FLEET PLAN proposes a fresh start (REFRESH) when a team rests after its FLIGHTs with a large context, before the next cold wake re-writes it all ([fleet.md](fleet.md) 8.6, "REFRESH as built (ATC-69)").

CREW warnings are shown, not added to leaks: HEAVY PREFIX (first CREW request writes > 30 K), TRIVIAL DELEGATION (prefix > 50 % of the subagent's input and ≤ 3 turns), HIGH CREW SHARE (> 50 % of the FLIGHT), DEEP NESTING (`spawnDepth` ≥ 2), EXPENSIVE READ-ONLY (Explore/Plan on Opus), COLD CREW (a subagent reused after 5 min idle), COMPLEMENT DRIFT (declared POSITION model ≠ actual `message.model`, feeding `crew-observed.ts`). Thresholds are proposals to tune after measuring.

**As built (F3 ATC-52, F7 ATC-57).** Each rule is tested in this order, first match wins:

| # | Bucket | Test as built | In LEAK |
|---|---|---|---|
| 1 | `proxied` | The request has no `requestId` (proxied DeepSeek, Muse and some Opus routes). Their caching is implicit and not priced like Anthropic's | No |
| 2 | `compaction` / `expectedRebuild` | A `compact_boundary` falls between the two requests: `compaction` when the gap also exceeds the TTL (the cache was cold), else `expectedRebuild` | `compaction` only |
| 3 | `modelSwitch` | `message.model` differs from the previous request's | Yes |
| 4 | `controlWake` / `coldCache` | Gap over the TTL; `controlWake` when an atc message to that session falls inside the gap | Yes |
| 5 | `upgrade` | Both requests carry a `version` (or an `effort`) and it changed; the event says which (`change`) | Yes |
| 6 | `unexplained` | Any other miss | Yes |
| — | `sessionChange` | Not a pairwise rule: a session's first CAPTAIN request, on a FLIGHT another session already flew (F4 attribution), minus the AIRPORT's new-session baseline, when the rest is ≥ 2,000 | Yes |

CAPTAIN requests are compared within a session and CREW requests within one subagent (agent id). CREW misses count in their rule and also in `leak.crew`. The new-session baseline is the median first-request write (`input + cache writes`) of every non-proxied session in the scan, per AIRPORT of the FLIGHT the request falls in, or over all sessions when an AIRPORT has fewer than 3. `GET /api/fuel` reports it as `sessionBaselines`.

| Warning | Threshold as built | Value |
|---|---|---|
| HEAVY PREFIX | First CREW request writes > 30,000 (`HEAVY_PREFIX_TOKENS`) | Tokens written |
| TRIVIAL DELEGATION | ≤ 3 requests and the first prompt is > 50 % of all the subagent's prompt tokens | That share |
| HIGH CREW SHARE | CREW > 50 % of the FLIGHT's tokens (all five kinds), per FLIGHT only | 1 on the FLIGHT |
| DEEP NESTING | `spawnDepth` ≥ 2 (`agent-*.meta.json`) | Depth |
| EXPENSIVE READ-ONLY | `agentType` Explore or Plan answered by an Opus model | Opus requests |
| COLD CREW | Gap between two requests of one subagent > 5 min (CREW writes the 5 m tier) | Gap, ms |
| COMPLEMENT DRIFT | The AIRCRAFT's declared POSITION names a model (`claude-opus-5-5`, not an agent type like `ui-builder`) and the subagent's most frequent `message.model` differs; or a `general-purpose`/`claude` subagent answered by a model no POSITION declares. Model names are compared without proxy prefixes and punctuation | 1 |

**Measured** (7 days to 2026-09-28, the real LOGBOOK and DEPARTURE LOG, read-only):

- LEAK 254 misses, 68.7 M tokens: COLD CACHE 217 (62.2 M; CAPTAIN 116 / 45.6 M, CREW 101 / 16.6 M), control wake 5 (1.7 M), MODEL SWITCH 2 (0.4 M), COMPACTION 2 (0.2 M), SESSION CHANGE 2 (11 K and 13 K over the baseline), UPGRADE 0, UNEXPLAINED 26 (4.2 M; CAPTAIN 6 / 1.7 M, CREW 20 / 2.4 M). CREW share of LEAK: 121 misses, 19.0 M.
- Outside LEAK: `proxied` 534 (50.7 M; CAPTAIN 205 / 19.2 M, CREW 329 / 31.5 M), `expectedRebuild` 11 (0.6 M).
- New-session baseline: 40.8 K median over 106 sessions (VCDO 52.4 K from 2, RNPU 15.5 K from 1, so both fall back to the overall median). The first CAPTAIN request writes about 36–50 K per AIRPORT (p10 17–29 K, p90 42–66 K).
- Compactions: 40 in the window; gap before the next request p10 60 s, p50 4 min, p90 42 min.
- `version` changed 3 times and `effort` 7 times between consecutive CAPTAIN requests; none of them came with a warm miss.
- CREW (316 subagents): first-request write p10 0, p50 34 K, p90 63 K, so HEAVY PREFIX fires on 160 (half: the 30 K proposal sits at the median and should be raised or tied to the agent type); TRIVIAL DELEGATION 5; DEEP NESTING 0 (no `spawnDepth` ≥ 2); EXPENSIVE READ-ONLY 5; COLD CREW 106 reuses on 44 subagents; COMPLEMENT DRIFT 0 (Opus `general-purpose` matches `backend`); HIGH CREW SHARE on 12 of 116 FLIGHTs with usage (per session, 8 of 84 sessions over 1 M tokens).
- **The Opus UNEXPLAINED misses a few seconds after a warm request** (8 with a `requestId` in the window before this change; the cache read fell to about 31 K, p50 31,005): 2–10 s after the previous request, which had stopped on `tool_use` in 7 of 8. `version`, `effort` and `model` were the same (one pair had no `version` on the earlier line). Line tags between the two requests (line type, system subtype, attachment type, content block types; no bodies) showed nothing that the warm pairs lacked: `mcp_instructions_delta` 1 of 8 vs 7 % of warm pairs, `deferred_tools_delta` and `skill_listing` none. No field explains them, so they stay `unexplained`.

## 6. Accounts and FUEL REMAINING

This is the part the 2026-09-28 TEAM_K case asks for.

- **ACCOUNT label** (built, ATC-51): a new optional AIRCRAFT profile field `account` in `fleet.json`, set on the FLEET card. AIRCRAFT without it count as the default account (`default`). If no AIRCRAFT has a label, atc does not know accounts and keeps grouping by reset time.
- **LIMIT by account** (built, ATC-51; [fleet.md](fleet.md) 8.8): ATC-45's `healthAlerts` groups `LIMIT` by reset time. With labels it groups by ACCOUNT, and a `LIMIT` on one AIRCRAFT marks every AIRCRAFT on that ACCOUNT as held until the reset. This also stops DISPATCH from sending the next FLIGHT to a sibling session that is about to hit the same wall.
- **FUEL REMAINING** (built, ATC-55, source 1; see 6.1): needs a live source per account. Candidates, in order of preference, to verify before building:
  1. The statusline input's `rate_limits` (what #53 cited). A statusline command would append `{t, sessionId, rate_limits}` to the atc state folder; atc maps session → AIRCRAFT → ACCOUNT. This changes user settings (`statusLine`) and adds a `hooks/` script: `user` tier.
  2. `quotaLimits` on refused requests (already read by ATC-45): exact but only after the limit is hit.
  3. FUEL BURN per ACCOUNT in the current window against a SUPERVISOR-entered budget: an estimate, labelled as such.
- **Use** (built, ATC-55): an ACCOUNT line `사용 82% · resets 21:00Z` in the FLEET FUEL block and on the card (used, not left; since ATC-81 the AIRCRAFT rows show the AIRCRAFT's own FOB instead, and a `HOLD · FUEL (account pro-2) until 21:00Z` tag at the hold level); an INFO to TOWER/OCC at a threshold (default 80 %); optionally (SUPERVISOR switch, off by default) DISPATCH skips an AIRCRAFT whose ACCOUNT is above a second threshold (default 95 %). Nothing is switched automatically between accounts. FLEET PLAN (ATC-63) also stops proposing LAUNCH or ENTRY into an ACCOUNT at the hold level, whatever the switch says (6.1).

### 6.1 FUEL REMAINING as built (ATC-55)

- **Step 0, the source.** Read from the statusline input builder in Claude Code 2.1.283 (the binary; no settings were changed). The input has `session_id` and, when known, `rate_limits` with `five_hour`, `seven_day` and (gateway logins only) `spend_limit`. Each is `{used_percentage, resets_at}`: `used_percentage` is the share used, 0–100 with one decimal (`utilization × 100`), and `resets_at` is epoch seconds. A window is included only while its reset is in the future (and under a year away); with none, `rate_limits` is left out. API key, Bedrock and Vertex sessions have no plan limits, so they report nothing. The fallback (FUEL BURN against a declared budget) was not needed.
- **Record.** `hooks/fuel-statusline.mjs` appends `{t, sessionId, rate_limits?, context_window_size?, model?}` to `fuel/<sessionId>.jsonl`: numbers and the model id only (ATC-85 added the last two; lines of older versions carry `rate_limits` alone and are still read). Only the values the input has are written, a line with none of the three is not written, and a line is appended only when a value it carries differs from the last line's, so a line without `rate_limits` is kept when the window or model changed. `context_window_size` (200000 or 1000000, from the input's `context_window`) and `model` (`model.id`, an id such as `claude-sonnet-5-5[1m]`) are how the CONTEXT window learns what the session says ([fleet.md](fleet.md) 8.6, "CONTEXT window from the session as built (ATC-85)"). FUEL REMAINING reads the last line that has `rate_limits`, the window the last line that has `context_window_size`. It prints `FUEL 5h 82% · 7d 40%` for the status line (`--quiet`: nothing). Install: [hooks/README.md](../hooks/README.md#fuel-statusline).
- **Per ACCOUNT.** `fuelRemainingOf` (pure, `server/fuel-remaining.ts`) takes the last record of each session, drops windows past their reset, and keeps the newest record per ACCOUNT. Without ACCOUNT labels each AIRCRAFT uses only its own sessions. The shown value is the most-used window.
- **Thresholds** (`dispatch.json` `fuel`): `infoPct` 80, `holdPct` 95, `hold` false. From `infoPct`: TOWER `open.fuel` (key per ACCOUNT, window and reset) and a FOLLOWING `fuel` issue (`info`). From `holdPct`, with `hold` on: DISPATCH skips the ACCOUNT's AIRCRAFT with `HOLD · FUEL (account pro-2) until 21:00Z`. The switch is in the settings window (AGENTS tab, FUEL block), SUPERVISOR only.
- **Control sessions (ATC-60).** TOWER, OCC, CROSSCHECK, MCC and ENGINEERING burn the same plan limits, so their records count too. On 2026-09-28, right after the F6 deploy, the only record came from MCC (weekly window 99 %) and nothing showed it, because MCC is not an AIRCRAFT.
  - A control session is known by its name, or by the control folder it runs in (`controller/`, `occ/`, `crosscheck/`, `mcc/`; ENGINEERING by name only). A team session never counts as one.
  - Its ACCOUNT label sits in `fleet.json` under a new optional top-level `control` field (`{"MCC": {"account": "main"}}`), set in the settings window (AGENTS tab, CONTROL block, a row per control session). Same format as F2. Old files read unchanged.
  - Without a label it counts under `default` when any label exists (AIRCRAFT or control), and under its own name (`control:MCC`) when there are none. Any label, including a control session's, now means "labels exist" for the ATC-51 `LIMIT` hold as well.
  - The ACCOUNT's value is the newest record from any member. The FLEET tab's new FUEL block lists each ACCOUNT with its AIRCRAFT and, apart from them, its control sessions. The row tooltip and the TOWER `open.fuel` text name the control members.
  - A control session pushing an ACCOUNT past `holdPct` holds that ACCOUNT's AIRCRAFT when the D3 switch is on. Control sessions themselves are never held or stopped, and a control session's `LIMIT` still does not hold AIRCRAFT (ATC-51 unchanged).
- **FLEET PLAN (ATC-63, [fleet.md](fleet.md) 8.6).** FLEET PLAN proposes no LAUNCH for an AIRCRAFT whose ACCOUNT is at `holdPct`. When every fitting AIRCRAFT is held it proposes nothing, not even ENTRY, because a new session opens on whatever account this machine is logged in to. An ordinary ENTRY (no registered AIRCRAFT fits) counts against the `default` ACCOUNT and is not proposed when `default` is at hold. The AIRPORT's demand line names the ACCOUNT (`FUEL 사용 100% (account acct-1) until 21:48Z — TEAM_Q — ENTRY도 제안 안 함(새 세션이 열릴 계정을 모름)`). This ignores the D3 switch by an ENGINEERING decision: a proposal is advice, and a session on an empty ACCOUNT is never useful. DISPATCH still follows the switch. At `infoPct` the proposal is made with a `fuel` reason line. An open LAUNCH or ENTRY whose ACCOUNT reaches hold expires with the FUEL text as its reason. The FLEET PLAN block shows one FUEL line per ACCOUNT (the "weekly-usage line"): the most-used window, its reset, what it means for proposals, and the AIRCRAFT and control members. The lookup is by ACCOUNT label, because an AIRCRAFT that isn't flying has no session of its own; an ACCOUNT that only control sessions report is found too.
- **Limits.** Only sessions that draw a status line report: CREW subagents and sessions on other machines don't. A value is only as fresh as the last redraw; the tooltip shows when and from which AIRCRAFT it came.

## 7. Screens and estimates

Built in F8 (ATC-56); section 8.6 has the rules as built.

- **FLEET card / row**: last 14 days FUEL COST per ARRIVED FLIGHT, CACHE HIT (CAPTAIN, CREW), CREW share, top leaks and warnings; FUEL REMAINING per ACCOUNT (worded as used); FOB (context left) per AIRCRAFT.
- **LOGBOOK / recent FLIGHTs**: FUEL BURN, NET, LEAK per FLIGHT, and whether it stayed inside TRIP FUEL.
- **DISPATCH card**: TRIP FUEL p50–p90 by TYPE × WAKE, widening to WAKE and then AIRPORT below `MEDIAN_MIN_SAMPLES` (and saying so). Display only.
- **TOWER/OCC brief**: AIRCRAFT with large leaks, and whether a message to a HOLDING CAPTAIN would hit a cold cache. Warn, never block.
- **Cost formula**: `input·P_in + cacheWrite5m·1.25·P_in + cacheWrite1h·2·P_in + cacheRead·readMult·P_in + output·P_out` (× data-residency or fast-mode multipliers). The cache-read multiplier differs by model (Opus 5.5 0.05, Fable 5.1 0.025); the table lives in a config file (`server/fuel-prices.json`, see 8.4).

### 7.1 FUEL overview as built (ATC-137)

One screen for burn so far, inside METRICS: **`#metrics/fuel`** (the METRICS tab has two sub-views, OPERATIONS and FUEL; `#metrics` is unchanged). Read only: nothing about how FUEL is measured, attributed or priced changed, and `server/fuel-prices.json` is untouched.

- **Loading.** The window is 1, 7, 14 or 30 days (`FUEL_MAX_DAYS`), 7 by default, with the `since` time shown. `GET /api/fuel?days=N` and `GET /api/logbook?days=N` are read when the sub-view opens, when the window changes and when the refresh button is pressed; the 2 s snapshot never triggers them. Loading, error (with retry) and empty (no requests in the window) states are shown.
- **Summary.** FUEL COST, CAPTAIN, CREW (with its share of the cost), CACHE HIT, requests and NET. The unpriced part is always next to it (`가격 없는 모델 4,710건 · 1.04B tokens 제외`, or `0건`), and a line says dollars are API list price, not billing.
- **ACCOUNT.** The same FUEL REMAINING block as FLEET (from `snapshot.fuelAccounts`, no new fetch); hidden when no ACCOUNT has a statusline record.
- **BY AIRCRAFT.** Sortable table: COST, requests, CACHE, CREW share (of cost), LEAK (priced), NET, top model. Rows are grouped: team AIRCRAFT (the `teamPattern` names, returned by `/api/fuel` as `teamPattern`) first, then control sessions (TOWER, OCC, MCC, CROSSCHECK, REVIEW, ENGINEERING), then other. Sessions without a name go under "other" one row each. A team AIRCRAFT links to `#fleet/<REGISTRATION>`, which opens its FLEET row.
- **BY MODEL.** Requests, tokens and cost per model; a model with no priced request is listed with its tokens and `no price`.
- **LEAKS.** Totals by rule (COLD CACHE, CONTROL WAKE, MODEL SWITCH, COMPACTION, SESSION CHANGE, UPGRADE, UNEXPLAINED) with a one-line meaning from section 5, then the two buckets outside LEAK (PROXIED, EXPECTED REBUILD), then the CREW warning counts.
- **PER DAY.** A stacked bar per UTC day, CAPTAIN and CREW cost, with a hover/focus tooltip, a legend, a "table view" and a marker under days that had unpriced tokens. Days without records are drawn as zero. Colours are `--series-captain` and `--series-crew` (`--cyan` and `--amber`; `--radar` gold in the night theme, where `--amber` is a blue star). Checked with the dataviz validator per theme: colour-blind separation ΔE 15–25, contrast against the panel passes; the lightness-band check flags the two accents only because the app's neon accents sit above that band (both are equally light), and identity never rests on colour alone (legend, table view).
- **TOP FLIGHTS.** The 10 most expensive ARRIVED FLIGHTs in the window by NET, from the priced LOGBOOK (`/api/logbook` entries carry `trip`), with the TRIP verdict (`inside` / `UNEXPECTED`) and a link to the FLIGHT (its Linear URL from the snapshot).
- **API (additive).** `GET /api/fuel` gains `byDay` (per UTC day: CAPTAIN and CREW cost, requests, unpriced tokens; only days with records, oldest first), `byModel` (requests, tokens, priced cost, unpriced requests and tokens; largest cost first) and `teamPattern`. Both aggregates come from the same pass as the rest of `summarizeFuel`; nothing is scanned twice. On 400,000 synthetic requests over 30 days `summarizeFuel` took about 490 ms against about 430–530 ms before, within run-to-run noise; the scan cost of `/api/fuel` is unchanged (ATC-83 is the fix for that). Older clients ignore the new fields.
- **Pure view functions** are in `web/src/fuel-overview.ts` (grouping, sorting, the unpriced summary, leak rows, day bars, top FLIGHTs) and tested in `server/fuel-overview.test.ts`; `byDay` and `byModel` are tested in `server/fuel-byday.test.ts`.

## 8. Implementation order (one issue each)

| # | Issue | Depends on | Tier | Size |
|---|---|---|---|---|
| F1 (ATC-50) ✅ | Parser, global dedupe, offset reader, read-only `GET /api/fuel` (per session: kinds, CACHE HIT, CREW lower bound), cross-checked against ccusage on the same days. **Done**, see 8.1 | — | `auto` | BUILD · M |
| F2 (ATC-51) ✅ | ACCOUNT label on the FLEET card and `fleet.json`; `LIMIT` grouped and held by ACCOUNT (health.ts, DISPATCH, SCHEDULE). **Done**, see [fleet.md](fleet.md) 8.8 | — | `auto`, raised to `user` if the `fleet.json` change is judged a format change | BUILD · M |
| F3 (ATC-52) ✅ | Leaks with high confidence: COLD CACHE (HOLD and control wake) and MODEL SWITCH. **Done**, see 8.2 | F1 | `auto` | BUILD · M |
| F4 (ATC-53) ✅ | FLIGHT attribution: optional `fuel` field on LOGBOOK `arrived` lines, `UNATTRIBUTED`. **Done**, see 8.3 | F1 | `user` (LOGBOOK record format) | BUILD · M |
| F5 (ATC-54) ✅ | Cost: config price table, FUEL COST, NET FUEL. **Done**, see 8.4 | F1 | `auto` | BUILD · L |
| F6 (ATC-55) ✅ | FUEL REMAINING source (section 6): verify statusline `rate_limits`, then the statusline script and per-ACCOUNT view. **Done**, see 6.1 | F2, decision D1 | `user` (`hooks/`, settings) | BUILD · M |
| F6b (ATC-60) ✅ | Control sessions (TOWER, OCC, CROSSCHECK, MCC, ENGINEERING) counted in their ACCOUNT: label in `fleet.json` `control`, set in the settings window; FLEET FUEL block by ACCOUNT. **Done**, see 6.1 | F6 | `user` (new top-level `fleet.json` field) | BUILD · S |
| F7 (ATC-57) ✅ | Other leaks and CREW warnings (COMPACTION, SESSION CHANGE after measuring the baseline, the warning list). **Done**, see 5 and 8.5 | F3 | `auto` | BUILD · M |
| F8 (ATC-56) ✅ | Screens and TRIP FUEL: FLEET/LOGBOOK/DISPATCH/brief views, TARGETS items `fuelPerFlight`, `cacheHit`. **Done**, see 8.6 | F4, F5 | `flagged` (TOWER and OCC manual lines) | BUILD · M |

### 8.1 F1 as built (ATC-50)

- **Dedupe fallback**: without `requestId` the key is `(message.id, sessionId)`, not `(message.id, sessionId, timestamp)`. The content-block lines of one response carry different timestamps (3,032 of 6,385 such keys in 7 days), so the timestamp would count one request several times. No id without `requestId` appeared in two sessions.
- **Kinds**: the write total is `cache_creation_input_tokens`; the 1 h part comes from `cache_creation.ephemeral_1h_input_tokens`, the rest is 5 m (all of it when `cache_creation` is missing). `<synthetic>` lines (no API call) are skipped.
- **CREW writes the 5 m tier.** Over 7 days (2026-09-28) CAPTAIN wrote 86.6 M at 1 h and 0 at 5 m, CREW 54.0 M at 5 m and 0 at 1 h. Section 1's "every request wrote 1 h" held for main transcripts only; F3's COLD CACHE TTL must follow each response, as section 5 says.
- **Names**: the live session name from `~/.claude/sessions`, else the last `agent-name` line of the transcript. AIRCRAFT groups sessions by upper-cased name; unnamed sessions stay per session only.
- **CREW files** include `subagents/workflows/wf_*/agent-*.jsonl`.
- **ccusage cross-check** (UTC days, `ccusage claude daily`, 2026-09-26/27): requests with a `requestId` (Opus, Sonnet) match ccusage exactly on 09-26. On 09-27 Opus is lower (cache writes 24,216,148 vs 25,086,025; reads 1,794,265,874 vs 1,906,561,851; output 3,894,909 vs 4,201,713) because ccusage does not dedupe lines without a `requestId`; counting those lines raw reproduces ccusage's Opus numbers exactly. Proxied routes (DeepSeek, Muse; no `requestId`) are higher or equal in ccusage for the same reason, and no simple rule reproduces them exactly; FUEL counts them once per `(message.id, session)`, largest copy.
- **Speed**: 7 days, 500 files: first scan 953 MB in 2.6 s, next call 36 ms (only new bytes).
- **Not in F1**: Codex `token_count` (section 4) is not read yet.

### 8.2 F3 as built (ATC-52)

- **Where**: `server/fuel-leaks.ts` (pure). `GET /api/fuel` gains `leak` on each session, AIRCRAFT and the totals, and `leakEvents` (the 20 largest in the window). Each bucket gives `count`, `tokens` (rewritten), `units` and `unpricedTokens`.
- **Miss**: CAPTAIN requests of one session, in time order, each compared with the previous one. What could have been read is the previous request's cached prefix (its cache reads + writes). `rewritten = min(that, this prompt) − this cacheRead`; a miss is `rewritten > 5 %` of it and `≥ 2,000`. The first request of a session (SESSION CHANGE) and CREW requests are not judged here (F7).
- **Rule order**: a `compact_boundary` between the two requests → `expectedRebuild`, left for F7 and not counted as a leak; a different `message.model` → `modelSwitch`; a gap over the TTL → `controlWake` when an atc message to that session falls inside the gap, else `coldCache`; anything else → `unexplained`.
- **TTL**: 1 h after a request that wrote 1 h, 5 m after one that wrote only 5 m. A request that only read keeps the tier before it (a cache read refreshes the entry at its own TTL), so a read-only response between writes does not shorten a 1 h session to 5 m. No write seen yet → 5 m.
- **Control messages** matched by time, from atc's own records: CLEARANCE `issue` time (`clearances.jsonl`, by session id), FLIGHT PLAN `send` and RECALL request time (`proposals.jsonl`; `recall-send` writes no record), CREW CHANGE `sent` (`crew-changes.jsonl`, by REGISTRATION = session name). Any of them inside the gap counts as the wake. No message body is read.
- **Units**: `rewritten × (writeMult − readMult)` in input-price units: write 1.25 (5 m) or 2 (1 h) by this request's write tier, read from the price table. Models not in the table get no units and their rewritten tokens go to `unpricedTokens` (principle 4). Since F5 both multipliers come from the price table (8.4), and each leak also carries `cost` in USD.
- **First reading** (7 days to 2026-09-28): 325 misses, 68.3 M tokens rewritten, against 87.2 M CAPTAIN cache writes. COLD CACHE 130 (46.8 M), control wake 5 (1.7 M, CLEARANCE), MODEL SWITCH 6 (0.6 M), UNEXPLAINED 184 (19.2 M, of which 17.2 M on proxied DeepSeek/Muse routes whose caching is implicit), expected rebuilds after compaction 19 (0.9 M). The Opus UNEXPLAINED misses seen were cache invalidations seconds after a warm request (the prefix read dropped to about 31 K, the system prompt), which F7 or a later rule may name.

### 8.3 F4 as built (ATC-53)

- **FLIGHT span** (`server/fuel-flights.ts`, pure): an ARRIVED FLIGHT runs from LOGBOOK `departedAt` to `arrivedAt`. Who flew it comes from the DEPARTURE LOG lines the LOGBOOK itself would match (same branch in the same AIRPORT first, else the FLIGHT key or a STAND, up to `arrivedAt`). Each AIRCRAFT line starts a segment, so a HANDOFF splits the span; the first segment is stretched back to `departedAt`. With no AIRCRAFT line the LOGBOOK `aircraft` flies the whole span.
- **EN ROUTE**: DEPARTURE LOG lines on STANDs that still exist and belong to no ARRIVED FLIGHT (not on one of its STANDs or branch before its arrival) are grouped by AIRPORT and branch (or STAND) into a span from the first line to now. Their usage is `enRoute`, not `UNATTRIBUTED`. A STAND deleted without an arrival gets no span, since its end is unknown.
- **One FLIGHT per request, never split.** A request goes to a FLIGHT covering its time where the session occupied one of the FLIGHT's STANDs (claim `since`–`lastAt`) at that time; failing that, where the session's AIRCRAFT (session name) flew a segment at that time. If several fit, the one that departed last wins (the next FLIGHT started during the previous one's landing wait), then the key. CAPTAIN and CREW are kept apart by `isSidechain`. AD HOC FLIGHTs (no ticket key) go through the same rules; occupancy lets an unnamed session count while it holds the STAND.
- **LOGBOOK `fuel` field**: set when a new `arrived` line is written, from a 14-day scan (`FUEL_LOGBOOK_DAYS`) cut against every ARRIVED and EN ROUTE span, so the overlap rule holds at write time too. It is never added to old lines (append-only), and it is left out, not zeroed, when the departure time is unknown (`departedFrom: "pr"`, the span would be the landing wait only), when the FLIGHT departed before the scan window, or when no request fits (transcripts cleaned up, or a non-Claude FLIGHT). Shape: `{captain, crew, cacheHit, leak, models}`; `captain` and `crew` carry the five kinds, `requests` and `cacheHit`, `crew.outputLowerBound` is `true`, `cacheHit` is CAPTAIN + CREW, `leak` is F3's per-rule totals (8.2) for the misses inside the FLIGHT, split by the same one-FLIGHT-per-request rule (zeros when there were none), and `models` counts requests per model. `cost` and `netCost` are not stored: FUEL COST is priced at read time from `byModel` (8.4, ATC-59). Since F7 (8.5) new lines also carry `crewWarnings`, and `leak` has the F7 buckets (counts and tokens, no cost). A failed scan writes the line without `fuel` and shows `FUEL: …` in the LOGBOOK error.
- **`GET /api/fuel`**: each `aircraft[]` row gains `attribution: {flights, enRoute, unattributed}`, each `{captain, crew, total}`; `attribution.totals` covers every session, unnamed ones included; `attribution.flights` lists the FLIGHTs with usage in the window (`key`, `flight`, `arrived`, AIRCRAFT in HANDOFF order, sessions, `fuel` with `leak`). The window view uses today's LOGBOOK (with later `attributed` lines), so it can differ from the `fuel` frozen on an older line.
- **Limits**: a claim's `lastAt` is the last touch, so work after it counts through the AIRCRAFT name only. Hook claims are current files, not a history, so older FLIGHTs lean on the DEPARTURE LOG and the session name. A request is never shared between two FLIGHTs that one session flies at the same moment.

### 8.4 F5 as built (ATC-54)

- **Price table**: `server/fuel-prices.json`, a config file with no prices in code. It holds `source`, `writeMult` (`5m` 1.25, `1h` 2), global `multipliers` (`inferenceGeo:us` 1.1) and per model `in`, `out` (USD per million tokens), `readMult` and optional `multipliers` (`speed:fast` 2 for Opus 5.5). The repository table has the Claude models seen in transcripts or named in section 7 (Opus 5.5, Sonnet 5, Haiku 4.5, Fable 5.1), with the list prices from Anthropic's pricing page as collected in #53, plus Sonnet 5.5 (added 2026-09-29, same list price as Sonnet 5). `~/.local/state/atc/fuel-prices.json`, if present, overrides it model by model (and multiplier by multiplier), so the SUPERVISOR can add or change a price without a deploy.
- **Matching**: a model is priced only when its name equals a table key or is that key plus a date (`claude-haiku-4-5-20251001`). No family or prefix guessing: `claude-opus-5` would not price `claude-opus-5-5`.
- **Multipliers** from the request's `usage.speed` and `usage.inference_geo` (new optional record fields `speed`, `geo`). `standard` speed is the base; any other speed needs a multiplier in the table, or the request is unpriced. An `inference_geo` multiplies only when listed.
- **Cost** per request, summed per CAPTAIN, CREW and total as `cost` (the five parts and `total`, USD) beside the tokens; requests without a price are counted in `unpriced` and listed in `priceWarnings` (model, reason, requests, tokens). CREW output is still a lower bound, so CREW cost is too.
- **NET FUEL**: `netCost = total.cost.total − leak.total.cost` per session, AIRCRAFT and in total. Unpriced leaks are not subtracted.
- **`GET /api/fuel`** also returns `prices` (source, files read, parse errors, priced models).
- **Cross-check**: 2026-09-26 (UTC), Opus 5.5 $596.56 and Sonnet 5 $2.81, the same as ccusage's cost for that day. Seven days to 2026-09-28: $2,903 priced (CAPTAIN $2,197, CREW $706), priced leaks $386, NET $2,517. DeepSeek, Muse and GPT routes (6,096 requests, 1.31 B tokens) have no price and show as warnings.
- **FLIGHT attribution stays in tokens.** F4's `attribution` parts and the LOGBOOK `arrived` line's `fuel` keep F4's shape: tokens only, and leak buckets without `cost`. Their leak `units` now come from the price table like the API's. Adding `cost` and `netCost` to LOGBOOK lines changes the record format (`user` tier), so it is left for a separate issue.
- **FUEL COST per FLIGHT (ATC-59)**, decided by ENGINEERING: store tokens, not dollars. New LOGBOOK `arrived` lines carry `fuel.byModel`: one entry per model variant (`model`, plus `speed` or `geo` only when they change the price), with `captain` and `crew` token kinds and requests, and `leak: {count, rewritten5m, rewritten1h}` for the CAPTAIN leaks (not `expectedRebuild`). The leak is stored as rewritten tokens by write tier rather than units, because units already contain the table's `readMult`. `priceFlightFuel` prices a `fuel` at read time with the current table: CAPTAIN, CREW and total cost, leak cost, NET, and the unpriced models; `null` for old lines without `byModel`, and `null` amounts (not 0) when no model is priced. `GET /api/logbook` entries and `GET /api/fuel` `attribution.flights` carry it as `fuelCost`. Old lines are never rewritten or backfilled. First reading: VOC-189 $88.53, leak $28.72, NET $59.81 with DeepSeek unpriced; a `fuel` with `byModel` is about 1.3 KB.
- **Codex** is still not read, so it stays out of cost (D6).

F1 and F2 started at once and in parallel, and both are built; they answer the TEAM_K question soonest. The rest wait in Backlog behind their dependencies (Linear `blocked by`).
### 8.5 F7 as built (ATC-57)

- **Where**: `server/fuel-leaks.ts` (the rules in order, `sessionChangeLeaks`), `server/fuel-crew.ts` (CREW warnings, pure), `server/agent-models.ts` (subagent id → the model that answered, filled by each FUEL scan), `analyzeWindow` in `server/fuel-run.ts`. Rules, thresholds and the first measurement are in section 5.
- **`GET /api/fuel`**: `leak` on each session, AIRCRAFT and the totals gains `compaction`, `sessionChange`, `upgrade`, `crew` (the CREW part of `total`) and `proxied` (outside `total`, like `expectedRebuild`); `leakEvents` leaves out both outside buckets. `crewWarnings` (counts per warning) on each session, AIRCRAFT and the totals; `crewWarningEvents` (the 50 latest: kind, session, name, agent, `agentType`, time, value, `detail`); `sessionBaselines`. Each `attribution.flights[].fuel` gains `crewWarnings`, with `highCrewShare` set to 1 when that FLIGHT went over.
- **LOGBOOK**: new `arrived` lines carry `fuel.crewWarnings` and the F7 `leak` buckets. Old lines are not changed.
- **OBSERVED CREW** ([fleet.md](fleet.md) 8.3): with the actual model per subagent from the last FUEL scan, `observeCrew` groups by that model instead of assuming Opus, and a call whose model differs from its POSITION's declared model goes to `crewDrift.undeclared` as `type (model)`. Before any FUEL scan it behaves as before.
- **`byModel[].leak` (ATC-59)** now also takes CREW misses and, like `expectedRebuild`, leaves out `proxied`, so the leak priced at read time matches `leak.total`.
- **Kept as they were**: F3's rules and order for CAPTAIN misses, except that proxied misses left `unexplained`/`coldCache`/`modelSwitch` for `proxied`, and cold compaction left `expectedRebuild` for `compaction`.

### 8.6 F8 as built (ATC-56)

- **Where**: `server/fuel-view.ts` (pure; the web imports it too), `server/fuel-watch.ts` (the brief warnings, a 24-hour FUEL scan kept for 60 s), `server/fuel-prices.ts` (`readPrices` moved out of `fuel-run.ts` so the FLEET and DISPATCH code can price LOGBOOK lines without an import cycle; `fuel-run.ts` re-exports it). `loadPricedLogbook` (`logbook.ts`) is the LOGBOOK with `fuelCost` priced at read time.
- **Missing is not zero.** A line without `fuel` (before F4), a `fuel` without `byModel` (before ATC-59), a FLIGHT whose models are all unpriced, and CREW warnings on lines from before F7 each show `—` or `null`. Tokens are shown when there is no price.
- **TRIP FUEL** (`tripFuelOf`): p50–p90 of past NET FUEL COST, linear-interpolated quantiles, from priced LOGBOOK FLIGHTs of the last 60 days (`TRIP_FUEL_DAYS`), the FLIGHT itself left out. Levels in order: TYPE × WAKE, then WAKE, then AIRPORT, the first with at least `MEDIAN_MIN_SAMPLES` (3) FLIGHTs; the card says which (`TRIP FUEL $5.28–$15.6 · TYPE×WAKE BUILD·M (6)`). AD HOC work (no class) starts at AIRPORT. With too few everywhere the range is missing and the card says how many priced FLIGHTs there are. `generations` splits the same samples by model generation (the model with the most requests in the FLIGHT, date suffix dropped), with a range only where a generation has 3 or more. A FLIGHT whose NET is above p90 is `unexpected`, else `inside` (`tripCheckOf`).
- **FLEET** (`fleetFuelOf`, `fleetView` `fuelBurn` and `fuelRecent`): section 7 items over the last 14 days, and per recent FLIGHT the FUEL BURN tokens, cost, NET, LEAK and TRIP FUEL verdict. CACHE HIT is summed over the lines that have `fuel`; CREW share is the CREW part of FUEL COST on priced lines. The FLEET row gets a FUEL column (`$6.10/FLT · CACHE 93%`, NET and details in the tooltip) beside F6's FUEL REMAINING, which is unchanged. On narrow screens the column takes its own line.
- **LOGBOOK**: `GET /api/logbook` entries carry `trip` (`net`, the TRIP FUEL range, `verdict`).
- **DISPATCH card**: the facts line gains TRIP FUEL for the proposal's FLIGHT (its labels' TYPE × WAKE and the proposal's AIRPORT) and, when the proposal's AIRCRAFT is a HOLDING CAPTAIN with a cold cache, the COLD CACHE warning. Neither is read by `planDispatch`: scores and assignments are unchanged.
- **Brief warnings** (`fuelWatch`): `largeLeaksOf` sums the priced F3/F7 leaks of the last 24 hours per team AIRCRAFT and lists those at `LARGE_LEAK_USD` ($10) or more, keyed per AIRCRAFT and UTC day (`leak|TEAM_F|2026-09-28`); unpriced and `proxied` misses are not guessed. On 2026-09-28 team AIRCRAFT leaked $2–12 a day, so $10 picks out the top few. `coldCachesOf` takes each HOLDING CAPTAIN (idle team session holding a STAND) and its last CAPTAIN request: past the TTL of section 8.2, a message now would re-write the prefix (the last request's read + write + input), priced like a COLD CACHE leak. A session with no request in the scan counts as cold only when its last activity is over an hour old (the longest TTL), with the size unknown. TOWER gets `open.fuelLeaks`, `open.coldCache` and `open.fuelError` in `GET /api/controller/brief`; OCC gets `fuel` (`coldCache`, `largeLeaks`, `error`) in `GET /api/dispatch/brief`. Both warn and never block: the manuals say to note them and to still send what was due.
- **TARGETS**: `fuelPerFlight` (USD, NET per FLIGHT, at or below) and `cacheHit` (0–1, at or above), set on the FLEET card, shown next to the FUEL actuals in amber when missed. Display only, like the other TARGETS.

## 9. Decisions for the SUPERVISOR

| # | Question | Proposal |
|---|---|---|
| D1 | FUEL REMAINING source | Verify statusline `rate_limits` first; if present, install a statusline command (user tier). If not, fall back to FUEL BURN against a declared budget. **Decided 2026-09-28 as proposed** (SUPERVISOR, ATC-55); verified present, so the statusline command was built (6.1) |
| D2 | Where the ACCOUNT label lives | AIRCRAFT profile field `account` in `fleet.json`, edited on the FLEET card |
| D3 | May a plan-limit threshold hold DISPATCH? | Yes, behind a switch that is off by default (95 %). Built as proposed in ATC-55 (`dispatch.json` `fuel.hold`, settings window); the SUPERVISOR turns it on |
| D4 | Exact CREW output via OTel (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, file exporter)? | Not now; keep the lower-bound flag |
| D5 | Scan cadence | Offsets on the LOGBOOK cycle (10 min); FUEL REMAINING on every snapshot |
| D6 | Codex prices | Leave Codex out of cost until a price is set |

## 10. Risks

| Risk | Mitigation |
|---|---|
| Transcript format is not a public API | One pure parser with fixtures; unknown lines counted, not guessed |
| Double counting across resume/HANDOFF copies | Global dedupe (2.42× measured) |
| Reading bodies by accident | Filter before parse, drop content after; tests assert no body text in records |
| A team blamed for atc's own leaks | `controlWake` is counted separately; `UNEXPLAINED` never names a cause |
| FUEL steering assignment | Display only; the one HOLD is a switched, account-level threshold |
| Account data in a public repository | Labels only, chosen by the SUPERVISOR; no emails or plan names from the account in code, docs or PRs |

## Not built yet

ENTRY can't know which account a new session will open on: it opens on whatever account this machine is logged in to, and atc only knows the declared labels. FLEET PLAN counts an ordinary ENTRY against the `default` ACCOUNT, and proposes no ENTRY when every fitting AIRCRAFT is held for FUEL (ATC-63).

Codex usage and prices (section 4, D6); tuning the CREW warning thresholds (HEAVY PREFIX fires on half of all subagents, section 5). FLIGHTs that arrived before ATC-59 have no `byModel` and stay unpriced, so TRIP FUEL has few samples at first and often widens to WAKE or AIRPORT. The large-leak threshold ($10 a day) and TRIP FUEL's 60-day window are first guesses to tune once there is more data.
